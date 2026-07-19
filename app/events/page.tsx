'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { usePrivateAccess } from '@/lib/private';
import { C, pageStyle, headerStyle, h1Style, backLinkStyle, emptyStyle, loadingContainerStyle, spinnerStyle, loadingTextStyle } from '@/lib/card-styles';
import { TIME_SCALES, type TimeScale } from '@/lib/types';

interface EventGroup { id: string; name: string; icon: string; color: string; is_private: boolean; }
interface RawEvent { id: string; group_id: string; event_at: string; note?: string; refs?: {id:string;title:string}[]; }

const CHART_H = 420;
const PAD_T = 10;
const PAD_B = 60;
const PAD_L = 50;
const PAD_R = 20;
const MIN_BAR_W = 64;
const BAR_GAP = 2;

export default function EventsPage() {
  const [groups, setGroups] = useState<EventGroup[]>([]);
  const [rawEvents, setRawEvents] = useState<RawEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState<TimeScale>('daily');
  const [animReady, setAnimReady] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tooltip, setTooltip] = useState<{ x: number; y: number; key: string; items: { name: string; icon: string; color: string; count: number; songs?: {title:string;amount?:number}[] }[] } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(900);
  const { unlocked, refreshKey } = usePrivateAccess();

  useEffect(() => { fetchData(); }, [refreshKey]);

  const fetchData = async () => {
    setLoading(true);
    const { data: gData } = await supabase.from('event_groups').select('*').order('sort_order');
    const gs = (gData || []).filter((g) => unlocked || !g.is_private) as EventGroup[];
    setGroups(gs);
    setVisibleGroups(new Set(gs.map(g => g.id)));

    // 默认只取公开日志（RLS 已屏蔽私密组）；解锁后改用管理 RPC 拉取全部（含私密）
    let events: RawEvent[] = [];
    if (unlocked) {
      const hash = getSession();
      if (hash) {
        const { data: priv } = await supabase.rpc('fn_get_event_logs_admin', { p_hash: hash });
        if (priv && Array.isArray(priv)) {
          events = (priv as Array<Record<string, unknown>>).map((r) => ({
            id: r.id as string,
            group_id: r.group_id as string,
            event_at: r.event_at as string,
            note: (r.note as string) || undefined,
            refs: (r.refs as { id: string; title: string }[]) || undefined,
          }));
        }
      }
    }
    if (!events.length) {
      const { data: eData } = await supabase.from('event_logs').select('id, group_id, event_at, note, refs').order('event_at').limit(5000);
      events = (eData || []) as RawEvent[];
    }
    setRawEvents(events);
    setLoading(false);
    setTimeout(() => setAnimReady(true), 100);
  };

  useEffect(() => {
    const r = () => { if (containerRef.current) setChartW(Math.max(400, containerRef.current.clientWidth - 4)); };
    r(); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r);
  }, []);

  const toggleGroup = (gid: string) => setVisibleGroups(prev => { const n = new Set(prev); n.has(gid) ? n.delete(gid) : n.add(gid); return n; });
  const selectAll = () => setVisibleGroups(new Set(groups.map(g => g.id)));
  const deselectAll = () => setVisibleGroups(new Set());



  // 生成所有时间桶（填满范围，0 值也保留）
  const buckets = useMemo(() => {
    const active = groups.filter(g => visibleGroups.has(g.id));
    const activeIds = new Set(active.map(g => g.id));
    const events = rawEvents.filter(e => activeIds.has(e.group_id));
    if (!events.length) return [];

    const allTs = events.map(e => new Date(e.event_at).getTime());
    const tMin = Math.min(...allTs);
    const tMax = Math.max(...allTs);

    // 对齐到步长边界
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

    // 填充数据: key = Date.getTime() as string
    const dataMap: Record<string, Record<string, number>> = {};
    for (const e of events) {
      const ts = alignDown(new Date(e.event_at).getTime());
      const key = String(ts);
      if (!dataMap[key]) dataMap[key] = {};
      dataMap[key][e.group_id] = (dataMap[key][e.group_id] || 0) + 1;
    }

    // 按正确步长迭代生成桶（解决月/年步长不固定问题）
    const result: { key: string; data: Record<string, number>; total: number }[] = [];
    const d = new Date(alignDown(tMax + 86400000));
    const endTs = tMin; // 多一个桶

    for (let i = 0; i < 100 && d.getTime() >= tMin; i++) {
      const key = String(d.getTime());
      const data = dataMap[key] || {};
      const total = Object.values(data).reduce((a, b) => a + b, 0);
      result.push({ key, data, total });

      switch (scale) {
        case 'hourly': d.setHours(d.getHours() - 1); break;
        case 'daily': d.setDate(d.getDate() - 1); break;
        case 'weekly': d.setDate(d.getDate() -7); break;
        case 'monthly': d.setMonth(d.getMonth() - 1); break;
        case 'yearly': d.setFullYear(d.getFullYear() - 1); break;
      }
    }
    result.reverse();

    return result;
  }, [rawEvents, visibleGroups, scale, groups]);

  // 图表尺寸
  const barW = MIN_BAR_W;
  const totalBarW = Math.max(chartW - PAD_L - PAD_R, buckets.length * (barW + BAR_GAP));
  const plotH = CHART_H - PAD_T - PAD_B;
  const maxCount = Math.max(1, ...buckets.map(b => b.total));
  const activeGroups = groups.filter(g => visibleGroups.has(g.id));

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth; }, [scale, visibleGroups]);

  const fmtRange = (ts: string): string => {
    const d = new Date(Number(ts));
    const pad = (n: number) => String(n).padStart(2, '0');
    switch (scale) {
      case 'hourly': {
        const end = new Date(d); end.setHours(end.getHours() + 1);
        return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:00~${pad(end.getHours())}:00`;
      }
      case 'daily': {
        const end = new Date(d); end.setDate(end.getDate() + 1);
        return `${pad(d.getMonth()+1)}/${pad(d.getDate())}~${pad(end.getMonth()+1)}/${pad(end.getDate())}`;
      }
      case 'weekly': {
        const end = new Date(d); end.setDate(end.getDate() + 7);
        return `${pad(d.getMonth()+1)}/${pad(d.getDate())}~${pad(end.getMonth()+1)}/${pad(end.getDate())}`;
      }
      case 'monthly': {
        const end = new Date(d); end.setMonth(end.getMonth() + 1);
        return `${d.getFullYear()}/${pad(d.getMonth()+1)}~${end.getFullYear()}/${pad(end.getMonth()+1)}`;
      }
      case 'yearly': return `${d.getFullYear()} 年`;
    }
  };

  const fmtLabel = (ts: string): string => {
    const d = new Date(Number(ts));
    const pad = (n: number) => String(n).padStart(2, '0');
    switch (scale) {
      case 'hourly': return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:00`;
      case 'daily': return `${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
      case 'weekly': return `${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
      case 'monthly': return `${d.getFullYear()}/${pad(d.getMonth()+1)}`;
      case 'yearly': return `${d.getFullYear()}`;
    }
  };

  if (loading) return (<div style={loadingContainerStyle}><div style={spinnerStyle}/><p style={loadingTextStyle}>加载中...</p></div>);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={backLinkStyle}>← 返回首页</Link>
        <h1 style={h1Style}>📅 事件计数</h1>
      </header>

      {/* 组筛选 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => visibleGroups.size === groups.length ? deselectAll() : selectAll()} style={sBtn}>
          {visibleGroups.size === groups.length ? '取消全选' : '全选'}
        </button>
        {groups.map(g => { const on = visibleGroups.has(g.id); return (
          <button key={g.id} onClick={() => toggleGroup(g.id)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 14, fontSize: 12,
            border: `1.5px solid ${g.color}${on ? 'cc' : '22'}`, background: on ? g.color + '18' : 'transparent',
            color: on ? '#e4e4e7' : '#52525b', cursor: 'pointer', outline: 'none', transition: 'all .15s',
          }}>
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, background: g.color, opacity: on ? 1 : .25 }}/>{g.icon} {g.name}
          </button>);
        })}
      </div>

      {/* 尺度选择 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {TIME_SCALES.map(s => (
          <button key={s.value} onClick={() => { setAnimReady(false); setScale(s.value); setTimeout(() => setAnimReady(true), 50); }} style={{
            padding: '5px 12px', borderRadius: 14, fontSize: 12, outline: 'none',
            border: `1px solid ${scale === s.value ? '#6366f1' : 'rgba(255,255,255,.12)'}`,
            background: scale === s.value ? '#6366f122' : 'transparent',
            color: scale === s.value ? '#a5b4fc' : '#a1a1aa', cursor: 'pointer',
          }}>{s.label}</button>
        ))}
        <span style={{ fontSize: 11, color: '#52525b', marginLeft: 'auto' }}>
          {buckets.length} 个划分 · 按住 Shift + 滚轮水平滚动
        </span>
      </div>

      {buckets.length === 0 && <p style={emptyStyle}>暂无事件数据</p>}

      {buckets.length > 0 && (
        <div ref={containerRef} style={{ position: 'relative' }}>
          {/* Tooltip */}
          {tooltip && (
            <div
              onMouseEnter={() => { if (tooltipTimer.current) clearTimeout(tooltipTimer.current); }}
              onMouseLeave={() => setTooltip(null)}
              style={{
              position: 'absolute', left: Math.min(tooltip.x + 12, (containerRef.current?.clientWidth || 900) - 160),
              top: Math.max(4, tooltip.y - 250), zIndex: 20,
              padding: '8px 12px', borderRadius: 10, background: '#1a1a30', border: '1px solid #2a2a45',
              boxShadow: '0 4px 16px rgba(0,0,0,.6)', minWidth: 180, maxHeight: 260, overflowY: 'auto',
            }}>
              <div style={{ fontSize: 11, color: '#a1a1aa', marginBottom: 6 }}>{tooltip.key}</div>
              {tooltip.items.map((item, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: item.color, flexShrink: 0 }}/>
                    <span style={{ fontSize: 12, color: '#e4e4e7' }}>{item.icon} {item.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: item.color, marginLeft: 'auto' }}>{item.count}</span>
                  </div>
                  {item.songs && item.songs.length > 0 && (
                    <div style={{ marginLeft: 14, marginBottom: 4, padding: '4px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, maxHeight: 120, overflowY: 'auto' }}>
                      {item.songs.map((s, si) => (
                        <div key={si} style={{ fontSize: 10, color: '#818cf8', padding: '1px 0' }}>
                          {item.name === '大餐' ? '🍽️' : '🎵'} {s.title}{s.amount ? ` ¥${s.amount}` : ''}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div ref={scrollRef} style={{
            overflowX: 'auto', overflowY: 'hidden',
            borderRadius: 16, border: '1px solid #1e1e32', background: '#0c0c1a',
            marginBottom: 32, width: '100%',
          }}>
            <svg width={totalBarW + PAD_L + PAD_R} height={CHART_H}
              style={{ display: 'block', fontFamily: 'sans-serif', minWidth: '100%' }}>

              {/* Y轴 */}
              {[0, 0.25, 0.5, 0.75, 1].map(r => {
                const y = PAD_T + plotH * (1 - r);
                return (<g key={r}>
                  <line x1={PAD_L} y1={y} x2={totalBarW + PAD_L} y2={y} stroke="#ffffff06" strokeWidth={1}/>
                  <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize={10} fill="#52525b">{Math.round(r * maxCount)}</text>
                </g>);
              })}

              {/* 柱状图 */}
              {buckets.map((b, bi) => {
                const bx = PAD_L + bi * (barW + BAR_GAP);
                const label = fmtLabel(b.key);
                const range = fmtRange(b.key);
                let yStack = PAD_T + plotH;

                // 各组的柱体尺寸
                const segments: { g: EventGroup; cnt: number; h: number }[] = [];
                for (const g of activeGroups) {
                  const cnt = b.data[g.id] || 0;
                  if (cnt > 0) segments.push({ g, cnt, h: (cnt / maxCount) * plotH });
                }

                return (
                  <g key={b.key}>
                    {/* 透明点击区域 —— 和整个柱体完全对齐 */}
                    <rect x={bx} y={PAD_T + plotH - (b.total / maxCount) * plotH}
                      width={barW} height={Math.max(1, (b.total / maxCount) * plotH)}
                      fill="transparent" style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => {
                        if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
                        const ct = containerRef.current;
                        if (!ct) return;
                        // Compute bucket time span
                        const keyTs = parseInt(b.key, 10);
                        const d = new Date(keyTs);
                        let tE: number;
                        switch (scale) {
                          case 'hourly': tE = keyTs + 3600000; break;
                          case 'daily': tE = keyTs + 86400000; break;
                          case 'weekly': tE = keyTs + 7 * 86400000; break;
                          case 'monthly': { const nd = new Date(d); nd.setMonth(nd.getMonth() + 1); tE = nd.getTime(); } break;
                          case 'yearly': { const nd = new Date(d); nd.setFullYear(nd.getFullYear() + 1); tE = nd.getTime(); } break;
                          default: tE = keyTs + 86400000;
                        }
                        const items = segments.map(s => {
                          const isRefGroup = s.g.name === '唱k' || s.g.name === '户外唱歌' || s.g.name === '大餐';
                          let songs: {title:string}[] | undefined;
                          if (isRefGroup) {
                            const bucketEvents = rawEvents.filter(ev => {
                              if (ev.group_id !== s.g.id) return false;
                              const ts = new Date(ev.event_at).getTime();
                              return ts >= keyTs && ts < tE;
                            });
                            const songSet = new Map<string, {title:string;amount?:number}>();
                            for (const ev of bucketEvents) {
                              if (ev.refs) for (const sr of ev.refs as any[]) {
                                if (!songSet.has(sr.title)) songSet.set(sr.title, {title:sr.title, amount:sr.amount});
                              }
                            }
                            if (songSet.size > 0) songs = [...songSet.values()];
                          }
                          return { name: s.g.name, icon: s.g.icon, color: s.g.color, count: s.cnt, songs };
                        });
                        const barTop = PAD_T + plotH - (b.total / maxCount) * plotH;
                        const tooltipY = barTop - 10; // just above the bar
                        setTooltip({ x: e.clientX - ct.getBoundingClientRect().left, y: tooltipY, key: range, items });
                      }}
                      onMouseLeave={() => { tooltipTimer.current = setTimeout(() => setTooltip(null), 200); }}
                    />

                    {/* 堆叠柱体 */}
                    {segments.map(s => {
                      const h = animReady ? s.h : 0;
                      const y = yStack - h;
                      yStack = y;
                      const delay = bi * 10 + activeGroups.indexOf(s.g) * 20;
                      return (
                        <rect key={s.g.id} x={bx} y={y} width={barW} height={Math.max(1, h)}
                          fill={s.g.color} opacity={0.85} rx={barW > 4 ? 2 : 0}
                          style={{ pointerEvents: 'none',
                            transition: `height ${250 + delay}ms cubic-bezier(0.34,1.56,0.64,1), y ${250 + delay}ms cubic-bezier(0.34,1.56,0.64,1)` }}/>
                      );
                    })}

                    {/* X轴标签 */}
                    {buckets.length <= 60 || bi % Math.ceil(buckets.length / 30) === 0 ? (
                      <text x={bx + barW / 2} y={CHART_H - 8} textAnchor="middle" fontSize={9} fill="#52525b"
                        transform={`rotate(-35, ${bx + barW / 2}, ${CHART_H - 8})`} style={{ pointerEvents: 'none' }}>
                        {label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* 底部统计 */}
      {groups.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
          {groups.map(g => {
            const total = rawEvents.filter(e => e.group_id === g.id).length;
            return (<div key={g.id} style={statCard(g.color + '33')}>
              <div style={{fontSize:22,marginBottom:4}}>{g.icon}</div>
              <div style={{fontSize:12,color:'#a1a1aa',marginBottom:4}}>{g.name}</div>
              <div style={{fontSize:24,fontWeight:700,color:'#e4e4e7'}}>{total}</div>
              <div style={{fontSize:11,color:'#52525b',marginTop:2}}>次</div>
            </div>);
          })}
        </div>
      )}
    </div>
  );
}

const statCard = (bc: string): React.CSSProperties => ({ padding: 16, borderRadius: 12, border: `1px solid ${bc}`, background: '#121224', textAlign: 'center' });
const sBtn: React.CSSProperties = { padding: '5px 12px', borderRadius: 14, fontSize: 12, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', outline: 'none' };
