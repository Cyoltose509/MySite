'use client';

import { useEffect, useState } from 'react';
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
}

interface MusicTagData {
  id: string;
  tag: string;
  likability?: number;
  singability?: number;
  comment?: string;
}

export default function MusicPage() {
  const [musicList, setMusicList] = useState<MusicRecord[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<string, MusicTagData[]>>({});
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'title' | 'artist' | 'likability'>('title');
  const [loading, setLoading] = useState(true);
  const [detailMusic, setDetailMusic] = useState<MusicRecord | null>(null);

  useEffect(() => { fetchMusic(); }, []);

  const fetchMusic = async () => {
    const { data } = await supabase.from('music_list').select('*').limit(500);
    setMusicList(data || []);

    const { data: tags } = await supabase.from('music_tags').select('*');
    if (tags) {
      const map: Record<string, MusicTagData[]> = {};
      tags.forEach((t: any) => {
        if (!map[t.music_id]) map[t.music_id] = [];
        map[t.music_id].push(t);
      });
      setTagsMap(map);
    }
    setLoading(false);
  };

  useEffect(() => { fetchMusic(); }, [sortBy]);

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
    if (sortBy === 'artist') return a.artist.localeCompare(b.artist);
    return a.title.localeCompare(b.title);
  });

  const filtered = search.trim()
    ? sorted.filter(m => m.title.toLowerCase().includes(search.toLowerCase()) || m.artist.toLowerCase().includes(search.toLowerCase()))
    : sorted;

  const fmtDur = (sec: number | null) => {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return <div style={S.loading}><div style={S.spinner} /><p style={S.loadingText}>加载中...</p></div>;
  }

  const detailTags = detailMusic ? (tagsMap[detailMusic.id] || []) : [];
  const taggedCount = Object.keys(tagsMap).length;

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
            {[
              { value: 'title' as const, label: '歌名' },
              { value: 'artist' as const, label: '歌手' },
              { value: 'likability' as const, label: '♥ 喜欢度' },
            ].map((opt) => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                style={{ ...S.filterTab, ...(sortBy === opt.value ? S.filterTabActive : {}) }}>
                {opt.label}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, fontSize: 12, color: '#71717a' }}>
            <span>已标记 {taggedCount}</span>
            <span>未标记 {musicList.length - taggedCount}</span>
          </div>
        </div>
      </section>

      {/* Card Grid */}
      <main style={S.grid}>
        {filtered.map((m) => {
          const tags = tagsMap[m.id] || [];
          const hasTags = tags.length > 0;
          const likability = tags[0]?.likability;
          const singability = tags[0]?.singability;

          return (
            <article key={m.id} style={{ ...S.card, ...(hasTags ? S.cardTagged : {}) }}
              onClick={() => setDetailMusic(m)}>
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
S.filterRow = { display: 'flex', alignItems: 'center', gap: 8 };
S.filterLabel = { fontSize: 12, color: '#52525b', fontWeight: 600 };
S.filterTabs = { display: 'flex', gap: 6 };
S.filterTab = { padding: '5px 12px', borderRadius: 20, border: '1px solid #27273d', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 11 };
S.filterTabActive = { background: '#16162a', color: '#fff', borderColor: '#6366f1' };

// Grid: multiple columns
S.grid = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 };

// Card
S.card = {
  padding: '12px 14px', borderRadius: 12, border: '1px solid #1e1e32',
  background: '#121224', cursor: 'pointer', transition: 'transform 0.15s, border-color 0.15s',
  display: 'flex', flexDirection: 'column', gap: 4,
};
S.cardTagged = { background: '#0d0d1a', border: '1px solid #2a2a40' };
S.cardTitle = { fontSize: 13, fontWeight: 600, color: '#e4e4e7', margin: 0, lineHeight: 1.3 };
S.cardArtist = { fontSize: 12, color: '#a1a1aa', margin: 0 };
S.cardAlbum = { color: '#52525b' };
S.cardDuration = { fontSize: 10, color: '#71717a' };
S.cardBadges = { display: 'flex', gap: 4 };
S.badge = { fontSize: 10, padding: '2px 6px', borderRadius: 12, fontWeight: 500 };
S.cardTags = { display: 'flex', gap: 3, flexWrap: 'wrap' };
S.cardTagChip = { fontSize: 9, padding: '1px 6px', borderRadius: 10, background: '#27273d', color: '#a1a1aa' };
S.cardTagMore = { fontSize: 9, color: '#71717a' };
S.empty = { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 48 };

// Detail Modal — generous layout
S.modalOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 };
S.modal = {
  background: '#16162a', border: '1px solid #2a2a40', borderRadius: 24, padding: 36,
  maxWidth: 620, width: '92%', maxHeight: '85vh', overflowY: 'auto', position: 'relative',
};
S.modalClose = { position: 'absolute', top: 20, right: 24, background: 'none', border: 'none', color: '#71717a', fontSize: 22, cursor: 'pointer' };
S.modalTitle = { fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 };
S.modalArtist = { fontSize: 15, color: '#a1a1aa', margin: '4px 0 16px' };
S.modalMeta = { display: 'flex', gap: 16, fontSize: 13, color: '#52525b', marginBottom: 20 };
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
