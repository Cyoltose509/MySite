'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { isAuthenticated, getPrivateSession } from '@/lib/auth';
import { usePrivateAccess, unlockPrivate } from '@/lib/private';
import { C } from '@/lib/card-styles';

/* ── 数据模型（与 finance-tracker/import.py 的归一化字段一致） ── */
interface FinTx {
  id: string;
  tx_date: string;
  tx_at?: string;
  source: 'wechat' | 'bank';
  account: string;
  direction: 'in' | 'out';
  amount: number;
  delta: number;
  funding?: string;
  balance?: number | null;
}

const SCALES = [
  { value: 'daily', label: '日' },
  { value: 'weekly', label: '周' },
  { value: 'monthly', label: '月' },
  { value: 'yearly', label: '年' },
] as const;
type Scale = (typeof SCALES)[number]['value'];

// 三条曲线：总 / 微信（零钱+零钱通）/ 银行卡（各 bank_* 账户合计）
const SERIES = [
  { key: 'total', label: '总资产', color: C.accent, f: () => true },
  { key: 'wechat', label: '微信', color: C.purple, f: (r: FinTx) => r.account === 'wechat_wallet' },
  { key: 'bank', label: '银行卡', color: C.green, f: (r: FinTx) => r.account.startsWith('bank_') },
] as const;

/* ── 图表常量 ── */
const W = 760;
const H = 320;
const PAD_L = 56;
const PAD_R = 20;
const PAD_T = 20;
const PAD_B = 38;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const PT_SPACING = 14; // 横向滚动视窗：相邻数据点最小像素间距，点多时图表变宽出现滚动

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

/** 把 'YYYY-MM-DD' 对齐到所选时间尺度的周期起点（本地时区） */
function alignTs(dateStr: string, scale: Scale): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  switch (scale) {
    case 'daily': dt.setHours(0, 0, 0, 0); break;
    case 'weekly': { dt.setHours(0, 0, 0, 0); dt.setDate(dt.getDate() - dt.getDay()); break; }
    case 'monthly': { dt.setDate(1); dt.setHours(0, 0, 0, 0); break; }
    case 'yearly': { dt.setMonth(0, 1); dt.setHours(0, 0, 0, 0); break; }
  }
  return dt.getTime();
}

function fmtLabel(ts: number, scale: Scale): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (scale) {
    case 'daily': return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
    case 'weekly': return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
    case 'monthly': return `${d.getFullYear()}/${pad(d.getMonth() + 1)}`;
    case 'yearly': return `${d.getFullYear()}`;
  }
}

const fmtVal = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);
const fmtTick = (v: number) => {
  const a = Math.abs(v);
  return a >= 10000 ? (v / 10000).toFixed(1) + '万' : String(Math.round(v));
};

