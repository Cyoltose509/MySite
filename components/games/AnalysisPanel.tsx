'use client';

import { useRef, useState } from 'react';
import type { GameAnalysisItem } from '@/lib/game-analysis';
import {
  ratingDistribution, mostPlayed, tagDistribution, tagRatingMatrix,
} from '@/lib/game-analysis';

const C = {
  bg: '#0c0c1a', card: '#121224', border: '#1e1e32',
  text: '#e4e4e7', dim: '#71717a', accent: '#818cf8',
  green: '#4ade80', red: '#f87171', orange: '#f59e0b', purple: '#a855f7',
};

const RATING_COLORS: Record<string, string> = {
  '夯': '#a855f7', '顶级': '#4ade80', '人上人': '#eab308', 'NPC': '#6b7280', '拉完了': '#f87171', '未评级': '#3f3f46',
};

const RATING_ORDER = ['夯', '顶级', '人上人', 'NPC', '拉完了', '未评级'];

const KEYFRAMES = `
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.card-enter { animation: fadeIn 0.35s ease both; }
`;

const MIN_W = 420, MAX_W = 1100;

function fmtPlaytime(min: number) {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export default function AnalysisPanel({
  items, onClose,
}: {
  items: GameAnalysisItem[];
  onClose: () => void;
}) {
  const [panelW, setPanelW] = useState(680);
  const dragging = useRef(false);
  const justDragged = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    justDragged.current = false;
    startX.current = e.clientX;
    startW.current = panelW;
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dx = startX.current - ev.clientX;
      const newW = Math.min(MAX_W, Math.max(MIN_W, startW.current + dx));
      setPanelW(newW);
      if (Math.abs(dx) > 3) justDragged.current = true;
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const ratings = ratingDistribution(items);
  const topGames = mostPlayed(items, 10);
  const tags = tagDistribution(items).slice(0, 15);
  const trMatrix = tagRatingMatrix(items);
  const maxTagCount = Math.max(...trMatrix.cells.map(c => c.count), 1);
  const taggedCount = items.filter(g => g.rating).length;

  const totalPlaytime = items.reduce((s, g) => s + g.playtime_forever, 0);

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)',
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: panelW, background: C.bg, borderLeft: '1px solid ' + C.border,
          display: 'flex', flexDirection: 'column', animation: 'slideIn 0.25s ease',
          boxShadow: '-8px 0 30px rgba(0,0,0,0.5)',
        }}>
          {/* handle */}
          <div onMouseDown={onMouseDown} style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 1,
          }} />

          {/* header */}
          <div style={{ padding: '20px 28px 12px', borderBottom: '1px solid ' + C.border }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>🎮 游戏分析</h2>
              <button onClick={onClose} style={{
                padding: '4px 12px', borderRadius: 8, border: '1px solid ' + C.border,
                background: 'transparent', color: C.text, fontSize: 13, cursor: 'pointer',
              }}>✕</button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: C.dim }}>
              {items.length} 款游戏 · {taggedCount} 款已评级 · 总时长 {fmtPlaytime(totalPlaytime)}
            </div>
          </div>

          {/* content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

              {/* 评级分布 */}
              <div className="card-enter" style={{ padding: 16, borderRadius: 12, background: C.card, border: '1px solid ' + C.border }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 12px' }}>🏷 评级分布</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {RATING_ORDER.filter(r => ratings.find(d => d.rating === r)).map(r => {
                    const d = ratings.find(d2 => d2.rating === r)!;
                    const pct = Math.round((d.count / items.length) * 100);
                    return (
                      <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 40, fontSize: 11, color: C.text }}>{r}</span>
                        <div style={{ flex: 1, height: 14, borderRadius: 4, background: '#1a1a2e' }}>
                          <div style={{ height: '100%', borderRadius: 4, background: RATING_COLORS[r] || C.dim, width: `${pct}%`, minWidth: pct > 0 ? 2 : 0 }} />
                        </div>
                        <span style={{ width: 36, textAlign: 'right', fontSize: 11, color: C.dim }}>{d.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 最常玩 */}
              <div className="card-enter" style={{ animationDelay: '0.05s', padding: 16, borderRadius: 12, background: C.card, border: '1px solid ' + C.border }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 12px' }}>🕐 最常玩</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {topGames.slice(0, 8).map((g, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                      <span style={{ color: C.dim, width: 16 }}>{i + 1}.</span>
                      <span style={{ flex: 1, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.title}</span>
                      <span style={{ color: C.dim, flexShrink: 0 }}>{fmtPlaytime(g.playtime)}</span>
                      {g.rating && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: RATING_COLORS[g.rating] + '33', color: RATING_COLORS[g.rating], flexShrink: 0 }}>{g.rating}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* 标签热度 TOP15 */}
              {tags.length > 0 && (
                <div className="card-enter" style={{ animationDelay: '0.1s', padding: 16, borderRadius: 12, background: C.card, border: '1px solid ' + C.border }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 12px' }}>📌 标签热度 TOP15</h3>
                  <svg viewBox={`0 0 320 ${tags.length * 22 + 10}`} width="100%" height={tags.length * 22 + 10}>
                    {tags.map((t, i) => {
                      const w = (t.count / Math.max(...tags.map(x => x.count))) * 180;
                      return (
                        <g key={t.tag}>
                          <text x={0} y={i * 22 + 16} fontSize={11} fill={C.dim} textAnchor="start">{t.tag}</text>
                          <rect x={80} y={i * 22 + 6} width={w} height={16} rx={3} fill={C.accent} opacity={0.5} />
                          <text x={85 + w} y={i * 22 + 18} fontSize={10} fill={C.dim}>{t.count}</text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}

              {/* 评级 x 标签热力图 */}
              {trMatrix.tags.length > 0 && trMatrix.ratings.length > 0 && (
                <div className="card-enter" style={{ animationDelay: '0.15s', padding: 16, borderRadius: 12, background: C.card, border: '1px solid ' + C.border }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 12px' }}>🔥 标签 x 评级</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '2px 6px', color: C.dim, textAlign: 'left', fontWeight: 400 }}></th>
                          {trMatrix.ratings.map(r => (
                            <th key={r} style={{ padding: '2px 6px', color: C.dim, fontWeight: 400 }}>{r}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {trMatrix.tags.map(tag => (
                          <tr key={tag}>
                            <td style={{ padding: '2px 6px', color: C.dim, whiteSpace: 'nowrap' }}>{tag}</td>
                            {trMatrix.ratings.map(rating => {
                              const cell = trMatrix.cells.find(c => c.tag === tag && c.rating === rating)!;
                              const intensity = cell.count / Math.max(maxTagCount, 1);
                              return (
                                <td key={rating} style={{
                                  padding: '2px 6px', textAlign: 'center',
                                  background: cell.count > 0 ? `${C.accent}${Math.round(intensity * 60).toString(16).padStart(2, '0')}` : 'transparent',
                                  color: cell.count > 0 ? C.text : C.border,
                                }}>{cell.count || '-'}</td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
