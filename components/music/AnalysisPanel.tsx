'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { runFullAnalysis } from '@/lib/music-analysis';
import type {
  MusicAnalysisItem, TagRatingResult,
  InfluenceResult, AnomalyResult, FavoriteTagResult,
  VoiceAnalysis, ArtistInfluence,
} from '@/lib/music-analysis';

const C = {
  bg: '#0c0c1a', card: '#121224', border: '#1e1e32',
  text: '#e4e4e7', dim: '#71717a', accent: '#818cf8',
  green: '#4ade80', red: '#f87171', orange: '#f59e0b', purple: '#a855f7', blue: '#3498DB',
};

const LIKE_COLORS: Record<number, string> = { 1: '#2C3E50', 2: '#7F8C8D', 3: '#3498DB', 4: '#E67E22', 5: '#E74C3C' };
const SING_COLORS: Record<number, string> = { 1: '#2C3E50', 2: '#7F8C8D', 3: '#2ECC71', 4: '#1ABC9C', 5: '#9B59B6' };
const RATING_LABELS = ['', '拉完了', 'NPC', '人上人', '顶级', '夯'];

function Spinner() {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
    <div className="spinner" style={{ width: 26, height: 26, borderRadius: '50%', border: '3px solid #1e1e32', borderTopColor: '#6366f1' }} />
  </div>;
}

const KEYFRAMES = `
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.spinner { animation: spin .8s linear infinite; }
.card-enter { animation: fadeIn 0.35s ease both; }
.bar-hover { transition: opacity 0.15s, filter 0.12s; cursor: pointer; }
.bar-hover:hover { filter: brightness(1.35); }
`;

const MIN_W = 420, MAX_W = 1100;

