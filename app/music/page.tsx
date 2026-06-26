'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface MusicRecord {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number | null;
  netease_id?: number;
  play_count?: number | null;
  created_at?: string;
}

interface MusicTagData {
  id: string;
  tag: string;
  likability?: number;
  singability?: number;
  comment?: string;
}

const SORT_OPTIONS = [
  { value: 'title',       label: '歌名 A→Z' },
  { value: 'artist',      label: '歌手' },
  { value: 'likability',  label: '♥ 喜欢度' },
  { value: 'singability', label: '🎤 能唱度' },
  { value: 'created',     label: '收藏时间' },
] as const;

type SortBy = typeof SORT_OPTIONS[number]['value'];

export default function MusicPage() {
  const [musicList, setMusicList] = useState<MusicRecord[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<string, MusicTagData[]>>({});
  const [coverMap, setCoverMap] = useState<Record<string, string>>({});  // netease_id (string) → cover URL
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('title');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailMusic, setDetailMusic] = useState<MusicRecord | null>(null);

  useEffect(() => { fetchMusic(); }, []);

  const fetchMusic = async () => {
    const { data, error } = await supabase.from('music_list').select('*').order('created_at', { ascending: true }).limit(500);
    if (error) {
      setError(`加载音乐列表失败: ${error.message}`);
      setLoading(false);
      return;
    }
    setMusicList(data || []);

    const { data: tags, error: tagsError } = await supabase.from('music_tags').select('*');
    if (tagsError) {
      console.warn('加载标签失败:', tagsError.message);
    }
    if (tags) {
      const map: Record<string, MusicTagData[]> = {};
      tags.forEach((t: any) => {
        if (!map[t.music_id]) map[t.music_id] = [];
        map[t.music_id].push(t);
      });
      setTagsMap(map);
    }
    setLoading(false);

    // Load pre-built cover JSON
    try {
      const resp = await fetch('/music-covers.json');
      if (resp.ok) {
        const data = await resp.json();
        const covers: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) {
          if (k !== '_timestamp' && typeof v === 'string') covers[k] = v;
        }
        setCoverMap(covers);
      }
    } catch {}
  };

  // Collect all unique tags with counts
  const allTags = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tags of Object.values(tagsMap)) {
      for (const t of tags) {
        counts[t.tag] = (counts[t.tag] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([tag, count]) => ({ tag, count }));
  }, [tagsMap]);

  // Sort: tagged items bottom, untagged top
  const sorted = [...musicList].sort((a, b) => {
    const aHasTags = (tagsMap[a.id]?.length || 0) > 0;
    const bHasTags = (tagsMap[b.id]?.length || 0) > 0;
    if (aHasTags !== bHasTags) return aHasTags ? 1 : -1;

    if (sortBy === 'likability') {
      const aL = tagsMap[a.id]?.[0]?.likability || 0;
      const bL = tagsMap[b.id]?.[0]?.likability || 0;
      return bL - aL;
    }
    if (sortBy === 'singability') {
      const aS = tagsMap[a.id]?.[0]?.singability || 0;
      const bS = tagsMap[b.id]?.[0]?.singability || 0;
      return bS - aS;
    }
    if (sortBy === 'created') {
      const aT = a.created_at || '';
      const bT = b.created_at || '';
      return bT.localeCompare(aT);  // newest first
    }
    if (sortBy === 'artist') return a.artist.localeCompare(b.artist);
    return a.title.localeCompare(b.title);
  });

  // Filter by tag
  const byTag = tagFilter
    ? sorted.filter(m => (tagsMap[m.id] || []).some(t => t.tag === tagFilter))
    : sorted;

  // Filter by search
  const filtered = search.trim()
    ? byTag.filter(m => m.title.toLowerCase().includes(search.toLowerCase()) || m.artist.toLowerCase().includes(search.toLowerCase()))
    : byTag;

  const fmtDur = (sec: number | null) => {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return <div style={S.loading}><div style={S.spinner} /><p style={S.loadingText}>加载中...</p></div>;
  }

  if (error) {
    return (
      <div style={S.page}>
        <header style={S.header}>
          <Link href="/" style={S.back}>← 首页</Link>
          <h1 style={S.h1}>🎵 音乐收藏</h1>
        </header>
        <div style={S.errorBox}>
          <p style={S.errorTitle}>⚠️ 加载失败</p>
          <p style={S.errorMsg}>{error}</p>
          <button onClick={() => { setError(null); setLoading(true); fetchMusic(); }} style={S.retryBtn}>重试</button>
        </div>
      </div>
    );
  }

  const detailTags = detailMusic ? (tagsMap[detailMusic.id] || []) : [];
  const taggedCount = Object.keys(tagsMap).length;
  const detailCover = detailMusic?.netease_id ? coverMap[String(detailMusic.netease_id)] : null;

  return (
    <div style={S.page}>
      <header style={S.header}>
        <Link href="/" style={S.back}>← 首页</Link>
        <h1 style={S.h1}>🎵 音乐收藏</h1>
        <span style={S.countBadge}>{musicList.length} 首</span>
      </header>

      <p style={S.sourceNote}>数据来源：网易云音乐</p>

      {/* Controls */}
      <section style={S.controls}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 搜索歌曲或歌手..." style={S.search} />

        <div style={S.filterRow}>
          <span style={S.filterLabel}>排序</span>
          <div style={S.filterTabs}>
            {SORT_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                style={{ ...S.filterTab, ...(sortBy === opt.value ? S.filterTabActive : {}) }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <div style={S.filterRow}>
            <span style={S.filterLabel}>标签</span>
            <div style={S.filterTabs}>
              <button onClick={() => setTagFilter(null)}
                style={{ ...S.filterTab, ...(tagFilter === null ? S.filterTabActive : {}) }}>
                全部
              </button>
              {allTags.map(({ tag, count }) => (
                <button key={tag} onClick={() => setTagFilter(tag)}
                  style={{ ...S.filterTab, ...(tagFilter === tag ? S.filterTabActive : {}) }}>
                  {tag} <span style={S.tagCount}>{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={S.statsRow}>
          <span>已标记 {taggedCount}</span>
          <span>未标记 {musicList.length - taggedCount}</span>
          {tagFilter && <span style={{ color: '#818cf8' }}>筛选: {tagFilter} ({filtered.length})</span>}
        </div>
      </section>

      {/* Card Grid */}
      <main style={S.grid}>
        {filtered.map((m) => {
          const tags = tagsMap[m.id] || [];
          const hasTags = tags.length > 0;
          const likability = tags[0]?.likability;
          const singability = tags[0]?.singability;
          const cover = m.netease_id ? coverMap[String(m.netease_id)] : null;

          return (
            <article key={m.id} style={S.card} onClick={() => setDetailMusic(m)}>
              {/* Cover as subtle background */}
              {cover && (
                <div style={{ ...S.cardBg, backgroundImage: `url(${cover})` }} />
              )}
              <div style={S.cardOverlay} />
              <div style={S.cardContent}>
                <p style={{ ...S.cardTitle, ...(hasTags ? { color: '#818cf8' } : {}) }}>{m.title}</p>
                <p style={S.cardArtist}>{m.artist}{m.album && <span style={S.cardAlbum}> · {m.album}</span>}</p>

                {/* Duration */}
                {m.duration && (
                  <span style={S.cardDuration}>{fmtDur(m.duration)}</span>
                )}

                {/* Badges row */}
                <div style={S.cardBadges}>
                  {hasTags && likability && (
                    <span style={{ ...S.badge, background: '#f8717122', color: '#f87171' }}>♥{likability}</span>
                  )}
                  {hasTags && singability && (
                    <span style={{ ...S.badge, background: '#818cf822', color: '#818cf8' }}>🎤{singability}</span>
                  )}
                </div>

                {/* Tags preview */}
                {hasTags && (
                  <div style={S.cardTags}>
                    {tags.slice(0, 3).map(t => (
                      <span key={t.id} style={S.cardTagChip}>{t.tag}</span>
                    ))}
                    {tags.length > 3 && <span style={S.cardTagMore}>+{tags.length - 3}</span>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </main>

      {filtered.length === 0 && <p style={S.empty}>没有找到匹配的音乐</p>}

      {/* Detail Modal */}
      {detailMusic && (
        <div style={S.modalOverlay} onClick={() => setDetailMusic(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <button style={S.modalClose} onClick={() => setDetailMusic(null)}>✕</button>

            {/* Cover + Title header */}
            <div style={S.modalHeaderRow}>
              {detailCover ? (
                <div style={S.modalCoverWrap}>
                  <img src={detailCover} alt={detailMusic.title} style={S.modalCoverImg}
                    onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
                </div>
              ) : (
                <div style={S.modalCoverPlaceholder}>
                  <span>{detailMusic.title.slice(0, 2)}</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={S.modalTitle}>{detailMusic.title}</h2>
                <p style={S.modalArtist}>{detailMusic.artist}{detailMusic.album && ` · ${detailMusic.album}`}</p>
                <div style={S.modalMeta}>
                  <span>{fmtDur(detailMusic.duration ?? null)}</span>
                  <span style={S.modalSource}>来源：网易云音乐</span>
                  {detailMusic.netease_id && (
                    <a href={`https://music.163.com/#/song?id=${detailMusic.netease_id}`} target="_blank"
                      style={S.modalLink}>🔗 网易云链接</a>
                  )}
                </div>
              </div>
            </div>

            {detailTags.length > 0 ? (
              <div style={S.detailSection}>
                {/* Scores */}
                <div style={S.scoreRow}>
                  <div style={S.scoreBox}>
                    <span style={S.scoreLabel}>♥ 喜欢度</span>
                    <div style={S.scoreBar}>
                      <div style={{ ...S.scoreFill, width: `${(detailTags[0].likability || 0) * 10}%` }} />
                    </div>
                    <span style={S.scoreNum}>{detailTags[0].likability || 0}/10</span>
                  </div>
                  <div style={S.scoreBox}>
                    <span style={S.scoreLabel}>🎤 能唱度</span>
                    <div style={S.scoreBar}>
                      <div style={{ ...S.scoreFillSing, width: `${(detailTags[0].singability || 0) * 10}%` }} />
                    </div>
                    <span style={S.scoreNum}>{detailTags[0].singability || 0}/10</span>
                  </div>
                </div>

                {/* Tags */}
                <div style={S.detailTags}>
                  {detailTags.map(t => (
                    <span key={t.id} style={S.detailTagChip}>{t.tag}</span>
                  ))}
                </div>

                {/* Comment */}
                {detailTags[0]?.comment && (
                  <div style={S.detailComment}>
                    <p style={S.detailCommentLabel}>备注</p>
                    <p style={S.detailCommentText}>{detailTags[0].comment}</p>
                  </div>
                )}
              </div>
            ) : (
              <p style={S.noTags}>暂无标签（可在管理后台添加）</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {};
S.page = { minHeight: '100vh', maxWidth: 1100, margin: '0 auto', padding: '28px 20px 40px' };
S.loading = { minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 };
S.spinner = { width: 36, height: 36, borderRadius: '50%', border: '3px solid #1e1e32', borderTopColor: '#6366f1', animation: 'spin 0.8s linear infinite' };
S.loadingText = { fontSize: 14, color: '#a1a1aa', margin: 0 };
S.header = { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 };
S.back = { fontSize: 13, color: '#71717a', textDecoration: 'none' };
S.h1 = { fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, flex: 1 };
S.countBadge = { padding: '4px 14px', borderRadius: 20, background: '#16162a', border: '1px solid #27273d', fontSize: 13, color: '#818cf8' };
S.sourceNote = { fontSize: 11, color: '#52525b', margin: '0 0 16px' };
S.controls = { marginBottom: 16 };
S.search = {
  width: '100%', padding: '10px 16px', borderRadius: 12,
  border: '1px solid #1e1e32', background: '#121224', color: '#e4e4e7',
  fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 12,
};
S.filterRow = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
S.filterLabel = { fontSize: 12, color: '#52525b', fontWeight: 600 };
S.filterTabs = { display: 'flex', gap: 6, flexWrap: 'wrap' };
S.filterTab = { padding: '5px 12px', borderRadius: 20, border: '1px solid #27273d', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 11 };
S.filterTabActive = { background: '#16162a', color: '#fff', borderColor: '#6366f1' };
S.tagCount = { fontSize: 10, color: '#71717a', marginLeft: 2 };
S.statsRow = { display: 'flex', gap: 10, fontSize: 12, color: '#71717a', marginTop: 4 };

// Grid: multiple columns
S.grid = { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 };

// Card with cover background
S.card = {
  position: 'relative', overflow: 'hidden', borderRadius: 12, cursor: 'pointer',
  transition: 'transform 0.15s, box-shadow 0.15s',
  border: '3px solid #1e1e32', minHeight: 120,
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
  position: 'relative', zIndex: 2, padding: '10px 12px',
  display: 'flex', flexDirection: 'column', gap: 3,
};

S.cardTitle = { fontSize: 13, fontWeight: 600, color: '#e4e4e7', margin: 0, lineHeight: 1.3 };
S.cardArtist = { fontSize: 11, color: '#a1a1aa', margin: 0 };
S.cardAlbum = { color: '#52525b' };
S.cardDuration = { fontSize: 10, color: '#71717a' };
S.cardBadges = { display: 'flex', gap: 4 };
S.badge = { fontSize: 10, padding: '2px 6px', borderRadius: 12, fontWeight: 500 };
S.cardTags = { display: 'flex', gap: 3, flexWrap: 'wrap' };
S.cardTagChip = { fontSize: 9, padding: '1px 6px', borderRadius: 10, background: 'rgba(30,30,50,0.7)', color: '#a1a1aa' };
S.cardTagMore = { fontSize: 9, color: '#71717a' };
S.empty = { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 48 };
S.errorBox = { background: '#1e0a0a', border: '1px solid #7f1d1d', borderRadius: 12, padding: 24, marginTop: 24 };
S.errorTitle = { fontSize: 16, color: '#f87171', fontWeight: 700, margin: '0 0 8px' };
S.errorMsg = { fontSize: 13, color: '#d4d4d8', margin: '0 0 16px', lineHeight: 1.6 };
S.retryBtn = { padding: '8px 20px', borderRadius: 8, border: '1px solid #6366f1', background: 'transparent', color: '#818cf8', cursor: 'pointer', fontSize: 13 };

// Detail Modal — generous layout
S.modalOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 };
S.modal = {
  background: '#16162a', border: '1px solid #2a2a40', borderRadius: 24, padding: 36,
  maxWidth: 640, width: '92%', maxHeight: '85vh', overflowY: 'auto', position: 'relative',
};
S.modalClose = { position: 'absolute', top: 20, right: 24, background: 'none', border: 'none', color: '#71717a', fontSize: 22, cursor: 'pointer' };

// Modal: Cover + Title header row
S.modalHeaderRow = { display: 'flex', gap: 20, marginBottom: 20 };
S.modalCoverWrap = { width: 160, height: 160, borderRadius: 14, overflow: 'hidden', background: '#0a0a14', flexShrink: 0 };
S.modalCoverImg = { width: '100%', height: '100%', objectFit: 'cover' };
S.modalCoverPlaceholder = {
  width: 160, height: 160, borderRadius: 14, background: '#1e1e32',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 36, color: '#52525b', fontWeight: 700, flexShrink: 0,
};
S.modalTitle = { fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 6px' };
S.modalArtist = { fontSize: 14, color: '#a1a1aa', margin: '4px 0 8px' };
S.modalMeta = { display: 'flex', gap: 12, fontSize: 13, color: '#52525b' };
S.modalSource = { color: '#71717a', fontSize: 12 };
S.modalLink = { color: '#818cf8', textDecoration: 'none', fontSize: 13 };

S.detailSection = {};
S.scoreRow = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 };
S.scoreBox = {};
S.scoreLabel = { fontSize: 13, color: '#a1a1aa', display: 'block', marginBottom: 6 };
S.scoreBar = { height: 10, background: '#1e1e32', borderRadius: 5, overflow: 'hidden', marginBottom: 6 };
S.scoreFill = { height: '100%', background: '#f87171', borderRadius: 5, transition: 'width 0.3s' };
S.scoreFillSing = { height: '100%', background: '#818cf8', borderRadius: 5, transition: 'width 0.3s' };
S.scoreNum = { fontSize: 16, fontWeight: 700, color: '#e4e4e7' };
S.detailTags = { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 };
S.detailTagChip = { padding: '5px 14px', borderRadius: 20, background: '#27273d', fontSize: 13, color: '#d4d4d8' };
S.detailComment = { background: '#121224', borderRadius: 12, padding: 16 };
S.detailCommentLabel = { fontSize: 12, color: '#71717a', margin: '0 0 6px' };
S.detailCommentText = { fontSize: 14, color: '#e4e4e7', margin: 0, lineHeight: 1.6 };
S.noTags = { textAlign: 'center', color: '#52525b', fontSize: 14, padding: 24 };
