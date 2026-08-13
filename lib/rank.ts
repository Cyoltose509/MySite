// 从夯到拉排行榜：通用数据层
// 支持 anime / game / music_sing / music_like / meal 五个维度

import { supabase } from '@/lib/supabase';
import { getAnimeCovers, getAnimeList } from '@/lib/anime-data';

export const TIERS = ['夯', '顶级', '人上人', 'NPC', '拉完了'] as const;
export type Tier = (typeof TIERS)[number];

export type Domain = 'anime' | 'game' | 'music_sing' | 'music_like' | 'meal';

export interface RankTag {
  tag: string;
  rating?: string;     // game / anime 评级（来自 tag 表）
  note?: string;       // game / music / meal 笔记
  likability?: number; // music 喜欢度 1-5
  singability?: number;// music 能唱度 1-5
  voice?: string;      // music 声线
}

export interface RankItem {
  id: string;        // 唯一拖拽 key（等于 entityId，用 id 方便 React）
  title: string;
  subtitle?: string;
  tier: Tier;
  entityId: string;
  coverUrl?: string;
  source?: any;      // 原始记录（含详情所需字段）
  tags?: RankTag[];  // 标签（含 rating/note/likability/singability/voice）
}

export const TIER_COLORS: Record<Tier, string> = {
  '夯': '#dc2626',
  '顶级': '#f97316',
  '人上人': '#facc15',
  'NPC': '#fde68a',
  '拉完了': '#f3f4f6',
};

export const TIER_TEXT: Record<Tier, string> = {
  '夯': '#ffffff',
  '顶级': '#ffffff',
  '人上人': '#111827',
  'NPC': '#111827',
  '拉完了': '#111827',
};

export const RATING_TO_TIER: Record<string, Tier> = {
  '夯': '夯',
  '顶级': '顶级',
  '人上人': '人上人',
  'NPC': 'NPC',
  '拉完了': '拉完了',
};

/** music_tags 喜欢度/能唱度是 1-5 刻度，直接映射五档：
 *  1→拉完了, 2→NPC, 3→人上人, 4→顶级, 5→夯 */
export function musicScoreToTier(score: number): Tier {
  const s = Math.max(1, Math.min(5, Math.round(score || 1)));
  if (s <= 1) return '拉完了';
  if (s === 2) return 'NPC';
  if (s === 3) return '人上人';
  if (s === 4) return '顶级';
  return '夯';
}

