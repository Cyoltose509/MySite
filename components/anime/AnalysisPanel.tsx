'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import type { AnimeItem } from '@/lib/anime-data';
import { runFullAnalysis } from '@/lib/anime-analysis';
import type {
  TagComboResult, TagRatingResult, DropRateResult,
  InfluenceResult, AnomalyResult, FavoriteTagResult,
} from '@/lib/anime-analysis';

const C = {
  bg: '#0c0c1a', card: '#121224', border: '#1e1e32',
  text: '#e4e4e7', dim: '#71717a', accent: '#818cf8',
  green: '#4ade80', red: '#f87171', orange: '#f59e0b', purple: '#a855f7',
};

const RATING_COLORS: Record<string, string> = { '夯': '#E74C3C', '顶级': '#E67E22', '人上人': '#3498DB', 'NPC': '#7F8C8D', '拉完了': '#2C3E50' };

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
  items, onClose, onTagFilter,
}: {
  items: AnimeItem[];
  onClose: () => void;
  onTagFilter: (tag: string) => void;
}) {
  const analysis = useRef(runFullAnalysis(items));
  const a = analysis.current;
  const [panelW, setPanelW] = useState(680);
  const dragging = useRef(false);
  const justDragged = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const [tagCombo, setTagCombo] = useState<TagComboResult | null>(null);
  const [tagRating, setTagRating] = useState<TagRatingResult | null>(null);
  const [dropRates, setDropRates] = useState<DropRateResult[] | null>(null);
  const [influence, setInfluence] = useState<InfluenceResult[] | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyResult[] | null>(null);
  const [favoriteTags, setFavoriteTags] = useState<FavoriteTagResult[] | null>(null);

  useEffect(() => {
    setTimeout(() => setTagCombo(a.tagCombo()), 60);
    setTimeout(() => setTagRating(a.tagRating()), 120);
    setTimeout(() => setDropRates(a.dropRates()), 180);
    setTimeout(() => setInfluence(a.influence()), 240);
    setTimeout(() => setAnomalies(a.anomalies()), 300);
    setTimeout(() => setFavoriteTags(a.favoriteTags()), 360);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = panelW;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [panelW]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = startX.current - e.clientX;
      setPanelW(Math.min(MAX_W, Math.max(MIN_W, startW.current + dx)));
    };
    const onUp = () => {
      if (dragging.current) {
        justDragged.current = true;
        setTimeout(() => { justDragged.current = false; }, 50);
      }
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const s = a.stats;
  // 每个卡片可用宽度 = panelW - padding(24*2) - cardPadding(16*2) - gap(16) / columns(2)
  const cardContentW = (panelW - 48 - 32 - 16) / 2;

  return (
    <div style={styles.backdrop} onClick={() => { if (!justDragged.current) onClose(); }}>
      <style>{KEYFRAMES}</style>
      {/* 面板容器（包含拖拽手柄在左边缘） */}
      <div style={{ position: 'relative', flexShrink: 0, height: '100%' }} onClick={e => e.stopPropagation()}>
        {/* 拖拽手柄：紧贴面板左边缘 */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 6,
          cursor: 'ew-resize', zIndex: 10000,
        }} onMouseDown={onMouseDown} onClick={e => e.stopPropagation()} />
        <div style={{ ...styles.panel, width: panelW }} onClick={e => e.stopPropagation()}>
          <div style={styles.headerBar}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text }}>📊 番剧偏好分析</h2>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={styles.badge}>{s.total} 部番剧 · {a.allTags.length} 标签</span>
              <span style={styles.badge2}>加权平均 {s.avgScore.toFixed(1)} 分</span>
              <span style={{ ...styles.badge2, color: C.orange }}>弃坑 {s.dropped} 部</span>
              <button onClick={onClose} style={styles.closeBtn}>✕</button>
            </div>
          </div>

          <div style={styles.body}>
            <div style={styles.row}>
              <div style={{ ...styles.card, animationDelay: '0.05s' }} className="card-enter">
                <div style={styles.cardLabel}>标签组合默契度</div>
                {tagCombo ? <TagComboHeatmap data={tagCombo} onTagClick={onTagFilter} /> : <Spinner />}
              </div>
              <div style={{ ...styles.card, animationDelay: '0.1s' }} className="card-enter">
                <div style={styles.cardLabel}>标签 × 评级 出现次数</div>
                {tagRating ? <TagRatingHeatmap data={tagRating} /> : <Spinner />}
              </div>
            </div>

            <div style={styles.row}>
              <div style={{ ...styles.card, animationDelay: '0.15s' }} className="card-enter">
                <div style={styles.cardLabel}>容易弃坑的标签</div>
                {dropRates ? <DropRateChart data={dropRates.slice(0, 15)} maxW={cardContentW} onTagClick={onTagFilter} /> : <Spinner />}
              </div>
              <div style={{ ...styles.card, animationDelay: '0.2s' }} className="card-enter">
                <div style={styles.cardLabel}>标签影响力</div>
                {influence ? <InfluenceChart data={influence.slice(0, 15)} maxW={cardContentW} onTagClick={onTagFilter} /> : <Spinner />}
              </div>
            </div>

            <div style={styles.row}>
              <div style={{ ...styles.card, animationDelay: '0.25s' }} className="card-enter">
                <div style={styles.cardLabel}>评分反常的作品</div>
                {anomalies ? <AnomalyTable data={anomalies.slice(0, 15)} /> : <Spinner />}
              </div>
              <div style={{ ...styles.card, animationDelay: '0.3s' }} className="card-enter">
                <div style={styles.cardLabel}>最喜欢的标签 (频次加权)</div>
                {favoriteTags ? <FavoriteTagsChart data={favoriteTags.slice(0, 15)} maxW={cardContentW} onTagClick={onTagFilter} /> : <Spinner />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TagComboHeatmap ──
function TagComboHeatmap({ data, onTagClick }: { data: TagComboResult; onTagClick: (t: string) => void }) {
  const { tags, matrix, counts } = data;
  const cell = 28, pad = { top: 50, bottom: 6, left: 70, right: 6 };
  const K = tags.length;
  const w = pad.left + K * cell + pad.right, h = pad.top + K * cell + pad.bottom;

  return <svg width={w} height={h} style={{ display: 'block' }}>
    {Array.from({ length: K }, (_, ri) =>
      Array.from({ length: K }, (_, ci) => {
        if (ri === ci) return null;
        const v = matrix[ri][ci];
        const n = counts[ri][ci];
        if (n < 3) return null;
        const isHigh = !isNaN(v) && v > 3.5;
        const color = isNaN(v) ? '#333' : isHigh ? '#27AE60' : '#E74C3C';
        return <g key={`${ri}-${ci}`}>
          <rect x={pad.left + ci * cell + 1} y={pad.top + ri * cell + 1}
            width={cell - 2} height={cell - 2} rx={3} fill={color} opacity={isNaN(v) ? 0.2 : 0.7} />
          {!isNaN(v) && <text x={pad.left + ci * cell + cell / 2} y={pad.top + ri * cell + cell / 2 + 4}
            textAnchor="middle" fontSize={7} fontWeight={700} fill="white">{v.toFixed(1)}</text>}
        </g>;
      })
    )}
    {tags.map((t, i) => (
      <text key={`r${i}`} x={pad.left - 4} y={pad.top + i * cell + cell / 2 + 4}
        textAnchor="end" fontSize={8} fill={C.dim} style={{ cursor: 'pointer' }}
        onClick={() => onTagClick(t)}>{t}</text>
    ))}
    {tags.map((t, i) => (
      <text key={`c${i}`} x={pad.left + i * cell + cell / 2} y={30}
        textAnchor="start" fontSize={8} fill={C.dim} style={{ cursor: 'pointer' }}
        onClick={() => onTagClick(t)}
        transform={`rotate(-45, ${pad.left + i * cell + cell / 2}, 30)`}>{t}</text>
    ))}
  </svg>;
}

// ── TagRatingHeatmap ──
function TagRatingHeatmap({ data }: { data: TagRatingResult }) {
  const cell = 24, pad = { top: 24, bottom: 6, left: 64, right: 6 };
  const { tags, ratings, counts } = data;
  const K = tags.length, J = ratings.length;
  const w = pad.left + J * cell + pad.right, h = pad.top + K * cell + pad.bottom;
  const maxC = Math.max(...counts.flat(), 1);

  return <svg width={w} height={h} style={{ display: 'block' }}>
    {Array.from({ length: K }, (_, ri) =>
      Array.from({ length: J }, (_, ci) => {
        const c = counts[ri][ci];
        const pct = c / maxC;
        return <g key={`${ri}-${ci}`}>
          <rect x={pad.left + ci * cell + 1} y={pad.top + ri * cell + 1}
            width={cell - 2} height={cell - 2} rx={2}
            fill={c > 0 ? `rgba(231,76,60,${0.2 + pct * 0.8})` : 'transparent'} />
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

// ── DropRateChart ──
function DropRateChart({ data, maxW, onTagClick }: { data: DropRateResult[]; maxW: number; onTagClick: (t: string) => void }) {
  const barH = 22, gap = 5, pad = { left: 70, right: 70 };
  const h = (barH + gap) * data.length + 20;
  const plotW = Math.max(maxW - pad.left - pad.right, 100);
  const maxRate = Math.max(...data.map(d => d.rate), 0.1);

  return <svg width={maxW} height={h} style={{ display: 'block' }}>
    {data.map((d, i) => {
      const y = 10 + i * (barH + gap);
      const bw = (d.rate / maxRate) * plotW;
      return <g key={d.tag} className="bar-hover" onClick={() => onTagClick(d.tag)}>
        <text x={pad.left - 4} y={y + barH / 2 + 4} textAnchor="end" fontSize={9} fill={C.dim}>{d.tag}</text>
        <rect x={pad.left} y={y} width={Math.max(bw, 2)} height={barH} rx={5}
          fill={d.rate > 0.3 ? '#E74C3C' : '#27AE60'} opacity={0.75} />
        <text x={pad.left + bw + 4} y={y + barH / 2 + 4} fontSize={9} fontWeight={600} fill={C.text}>
          {d.dropped}/{d.total} ({(d.rate * 100).toFixed(0)}%)
        </text>
      </g>;
    })}
  </svg>;
}

// ── InfluenceChart: 左对齐柱状图，正向红色向右，负向蓝色也向右 ──
function InfluenceChart({ data, maxW, onTagClick }: { data: InfluenceResult[]; maxW: number; onTagClick: (t: string) => void }) {
  const barH = 22, gap = 5, pad = { left: 70, right: 70 };
  const h = (barH + gap) * data.length + 20;
  const plotW = Math.max(maxW - pad.left - pad.right, 100);
  const maxAbs = Math.max(Math.abs(Math.max(...data.map(d => d.net))), Math.abs(Math.min(...data.map(d => d.net))), 0.01);

  return <svg width={maxW} height={h} style={{ display: 'block' }}>
    {data.map((d, i) => {
      const y = 8 + i * (barH + gap);
      const bw = Math.abs(d.net / maxAbs) * plotW;
      return <g key={d.tag} className="bar-hover" onClick={() => onTagClick(d.tag)}>
        {/* 标签左对齐 */}
        <text x={pad.left - 4} y={y + barH / 2 + 4} textAnchor="end" fontSize={9} fill={C.dim}>{d.tag}</text>
        {/* 柱子从左边开始，跟其他图表一致 */}
        <rect x={pad.left} y={y} width={Math.max(bw, 2)} height={barH} rx={4}
          fill={d.net >= 0 ? '#E74C3C' : '#3498DB'} opacity={0.75} />
        {/* 数值在柱子末端 */}
        <text x={pad.left + Math.max(bw, 2) + 5} y={y + barH / 2 + 4}
          fontSize={8} fontWeight={600}
          fill={d.net >= 0 ? '#E74C3C' : '#3498DB'}>
          {d.net > 0 ? '+' : ''}{(d.net * 100).toFixed(0)}%
        </text>
      </g>;
    })}
  </svg>;
}

// ── AnomalyTable ──
function AnomalyTable({ data }: { data: AnomalyResult[] }) {
  return <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead><tr style={{ borderBottom: '1px solid ' + C.border }}>
        <th style={thL}>作品</th><th style={thC}>加权分</th><th style={thC}>预期分</th><th style={thC}>偏差</th><th style={thL}>标签</th>
      </tr></thead>
      <tbody>
        {data.map((a, i) => (
          <tr key={i} style={{ borderBottom: '1px solid ' + C.border, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
            <td style={{ ...tdL, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.title}>{a.title}</td>
            <td style={{ ...tdC, fontWeight: 700, color: RATING_COLORS[a.rating] || C.text }}>
              {a.score.toFixed(1)} <span style={{ fontSize: 9, color: C.dim, fontWeight: 400 }}>({a.rating})</span>
            </td>
            <td style={{ ...tdC, color: C.dim }}>{a.expected.toFixed(1)}</td>
            <td style={{ ...tdC, fontWeight: 700, color: a.diff > 0 ? C.green : C.red }}>
              {a.diff > 0 ? '+' : ''}{a.diff.toFixed(1)}
            </td>
            <td style={{ ...tdL, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.tags.join(', ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}
const thL = { padding: '6px 8px', textAlign: 'left' as const, color: C.dim, fontWeight: 600 };
const thC = { padding: '6px 8px', textAlign: 'center' as const, color: C.dim, fontWeight: 600 };
const tdL = { padding: '6px 8px', color: C.text };
const tdC = { padding: '6px 8px', textAlign: 'center' as const, color: C.text };

// ── FavoriteTagsChart ──
function FavoriteTagsChart({ data, maxW, onTagClick }: { data: FavoriteTagResult[]; maxW: number; onTagClick: (t: string) => void }) {
  const barH = 22, gap = 5, pad = { left: 70, right: 110 };
  const h = (barH + gap) * data.length + 16;
  const plotW = Math.max(maxW - pad.left - pad.right, 100);
  const maxI = Math.max(...data.map(d => d.importance), 1);

  return <svg width={maxW} height={h} style={{ display: 'block' }}>
    {data.map((d, i) => {
      const y = 8 + i * (barH + gap);
      const bw = (d.importance / maxI) * plotW;
      return <g key={d.tag} className="bar-hover" onClick={() => onTagClick(d.tag)}>
        <text x={pad.left - 4} y={y + barH / 2 + 4} textAnchor="end" fontSize={9} fill={C.dim}>{d.tag}</text>
        <rect x={pad.left} y={y} width={Math.max(bw, 2)} height={barH} rx={5} fill={C.purple} opacity={0.7} />
        <text x={pad.left + bw + 6} y={y + barH / 2 + 4} fontSize={9} fill={C.text}>
          {d.avgScore.toFixed(1)}分 · {d.freq}部
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
};
