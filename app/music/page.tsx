'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import AnalysisPanel from '@/components/music/AnalysisPanel';
import type { MusicAnalysisItem } from '@/lib/music-analysis';
import {
  C, pageStyle, cardGridStyle, cardStyle, cardBgStyle, cardOverlayStyle,
  cardContentStyle, cardTitleStyle, cardArtistStyle, cardAlbumStyle, cardDurationStyle,
  badgeStyle, tagChipStyle, tagMoreStyle, emptyStyle,
  headerStyle, backLinkStyle, h1Style, countBadgeStyle,
  controlsStyle, sourceNoteStyle, filterRowStyle, filterLabelStyle,
  filterTabsStyle, filterTabStyle, filterTabActiveStyle, tagCountStyle, statsRowStyle,
  searchInputStyle, modalOverlayStyle, modalStyle, modalCloseStyle,
  modalCoverPlaceholderStyle,
  errorBoxStyle, errorTitleStyle, errorMsgStyle, retryBtnStyle,
  scoreRowStyle, scoreBarContainerStyle, scoreLabelStyle, scoreNumStyle,
} from '@/lib/card-styles';
import { PageLoading } from '@/components/shared';

interface MusicRecord {
  id: string;
  title: string;
  artist: string[];
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
  voice?: string;
  note?: string;
}