function mean(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function inferTier(domain: Domain, source: any, tags: RankTag[] = []): Tier {
  if (domain === 'anime' || domain === 'meal') {
    return RATING_TO_TIER[source.rating] || '拉完了';
  }
  if (domain === 'game') {
    return RATING_TO_TIER[tags[0]?.rating || ''] || '拉完了';
  }
  if (domain === 'music_sing' || domain === 'music_like') {
    const key = domain === 'music_sing' ? 'singability' : 'likability';
    const scores = tags.map((t) => (t as any)[key]).filter((v: any) => typeof v === 'number');
    if (!scores.length) return '拉完了';
    return musicScoreToTier(mean(scores));
  }
  return '拉完了';
}

export async function loadRankItems(domain: Domain): Promise<RankItem[]> {
  const [{ data: ranks }, items] = await Promise.all([
    supabase.from('rankings').select('entity_id,tier').eq('domain', domain),
    loadSourceItems(domain),
  ]);

  const rankMap: Record<string, Tier> = {};
  for (const r of ranks || []) {
    if (TIERS.includes(r.tier as Tier)) rankMap[r.entity_id] = r.tier as Tier;
  }

  return items.map((it: SourceItem) => {
    const tier = rankMap[it.id] || inferTier(domain, it.source, it.tags || []);
    return {
      id: it.id,
      title: it.title,
      subtitle: it.subtitle,
      tier,
      entityId: it.id,
      coverUrl: it.coverUrl,
      source: it.source,
      tags: it.tags,
    };
  });
}

interface SourceItem {
  id: string;
  title: string;
  subtitle?: string;
  source: any;
  tags?: RankTag[];
  coverUrl?: string;
}

async function loadSourceItems(domain: Domain): Promise<SourceItem[]> {
  if (domain === 'anime') {
    const [{ data }, coverMap, mdList] = await Promise.all([
      supabase.from('anime_list').select('id,title,rating'),
      getAnimeCovers(),
      getAnimeList().catch(() => [] as any[]),
    ]);
    // 用 GitHub markdown 的完整信息（状态/标签/正文/首播/来源）补充列表页详情
    const mdMap: Record<string, any> = {};
    for (const m of mdList || []) mdMap[String(m.title).toLowerCase()] = m;
    return (data || []).map((a: any) => {
      const md = mdMap[String(a.title).toLowerCase()];
      const source = md
        ? { ...a, status: md.status, tags: md.tags, body: md.body, premiereDate: md.premiereDate, source: md.source, filePath: md.filePath }
        : a;
      return {
        id: a.id,
        title: a.title,
        subtitle: a.rating ? `当前评级：${a.rating}` : '未评级',
        source,
        tags: md ? (md.tags || []).map((t: string) => ({ tag: t })) : [],
        coverUrl: coverMap[a.title],
      };
    });
  }

  if (domain === 'game') {
    const [{ data: games }, { data: tags }] = await Promise.all([
      supabase.from('steam_games').select('id,steam_app_id,title,playtime_forever,playtime_2weeks,img_icon_url,img_logo_url,custom_cover,store_url,is_manual,metrics'),
      supabase.from('steam_tags').select('id,game_id,tag,rating,note'),
    ]);
    const tagMap: Record<string, any[]> = {};
    for (const t of tags || []) {
      if (!tagMap[t.game_id]) tagMap[t.game_id] = [];
      tagMap[t.game_id].push(t);
    }
    return (games || []).map((g: any) => {
      const cover = g.custom_cover || (g.steam_app_id && g.steam_app_id > 0
        ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steam_app_id}/header.jpg`
        : g.img_logo_url || g.img_icon_url || undefined);
      const h = g.playtime_forever ? Math.round(g.playtime_forever / 60) : 0;
      return {
        id: g.id,
        title: g.title,
        subtitle: h ? `累计 ${h}h` : undefined,
        source: g,
        tags: (tagMap[g.id] || []).map((t: any) => ({ tag: t.tag, rating: t.rating, note: t.note })),
        coverUrl: cover,
      };
    });
  }

  if (domain === 'music_sing' || domain === 'music_like') {
    const [{ data: songs }, { data: tags }, { data: covers }] = await Promise.all([
      supabase.from('music_list').select('id,title,artist,album,duration,netease_id'),
      supabase.from('music_tags').select('id,music_id,tag,likability,singability,voice,note'),
      supabase.from('music_covers').select('netease_id,cover_url'),
    ]);
    const tagMap: Record<string, any[]> = {};
    for (const t of tags || []) {
      if (!tagMap[t.music_id]) tagMap[t.music_id] = [];
      tagMap[t.music_id].push(t);
    }
    const coverMap: Record<string, string> = {};
    for (const c of covers || []) coverMap[String(c.netease_id)] = c.cover_url;
    return (songs || []).map((m: any) => {
      const artistStr = Array.isArray(m.artist) ? m.artist.join(' / ') : (m.artist || '');
      return {
        id: m.id,
        title: m.title,
        subtitle: artistStr || undefined,
        source: m,
        tags: (tagMap[m.id] || []).map((t: any) => ({ tag: t.tag, likability: t.likability, singability: t.singability, voice: t.voice, note: t.note })),
        coverUrl: m.netease_id != null ? coverMap[String(m.netease_id)] : undefined,
      };
    });
  }

  if (domain === 'meal') {
    const [{ data }, { data: tags }] = await Promise.all([
      supabase.from('meals').select('id,title,rating'),
      supabase.from('meal_tags').select('id,meal_id,tag,note'),
    ]);
    const tagMap: Record<string, any[]> = {};
    for (const t of tags || []) {
      if (!tagMap[t.meal_id]) tagMap[t.meal_id] = [];
      tagMap[t.meal_id].push(t);
    }
    return (data || []).map((m: any) => ({
      id: m.id,
      title: m.title,
      subtitle: m.rating ? `当前评级：${m.rating}` : '未评级',
      source: m,
      tags: (tagMap[m.id] || []).map((t: any) => ({ tag: t.tag, note: t.note })),
    }));
  }

  return [];
}

export async function saveRanking(domain: Domain, entityId: string, tier: Tier) {
  const { error } = await supabase.from('rankings').upsert(
    { domain, entity_id: entityId, tier, updated_at: new Date().toISOString() },
    { onConflict: 'domain,entity_id' }
  );
  if (error) throw error;
}
