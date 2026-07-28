'use client';

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getPrivateSession } from '@/lib/auth';
import { usePrivateAccess } from '@/lib/private';
import { withBasePath } from '@/lib/base-path';
import { effectivePlace, effectiveCoord, LOCATION_TAGS, TAG_META, tagMeta, type LocationTag } from '@/lib/location-place';

interface Stay {
  id: string;
  started_at: string;
  ended_at: string | null;
  country: string | null;
  province: string | null;
  city: string | null;
  tag: string;
  note: string | null;
}
interface CityAgg {
  place: string;
  hours: number;
  count: number;
  coord: [number, number] | null;
  topTag: string;
}

const W = 1000;
const H = 760;
const PAD = 24;
const CHINA_TZ = 'Asia/Shanghai';

// 固定用北京时间显示，避免 SSR 与客户端时区不一致导致 hydration mismatch
const dateFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: CHINA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const mercX = (lng: number) => (lng * Math.PI) / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));

const fmtDur = (h: number) => {
  const d = h / 24;
  if (d >= 1) return `${d.toFixed(1)} 天`;
  return `${Math.round(h)} 小时`;
};
const fmtDate = (s: string) => dateFmt.format(new Date(s));
const fmtRange = (s: string, e: string | null) => {
  if (!e) return `${fmtDate(s)} → 至今`;
  const ds = fmtDate(s), de = fmtDate(e);
  return ds === de ? ds : `${ds} → ${de}`;
};

const HEAT_STOPS: [number, [number, number, number]][] = [
  [0.0, [30, 58, 138]],   // deep blue
  [0.35, [99, 102, 241]], // indigo
  [0.6, [168, 85, 247]],  // purple
  [0.8, [245, 158, 11]],  // amber
  [1.0, [239, 68, 68]],   // red
];
function heatColor(t: number): string {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    if (t <= HEAT_STOPS[i][0]) {
      const [t0, c0] = HEAT_STOPS[i - 1];
      const [t1, c1] = HEAT_STOPS[i];
      const k = (t - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * k);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * k);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * k);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(239,68,68)';
}