export default function AnalysisPanel({
  items, onClose, onTagFilter, onVoiceFilter, onArtistFilter, onSelectSong,
}: {
  items: MusicAnalysisItem[];
  onClose: () => void;
  onTagFilter: (tag: string) => void;
  onVoiceFilter: (voice: string) => void;
  onArtistFilter: (artist: string) => void;
  onSelectSong: (id: string) => void;
}) {
  const analysis = useRef(runFullAnalysis(items));
  const [voiceFilter, setVoiceFilter] = useState<string | null>(null);
  const a = useRef(analysis.current);

  // Re-run analysis when voice filter changes
  const rerun = useCallback((vf: string | null) => {
    setVoiceFilter(vf);
    const filtered = vf ? items.filter(i => i.voice === vf) : items;
    a.current = runFullAnalysis(filtered);
  }, [items]);
  const [panelW, setPanelW] = useState(680);
  const dragging = useRef(false);
  const justDragged = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const [tagLike, setTagLike] = useState<TagRatingResult | null>(null);
  const [tagSing, setTagSing] = useState<TagRatingResult | null>(null);
  const [influence, setInfluence] = useState<InfluenceResult[] | null>(null);
  const [influenceSing, setInfluenceSing] = useState<InfluenceResult[] | null>(null);
  const [voiceAnalysis, setVoiceAnalysis] = useState<VoiceAnalysis[] | null>(null);
  const [favoriteTags, setFavoriteTags] = useState<FavoriteTagResult[] | null>(null);
  const [favoriteTagsSing, setFavoriteTagsSing] = useState<FavoriteTagResult[] | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyResult[] | null>(null);
  const [anomaliesSing, setAnomaliesSing] = useState<AnomalyResult[] | null>(null);
  const [favoriteArtists, setFavoriteArtists] = useState<ArtistInfluence[] | null>(null);
  const [singableArtists, setSingableArtists] = useState<ArtistInfluence[] | null>(null);

  useEffect(() => {
    const an = a.current;
    // Reset
    setTagLike(null); setTagSing(null); setInfluence(null); setInfluenceSing(null);
    setVoiceAnalysis(null); setFavoriteTags(null); setFavoriteTagsSing(null);
    setAnomalies(null); setAnomaliesSing(null);
    setFavoriteArtists(null); setSingableArtists(null);
    // Stagger recompute
    setTimeout(() => setTagLike(an.tagLike()), 60);
    setTimeout(() => setTagSing(an.tagSing()), 120);
    setTimeout(() => setInfluence(an.influence()), 180);
    setTimeout(() => setInfluenceSing(an.influenceSing()), 240);
    setTimeout(() => setVoiceAnalysis(an.voiceAnalysis()), 300);
    setTimeout(() => setFavoriteTags(an.favoriteTags()), 360);
    setTimeout(() => setFavoriteTagsSing(an.favoriteTagsSing()), 420);
    setTimeout(() => setAnomalies(an.anomalies()), 480);
    setTimeout(() => setAnomaliesSing(an.anomaliesSing()), 540);
    setTimeout(() => setFavoriteArtists(an.favoriteArtists()), 600);
    setTimeout(() => setSingableArtists(an.singableArtists()), 660);
  }, [voiceFilter]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX; startW.current = panelW;
    document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
  }, [panelW]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = startX.current - e.clientX;
      setPanelW(Math.min(MAX_W, Math.max(MIN_W, startW.current + dx)));
    };
    const onUp = () => {
      if (dragging.current) { justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 50); }
      dragging.current = false;
      document.body.style.cursor = ''; document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const s = a.current.stats;
  const cardContentW = (panelW - 48 - 32 - 16) / 2;

  return (
    <div style={styles.backdrop} onClick={() => { if (!justDragged.current) onClose(); }}>
      <style>{KEYFRAMES}</style>
      <div style={{ position: 'relative', flexShrink: 0, height: '100%' }} onClick={e => e.stopPropagation()}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 10000 }}
          onMouseDown={onMouseDown} onClick={e => e.stopPropagation()} />
        <div style={{ ...styles.panel, width: panelW }} onClick={e => e.stopPropagation()}>
          <div style={styles.headerBar}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text }}>🎵 音乐偏好分析</h2>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={styles.badge}>{s.total} 首 · {a.current.allTags.length} 标签</span>
              <span style={{ ...styles.badge2, color: C.red }}>平均喜欢 {(s.avgLikability).toFixed(1)}</span>
              <span style={{ ...styles.badge2, color: C.purple }}>平均能唱 {(s.avgSingability).toFixed(1)}</span>
              {['全部', '男生', '女生', '男女'].map((label, i) => {
                const v = [null, 'male', 'female', 'duet'][i];
                const active = voiceFilter === v;
                return <button key={label} onClick={() => rerun(v)}
                  style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid ' + (active ? C.accent : C.border),
                    background: active ? 'rgba(99,102,241,0.15)' : 'transparent', color: active ? C.accent : C.dim,
                    fontSize: 11, cursor: 'pointer' }}>{label}</button>;
              })}
              <button onClick={onClose} style={styles.closeBtn}>✕</button>
            </div>
          </div>

          <div style={styles.body}>
            {/* Row 1: 标签×喜欢度 + 标签×能唱度 */}
            <div style={styles.row}>
              <div style={{ ...styles.card, animationDelay: '0.05s' }} className="card-enter">
                <div style={styles.cardLabel}>标签 × 喜欢度 TOP15</div>
                {tagLike ? <TagRatingHeatmap data={tagLike} colors={LIKE_COLORS} /> : <Spinner />}
              </div>
              <div style={{ ...styles.card, animationDelay: '0.1s' }} className="card-enter">
                <div style={styles.cardLabel}>标签 × 能唱度 TOP15</div>
                {tagSing ? <TagRatingHeatmap data={tagSing} colors={SING_COLORS} /> : <Spinner />}
              </div>
            </div>

            {/* Row 2: 标签影响力(喜欢) + 标签影响力(能唱) */}
            <div style={styles.row}>
              <div style={{ ...styles.card, animationDelay: '0.15s' }} className="card-enter">
                <div style={styles.cardLabel}>标签影响力 · 喜欢度</div>
                {influence ? <InfluenceChart data={influence.slice(0, 20)} maxW={cardContentW} onTagClick={onTagFilter} color="#E74C3C" /> : <Spinner />}
              </div>
              <div style={{ ...styles.card, animationDelay: '0.2s' }} className="card-enter">
                <div style={styles.cardLabel}>标签影响力 · 能唱度</div>
                {influenceSing ? <InfluenceChart data={influenceSing.slice(0, 20)} maxW={cardContentW} onTagClick={onTagFilter} color="#9B59B6" /> : <Spinner />}
              </div>
            </div>

            {/* Row 3: 声线偏好 + 最喜欢/最能唱标签 */}
            <div style={styles.row}>
              <div style={{ ...styles.card, animationDelay: '0.25s' }} className="card-enter">
                <div style={styles.cardLabel}>声线偏好 · 喜欢度 & 能唱度</div>
                {voiceAnalysis ? <VoiceChart data={voiceAnalysis} onVoiceClick={onVoiceFilter} /> : <Spinner />}
              </div>
              <div style={{ ...styles.card, animationDelay: '0.3s' }} className="card-enter">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={styles.cardLabel2}>最喜欢</div>
                  <div style={styles.cardLabel2}>最能唱</div>
                </div>
                {favoriteTags && favoriteTagsSing ? (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <FavoriteTagsChart data={favoriteTags.slice(0, 12)} maxW={cardContentW / 2} onTagClick={onTagFilter} color={C.red} label="分" />
                    <FavoriteTagsChart data={favoriteTagsSing.slice(0, 12)} maxW={cardContentW / 2} onTagClick={onTagFilter} color={C.purple} label="分" />
                  </div>
                ) : <Spinner />}
              </div>
            </div>

            {/* Row 4: 评分反常(喜欢) + 评分反常(能唱) */}
            <div style={styles.row}>
              <div style={{ ...styles.card, animationDelay: '0.35s' }} className="card-enter">
                <div style={styles.cardLabel}>评分反常 · 喜欢度 TOP15</div>
                {anomalies ? <AnomalyTable data={anomalies.slice(0, 15)} onSelect={onSelectSong} /> : <Spinner />}
              </div>
              <div style={{ ...styles.card, animationDelay: '0.4s' }} className="card-enter">
                <div style={styles.cardLabel}>评分反常 · 能唱度 TOP15</div>
                {anomaliesSing ? <AnomalyTable data={anomaliesSing.slice(0, 15)} onSelect={onSelectSong} /> : <Spinner />}
              </div>
            </div>

            {/* Row 5: 最喜欢歌手 + 最拟合歌手 */}
            <div style={styles.row}>
              <div style={{ ...styles.card, animationDelay: '0.45s' }} className="card-enter">
                <div style={styles.cardLabel}>最喜欢的歌手</div>
                {favoriteArtists ? <ArtistBarChart data={favoriteArtists.slice(0, 12)} maxW={cardContentW} color={C.red} valueKey="avgLike" suffix="分" onArtistClick={onArtistFilter} /> : <Spinner />}
              </div>
              <div style={{ ...styles.card, animationDelay: '0.5s' }} className="card-enter">
                <div style={styles.cardLabel}>最拟合的歌手</div>
                {singableArtists ? <ArtistBarChart data={singableArtists.slice(0, 12)} maxW={cardContentW} color={C.purple} valueKey="avgSing" suffix="分" onArtistClick={onArtistFilter} /> : <Spinner />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TagRatingHeatmap ──
function TagRatingHeatmap({ data, colors }: { data: TagRatingResult; colors: Record<number, string> }) {
  const cell = 24, pad = { top: 24, bottom: 6, left: 64, right: 6 };
  const { tags, ratings, counts } = data;
  const K = tags.length, J = ratings.length;
  const w = pad.left + J * cell + pad.right, h = pad.top + K * cell + pad.bottom;
  const maxC = Math.max(...counts.flat(), 1);

  return <svg width={w} height={h} style={{ display: 'block' }}>
    {Array.from({ length: K }, (_, ri) =>
      Array.from({ length: J }, (_, ci) => {
        const c = counts[ri][ci];
        const base = colors[ci + 1] || '#E74C3C';
        const [r, g, b] = [parseInt(base.slice(1, 3), 16), parseInt(base.slice(3, 5), 16), parseInt(base.slice(5, 7), 16)];
        const pct = c / maxC;
        return <g key={`${ri}-${ci}`}>
          <rect x={pad.left + ci * cell + 1} y={pad.top + ri * cell + 1}
            width={cell - 2} height={cell - 2} rx={2}
            fill={c > 0 ? `rgba(${r},${g},${b},${0.2 + pct * 0.8})` : 'transparent'} />
          {c > 0 && <text x={pad.left + ci * cell + cell / 2} y={pad.top + ri * cell + cell / 2 + 4}
            textAnchor="middle" fontSize={8} fontWeight={600} fill={pct > 0.5 ? 'white' : C.text}>{c}</text>}
        </g>;
      })
    )}
    {ratings.map((r, i) => <text key={`c${i}`} x={pad.left + i * cell + cell / 2} y={pad.top - 6}
      textAnchor="middle" fontSize={8} fill={C.dim}>{r}</text>)}
    {tags.map((t, i) => <text key={`r${i}`} x={pad.left - 4} y={pad.top + i * cell + cell / 2 + 4}
      textAnchor="end" fontSize={8} fill={C.dim}>{t}</text>)}
  </svg>;
}

// ── InfluenceChart ──
function InfluenceChart({ data, maxW, onTagClick, color }: { data: InfluenceResult[]; maxW: number; onTagClick: (t: string) => void; color: string }) {
  const barH = 20, gap = 5, pad = { left: 70, right: 70 };
  const h = (barH + gap) * data.length + 16;
  const plotW = Math.max(maxW - pad.left - pad.right, 100);
  const maxAbs = Math.max(Math.abs(Math.max(...data.map(d => d.net))), Math.abs(Math.min(...data.map(d => d.net))), 0.01);

  return <svg width={maxW} height={h} style={{ display: 'block' }}>
    {data.map((d, i) => {
      const y = 8 + i * (barH + gap);
      const bw = Math.abs(d.net / maxAbs) * plotW;
      return <g key={d.tag} className="bar-hover" onClick={() => onTagClick(d.tag)}>
        <text x={pad.left - 4} y={y + barH / 2 + 4} textAnchor="end" fontSize={9} fill={C.dim}>{d.tag}</text>
        <rect x={pad.left} y={y} width={Math.max(bw, 2)} height={barH} rx={4}
          fill={d.net >= 0 ? color : C.blue} opacity={0.75} />
        <text x={pad.left + Math.max(bw, 2) + 5} y={y + barH / 2 + 4}
          fontSize={8} fontWeight={600}
          fill={d.net >= 0 ? color : C.blue}>
          {d.net > 0 ? '+' : ''}{(d.net * 100).toFixed(0)}%
        </text>
      </g>;
    })}
  </svg>;
}

// ── VoiceChart ──
function VoiceChart({ data, onVoiceClick }: { data: VoiceAnalysis[]; onVoiceClick: (v: string) => void }) {
  const barH = 32, gap = 12, pad = { left: 70, right: 50 };
  const h = (barH + gap) * data.length + 30;
  const maxV = Math.max(...data.map(d => Math.max(d.avgLike, d.avgSing)), 1);

  return <svg width="100%" height={h} viewBox={`0 0 300 ${h}`} style={{ display: 'block' }}>
    {data.map((d, i) => {
      const y = 10 + i * (barH + gap);
      const bwL = (d.avgLike / maxV) * 100;
      const bwS = (d.avgSing / maxV) * 100;
      return <g key={d.voice}>
        <text x={pad.left - 4} y={y + 16} textAnchor="end" fontSize={11} fill={C.text}
          style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: C.dim }}
          onClick={() => onVoiceClick(d.voice)}>{d.label}</text>
        <text x={pad.left - 4} y={y + 28} textAnchor="end" fontSize={8} fill={C.dim}>{d.count}首</text>
        {/* 喜欢度 */}
        <rect x={pad.left} y={y + 2} width={Math.max(bwL, 2)} height={12} rx={4} fill={C.red} opacity={0.7} />
        <text x={pad.left + bwL + 4} y={y + 12} fontSize={8} fill={C.red}>
          喜欢 {d.avgLike.toFixed(1)}
        </text>
        {/* 能唱度 */}
        <rect x={pad.left} y={y + 18} width={Math.max(bwS, 2)} height={12} rx={4} fill={C.purple} opacity={0.7} />
        <text x={pad.left + bwS + 4} y={y + 28} fontSize={8} fill={C.purple}>
          能唱 {d.avgSing.toFixed(1)}
        </text>
      </g>;
    })}
  </svg>;
}

