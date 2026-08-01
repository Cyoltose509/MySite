'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/card-styles';
import { getQuickSearchIndex } from '@/lib/search';

type RelKey = 'lover' | 'crush' | 'friend' | 'enemy' | 'roommate';

const REL_TYPES: { key: RelKey; label: string; color: string; reciprocal: boolean }[] = [
  { key: 'lover', label: '恋人', color: '#f472b6', reciprocal: true },
  { key: 'crush', label: '单相思', color: '#fb923c', reciprocal: false },
  { key: 'friend', label: '好朋友', color: '#4ade80', reciprocal: true },
  { key: 'enemy', label: '死对头', color: '#f87171', reciprocal: true },
  { key: 'roommate', label: '同宿舍', color: '#38bdf8', reciprocal: true },
];
const REL_COLOR: Record<RelKey, string> = {
  lover: '#f472b6', crush: '#fb923c', friend: '#4ade80', enemy: '#f87171', roommate: '#38bdf8',
};

interface GNode { id: string; name: string; apt: string | null; rating: number | null; nickname: string | null; }
interface GEdge { key: string; source: string; target: string; type: RelKey; directed: boolean; }

// 固定坐标系：不再随节点范围自适应缩放，避免拖动时坐标跳变（原 bug 根源）
const W = 1300, H = 920;
const WALL = { l: 20, r: W - 20, t: 20, b: H - 36 };
const NODE_R = 18;
const HIT_R = 26;
const NODE_COLOR = '#6366f1';
const STORAGE_KEY = 'peopleGraphLayout';

// 物理参数
const REPULSE = 2000;   // 节点间斥力（调弱：整图更紧凑）
const SPRING_K = 0.018; // 关系连线弹簧
const SPRING_LEN = 150; // 弹簧自然长度（调大：连了线的节点之间更舒展，不挤成一团）
const DAMP = 0.9;       // 阻尼
const MAXV = 14;        // 速度上限（保证稳定）
const JITTER = 0.05;    // 微扰，让画面一直“活着”

