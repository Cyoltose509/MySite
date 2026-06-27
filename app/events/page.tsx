'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { C, pageStyle, headerStyle, h1Style, backLinkStyle, emptyStyle, loadingContainerStyle, spinnerStyle, loadingTextStyle } from '@/lib/card-styles';

interface EventGroup { id: string; name: string; icon: string; color: string; is_private: boolean; }
interface RawEvent { id: string; group_id: string; event_at: string; }

const CHART_H = 520;
const PAD_L = 100;
const PAD_R = 30;
const PAD_T = 15;
const PAD_B = 70;
const DOT_R_MIN = 4;
const DOT_R_MAX = 9;

export default function EventsPage() {
  const [groups, setGroups] = useState<EventGroup[]>([]);
  const [rawEvents, setRawEvents] = useState<RawEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState(2);
  const [panX, setPanX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragInfo = useRef({ startX: 0, startPan: 0 });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string; color: string } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(900);

  useEffect(() => { fetchData(); }, []);

  // ─── 阻止页面滚动 ───
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => { e.preventDefault(); };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [loading]);

  const fetchData = async () => {
    setLoading(true);
    const { data: gData } = await supabase.from('event_groups').select('*').order('sort_order', { ascending: true });
    const gs = (gData || []) as EventGroup[];
    setGroups(gs);
    setVisibleGroups(new Set(gs.map(g => g.id)));
    const { data: eData } = await supabase
      .from('event_logs').select('id, group_id, event_at').order('event_at', { ascending: true }).limit(5000);
    setRawEvents((eData || []) as RawEvent[]);
    setLoading(false);
  };

  const filteredEvents = useMemo(() => rawEvents.filter(e => visibleGroups.has(e.group_id)), [rawEvents, visibleGroups]);
  const timeRange = useMemo(() => {
    if (!filteredEvents.length) return { min: 0, max: 1 };
    const ts = filteredEvents.map(e => new Date(e.event_at).getTime());
    return { min: Math.min(...ts), max: Math.max(...ts) };
  }, [filteredEvents]);

  const toggleGroup = (gid: string) => setVisibleGroups(prev => { const n = new Set(prev); n.has(gid) ? n.delete(gid) : n.add(gid); return n; });
  const selectAll = () => setVisibleGroups(new Set(groups.map(g => g.id)));
  const deselectAll = () => setVisibleGroups(new Set());

  const groupCounts = useMemo(() => { const m: Record<string, number> = {}; rawEvents.forEach(e => { m[e.group_id] = (m[e.group_id]||0)+1; }); return m; }, [rawEvents]);

  // ─── 图表尺寸 ───
  useEffect(() => {
    const r = () => { if (containerRef.current) setChartWidth(Math.max(400, containerRef.current.clientWidth - 4)); };
    r(); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r);
  }, []);

  const dataW = chartWidth - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const totalMs = timeRange.max - timeRange.min || 1;
  const groupRows = groups.filter(g => visibleGroups.has(g.id));
  const laneH = Math.min(55, Math.max(18, plotH / Math.max(1, groupRows.length + 0.5)));
  const dotR = Math.min(DOT_R_MAX, Math.max(DOT_R_MIN, laneH * 0.30));

  // panX 范围：限制在数据边界内
  const panMin = dataW * (1 - scale);
  const panMax = 0;
  const setPanClamped = (v: number) => setPanX(Math.max(panMin, Math.min(panMax, v)));

  const toX = useCallback((ts: number) => {
    const r = (ts - timeRange.min) / totalMs;
    return PAD_L + (r * scale + panX / dataW) * dataW;
  }, [timeRange, totalMs, scale, panX, dataW]);

  const toY = useCallback((r: number) => PAD_T + (r + 0.5) * laneH, [laneH]);

  // 时间刻度
  const timeTicks = useMemo(() => {
    const t: number[] = [];
    const vMs = totalMs / scale;
    const sMs = timeRange.min - (panX / dataW) * vMs;
    const eMs = sMs + vMs;
    let step: number;
    if (vMs < 36e5) step = 3e5; else if (vMs < 216e5) step = 36e5; else if (vMs < 864e5) step = 144e5;
    else if (vMs < 6048e5) step = 864e5; else if (vMs < 2592e6) step = 6048e5; else step = 2592e6;
    for (let ts = Math.ceil(sMs/step)*step; ts <= eMs; ts += step) { if (t.length > 30) break; t.push(ts); }
    return t;
  }, [dataW, totalMs, scale, panX, timeRange]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts), span = totalMs / scale;
    if (span < 216e5) return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    if (span < 2592e6) return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:00`;
    return `${d.getMonth()+1}/${d.getDate()}`;
  };

  /* ── 操作 ── */
  const zIn = () => { setPanX(prev => { const ns = Math.min(300, scale * 1.6); setScale(ns); return Math.max(dataW*(1-ns), Math.min(0, prev)); }); };
  const zOut = () => { setPanX(prev => { const ns = Math.max(1, scale / 1.6); setScale(ns); return Math.max(dataW*(1-ns), Math.min(0, prev)); }); };

  // 按钮：◀ = 看更早内容（panX 增大）, ▶ = 看更晚内容（panX 减小）
  const panLeft = () => setPanClamped(panX + dataW * 0.25);
  const panRight = () => setPanClamped(panX - dataW * 0.25);
  const resetView = () => { setScale(2); setPanX(0); };

  const onWheel = useCallback((e: React.WheelEvent) => { e.deltaY > 0 ? zOut() : zIn(); }, [scale]);
  const onDn = useCallback((e: React.MouseEvent) => { setDragging(true); dragInfo.current = { startX: e.clientX, startPan: panX }; }, [panX]);
  const onMv = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragInfo.current.startX;
    // 拖拽方向：drag-right（dx>0）→ 内容右移 → 看更早的 → panX增大
    const newP = dragInfo.current.startPan + dx * (totalMs / scale / dataW);
    setPanClamped(newP);
  }, [dragging, totalMs, scale, dataW]);
  const onUp = useCallback(() => { setDragging(false); setTooltip(null); }, []);

  // 滚动条点击跳转
  const onScrollbarClick = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / dataW;
    setPanX(dataW * (1 - scale * ratio));
  }, [dataW, scale]);

  if (loading) return (<div style={loadingContainerStyle}><div style={spinnerStyle}/><p style={loadingTextStyle}>加载中...</p></div>);

  const allOn = visibleGroups.size === groups.length;

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={backLinkStyle}>← 返回首页</Link>
        <h1 style={h1Style}>📅 事件时间线</h1>
      </header>

      {/* 组筛选 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => allOn ? deselectAll() : selectAll()} style={sBtn}>{allOn ? '取消全选' : '全选'}</button>
        {groups.map(g => { const on = visibleGroups.has(g.id); return (
          <button key={g.id} onClick={() => toggleGroup(g.id)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 14, fontSize: 12, border: `1.5px solid ${g.color}${on?'cc':'22'}`, background: on ? g.color+'18' : 'transparent', color: on ? '#e4e4e7' : '#52525b', cursor: 'pointer', outline: 'none', transition: 'all .15s' }}>
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, background: g.color, opacity: on?1:.25 }}/>{g.icon} {g.name}
          </button>);
        })}
      </div>

      {/* 缩放控制 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={zIn} style={sZoom} title="放大">🔍＋</button>
        <button onClick={zOut} style={sZoom} title="缩小">🔍－</button>
        <button onClick={panLeft} style={sZoom} title="看更早 (◀)">◀ 更早</button>
        <button onClick={panRight} style={sZoom} title="看更晚 (▶)">更晚 ▶</button>
        <button onClick={resetView} style={{ ...sZoom, background: '#6366f122', borderColor: '#6366f155', color: '#a5b4fc' }}>↺ 重置</button>
        <span style={{ fontSize: 11, color: '#52525b', marginLeft: 'auto' }}>
          滚轮缩放 · 拖拽平移 · 悬停详情 · {filteredEvents.length} 事件
        </span>
      </div>

      {filteredEvents.length === 0 && <p style={emptyStyle}>暂无事件数据（请至少勾选一个组）</p>}

      {filteredEvents.length > 0 && (
        <div ref={containerRef} style={{ overflow: 'hidden', borderRadius: 16, border: '1px solid #1e1e32', background: '#0c0c1a', marginBottom: 32, userSelect: 'none', width: '100%', position: 'relative' }}>
          {tooltip && (
            <div style={{ position: 'absolute', left: tooltip.x + 12, top: tooltip.y - 10, padding: '4px 10px', borderRadius: 8, background: '#1a1a30', border: `1px solid ${tooltip.color}44`, color: '#e4e4e7', fontSize: 12, pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.5)', zIndex: 10, whiteSpace: 'pre', fontFamily: 'sans-serif' }}>
              {tooltip.text}
            </div>
          )}
          <svg ref={svgRef} viewBox={`0 0 ${chartWidth} ${CHART_H}`} width="100%" height={CHART_H}
            style={{ display: 'block', cursor: dragging ? 'grabbing' : 'grab' }}
            onWheel={onWheel} onMouseDown={onDn} onMouseMove={onMv} onMouseUp={onUp} onMouseLeave={onUp}>

            {/* 泳道背景 */}
            {groupRows.map((g, i) => <rect key={g.id} x={PAD_L} y={PAD_T+i*laneH} width={dataW} height={laneH} fill={i%2===0?'#ffffff03':'#ffffff06'} rx={4}/>)}

            {/* 网格线 */}
            {timeTicks.map(t => { const x = toX(t); if (x<PAD_L||x>chartWidth-PAD_R) return null; return (
              <g key={t}><line x1={x} y1={PAD_T} x2={x} y2={CHART_H-PAD_B} stroke="#ffffff08" strokeWidth={1}/>
              <text x={x} y={CHART_H-8} textAnchor="middle" fontSize={10} fill="#52525b" transform={`rotate(-25,${x},${CHART_H-8})`}>{fmtTime(t)}</text></g>); })}

            {/* 组标签 */}
            {groupRows.map((g, i) => { const cnt = groupCounts[g.id]||0; return (
              <g key={g.id}><rect x={6} y={PAD_T+i*laneH+laneH*.1} width={PAD_L-12} height={laneH*.8} rx={6} fill={g.color+'15'} stroke={g.color+'33'} strokeWidth={1}/>
              <text x={PAD_L/2} y={toY(i)} textAnchor="middle" fontSize={13} fontWeight={600} fill={g.color}>{g.icon}</text>
              <text x={PAD_L/2} y={toY(i)+laneH*.35} textAnchor="middle" fontSize={9} fill="#a1a1aa">{cnt}次</text></g>); })}

            {/* 事件点 */}
            {groupRows.map((g, ri) => { const evts = filteredEvents.filter(e=>e.group_id===g.id); return (
              <g key={g.id}>{evts.map(e => { const ts=new Date(e.event_at).getTime(), x=toX(ts);
                if (x<PAD_L-8||x>chartWidth-PAD_R+8) return null; const y=toY(ri);
                return <circle key={e.id} cx={x} cy={y} r={dotR} fill={g.color} opacity={.85} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setTooltip({ x: toX(ts)-PAD_L, y: toY(ri)-laneH*.4, text: `${g.icon} ${g.name}\n${new Date(e.event_at).toLocaleDateString('zh-CN')} ${new Date(e.event_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`, color: g.color })}
                  onMouseLeave={() => setTooltip(null)} />; })}
              </g>); })}

            {/* 底部可点击滚动条 */}
            <rect x={PAD_L} y={CHART_H-8} width={dataW} height={6} fill="#ffffff08" rx={3} style={{ cursor: 'pointer' }} onClick={onScrollbarClick}/>
            <rect x={PAD_L + Math.max(0, -panX)} y={CHART_H-8} width={Math.max(8, dataW/scale)} height={6} fill="#6366f1" rx={3} opacity={.55} style={{ cursor: 'pointer', pointerEvents: 'none' }}/>
          </svg>
        </div>
      )}

      {/* 统计 */}
      {groups.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
          {groups.map(g => (<div key={g.id} style={statCard(g.color+'33')}><div style={{fontSize:22,marginBottom:4}}>{g.icon}</div><div style={{fontSize:12,color:'#a1a1aa',marginBottom:4}}>{g.name}</div><div style={{fontSize:24,fontWeight:700,color:'#e4e4e7'}}>{groupCounts[g.id]||0}</div><div style={{fontSize:11,color:'#52525b',marginTop:2}}>次</div></div>))}
        </div>
      )}
    </div>
  );
}

const statCard = (bc: string): React.CSSProperties => ({ padding: 16, borderRadius: 12, border: `1px solid ${bc}`, background: '#121224', textAlign: 'center' });
const sBtn: React.CSSProperties = { padding: '5px 12px', borderRadius: 14, fontSize: 12, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', outline: 'none' };
const sZoom: React.CSSProperties = { padding: '5px 10px', borderRadius: 8, fontSize: 12, border: '1px solid rgba(255,255,255,.1)', background: '#121224', color: '#a1a1aa', cursor: 'pointer', outline: 'none' };
