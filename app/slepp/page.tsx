'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { isAuthenticated } from '@/lib/auth';
import { C } from '@/lib/card-styles';

interface SleepLog {
  id: string;
  start_date: string;
  end_date: string;
  sleep_type: string;
  duration_minutes: number;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  in_bed: '卧床',
  asleep_core: '核心睡眠',
  asleep_deep: '深度睡眠',
  asleep_rem: 'REM睡眠',
  asleep_awake: '夜间清醒',
  asleep_unspecified: '睡眠',
};

const TYPE_COLORS: Record<string, string> = {
  in_bed: '#818cf8',
  asleep_core: '#6366f1',
  asleep_deep: '#4f46e5',
  asleep_rem: '#a78bfa',
  asleep_awake: '#f87171',
  asleep_unspecified: '#6366f1',
};

const CHART_H = 300;
const PAD_T = 10;
const PAD_B = 50;
const PAD_L = 50;
const PAD_R = 30;

export default function SleepPage() {
  const [logs, setLogs] = useState<SleepLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => { fetchLogs(); }, []);

  const fetchLogs = async () => {
    const { data } = await supabase
      .from('health_sleep')
      .select('*')
      .order('start_date', { ascending: true })
      .limit(5000);
    setLogs(data || []);
    setLoading(false);
  };

  // 按天聚合：每天各类型总时长
  const dailyData = useMemo(() => {
    if (!logs.length) return [];
    const map: Record<string, Record<string, number>> = {};
    for (const l of logs) {
      const day = l.start_date.slice(0, 10);
      if (!map[day]) map[day] = {};
      map[day][l.sleep_type] = (map[day][l.sleep_type] || 0) + (l.duration_minutes || 0);
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-days)
      .map(([day, types]) => ({
        day,
        types,
        total: Object.values(types).reduce((a, b) => a + b, 0),
        asleep: (types.asleep_core || 0) + (types.asleep_deep || 0) + (types.asleep_rem || 0) + (types.asleep_unspecified || 0),
        inBed: types.in_bed || 0,
      }));
  }, [logs, days]);

  // 统计
  const stats = useMemo(() => {
    if (!dailyData.length) return null;
    const totals = dailyData.map(d => d.total);
    const asleep = dailyData.map(d => d.asleep);
    return {
      avgTotal: Math.round(totals.reduce((a, b) => a + b, 0) / totals.length),
      avgAsleep: Math.round(asleep.reduce((a, b) => a + b, 0) / asleep.length),
      maxTotal: Math.max(...totals),
      minTotal: Math.min(...totals),
      latestBed: dailyData[dailyData.length - 1]?.types.in_bed || 0,
    };
  }, [dailyData]);

  const maxMin = dailyData.length > 0 ? Math.max(...dailyData.map(d => d.total)) : 0;
  const barW = Math.max(8, Math.min(40, Math.floor((800 - PAD_L - PAD_R) / dailyData.length)));
  const totalW = Math.max(dailyData.length * (barW + 2) + PAD_L + PAD_R, 600);
  const plotH = CHART_H - PAD_T - PAD_B;

  const fmtH = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ''}`;

  if (loading) {
    return <div style={S.loading}><div style={S.spinner} /><p>加载中...</p></div>;
  }

  return (
    <div style={S.page}>
      <header style={S.header}>
        <Link href="/" style={S.back}>← 首页</Link>
        <h1 style={S.h1}>😴 睡眠数据</h1>
        <span style={S.badge}>{logs.length} 条</span>
        {isAuthenticated() && <Link href="/admin" style={S.adminLink}>管理 →</Link>}
      </header>

      {/* 统计卡片 */}
      {stats && (
        <div style={S.statsGrid}>
          <div style={S.statCard}>
            <div style={S.statLabel}>平均在床</div>
            <div style={S.statValue}>{fmtH(stats.avgTotal)}</div>
          </div>
          <div style={S.statCard}>
            <div style={S.statLabel}>平均睡眠</div>
            <div style={S.statValue}>{fmtH(stats.avgAsleep)}</div>
          </div>
          <div style={S.statCard}>
            <div style={S.statLabel}>最长</div>
            <div style={S.statValue}>{fmtH(stats.maxTotal)}</div>
          </div>
          <div style={S.statCard}>
            <div style={S.statLabel}>最短</div>
            <div style={S.statValue}>{fmtH(stats.minTotal)}</div>
          </div>
        </div>
      )}

      {/* 天数选择 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const }}>
        {[7, 14, 30, 60, 90, 180, 365].map(d => (
          <button key={d} onClick={() => setDays(d)} style={{
            padding: '5px 12px', borderRadius: 14, fontSize: 12, outline: 'none',
            border: `1px solid ${days === d ? '#6366f1' : 'rgba(255,255,255,.12)'}`,
            background: days === d ? '#6366f122' : 'transparent',
            color: days === d ? '#a5b4fc' : '#a1a1aa', cursor: 'pointer',
          }}>{d}天</button>
        ))}
      </div>

      {/* 堆叠柱状图 */}
      {dailyData.length > 0 && (
        <div style={{ overflowX: 'auto', borderRadius: 16, border: '1px solid #1e1e32', background: '#0c0c1a', marginBottom: 32 }}>
          <svg width={totalW} height={CHART_H} style={{ display: 'block', fontFamily: 'sans-serif', minWidth: '100%' }}>
            {/* 小时参考线 */}
            {[4, 6, 8, 10, 12].map(h => {
              const y = PAD_T + plotH * (1 - (h * 60) / (maxMin * 1.2 + 60));
              return (
                <g key={h}>
                  <line x1={PAD_L} y1={y} x2={totalW - PAD_R} y2={y} stroke="#1e1e32" strokeWidth={1} strokeDasharray="4 4"/>
                  <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize={9} fill="#52525b">{h}h</text>
                </g>
              );
            })}

            {/* 堆叠柱 */}
            {dailyData.map((d, i) => {
              const x = PAD_L + i * (barW + 2);
              const types = ['in_bed', 'asleep_core', 'asleep_deep', 'asleep_rem', 'asleep_unspecified'];
              let yAcc = PAD_T + plotH;
              const bars = types.filter(t => d.types[t]).map(t => {
                const h = (d.types[t] / (maxMin * 1.2 + 60)) * plotH;
                const y = yAcc - h;
                yAcc = y;
                return { type: t, y, h };
              });
              return (
                <g key={d.day}>
                  {bars.map((b, j) => (
                    <rect key={j} x={x} y={b.y} width={barW} height={Math.max(b.h, 1)}
                      fill={TYPE_COLORS[b.type] || '#6366f1'} rx={2} opacity={0.85}/>
                  ))}
                  {/* 日期标签 */}
                  {(dailyData.length <= 30 || i % Math.ceil(dailyData.length / 20) === 0) && (
                    <text x={x + barW / 2} y={CHART_H - 8} textAnchor="middle" fontSize={8} fill="#52525b"
                      transform={`rotate(-35, ${x + barW / 2}, ${CHART_H - 8})`}>
                      {d.day.slice(5)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* 图例 */}
          <div style={{ display: 'flex', gap: 12, padding: '8px 16px 12px', flexWrap: 'wrap' as const }}>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#a1a1aa' }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: TYPE_COLORS[k] }} />
                {v}
              </div>
            ))}
          </div>
        </div>
      )}

      {dailyData.length === 0 && <p style={S.empty}>暂无睡眠数据，请先从 iOS 健康 App 同步</p>}

      {/* 最近记录列表 */}
      <div style={{ marginTop: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#e4e4e7', margin: '0 0 14px' }}>最近记录</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {logs.slice(-30).reverse().map(log => (
            <div key={log.id} style={S.logRow}>
              <span style={{ fontSize: 10, color: '#52525b', fontFamily: 'monospace', minWidth: 90 }}>
                {log.start_date.slice(0, 10)}
              </span>
              <span style={{ fontSize: 11, color: TYPE_COLORS[log.sleep_type] || '#a1a1aa', minWidth: 70 }}>
                {TYPE_LABELS[log.sleep_type] || log.sleep_type}
              </span>
              <span style={{ fontSize: 12, color: '#e4e4e7', fontWeight: 600 }}>
                {log.duration_minutes} 分钟
              </span>
              <span style={{ fontSize: 10, color: '#52525b', fontFamily: 'monospace' }}>
                {new Date(log.start_date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} ~
                {new Date(log.end_date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
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
S.statsGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 };
S.statCard = {
  padding: '14px 16px', borderRadius: 14, background: '#121224', border: '1px solid #1e1e32',
  textAlign: 'center' as const,
};
S.statLabel = { fontSize: 11, color: '#a1a1aa', marginBottom: 6 };
S.statValue = { fontSize: 22, fontWeight: 800, color: '#e4e4e7' };
S.logRow = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
  borderRadius: 10, background: '#121224', border: '1px solid #1e1e32',
};
S.empty = { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 48, lineHeight: 1.5 };
