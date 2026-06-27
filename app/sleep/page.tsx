'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { isAuthenticated } from '@/lib/auth';

interface SleepLog {
  id: string;
  start_date: string;  // UTC time string from DB, e.g. "2026-06-27T01:03:00.000Z"
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
// 返回 { beijingHr: number (0~23.999), beijingDateStr: string (YYYY-MM-DD) }
function utcToBeijing(utcIsoStr: string): { beijingHr: number; beijingDateStr: string } {
  const d = new Date(utcIsoStr);
  const beijingMs = d.getTime() + 8 * 3600 * 1000;
  const beijingDate = new Date(beijingMs);
  // 手动计算北京时间的小时（避免时区方法混淆）
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
  const [days, setDays] = useState(30);
  const [animPct, setAnimPct] = useState(0);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number;
    day: string; type: string;
    start: string; end: string; dur: number;
  } | null>(null);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const animRef = useRef<number>(0);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { fetchLogs(); }, []);

  useEffect(() => {
    if (loading) return;
    const t0 = performance.now();
    const duration = 800;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setAnimPct(1 - Math.pow(1 - p, 3));
      if (p < 1) animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current || 0);
  }, [loading]);

  const fetchLogs = async () => {
    const { data } = await supabase.from('health_sleep').select('*')
      .order('start_date', { ascending: true }).limit(5000);
    setLogs(data || []);
    setLoading(false);
  };

  // 分组逻辑（睡眠日定义：昨天18:00 ~ 今天18:00 = 今天的睡眠日）
  // beijingHr 范围 0~23.999
  // 北京时间 >= 18:00 开始的 → 归到明天（因为 18:00 是新睡眠日的开始）
  const dailySegments = useMemo(() => {
    if (!logs.length) return [];
    const map: Record<string, SleepLog[]> = {};
    for (const l of logs) {
      const { beijingHr, beijingDateStr } = utcToBeijing(l.start_date);
      // 计算睡眠日：北京时间 >= 18:00 → 归到明天
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
      .slice(-days)
      .map(([day, segs]) => {
        const sorted = segs.sort((a, b) => a.start_date.localeCompare(b.start_date));
        const inBedMin = sorted
          .filter(x => x.sleep_type === 'in_bed')
          .reduce((s, x) => s + (x.duration_minutes || 0), 0);
        const asleepMin = sorted
          .filter(x => !['in_bed', 'asleep_awake'].includes(x.sleep_type))
          .reduce((s, x) => s + (x.duration_minutes || 0), 0);
        return { day, segs: sorted, totalMin: inBedMin, asleepMin };
      });
  }, [logs, days]);

  // 时间轴范围：北京时间 18:00 ~ 次日 18:00
  const { axisStartHr, axisEndHr, axisHrs } = useMemo(() => {
    // 固定范围：18 ~ 42（北京时间 18:00 ~ 次日 18:00）
    let start = 18;
    let end = 42;
    // 如果数据超出范围，则扩展
    for (const d of dailySegments) {
      for (const seg of d.segs) {
        const { beijingHr: sh } = utcToBeijing(seg.start_date);
        const { beijingHr: eh } = utcToBeijing(seg.end_date);
        // sh/eh 是 0~23.999，需要映射到时间轴坐标
        // 时间轴显示 18:00 ~ 次日18:00，所以 <18 的时段 +24
        const shAdj = sh >= 18 ? sh : sh + 24;
        const ehAdj = eh >= 18 ? eh : eh + 24;
        if (shAdj < start) start = Math.floor(shAdj);
        if (ehAdj > end) end = Math.ceil(ehAdj);
      }
    }
    // 强制至少显示到次日 12:00（即 end >= 36）
    if (end < 36) end = 36;
    return { axisStartHr: start, axisEndHr: end, axisHrs: end - start };
  }, [dailySegments]);

  const stats = useMemo(() => {
    if (!dailySegments.length) return null;
    const t = dailySegments.map(d => d.totalMin);
    const a = dailySegments.map(d => d.asleepMin);
    return {
      avgTotal: Math.round(t.reduce((s, x) => s + x, 0) / t.length),
      avgAsleep: Math.round(a.reduce((s, x) => s + x, 0) / a.length),
      maxTotal: Math.max(...t),
      minTotal: Math.min(...t),
    };
  }, [dailySegments]);

  // 将 UTC 时间字符串转为 SVG Y 坐标
  const timeToY = useCallback((utcIso: string, svgH: number) => {
    const { beijingHr } = utcToBeijing(utcIso);
    const hr = beijingHr >= axisStartHr ? beijingHr : beijingHr + 24;
    const plotH = svgH - TOP_PAD - BOT_PAD;
    return TOP_PAD + ((hr - axisStartHr) / axisHrs) * plotH;
  }, [axisStartHr, axisHrs]);

  // 将 axis 小时（可能 >=24）转为 Y 坐标
  const axisHrToY = useCallback((hr: number, svgH: number) => {
    const plotH = svgH - TOP_PAD - BOT_PAD;
    return TOP_PAD + ((hr - axisStartHr) / axisHrs) * plotH;
  }, [axisStartHr, axisHrs]);

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

  const svgH = 600;
  const plotH = svgH - TOP_PAD - BOT_PAD;
  const svgW = Math.max(TIME_AXIS_W + dailySegments.length * COL_W + 64, 400);

  // 时间刻度：每小时一个
  const ticks: { hr: number; labelHr: number }[] = [];
  for (let h = axisStartHr; h <= axisEndHr; h++) {
    ticks.push({ hr: h, labelHr: h >= 24 ? h - 24 : h });
  }

  const onMove = useCallback((e: React.MouseEvent) => {
    if (!svgRef.current || !dailySegments.length) { setTooltip(null); setHoverCol(null); return; }
    const r = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const padL = TIME_AXIS_W + 20;
    const ci = Math.floor((mx - padL) / COL_W);
    if (ci < 0 || ci >= dailySegments.length) { setTooltip(null); setHoverCol(null); return; }
    setHoverCol(ci);
    const sd = dailySegments[ci];
    for (const seg of sd.segs) {
      const y1 = timeToY(seg.start_date, svgH), y2 = timeToY(seg.end_date, svgH);
      const cy = Math.max(y1, TOP_PAD), ch = Math.min(y2, svgH - BOT_PAD) - cy;
      if (ch <= 0) continue;
      const sx = padL + ci * COL_W + 4, sw = COL_W - 12;
      if (mx >= sx && mx <= sx + sw && my >= cy && my <= cy + ch) {
        setTooltip({ x: e.clientX, y: e.clientY, day: sd.day, type: seg.sleep_type, start: seg.start_date, end: seg.end_date, dur: seg.duration_minutes });
        return;
      }
    }
    setTooltip({ x: e.clientX, y: e.clientY, day: sd.day, type: '_summary', start: '', end: '', dur: sd.totalMin });
  }, [dailySegments, timeToY, svgH]);

  const onLeave = () => { setTooltip(null); setHoverCol(null); };

  if (loading) return <div style={S.loading}><div style={S.spinner} /><p>加载中...</p></div>;

  return (
    <div style={S.page}>
      <header style={S.header}>
        <Link href="/" style={S.back}>← 首页</Link>
        <h1 style={S.h1}>😴 睡眠数据</h1>
        <span style={S.badge}>{logs.length} 条</span>
        {isAuthenticated() && <Link href="/admin" style={S.adminLink}>管理 →</Link>}
      </header>

      {stats && (
        <div style={S.statsGrid}>
          {[['平均在床', stats.avgTotal], ['平均睡眠', stats.avgAsleep], ['最长', stats.maxTotal], ['最短', stats.minTotal]]
            .map(([l, v], i) => (
              <div key={i} style={{ ...S.statCard, opacity: animPct, transform: `translateY(${(1 - animPct) * 16}px)`, transition: `all ${0.35 + i * 0.07}s ease` }}>
                <div style={S.statLabel}>{l}</div>
                <div style={S.statValue}>{fmtH(typeof v === 'number' ? v : 0)}</div>
              </div>
            ))}
        </div>
      )}

      <div style={S.filterRow}>
        {[7, 14, 30, 60, 90, 180, 365].map(d => (
          <button key={d} onClick={() => setDays(d)} style={S.btn(d === days)}>{d}天</button>
        ))}
        <span style={{ fontSize: 11, color: '#52525b', marginLeft: 'auto' }}>{dailySegments.length} 天</span>
      </div>

      {dailySegments.length > 0 && (
        <div style={S.chartWrap}>
          <svg ref={svgRef as any} width={svgW} height={svgH}
            style={{ display: 'block', minWidth: '100%', fontFamily: 'system-ui,-apple-system,sans-serif' }}
            onMouseMove={onMove} onMouseLeave={onLeave}
          >
            <defs>
              <linearGradient id="gradInBed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.45" />
              </linearGradient>
            </defs>

            {/* 时间轴刻度 */}
            {ticks.map(t => {
              const y = axisHrToY(t.hr, svgH);
              const isMidnight = t.labelHr === 0;
              return (
                <g key={t.hr}>
                  <text x={TIME_AXIS_W - 4} y={y + 3.5} textAnchor="end"
                    fontSize={10} fill={isMidnight ? '#818cf8' : '#a1a1aa'} fontWeight={isMidnight ? 700 : 400}>
                    {`${t.labelHr}:00`}
                  </text>
                  <line x1={TIME_AXIS_W + 2} y1={y} x2={svgW - 32} y2={y}
                    stroke={isMidnight ? '#3b3b54' : '#1e1e32'}
                    strokeWidth={isMidnight ? 1.2 : 0.5}
                    strokeDasharray={isMidnight ? '6 3' : (t.hr % 2 === 0 ? '3 3' : undefined)} />
                  {isMidnight && (
                    <text x={TIME_AXIS_W + 6} y={y - 6} fontSize={8} fill="#818cf8" fontWeight={600}>午夜</text>
                  )}
                </g>
              );
            })}

            {/* 入场遮罩 */}
            {animPct < 1 && (
              <rect x={TIME_AXIS_W + 20} y={TOP_PAD}
                width={(svgW - TIME_AXIS_W - 44) * (1 - animPct)} height={plotH} fill="#0c0c1a" />
            )}

            {/* 每日列 */}
            {dailySegments.map((d, i) => {
              const cx = TIME_AXIS_W + 20 + i * COL_W + COL_W / 2;
              const isHover = hoverCol === i;
              return (
                <g key={d.day} style={{
                  opacity: animPct,
                  transition: `opacity 0.3s ease ${i * 18}ms`,
                }}>
                  <rect x={TIME_AXIS_W + 20 + i * COL_W} y={TOP_PAD} width={COL_W - 4} height={plotH}
                    rx={6} fill={isHover ? '#16162e' : 'transparent'}
                    stroke={isHover ? '#2a2a50' : 'transparent'} strokeWidth={isHover ? 1 : 0} />

                  {d.segs.map((seg, j) => {
                    const y1 = timeToY(seg.start_date, svgH), y2 = timeToY(seg.end_date, svgH);
                    const cy = Math.max(y1, TOP_PAD), ch = Math.min(y2, svgH - BOT_PAD) - cy;
                    if (ch <= 0) return null;
                    const isBed = seg.sleep_type === 'in_bed';
                    return (
                      <rect key={j}
                        x={TIME_AXIS_W + 20 + i * COL_W + 4}
                        y={cy} width={COL_W - 12} height={ch}
                        rx={3}
                        fill={isBed ? 'url(#gradInBed)' : TYPE_COLORS[seg.sleep_type]}
                        opacity={isBed ? 0.65 : 0.85}
                      />
                    );
                  })}

                  <text x={cx} y={svgH - 12} textAnchor="middle"
                    fontSize={9} fontWeight={500}
                    fill={isHover ? '#c4c4cf' : '#52525b'}>
                    {d.day.slice(5)}
                  </text>

                  {isHover && (
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
              const idx = dailySegments.findIndex(d => d.day === today);
              if (idx < 0) return null;
              const cx = TIME_AXIS_W + 20 + idx * COL_W + COL_W / 2;
              return <line x1={cx} y1={TOP_PAD} x2={cx} y2={svgH - BOT_PAD}
                stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.5} />;
            })()}
          </svg>

          <div style={S.legend}>
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

      {!dailySegments.length && <p style={S.empty}>暂无数据，请先通过 iOS 快捷指令同步</p>}

      <div style={{ marginTop: 24 }}>
        <h3 style={S.sectionTitle}>最近记录</h3>
        <div style={S.logList}>
          {logs.slice(-30).reverse().map(log => (
            <div key={log.id} style={{ ...S.logRow, opacity: animPct, transform: `translateX(${(1 - animPct) * -16}px)`, transition: 'all 0.4s ease 0.2s' }}>
              <span style={S.logDate}>{utcToBeijing(log.start_date).beijingDateStr} {fmtT(log.start_date)}</span>
              <span style={{ fontSize: 11, color: TYPE_COLORS[log.sleep_type], minWidth: 36 }}>{TYPE_LABELS[log.sleep_type]}</span>
              <span style={{ fontSize: 11, color: '#a1a1aa' }}>{fmtT(log.start_date)}–{fmtT(log.end_date)}</span>
              <span style={{ fontSize: 11, color: '#818cf8', fontWeight: 600 }}>{log.duration_minutes}min</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && tooltip.type !== '_summary' && (
        <div style={{
          position: 'fixed', left: tooltip.x + 18, top: tooltip.y - 6,
          background: '#181830', border: '1px solid #333355', borderRadius: 12,
          padding: '10px 14px', fontSize: 12, color: '#e4e4e7', pointerEvents: 'none',
          zIndex: 9999, boxShadow: '0 8px 36px rgba(0,0,0,0.55)', lineHeight: 1.75, whiteSpace: 'nowrap',
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
          position: 'fixed', left: tooltip.x + 18, top: tooltip.y - 6,
          background: '#181830', border: '1px solid #333355', borderRadius: 12,
          padding: '10px 14px', fontSize: 12, color: '#e4e4e7', pointerEvents: 'none',
          zIndex: 9999, boxShadow: '0 8px 36px rgba(0,0,0,0.55)', lineHeight: 1.75, whiteSpace: 'nowrap',
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{tooltip.day}</div>
          <div>睡眠 <span style={{ color: '#818cf8', fontWeight: 600 }}>{fmtH(dailySegments.find(d => d.day === tooltip.day)?.asleepMin || 0)}</span></div>
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
  filterRow: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' } as React.CSSProperties,
  btn: (a: boolean): React.CSSProperties => ({
    padding: '5px 14px', borderRadius: 14, fontSize: 12, outline: 'none' as any,
    border: `1px solid ${a ? '#6366f1' : 'rgba(255,255,255,0.12)'}`,
    background: a ? '#6366f118' : 'transparent', color: a ? '#a5b4fc' : '#a1a1aa', cursor: 'pointer',
  }),
  chartWrap: { overflowX: 'auto', borderRadius: 18, border: '1px solid #1e1e32', background: '#08081a', marginBottom: 32, paddingBottom: 12 } as React.CSSProperties,
  legend: { display: 'flex', gap: 16, padding: '10px 24px 14px', flexWrap: 'wrap', fontSize: 11, color: '#a1a1aa' } as React.CSSProperties,
  legendItem: { display: 'flex', alignItems: 'center', gap: 6 } as React.CSSProperties,
  empty: { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 56, lineHeight: 1.5 } as React.CSSProperties,
  sectionTitle: { fontSize: 15, fontWeight: 600, color: '#e4e4e7', margin: '0 0 14px' } as React.CSSProperties,
  logList: { display: 'flex', flexDirection: 'column', gap: 6 } as React.CSSProperties,
  logRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 12, background: '#121224', border: '1px solid #1e1e32' } as React.CSSProperties,
  logDate: { fontSize: 10, color: '#52525b', fontFamily: 'monospace', minWidth: 90 } as React.CSSProperties,
};
