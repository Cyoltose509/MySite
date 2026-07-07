// @ts-ignore

'use client';

import {useEffect, useState, useMemo} from 'react';
import Link from 'next/link';
import {supabase} from '@/lib/supabase';
import AnalysisPanel from '@/components/games/AnalysisPanel';
import type { GameAnalysisItem } from '@/lib/game-analysis';
import {PageLoading} from '@/components/shared';
import {
    C,
    pageStyle,
    cardGridStyle,
    cardStyle,
    cardBgStyle,
    cardOverlayStyle,
    cardContentStyle,
    cardTitleStyle,
    cardArtistStyle,
    cardDurationStyle,
    badgeStyle,
    tagChipStyle,
    tagMoreStyle,
    emptyStyle,
    headerStyle,
    backLinkStyle,
    h1Style,
    countBadgeStyle,
    controlsStyle,
    filterRowStyle,
    filterLabelStyle,
    filterTabsStyle,
    filterTabStyle,
    filterTabActiveStyle,
    statsRowStyle,
    searchInputStyle,
    modalOverlayStyle,
    modalStyle,
    modalCloseStyle,
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
    metrics?: Record<string, string>;
}

interface GameTagData {
    id: string;
    tag: string;
    rating?: string;
    note?: string;
}

const RATING_ORDER: Record<string, number> = {'夯': 0, '顶级': 1, '人上人': 2, 'NPC': 3, '拉完了': 4};
const RATING_COLORS: Record<string, string> = {
    '夯': '#a855f7',
    '顶级': '#4ade80',
    '人上人': '#eab308',
    'NPC': '#6b7280',
    '拉完了': '#f87171'
};

