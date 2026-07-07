'use client';

import { useEffect, useState, useMemo } from 'react';
import type { AnimeItem as AnimeItemType } from '@/lib/anime-data';
import {
  C, pageStyle, cardGridStyle, cardStyle, cardBgStyle, cardOverlayStyle,
  cardContentStyle, cardTitleStyle, cardArtistStyle, tagChipStyle, tagMoreStyle, emptyStyle,
  headerStyle, backLinkStyle, h1Style, countBadgeStyle,
  controlsStyle, filterRowStyle, filterLabelStyle,
  filterTabsStyle, filterTabStyle, filterTabActiveStyle, statsRowStyle,
  searchInputStyle, modalOverlayStyle, modalStyle, modalCloseStyle,
  modalCoverPlaceholderStyle,
  badgeStyle,
} from '@/lib/card-styles';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { PageLoading } from '@/components/shared';

import { getAnimeList, getAnimeCovers, getAnimeQuartzLink, clearAnimeCache } from '@/lib/anime-data';
import AnalysisPanel from '@/components/anime/AnalysisPanel';

const STATUS_ORDER: Record<string, number> = { '看完': 0, '正在看': 1, '中道崩殂': 2, '未知': 3 };
const STATUS_LABELS: Record<string, string> = { '看完': '看完', '正在看': '在追', '中道崩殂': '弃了', '未知': '?' };
const STATUS_COLORS: Record<string, string> = { '看完': '#4ade80', '正在看': '#60a5fa', '中道崩殂': '#f87171', '未知': '#71717a' };
const RATING_ORDER: Record<string, number> = { '夯': 0, '顶级': 1, '人上人': 2, 'NPC': 3, '拉完了': 4 };
const RATING_COLORS: Record<string, string> = { '夯': '#a855f7', '顶级': '#4ade80', '人上人': '#eab308', 'NPC': '#6b7280', '拉完了': '#f87171' };