const RATING_LABELS = ['', '拉完了', 'NPC', '人上人', '顶级', '夯'];

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
  const [coverMap, setCoverMap] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('title');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [voiceFilter, setVoiceFilter] = useState<string | null>(null);
  const [likabilityFilter, setLikabilityFilter] = useState<number | null>(null);
  const [singabilityFilter, setSingabilityFilter] = useState<number | null>(null);
  const [artistFilter, setArtistFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailMusic, setDetailMusic] = useState<MusicRecord | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  useEffect(() => { fetchMusic(); }, []);

  const fetchMusic = async () => {
    const { data, error } = await supabase.from('music_list').select('*').order('created_at', { ascending: true }).limit(500);
    if (error) {
      setError(`加载音乐列表失败: ${error.message}`);
      setLoading(false);
      return;
    }
    setMusicList(data || []);

    let allTags: any[] = [];
    let page = 0;
    while (true) {
      const { data: tags, error: tagsError } = await supabase.from('music_tags').select('*').range(page * 1000, (page + 1) * 1000 - 1);
      if (tagsError) { console.warn('加载标签失败:', tagsError.message); break; }
      if (!tags || tags.length === 0) break;
      allTags = allTags.concat(tags);
      if (tags.length < 1000) break;
      page++;
    }
    if (allTags) {
      const map: Record<string, MusicTagData[]> = {};
      allTags.forEach((t: any) => {
        if (!map[t.music_id]) map[t.music_id] = [];
        map[t.music_id].push(t);
      });
      setTagsMap(map);
    }
    setLoading(false);

    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/music-covers.json`);
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

  const allTags = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tags of Object.values(tagsMap)) {
      for (const t of tags) counts[t.tag] = (counts[t.tag] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));
  }, [tagsMap]);

  const allArtists = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of musicList) {
      const arr = Array.isArray(m.artist) ? m.artist : [m.artist];
      for (const a of arr) {
        if (a && a !== 'Unknown') counts[a] = (counts[a] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([artist, count]) => ({ artist, count }));
  }, [musicList]);

  // Sort: tagged items TOP (only /admin puts tagged at bottom)
  const sorted = [...musicList].sort((a, b) => {
    const aHasTags = (tagsMap[a.id]?.length || 0) > 0;
    const bHasTags = (tagsMap[b.id]?.length || 0) > 0;
    if (aHasTags !== bHasTags) return aHasTags ? -1 : 1;

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
      return bT.localeCompare(aT);
    }
    if (sortBy === 'artist') {
      const aArt = (a.artist || []).join(' / ');
      const bArt = (b.artist || []).join(' / ');
      return aArt.localeCompare(bArt);
    }
    return a.title.localeCompare(b.title);
  });

  const byTag = tagFilter
    ? sorted.filter(m => (tagsMap[m.id] || []).some(t => t.tag === tagFilter))
    : sorted;

  const byVoice = voiceFilter
    ? byTag.filter(m => (tagsMap[m.id] || []).some(t => t.voice === voiceFilter))
    : byTag;

  const byLikability = likabilityFilter
    ? byVoice.filter(m => (tagsMap[m.id] || []).some(t => t.likability === likabilityFilter))
    : byVoice;

  const bySingability = singabilityFilter
    ? byLikability.filter(m => (tagsMap[m.id] || []).some(t => t.singability === singabilityFilter))
    : byLikability;

  const byArtist = artistFilter
    ? bySingability.filter(m => (m.artist || []).some((a: string) => a === artistFilter))
    : bySingability;

  const filtered = search.trim()
    ? byArtist.filter(m => m.title.toLowerCase().includes(search.toLowerCase()) || (m.artist || []).join(' / ').toLowerCase().includes(search.toLowerCase()))
    : byArtist;

  const fmtDur = (sec: number | null) => {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Build analysis items from tagged music
  const analysisItems = useMemo<MusicAnalysisItem[]>(() => {
    const items: MusicAnalysisItem[] = [];
    for (const m of musicList) {
      const tags = tagsMap[m.id];
      if (!tags || tags.length === 0) continue;
      const firstTag = tags[0];
      if (!firstTag.likability) continue;
      items.push({
        id: m.id,
        title: m.title,
        artist: (m.artist || []).join(' / '),
        tags: tags.map(t => t.tag),
        likability: firstTag.likability,
        singability: firstTag.singability || 0,
        voice: firstTag.voice,
        playCount: m.play_count || 0,
      });
    }
    return items;
  }, [musicList, tagsMap]);

  if (loading) {
    return <PageLoading text="加载音乐..." />;
  }

  if (error) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          <Link href="/" style={backLinkStyle}>← 首页</Link>
          <h1 style={h1Style}>🎵 音乐收藏</h1>
        </header>
        <div style={errorBoxStyle}>
          <p style={errorTitleStyle}>⚠️ 加载失败</p>
          <p style={errorMsgStyle}>{error}</p>
          <button onClick={() => { setError(null); setLoading(true); fetchMusic(); }} style={retryBtnStyle}>重试</button>
        </div>
      </div>
    );
  }

  const detailTags = detailMusic ? (tagsMap[detailMusic.id] || []) : [];
  const taggedCount = Object.keys(tagsMap).length;
  const detailCover = detailMusic?.netease_id ? coverMap[String(detailMusic.netease_id)] : null;

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={backLinkStyle}>← 首页</Link>
        <h1 style={h1Style}>🎵 音乐收藏</h1>
        <span style={countBadgeStyle}>{musicList.length} 首</span>
        <button onClick={() => setShowAnalysis(true)} style={{
          padding: '4px 14px', borderRadius: 20, border: '1px solid #27273d',
          background: '#16162a', color: '#f59e0b', fontSize: 13, cursor: 'pointer',
        }}>
          📊 分析
        </button>
      </header>

      <p style={sourceNoteStyle}>数据来源：网易云音乐</p>

      <section style={controlsStyle}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 搜索歌曲或歌手..." style={searchInputStyle} />

        <div style={filterRowStyle}>
          <span style={filterLabelStyle}>排序</span>
          <div style={filterTabsStyle}>
            {SORT_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => setSortBy(opt.value)}
                style={{ ...filterTabStyle, ...(sortBy === opt.value ? filterTabActiveStyle : {}) }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {allTags.length > 0 && (
          <div style={filterRowStyle}>
            <span style={filterLabelStyle}>标签</span>
            <div style={filterTabsStyle}>
              <button onClick={() => setTagFilter(null)}
                style={{ ...filterTabStyle, ...(tagFilter === null ? filterTabActiveStyle : {}) }}>
                全部
              </button>
              {allTags.map(({ tag, count }) => (
                <button key={tag} onClick={() => setTagFilter(tag)}
                  style={{ ...filterTabStyle, ...(tagFilter === tag ? filterTabActiveStyle : {}) }}>
                  {tag} <span style={tagCountStyle}>{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={filterRowStyle}>
          <span style={filterLabelStyle}>声线</span>
          <div style={filterTabsStyle}>
            <button onClick={() => setVoiceFilter(null)}
              style={{ ...filterTabStyle, ...(voiceFilter === null ? filterTabActiveStyle : {}) }}>
              全部
            </button>
            <button onClick={() => setVoiceFilter('male')}
              style={{ ...filterTabStyle, ...(voiceFilter === 'male' ? filterTabActiveStyle : {}) }}>
              ♂ 男声
            </button>
            <button onClick={() => setVoiceFilter('female')}
              style={{ ...filterTabStyle, ...(voiceFilter === 'female' ? filterTabActiveStyle : {}) }}>
              ♀ 女声
            </button>
            <button onClick={() => setVoiceFilter('duet')}
              style={{ ...filterTabStyle, ...(voiceFilter === 'duet' ? filterTabActiveStyle : {}) }}>
              ♪ 男女
            </button>
          </div>
        </div>

        <div style={filterRowStyle}>
          <span style={filterLabelStyle}>♥ 喜欢度</span>
          <div style={filterTabsStyle}>
            <button onClick={() => setLikabilityFilter(null)}
              style={{ ...filterTabStyle, ...(likabilityFilter === null ? filterTabActiveStyle : {}) }}>
              全部
            </button>
            {[5, 4, 3, 2, 1].map(v => (
              <button key={v} onClick={() => setLikabilityFilter(v)}
                style={{ ...filterTabStyle, ...(likabilityFilter === v ? filterTabActiveStyle : {}) }}>
                {RATING_LABELS[v]}
              </button>
            ))}
          </div>
        </div>

        <div style={filterRowStyle}>
          <span style={filterLabelStyle}>🎤 能唱度</span>
          <div style={filterTabsStyle}>
            <button onClick={() => setSingabilityFilter(null)}
              style={{ ...filterTabStyle, ...(singabilityFilter === null ? filterTabActiveStyle : {}) }}>
              全部
            </button>
            {[5, 4, 3, 2, 1].map(v => (
              <button key={v} onClick={() => setSingabilityFilter(v)}
                style={{ ...filterTabStyle, ...(singabilityFilter === v ? filterTabActiveStyle : {}) }}>
                {RATING_LABELS[v]}
              </button>
            ))}
          </div>
        </div>

        {allArtists.length > 0 && (
          <div style={filterRowStyle}>
            <span style={filterLabelStyle}>歌手</span>
            <div style={filterTabsStyle}>
              <button onClick={() => setArtistFilter(null)}
                style={{ ...filterTabStyle, ...(artistFilter === null ? filterTabActiveStyle : {}) }}>
                全部
              </button>
              {allArtists.slice(0, 40).map(({ artist, count }) => (
                <button key={artist} onClick={() => setArtistFilter(artist)}
                  style={{ ...filterTabStyle, ...(artistFilter === artist ? filterTabActiveStyle : {}) }}>
                  {artist} <span style={tagCountStyle}>{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={statsRowStyle}>
          <span>已标记 {taggedCount}</span>
          <span>未标记 {musicList.length - taggedCount}</span>
          {tagFilter && <span style={{ color: C.accentLt }}>标签: {tagFilter}</span>}
          {voiceFilter && <span style={{ color: C.accentLt }}>声线: {voiceFilter === 'male' ? '♂' : voiceFilter === 'female' ? '♀' : '♪'}</span>}
          {likabilityFilter && <span style={{ color: C.accentLt }}>♥ {RATING_LABELS[likabilityFilter]}</span>}
          {singabilityFilter && <span style={{ color: C.accentLt }}>🎤 {RATING_LABELS[singabilityFilter]}</span>}
          {artistFilter && <span style={{ color: C.accentLt }}>歌手: {artistFilter}</span>}
        </div>
      </section>

      <main style={cardGridStyle}>
        {filtered.map((m) => {
          const tags = tagsMap[m.id] || [];
          const hasTags = tags.length > 0;
          const likability = tags[0]?.likability;
          const singability = tags[0]?.singability;
          const cover = m.netease_id ? coverMap[String(m.netease_id)] : null;

          return (
            <article key={m.id} style={cardStyle} onClick={() => setDetailMusic(m)}>
              {cover && <div style={cardBgStyle(cover)} />}
              <div style={cardOverlayStyle} />
              <div style={cardContentStyle}>
                <p style={cardTitleStyle(hasTags)}>{m.title}</p>
                <p style={cardArtistStyle}>{(m.artist || []).join(' / ')}</p>
                {m.duration && <span style={cardDurationStyle}>{fmtDur(m.duration)}</span>}
                <div style={{ display: 'flex', gap: 4 }}>
                  {hasTags && likability && (
                    <span style={badgeStyle(C.red)}>♥{RATING_LABELS[likability]}</span>
                  )}
                  {hasTags && singability && (
                    <span style={badgeStyle(C.accentLt)}>🎤{RATING_LABELS[singability]}</span>
                  )}
                </div>
                {hasTags && (
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {tags.slice(0, 6).map(t => (
                      <span key={t.id} style={tagChipStyle}>{t.tag}</span>
                    ))}
                    {tags.length > 6 && <span style={tagMoreStyle}>+{tags.length - 6}</span>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </main>

      {filtered.length === 0 && <p style={emptyStyle}>没有找到匹配的音乐</p>}

      {/* Detail Modal */}
      {detailMusic && (
        <div style={modalOverlayStyle} onClick={() => setDetailMusic(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <button style={modalCloseStyle} onClick={() => setDetailMusic(null)}>✕</button>

            <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
              {detailCover ? (
                <div style={{ width: 160, height: 160, borderRadius: 14, overflow: 'hidden', background: C.border, flexShrink: 0 }}>
                  <img src={detailCover} alt={detailMusic.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
                </div>
              ) : (
                <div style={modalCoverPlaceholderStyle(160)}>
                  <span>{detailMusic.title.slice(0, 2)}</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 6px' }}>{detailMusic.title}</h2>
                <p style={{ fontSize: 14, color: C.textSec, margin: '4px 0 8px' }}>
                  {detailMusic.artist && (detailMusic.artist as string[]).join(' / ')}{detailMusic.album && ` · ${detailMusic.album}`}
                </p>
                <div style={{ display: 'flex', gap: 12, fontSize: 13, color: C.textDim }}>
                  <span>{fmtDur(detailMusic.duration ?? null)}</span>
                  <span style={{ color: C.textDead, fontSize: 12 }}>来源：网易云音乐</span>
                  {detailMusic.netease_id && (
                    <a href={`https://music.163.com/#/song?id=${detailMusic.netease_id}`} target="_blank"
                      style={{ color: C.accentLt, textDecoration: 'none', fontSize: 13 }}>🔗 网易云链接</a>
                  )}
                </div>
              </div>
            </div>

            {detailTags.length > 0 ? (
              <div>
                <div style={scoreRowStyle}>
                  <div>
                    <span style={scoreLabelStyle}>♥ 喜欢度</span>
                    <div style={scoreBarContainerStyle}>
                      <div style={{ height: '100%', background: C.red, borderRadius: 5, width: `${(detailTags[0].likability || 0) * 20}%` }} />
                    </div>
                    <span style={scoreNumStyle}>{RATING_LABELS[detailTags[0].likability || 0]}</span>
                  </div>
                  <div>
                    <span style={scoreLabelStyle}>🎤 能唱度</span>
                    <div style={scoreBarContainerStyle}>
                      <div style={{ height: '100%', background: C.accentLt, borderRadius: 5, width: `${(detailTags[0].singability || 0) * 20}%` }} />
                    </div>
                    <span style={scoreNumStyle}>{RATING_LABELS[detailTags[0].singability || 0]}</span>
                  </div>
                </div>

                {detailTags[0]?.voice && (
                  <div style={{ marginBottom: 12, fontSize: 13, color: C.textSec }}>
                    声线：{detailTags[0].voice === 'male' ? '♂ 男声' : detailTags[0].voice === 'female' ? '♀ 女声' : '♪ 男女'}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                  {detailTags.map(t => (
                    <span key={t.id} style={{ padding: '5px 14px', borderRadius: 20, background: C.border, fontSize: 13, color: C.textSec }}>{t.tag}</span>
                  ))}
                </div>

                {detailTags[0]?.note && (
                  <div style={{ background: C.surface, borderRadius: 12, padding: 16 }}>
                    <p style={{ fontSize: 12, color: C.textDim, margin: '0 0 6px' }}>记录</p>
                    <p style={{ fontSize: 14, color: C.text, margin: 0, lineHeight: 1.6 }}>{detailTags[0].note}</p>
                  </div>
                )}
              </div>
            ) : (
              <p style={{ textAlign: 'center', color: C.textDead, fontSize: 14, padding: 24 }}>暂无标签（可在管理后台添加）</p>
            )}
          </div>
        </div>
      )}

      {/* Analysis Panel Overlay */}
      {showAnalysis && <AnalysisPanel items={analysisItems} onClose={() => setShowAnalysis(false)}
        onTagFilter={(tag) => { setTagFilter(tag); setVoiceFilter(null); setLikabilityFilter(null); setSingabilityFilter(null); setArtistFilter(null); setSearch(''); }}
        onVoiceFilter={(voice) => { setVoiceFilter(voice); setTagFilter(null); setLikabilityFilter(null); setSingabilityFilter(null); setArtistFilter(null); setSearch(''); }}
        onArtistFilter={(artist) => { setArtistFilter(artist); setTagFilter(null); setVoiceFilter(null); setLikabilityFilter(null); setSingabilityFilter(null); setSearch(''); }}
        onSelectSong={(id) => { const m = musicList.find(x => x.id === id); if (m) setDetailMusic(m); }}
      />}
    </div>
  );
}
