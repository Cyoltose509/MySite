'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { isAuthenticated } from '@/lib/auth';
import { MOOD_SCORE_LABELS, MOOD_EMOJIS, TIME_SCALES, type TimeScale } from '@/lib/types';
import { C } from '@/lib/card-styles';

interface MoodLog {
  id: string;
  mood: string;
  note?: string;
  mood_score?: number;
  visibility: 'public' | 'private';
  created_at: string;
}

interface AggPoint {
  ts: number;
  avg: number;
  count: number;
  notes: string[];
}

// 图表尺寸（viewBox，宽度随容器自适应，不做横向滚动）
const W = 720;
const H = 300;
const PAD_L = 44;
const PAD_R = 16;
const PAD_T = 18;
const PAD_B = 34;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

// Catmull-Rom 样条：把折线连成丝滑曲线（与 /predict 同款）
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}` : '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export default function MoodPage() {
  const [logs, setLogs] = useState<MoodLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState<TimeScale>('daily');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    // 公开 RPC：任何人（含未登录访客）都能读到每条心情的分数；
    // 私密条目的 note 在数据库层已被置空，前端永远拿不到私密文本，也无需任何区分 UI。
    const { data } = await supabase.rpc('fn_get_mood_logs_public');
    let all: MoodLog[] = [];
    if (data && Array.isArray(data)) {
      all = (data as Array<Record<string, unknown>>).map((m) => ({
        id: m.id as string,
        mood: (m.mood as string) || '',
        note: (m.note as string) || undefined,
        mood_score: (m.mood_score as number) || undefined,
        visibility: (m.visibility as 'public' | 'private') || 'public',
        created_at: m.created_at as string,
      }));
      all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    setLogs(all);
    setLoading(false);
  };

  // 按时间尺度聚合 mood_score（无论公开/私密，分数都进趋势）
  const points = useMemo<AggPoint[]>(() => {
    if (!logs.length) return [];
    const alignDown = (ts: number): number => {
      const d = new Date(ts);
      switch (scale) {
        case 'hourly': d.setMinutes(0, 0, 0); return d.getTime();
        case 'daily': d.setHours(0, 0, 0, 0); return d.getTime();
        case 'weekly': { d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d.getTime(); }
        case 'monthly': { d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }
        case 'yearly': { d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d.getTime(); }
      }
    };

    const groups: Record<string, { scores: number[]; notes: string[] }> = {};
    for (const l of logs) {
      if (!l.mood_score) continue;
      const key = String(alignDown(new Date(l.created_at).getTime()));
      if (!groups[key]) groups[key] = { scores: [], notes: [] };
      groups[key].scores.push(l.mood_score);
      // 私密心情的 note 已在数据库层置空，这里只在有文本时展示（无需区分公开/私密）
      if (l.note) {
        groups[key].notes.push(l.note);
      }
    }

    return Object.keys(groups).sort().map(key => ({
      ts: Number(key),
      avg: groups[key].scores.reduce((a, b) => a + b, 0) / groups[key].scores.length,
      count: groups[key].scores.length,
      notes: groups[key].notes.slice(0, 3),
    }));
  }, [logs, scale]);

  const fmtLabel = (ts: number): string => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    switch (scale) {
      case 'hourly': return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:00`;
      case 'daily': return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
      case 'weekly': return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
      case 'monthly': return `${d.getFullYear()}/${pad(d.getMonth() + 1)}`;
      case 'yearly': return `${d.getFullYear()}`;
    }
  };

  const latestScore = logs.filter(l => l.mood_score).slice(-1)[0]?.mood_score;

  // 坐标系
  const xAt = (i: number) => PAD_L + (points.length <= 1 ? 0 : (i / (points.length - 1)) * PLOT_W);
  const yAt = (v: number) => PAD_T + PLOT_H - (Math.min(10, Math.max(0, v)) / 10) * PLOT_H;

  // 平滑曲线 + 面积
  const linePts = points.map((p, i) => ({ x: xAt(i), y: yAt(p.avg) }));
  const meanPath = smoothPath(linePts);
  const areaPath = linePts.length
    ? `${meanPath} L ${xAt(points.length - 1).toFixed(1)} ${(PAD_T + PLOT_H).toFixed(1)} L ${xAt(0).toFixed(1)} ${(PAD_T + PLOT_H).toFixed(1)} Z`
    : '';

  const yTicks = [10, 8, 6, 4, 2, 0];
  const xTickStep = Math.max(1, Math.ceil(points.length / 12));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (points.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (x - PAD_L) / PLOT_W;
    const idx = Math.max(0, Math.min(points.length - 1, Math.round(frac * (points.length - 1))));
    setHoverIdx(idx);
  };

  if (loading) {
    return <div style={S.loading}><div style={S.spinner} /><p>加载中...</p></div>;
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={backLinkStyle}>← 首页</Link>
        <h1 style={h1Style}>🧠 心情记录</h1>
        <span style={countBadgeStyle}>{logs.length} 条</span>
        {isAuthenticated() && (<Link href="/admin" style={S.adminLink}>管理 →</Link>)}
      </header>

      {/* 当前心情指示 */}
      {latestScore && (
        <div style={{
          textAlign: 'center', padding: '16px 20px', borderRadius: 16,
          background: C.surface, border: '1px solid ' + C.borderLit, marginBottom: 24,
        }}>
          <div style={{ fontSize: 13, color: C.textSec, marginBottom: 4 }}>最近心情</div>
          <div style={{ fontSize: 48, lineHeight: 1 }}>{MOOD_EMOJIS[(latestScore || 6) - 1]}</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: C.text }}>{latestScore}/10</div>
          <div style={{ fontSize: 14, color: C.accentLt }}>{MOOD_SCORE_LABELS[latestScore]}</div>
        </div>
      )}

      {/* 尺度选择 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {TIME_SCALES.map(s => (
          <button key={s.value} onClick={() => setScale(s.value)} style={{
            padding: '5px 12px', borderRadius: 14, fontSize: 12, outline: 'none',
            border: `1px solid ${scale === s.value ? C.accent : C.border}`,
            background: scale === s.value ? C.accent + '22' : 'transparent',
            color: scale === s.value ? C.accentLt : C.textSec, cursor: 'pointer',
          }}>{s.label}</button>
        ))}
        <span style={{ fontSize: 11, color: C.textDead, marginLeft: 'auto' }}>{points.length} 个数据点</span>
      </div>

      {/* 折线图 */}
      {points.length > 1 ? (
        <div ref={chartRef} style={{ position: 'relative', borderRadius: 16, border: '1px solid ' + C.border, background: C.surface, marginBottom: 12 }}>
          {/* 图例 */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 11, color: C.textSec, padding: '12px 16px 0' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 18, height: 3, background: C.purple, borderRadius: 2, display: 'inline-block' }} /> 心情均分
            </span>
          </div>

          {/* Tooltip（HTML 浮层） */}
          {hoverIdx != null && points[hoverIdx] && (
            <div style={{
              position: 'absolute',
              left: `calc(${(xAt(hoverIdx) / W) * 100}% + 12px)`,
              top: 8, zIndex: 20, padding: '10px 14px', borderRadius: 10,
              background: C.card, border: '1px solid ' + C.borderLit,
              boxShadow: '0 4px 16px rgba(0,0,0,.6)', minWidth: 150, maxWidth: 240,
              pointerEvents: 'none',
            }}>
              <div style={{ fontSize: 11, color: C.textSec, marginBottom: 4 }}>{fmtLabel(points[hoverIdx].ts)}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>
                {MOOD_EMOJIS[Math.round(points[hoverIdx].avg) - 1] || ''} {points[hoverIdx].avg.toFixed(1)}/10
              </div>
              <div style={{ fontSize: 12, color: C.accentLt }}>
                {MOOD_SCORE_LABELS[Math.round(points[hoverIdx].avg)] || ''} · {points[hoverIdx].count} 条
              </div>
              {points[hoverIdx].notes.length > 0 && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  {points[hoverIdx].notes.map((n, ni) => (
                    <div key={ni} style={{ fontSize: 11, color: C.text, lineHeight: 1.5 }}>&quot;{n}&quot;</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: '100%', height: 'auto', display: 'block', fontFamily: 'sans-serif', marginTop: 4, cursor: 'crosshair' }}
            onMouseMove={onMove}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <defs>
              <linearGradient id="moodAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.purple} stopOpacity={0.35} />
                <stop offset="100%" stopColor={C.purple} stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* 横向网格 + Y 轴标签 */}
            {yTicks.map(level => {
              const y = yAt(level);
              return (
                <g key={level}>
                  <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={C.border} strokeWidth={1} strokeDasharray="3 4" opacity={0.3} />
                  <text x={PAD_L - 8} y={y + 3} textAnchor="end" fontSize={10} fill={C.textDead}>{level}</text>
                </g>
              );
            })}

            {/* 渐变面积 */}
            {areaPath && <path d={areaPath} fill="url(#moodAreaGrad)" stroke="none" />}

            {/* 平滑曲线 */}
            {meanPath && <path d={meanPath} fill="none" stroke={C.purple} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />}

            {/* 悬停竖向引导线 + 高亮点 */}
            {hoverIdx != null && (() => {
              const x = xAt(hoverIdx);
              const y = yAt(points[hoverIdx].avg);
              return (
                <g>
                  <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + PLOT_H} stroke={C.textSec} strokeWidth={1} opacity={0.5} />
                  <circle cx={x} cy={y} r={5} fill={C.purple} stroke={C.surface} strokeWidth={2} />
                </g>
              );
            })()}

            {/* 数据点 */}
            {points.map((p, i) => {
              const x = xAt(i);
              const y = yAt(p.avg);
              return (
                <g key={p.ts}>
                  <circle cx={x} cy={y} r={4} fill={C.purple} opacity={0.95} />
                  {/* 稀疏 X 轴标签 */}
                  {i % xTickStep === 0 && (
                    <text x={x} y={H - 10} textAnchor="middle" fontSize={10} fill={C.textDead}>{fmtLabel(p.ts)}</text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <p style={emptyStyle}>数据点太少，至少需要 2 条记录才能生成图表</p>
      )}

      {/* 最近记录列表 */}
      <div style={{ marginTop: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: '0 0 14px' }}>最近记录</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {logs.slice(-20).reverse().map(log => (
            <div key={log.id} style={S.logRow}>
              <span style={{ fontSize: 20, minWidth: 30, textAlign: 'center' }}>{MOOD_EMOJIS[(log.mood_score || 6) - 1]}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{log.mood_score}/10 {MOOD_SCORE_LABELS[log.mood_score || 6] || ''}</span>
              {log.note && (
                <span style={{ fontSize: 12, color: C.textSec, flex: 1, whiteSpace: 'pre-wrap' }}>{log.note}</span>
              )}
              <span style={{ fontSize: 11, color: C.textDead, fontFamily: 'monospace', marginLeft: 'auto' }}>
                {new Date(log.created_at).toLocaleDateString('zh-CN')} {new Date(log.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {};
S.loading = { minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 };
S.spinner = { width: 36, height: 36, borderRadius: '50%', border: '3px solid ' + C.border, borderTopColor: C.accent, animation: 'spin 0.8s linear infinite' };
S.adminLink = { padding: '6px 14px', borderRadius: 10, border: '1px solid ' + C.borderLit, color: C.accentLt, fontSize: 12, textDecoration: 'none' };
S.logRow = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
  borderRadius: 10, background: C.surface, border: '1px solid ' + C.border,
};
const pageStyle: React.CSSProperties = { minHeight: '100vh', maxWidth: 1000, margin: '0 auto', padding: '28px 20px 40px' };
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 };
const backLinkStyle: React.CSSProperties = { fontSize: 13, color: C.textDim, textDecoration: 'none' };
const h1Style: React.CSSProperties = { fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, flex: 1 };
const countBadgeStyle: React.CSSProperties = { padding: '4px 14px', borderRadius: 20, background: C.card, border: '1px solid ' + C.borderLit, fontSize: 13, color: C.accentLt };
const emptyStyle: React.CSSProperties = { textAlign: 'center', color: C.textDead, fontSize: 13, padding: 48, lineHeight: 1.5 };