export default function GamesPage() {
    const [games, setGames] = useState<GameRecord[]>([]);
    const [tagsMap, setTagsMap] = useState<Record<string, GameTagData[]>>({});
    const [search, setSearch] = useState('');
    const [ratingFilter, setRatingFilter] = useState<string | null>(null);
    const [tagFilter, setTagFilter] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState('rating');
    const [loading, setLoading] = useState(true);
    const [detailGame, setDetailGame] = useState<GameRecord | null>(null);
    const [showAnalysis, setShowAnalysis] = useState(false);
    const [refsMap, setRefsMap] = useState<Record<string, {anime:string[];music:{id:string;title:string}[]}>>({});

    useEffect(() => {
        fetchGames();
    }, []);

    const fetchGames = async () => {
        const {data} = await supabase.from('steam_games').select('*').order('playtime_forever', {ascending: false});
        setGames(data || []);

        const {data: tags} = await supabase.from('steam_tags').select('*');
        if (tags) {
            const map: Record<string, GameTagData[]> = {};
            tags.forEach((t: any) => {
                if (!map[t.game_id]) map[t.game_id] = [];
                map[t.game_id].push(t);
            });
            setTagsMap(map);
        }
        // Load entity refs (bidirectional)
        const {data: refsOut} = await supabase.from('entity_refs').select('*').eq('source_type','game');
        const {data: refsIn} = await supabase.from('entity_refs').select('*').eq('target_type','game');
        const refs = [...(refsOut||[]), ...(refsIn||[])];
        if (refs.length > 0) {
          const rm: Record<string, {anime:string[];music:{id:string;title:string}[]}> = {};
          for (const r of refs) {
            const gameId = r.source_type === 'game' ? r.source_id : r.target_id;
            const otherType = r.source_type === 'game' ? r.target_type : r.source_type;
            const otherId = r.source_type === 'game' ? r.target_id : r.source_id;
            if (!rm[gameId]) rm[gameId] = {anime:[],music:[]};
            if (otherType === 'anime') rm[gameId].anime.push(otherId);
            else if (otherType === 'music') rm[gameId].music.push({id:otherId,title:otherId});
          }
          // Resolve music titles
          const {data: music} = await supabase.from('music_list').select('id,title');
          if (music) {
            for (const [gid, ref] of Object.entries(rm)) {
              ref.music = ref.music.map(m => {
                const found = music.find(mm => mm.id === m.id);
                return found ? {id:m.id, title:found.title} : m;
              });
            }
          }
          setRefsMap(rm);
        }
        setLoading(false);
    };

    const allTags = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const ts of Object.values(tagsMap)) {
            for (const t of ts) counts[t.tag] = (counts[t.tag] || 0) + 1;
        }
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({tag, count}));
    }, [tagsMap]);

    const sorted = [...games].sort((a, b) => {
        const ra = tagsMap[a.id]?.[0];
        const rb = tagsMap[b.id]?.[0];
        if (sortBy === 'rating') {
            const diff = (RATING_ORDER[ra?.rating || ''] ?? 99) - (RATING_ORDER[rb?.rating || ''] ?? 99);
            if (diff !== 0) return diff;
        }
        return a.title.localeCompare(b.title);
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

    const metricLabel = (k: string) => {
        const m: Record<string, string> = {
            playtime: '🕐', achievements: '🏆', characters: '👤', clears: '🔄',
        };
        return m[k] || k;
    };
    const metricChip = (k?: string) => ({
        fontSize: 11, color: '#a1a1aa', padding: '2px 8px', borderRadius: 6,
        background: '#16162a', border: '1px solid #27273d', display: 'flex', alignItems: 'center', gap: 3,
    });

    const ratings = ['夯', '顶级', '人上人', 'NPC', '拉完了'];
    const taggedCount = Object.keys(tagsMap).length;

    const steamImg = (g: GameRecord) => {
        if (g.custom_cover) return g.custom_cover;
        if (g.is_manual) return ''; // non-Steam manual games have no Steam CDN cover
        return `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steam_app_id}/header.jpg`;
    };

    if (loading) return <PageLoading text="加载游戏库..."/>;

    const detailTags = detailGame ? (tagsMap[detailGame.id] || []) : [];

    // @ts-ignore
    return (
        <div style={pageStyle}>
            <header style={headerStyle}>
                <Link href="/" style={backLinkStyle}>← 首页</Link>
                <h1 style={h1Style}>🎮 游戏库</h1>
                <span style={countBadgeStyle}>{games.length} 款</span>
                <button onClick={() => setShowAnalysis(true)} style={{
                    padding: '4px 14px', borderRadius: 20, border: '1px solid #27273d',
                    background: '#16162a', color: '#f59e0b', fontSize: 13, cursor: 'pointer',
                }}>📊 分析</button>
            </header>

            <p style={{fontSize: 11, color: '#52525b', marginBottom: 12}}>数据来源：Steam + 自定义</p>

            <section style={controlsStyle}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜索游戏或标签..." style={searchInputStyle}/>

                <div style={filterRowStyle}>
                    <span style={filterLabelStyle}>排序</span>
                    <div style={filterTabsStyle}>
                        {[
                            {value: 'rating', label: '评级优先'},
                            {value: 'title', label: '标题 A→Z'},
                        ].map(o => (
                            <button key={o.value} onClick={() => setSortBy(o.value)}
                                    style={{...filterTabStyle, ...(sortBy === o.value ? filterTabActiveStyle : {})}}>{o.label}</button>
                        ))}
                    </div>
                </div>

                <div style={filterRowStyle}>
                    <span style={filterLabelStyle}>评级</span>
                    <div style={filterTabsStyle}>
                        <button onClick={() => setRatingFilter(null)}
                                style={{...filterTabStyle, ...(ratingFilter === null ? filterTabActiveStyle : {})}}>全部
                        </button>
                        {ratings.map(r => (
                            <button key={r} onClick={() => setRatingFilter(r)}
                                    style={{...filterTabStyle, ...(ratingFilter === r ? filterTabActiveStyle : {})}}>{r}</button>
                        ))}
                    </div>
                </div>

                {allTags.length > 0 && (
                    <div style={filterRowStyle}>
                        <span style={filterLabelStyle}>标签</span>
                        <div style={filterTabsStyle}>
                            <button onClick={() => setTagFilter(null)}
                                    style={{...filterTabStyle, ...(tagFilter === null ? filterTabActiveStyle : {})}}>全部
                            </button>
                            {allTags.map(({tag, count}) => (
                                <button key={tag} onClick={() => setTagFilter(tag)}
                                        style={{...filterTabStyle, ...(tagFilter === tag ? filterTabActiveStyle : {})}}>
                                    {tag} <span style={{fontSize: 10, color: C.textDim, marginLeft: 2}}>{count}</span>
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
                            {cover && <div style={cardBgStyle(cover)}/>}
                            <div style={cardOverlayStyle}/>
                            <div style={cardContentStyle}>
                                <p style={cardTitleStyle(!!firstTag)}>{g.title}</p>
                                <div style={{display: 'flex', gap: 4, marginBottom: 4}}>
                                    {firstTag?.rating && <span style={{
                                        ...badgeStyle(RATING_COLORS[firstTag.rating] || '#71717a'),
                                        fontWeight: 700
                                    }}>{firstTag.rating}</span>}
                                </div>
                                {g.playtime_forever > 0 && <p style={cardDurationStyle}>🕐 {fmtPlaytime(g.playtime_forever)}</p>}
                                {g.playtime_2weeks > 0 &&
                                    <p style={{fontSize: 10, color: '#52525b'}}>近两周 {fmtPlaytime(g.playtime_2weeks)}</p>}
                                {g.metrics && Object.keys(g.metrics).length > 0 && (
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                                        {Object.entries(g.metrics).slice(0, 3).map(([k, v]) => (
                                            <span key={k} style={{ fontSize: 9, color: '#52525b' }}>
                                                {metricLabel(k)} {v}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {tags.length > 0 && (
                                    <div style={{display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4}}>
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
                    <div style={{...modalStyle, maxWidth: 600}} onClick={e => e.stopPropagation()}>
                        <button style={modalCloseStyle} onClick={() => setDetailGame(null)}>✕</button>
                        <div style={{display: 'flex', gap: 16, marginBottom: 16}}>
                            {steamImg(detailGame) && (
                                <img src={steamImg(detailGame)} alt={detailGame.title}
                                     style={{width: 230, height: 107, borderRadius: 10, objectFit: 'cover', flexShrink: 0}}/>
                            )}
                            <div>
                                <h2 style={{fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 8px'}}>{detailGame.title}</h2>
                                <div style={{display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6}}>
                                    {detailTags[0]?.rating && <span style={{
                                        ...badgeStyle(RATING_COLORS[detailTags[0].rating]),
                                        fontSize: 13,
                                        fontWeight: 700
                                    }}>{detailTags[0].rating}</span>}
                                    {detailGame.playtime_forever > 0 && <span style={metricChip()}>🕐 {fmtPlaytime(detailGame.playtime_forever)}</span>}
                                    {detailGame.playtime_2weeks > 0 && <span style={metricChip()}>近两周 {fmtPlaytime(detailGame.playtime_2weeks)}</span>}
                                    {detailGame.metrics && Object.entries(detailGame.metrics)
                                      .filter(([k]) => k !== 'playtime')
                                      .map(([k, v]) => (
                                        <span key={k} style={metricChip()}>{metricLabel(k)} {v}</span>
                                    ))}
                                </div>
                                {(detailGame.store_url || (!detailGame.is_manual && detailGame.steam_app_id > 0)) && (
                                    <a href={detailGame.store_url || `https://store.steampowered.com/app/${detailGame.steam_app_id}`}
                                       target="_blank"
                                       style={{
                                           fontSize: 12,
                                           color: C.accentLt,
                                           textDecoration: 'none'
                                       }}>🔗 {detailGame.store_url ? '商店页面' : 'Steam 商店页面'}</a>
                                )}
                            </div>
                        </div>
                        {/* Entity refs */}
                        {(() => {
                          const refs = refsMap[detailGame.id];
                          if (!refs || (!refs.anime.length && !refs.music.length)) return null;
                          return (
                            <div style={{ display:'flex', gap:6, flexWrap:'wrap', padding:'6px 0', borderTop:'1px solid rgba(255,255,255,0.06)', marginBottom:8 }}>
                              {refs.anime.map(a => (
                                <a key={a} href={`/anime?search=${encodeURIComponent(a)}`} target="_blank" style={{textDecoration:'none'}} rel="noreferrer">
                                  <span style={{fontSize:11,color:'#c084fc',padding:'2px 8px',borderRadius:6,background:'rgba(168,85,247,0.1)',cursor:'pointer'}}>📺 {a}</span>
                                </a>
                              ))}
                              {refs.music.map(m => (
                                <a key={m.id} href={`/music?search=${encodeURIComponent(m.title)}`} target="_blank" style={{textDecoration:'none'}} rel="noreferrer">
                                  <span style={{fontSize:11,color:'#60a5fa',padding:'2px 8px',borderRadius:6,background:'rgba(59,130,246,0.1)',cursor:'pointer'}}>🎵 {m.title}</span>
                                </a>
                              ))}
                            </div>
                          );
                        })()}
                        {detailTags.length > 0 && (
                            <div style={{display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12}}>
                                {detailTags.map(t => <span key={t.id} style={{
                                    padding: '5px 12px',
                                    borderRadius: 20,
                                    background: C.border,
                                    fontSize: 12,
                                    color: C.textSec
                                }}>{t.tag}</span>)}
                            </div>
                        )}
                        {detailTags[0]?.note && (
                            <div style={{background: '#16162a', borderRadius: 10, padding: 12}}>
                                <p style={{fontSize: 11, color: '#52525b', margin: '0 0 4px'}}>笔记</p>
                                <p style={{fontSize: 13, color: C.text, margin: 0, lineHeight: 1.6}}>{detailTags[0].note}</p>
                            </div>
                        )}
                    </div>
                </div>

            )}

            {showAnalysis && (
              <AnalysisPanel
                items={games.map(g => ({
                  id: g.id,
                  title: g.title,
                  playtime_forever: g.playtime_forever,
                  playtime_2weeks: g.playtime_2weeks,
                  rating: (tagsMap[g.id] || [])[0]?.rating,
                  tags: (tagsMap[g.id] || []).map(t => t.tag),
                  note: (tagsMap[g.id] || [])[0]?.note,
                }))}
                onClose={() => setShowAnalysis(false)}
              />
            )}
        </div>
    );
}