// ── FavoriteTagsChart ──
function FavoriteTagsChart({ data, maxW, onTagClick, color, label }: { data: FavoriteTagResult[]; maxW: number; onTagClick: (t: string) => void; color: string; label: string }) {
  const barH = 18, gap = 4, pad = { left: 60, right: 70 };
  const h = (barH + gap) * data.length + 10;
  const plotW = Math.max(maxW - pad.left - pad.right, 40);
  const maxI = Math.max(...data.map(d => d.importance), 1);

  return <svg width={maxW} height={h} style={{ display: 'block' }}>
    {data.map((d, i) => {
      const y = 5 + i * (barH + gap);
      const bw = (d.importance / maxI) * plotW;
      return <g key={d.tag} className="bar-hover" onClick={() => onTagClick(d.tag)}>
        <text x={pad.left - 4} y={y + barH / 2 + 4} textAnchor="end" fontSize={8} fill={C.dim}>{d.tag}</text>
        <rect x={pad.left} y={y} width={Math.max(bw, 2)} height={barH} rx={4} fill={color} opacity={0.65} />
        <text x={pad.left + bw + 4} y={y + barH / 2 + 4} fontSize={7} fill={C.text}>
          {d.avgScore.toFixed(1)}{label}
        </text>
      </g>;
    })}
  </svg>;
}