// 初始布局：单簇向日葵（不再按 apt 分组）
function seedPositions(people: GNode[]): Record<string, { x: number; y: number }> {
  const cx = W / 2, cy = H / 2;
  const pos: Record<string, { x: number; y: number }> = {};
  people.forEach((p, i) => {
    const r = 38 * Math.sqrt(i);
    const a = i * 2.399963;
    pos[p.id] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
  return pos;
}

function buildEdges(relations: any[]): GEdge[] {
  const map = new Map<string, GEdge>();
  (relations || []).forEach((r) => {
    const t = r.rel_type as RelKey;
    if (t === 'crush') {
      const key = `${r.source_id}|${r.target_id}::crush`;
      if (!map.has(key)) map.set(key, { key, source: r.source_id, target: r.target_id, type: 'crush', directed: true });
    } else if (['lover', 'friend', 'enemy', 'roommate'].includes(t)) {
      const [a, b] = [r.source_id, r.target_id].sort();
      const key = `${a}|${b}::${t}`;
      if (!map.has(key)) map.set(key, { key, source: a, target: b, type: t, directed: false });
    }
  });
  return [...map.values()];
}

export function PeopleGraphEditor() {
  const [people, setPeople] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [loading, setLoading] = useState(true);

  const [tool, setTool] = useState<'select' | RelKey>('select');
  const [labels, setLabels] = useState(true);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [, setTick] = useState(0); // 驱动每帧重绘

  const svgRef = useRef<SVGSVGElement | null>(null);
  const posRef = useRef<Record<string, { x: number; y: number }>>({});
  const velRef = useRef<Record<string, { x: number; y: number; vx: number; vy: number }>>({});
  const edgesRef = useRef<GEdge[]>([]);
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const linkRef = useRef<{ from: string; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const toolRef = useRef(tool); // 供物理循环读取最新 tool（useEffect 闭包不会自动刷新）
  useEffect(() => {
    toolRef.current = tool;
    // 切换工具即重绘：真实的净力（被移除的弹簧 + 被加强的选中弹簧）会驱动节点重新排布，无需随机扰动
    setTick((t) => t + 1);
  }, [tool]);

  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: ps }, { data: rs }] = await Promise.all([
      supabase.from('people').select('id,name,apt,rating,nickname').order('name'),
      supabase.from('people_relations').select('source_id,target_id,rel_type'),
    ]);
    const ppl = (ps as GNode[]) || [];
    setPeople(ppl);
    setEdges(buildEdges((rs as any[]) || []));
    const base = seedPositions(ppl);
    const pos: Record<string, { x: number; y: number }> = {};
    const vel: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
    let saved: Record<string, { x: number; y: number }> = {};
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) saved = JSON.parse(raw);
    } catch { saved = {}; }
    ppl.forEach((p) => {
      pos[p.id] = saved[p.id] || base[p.id];
      vel[p.id] = { x: 0, y: 0, vx: 0, vy: 0 };
    });
    posRef.current = pos;
    velRef.current = vel;
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // 力导向模拟主循环
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const pos = posRef.current, vel = velRef.current;
      const ids = Object.keys(pos);
      if (ids.length) {
        const fx: Record<string, number> = {}, fy: Record<string, number> = {};
        ids.forEach((id) => { fx[id] = 0; fy[id] = 0; });
        // 斥力（O(n^2)，118 人完全够用）
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = pos[ids[i]], b = pos[ids[j]];
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy; if (d2 < 100) d2 = 100;
            let f = REPULSE / d2; if (f > 4) f = 4;
            const d = Math.sqrt(d2), ux = dx / d, uy = dy / d;
            fx[ids[i]] += f * ux; fy[ids[i]] += f * uy;
            fx[ids[j]] -= f * ux; fy[ids[j]] -= f * uy;
          }
        }
        // 弹簧（关系连线）：选中某关系类型时只该类型起作用（且加强其弹簧让聚类可见），移动模式全部生效
        const tTool = toolRef.current;
        const selK = tTool !== 'select' ? SPRING_K * 2 : SPRING_K;
        edgesRef.current.forEach((e) => {
          if (tTool !== 'select' && e.type !== tTool) return;
          const a = pos[e.source], b = pos[e.target];
          if (!a || !b) return;
          let dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const f = selK * (d - SPRING_LEN);
          const ux = dx / d, uy = dy / d;
          fx[e.source] += f * ux; fy[e.source] += f * uy;
          fx[e.target] -= f * ux; fy[e.target] -= f * uy;
        });
        // 积分
        let maxSpeed = 0;
        ids.forEach((id) => {
          if (dragRef.current && dragRef.current.id === id) return; // 拖动节点由指针控制
          let vx = vel[id].vx, vy = vel[id].vy;
          vx += (Math.random() - 0.5) * JITTER;
          vy += (Math.random() - 0.5) * JITTER;
          vx = (vx + fx[id]) * DAMP;
          vy = (vy + fy[id]) * DAMP;
          const sp = Math.hypot(vx, vy);
          if (sp > MAXV) { vx *= MAXV / sp; vy *= MAXV / sp; }
          let nx = pos[id].x + vx, ny = pos[id].y + vy;
          // 碰墙：弹性反弹 + 一点随机扰动，避免“贴墙卡死”（不额外施加向内力）
          if (nx < WALL.l) { nx = WALL.l; vx = -vx * 0.9 + (Math.random() - 0.5); }
          if (nx > WALL.r) { nx = WALL.r; vx = -vx * 0.9 + (Math.random() - 0.5); }
          if (ny < WALL.t) { ny = WALL.t; vy = -vy * 0.9 + (Math.random() - 0.5); }
          if (ny > WALL.b) { ny = WALL.b; vy = -vy * 0.9 + (Math.random() - 0.5); }
          pos[id].x = nx; pos[id].y = ny; vel[id].vx = vx; vel[id].vy = vy;
          if (sp > maxSpeed) maxSpeed = sp;
        });
        if (maxSpeed > 0.04 || dragRef.current || linkRef.current) setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const idToName = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const nameById = (id: string) => idToName.get(id) || '?';

  const matched = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    return new Set(
      people
        .filter(
          (p) =>
            getQuickSearchIndex(p.name.toLowerCase()).includes(q) ||
            getQuickSearchIndex((p.nickname || '').toLowerCase()).includes(q)
        )
        .map((p) => p.id)
    );
  }, [search, people]);

  // 用屏幕 CTM 反解，坐标系固定，拖动不再跳变
  const getSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = ctm.inverse();
    return { x: clientX * inv.a + clientY * inv.c + inv.e, y: clientX * inv.b + clientY * inv.d + inv.f };
  };

  const hitNode = (pt: { x: number; y: number }): string | null => {
    const pos = posRef.current;
    let best: string | null = null, bestD = HIT_R;
    for (const id in pos) {
      const d = Math.hypot(pos[id].x - pt.x, pos[id].y - pt.y);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  };

  const onNodeDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (!posRef.current[id]) return;
    const pt = getSvgPoint(e.clientX, e.clientY);
    svgRef.current?.setPointerCapture(e.pointerId);
    // 中键（任意模式）或移动模式：拖动节点；连线模式下左键用于连线
    if (e.button === 1 || tool === 'select') {
      if (e.button === 1) e.preventDefault(); // 抑制中键默认自动滚动
      dragRef.current = { id, ox: posRef.current[id].x - pt.x, oy: posRef.current[id].y - pt.y };
    } else {
      linkRef.current = { from: id, x: pt.x, y: pt.y };
    }
    setTick((t) => t + 1);
  };

  const onSvgMove = (e: React.PointerEvent) => {
    const pt = getSvgPoint(e.clientX, e.clientY);
    if (dragRef.current) {
      const d = dragRef.current;
      posRef.current[d.id] = { x: pt.x + d.ox, y: pt.y + d.oy };
      velRef.current[d.id] = { x: 0, y: 0, vx: 0, vy: 0 };
      setTick((t) => t + 1);
    } else if (linkRef.current) {
      linkRef.current = { ...linkRef.current, x: pt.x, y: pt.y };
      setTick((t) => t + 1);
    }
  };

  const saveLayout = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(posRef.current)); } catch { /* ignore */ }
  };

  const onSvgUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      dragRef.current = null;
      saveLayout();
      return;
    }
    if (linkRef.current) {
      const pt = getSvgPoint(e.clientX, e.clientY);
      const target = hitNode(pt);
      if (target && target !== linkRef.current.from) connect(linkRef.current.from, target, tool as RelKey);
      linkRef.current = null;
      setTick((t) => t + 1);
    }
  };

  const onSvgDownBg = () => { if (linkRef.current) { linkRef.current = null; setTick((t) => t + 1); } };

  const connect = async (aId: string, bId: string, type: RelKey) => {
    if (aId === bId) return;
    const exists = edges.some((e) =>
      e.type === type &&
      (e.directed ? e.source === aId && e.target === bId : (e.source === aId && e.target === bId) || (e.source === bId && e.target === aId))
    );
    if (exists) { setMsg({ text: '该关系已存在', ok: false }); setTimeout(() => setMsg(null), 2200); return; }
    try {
      const def = REL_TYPES.find((t) => t.key === type)!;
      const rows: any[] = def.reciprocal
        ? [{ source_id: aId, target_id: bId, rel_type: type }, { source_id: bId, target_id: aId, rel_type: type }]
        : [{ source_id: aId, target_id: bId, rel_type: type }];
      const { error } = await supabase.from('people_relations').insert(rows);
      if (error) throw error;
      const key = def.reciprocal ? `${[aId, bId].sort().join('|')}::${type}` : `${aId}|${bId}::crush`;
      setEdges((prev) => [...prev, { key, source: aId, target: bId, type, directed: !def.reciprocal }]);
      setMsg({ text: `✅ 已添加「${def.label}」关系`, ok: true });
    } catch (e: any) {
      setMsg({ text: '❌ ' + (e?.message || e), ok: false });
    }
    setTimeout(() => setMsg(null), 2200);
  };

  const disconnect = async (edge: GEdge) => {
    const label = REL_TYPES.find((t) => t.key === edge.type)?.label || '该';
    if (!confirm(`删除 ${nameById(edge.source)} ↔ ${nameById(edge.target)} 的「${label}」关系？`)) return;
    try {
      if (edge.directed) {
        await supabase.from('people_relations').delete().eq('source_id', edge.source).eq('target_id', edge.target).eq('rel_type', edge.type);
      } else {
        await supabase.from('people_relations').delete().eq('rel_type', edge.type)
          .or(`and(source_id.eq.${edge.source},target_id.eq.${edge.target}),and(source_id.eq.${edge.target},target_id.eq.${edge.source})`);
      }
      setEdges((prev) => prev.filter((e) => e.key !== edge.key));
      setMsg({ text: '🗑 已删除关系', ok: true });
    } catch (e: any) {
      setMsg({ text: '❌ ' + (e?.message || e), ok: false });
    }
    setTimeout(() => setMsg(null), 2200);
  };

  const resetLayout = () => {
    const base = seedPositions(people);
    const pos: Record<string, { x: number; y: number }> = {};
    const vel: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
    people.forEach((p) => { pos[p.id] = base[p.id]; vel[p.id] = { x: 0, y: 0, vx: 0, vy: 0 }; });
    posRef.current = pos; velRef.current = vel;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setTick((t) => t + 1);
  };

  if (loading) return <p style={{ color: C.textDim, fontSize: 13 }}>加载中…</p>;

  const pos = posRef.current;
  const link = linkRef.current;

  return (
    <div>
      {/* 工具栏 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setTool('select')} style={toolBtn(tool === 'select', C.text)}>🖐 移动</button>
          <span style={{ color: C.textDim, fontSize: 13, margin: '0 4px' }}>连线：</span>
          {REL_TYPES.map((rt) => (
            <button key={rt.key} onClick={() => setTool(rt.key)} style={toolBtn(tool === rt.key, rt.color)}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 10, background: rt.color, marginRight: 5, verticalAlign: 'middle' }} />
              {rt.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 搜名字/外号（支持拼音）"
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #27273d', background: '#121224', color: C.text, fontSize: 13, outline: 'none', width: 220 }} />
        <button onClick={() => setLabels((v) => !v)} style={toolBtn(labels, C.accent)}>{labels ? '隐藏名字' : '显示名字'}</button>
        <button onClick={resetLayout} style={toolBtn(false, C.textDim)}>↺ 重置布局</button>
      </div>

      {msg && <p style={{ fontSize: 13, color: msg.ok ? '#4ade80' : '#f87171', margin: '0 0 10px' }}>{msg.text}</p>}

      <div style={{ fontSize: 13, color: C.textDim, marginBottom: 12, lineHeight: 1.6 }}>
        {tool === 'select'
          ? '当前：移动模式 —— 拖动圆点调整位置（自动保存），球之间会互相排斥、连线像弹簧。点击连线可删除关系。'
          : `当前：连线模式（${REL_TYPES.find((t) => t.key === tool)?.label}）—— 左键在一个圆点上按下，拖到另一个圆点松手即可建立关系${REL_TYPES.find((t) => t.key === tool)?.reciprocal ? '（双向）' : '（单向）'}；中键拖拽可临时移动节点。`}
      </div>

      <div style={{ border: '1px solid ' + C.border, borderRadius: 12, background: '#0b0b18', overflow: 'hidden' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height="auto"
          style={{ display: 'block', touchAction: 'none', cursor: tool === 'select' ? 'grab' : 'crosshair' }}
          onPointerMove={onSvgMove}
          onPointerUp={onSvgUp}
          onPointerDown={onSvgDownBg}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#fb923c" />
            </marker>
          </defs>

          {/* 关系连线：选了某关系类型时只显示该类型；移动模式显示全部 */}
          {edges.map((e) => {
            if (tool !== 'select' && e.type !== tool) return null;
            const a = pos[e.source], b = pos[e.target];
            if (!a || !b) return null;
            // 有向线（单相思）缩短到节点边缘，否则箭头会被目标圆盖住看不见
            let ax = a.x, ay = a.y, bx = b.x, by = b.y;
            if (e.directed) {
              const dx = b.x - a.x, dy = b.y - a.y;
              const d = Math.hypot(dx, dy) || 1;
              const ux = dx / d, uy = dy / d;
              ax = a.x + ux * NODE_R; ay = a.y + uy * NODE_R;
              bx = b.x - ux * (NODE_R + 3); by = b.y - uy * (NODE_R + 3);
            }
            const dim = matched ? !(matched.has(e.source) && matched.has(e.target)) : false;
            const color = REL_COLOR[e.type];
            return (
              <g key={e.key} opacity={dim ? 0.12 : 1}>
                <line x1={ax} y1={ay} x2={bx} y2={by} stroke="transparent" strokeWidth={16}
                  style={{ cursor: 'pointer' }} onClick={() => disconnect(e)}>
                  <title>点击删除这条「{REL_TYPES.find((t) => t.key === e.type)?.label}」关系</title>
                </line>
                <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={e.directed ? 2 : 2.4}
                  strokeDasharray={e.directed ? '6 4' : undefined} markerEnd={e.directed ? 'url(#arrow)' : undefined} pointerEvents="none" />
              </g>
            );
          })}

          {/* 连线中的橡皮筋 */}
          {link && pos[link.from] && (
            <line x1={pos[link.from].x} y1={pos[link.from].y} x2={link.x} y2={link.y}
              stroke={REL_COLOR[tool as RelKey]} strokeWidth={2} strokeDasharray="5 4" pointerEvents="none" />
          )}

          {/* 节点 */}
          {people.map((p) => {
            const pp = pos[p.id];
            if (!pp) return null;
            const dim = matched ? !matched.has(p.id) : false;
            const isHover = hover === p.id;
            const isDrag = dragRef.current?.id === p.id;
            return (
              <g key={p.id} opacity={dim ? 0.18 : 1}
                onPointerDown={(e) => onNodeDown(e, p.id)}
                onPointerEnter={() => setHover(p.id)} onPointerLeave={() => setHover(null)}
                style={{ cursor: tool === 'select' ? 'grab' : 'crosshair' }}>
                {isHover && <circle cx={pp.x} cy={pp.y} r={NODE_R + 5} fill="none" stroke="#fff" strokeWidth={1.5} opacity={0.6} pointerEvents="none" />}
                <circle cx={pp.x} cy={pp.y} r={NODE_R} fill={NODE_COLOR} stroke={isDrag ? '#fff' : '#0b0b18'} strokeWidth={isDrag ? 3 : 2} />
                {labels && (
                  <text x={pp.x} y={pp.y + NODE_R + 17} textAnchor="middle" fontSize={13} fill={C.text}
                    stroke="#0b0b18" strokeWidth={3} paintOrder="stroke"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {p.name}
                  </text>
                )}
                <title>{p.name}{p.nickname ? `（${p.nickname}）` : ''}</title>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 图例 */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '10px 18px', marginTop: 14, padding: '12px 14px',
        fontSize: 13, color: C.textSec, background: '#0f0f1c', border: '1px solid ' + C.border, borderRadius: 10,
        lineHeight: 1.5,
      }}>
        <span style={{ color: C.textDim, whiteSpace: 'normal' }}>圆点 = 人物；力导向：互相排斥 + 连线弹簧 + 微扰常驻</span>
        <span style={{ color: C.textDim }}>连线颜色：</span>
        {REL_TYPES.map((rt) => (
          <span key={rt.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ width: 18, height: 4, background: rt.color, borderRadius: 2 }} />{rt.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function toolBtn(active: boolean, color: string): React.CSSProperties {
  return {
    padding: '7px 13px', borderRadius: 8, border: '1px solid ' + (active ? color : '#27273d'),
    background: active ? color + '22' : 'transparent', color: active ? color : C.textDim,
    cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
  };
}