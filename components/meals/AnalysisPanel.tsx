'use client';

import type { CSSProperties } from 'react';

const C = {
  bg: '#0c0c1a', card: '#121224', border: '#1e1e32',
  text: '#e4e4e7', dim: '#71717a', accent: '#818cf8',
};

const RATING_COLORS: Record<string, string> = {
  '夯': '#a855f7', '顶级': '#4ade80', '人上人': '#eab308', 'NPC': '#6b7280', '拉完了': '#f87171',
};
const RATING_ORDER = ['夯', '顶级', '人上人', 'NPC', '拉完了'];

const KEYFRAMES = `
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.card-enter { animation: fadeIn 0.35s ease both; }
`;

export interface MealAnalysisItem {
  id: string;
  title: string;
  rating: string;
  tags: string[];
  eatCount: number;
  totalSpent: number;
}

export default function AnalysisPanel({
  items, totalMeals, onClose,
}: {
  items: MealAnalysisItem[];
  totalMeals: number;
  onClose: () => void;
}) {
  // Rating distribution
  const ratingDist = RATING_ORDER.map(r => ({
    rating: r,
    count: items.filter(m => m.rating === r).length,
  })).filter(d => d.count > 0);

  // Most eaten
  const topEaten = [...items].sort((a, b) => b.eatCount - a.eatCount).filter(m => m.eatCount > 0).slice(0, 10);

  // Tag distribution
  const tagCounts: Record<string, number> = {};
  for (const m of items) for (const t of m.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const maxTag = Math.max(1, ...topTags.map(([, c]) => c));

  // Spending stats
  const totalSpent = items.reduce((s, m) => s + m.totalSpent, 0);
  const totalEats = items.reduce((s, m) => s + m.eatCount, 0);
  const avgSpent = totalEats > 0 ? (totalSpent / totalEats).toFixed(2) : '--';

  const tagged = items.filter(m => m.rating !== 'NPC' || m.tags.length > 0).length;

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)',
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 680, maxWidth: '90vw', background: C.bg, borderLeft: '1px solid ' + C.border,
          display: 'flex', flexDirection: 'column', animation: 'slideIn 0.25s ease',
          boxShadow: '-8px 0 30px rgba(0,0,0,0.5)', overflowY: 'auto',
        }}>
          {/* Header */}
          <div style={{ padding: '20px 28px 12px', borderBottom: '1px solid ' + C.border }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>🍽️ 美食分析</h2>
              <button onClick={onClose} style={{
                padding: '4px 12px', borderRadius: 8, border: '1px solid ' + C.border,
                background: 'transparent', color: C.text, fontSize: 13, cursor: 'pointer',
              }}>✕</button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: C.dim }}>
              {totalMeals} 种美食 · {tagged} 种已标记 · 累计消费 ¥{totalSpent.toFixed(2)}
              {totalEats > 0 && ` · 共 ${totalEats} 次`}
            </div>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

              {/* Rating distribution */}
              <div className="card-enter" style={cardStyle}>
                <h3 style={h3Style}>🏷 评级分布</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {ratingDist.map(r => {
                    const pct = Math.round((r.count / items.length) * 100);
                    return (
                      <div key={r.rating} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 40, fontSize: 11, color: C.text }}>{r.rating}</span>
                        <div style={{ flex: 1, height: 14, borderRadius: 4, background: '#1a1a2e' }}>
                          <div style={{ height: '100%', borderRadius: 4, background: RATING_COLORS[r.rating] || C.dim, width: `${pct}%`, minWidth: pct > 0 ? 2 : 0 }} />
                        </div>
                        <span style={{ width: 36, textAlign: 'right', fontSize: 11, color: C.dim }}>{r.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Most eaten */}
              <div className="card-enter" style={{ ...cardStyle, animationDelay: '0.05s' }}>
                <h3 style={h3Style}>🍴 吃得最多</h3>
                {topEaten.length === 0 ? (
                  <p style={{ fontSize: 12, color: C.dim }}>暂无记录</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {topEaten.map((m, i) => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: C.dim, width: 16 }}>{i + 1}</span>
                        <span style={{ fontSize: 12, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                        <span style={{ fontSize: 11, color: C.accent, fontWeight: 600 }}>{m.eatCount}次</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tag distribution */}
              <div className="card-enter" style={{ ...cardStyle, gridColumn: '1 / -1', animationDelay: '0.1s' }}>
                <h3 style={h3Style}>🏷 标签分布</h3>
                {topTags.length === 0 ? (
                  <p style={{ fontSize: 12, color: C.dim }}>暂无标签</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {topTags.map(([tag, count]) => {
                      const pct = Math.round((count / maxTag) * 100);
                      return (
                        <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 64, fontSize: 11, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                          <div style={{ flex: 1, height: 12, borderRadius: 4, background: '#1a1a2e' }}>
                            <div style={{ height: '100%', borderRadius: 4, background: C.accent, width: `${pct}%`, minWidth: pct > 0 ? 2 : 0 }} />
                          </div>
                          <span style={{ width: 28, textAlign: 'right', fontSize: 11, color: C.dim }}>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Spending stats */}
              <div className="card-enter" style={{ ...cardStyle, animationDelay: '0.15s' }}>
                <h3 style={h3Style}>💰 消费统计</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: C.dim }}>累计消费</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#a5b4fc' }}>¥{totalSpent.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: C.dim }}>平均每次</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#c4b5fd' }}>¥{avgSpent}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: C.dim }}>消费记录</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{totalEats}次</span>
                  </div>
                </div>
              </div>

              {/* Top spender meals */}
              <div className="card-enter" style={{ ...cardStyle, animationDelay: '0.2s' }}>
                <h3 style={h3Style}>💸 消费最多</h3>
                {items.filter(m => m.totalSpent > 0).length === 0 ? (
                  <p style={{ fontSize: 12, color: C.dim }}>暂无记录</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {items.filter(m => m.totalSpent > 0).sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 8).map((m, i) => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: C.dim, width: 16 }}>{i + 1}</span>
                        <span style={{ fontSize: 12, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                        <span style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 600 }}>¥{m.totalSpent.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const cardStyle: CSSProperties = { padding: 16, borderRadius: 12, background: C.card, border: '1px solid ' + C.border };
const h3Style: CSSProperties = { fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 12px' };