export default function FinancePage() {
  const { unlocked, refreshKey } = usePrivateAccess();
  const [rows, setRows] = useState<FinTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState<Scale>('monthly');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // 锁定态 UI
  const [pw, setPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');

  // 期初资产（元）：微信钱包 / 银行卡 / 其他（现金、理财等），总=三者之和。
  // 填了曲线即变为绝对资产；留空=相对首笔记录的累计变动。存 Supabase（密码校验 RPC）。
  const [baseline, setBaseline] = useState<{ wechat: number; bank: number; other: number }>({ wechat: 0, bank: 0, other: 0 });
  const [baseLoaded, setBaseLoaded] = useState(false);
  const baseRef = useRef(baseline);
  baseRef.current = baseline;
  const saveTimer = useRef<number | null>(null);

  // 保存到数据库（需已解锁 + 已从库加载过，避免初始覆盖）
  const persistBaseline = useCallback(() => {
    const hash = getPrivateSession();
    if (!hash || !baseLoaded) return;
    const b = baseRef.current;
    supabase.rpc('fn_save_finance_baseline', {
      p_hash: hash,
      p_items: [
        { key: 'wechat', amount: b.wechat },
        { key: 'bank', amount: b.bank },
        { key: 'other', amount: b.other },
      ],
    }).then(({ error }) => { if (error) console.warn('[finance] 期初资产保存失败', error); });
  }, [baseLoaded]);

  // 输入后 700ms 防抖自动保存
  useEffect(() => {
    if (!baseLoaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(persistBaseline, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [baseline, baseLoaded, persistBaseline]);

  const flushBaseline = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    persistBaseline();
  };

  const totalBase = baseline.wechat + baseline.bank + baseline.other;
  const SERIES_BASE: Record<string, number> = { total: totalBase, wechat: baseline.wechat, bank: baseline.bank };

  // ── 横向滚动视窗（/events 同款：整条时间线铺开，滚轮/触控板平移，默认停最右） ──
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(W);
  const [scrollLeft, setScrollLeft] = useState(0);

  // 容器宽度自适应（图表渲染后才有效，故随解锁/数据变化重新挂接）
  useEffect(() => {
    const r = () => { if (containerRef.current) setChartW(Math.max(400, containerRef.current.clientWidth - 4)); };
    r(); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r);
  }, [unlocked, rows.length]);

  // 尺度/数据变化后滚到最右（最新）
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [scale, rows.length, unlocked]);

  // 鼠标滚轮 → 横向平移（纯 overflow 容器默认不吃纵向滚轮；滚动容器渲染后挂接）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [unlocked, rows.length]);

  useEffect(() => {
    if (!unlocked) { setLoading(false); return; }
    const hash = getPrivateSession();
    if (!hash) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc('fn_get_finance_admin', { p_hash: hash });
      if (!error && Array.isArray(data)) {
        setRows((data as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          tx_date: r.tx_date as string,
          tx_at: r.tx_at as string,
          source: r.source as FinTx['source'],
          account: r.account as string,
          direction: r.direction as FinTx['direction'],
          amount: Number(r.amount),
          delta: Number(r.delta),
          funding: r.funding as string | undefined,
          balance: r.balance != null ? Number(r.balance) : null,
        })).sort((a, b) => (a.tx_at || a.tx_date).localeCompare(b.tx_at || b.tx_date)));
      }
      // 期初资产（数据库，密码校验）
      const b = await supabase.rpc('fn_get_finance_baseline_admin', { p_hash: hash });
      if (!b.error && Array.isArray(b.data)) {
        const m: Record<string, number> = {};
        (b.data as Array<Record<string, unknown>>).forEach((r) => {
          if (r.key && typeof r.amount === 'number') m[r.key as string] = r.amount;
        });
        setBaseline({
          wechat: m.wechat || 0,
          bank: m.bank || 0,
          other: m.other || 0,
        });
      }
      setBaseLoaded(true);
      setLoading(false);
    })();
  }, [unlocked, refreshKey]);

  const onUnlock = async () => {
    const ok = await unlockPrivate(pw);
    if (!ok) setPwMsg('密码错误或已被临时锁定');
    else { setPw(''); setPwMsg(''); }
  };

  // 三条曲线的累计净变动（相对首笔记录）
  const chart = useMemo(() => {
    if (!rows.length) return null;
    const maps = SERIES.map((s) => {
      const per = new Map<number, number>();
      for (const r of rows) {
        if (!s.f(r)) continue;
        const k = alignTs(r.tx_date, scale);
        per.set(k, (per.get(k) || 0) + (r.delta || 0));
      }
      return per;
    });
    const keys = new Set<number>();
    maps.forEach((m) => m.forEach((_, k) => keys.add(k)));
    const union = Array.from(keys).sort((a, b) => a - b);

    const series = SERIES.map((s, si) => {
      let cum = 0;
      const base = SERIES_BASE[s.key] || 0;
      const vals = union.map((k) => { cum += maps[si].get(k) || 0; return base + cum; });
      return { key: s.key, label: s.label, color: s.color, vals };
    });
    let yMin = Infinity, yMax = -Infinity;
    series.forEach((s) => s.vals.forEach((v) => { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }));
    if (!isFinite(yMin)) { yMin = -1; yMax = 1; }
    const pad = (yMax - yMin) * 0.08 || 1;
    yMin -= pad; yMax += pad;
    return { union, series, yMin, yMax };
  }, [rows, scale, totalBase, baseline]);

  if (loading) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid ' + C.border, borderTopColor: C.accent, animation: 'spin 0.8s linear infinite' }} />
        <p style={{ fontSize: 14, color: C.textSec, margin: 0 }}>加载中...</p>
      </div>
    );
  }

  /* ── 未解锁：密码门 ── */
  if (!unlocked) {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          <Link href="/" style={backLinkStyle}>← 首页</Link>
          <h1 style={h1Style}>💰 资产变动</h1>
        </header>
        <div style={{
          maxWidth: 420, margin: '12vh auto 0', padding: 32, borderRadius: 20, textAlign: 'center',
          background: C.surface, border: '1px solid ' + C.borderLit,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>资产数据已加密</div>
          <div style={{ fontSize: 12, color: C.textSec, marginBottom: 20, lineHeight: 1.6 }}>
            这是私密页面，输入解锁密码后可见（与心情/事件同一套密码，控制台 unlockPrivate 等价）
          </div>
          <input
            type="password" value={pw} onChange={(e) => { setPw(e.target.value); setPwMsg(''); }}
            onKeyDown={(e) => e.key === 'Enter' && onUnlock()}
            placeholder="解锁密码"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10,
              border: '1px solid ' + C.borderLit, background: C.card, color: C.text,
              fontSize: 14, outline: 'none', marginBottom: 12, textAlign: 'center',
            }}
          />
          <button onClick={onUnlock} style={{
            width: '100%', padding: '10px', borderRadius: 10, border: 'none',
            background: C.accent, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>解锁</button>
          {pwMsg && <div style={{ fontSize: 12, color: C.red, marginTop: 12 }}>{pwMsg}</div>}
        </div>
      </div>
    );
  }

  const latest = chart ? SERIES.map((s, i) => ({ label: s.label, color: s.color, v: chart.series[i].vals[chart.series[i].vals.length - 1] || 0 })) : [];
  const hasBase = totalBase > 0;

  /* ── 图表几何（横向滚动视窗） ── */
  const nPts = chart?.union.length || 0;
  const plotW = chart ? Math.max(chartW - PAD_L - PAD_R, Math.max(1, nPts - 1) * PT_SPACING) : chartW - PAD_L - PAD_R;
  const xAt = (i: number) => PAD_L + (nPts <= 1 ? 0 : (i / Math.max(1, nPts - 1)) * plotW);
  const yAt = (v: number) => chart ? PAD_T + PLOT_H - ((v - chart.yMin) / (chart.yMax - chart.yMin)) * PLOT_H : PAD_T;

  const paths = chart ? chart.series.map((s, si) => {
    const pts = s.vals.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
    return { key: s.key, color: s.color, d: smoothPath(pts) };
  }) : [];

  const zeroY = chart ? yAt(0) : PAD_T + PLOT_H;
  const xTickStep = chart ? Math.max(1, Math.ceil(chart.union.length / 12)) : 1;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chart || chart.union.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;   // svg 内容坐标（rect.left 已含滚动偏移，相减即内容 x）
    const frac = (x - PAD_L) / plotW;
    const idx = Math.max(0, Math.min(chart.union.length - 1, Math.round(frac * (chart.union.length - 1))));
    setHoverIdx(idx);
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={backLinkStyle}>← 首页</Link>
        <h1 style={h1Style}>💰 资产变动</h1>
        <span style={{ padding: '4px 14px', borderRadius: 20, background: C.card, border: '1px solid ' + C.borderLit, fontSize: 13, color: C.accentLt }}>
          {rows.length} 笔
        </span>
        {isAuthenticated() && (<Link href="/admin" style={{ padding: '6px 14px', borderRadius: 10, border: '1px solid ' + C.borderLit, color: C.accentLt, fontSize: 12, textDecoration: 'none' }}>管理 →</Link>)}
      </header>

      {/* 期初资产填写（私密页内才可见；填了曲线变绝对资产） */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: '12px 16px', borderRadius: 14, background: C.surface, border: '1px solid ' + C.border, marginBottom: 18 }}>
        {([
          { key: 'wechat', label: '微信钱包', color: C.purple },
          { key: 'bank', label: '银行卡', color: C.green },
          { key: 'other', label: '其他(现金/理财)', color: C.gray },
        ] as const).map((b) => (
          <div key={b.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: C.textSec }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 4, background: b.color, marginRight: 5, verticalAlign: 'middle' }} />
              期初 {b.label}（元）
            </label>
            <input
              type="number" inputMode="decimal" placeholder="0"
              value={baseline[b.key] || ''}
              onChange={(e) => setBaseline({ ...baseline, [b.key]: Number(e.target.value) || 0 })}
              onBlur={flushBaseline}
              style={{
                width: 130, padding: '7px 10px', borderRadius: 10, boxSizing: 'border-box',
                border: '1px solid ' + C.borderLit, background: C.card, color: C.text,
                fontSize: 13, outline: 'none',
              }}
            />
          </div>
        ))}
        <div style={{ fontSize: 11, color: C.textDead, flex: 1, minWidth: 200, lineHeight: 1.7, paddingBottom: 2 }}>
          填三项期初余额 → 曲线即变为<b style={{ color: C.textSec }}>绝对资产</b>（总 = 微信+银行卡+其他）。留空则显示相对首笔记录的累计变动。<b style={{ color: C.textSec }}>自动保存到数据库</b>（本页解锁状态下生效，任何设备登录可见）。
        </div>
      </div>

      {/* 当前资产 / 累计变动（末值） */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        {latest.map((l) => (
          <div key={l.label} style={{ padding: '14px 16px', borderRadius: 14, background: C.surface, border: '1px solid ' + C.border }}>
            <div style={{ fontSize: 12, color: C.textSec, marginBottom: 6 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: l.color, marginRight: 6, verticalAlign: 'middle' }} />
              {l.label} {hasBase ? '当前资产' : '累计变动'}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: l.v >= 0 ? C.green : C.red }}>
              {fmtVal(l.v)} 元
            </div>
          </div>
        ))}
      </div>

      {/* 时间尺度 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {SCALES.map((s) => (
          <button key={s.value} onClick={() => setScale(s.value)} style={{
            padding: '5px 14px', borderRadius: 14, fontSize: 12, outline: 'none',
            border: `1px solid ${scale === s.value ? C.accent : C.border}`,
            background: scale === s.value ? C.accent + '22' : 'transparent',
            color: scale === s.value ? C.accentLt : C.textSec, cursor: 'pointer',
          }}>{s.label}</button>
        ))}
        <span style={{ fontSize: 11, color: C.textDead, marginLeft: 'auto' }}>{chart?.union.length || 0} 个数据点</span>
      </div>

      {chart && chart.union.length > 1 ? (
        <div ref={containerRef} style={{ position: 'relative', borderRadius: 16, border: '1px solid ' + C.border, background: C.surface, marginBottom: 10 }}>
          {/* 图例 */}
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', fontSize: 11, color: C.textSec, padding: '12px 16px 0', flexWrap: 'wrap' }}>
            {SERIES.map((s) => (
              <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 18, height: 3, background: s.color, borderRadius: 2, display: 'inline-block' }} /> {s.label}
              </span>
            ))}
            <span style={{ marginLeft: 'auto', color: C.textDead }}>滚轮/触控板横向平移 · 默认停最新</span>
          </div>

          {/* 滚动视窗：整条时间线铺开，滚轮/触控板平移 */}
          <div
            ref={scrollRef}
            onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
            style={{ overflowX: 'auto', overflowY: 'hidden', width: '100%' }}
          >
            <svg
              width={plotW + PAD_L + PAD_R} height={H}
              style={{ display: 'block', fontFamily: 'sans-serif', minWidth: '100%', cursor: 'crosshair' }}
              onMouseMove={onMove}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* Y 网格 */}
              {(() => {
                if (!chart) return null;
                const span = chart.yMax - chart.yMin;
                const step = Math.max(1, Math.pow(10, Math.floor(Math.log10(span / 4)))) || 1;
                const start = Math.ceil(chart.yMin / step) * step;
                const ticks = [];
                for (let v = start; v <= chart.yMax; v += step) ticks.push(v);
                return ticks.map((v) => {
                  const y = yAt(v);
                  return (
                    <g key={v}>
                      <line x1={PAD_L} y1={y} x2={PAD_L + plotW} y2={y} stroke={C.border} strokeWidth={1} strokeDasharray="3 4" opacity={0.3} />
                      <text x={PAD_L - 8} y={y + 3} textAnchor="end" fontSize={10} fill={C.textDead}>{fmtTick(v)}</text>
                    </g>
                  );
                });
              })()}

              {/* 零基线 */}
              {chart && zeroY > PAD_T && zeroY < PAD_T + PLOT_H && (
                <line x1={PAD_L} y1={zeroY} x2={PAD_L + plotW} y2={zeroY} stroke={C.textDim} strokeWidth={1} opacity={0.8} />
              )}

              {/* 曲线 */}
              {paths.map((p) => (
                <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
              ))}

              {/* 悬停引导线 */}
              {hoverIdx != null && chart && (
                <line x1={xAt(hoverIdx)} y1={PAD_T} x2={xAt(hoverIdx)} y2={PAD_T + PLOT_H} stroke={C.textSec} strokeWidth={1} opacity={0.5} />
              )}

              {/* X 轴标签 */}
              {chart && chart.union.map((ts, i) =>
                i % xTickStep === 0 ? (
                  <text key={ts} x={xAt(i)} y={H - 10} textAnchor="middle" fontSize={10} fill={C.textDead}>{fmtLabel(ts, scale)}</text>
                ) : null
              )}
            </svg>
          </div>

          {/* Tooltip（滚动容器外，用 scrollLeft 对齐可视区） */}
          {hoverIdx != null && chart.union[hoverIdx] != null && (
            <div style={{
              position: 'absolute', left: Math.max(8, xAt(hoverIdx) - scrollLeft + 12), top: 8, zIndex: 20,
              padding: '10px 14px', borderRadius: 10, background: C.card, border: '1px solid ' + C.borderLit,
              boxShadow: '0 4px 16px rgba(0,0,0,.6)', minWidth: 160, maxWidth: 240, pointerEvents: 'none',
            }}>
              <div style={{ fontSize: 11, color: C.textSec, marginBottom: 6 }}>{fmtLabel(chart.union[hoverIdx], scale)}</div>
              {chart.series.map((s) => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.text, lineHeight: 1.7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: s.color, display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ color: C.textSec, fontSize: 12 }}>{s.label}</span>
                  <span style={{ fontWeight: 700, marginLeft: 'auto', color: s.vals[hoverIdx] >= 0 ? C.green : C.red }}>
                    {fmtVal(s.vals[hoverIdx])} 元
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p style={{ textAlign: 'center', color: C.textDead, fontSize: 13, padding: 48 }}>
          {rows.length ? '数据点太少，至少需要 2 个时间周期' : '暂无数据 —— 把账单放进 finance-tracker/ 后运行 python import.py'}
        </p>
      )}

      <p style={{ fontSize: 11, color: C.textDead, lineHeight: 1.7, marginTop: 12 }}>
        口径：总资产 = 微信钱包 + 银行卡（及其他期初项）。账户间转账（零钱通↔银行卡、提现/充值）<b style={{ color: C.textSec }}>两边都计入各自账户</b>——微信曲线反映钱包真实进出，银行卡曲线反映卡的真实入账（如"零钱通转出到卡"卡就多了）；转账在总资产里相互抵消，只差少量提现手续费。用银行卡支付的支出归属该卡账单，避免重复扣。零钱↔零钱通为钱包内部互转，净 0。曲线为"期初资产 + 累计变动"，期初留空即相对首笔记录。
      </p>
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: '100vh', maxWidth: 1000, margin: '0 auto', padding: '28px 20px 40px' };
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 };
const backLinkStyle: React.CSSProperties = { fontSize: 13, color: C.textDim, textDecoration: 'none' };
const h1Style: React.CSSProperties = { fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, flex: 1 };
