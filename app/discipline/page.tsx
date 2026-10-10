'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { fetchAll } from '@/lib/rank';
import { isAuthenticated } from '@/lib/auth';
import {
  type Habit, type HabitSession, type HabitDay,
  groupByDay, axisRange, computeStats, fmtHM, fmtClock,
} from '@/lib/habit-utils';

const COL_W = 56;
const TIME_AXIS_W = 52;
const TOP_PAD = 24;
const BOT_PAD = 52;   // 留出「名称 / 时长 / 日期」三行轴标注的空间
const SVG_H = 560;

export default function DisciplinePage() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [sessions, setSessions] = useState<HabitSession[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [animPct, setAnimPct] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; day: HabitDay } | null>(null);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const [highlightDay, setHighlightDay] = useState<string | null>(null);
  const animRef = useRef<number>(0);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => { load(); }, []);

  // 入场动画
  useEffect(() => {
    if (loading) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / 600, 1);
      setAnimPct(1 - Math.pow(1 - p, 3));
      if (p < 1) animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current || 0);
  }, [loading]);

  const load = async () => {
    try {
      // 可能超 1000 行，必须 range 分页拉全
      const [hs, ss] = await Promise.all([
        fetchAll('habits', 'id,name,icon,color,sort_order,is_private'),
        fetchAll('habit_sessions', 'id,habit_id,start_at,duration_min,note'),
      ]);
      const h = (hs as Habit[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setHabits(h);
      setSessions((ss as HabitSession[]).sort((a, b) => a.start_at.localeCompare(b.start_at)));
      if (h.length) setActiveId(h[0].id);
    } catch (e) {
      console.error('加载自律养成数据失败', e);
    }
    setLoading(false);
  };

  const active = useMemo(() => habits.find(h => h.id === activeId) || null, [habits, activeId]);

  const days: HabitDay[] = useMemo(
    () => groupByDay(sessions.filter(s => s.habit_id === activeId)),
    [sessions, activeId],
  );
  const stats = useMemo(() => computeStats(days), [days]);
  const axis = useMemo(() => axisRange(days), [days]);

  const svgW = Math.max(days.length * COL_W + 64, 400);
  const plotH = SVG_H - TOP_PAD - BOT_PAD;
  const accent = active?.color || '#6366f1';
  // 柱下标注要塞进 56px 宽的列里，习惯名截断到 4 个字
  const shortName = (active?.name || '').length > 4 ? (active?.name || '').slice(0, 4) : (active?.name || '');

  const hrToY = useCallback((hr: number) => {
    return TOP_PAD + ((hr - axis.startHr) / axis.hrs) * plotH;
  }, [axis.startHr, axis.hrs]);

  // 滚到最右（最新一天）
  useEffect(() => {
    if (!days.length || !chartRef.current) return;
    const t = setTimeout(() => {
      const el = chartRef.current!;
      el.scrollLeft = el.scrollWidth - el.clientWidth;
    }, 700);
    return () => clearTimeout(t);
  }, [days.length]);

  const scrollToDay = useCallback((day: string | null) => {
    setHighlightDay(day);
    if (!day || !chartRef.current) return;
    const idx = days.findIndex(d => d.day === day);
    if (idx < 0) return;
    const el = chartRef.current;
    el.scrollTo({ left: Math.max(0, idx * COL_W + COL_W / 2 - el.clientWidth / 2), behavior: 'smooth' });
  }, [days]);

  const onMove = useCallback((e: React.MouseEvent) => {
    if (!chartRef.current || !days.length) { setTooltip(null); setHoverCol(null); return; }
    const r = chartRef.current.getBoundingClientRect();
    const ci = Math.floor((e.clientX - r.left + chartRef.current.scrollLeft) / COL_W);
    if (ci < 0 || ci >= days.length) { setTooltip(null); setHoverCol(null); return; }
    setHoverCol(ci);
    setTooltip({ x: e.clientX, y: e.clientY, day: days[ci] });
  }, [days]);

  const onLeave = () => { setTooltip(null); setHoverCol(null); };

  if (loading) return <div style={S.loading}><div style={S.spinner} /><p>加载中...</p></div>;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={S.page}>
      <header style={S.header}>
        <Link href="/" style={S.back}>← 首页</Link>
        <h1 style={S.h1}>🎯 自律养成</h1>
        <span style={S.badge}>{stats ? `${stats.count} 次 · ${stats.dayCount} 天` : '暂无数据'}</span>
        {isAuthenticated() && <Link href="/admin" style={S.adminLink}>管理 →</Link>}
      </header>

      {habits.length > 1 && (
        <div style={S.chips}>
          {habits.map(h => (
            <button key={h.id} onClick={() => { setActiveId(h.id); setHighlightDay(null); }}
              style={{
                ...S.chip,
                borderColor: h.id === activeId ? (h.color || '#6366f1') : '#27273d',
                background: h.id === activeId ? `${h.color || '#6366f1'}22` : 'transparent',
                color: h.id === activeId ? '#e4e4e7' : '#a1a1aa',
              }}>
              <span>{h.icon}</span>{h.name}
            </button>
          ))}
        </div>
      )}

      {stats && (
        <div style={S.statsGrid}>
          {([
            ['总时长', fmtHM(stats.totalMin), null],
            ['练习次数', `${stats.count}`, null],
            ['平均单次', fmtHM(stats.avgMin), null],
            ['最长单日', fmtHM(stats.maxMin), stats.maxDay],
            ['最长连续', `${stats.streak}`, '天'],
          ] as [string, string, string | null][]).map(([l, v, day], i) => (
            <div key={l}
              style={{
                ...S.statCard,
                opacity: animPct,
                transform: `translateY(${(1 - animPct) * 16}px)`,
                transition: `all ${0.35 + i * 0.07}s ease`,
                cursor: day ? 'pointer' : 'default',
                borderColor: highlightDay && day && highlightDay !== day ? '#1e1e32' : (day ? accent + '66' : '#1e1e32'),
                ...(highlightDay && day && highlightDay !== day ? { opacity: 0.4 } : {}),
              }}
              onClick={() => day && scrollToDay(highlightDay === day ? null : day)}
              title={day ? `点击跳转到 ${day}` : undefined}>
              <div style={S.statLabel}>{l}</div>
              <div style={{ ...S.statValue, color: day ? accent : '#e4e4e7' }}>{v}</div>
              {day && <div style={S.statDate}>{day}</div>}
            </div>
          ))}
        </div>
      )}

      {days.length > 0 && (
        <div style={S.chartOuter}>
          <div style={S.timeAxisCol}>
            <svg width={TIME_AXIS_W} height={SVG_H} style={{ display: 'block' }}>
              {Array.from({ length: axis.endHr - axis.startHr + 1 }, (_, k) => axis.startHr + k).map(hr => {
                const y = hrToY(hr);
                const isMidnight = ((hr % 24) + 24) % 24 === 0;
                return (
                  <g key={hr}>
                    <text x={TIME_AXIS_W - 4} y={y + 3.5} textAnchor="end"
                      fontSize={10} fill={isMidnight ? '#818cf8' : '#a1a1aa'} fontWeight={isMidnight ? 700 : 400}>
                      {fmtClock(hr)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div ref={chartRef} style={S.chartScroll} onMouseMove={onMove} onMouseLeave={onLeave}>
            <svg width={svgW} height={SVG_H} style={{ display: 'block', opacity: animPct, transition: 'opacity 0.5s ease' }}>
              <defs>
                <linearGradient id="habitBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent} stopOpacity="0.95" />
                  <stop offset="100%" stopColor={accent} stopOpacity="0.55" />
                </linearGradient>
              </defs>

              {Array.from({ length: axis.endHr - axis.startHr + 1 }, (_, k) => axis.startHr + k).map(hr => {
                const y = hrToY(hr);
                const isMidnight = ((hr % 24) + 24) % 24 === 0;
                return (
                  <line key={hr} x1={0} y1={y} x2={svgW} y2={y}
                    stroke={isMidnight ? '#3b3b54' : '#1e1e32'}
                    strokeWidth={isMidnight ? 1.2 : 0.5}
                    strokeDasharray={isMidnight ? '6 3' : (hr % 2 === 0 ? '3 3' : undefined)} />
                );
              })}

              {days.map((d, i) => {
                const isHover = hoverCol === i;
                const isHighlight = highlightDay === d.day;
                const isDim = !!highlightDay && !isHighlight;
                return (
                  <g key={d.day} opacity={isDim ? 0.3 : 1}>
                    <rect x={i * COL_W} y={TOP_PAD} width={COL_W - 4} height={plotH} rx={6}
                      fill={isHighlight ? '#1a1a3a' : isHover ? '#16162e' : 'transparent'}
                      stroke={isHighlight ? accent : isHover ? '#2a2a50' : 'transparent'}
                      strokeWidth={isHighlight ? 1.5 : isHover ? 1 : 0} />

                    {d.segs.map(seg => {
                      const y1 = hrToY(seg.startHr);
                      const y2 = hrToY(seg.endHr);
                      const cy = Math.max(y1, TOP_PAD);
                      const ch = Math.min(y2, SVG_H - BOT_PAD) - cy;
                      if (ch <= 0) return null;
                      return (
                        <rect key={seg.id}
                          x={i * COL_W + 4} y={cy} width={COL_W - 12} height={ch} rx={3}
                          fill="url(#habitBar)" opacity={isHover || isHighlight ? 1 : 0.85} />
                      );
                    })}

                    {/* 柱下标注：这是什么 + 当天时长（对齐 /events 的"柱体 + 轴标签"观感） */}
                    <text x={i * COL_W + COL_W / 2} y={SVG_H - 34} textAnchor="middle"
                      fontSize={8} fill={isDim ? '#3f3f46' : '#71717a'}>
                      {active?.icon} {shortName}
                    </text>
                    <text x={i * COL_W + COL_W / 2} y={SVG_H - 21} textAnchor="middle"
                      fontSize={isHighlight ? 11 : 9} fontWeight={isHighlight ? 700 : 600}
                      fill={isDim ? '#3f3f46' : isHover ? '#e4e4e7' : accent}>
                      {d.totalMin ? fmtHM(d.totalMin) : '—'}
                    </text>
                    <text x={i * COL_W + COL_W / 2} y={SVG_H - 8} textAnchor="middle"
                      fontSize={isHighlight ? 10 : 9} fontWeight={isHighlight ? 700 : 500}
                      fill={isHighlight ? accent : isHover ? '#c4c4cf' : '#52525b'}>
                      {d.day.slice(5)}
                    </text>

                    {(isHover || isHighlight) && (
                      <text x={i * COL_W + COL_W / 2} y={TOP_PAD + 12} textAnchor="middle"
                        fontSize={10} fontWeight={700} fill="#e4e4e7">
                        {fmtHM(d.totalMin)}
                      </text>
                    )}
                  </g>
                );
              })}

              {(() => {
                const idx = days.findIndex(d => d.day === today);
                if (idx < 0) return null;
                const cx = idx * COL_W + COL_W / 2;
                return <line x1={cx} y1={TOP_PAD} x2={cx} y2={SVG_H - BOT_PAD}
                  stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.5} />;
              })()}
            </svg>
          </div>

          {/* 图例：说明每种颜色是什么 + 累计时长（对齐 /events 的底部统计卡） */}
          <div style={S.legendBar}>
            {habits.map(h => {
              const on = h.id === activeId;
              const st = on ? stats : null;
              return (
                <div key={h.id} style={{
                  ...S.legendItem,
                  borderColor: on ? (h.color || '#6366f1') : '#1e1e32',
                  opacity: on ? 1 : 0.55,
                }}>
                  <span style={{
                    display: 'inline-block', width: 12, height: 12, borderRadius: 3,
                    background: h.color || '#6366f1',
                    boxShadow: `0 0 6px ${h.color || '#6366f1'}44`,
                  }} />
                  <span style={{ fontSize: 12, color: on ? '#e4e4e7' : '#a1a1aa' }}>
                    {h.icon} {h.name}
                  </span>
                  {st && (
                    <span style={{ fontSize: 11, color: '#818cf8', fontWeight: 600 }}>
                      合计 {fmtHM(st.totalMin)} · {st.count} 次 · 连续 {st.streak} 天
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {habits.length === 0 && <p style={S.empty}>暂无习惯，去 admin → 自律养成 里添加并记录。</p>}
      {habits.length > 0 && days.length === 0 && (
        <p style={S.empty}>「{active?.name}」还没有记录，去 admin → 自律养成 里添加一条。</p>
      )}

      {tooltip && (
        <div style={{ ...S.tooltip, left: tooltip.x + 18, top: tooltip.y - 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{tooltip.day.day}</div>
          <div>总时长 <span style={{ color: accent, fontWeight: 600 }}>{fmtHM(tooltip.day.totalMin)}</span></div>
          <div>次数 <span style={{ fontWeight: 600 }}>{tooltip.day.count}</span></div>
          {tooltip.day.segs.map(s => (
            <div key={s.id} style={{ color: '#a1a1aa', fontSize: 11 }}>
              {fmtClock(s.startHr)}–{fmtClock(s.endHr)} · {fmtHM(s.durMin)}
              {s.note ? ` · ${s.note}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const S = {
  page: { minHeight: '100vh', maxWidth: 1024, margin: '0 auto', padding: '28px 20px 48px' } as React.CSSProperties,
  loading: { minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 } as React.CSSProperties,
  spinner: { width: 36, height: 36, borderRadius: '50%', border: '3px solid #1e1e32', borderTopColor: '#6366f1', animation: 'spin .8s linear infinite' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 } as React.CSSProperties,
  back: { fontSize: 13, color: '#71717a', textDecoration: 'none' } as React.CSSProperties,
  h1: { fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, flex: 1 } as React.CSSProperties,
  badge: { padding: '4px 14px', borderRadius: 20, background: '#16162a', border: '1px solid #27273d', fontSize: 13, color: '#818cf8' } as React.CSSProperties,
  adminLink: { padding: '6px 14px', borderRadius: 10, border: '1px solid #27273d', color: '#818cf8', fontSize: 12, textDecoration: 'none' } as React.CSSProperties,
  chips: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 } as React.CSSProperties,
  chip: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 20, border: '1px solid', fontSize: 13, cursor: 'pointer', transition: 'all .15s' } as React.CSSProperties,
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12, marginBottom: 24 } as React.CSSProperties,
  statCard: { padding: '14px 16px', borderRadius: 14, background: '#121224', border: '1px solid #1e1e32', textAlign: 'center', transition: 'all .3s' } as React.CSSProperties,
  statLabel: { fontSize: 11, color: '#a1a1aa', marginBottom: 6 } as React.CSSProperties,
  statValue: { fontSize: 20, fontWeight: 800, color: '#e4e4e7' } as React.CSSProperties,
  statDate: { fontSize: 10, color: '#52525b', marginTop: 4 } as React.CSSProperties,
  chartOuter: { borderRadius: 18, border: '1px solid #1e1e32', background: '#08081a', marginBottom: 32, overflow: 'hidden' } as React.CSSProperties,
  timeAxisCol: { float: 'left', width: TIME_AXIS_W, height: SVG_H + 20, position: 'relative' as const, zIndex: 2, background: '#08081a', borderRight: '1px solid #1e1e32' } as React.CSSProperties,
  chartScroll: { overflowX: 'auto', overflowY: 'hidden', height: SVG_H + 20, marginLeft: TIME_AXIS_W, paddingBottom: 20 } as React.CSSProperties,
  legendBar: { display: 'flex', gap: 12, flexWrap: 'wrap', padding: '12px 20px 14px', marginLeft: TIME_AXIS_W, fontSize: 11, color: '#a1a1aa', borderTop: '1px solid #1e1e32', background: '#08081a' } as React.CSSProperties,
  legendItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 10, border: '1px solid #1e1e32', background: '#0e0e1e' } as React.CSSProperties,
  empty: { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 56, lineHeight: 1.5 } as React.CSSProperties,
  tooltip: { position: 'fixed', background: '#181830', border: '1px solid #333355', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#e4e4e7', pointerEvents: 'none', zIndex: 9999, boxShadow: '0 8px 36px rgba(0,0,0,0.55)', lineHeight: 1.6, maxWidth: 260 } as React.CSSProperties,
};