export default function LocationPage() {
  const { unlocked, refreshKey } = usePrivateAccess();
  const [stays, setStays] = useState<Stay[]>([]);
  const [geo, setGeo] = useState<any>(null);
  const [geoErr, setGeoErr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<CityAgg | null>(null);
  const [selected, setSelected] = useState<CityAgg | null>(null);
  const [tagFilter, setTagFilter] = useState<string>('全部');
  // 公开标签分布（匿名即可拉取，不含具体城市）
  const [tagSummary, setTagSummary] = useState<{ tag: string; stay_count: number; total_hours: number }[]>([]);
  // 公开标签时段（用于时间线）
  const [tagStays, setTagStays] = useState<{ tag: string; started_at: string; ended_at: string | null }[]>([]);
  // 客户端 mount 后再用真实当前时间，避免 SSR 与客户端时间不一致导致 hydration mismatch
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, []);
  // 私密解锁状态在客户端初始可能读 localStorage 为 true，而 SSR 为 false；
  // 加一个 mounted 门，保证首次 hydrate 与 SSR 渲染一致，mount 后再按真实状态显示。
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const loadStays = async () => {
    setLoading(true);
    const hash = getPrivateSession();
    if (hash) {
      const { data, error } = await supabase.rpc('fn_get_location_stays', { p_hash: hash });
      if (!error && data && !data.error) {
        setStays(data as Stay[]);
        setLoading(false);
        return;
      }
    }
    setStays([]);
    setLoading(false);
  };

  useEffect(() => {
    if (unlocked) loadStays();
  }, [unlocked, refreshKey]);

  // 公开标签数据：始终拉取（无需解锁），不含具体城市
  useEffect(() => {
    const run = async () => {
      const [{ data: sum }, { data: stays }] = await Promise.all([
        supabase.rpc('fn_get_location_tag_summary'),
        supabase.rpc('fn_get_location_tag_stays'),
      ]);
      if (sum) setTagSummary(sum as { tag: string; stay_count: number; total_hours: number }[]);
      if (stays) setTagStays(stays as { tag: string; started_at: string; ended_at: string | null }[]);
    };
    run();
  }, []);

  // 加载中国地图 GeoJSON（本站静态资源）
  useEffect(() => {
    let alive = true;
    fetch(withBasePath('/china-geo.json'))
      .then(r => r.json())
      .then(d => { if (alive) setGeo(d); })
      .catch(() => { if (alive) setGeoErr(true); });
    return () => { alive = false; };
  }, []);

  // 按标签过滤（全部 / 家 / 学校 / 旅游 / 其他）
  const filteredStays = useMemo(
    () => (tagFilter === '全部' ? stays : stays.filter(s => s.tag === tagFilter)),
    [stays, tagFilter]
  );

  // 按对外展示名（国家/省/市）聚合停留时长，并记录各标签时长以取主标签
  const agg = useMemo(() => {
    const map = new Map<string, CityAgg & { tagHours: Record<string, number> }>();
    const refNow = now || 0;
    for (const s of filteredStays) {
      const start = new Date(s.started_at).getTime();
      const end = s.ended_at ? new Date(s.ended_at).getTime() : (refNow || start);
      const h = Math.max(0, (end - start) / 3600000);
      const place = effectivePlace(s);
      const tag = s.tag || '其他';
      const cur = map.get(place) || { place, hours: 0, count: 0, coord: effectiveCoord(s), tagHours: {}, topTag: '其他' };
      cur.hours += h;
      cur.count += 1;
      cur.tagHours[tag] = (cur.tagHours[tag] || 0) + h;
      map.set(place, cur);
    }
    const arr = Array.from(map.values()).map(({ tagHours, ...rest }) => {
      let topTag = '其他', best = -1;
      for (const [t, v] of Object.entries(tagHours)) {
        if (v > best) { best = v; topTag = t; }
      }
      return { ...rest, topTag };
    });
    return arr.sort((a, b) => b.hours - a.hours);
  }, [filteredStays]);

  // 投影：mercator，居中适配 viewBox
  const project = useMemo(() => {
    if (!geo) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const visit = (ring: number[][]) => {
      for (const [x, y] of ring) {
        const mx = mercX(x), my = mercY(y);
        if (mx < minX) minX = mx; if (mx > maxX) maxX = mx;
        if (my < minY) minY = my; if (my > maxY) maxY = my;
      }
    };
    for (const f of geo.features) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === 'Polygon') g.coordinates.forEach(visit);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly: number[][][]) => poly.forEach(visit));
    }
    // 若有中国以外的坐标（如国外国家），把投影范围扩大以容纳它们
    let bMinX = minX, bMaxX = maxX, bMinY = minY, bMaxY = maxY;
    for (const a of agg) {
      if (!a.coord) continue;
      const mx = mercX(a.coord[0]), my = mercY(a.coord[1]);
      if (mx < bMinX) bMinX = mx; if (mx > bMaxX) bMaxX = mx;
      if (my < bMinY) bMinY = my; if (my > bMaxY) bMaxY = my;
    }
    const s = Math.min((W - 2 * PAD) / (bMaxX - bMinX), (H - 2 * PAD) / (bMaxY - bMinY));
    const drawW = (bMaxX - bMinX) * s, drawH = (bMaxY - bMinY) * s;
    const padX = (W - drawW) / 2, padY = (H - drawH) / 2;
    return (lng: number, lat: number): [number, number] => {
      const mx = mercX(lng), my = mercY(lat);
      return [padX + (mx - bMinX) * s, padY + (bMaxY - my) * s];
    };
  }, [geo, agg]);

  const provincePaths = useMemo(() => {
    if (!geo || !project) return [] as string[];
    const ringPath = (ring: number[][]) =>
      ring.map(([x, y], i) => {
        const [px, py] = project(x, y);
        return (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1);
      }).join(' ') + ' Z';
    const out: string[] = [];
    for (const f of geo.features) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === 'Polygon') out.push(g.coordinates.map(ringPath).join(' '));
      else if (g.type === 'MultiPolygon') out.push(g.coordinates.flatMap((poly: number[][][]) => poly.map(ringPath)).join(' '));
    }
    return out;
  }, [geo, project]);


  const maxHours = agg.length ? agg[0].hours : 1;

  // 有坐标的城市气泡
  const bubbles = useMemo(() => {
    if (!project) return [] as { agg: CityAgg; x: number; y: number; color: string; r: number }[];
    return agg
      .map(a => {
        if (!a.coord) return null;
        const [x, y] = project(a.coord[0], a.coord[1]);
        const ratio = a.hours / maxHours;
        const t = Math.sqrt(ratio);
        return { agg: a, x, y, color: heatColor(t), r: 7 + 24 * t };
      })
      .filter(Boolean) as { agg: CityAgg; x: number; y: number; color: string; r: number }[];
  }, [agg, project, maxHours]);

  const active = hover || selected;
  const sortedTagStays = useMemo(() => {
    return [...tagStays].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  }, [tagStays]);

  // 时间分布条：每段彩色条，长度按停留时长比例（时间尺度）
  const timeline = useMemo(() => {
    if (!sortedTagStays.length) return null;
    const refNow = now || 0;
    const segs = sortedTagStays
      .map(s => {
        const start = new Date(s.started_at).getTime();
        const end = s.ended_at ? new Date(s.ended_at).getTime() : (refNow || start);
        const m = tagMeta(s.tag);
        const hours = Math.max(0, (end - start) / 3600000);
        // SSR 阶段 now=0，未结束段不显示动态时长，避免 mismatch；mount 后再补
        const dur = now || s.ended_at ? fmtDur(hours) : '';
        return { s, start, end, m, dur, isOpen: !s.ended_at };
      })
      .sort((a, b) => a.start - b.start);
    const minTs = Math.min(...segs.map(x => x.start));
    const maxTs = Math.max(...segs.map(x => x.end), minTs);
    const span = maxTs - minTs || 1;
    const bars = segs.map(x => ({
      ...x,
      leftPct: ((x.start - minTs) / span) * 100,
      widthPct: Math.max(0.4, ((x.end - x.start) / span) * 100),
    }));
    const mkTick = (ts: number) => ({ pct: ((ts - minTs) / span) * 100, label: fmtDate(new Date(ts).toISOString()) });
    const ticks = [mkTick(minTs), mkTick(minTs + span / 2), mkTick(maxTs)];
    return { bars, ticks };
  }, [sortedTagStays, now]);

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d1a', padding: '28px 20px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e4e4e7', margin: 0 }}>📍 位置分布</h1>
        </div>

        {/* 标签分布 */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
          {tagSummary.length > 0 ? tagSummary.map(t => {
            const m = tagMeta(t.tag);
            const d = Number(t.total_hours) / 24;
            const dur = d >= 1 ? `${d.toFixed(1)} 天` : `${Math.round(Number(t.total_hours))} 小时`;
            return (
              <div key={t.tag} style={{
                flex: '1 1 140px', minWidth: 140,
                background: '#16162a', border: '1px solid #2a2a40', borderRadius: 14, padding: '14px 16px',
              }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: m.color }}>
                  {m.icon} {t.tag}
                </div>
                <div style={{ fontSize: 13, color: '#e4e4e7', marginTop: 6 }}>
                  累计 {dur} ｜ {t.stay_count} 段
                </div>
              </div>
            );
          }) : (
            <div style={{ color: '#71717a', fontSize: 13, padding: '12px 0' }}>暂无标签数据</div>
          )}
        </div>

        {/* 时间分布条：每段彩色条，长度按停留时长比例 */}
        <div style={{ fontSize: 15, fontWeight: 600, color: '#e4e4e7', marginBottom: 12 }}>🗓️ 停留时间分布</div>
        <div style={{
          background: '#16162a', border: '1px solid #2a2a40', borderRadius: 16, padding: '16px 18px', marginBottom: 28,
        }}>
          {!timeline ? (
            <div style={{ color: '#71717a', fontSize: 13, padding: '12px 0' }}>暂无停留时间线</div>
          ) : (
            <>
              {/* 时间刻度 */}
              <div style={{ position: 'relative', height: 16, marginBottom: 6 }}>
                {timeline.ticks.map((t, i) => (
                  <div key={i} style={{
                    position: 'absolute', left: `${t.pct}%`, transform: 'translateX(-50%)',
                    fontSize: 10, color: '#71717a', whiteSpace: 'nowrap',
                  }}>{t.label}</div>
                ))}
              </div>
              {/* 主轨道 */}
              <div style={{ position: 'relative', height: 40, background: '#0d0d1a', borderRadius: 8, overflow: 'hidden' }}>
                {timeline.bars.map((b, i) => (
                  <div key={i}
                    title={`${b.m.icon} ${b.s.tag}｜${fmtRange(b.s.started_at, b.s.ended_at)}${b.dur ? '｜' + b.dur : ''}`}
                    style={{
                      position: 'absolute', left: `${b.leftPct}%`, width: `${b.widthPct}%`,
                      top: 3, bottom: 3, background: b.m.color, borderRadius: 5,
                      display: 'flex', alignItems: 'center', overflow: 'hidden',
                      boxShadow: b.isOpen ? 'inset 0 0 0 2px #ffffff' : undefined,
                    }}>
                    {b.widthPct > 9 && (
                      <span style={{ padding: '0 8px', fontSize: 11, fontWeight: 700, color: '#0d0d1a', whiteSpace: 'nowrap' }}>
                        {b.m.icon}{b.s.tag}{b.dur ? ' · ' + b.dur : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {/* 图例 */}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
                {LOCATION_TAGS.map(t => {
                  const m = TAG_META[t as LocationTag];
                  return (
                    <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#a1a1aa' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: m.color }} />
                      {m.icon} {t}
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* 城市地图 / 排行：仅解锁后可见，未解锁时不显示 */}
        {mounted && unlocked && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#e4e4e7', marginBottom: 12 }}>🏙️ 城市地图</div>
            {/* 标签过滤 */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {['全部', ...LOCATION_TAGS].map(t => {
              const active = tagFilter === t;
              const c = t === '全部' ? '#818cf8' : TAG_META[t as LocationTag].color;
              return (
                <button key={t} onClick={() => setTagFilter(t)} style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', fontWeight: 600,
                  background: active ? c : '#121224', color: active ? '#0d0d1a' : '#a1a1aa',
                  border: `1px solid ${active ? c : '#2a2a40'}`,
                }}>{t === '全部' ? '全部' : `${TAG_META[t as LocationTag].icon} ${t}`}</button>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20, alignItems: 'start' }}>
            {/* 地图 */}
            <div style={{ background: '#16162a', border: '1px solid #2a2a40', borderRadius: 16, padding: 12, position: 'relative' }}>
              {geoErr && <div style={{ padding: 40, textAlign: 'center', color: '#f87171', fontSize: 13 }}>地图资源加载失败</div>}
              {!geo && !geoErr && <div style={{ padding: 40, textAlign: 'center', color: '#71717a', fontSize: 13 }}>加载地图中…</div>}
              {geo && project && (
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                  {/* 省份 */}
                  {provincePaths.map((d, i) => (
                    <path key={i} d={d} fill="#15152b" stroke="#2a2a44" strokeWidth={0.6} />
                  ))}
                  {/* 城市气泡 */}
                  {bubbles.map(b => (
                    <g key={b.agg.place}
                      onMouseEnter={() => setHover(b.agg)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => setSelected(b.agg)}
                      style={{ cursor: 'pointer' }}>
                      <circle cx={b.x} cy={b.y} r={b.r}
                        fill={b.color} fillOpacity={0.78}
                        stroke={selected === b.agg ? '#fff' : '#0d0d1a'} strokeWidth={selected === b.agg ? 2 : 1} />
                    </g>
                  ))}
                </svg>
              )}

              {/* 信息框 */}
              {active && (
                <div style={{
                  position: 'absolute', top: 20, left: 20, background: 'rgba(13,13,26,0.92)',
                  border: '1px solid #2a2a40', borderRadius: 10, padding: '10px 14px', maxWidth: 240,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7' }}>
                    📍 {active.place}
                    <span style={{ marginLeft: 8, fontSize: 11, color: tagMeta(active.topTag).color }}>
                      {tagMeta(active.topTag).icon} {active.topTag}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#818cf8', marginTop: 2 }}>累计 {fmtDur(active.hours)} ｜ {active.count} 段</div>
                </div>
              )}

              {/* 图例 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '0 4px' }}>
                <span style={{ fontSize: 11, color: '#71717a' }}>短</span>
                <div style={{
                  flex: 1, height: 10, borderRadius: 5,
                  background: 'linear-gradient(90deg, rgb(30,58,138), rgb(99,102,241), rgb(168,85,247), rgb(245,158,11), rgb(239,68,68))',
                }} />
                <span style={{ fontSize: 11, color: '#71717a' }}>长（停留时长）</span>
              </div>
            </div>

            {/* 排行列表 */}
            <div style={{ background: '#16162a', border: '1px solid #2a2a40', borderRadius: 16, padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#d4d4d8', marginBottom: 12 }}>
                🏙️ 停留排行（{agg.length} 地）
              </div>
              {loading && <p style={{ color: '#71717a', fontSize: 12 }}>加载中…</p>}
              {!loading && agg.length === 0 && <p style={{ color: '#52525b', fontSize: 13 }}>暂无位置记录</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {agg.map(a => {
                  const ratio = a.hours / maxHours;
                  const t = Math.sqrt(ratio);
                  return (
                    <div key={a.place}
                      onMouseEnter={() => setHover(a)} onMouseLeave={() => setHover(null)}
                      onClick={() => setSelected(a)}
                      style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span style={{ color: '#e4e4e7', fontWeight: 500 }}>
                          {a.place}
                          <span style={{ marginLeft: 8, fontSize: 11, color: tagMeta(a.topTag).color }}>
                            {tagMeta(a.topTag).icon} {a.topTag}
                          </span>
                        </span>
                        <span style={{ color: '#a1a1aa' }}>{fmtDur(a.hours)}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: '#121224', marginTop: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(4, t * 100)}%`, height: '100%', background: heatColor(t) }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
        )}
      </div>
    </div>
  );
}
