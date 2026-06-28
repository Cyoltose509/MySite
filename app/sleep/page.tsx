'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { isAuthenticated } from '@/lib/auth';

interface SleepLog {
  id: string;
  start_date: string;
  end_date: string;
  sleep_type: string;
  duration_minutes: number;
}

const TYPE_LABELS: Record<string, string> = {
  in_bed: '卧床',
  asleep_core: '核心',
  asleep_deep: '深度',
  asleep_rem: 'REM',
  asleep_awake: '清醒',
  asleep_unspecified: '睡眠',
};

const TYPE_COLORS: Record<string, string> = {
  in_bed: '#7c3aed',
  asleep_core: '#2563eb',
  asleep_deep: '#059669',
  asleep_rem: '#db2777',
  asleep_awake: '#d97706',
  asleep_unspecified: '#6366f1',
};

const COL_W = 56;
const TIME_AXIS_W = 52;
const TOP_PAD = 24;
const BOT_PAD = 40;

// 将 UTC 时间字符串转为北京时间
function utcToBeijing(utcIsoStr: string): { beijingHr: number; beijingDateStr: string } {
  const d = new Date(utcIsoStr);
  const beijingMs = d.getTime() + 8 * 3600 * 1000;
  const beijingDate = new Date(beijingMs);
  const msInDay = beijingMs % 86400000;
  const beijingHr = msInDay / 3600000;
  const y = beijingDate.getUTCFullYear();
  const m = String(beijingDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getUTCDate()).padStart(2, '0');
  return { beijingHr, beijingDateStr: `${y}-${m}-${day}` };
}

