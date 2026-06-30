'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import {
  C, pageStyle, cardGridStyle, cardStyle, cardBgStyle, cardOverlayStyle, cardContentStyle, cardTitleStyle, cardArtistStyle, cardDurationStyle,
  badgeStyle, tagChipStyle, tagMoreStyle, emptyStyle,
  headerStyle, backLinkStyle, h1Style, countBadgeStyle,
  controlsStyle, filterRowStyle, filterLabelStyle,
  filterTabsStyle, filterTabStyle, filterTabActiveStyle, statsRowStyle,
  searchInputStyle,
  modalOverlayStyle, modalStyle, modalCloseStyle,
  loadingContainerStyle, spinnerStyle, loadingTextStyle,
} from '@/lib/card-styles';

interface GameRecord {
  id: string;
  steam_app_id: number;
  title: string;
  playtime_forever: number;
  playtime_2weeks: number;
  img_icon_url: string;
  img_logo_url: string;
  is_manual?: boolean;
  store_url?: string;
  custom_cover?: string;
}

interface GameTagData {
  id: string;
  tag: string;
  rating?: string;
  note?: string;
}

const RATING_ORDER: Record<string, number> = { '夯': 0, '顶级': 1, '人上人': 2, 'NPC': 3, '拉完了': 4 };
const RATING_COLORS: Record<string, string> = { '夯': '#a855f7', '顶级': '#4ade80', '人上人': '#eab308', 'NPC': '#6b7280', '拉完了': '#f87171' };

