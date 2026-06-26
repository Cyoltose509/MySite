'use client';

import {useEffect, useState, useCallback} from 'react';
import Link from 'next/link';
import {getAnimeList, clearAnimeCache, getAnimeCover, getAnimeQuartzLink, type AnimeItem} from '@/lib/anime-data';

const STATUS_MAP: Record<string, { color: string; label: string }> = {
    '看完': {color: '#4ade80', label: '已看完'},
    '正在看': {color: '#60a5fa', label: '追番中'},
    '中道崩殂': {color: '#f87171', label: '弃坑'},
};

// Rating hierarchy: 夯(best) → 顶级 → 人上人 → NPC → 拉完了(worst)
const RATING_ORDER = ['夯', '顶级', '人上人', 'NPC', '拉完了'];
const RATING_COLORS: Record<string, string> = {
    '夯': '#818cf8',       // indigo - best
    '顶级': '#4ade80',     // green - great
    '人上人': '#fbbf24',   // gold - good
    'NPC': '#71717a',      // grey - mediocre
    '拉完了': '#f87171',   // red - worst
};

export default function AnimePage() {
    const [animeList, setAnimeList] = useState<AnimeItem[]>([]);
    const [coverMap, setCoverMap] = useState<Record<string, string>>({});  // title → cover URL
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterRating, setFilterRating] = useState('all');
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState('');
    const [search, setSearch] = useState('');
    const [detailAnime, setDetailAnime] = useState<AnimeItem | null>(null);
    const [detailCover, setDetailCover] = useState<string | null>(null);

    useEffect(() => {
        loadAnime();
    }, []);

    const loadAnime = async (force = false) => {
        setLoading(true);
        if (force) clearAnimeCache();
        try {
            const data = await getAnimeList((cur, total) => setProgress(`${cur}/${total}`));
            setAnimeList(data);
            fetchCoversInBackground(data);
        } catch (err) {
            console.error('Failed to load anime:', err);
        }
        setLoading(false);
    };

    const fetchCoversInBackground = async (items: AnimeItem[]) => {
        const newCovers: Record<string, string> = {};
        for (let i = 0; i < items.length; i += 10) {
            const batch = items.slice(i, i + 10);
            const results = await Promise.all(batch.map(a => getAnimeCover(a)));
            batch.forEach((a, idx) => {
                if (results[idx]) newCovers[a.title] = results[idx];
            });
            setCoverMap(prev => ({...prev, ...newCovers}));
        }
    };

    const filtered = animeList.filter((a) => {
        const matchStatus = filterStatus === 'all' || a.status === filterStatus;
        const matchRating = filterRating === 'all' || a.rating === filterRating;
        const matchSearch = !search || a.title.toLowerCase().includes(search.toLowerCase());
        return matchStatus && matchRating && matchSearch;
    });

    // Sort: rating order first, then status order
    const ratingSort: Record<string, number> = {};
    RATING_ORDER.forEach((r, i) => ratingSort[r] = i);
    const statusOrder: Record<string, number> = {'正在看': 0, '看完': 1, '中道崩殂': 2, '未知': 3};
    filtered.sort((a, b) => {
        const ra = ratingSort[a.rating || ''] ?? 99;
        const rb = ratingSort[b.rating || ''] ?? 99;
        if (ra !== rb) return ra - rb;
        return (statusOrder[a.status || ''] ?? 4) - (statusOrder[b.status || ''] ?? 4);
    });

    const statusCounts = animeList.reduce((acc, a) => {
        acc[a.status] = (acc[a.status] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const ratingCounts = animeList.reduce((acc, a) => {
        if (a.rating) acc[a.rating] = (acc[a.rating] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const total = animeList.length;

    const handleDetail = useCallback(async (anime: AnimeItem) => {
        setDetailAnime(anime);
        const cover = await getAnimeCover(anime);
        setDetailCover(cover);
    }, []);

    if (loading) {
        return (
            <div style={S.loading}>
                <div style={S.spinner}/>
                <p style={S.loadingText}>从 GitHub 加载番剧数据...</p>
                {progress && <p style={S.progressText}>{progress}</p>}
            </div>
        );
    }

    const quartzLink = detailAnime ? getAnimeQuartzLink(detailAnime) : null;

    return (
        <div style={S.page}>
            <header style={S.header}>
                <Link href="/" style={S.backLink}>← 首页</Link>
                <h1 style={S.h1}>🎬 番剧大全</h1>
                <span style={S.countBadge}>{total} 部</span>
            </header>

            {/* Rating distribution stats */}
            <section style={S.summaryBar}>
                {RATING_ORDER.map(r => {
                    const count = ratingCounts[r] || 0;
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                        <div key={r} style={{...S.statItem, borderLeft: `3px solid ${RATING_COLORS[r]}`, paddingLeft: 10}}>
                            <p style={{...S.statNum, color: RATING_COLORS[r]}}>{pct}%</p>
                            <p style={S.statLabel}>{r} ({count})</p>
                        </div>
                    );
                })}
                <button onClick={() => loadAnime(true)} style={S.refreshBtn}>🔄</button>
            </section>

            {/* Search */}
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="搜索番剧..." style={S.search}/>

            {/* Filter: Status */}
            <div style={S.filterRow}>
                <span style={S.filterLabel}>状态</span>
                <div style={S.filterTabs}>
                    <button onClick={() => setFilterStatus('all')}
                            style={{...S.filterTab, ...(filterStatus === 'all' ? S.filterTabActive : {})}}>
                        全部 ({total})
                    </button>
                    {Object.entries(STATUS_MAP).map(([k, v]) => (
                        <button key={k} onClick={() => setFilterStatus(k)}
                                style={{
                                    ...S.filterTab, borderColor: v.color, ...(filterStatus === k ? {
                                        ...S.filterTabActive,
                                        color: v.color
                                    } : {})
                                }}>
                            {v.label} ({statusCounts[k] || 0})
                        </button>
                    ))}
                </div>
            </div>

            {/* Filter: Rating */}
            <div style={S.filterRow}>
                <span style={S.filterLabel}>评级</span>
                <div style={S.filterTabs}>
                    <button onClick={() => setFilterRating('all')}
                            style={{...S.filterTab, ...(filterRating === 'all' ? S.filterTabActive : {})}}>
                        全部
                    </button>
                    {RATING_ORDER.map(r => (
                        <button key={r} onClick={() => setFilterRating(r)}
                                style={{
                                    ...S.filterTab, borderColor: RATING_COLORS[r], ...(filterRating === r ? {
                                        ...S.filterTabActive,
                                        color: RATING_COLORS[r]
                                    } : {})
                                }}>
                            {r} ({ratingCounts[r] || 0})
                        </button>
                    ))}
                </div>
            </div>

            {/* Cards — 5-column grid, flat cards with cover bg + tags */}
            <main style={S.grid}>
                {filtered.map((a, i) => {
                    const info = STATUS_MAP[a.status] || {color: '#71717a', label: a.status};
                    const cover = coverMap[a.title];
                    const ratingColor = RATING_COLORS[a.rating || ''] || '#71717a';

                    return (
                        <article key={i} style={S.card} onClick={() => handleDetail(a)}>
                            {cover && (
                                <div style={{...S.cardBg, backgroundImage: `url(${cover})`}}/>
                            )}
                            <div style={S.cardOverlay}/>
                            <div style={S.cardContent}>
                                <p style={S.cardTitle}>{a.title}</p>
                                <div style={S.cardBadges}>
                  <span style={{...S.badge, background: `${info.color}22`, color: info.color}}>
                    {info.label}
                  </span>
                                    {a.rating && (
                                        <span style={{...S.badge, background: `${ratingColor}22`, color: ratingColor, fontWeight: 700}}>
                      {a.rating}
                    </span>
                                    )}
                                </div>
                                {a.tags.length > 0 && (
                                    <div style={S.cardTags}>
                                        {a.tags.slice(0, 3).map(t => (
                                            <span key={t} style={S.cardTagChip}>{t}</span>
                                        ))}
                                        {a.tags.length > 3 && (
                                            <span style={S.cardTagChip}>+{a.tags.length - 3}</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </article>
                    );
                })}
            </main>

            {filtered.length === 0 && <p style={S.empty}>暂无数据</p>}

            {/* Detail Modal */}
            {detailAnime && (
                <div style={S.modalOverlay} onClick={() => {
                    setDetailAnime(null);
                    setDetailCover(null);
                }}>
                    <div style={S.modal} onClick={(e) => e.stopPropagation()}>
                        <button style={S.modalClose} onClick={() => {
                            setDetailAnime(null);
                            setDetailCover(null);
                        }}>✕
                        </button>

                        {/* Cover + Title row */}
                        <div style={S.modalHeaderRow}>
                            {detailCover ? (
                                <div style={S.modalCoverWrap}>
                                    <img src={detailCover} alt={detailAnime.title} style={S.modalCoverImg}
                                         onError={(e) => {
                                             (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                                         }}/>
                                </div>
                            ) : (
                                <div style={S.modalCoverPlaceholder}>
                                    <span>{detailAnime.title.slice(0, 2)}</span>
                                </div>
                            )}
                            <div style={{flex: 1, minWidth: 0}}>
                                <h2 style={S.modalTitle}>{detailAnime.title}</h2>
                                <div style={S.modalBadges}>
                                    {(() => {
                                        const info = STATUS_MAP[detailAnime.status] || {color: '#71717a', label: detailAnime.status};
                                        return <span style={{
                                            ...S.modalBadge,
                                            background: `${info.color}22`,
                                            color: info.color,
                                        }}>{info.label}</span>;
                                    })()}
                                    {detailAnime.rating && (
                                        <span style={{
                                            ...S.modalBadge,
                                            background: `${RATING_COLORS[detailAnime.rating] || '#71717a'}22`,
                                            color: RATING_COLORS[detailAnime.rating] || '#71717a',
                                            fontWeight: 700
                                        }}>
                      {detailAnime.rating}
                    </span>
                                    )}
                                </div>
                                {/* Source link inline */}
                                {detailAnime.source && (
                                    <a href={detailAnime.source} target="_blank" style={{ ...S.modalLink, marginTop: 8, display: 'inline-block' }}>
                                        🔗 来源链接
                                    </a>
                                )}
                            </div>
                        </div>

                        {detailAnime.tags.length > 0 && (
                            <div style={S.modalTags}>
                                {detailAnime.tags.map(t => <span key={t} style={S.modalTagChip}>{t}</span>)}
                            </div>
                        )}

                        {/* Body content */}
                        {detailAnime.body && (
                            <div style={S.modalBody}>
                                <p style={S.modalBodyText}>{detailAnime.body}</p>
                            </div>
                        )}

                        {/* Links */}
                        <div style={S.modalLinks}>
                            {quartzLink && (
                                <a href={quartzLink} target="_blank" style={S.modalLink}>
                                    📂 在 my-anime-list 查看
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const S: Record<string, React.CSSProperties> = {};
S.page = {minHeight: '100vh', maxWidth: 1100, margin: '0 auto', padding: '28px 20px 40px'};
S.loading = {minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14};
S.spinner = {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: '3px solid #1e1e32',
    borderTopColor: '#6366f1',
    animation: 'spin 0.8s linear infinite'
};
S.loadingText = {fontSize: 14, color: '#a1a1aa', margin: 0};
S.progressText = {fontSize: 12, color: '#52525b', fontFamily: 'monospace', margin: 0};
S.header = {display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20};
S.backLink = {fontSize: 13, color: '#71717a', textDecoration: 'none'};
S.h1 = {fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, flex: 1};
S.countBadge = {padding: '4px 14px', borderRadius: 20, background: '#16162a', border: '1px solid #27273d', fontSize: 13, color: '#818cf8'};
S.summaryBar = {
    display: 'flex', alignItems: 'center', gap: 16, padding: '18px 22px',
    background: '#121224', border: '1px solid #1e1e32', borderRadius: 16, marginBottom: 16, flexWrap: 'wrap',
};
S.statItem = {textAlign: 'left'};
S.statNum = {fontSize: 22, fontWeight: 800, margin: 0};
S.statLabel = {fontSize: 11, color: '#52525b', margin: '2px 0 0'};
S.refreshBtn = {
    marginLeft: 'auto',
    padding: '6px 14px',
    borderRadius: 8,
    border: '1px solid #27273d',
    background: 'transparent',
    color: '#818cf8',
    cursor: 'pointer',
    fontSize: 14
};
S.search = {
    width: '100%', padding: '10px 16px', borderRadius: 12, border: '1px solid #27273d',
    background: '#0a0a14', color: '#e4e4e7', fontSize: 14, outline: 'none', marginBottom: 12, boxSizing: 'border-box',
};
S.filterRow = {display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10};
S.filterLabel = {fontSize: 12, color: '#71717a', fontWeight: 600, minWidth: 30};
S.filterTabs = {display: 'flex', gap: 6, flexWrap: 'wrap'};
S.filterTab = {
    padding: '5px 12px',
    borderRadius: 20,
    border: '1px solid #27273d',
    background: 'transparent',
    color: '#a1a1aa',
    cursor: 'pointer',
    fontSize: 11
};
S.filterTabActive = {background: '#16162a', color: '#fff'};

// 5-column grid of compact cards
S.grid = {display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10};

// Card: flat compact card with cover as subtle background
S.card = {
    position: 'relative', overflow: 'hidden', borderRadius: 12, cursor: 'pointer',
    transition: 'transform 0.15s, box-shadow 0.15s',
    border: '3px solid #1e1e32', minHeight: 150,
};

S.cardBg = {
    position: 'absolute', inset: 0, backgroundSize: 'cover', backgroundPosition: 'center',
    filter: 'brightness(1) saturate(1)', transform: 'scale(1)', zIndex: 0,
};

S.cardOverlay = {
    position: 'absolute', inset: 0, zIndex: 1,
    background: 'linear-gradient(135deg, rgba(18,18,36,1) 0%, rgba(10,10,20,0.3) 100%)',
};

S.cardContent = {
    position: 'relative', zIndex: 2, padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: 4,
};

S.cardTitle = {fontSize: 13, fontWeight: 600, color: '#e4e4e7', margin: 0, lineHeight: 1.3};
S.cardBadges = {display: 'flex', gap: 4};
S.cardTags = {display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2};
S.cardTagChip = {fontSize: 9, padding: '1px 6px', borderRadius: 10, background: 'rgba(30,30,50,0.7)', color: '#a1a1aa'};
S.badge = {fontSize: 10, padding: '2px 6px', borderRadius: 12, fontWeight: 500};
S.empty = {textAlign: 'center', color: '#52525b', fontSize: 13, padding: 48};

// Detail Modal styles — generous layout
S.modalOverlay = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999
};
S.modal = {
    background: '#16162a', border: '1px solid #2a2a40', borderRadius: 24, padding: 36,
    maxWidth: 720, width: '92%', maxHeight: '85vh', overflowY: 'auto', position: 'relative',
};
S.modalClose = {
    position: 'absolute',
    top: 20,
    right: 24,
    background: 'none',
    border: 'none',
    color: '#71717a',
    fontSize: 22,
    cursor: 'pointer'
};
S.modalHeaderRow = {display: 'flex', gap: 24, marginBottom: 20};
S.modalCoverWrap = {width: 180, height: 240, borderRadius: 14, overflow: 'hidden', background: '#0a0a14', flexShrink: 0};
S.modalCoverImg = {width: '100%', height: '100%', objectFit: 'cover'};
S.modalCoverPlaceholder = {
    width: 180,
    height: 240,
    borderRadius: 14,
    background: '#1e1e32',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 36,
    color: '#52525b',
    fontWeight: 700,
    flexShrink: 0
};
S.modalTitle = {fontSize: 26, fontWeight: 800, color: '#fff', margin: '0 0 12px', lineHeight: 1.2};
S.modalBadge = {fontSize: 13, padding: '5px 14px', borderRadius: 20, fontWeight: 500};
S.modalBadges = {display: 'flex', gap: 10};
S.modalTags = {display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20};
S.modalTagChip = {padding: '5px 14px', borderRadius: 20, background: '#27273d', fontSize: 13, color: '#d4d4d8'};
S.modalBody = {marginBottom: 20, background: '#121224', borderRadius: 12, padding: 18};
S.modalBodyText = {fontSize: 14, color: '#d4d4d8', lineHeight: 1.8, margin: 0};
S.modalLinks = {display: 'flex', gap: 20, marginTop: 16};
S.modalLink = {color: '#818cf8', textDecoration: 'none', fontSize: 14, fontWeight: 500};