export default function AnimePage() {
  const [animeList, setAnimeList] = useState<AnimeItemType[]>([]);
  const [coverMap, setCoverMap] = useState<Record<string, string>>({});
  const [search, setSearch] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('search') || '';
    }
    return '';
  });
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [ratingFilter, setRatingFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('rating');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [detailAnime, setDetailAnime] = useState<AnimeItemType | null>(null);
  const [animeRefs, setAnimeRefs] = useState<Record<string, {music:{id:string;title:string}[],games:{id:string;title:string}[]}>>({});

  useEffect(() => { fetchAnime(); }, []);

  // Auto-open detail when arriving with search param
  useEffect(() => {
    if (!animeList.length) return;
    const q = new URLSearchParams(window.location.search).get('search');
    if (!q) return;
    const match = animeList.find(a => a.title.toLowerCase().includes(q.toLowerCase()));
    if (match) {
      setDetailAnime(match);
      setSearch(q); // pre-fill search box
    }
  }, [animeList]);

  const fetchAnime = async () => {
    let list: AnimeItemType[] = [];
    try {
      list = await getAnimeList();
      setAnimeList(list);
    } catch (e: any) {
      console.error('Failed to load anime list:', e);
    }
    setLoading(false);

    try {
      const covers = await getAnimeCovers();
      setCoverMap(covers);
    } catch {}
    // Load entity refs
    try {
      const {data: refs} = await supabase.from('entity_refs').select('*').eq('target_type','anime');
      if (refs) {
        const rm: Record<string, {music:{id:string;title:string}[],games:{id:string;title:string}[]}> = {};
        const musicIds = new Set<string>();
        const gameIds = new Set<string>();
        // Build a case-insensitive lookup: lowercased title -> actual title
        const titleLookup: Record<string, string> = {};
        for (const a of list) titleLookup[a.title.toLowerCase()] = a.title;

        for (const r of refs) {
          const actualTitle = titleLookup[r.target_id.toLowerCase()] || r.target_id;
          if (!rm[actualTitle]) rm[actualTitle] = {music:[],games:[]};
          if (r.source_type === 'music') { rm[actualTitle].music.push({id:r.source_id,title:r.source_id}); musicIds.add(r.source_id); }
          else if (r.source_type === 'game') { rm[actualTitle].games.push({id:r.source_id,title:r.source_id}); gameIds.add(r.source_id); }
        }
        if (musicIds.size > 0) {
          const {data: ml} = await supabase.from('music_list').select('id,title').in('id', [...musicIds]);
          if (ml) for (const r of Object.values(rm)) r.music = r.music.map(m => ({id:m.id, title: ml.find(mm => mm.id===m.id)?.title || m.title}));
        }
        if (gameIds.size > 0) {
          const {data: gl} = await supabase.from('steam_games').select('id,title').in('id', [...gameIds]);
          if (gl) for (const r of Object.values(rm)) r.games = r.games.map(g => ({id:g.id, title: gl.find(gg => gg.id===g.id)?.title || g.title}));
        }
        setAnimeRefs(rm);
      }
    } catch {}
  };

  const refreshAnime = async () => {
    setRefreshing(true);
    clearAnimeCache();
    await fetchAnime();
    setRefreshing(false);
  };

  const allTags = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of animeList) {
      for (const t of a.tags) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));
  }, [animeList]);

  const sorted = [...animeList].sort((a, b) => {
    if (sortBy === 'rating') {
      const ra = RATING_ORDER[a.rating || ''] ?? 99;
      const rb = RATING_ORDER[b.rating || ''] ?? 99;
      if (ra !== rb) return ra - rb;
    }
    if (sortBy === 'status') {
      const sa = STATUS_ORDER[a.status] ?? 4;
      const sb = STATUS_ORDER[b.status] ?? 4;
      if (sa !== sb) return sa - sb;
    }
    if (sortBy === 'title') return a.title.localeCompare(b.title);
    if (sortBy === 'tags') return (b.tags?.length || 0) - (a.tags?.length || 0);
    if (sortBy === 'date') {
      if (a.premiereDate && b.premiereDate) return a.premiereDate.localeCompare(b.premiereDate);
      if (a.premiereDate) return -1;
      if (b.premiereDate) return 1;
      return 0;
    }
    return 0;
  });

  const filtered = sorted.filter(a => {
    if (statusFilter && a.status !== statusFilter) return false;
    if (ratingFilter && a.rating !== ratingFilter) return false;
    if (tagFilter && !(a.tags || []).includes(tagFilter)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return a.title.toLowerCase().includes(q) || (a.tags || []).some(t => t.toLowerCase().includes(q));
    }
    return true;
  });

  /* unique status & rating values for filter pills */
  const statuses = [...new Set(animeList.map(a => a.status))];
  const ratings  = [...new Set(animeList.map(a => a.rating).filter((r): r is string => !!r))]
    .sort((a, b) => (RATING_ORDER[a] ?? 99) - (RATING_ORDER[b] ?? 99));

  /* rating stats */
  const ratingStats = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of animeList) { if (a.rating) map[a.rating] = (map[a.rating] || 0) + 1; }
    return Object.entries(map).sort((a, b) => (RATING_ORDER[a[0]] ?? 99) - (RATING_ORDER[b[0]] ?? 99));
  }, [animeList]);

  if (loading) {
    return <PageLoading text="加载番剧..." />;
  }

  /* detail modal helpers */
  const detailCover = detailAnime ? coverMap[detailAnime.title] : null;
  const quartzLink = detailAnime ? getAnimeQuartzLink(detailAnime) : null;

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={backLinkStyle}>← 首页</Link>
        <h1 style={h1Style}>📺 番剧列表</h1>
        <span style={countBadgeStyle}>{animeList.length} 部</span>
        <button onClick={refreshAnime} disabled={refreshing} style={{
          padding: '4px 14px', borderRadius: 20, border: '1px solid #27273d',
          background: '#16162a', color: '#818cf8', fontSize: 13, cursor: refreshing ? 'not-allowed' : 'pointer',
          opacity: refreshing ? 0.6 : 1,
        }} title="清除缓存并重新拉取">
          {refreshing ? '刷新中...' : '🔄 刷新'}
        </button>
        <button onClick={() => setShowAnalysis(true)} style={{
          padding: '4px 14px', borderRadius: 20, border: '1px solid #27273d',
          background: '#16162a', color: '#f59e0b', fontSize: 13, cursor: 'pointer',
        }}>
          📊 分析
        </button>
      </header>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {ratingStats.map(([rating, count]) => {
          const pct = Math.round(count / animeList.length * 100);
          const color = RATING_COLORS[rating] || C.textDim;
          return (
            <div key={rating} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <div style={{ width: 3, height: 14, borderRadius: 2, background: color }} />
              <span style={{ color }}>{rating}</span>
              <span style={{ color: C.textDim }}>{pct}% ({count})</span>
            </div>
          );
        })}
      </div>

      <section style={controlsStyle}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 搜索番剧或标签..." style={searchInputStyle} />

        <div style={filterRowStyle}>
          <span style={filterLabelStyle}>状态</span>
          <div style={filterTabsStyle}>
            <button onClick={() => setStatusFilter(null)}
              style={{ ...filterTabStyle, ...(statusFilter === null ? filterTabActiveStyle : {}) }}>全部</button>
            {statuses.map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                style={{ ...filterTabStyle, ...(statusFilter === s ? filterTabActiveStyle : {}) }}>
                {(STATUS_LABELS as Record<string, string>)[s] || s}
              </button>
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
                style={{ ...filterTabStyle, ...(ratingFilter === r ? filterTabActiveStyle : {}) }}>
                {r}
              </button>
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

        <div style={filterRowStyle}>
          <span style={filterLabelStyle}>排序</span>
          <div style={filterTabsStyle}>
            {[
              { value: 'rating', label: '评级优先' },
              { value: 'date',   label: '首播日期' },
              { value: 'status', label: '状态优先' },
              { value: 'title',  label: '标题 A→Z' },
              { value: 'tags',   label: '标签多→少' },
            ].map(opt => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                style={{ ...filterTabStyle, ...(sortBy === opt.value ? filterTabActiveStyle : {}) }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div style={statsRowStyle}>
          <span>共 {animeList.length} 部</span>
          {statusFilter && <span style={{ color: C.accentLt }}>状态: {statusFilter}</span>}
          {ratingFilter && <span style={{ color: C.accentLt }}>评级: {ratingFilter}</span>}
          {tagFilter && <span style={{ color: C.accentLt }}>标签: {tagFilter}</span>}
        </div>
      </section>

      <main style={cardGridStyle}>
        {filtered.map((a, i) => {
          const cover = coverMap[a.title];
          const statusColor = STATUS_COLORS[a.status] || C.textDim;
          const ratingColor = (a.rating && RATING_COLORS[a.rating]) ? RATING_COLORS[a.rating] : C.textDim;

          return (
            <article key={i} style={cardStyle} onClick={() => setDetailAnime(a)}>
              {cover && <div style={{ ...cardBgStyle(cover)}} />}
              <div style={{ ...cardOverlayStyle}} />
              <div style={cardContentStyle}>
                <p style={{ ...cardTitleStyle(false), margin: '0 0 4px' }}>{a.title}</p>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <span style={badgeStyle(statusColor)}>{(STATUS_LABELS as Record<string, string>)[a.status] || a.status}</span>
                  {a.rating && <span style={{ ...badgeStyle(ratingColor), fontWeight: 700 }}>{a.rating}</span>}
                </div>
                {a.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {a.tags.slice(0, 6).map(t => <span key={t} style={tagChipStyle}>{t}</span>)}
                    {a.tags.length > 6 && <span style={tagMoreStyle}>+{a.tags.length - 6}</span>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </main>

      {filtered.length === 0 && <p style={emptyStyle}>没有找到匹配的番剧</p>}

      {/* Detail Modal */}
      {detailAnime && (
        <div style={modalOverlayStyle} onClick={() => setDetailAnime(null)}>
          <div style={{ ...modalStyle, maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <button style={modalCloseStyle} onClick={() => setDetailAnime(null)}>✕</button>

            <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
              {detailCover ? (
                <div style={{ width: 180, height: 240, borderRadius: 14, overflow: 'hidden', background: C.border, flexShrink: 0 }}>
                  <img src={detailCover} alt={detailAnime.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
                </div>
              ) : (
                <div style={modalCoverPlaceholderStyle(180)}>
                  <span>{detailAnime.title.slice(0, 2)}</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ fontSize: 26, fontWeight: 800, color: '#fff', margin: '0 0 10px' }}>{detailAnime.title}</h2>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <span style={{ ...badgeStyle(STATUS_COLORS[detailAnime.status] || C.textDim), fontSize: 13 }}>
                    {(STATUS_LABELS as Record<string, string>)[detailAnime.status] || detailAnime.status}
                  </span>
                  {detailAnime.rating && (
                    <span style={{ ...badgeStyle(RATING_COLORS[detailAnime.rating] || C.textDim), fontSize: 13, fontWeight: 700 }}>
                      {detailAnime.rating}
                    </span>
                  )}
                  {detailAnime.premiereDate && (
                    <span style={{ padding: '4px 10px', borderRadius: 20, background: C.border, fontSize: 12, color: '#fbbf24' }}>
                      📅 {detailAnime.premiereDate}
                    </span>
                  )}
                </div>
                {detailAnime.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                    {detailAnime.tags.map(t => (
                      <span key={t} style={{ padding: '4px 12px', borderRadius: 20, background: C.border, fontSize: 12, color: C.textSec }}>{t}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                  {quartzLink && (
                    <a href={quartzLink} target="_blank" style={{ color: C.accentLt, textDecoration: 'none', fontSize: 13 }}>📂 在 Quartz 查看</a>
                  )}
                  {detailAnime.source && (
                    <a href={detailAnime.source} target="_blank" style={{ color: C.accentLt, textDecoration: 'none', fontSize: 13 }}>🔗 来源链接</a>
                  )}
                </div>
              </div>
            </div>

            {detailAnime.body && (
              <div style={{ background: C.surface, borderRadius: 10, padding: 14, maxHeight: 300, overflowY: 'auto' }}>
                <p style={{ fontSize: 13, color: C.textSec, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{detailAnime.body}</p>
              </div>
            )}

            {/* Entity refs */}
            {(() => {
              const refs = animeRefs[detailAnime.title];
              if (!refs || (!refs.music.length && !refs.games.length)) return null;
              return (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>🔗 关联内容</div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {refs.music.map(m => <a key={m.id} href={`/music?search=${encodeURIComponent(m.title)}`} target="_blank" style={{textDecoration:'none'}} rel="noreferrer"><span style={{fontSize:11,color:'#60a5fa',padding:'3px 8px',borderRadius:6,background:'rgba(59,130,246,0.1)',cursor:'pointer'}}>🎵 {m.title}</span></a>)}
                    {refs.games.map(g => <a key={g.id} href="/games" target="_blank" style={{textDecoration:'none'}} rel="noreferrer"><span style={{fontSize:11,color:'#4ade80',padding:'3px 8px',borderRadius:6,background:'rgba(74,222,128,0.1)',cursor:'pointer'}}>🎮 {g.title}</span></a>)}
                  </div>
                </div>
              );
            })()}
          </div>
        )
        </div>
      )}

      {/* Analysis Panel Overlay */}
      {showAnalysis && <AnalysisPanel items={animeList} onClose={() => setShowAnalysis(false)} onTagFilter={(tag) => { setTagFilter(tag); }} />}
    </div>
  );
}