export default function GamesPage() {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<string, GameTagData[]>>({});
  const [search, setSearch] = useState('');
  const [ratingFilter, setRatingFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('playtime');
  const [loading, setLoading] = useState(true);
  const [detailGame, setDetailGame] = useState<GameRecord | null>(null);

  useEffect(() => { fetchGames(); }, []);

  const fetchGames = async () => {
    const { data } = await supabase.from('steam_games').select('*').order('playtime_forever', { ascending: false });
    setGames(data || []);

    const { data: tags } = await supabase.from('steam_tags').select('*');
    if (tags) {
      const map: Record<string, GameTagData[]> = {};
      tags.forEach((t: any) => {
        if (!map[t.game_id]) map[t.game_id] = [];
        map[t.game_id].push(t);
      });
      setTagsMap(map);
    }
    setLoading(false);
  };

  const allTags = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ts of Object.values(tagsMap)) {
      for (const t of ts) counts[t.tag] = (counts[t.tag] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  }, [tagsMap]);

  const sorted = [...games].sort((a, b) => {
    if (sortBy === 'playtime') return b.playtime_forever - a.playtime_forever;
    if (sortBy === 'playtime_2weeks') return b.playtime_2weeks - a.playtime_2weeks;
    if (sortBy === 'title') return a.title.localeCompare(b.title);
    const ra = tagsMap[a.id]?.[0];
    const rb = tagsMap[b.id]?.[0];
    if (sortBy === 'rating') return (RATING_ORDER[ra?.rating || ''] ?? 99) - (RATING_ORDER[rb?.rating || ''] ?? 99);
    return 0;
  });

  const filtered = sorted.filter(g => {
    if (ratingFilter) {
      const t = tagsMap[g.id]?.[0];
      if (!t || t.rating !== ratingFilter) return false;
    }
    if (tagFilter) {
      const tgs = tagsMap[g.id] || [];
      if (!tgs.some(t => t.tag === tagFilter)) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const tgs = tagsMap[g.id] || [];
      return g.title.toLowerCase().includes(q) || tgs.some(t => t.tag.toLowerCase().includes(q));
    }
    return true;
  });

  const fmtPlaytime = (min: number) => {
    if (min < 60) return `${min}分钟`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}.${Math.round(m / 6)}h` : `${h}h`;
  };

  const ratings = ['夯', '顶级', '人上人', 'NPC', '拉完了'];
  const taggedCount = Object.keys(tagsMap).length;

  const steamImg = (g: GameRecord) => {
    if (g.custom_cover) return g.custom_cover;
    if (g.is_manual) return ''; // non-Steam manual games have no Steam CDN cover
    return `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steam_app_id}/header.jpg`;
  };

  if (loading) return <div style={loadingContainerStyle}><div style={spinnerStyle} /><p style={loadingTextStyle}>加载中...</p></div>;

  const detailTags = detailGame ? (tagsMap[detailGame.id] || []) : [];

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={backLinkStyle}>← 首页</Link>
        <h1 style={h1Style}>🎮 游戏库</h1>
        <span style={countBadgeStyle}>{games.length} 款</span>
      </header>

      <p style={{ fontSize: 11, color: '#52525b', marginBottom: 12 }}>数据来源：Steam</p>

      <section style={controlsStyle}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜索游戏或标签..." style={searchInputStyle} />

        <div style={filterRowStyle}>
          <span style={filterLabelStyle}>排序</span>
          <div style={filterTabsStyle}>
            {[
              { value: 'playtime', label: '时长优先' },
              { value: 'playtime_2weeks', label: '近期优先' },
              { value: 'rating', label: '评级优先' },
              { value: 'title', label: '标题 A→Z' },
            ].map(o => (
              <button key={o.value} onClick={() => setSortBy(o.value)}
                style={{ ...filterTabStyle, ...(sortBy === o.value ? filterTabActiveStyle : {}) }}>{o.label}</button>
            ))}
          </div>
        </div>

        <div style={filterRowStyle}>
          <span style={filterLabelStyle}>评级</span>
          <div style={filterTabsStyle}>
            <button onClick={() => setRatingFilter(null)}
              style={{ ...filterTabStyle, ...(ratingFilter === null ? filterTabActiveStyle : {}) }}>全部</button>
            {ratings.map(r => (
              <button key={r} onClick={() => setRatingFilter(r)}
                style={{ ...filterTabStyle, ...(ratingFilter === r ? filterTabActiveStyle : {}) }}>{r}</button>
            ))}
          </div>
        </div>

        {allTags.length > 0 && (
          <div style={filterRowStyle}>
            <span style={filterLabelStyle}>标签</span>
            <div style={filterTabsStyle}>
              <button onClick={() => setTagFilter(null)}
                style={{ ...filterTabStyle, ...(tagFilter === null ? filterTabActiveStyle : {}) }}>全部</button>
              {allTags.map(({ tag, count }) => (
                <button key={tag} onClick={() => setTagFilter(tag)}
                  style={{ ...filterTabStyle, ...(tagFilter === tag ? filterTabActiveStyle : {}) }}>
                  {tag} <span style={{ fontSize: 10, color: C.textDim, marginLeft: 2 }}>{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={statsRowStyle}>
          <span>已标记 {taggedCount}</span>
          <span>未标记 {games.length - taggedCount}</span>
        </div>
      </section>

      <main style={cardGridStyle}>
        {filtered.map(g => {
          const tags = tagsMap[g.id] || [];
          const firstTag = tags[0];
          const cover = steamImg(g);

          return (
            <article key={g.id} style={cardStyle} onClick={() => setDetailGame(g)}>
              {cover && <div style={cardBgStyle(cover)} />}
              <div style={cardOverlayStyle} />
              <div style={cardContentStyle}>
                <p style={cardTitleStyle(!!firstTag)}>{g.title}</p>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  {firstTag?.rating && <span style={{ ...badgeStyle(RATING_COLORS[firstTag.rating] || '#71717a'), fontWeight: 700 }}>{firstTag.rating}</span>}
                </div>
                <p style={cardDurationStyle}>🕐 {fmtPlaytime(g.playtime_forever)}</p>
                {g.playtime_2weeks > 0 && <p style={{ fontSize: 10, color: '#52525b' }}>近两周 {fmtPlaytime(g.playtime_2weeks)}</p>}
                {tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
                    {tags.slice(0, 5).map(t => <span key={t.id} style={tagChipStyle}>{t.tag}</span>)}
                    {tags.length > 5 && <span style={tagMoreStyle}>+{tags.length - 5}</span>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </main>

      {filtered.length === 0 && <p style={emptyStyle}>没有匹配的游戏</p>}

      {/* Detail Modal */}
      {detailGame && (
        <div style={modalOverlayStyle} onClick={() => setDetailGame(null)}>
          <div style={{ ...modalStyle, maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <button style={modalCloseStyle} onClick={() => setDetailGame(null)}>✕</button>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              {steamImg(detailGame) && (
                <img src={steamImg(detailGame)} alt={detailGame.title}
                  style={{ width: 230, height: 107, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
              )}
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 8px' }}>{detailGame.title}</h2>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  {detailTags[0]?.rating && <span style={{ ...badgeStyle(RATING_COLORS[detailTags[0].rating]), fontSize: 13, fontWeight: 700 }}>{detailTags[0].rating}</span>}
                </div>
                <p style={{ fontSize: 14, color: C.textSec, margin: '4px 0' }}>总时长：{fmtPlaytime(detailGame.playtime_forever)}</p>
                {detailGame.playtime_2weeks > 0 && <p style={{ fontSize: 13, color: '#52525b' }}>近两周：{fmtPlaytime(detailGame.playtime_2weeks)}</p>}
                {(detailGame.store_url || (!detailGame.is_manual && detailGame.steam_app_id > 0)) && (
                  <a href={detailGame.store_url || `https://store.steampowered.com/app/${detailGame.steam_app_id}`} target="_blank"
                    style={{ fontSize: 12, color: C.accentLt, textDecoration: 'none' }}>🔗 {detailGame.store_url ? '商店页面' : 'Steam 商店页面'}</a>
                )}
              </div>
            </div>
            {detailTags.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {detailTags.map(t => <span key={t.id} style={{ padding: '5px 12px', borderRadius: 20, background: C.border, fontSize: 12, color: C.textSec }}>{t.tag}</span>)}
              </div>
            )}
            {detailTags[0]?.note && (
              <div style={{ background: '#16162a', borderRadius: 10, padding: 12 }}>
                <p style={{ fontSize: 11, color: '#52525b', margin: '0 0 4px' }}>笔记</p>
                <p style={{ fontSize: 13, color: C.text, margin: 0, lineHeight: 1.6 }}>{detailTags[0].note}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
