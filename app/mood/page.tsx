'use client';

import { useEffect, useState, useMemo } from 'react';
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

const CHART_H = 300;
const PAD_T = 10;
const PAD_B = 50;
const PAD_L = 50;
const PAD_R = 30;
const DOT_R = 5;
const LINE_COLOR = '#a78bfa';

export default function MoodPage() {
  const [logs, setLogs] = useState<MoodLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState<TimeScale>('daily');

  useEffect(() => { fetchLogs(); }, []);

  const fetchLogs = async () => {
    let q = supabase.from('mood_logs').select('*').order('created_at', { ascending: true }).limit(500);
    if (!isAuthenticated()) q = q.eq('visibility', 'public');
    const { data } = await q;
    setLogs(data || []);
    setLoading(false);
  };

  // 按时间尺度聚合 mood_score 平均值
  const points = useMemo(() => {
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

    const groups: Record<string, number[]> = {};
    for (const l of logs) {
      if (!l.mood_score) continue;
      const key = String(alignDown(new Date(l.created_at).getTime()));
      if (!groups[key]) groups[key] = [];
      groups[key].push(l.mood_score);
    }

    return Object.keys(groups).sort().map(key => ({
      ts: Number(key),
      avg: groups[key].reduce((a, b) => a + b, 0) / groups[key].length,
      count: groups[key].length,
    }));
  }, [logs, scale]);

  const fmtLabel = (ts: number): string => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    switch (scale) {
      case 'hourly': return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:00`;
      case 'daily': return `${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
      case 'weekly': return `${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
      case 'monthly': return `${d.getFullYear()}/${pad(d.getMonth()+1)}`;
      case 'yearly': return `${d.getFullYear()}`;
    }
  };

  // 图表尺寸计算
  const barW = 10;
  const totalW = Math.max(points.length * (barW + 2) + PAD_L + PAD_R, 600);
  const plotH = CHART_H - PAD_T - PAD_B;

  const latestScore = logs.filter(l => l.mood_score).slice(-1)[0]?.mood_score;

  if (loading) {
    return <div style={S.loading}><div style={S.spinner} /><p>加载中...</p></div>;
  }

  return (
    <div style={S.page}>
      <header style={S.header}>
        <Link href="/" style={S.back}>← 首页</Link>
        <h1 style={S.h1}>🧠 心情记录</h1>
        <span style={S.badge}>{logs.length} 条</span>
        {isAuthenticated() && (<Link href="/admin" style={S.adminLink}>管理 →</Link>)}
      </header>

      {/* 当前心情指示 */}
      {latestScore && (
        <div style={{
          textAlign: 'center', padding: '16px 20px', borderRadius: 16,
          background: '#121224', border: '1px solid #1e1e32', marginBottom: 24,
        }}>
          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 4 }}>最近心情</div>
          <div style={{ fontSize: 48, lineHeight: 1 }}>{MOOD_EMOJIS[(latestScore || 6) - 1]}</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#e4e4e7' }}>{latestScore}/10</div>
          <div style={{ fontSize: 14, color: '#a5b4fc' }}>{MOOD_SCORE_LABELS[latestScore]}</div>
        </div>
      )}

      {/* 尺度选择 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TIME_SCALES.map(s => (
          <button key={s.value} onClick={() => setScale(s.value)} style={{
            padding: '5px 12px', borderRadius: 14, fontSize: 12, outline: 'none',
            border: `1px solid ${scale === s.value ? '#6366f1' : 'rgba(255,255,255,.12)'}`,
            background: scale === s.value ? '#6366f122' : 'transparent',
            color: scale === s.value ? '#a5b4fc' : '#a1a1aa', cursor: 'pointer',
          }}>{s.label}</button>
        ))}
        <span style={{ fontSize: 11, color: '#52525b', marginLeft: 'auto' }}>{points.length} 个数据点</span>
      </div>

      {/* 折线图 */}
      {points.length > 1 && (
        <div style={{ overflowX: 'auto', borderRadius: 16, border: '1px solid #1e1e32', background: '#0c0c1a', marginBottom: 32 }}>
          <svg width={totalW} height={CHART_H} style={{ display: 'block', fontFamily: 'sans-serif', minWidth: '100%' }}>
            <defs>
              <linearGradient id="moodGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.35"/>
                <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.02"/>
              </linearGradient>
            </defs>

            {/* 心情等级背景带 */}
            {[10, 8, 6, 4, 2].map(level => {
              const y = PAD_T + plotH * (1 - level / 10);
              const colors: Record<number, string> = { 10: '#4ade8055', 8: '#a3e63544', 6: '#facc1544', 4: '#f9731644', 2: '#ef444444' };
              const labels: Record<number, string> = { 10: '极佳', 8: '很好', 6: '尚可', 4: '稍差', 2: '很差' };
              return (
                <g key={level}>
                  <rect x={PAD_L} y={y} width={totalW - PAD_L - PAD_R} height={plotH / 5} fill={colors[level] || 'transparent'} rx={0}/>
                  <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize={9} fill="#52525b">{level}</text>
                  <text x={PAD_L + 4} y={y + plotH / 5 - 4} fontSize={8} fill="#ffffff22">{labels[level] || ''}</text>
                </g>
              );
            })}

            {/* 渐变填充区域 */}
            <path
              d={[
                `M${PAD_L + barW / 2},${PAD_T + plotH}`,
                ...points.map((p, i) => {
                  const x = PAD_L + i * (barW + 2) + barW / 2;
                  const y = PAD_T + plotH * (1 - p.avg / 10);
                  return `L${x},${y}`;
                }),
                `L${PAD_L + (points.length - 1) * (barW + 2) + barW / 2},${PAD_T + plotH}Z`,
              ].join(' ')}
              fill="url(#moodGrad)"
            />

            {/* 折线 */}
            {points.map((p, i) => {
              if (i === 0) return null;
              const prev = points[i - 1];
              const x1 = PAD_L + (i - 1) * (barW + 2) + barW / 2;
              const x2 = PAD_L + i * (barW + 2) + barW / 2;
              const y1 = PAD_T + plotH * (1 - prev.avg / 10);
              const y2 = PAD_T + plotH * (1 - p.avg / 10);
              return (
                <g key={p.ts}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={LINE_COLOR} strokeWidth={2.5} strokeLinecap="round"/>
                </g>
              );
            })}

            {/* 数据点 */}
            {points.map((p, i) => {
              const x = PAD_L + i * (barW + 2) + barW / 2;
              const y = PAD_T + plotH * (1 - p.avg / 10);
              return (
                <g key={p.ts}>
                  <circle cx={x} cy={y} r={DOT_R} fill={LINE_COLOR} opacity={0.9}/>
                  {/* 标签（稀疏） */}
                  {points.length <= 60 || i % Math.ceil(points.length / 20) === 0 ? (
                    <text x={x} y={CHART_H - 8} textAnchor="middle" fontSize={9} fill="#52525b"
                      transform={`rotate(-35, ${x}, ${CHART_H - 8})`}>{fmtLabel(p.ts)}</text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {points.length <= 1 && <p style={S.empty}>数据点太少，至少需要 2 条记录才能生成图表</p>}

      {/* 最近记录列表 */}
      <div style={{ marginTop: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#e4e4e7', margin: '0 0 14px' }}>最近记录</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {logs.slice(-20).reverse().map(log => (
            <div key={log.id} style={S.logRow}>
              <span style={{ fontSize: 20, minWidth: 30, textAlign: 'center' }}>{MOOD_EMOJIS[(log.mood_score || 6) - 1]}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e4e4e7' }}>{log.mood_score}/10 {MOOD_SCORE_LABELS[log.mood_score || 6] || ''}</span>
              {log.note && log.visibility !== 'private' && <span style={{ fontSize: 12, color: '#a1a1aa', flex: 1, whiteSpace: 'pre-wrap' }}>{log.note}</span>}
              {log.visibility === 'private' && <span style={{ fontSize: 11, color: '#52525b', flex: 1 }}>🔒 私密记录</span>}
              <span style={{ fontSize: 11, color: '#52525b', fontFamily: 'monospace' }}>
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
S.page = { minHeight: '100vh', maxWidth: 1000, margin: '0 auto', padding: '28px 20px 40px' };
S.loading = { minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 };
S.spinner = { width: 36, height: 36, borderRadius: '50%', border: '3px solid #1e1e32', borderTopColor: '#6366f1', animation: 'spin 0.8s linear infinite' };
S.header = { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 };
S.back = { fontSize: 13, color: '#71717a', textDecoration: 'none' };
S.h1 = { fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, flex: 1 };
S.badge = { padding: '4px 14px', borderRadius: 20, background: '#16162a', border: '1px solid #27273d', fontSize: 13, color: '#818cf8' };
S.adminLink = { padding: '6px 14px', borderRadius: 10, border: '1px solid #27273d', color: '#818cf8', fontSize: 12, textDecoration: 'none' };
S.logRow = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
  borderRadius: 10, background: '#121224', border: '1px solid #1e1e32',
};
S.empty = { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 48, lineHeight: 1.5 };