// ── AnomalyTable ──
function AnomalyTable({ data, onSelect }: { data: AnomalyResult[]; onSelect: (id: string) => void }) {
  // track songs by title for lookup
  return <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead><tr style={{ borderBottom: '1px solid ' + C.border }}>
        <th style={thL}>歌曲</th><th style={thC}>歌手</th><th style={thC}>评分</th><th style={thC}>预期</th><th style={thC}>偏差</th><th style={thL}>标签</th>
      </tr></thead>
      <tbody>
        {data.map((a, i) => {
          const c = LIKE_COLORS[a.score] || C.text;
          return (
            <tr key={i} style={{ borderBottom: '1px solid ' + C.border, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              <td style={{ ...tdL, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: C.accent, textDecoration: 'underline' }}
                title={a.title} onClick={() => onSelect(a.id)}>{a.title}</td>
              <td style={{ ...tdC, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.artist}</td>
              <td style={{ ...tdC, fontWeight: 700, color: c }}>
                {a.score} <span style={{ fontSize: 9, color: C.dim, fontWeight: 400 }}>({a.ratingLabel})</span>
              </td>
              <td style={{ ...tdC, color: C.dim }}>{a.expected.toFixed(1)}</td>
              <td style={{ ...tdC, fontWeight: 700, color: a.diff > 0 ? C.green : C.red }}>
                {a.diff > 0 ? '+' : ''}{a.diff.toFixed(1)}
              </td>
              <td style={{ ...tdL, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.tags.join(', ')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>;
}
const thL = { padding: '4px 6px', textAlign: 'left' as const, color: C.dim, fontWeight: 600 };
const thC = { padding: '4px 6px', textAlign: 'center' as const, color: C.dim, fontWeight: 600 };
const tdL = { padding: '4px 6px', color: C.text };
const tdC = { padding: '4px 6px', textAlign: 'center' as const, color: C.text };

// ── ArtistBarChart (single metric, one bar per artist) ──
function ArtistBarChart({ data, maxW, color, valueKey, suffix, onArtistClick }: { data: ArtistInfluence[]; maxW: number; color: string; valueKey: 'avgLike' | 'avgSing'; suffix: string; onArtistClick: (a: string) => void }) {
  const barH = 24, gap = 5, pad = { left: 70, right: 70 };
  const h = (barH + gap) * data.length + 16;
  const plotW = Math.max(maxW - pad.left - pad.right, 100);
  const vals = data.map(d => d[valueKey]);
  const maxV = Math.max(...vals, 1);

  return <svg width={maxW} height={h} style={{ display: 'block' }}>
    {data.map((d, i) => {
      const y = 8 + i * (barH + gap);
      const bw = (d[valueKey] / maxV) * plotW;
      return <g key={d.artist} className="bar-hover" onClick={() => onArtistClick(d.artist)}>
        <text x={pad.left - 4} y={y + barH / 2 + 4} textAnchor="end" fontSize={9} fill={C.dim}
          style={{ cursor: 'pointer' }}>
          {d.artist.length > 14 ? d.artist.slice(0, 13) + '…' : d.artist}
        </text>
        <rect x={pad.left} y={y} width={Math.max(bw, 2)} height={barH} rx={5} fill={color} opacity={0.7} />
        <text x={pad.left + bw + 6} y={y + barH / 2 + 4} fontSize={9} fill={C.text}>
          {d[valueKey].toFixed(1)}{suffix} · {d.count}首
        </text>
      </g>;
    })}
  </svg>;
}

// ── Styles ──
const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end',
  },
  panel: {
    height: '100%',
    display: 'flex', flexDirection: 'column',
    background: C.bg, borderLeft: '1px solid ' + C.border,
    overflow: 'hidden', boxShadow: '-20px 0 80px rgba(0,0,0,0.5)',
    animation: 'slideIn 0.3s ease',
  },
  headerBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 24px', borderBottom: '1px solid ' + C.border,
    flexShrink: 0, gap: 10, flexWrap: 'wrap',
  },
  badge: {
    padding: '4px 12px', borderRadius: 20, background: '#16162a', border: '1px solid ' + C.border,
    fontSize: 12, color: C.accent,
  },
  badge2: {
    padding: '4px 12px', borderRadius: 20, background: '#16162a', border: '1px solid ' + C.border,
    fontSize: 11, color: C.accent,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 10, border: '1px solid ' + C.border,
    background: 'transparent', color: C.dim, fontSize: 16, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, overflowY: 'auto', padding: '20px 24px 40px' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 },
  card: { background: '#121224', borderRadius: 14, border: '1px solid ' + C.border, padding: 16, overflow: 'hidden', opacity: 0 },
  cardLabel: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 },
  cardLabel2: { fontSize: 12, fontWeight: 700, color: C.text },
};
