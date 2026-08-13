'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import * as htmlToImage from 'html-to-image';
import {
  C, pageStyle, headerStyle, backLinkStyle, h1Style, countBadgeStyle,
  emptyStyle, searchInputStyle,
  modalOverlayStyle, modalStyle, modalCloseStyle, modalCoverPlaceholderStyle,
  badgeStyle,
} from '@/lib/card-styles';
import { isAuthenticated } from '@/lib/auth';
import { getQuickSearchIndex } from '@/lib/search';
import { proxyCoverUrl } from '@/lib/imgProxy';
import { supabase } from '@/lib/supabase';
import {
  type Tier, type RankItem, type Domain, TIERS, TIER_COLORS, TIER_TEXT,
  loadRankItems, saveRanking,
} from '@/lib/rank';

interface Props {
  domain: Domain;
  title: string;
  icon?: string;
  backHref?: string;
  headerExtra?: ReactNode;
}

export default function RankBoard({ domain, title, icon = '📊', backHref = '/', headerExtra }: Props) {
  const [byTier, setByTier] = useState<Record<Tier, RankItem[]>>({
    '夯': [], '顶级': [], '人上人': [], 'NPC': [], '拉完了': [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [search, setSearch] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<Tier | null>(null);
  const [detailItem, setDetailItem] = useState<RankItem | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStage, setExportStage] = useState('');
  const [refsMap, setRefsMap] = useState<Record<string, { anime: string[]; music: { id: string; title: string }[]; games: { id: string; title: string }[] }>>({});
  const [singCounts, setSingCounts] = useState<Record<string, number>>({});
  const [eatCounts, setEatCounts] = useState<Record<string, number>>({});
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUnlocked(isAuthenticated());
    load();
  }, [domain]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const refType = domain.startsWith('music') ? 'music' : domain;
    try {
      const [items, agg] = await Promise.all([
        loadRankItems(domain),
        loadRefsAndCounts(refType),
      ]);
      const map: Record<Tier, RankItem[]> = {
        '夯': [], '顶级': [], '人上人': [], 'NPC': [], '拉完了': [],
      };
      for (const it of items) map[it.tier].push(it);
      for (const t of TIERS) {
        map[t].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
      }
      setByTier(map);
      setRefsMap(agg.refsById);
      setSingCounts(agg.singCounts);
      setEatCounts(agg.eatCounts);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载实体关联（双向）与唱K/吃次数，供详情卡展示（与列表页详情卡一致）
  const loadRefsAndCounts = async (refType: string) => {
    const [{ data: refs }, { data: events }, { data: groups }] = await Promise.all([
      supabase.from('entity_refs').select('*'),
      supabase.from('event_logs').select('refs, group_id').not('refs', 'is', null).neq('refs', '[]'),
      supabase.from('event_groups').select('id, name'),
    ]);
    const groupMap: Record<string, string> = {};
    for (const g of groups || []) groupMap[g.id] = g.name;

    // 解析对端 title：一次性查 music / game 的 id→title
    const [{ data: musicRows }, { data: gameRows }] = await Promise.all([
      supabase.from('music_list').select('id, title'),
      supabase.from('steam_games').select('id, title'),
    ]);
    const musicTitleById: Record<string, string> = {};
    for (const m of musicRows || []) musicTitleById[m.id] = m.title;
    const gameTitleById: Record<string, string> = {};
    for (const g of gameRows || []) gameTitleById[g.id] = g.title;

    const refsById: Record<string, { anime: string[]; music: { id: string; title: string }[]; games: { id: string; title: string }[] }> = {};
    for (const r of refs || []) {
      let entityId: string, otherType: string, otherId: string;
      if (r.source_type === refType) { entityId = r.source_id; otherType = r.target_type; otherId = r.target_id; }
      else if (r.target_type === refType) { entityId = r.target_id; otherType = r.source_type; otherId = r.source_id; }
      else continue;
      if (!refsById[entityId]) refsById[entityId] = { anime: [], music: [], games: [] };
      if (otherType === 'anime') refsById[entityId].anime.push(otherId);
      else if (otherType === 'music') refsById[entityId].music.push({ id: otherId, title: musicTitleById[otherId] || otherId });
      else if (otherType === 'game') refsById[entityId].games.push({ id: otherId, title: gameTitleById[otherId] || otherId });
    }

    const singCounts: Record<string, number> = {};
    const eatCounts: Record<string, number> = {};
    for (const e of events || []) {
      const isEat = groupMap[e.group_id] === '大餐';
      for (const ref of (e.refs || []) as any[]) {
        if (!ref?.id) continue;
        singCounts[ref.id] = (singCounts[ref.id] || 0) + 1;
        if (isEat) eatCounts[ref.id] = (eatCounts[ref.id] || 0) + 1;
      }
    }
    return { refsById, singCounts, eatCounts };
  };

  const filteredByTier = useMemo(() => {
    if (!search.trim()) return byTier;
    const q = search.toLowerCase();
    const map: Record<Tier, RankItem[]> = {
      '夯': [], '顶级': [], '人上人': [], 'NPC': [], '拉完了': [],
    };
    for (const t of TIERS) {
      map[t] = byTier[t].filter((it) => {
        const idx = getQuickSearchIndex(`${it.title} ${it.subtitle || ''}`.toLowerCase());
        return idx.includes(q);
      });
    }
    return map;
  }, [byTier, search]);

  const total = useMemo(() => TIERS.reduce((s, t) => s + byTier[t].length, 0), [byTier]);

  const moveItem = async (id: string, from: Tier, to: Tier) => {
    if (!unlocked) return;
    if (from === to) return;
    const item = byTier[from].find((x) => x.id === id);
    if (!item) return;

    setByTier((prev) => {
      const next = { ...prev, [from]: prev[from].filter((x) => x.id !== id) };
      next[to] = [...next[to], { ...item, tier: to }].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
      return next;
    });

    try {
      await saveRanking(domain, item.entityId, to);
    } catch (e: any) {
      // 回滚
      setByTier((prev) => {
        const next = { ...prev, [to]: prev[to].filter((x) => x.id !== id) };
        next[from] = [...next[from], { ...item, tier: from }].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
        return next;
      });
      setError(`保存失败：${e.message}`);
    }
  };

  const exportPng = async () => {
    if (!boardRef.current || exporting) return;
    setError(null);
    setExporting(true);
    setExportProgress(0);
    setExportStage('准备封面…');
    const board = boardRef.current;
    const download = (dataUrl: string, suffix = '') => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `从夯到拉-${domain}-${new Date().toLocaleDateString('zh-CN')}${suffix}.png`;
      a.click();
    };
    const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

    // 把封面转成 dataURL 内联，避免 canvas 跨域污染导致导出失败
    const fetchToDataUrl = async (url: string): Promise<string> => {
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) throw new Error('http ' + resp.status);
      const blob = await resp.blob();
      if (!blob.type.startsWith('image/')) throw new Error('not image: ' + blob.type);
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error || new Error('read failed'));
        r.readAsDataURL(blob);
      });
    };

    const imgs = Array.from(board.querySelectorAll('img')) as HTMLImageElement[];
    const backup = imgs.map((img) => ({ el: img, src: img.src, display: img.style.display }));
    let failed = false;
    try {
      const total = imgs.length;
      if (total === 0) {
        setExportStage('渲染图片…');
        setExportProgress(85);
      } else {
        let done = 0;
        await Promise.all(imgs.map(async (img) => {
          const src = img.src;
          let du: string | null = null;
          // 先直连（网易云等自带 CORS），失败再走代理（番剧/自定义封面无 CORS）
          for (const cand of [src, proxyCoverUrl(src)]) {
            try {
              du = await fetchToDataUrl(cand);
              break;
            } catch {
              /* 试下一个 */
            }
          }
          if (du) img.src = du;
          else img.style.display = 'none';
          done++;
          setExportProgress(Math.round((done / total) * 85));
        }));
      }
      setExportStage('生成图片…');
      setExportProgress(92);
      const dataUrl = await htmlToImage.toPng(board, {
        pixelRatio: 2,
        backgroundColor: C.bg,
        skipFonts: true,
        cacheBust: false,
      });
      setExportProgress(100);
      setExportStage('完成');
      download(dataUrl);
    } catch (e) {
      failed = true;
      setError(`导出失败：${errText(e)}`);
    } finally {
      backup.forEach(({ el, src, display }) => {
        el.src = src;
        el.style.display = display;
      });
      // 成功后稍停一下让用户看到 100%，再收起进度
      if (!failed) {
        setTimeout(() => { setExporting(false); setExportProgress(0); setExportStage(''); }, 500);
      } else {
        setExporting(false);
        setExportProgress(0);
        setExportStage('');
      }
    }
  };

  if (loading) {
    return (
      <div style={pageStyle}>
        <p style={{ color: C.textSec, textAlign: 'center', padding: 80 }}>加载中...</p>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href={backHref} style={backLinkStyle}>← 返回</Link>
        <h1 style={h1Style}>{icon} {title}</h1>
        <span style={countBadgeStyle}>{total}</span>
        {headerExtra}
      </header>

      {error && (
        <div style={{ background: '#1e0a0a', border: '1px solid #7f1d1d', borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>⚠️ {error}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 搜索项目..."
          style={{ ...searchInputStyle, marginBottom: 0, flex: 1, minWidth: 220 }}
        />
        <button onClick={exportPng} disabled={exporting} style={{
          padding: '10px 18px', borderRadius: 10, border: '1px solid #27273d',
          background: C.surface, color: C.accentLt, fontSize: 13, cursor: exporting ? 'default' : 'pointer',
          fontWeight: 600, opacity: exporting ? 0.6 : 1, flexShrink: 0,
        }}>
          {exporting ? '⏳ 导出中…' : '📷 导出 PNG'}
        </button>
        {exporting && (
          <div style={{ flex: '1 1 200px', minWidth: 160 }}>
            <div style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>
              {exportStage} {exportProgress}%
            </div>
            <div style={{ height: 6, background: C.border, borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${exportProgress}%`,
                background: C.accentLt, borderRadius: 99, transition: 'width 0.2s ease',
              }} />
            </div>
          </div>
        )}
      </div>

      <div ref={boardRef} style={{ background: C.bg, padding: 12, borderRadius: 16, border: `1px solid ${C.border}` }}>
        {TIERS.map((tier) => (
          <TierRow
            key={tier}
            tier={tier}
            items={filteredByTier[tier]}
            unlocked={unlocked}
            isDragging={!!draggingId}
            onDragStart={(item) => { setDraggingId(item.id); setDragSource(item.tier); }}
            onDragEnd={() => { setDraggingId(null); setDragSource(null); }}
            onDrop={(id) => { if (dragSource) moveItem(id, dragSource, tier); }}
            onOpenDetail={setDetailItem}
          />
        ))}
        {total === 0 && <p style={emptyStyle}>暂无数据</p>}
      </div>

      {detailItem && (
        <DetailModal
          item={detailItem}
          domain={domain}
          refs={refsMap[detailItem.id]}
          singCount={singCounts[detailItem.id] || 0}
          eatCount={eatCounts[detailItem.id] || 0}
          onClose={() => setDetailItem(null)}
        />
      )}
    </div>
  );
}

function TierRow({
  tier,
  items,
  unlocked,
  isDragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onOpenDetail,
}: {
  tier: Tier;
  items: RankItem[];
  unlocked: boolean;
  isDragging: boolean;
  onDragStart: (item: RankItem) => void;
  onDragEnd: () => void;
  onDrop: (id: string) => void;
  onOpenDetail: (item: RankItem) => void;
}) {
  const [over, setOver] = useState(false);

  const isLast = tier === '拉完了';

  return (
    <div style={{
      display: 'flex',
      borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
      padding: '10px 0',
      gap: 10,
    }}>
      <div style={{
        width: 48,
        flexShrink: 0,
        alignSelf: 'stretch',
        minHeight: 120,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: TIER_COLORS[tier],
        color: TIER_TEXT[tier],
        fontSize: 20,
        fontWeight: 900,
        borderRadius: 10,
        textShadow: TIER_TEXT[tier] === '#ffffff' ? '0 1px 3px rgba(0,0,0,0.35)' : 'none',
        writingMode: 'vertical-rl',
        textOrientation: 'upright',
        letterSpacing: 2,
        userSelect: 'none',
      }}>
        {tier}
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const id = e.dataTransfer.getData('text/plain');
          if (id) onDrop(id);
        }}
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
          alignItems: 'start',
          gap: 10,
          background: over ? 'rgba(99,102,241,0.08)' : 'transparent',
          transition: 'background 0.15s',
          borderRadius: 10,
          minHeight: 120,
          padding: 4,
        }}
      >
        {items.length === 0 && !isDragging && (
          <span style={{ color: C.textDead, fontSize: 12, alignSelf: 'center' }}>拖拽项目到这里</span>
        )}
        {items.map((item) => (
          <PosterCard
            key={item.id}
            item={item}
            unlocked={unlocked}
            onDragStart={() => onDragStart(item)}
            onDragEnd={onDragEnd}
            onClick={() => onOpenDetail(item)}
          />
        ))}
      </div>
    </div>
  );
}

function PosterCard({
  item,
  unlocked,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  item: RankItem;
  unlocked: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  return (
    <div
      draggable={unlocked}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      title={item.title}
      style={{
        position: 'relative',
        borderRadius: 10,
        overflow: 'hidden',
        background: C.border,
        cursor: unlocked ? 'grab' : 'pointer',
        border: `1px solid ${C.borderLit}`,
        boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
      }}
    >
      {item.coverUrl ? (
        <img
          src={item.coverUrl}
          alt=""
          draggable={false}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      ) : (
        <div style={{
          width: '100%', aspectRatio: '1 / 1',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.textSec, fontSize: 22, fontWeight: 800,
          padding: 8, textAlign: 'center',
        }}>
          {item.title.slice(0, 2)}
        </div>
      )}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: '18px 6px 6px',
        pointerEvents: 'none',
        background: 'linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0.4) 55%, transparent)',
      }}>
        <span style={{
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          overflow: 'hidden',
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.35,
          textShadow: '0 1px 2px rgba(0,0,0,0.5)',
        }}>
          {item.title}
        </span>
      </div>
    </div>
  );
}

function DetailModal({ item, domain, refs, singCount, eatCount, onClose }: {
  item: RankItem;
  domain: Domain;
  refs?: { anime: string[]; music: { id: string; title: string }[]; games: { id: string; title: string }[] };
  singCount: number;
  eatCount: number;
  onClose: () => void;
}) {
  const tierColor = TIER_COLORS[item.tier];
  const tierText = TIER_TEXT[item.tier];
  const src: any = item.source || {};
  const tags = item.tags || [];
  const firstTag = tags[0];

  const isAnime = domain === 'anime';
  const isGame = domain === 'game';
  const isMusic = domain === 'music_sing' || domain === 'music_like';
  const isMeal = domain === 'meal';

  const coverSize = isGame ? { w: 230, h: 107 }
    : isMusic ? { w: 160, h: 160 }
    : isAnime ? { w: 180, h: 240 }
    : null;

  const STATUS_COLORS: Record<string, string> = { '看完': '#4ade80', '正在看': '#60a5fa', '中道崩殂': '#f87171', '未知': '#71717a' };
  const STATUS_LABELS: Record<string, string> = { '看完': '看完', '正在看': '在追', '中道崩殂': '弃了', '未知': '?' };
  const RATING_COLORS: Record<string, string> = { '夯': '#a855f7', '顶级': '#4ade80', '人上人': '#eab308', 'NPC': '#6b7280', '拉完了': '#f87171' };
  const RATING_LABELS = ['', '拉完了', 'NPC', '人上人', '顶级', '夯'];

  const fmtPlaytime = (min: number) => {
    if (!min) return '';
    if (min < 60) return `${min}分钟`;
    const h = Math.floor(min / 60); const m = min % 60;
    return m > 0 ? `${h}.${Math.round(m / 6)}h` : `${h}h`;
  };
  const fmtDur = (sec: number | null) => {
    if (!sec) return '';
    const m = Math.floor(sec / 60); const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  const artistStr = src.artist
    ? (Array.isArray(src.artist) ? src.artist.join(' / ') : src.artist)
    : '';

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <button style={modalCloseStyle} onClick={onClose}>✕</button>

        <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
          {coverSize && (
            item.coverUrl ? (
              <div style={{ width: coverSize.w, height: coverSize.h, borderRadius: 14, overflow: 'hidden', background: C.border, flexShrink: 0 }}>
                <img src={item.coverUrl} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
              </div>
            ) : (
              <div style={{ ...modalCoverPlaceholderStyle(coverSize.w), height: coverSize.h }}>
                <span>{item.title.slice(0, 2)}</span>
              </div>
            )
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 0 10px' }}>{item.title}</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ ...badgeStyle(tierColor), color: tierText, fontWeight: 700, fontSize: 13 }}>{item.tier}</span>

              {isAnime && src.status && (
                <span style={{ ...badgeStyle(STATUS_COLORS[src.status] || C.textDim), fontSize: 13 }}>
                  {(STATUS_LABELS as Record<string, string>)[src.status] || src.status}
                </span>
              )}
              {isAnime && src.rating && (
                <span style={{ ...badgeStyle(RATING_COLORS[src.rating] || C.textDim), fontSize: 13, fontWeight: 700 }}>{src.rating}</span>
              )}
              {isGame && firstTag?.rating && (
                <span style={{ ...badgeStyle(RATING_COLORS[firstTag.rating] || '#71717a'), fontSize: 13, fontWeight: 700 }}>{firstTag.rating}</span>
              )}
              {isMeal && src.rating && (
                <span style={{ ...badgeStyle(RATING_COLORS[src.rating] || C.textDim), fontSize: 13, fontWeight: 700 }}>{src.rating}</span>
              )}

              {isGame && src.playtime_forever > 0 && (
                <span style={{ fontSize: 12, color: '#a1a1aa', padding: '3px 9px', borderRadius: 6, background: '#16162a', border: '1px solid #27273d' }}>🕐 {fmtPlaytime(src.playtime_forever)}</span>
              )}
              {isGame && src.playtime_2weeks > 0 && (
                <span style={{ fontSize: 12, color: '#a1a1aa', padding: '3px 9px', borderRadius: 6, background: '#16162a', border: '1px solid #27273d' }}>近两周 {fmtPlaytime(src.playtime_2weeks)}</span>
              )}
              {isMusic && src.duration && (
                <span style={{ fontSize: 12, color: '#a1a1aa', padding: '3px 9px', borderRadius: 6, background: '#16162a', border: '1px solid #27273d' }}>{fmtDur(src.duration)}</span>
              )}
              {isMusic && singCount > 0 && (
                <span style={{ fontSize: 12, color: '#fbbf24', padding: '3px 9px', borderRadius: 6, background: 'rgba(245,158,11,0.1)' }}>🎤 唱了 {singCount} 次</span>
              )}
              {isMeal && eatCount > 0 && (
                <span style={{ fontSize: 12, color: '#fbbf24', padding: '3px 9px', borderRadius: 6, background: 'rgba(245,158,11,0.1)' }}>🍴 吃了 {eatCount} 次</span>
              )}
            </div>

            {isMusic && (artistStr || src.album || src.netease_id) && (
              <div style={{ display: 'flex', gap: 12, fontSize: 13, color: C.textSec, flexWrap: 'wrap', alignItems: 'center' }}>
                {artistStr && <span>{artistStr}</span>}
                {src.album && <span>· {src.album}</span>}
                {src.netease_id && (
                  <a href={`https://music.163.com/#/song?id=${src.netease_id}`} target="_blank" style={{ color: C.accentLt, textDecoration: 'none' }}>🔗 网易云链接</a>
                )}
              </div>
            )}
            {isGame && (src.store_url || (!src.is_manual && src.steam_app_id > 0)) && (
              <a href={src.store_url || `https://store.steampowered.com/app/${src.steam_app_id}`} target="_blank"
                style={{ fontSize: 12, color: C.accentLt, textDecoration: 'none' }}>
                🔗 {src.store_url ? '商店页面' : 'Steam 商店页面'}
              </a>
            )}
            {isAnime && src.premiereDate && (
              <div style={{ marginTop: 6 }}><span style={{ padding: '4px 10px', borderRadius: 20, background: C.border, fontSize: 12, color: '#fbbf24' }}>📅 {src.premiereDate}</span></div>
            )}
            {isAnime && src.source && (
              <div style={{ marginTop: 6 }}><a href={src.source} target="_blank" style={{ color: C.accentLt, textDecoration: 'none', fontSize: 13 }}>🔗 来源链接</a></div>
            )}
          </div>
        </div>

        {/* 关联内容（与列表页详情卡一致） */}
        {refs && ((refs.anime.length > 0) || (refs.music.length > 0) || (refs.games.length > 0)) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 12 }}>
            {refs.anime.map((a) => (
              <a key={a} href={`/anime?search=${encodeURIComponent(a)}`} target="_blank" style={{ textDecoration: 'none' }} rel="noreferrer">
                <span style={{ fontSize: 11, color: '#c084fc', padding: '3px 8px', borderRadius: 6, background: 'rgba(168,85,247,0.1)', cursor: 'pointer' }}>📺 {a}</span>
              </a>
            ))}
            {refs.music.map((m) => (
              <a key={m.id} href={`/music?search=${encodeURIComponent(m.title)}`} target="_blank" style={{ textDecoration: 'none' }} rel="noreferrer">
                <span style={{ fontSize: 11, color: '#60a5fa', padding: '3px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.1)', cursor: 'pointer' }}>🎵 {m.title}</span>
              </a>
            ))}
            {refs.games.map((g) => (
              <a key={g.id} href="/games" target="_blank" style={{ textDecoration: 'none' }} rel="noreferrer">
                <span style={{ fontSize: 11, color: '#4ade80', padding: '3px 8px', borderRadius: 6, background: 'rgba(74,222,128,0.1)', cursor: 'pointer' }}>🎮 {g.title}</span>
              </a>
            ))}
          </div>
        )}

        {/* 音乐：喜欢度 / 能唱度评分条 */}
        {isMusic && firstTag && (firstTag.likability || firstTag.singability) && (
          <div style={{ display: 'flex', gap: 24, marginBottom: 14 }}>
            {firstTag.likability ? (
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12, color: C.textSec }}>♥ 喜欢度</span>
                <div style={{ height: 8, background: C.border, borderRadius: 5, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: '#ef4444', borderRadius: 5, width: `${(firstTag.likability || 0) * 20}%` }} />
                </div>
                <span style={{ fontSize: 11, color: C.textDim }}>{RATING_LABELS[firstTag.likability]}</span>
              </div>
            ) : null}
            {firstTag.singability ? (
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12, color: C.textSec }}>🎤 能唱度</span>
                <div style={{ height: 8, background: C.border, borderRadius: 5, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: C.accentLt, borderRadius: 5, width: `${(firstTag.singability || 0) * 20}%` }} />
                </div>
                <span style={{ fontSize: 11, color: C.textDim }}>{RATING_LABELS[firstTag.singability]}</span>
              </div>
            ) : null}
          </div>
        )}
        {isMusic && firstTag?.voice && (
          <div style={{ marginBottom: 12, fontSize: 13, color: C.textSec }}>
            声线：{firstTag.voice === 'male' ? '♂ 男声' : firstTag.voice === 'female' ? '♀ 女声' : '♪ 男女'}
          </div>
        )}

        {/* 标签 */}
        {tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {tags.map((t, i) => (
              <span key={i} style={{ padding: '5px 14px', borderRadius: 20, background: C.border, fontSize: 12, color: C.textSec }}>{t.tag}</span>
            ))}
          </div>
        )}

        {/* 番剧正文 */}
        {isAnime && src.body && (
          <div style={{ background: C.surface, borderRadius: 10, padding: 14, maxHeight: 280, overflowY: 'auto', marginBottom: 12 }}>
            <p style={{ fontSize: 13, color: C.textSec, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{src.body}</p>
          </div>
        )}

        {/* 笔记（game / music / meal） */}
        {firstTag?.note && (
          <div style={{ background: '#16162a', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <p style={{ fontSize: 11, color: C.textDim, margin: '0 0 4px' }}>笔记</p>
            <p style={{ fontSize: 13, color: C.text, margin: 0, lineHeight: 1.6 }}>{firstTag.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}