export default function SleepPage() {
  const [logs, setLogs] = useState<SleepLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [animPct, setAnimPct] = useState(0);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number;
    day: string; type: string;
    start: string; end: string; dur: number;
  } | null>(null);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const [highlightDay, setHighlightDay] = useState<string | null>(null);
  const animRef = useRef<number>(0);
  const chartRef = useRef<HTMLDivElement>(null);

  // ===== useEffect: 获取数据 =====
  useEffect(() => { fetchLogs(); }, []);

  // ===== useEffect: 入场动画 =====
  useEffect(() => {
    if (loading) return;
    const t0 = performance.now();
    const duration = 600;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setAnimPct(1 - Math.pow(1 - p, 3));
      if (p < 1) animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current || 0);
  }, [loading]);

  // ===== 数据获取函数 =====
  const fetchLogs = async () => {
    const { data } = await supabase.from('health_sleep').select('*')
      .order('start_date', { ascending: true }).limit(5000);
    setLogs(data || []);
    setLoading(false);
  };

  // ===== useMemo: 分组睡眠数据 =====
  const dailySegmentsAll = useMemo(() => {
    if (!logs.length) return [];
    const map: Record<string, SleepLog[]> = {};
    for (const l of logs) {
      const { beijingHr, beijingDateStr } = utcToBeijing(l.start_date);
      const dayDate = new Date(beijingDateStr + 'T00:00:00Z');
      if (beijingHr >= 18) {
        dayDate.setUTCDate(dayDate.getUTCDate() + 1);
      }
      const dayKey = dayDate.toISOString().slice(0, 10);
      if (!map[dayKey]) map[dayKey] = [];
      map[dayKey].push(l);
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, segs]) => {
        const sorted = segs.sort((a, b) => a.start_date.localeCompare(b.start_date));
        const inBedDurs = sorted
          .filter(x => x.sleep_type === 'in_bed')
          .map(x => x.duration_minutes || 0);
        const inBedMin = inBedDurs.length ? Math.max(...inBedDurs) : 0;
        const asleepMin = sorted
          .filter(x => !['in_bed', 'asleep_awake'].includes(x.sleep_type))
          .reduce((s, x) => s + (x.duration_minutes || 0), 0);
        return { day, segs: sorted, totalMin: inBedMin, asleepMin };
      });
  }, [logs]);

  // ===== useMemo: 统计数据（最长/最短用睡眠时间）=====
  const stats = useMemo(() => {
    if (!dailySegmentsAll.length) return null;
    const withAsleep = dailySegmentsAll.filter(d => d.asleepMin > 0);
    const withBed = dailySegmentsAll.filter(d => d.totalMin > 0);
    if (!withAsleep.length) return null;
    const maxDay = withAsleep.reduce((a, b) => a.asleepMin > b.asleepMin ? a : b);
    const minDay = withAsleep.reduce((a, b) => a.asleepMin < b.asleepMin ? a : b);
    return {
      avgTotal: withBed.length ? Math.round(withBed.reduce((s, x) => s + x.totalMin, 0) / withBed.length) : 0,
      avgAsleep: Math.round(withAsleep.reduce((s, x) => s + x.asleepMin, 0) / withAsleep.length),
      maxAsleep: maxDay.asleepMin,
      minAsleep: minDay.asleepMin,
      maxDay: maxDay.day,
      minDay: minDay.day,
    };
  }, [dailySegmentsAll]);

  // ===== useMemo: 时间轴范围（根据实际数据动态计算）=====
  const { axisStartHr, axisEndHr, axisHrs } = useMemo(() => {
    if (!dailySegmentsAll.length) return { axisStartHr: 18, axisEndHr: 42, axisHrs: 24 };
    let minHr = 24, maxHr = 0;
    for (const d of dailySegmentsAll) {
      for (const seg of d.segs) {
        const { beijingHr: sh } = utcToBeijing(seg.start_date);
        const { beijingHr: eh } = utcToBeijing(seg.end_date);
        const shAdj = sh >= 18 ? sh : sh + 24;
        const ehAdj = eh >= 18 ? eh : eh + 24;
        if (shAdj < minHr) minHr = shAdj;
        if (ehAdj > maxHr) maxHr = ehAdj;
      }
    }
    const start = Math.max(0, Math.floor(minHr) - 1);
    const end = Math.min(48, Math.ceil(maxHr) + 1);
    return { axisStartHr: start, axisEndHr: end, axisHrs: end - start };
  }, [dailySegmentsAll]);

  // ===== useCallback: 时间转 Y 坐标 =====
  const timeToY = useCallback((utcIso: string, svgH: number) => {
    const { beijingHr } = utcToBeijing(utcIso);
    const hr = beijingHr >= axisStartHr ? beijingHr : beijingHr + 24;
    const plotH = svgH - TOP_PAD - BOT_PAD;
    return TOP_PAD + ((hr - axisStartHr) / axisHrs) * plotH;
  }, [axisStartHr, axisHrs]);

  const axisHrToY = useCallback((hr: number, svgH: number) => {
    const plotH = svgH - TOP_PAD - BOT_PAD;
    return TOP_PAD + ((hr - axisStartHr) / axisHrs) * plotH;
  }, [axisStartHr, axisHrs]);

  // ===== useEffect: 自动滚动到最右侧（必须放在所有 useMemo 之后）=====
  useEffect(() => {
    if (!dailySegmentsAll.length || !chartRef.current) return;
    const el = chartRef.current;
    // 等 DOM 更新 + 动画结束后滚动
    const timer = setTimeout(() => {
      el.scrollLeft = el.scrollWidth - el.clientWidth;
    }, 700);
    return () => clearTimeout(timer);
  }, [dailySegmentsAll.length]);

  // ===== 普通函数 =====
  const fmtT = (iso: string) => {
    const { beijingHr } = utcToBeijing(iso);
    const displayHr = Math.floor(beijingHr);
    const displayMin = Math.round((beijingHr - displayHr) * 60);
    return `${String(displayHr).padStart(2, '0')}:${String(displayMin).padStart(2, '0')}`;
  };
  const fmtH = (m: number) => {
    if (!m || m <= 0) return '0h';
    const h = Math.floor(m / 60), rem = m % 60;
    return `${h}h${rem ? ` ${rem}m` : ''}`;
  };

  // ===== 常量 =====
  const svgH = 600;
  const plotH = svgH - TOP_PAD - BOT_PAD;
  const svgW = Math.max(dailySegmentsAll.length * COL_W + 64, 400);

  const ticks: { hr: number; labelHr: number }[] = [];
  for (let h = axisStartHr; h <= axisEndHr; h++) {
    ticks.push({ hr: h, labelHr: h >= 24 ? h - 24 : h });
  }

  // ===== 跳到指定天 =====
  const scrollToDay = useCallback((day: string | null) => {
    setHighlightDay(day);
    if (!day || !chartRef.current) return;
    const idx = dailySegmentsAll.findIndex(d => d.day === day);
    if (idx < 0) return;
    const el = chartRef.current;
    const targetLeft = idx * COL_W + COL_W / 2 - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  }, [dailySegmentsAll]);
  const onMove = useCallback((e: React.MouseEvent) => {
    if (!chartRef.current || !dailySegmentsAll.length) { setTooltip(null); setHoverCol(null); return; }
    const r = chartRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left + chartRef.current.scrollLeft;
    const my = e.clientY - r.top;
    const ci = Math.floor(mx / COL_W);
    if (ci < 0 || ci >= dailySegmentsAll.length) { setTooltip(null); setHoverCol(null); return; }
    setHoverCol(ci);
    const sd = dailySegmentsAll[ci];
    for (const seg of sd.segs) {
      const y1 = timeToY(seg.start_date, svgH), y2 = timeToY(seg.end_date, svgH);
      const cy = Math.max(y1, TOP_PAD), ch = Math.min(y2, svgH - BOT_PAD) - cy;
      if (ch <= 0) continue;
      const sx = ci * COL_W + 4, sw = COL_W - 12;
      if (mx >= sx && mx <= sx + sw && my >= cy && my <= cy + ch) {
        setTooltip({ x: e.clientX, y: e.clientY, day: sd.day, type: seg.sleep_type, start: seg.start_date, end: seg.end_date, dur: seg.duration_minutes });
        return;
      }
    }
    setTooltip({ x: e.clientX, y: e.clientY, day: sd.day, type: '_summary', start: '', end: '', dur: sd.totalMin });
  }, [dailySegmentsAll, timeToY, svgH]);

  const onLeave = () => { setTooltip(null); setHoverCol(null); };

  // ===== 渲染 =====
  if (loading) return <div style={S.loading}><div style={S.spinner} /><p>加载中...</p></div>;

  return (
    <div style={S.page}>
      <header style={S.header}>
        <Link href="/" style={S.back}>← 首页</Link>
        <h1 style={S.h1}>😴 睡眠数据</h1>
        <span style={S.badge}>{logs.length} 条 · {dailySegmentsAll.length} 天</span>
        {isAuthenticated() && <Link href="/admin" style={S.adminLink}>管理 →</Link>}
      </header>

      {stats && (
        <div style={S.statsGrid}>
          {([['平均在床', stats.avgTotal, null], ['平均睡眠', stats.avgAsleep, null], ['最长睡眠', stats.maxAsleep, stats.maxDay], ['最短睡眠', stats.minAsleep, stats.minDay]] as [string, number, string | null][])
            .map(([l, v, day], i) => (
              <div key={i}
                style={{
                  ...S.statCard,
                  opacity: animPct,
                  transform: `translateY(${(1 - animPct) * 16}px)`,
                  transition: `all ${0.35 + i * 0.07}s ease`,
                  cursor: day ? 'pointer' : 'default',
                  ...(highlightDay && day && highlightDay !== day ? { opacity: 0.4 } : {}),
                }}
                onClick={() => day && scrollToDay(highlightDay === day ? null : day)}
                title={day ? `点击跳转到 ${day}` : undefined}>
                <div style={S.statLabel}>{l}</div>
                <div style={S.statValue}>{fmtH(typeof v === 'number' ? v : 0)}</div>
                {day && <div style={S.statDate}>{day}</div>}
              </div>
            ))}
        </div>
      )}

      {dailySegmentsAll.length > 0 && (
        <div style={S.chartOuter}>
          {/* 固定时间轴（左侧） */}
          <div style={S.timeAxisCol}>
            <svg width={TIME_AXIS_W} height={svgH} style={{ display: 'block' }}>
              {ticks.map(t => {
                const y = axisHrToY(t.hr, svgH);
                const isMidnight = t.labelHr === 0;
                return (
                  <g key={t.hr}>
                    <text x={TIME_AXIS_W - 4} y={y + 3.5} textAnchor="end"
                      fontSize={10} fill={isMidnight ? '#818cf8' : '#a1a1aa'} fontWeight={isMidnight ? 700 : 400}>
                      {`${t.labelHr}:00`}
                    </text>
                    {isMidnight && (
                      <text x={4} y={y - 6} fontSize={8} fill="#818cf8" fontWeight={600}>午夜</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* 可滚动图表区（右侧） */}
          <div
            ref={chartRef}
            style={S.chartScroll}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
          >
            <svg width={svgW} height={svgH} style={{ display: 'block', opacity: animPct, transition: 'opacity 0.5s ease' }}>
              <defs>
                <linearGradient id="gradInBed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.45" />
                </linearGradient>
              </defs>

              {/* 网格线 */}
              {ticks.map(t => {
                const y = axisHrToY(t.hr, svgH);
                const isMidnight = t.labelHr === 0;
                return (
                  <line key={t.hr}
                    x1={0} y1={y} x2={svgW} y2={y}
                    stroke={isMidnight ? '#3b3b54' : '#1e1e32'}
                    strokeWidth={isMidnight ? 1.2 : 0.5}
                    strokeDasharray={isMidnight ? '6 3' : (t.hr % 2 === 0 ? '3 3' : undefined)}
                  />
                );
              })}

              {/* 每日列 */}
              {dailySegmentsAll.map((d, i) => {
                const cx = i * COL_W + COL_W / 2;
                const isHover = hoverCol === i;
                const isHighlight = highlightDay === d.day;
                const isDim = highlightDay && !isHighlight;
                return (
                  <g key={d.day} opacity={isDim ? 0.3 : 1}>
                    <rect x={i * COL_W} y={TOP_PAD} width={COL_W - 4} height={plotH}
                      rx={6}
                      fill={isHighlight ? '#1a1a3a' : isHover ? '#16162e' : 'transparent'}
                      stroke={isHighlight ? '#f59e0b' : isHover ? '#2a2a50' : 'transparent'}
                      strokeWidth={isHighlight ? 1.5 : isHover ? 1 : 0} />

                    {d.segs.map((seg, j) => {
                      const y1 = timeToY(seg.start_date, svgH), y2 = timeToY(seg.end_date, svgH);
                      const cy = Math.max(y1, TOP_PAD), ch = Math.min(y2, svgH - BOT_PAD) - cy;
                      if (ch <= 0) return null;
                      const isBed = seg.sleep_type === 'in_bed';
                      return (
                        <rect key={j}
                          x={i * COL_W + 4} y={cy} width={COL_W - 12} height={ch}
                          rx={3}
                          fill={isBed ? 'url(#gradInBed)' : TYPE_COLORS[seg.sleep_type]}
                          opacity={isBed ? 0.65 : 0.85}
                        />
                      );
                    })}

                    <text x={cx} y={svgH - 12} textAnchor="middle"
                      fontSize={isHighlight ? 11 : 9} fontWeight={isHighlight ? 700 : 500}
                      fill={isHighlight ? '#f59e0b' : isHover ? '#c4c4cf' : '#52525b'}>
                      {d.day.slice(5)}
                    </text>

                    {(isHover || isHighlight) && (
                      <text x={cx} y={TOP_PAD + 12} textAnchor="middle"
                        fontSize={10} fontWeight={700} fill="#e4e4e7">
                        {fmtH(d.asleepMin)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* 今日线 */}
              {(() => {
                const today = new Date().toISOString().slice(0, 10);
                const idx = dailySegmentsAll.findIndex(d => d.day === today);
                if (idx < 0) return null;
                const cx = idx * COL_W + COL_W / 2;
                return <line x1={cx} y1={TOP_PAD} x2={cx} y2={svgH - BOT_PAD}
                  stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.5} />;
              })()}
            </svg>
          </div>

          {/* 图例（固定在底部） */}
          <div style={S.legendBar}>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <div key={k} style={S.legendItem}>
                <span style={{
                  display: 'inline-block', width: 12, height: 12, borderRadius: 3,
                  background: TYPE_COLORS[k],
                  boxShadow: `0 0 6px ${TYPE_COLORS[k]}44`,
                }} />
                <span style={{ fontSize: 11 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!dailySegmentsAll.length && <p style={S.empty}>暂无数据，请先通过 iOS 快捷指令同步</p>}

      {/* Tooltip */}
      {tooltip && tooltip.type !== '_summary' && (
        <div style={{
          ...S.tooltip,
          left: tooltip.x + 18,
          top: tooltip.y - 6,
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2, color: TYPE_COLORS[tooltip.type] }}>
            {TYPE_LABELS[tooltip.type]}
          </div>
          <div style={{ color: '#888', fontSize: 11 }}>{tooltip.day}</div>
          <div>{fmtT(tooltip.start)} — {fmtT(tooltip.end)}</div>
          <div style={{ fontWeight: 600, color: '#a5b4fc' }}>时长 {tooltip.dur} 分钟</div>
        </div>
      )}
      {tooltip && tooltip.type === '_summary' && (
        <div style={{
          ...S.tooltip,
          left: tooltip.x + 18,
          top: tooltip.y - 6,
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{tooltip.day}</div>
          <div>睡眠 <span style={{ color: '#818cf8', fontWeight: 600 }}>{fmtH(dailySegmentsAll.find(d => d.day === tooltip.day)?.asleepMin || 0)}</span></div>
          <div>在床 <span style={{ fontWeight: 600 }}>{fmtH(tooltip.dur)}</span></div>
        </div>
      )}
    </div>
  );
}

const S = {
  page: { minHeight: '100vh', maxWidth: 1024, margin: '0 auto', padding: '28px 20px 48px' } as React.CSSProperties,
  loading: { minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 } as React.CSSProperties,
  spinner: { width: 36, height: 36, borderRadius: '50%', border: '3px solid #1e1e32', borderTopColor: '#6366f1', animation: 'spin .8s linear infinite' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 } as React.CSSProperties,
  back: { fontSize: 13, color: '#71717a', textDecoration: 'none' } as React.CSSProperties,
  h1: { fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, flex: 1 } as React.CSSProperties,
  badge: { padding: '4px 14px', borderRadius: 20, background: '#16162a', border: '1px solid #27273d', fontSize: 13, color: '#818cf8' } as React.CSSProperties,
  adminLink: { padding: '6px 14px', borderRadius: 10, border: '1px solid #27273d', color: '#818cf8', fontSize: 12, textDecoration: 'none' } as React.CSSProperties,
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 24 } as React.CSSProperties,
  statCard: { padding: '14px 16px', borderRadius: 14, background: '#121224', border: '1px solid #1e1e32', textAlign: 'center' } as React.CSSProperties,
  statLabel: { fontSize: 11, color: '#a1a1aa', marginBottom: 6 } as React.CSSProperties,
  statValue: { fontSize: 22, fontWeight: 800, color: '#e4e4e7' } as React.CSSProperties,
  statDate: { fontSize: 10, color: '#52525b', marginTop: 4 } as React.CSSProperties,
  // 外层容器：固定时间轴 + 可滚动图表
  chartOuter: { borderRadius: 18, border: '1px solid #1e1e32', background: '#08081a', marginBottom: 32, overflow: 'hidden' } as React.CSSProperties,
  // 固定时间轴列
  timeAxisCol: { float: 'left', width: TIME_AXIS_W, height: 620, position: 'relative' as const, zIndex: 2, background: '#08081a', borderRight: '1px solid #1e1e32' } as React.CSSProperties,
  // 可滚动图表区（留底部 20px 给滚动条，不挡住日期标签）
  chartScroll: { overflowX: 'auto', overflowY: 'hidden', height: 620, marginLeft: TIME_AXIS_W, paddingBottom: 20 } as React.CSSProperties,
  // 底部图例
  legendBar: { display: 'flex', gap: 16, padding: '10px 24px 14px', flexWrap: 'wrap', fontSize: 11, color: '#a1a1aa', borderTop: '1px solid #1e1e32', background: '#08081a' } as React.CSSProperties,
  legendItem: { display: 'flex', alignItems: 'center', gap: 6 } as React.CSSProperties,
  empty: { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 56, lineHeight: 1.5 } as React.CSSProperties,
  tooltip: { position: 'fixed', background: '#181830', border: '1px solid #333355', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#e4e4e7', pointerEvents: 'none', zIndex: 9999, boxShadow: '0 8px 36px rgba(0,0,0,0.55)', lineHeight: 1.75, whiteSpace: 'nowrap' } as React.CSSProperties,
};
