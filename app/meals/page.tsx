'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import {
  C, pageStyle, cardGridStyle, cardStyle, cardContentStyle,
  cardTitleStyle, badgeStyle, tagChipStyle, tagMoreStyle, emptyStyle,
  headerStyle, backLinkStyle, h1Style, countBadgeStyle,
  controlsStyle, filterRowStyle, filterLabelStyle, filterTabsStyle, filterTabStyle, filterTabActiveStyle,
  statsRowStyle, searchInputStyle, modalOverlayStyle, modalStyle, modalCloseStyle,
} from '@/lib/card-styles';

interface MealRecord { id: string; title: string; cover_url?: string; rating: string; }
interface MealTag { id?: string; meal_id: string; tag: string; note?: string; }

const RATINGS = ['夯', '顶级', '人上人', 'NPC', '拉完了'];
const RC: Record<string, string> = { '夯': '#a855f7', '顶级': '#4ade80', '人上人': '#eab308', 'NPC': '#6b7280', '拉完了': '#f87171' };

export default function MealsPage() {
  const [meals, setMeals] = useState<MealRecord[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<string, MealTag[]>>({});
  const [eatCounts, setEatCounts] = useState<Record<string, number>>({});
  const [eatDetails, setEatDetails] = useState<Record<string, { date: string; amount?: number }[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [ratingFilter, setRatingFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'rating' | 'title'>('rating');
  const [detailMeal, setDetailMeal] = useState<MealRecord | null>(null);
  const [hoverEat, setHoverEat] = useState<string | null>(null);
  const [hoverEatDetail, setHoverEatDetail] = useState(false);
  const eatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eatSpanRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: mealData } = await supabase.from('meals').select('*');
    const { data: tagData } = await supabase.from('meal_tags').select('*');
    setMeals((mealData || []) as MealRecord[]);
    const tm: Record<string, MealTag[]> = {};
    if (tagData) for (const t of tagData) { if (!tm[t.meal_id]) tm[t.meal_id] = []; tm[t.meal_id].push(t); }
    setTagsMap(tm);

    // Eat counts
    const { data: events } = await supabase.from('event_logs').select('refs, event_at, group_id').not('refs', 'is', null).neq('refs', '[]');
    const { data: evGroups } = await supabase.from('event_groups').select('id, name');
    const groupMap: Record<string, string> = {};
    if (evGroups) for (const g of evGroups) groupMap[g.id] = g.name;
    const ec: Record<string, number> = {};
    const ed: Record<string, { date: string; amount?: number }[]> = {};
    if (events) for (const e of events) {
      if (groupMap[e.group_id] !== '大餐') continue;
      const refs = e.refs as any[]; if (!refs) continue;
      const d = new Date(e.event_at).toLocaleDateString('zh-CN');
      for (const r of refs) { if (!r.id) continue; ec[r.id] = (ec[r.id] || 0) + 1; if (!ed[r.id]) ed[r.id] = []; ed[r.id].push({ date: d, amount: r.amount }); }
    }
    setEatCounts(ec); setEatDetails(ed);
    setLoading(false);
  };

  const allTags = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of meals) for (const t of (tagsMap[m.id] || [])) counts[t.tag] = (counts[t.tag] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  }, [meals, tagsMap]);

  const taggedCount = useMemo(() => meals.filter(m => (tagsMap[m.id] || []).length > 0).length, [meals, tagsMap]);

  const sorted = useMemo(() => {
    let list = [...meals];
    if (sortBy === 'rating') {
      const RO: Record<string, number> = { '夯': 0, '顶级': 1, '人上人': 2, 'NPC': 3, '拉完了': 4 };
      list.sort((a, b) => { const ra = RO[a.rating] ?? 99; const rb = RO[b.rating] ?? 99; if (ra !== rb) return ra - rb; return a.title.localeCompare(b.title); });
    } else list.sort((a, b) => a.title.localeCompare(b.title));
    if (search.trim()) { const q = search.toLowerCase(); list = list.filter(m => m.title.toLowerCase().includes(q) || (tagsMap[m.id] || []).some(t => t.tag.includes(q))); }
    if (ratingFilter) list = list.filter(m => m.rating === ratingFilter);
    if (tagFilter) list = list.filter(m => (tagsMap[m.id] || []).some(t => t.tag === tagFilter));
    return list;
  }, [meals, search, ratingFilter, tagFilter, sortBy, tagsMap]);

  if (loading) return <div style={pageStyle}><p style={{ color: C.textSec, textAlign: 'center', padding: 40 }}>加载中...</p></div>;

  const mealTags = (id: string) => tagsMap[id] || [];

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={backLinkStyle}>← 返回首页</Link>
        <h1 style={h1Style}>🍽️ 美食</h1>
        <span style={countBadgeStyle}>{meals.length}</span>
      </header>

      <section style={controlsStyle}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 搜索美食或标签..." style={searchInputStyle} />

        <div style={filterRowStyle}>
          <span style={filterLabelStyle}>排序</span>
          <div style={filterTabsStyle}>
            {[{ value: 'rating', label: '评级优先' }, { value: 'title', label: '标题 A→Z' }].map(opt => (
              <button key={opt.value} onClick={() => setSortBy(opt.value as any)}
                style={{ ...filterTabStyle, ...(sortBy === opt.value ? filterTabActiveStyle : {}) }}>{opt.label}</button>
            ))}
          </div>
        </div>

        <div style={filterRowStyle}>
          <span style={filterLabelStyle}>评级</span>
          <div style={filterTabsStyle}>
            <button onClick={() => setRatingFilter(null)}
              style={{ ...filterTabStyle, ...(ratingFilter === null ? filterTabActiveStyle : {}) }}>全部</button>
            {RATINGS.map(r => (
              <button key={r} onClick={() => setRatingFilter(r)}
                style={{ ...filterTabStyle, ...(ratingFilter === r ? filterTabActiveStyle : {}) }}>{r}</button>
            ))}
          </div>
        </div>

        {allTags.length > 0 && (
          <div style={filterRowStyle}>
            <span style={filterLabelStyle}>标签</span>
            <div style={filterTabsStyle}>
              <button onClick={() => setTagFilter(null)}
                style={{ ...filterTabStyle, ...(tagFilter === null ? filterTabActiveStyle : {}) }}>全部</button>
              {allTags.map(({ tag, count }) => (
                <button key={tag} onClick={() => setTagFilter(tag)}
                  style={{ ...filterTabStyle, ...(tagFilter === tag ? filterTabActiveStyle : {}) }}>
                  {tag} <span style={{ fontSize: 10, color: C.textDim, marginLeft: 2 }}>{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={statsRowStyle}>
          <span>已标记 {taggedCount}</span>
          <span>未标记 {meals.length - taggedCount}</span>
        </div>
      </section>

      <main style={cardGridStyle}>
        {sorted.map(m => {
          const tags = mealTags(m.id);
          const firstTag = tags[0];
          const ec = eatCounts[m.id] || 0;
          return (
            <article key={m.id} style={cardStyle} onClick={() => { setHoverEat(null); setDetailMeal(m); }}>
              {m.cover_url && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 0,
                  backgroundImage: `url(${m.cover_url})`,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  filter: 'brightness(0.6) saturate(0.8)',
                }} />
              )}
              <div style={{ ...cardContentStyle, zIndex: 2 }}>
                <p style={cardTitleStyle(!!firstTag)}>{m.title}</p>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <span style={{ ...badgeStyle(RC[m.rating] || '#71717a'), fontWeight: 700 }}>{m.rating}</span>
                  {ec > 0 && (
                    <span style={{ fontSize: 10, color: '#fbbf24', cursor: 'pointer', alignSelf: 'flex-start' }}
                      onMouseEnter={(e) => { e.stopPropagation(); if (eatTimer.current) clearTimeout(eatTimer.current); setHoverEat(m.id); }}
                      onMouseLeave={(e) => { e.stopPropagation(); eatTimer.current = setTimeout(() => setHoverEat(null), 200); }}>
                      🍴 {ec}次
                    </span>
                  )}
                </div>
                {tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
                    {tags.slice(0, 5).map(t => <span key={t.tag} style={tagChipStyle}>{t.tag}</span>)}
                    {tags.length > 5 && <span style={tagMoreStyle}>+{tags.length - 5}</span>}
                  </div>
                )}
              </div>

              {hoverEat === m.id && eatDetails[m.id] && (
                <div style={{ position: 'fixed', left: 0, top: 0, zIndex: 9999, pointerEvents: 'none' }}
                  ref={el => { if (!el) return; const r = el.previousElementSibling?.getBoundingClientRect(); if (r) { el.style.left = r.left + 'px'; el.style.top = r.bottom + 'px'; } }}>
                  <div style={{ pointerEvents: 'auto', background: '#16162a', border: '1px solid #2a2a40', borderRadius: 8, padding: '6px 8px', minWidth: 120, maxHeight: 160, overflow: 'auto' }}>
                    {eatDetails[m.id].slice(0, 20).map((ev, i) => (
                      <span key={i} style={{ display: 'block', fontSize: 10, color: '#a1a1aa', padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        {ev.date}{ev.amount ? ` ¥${ev.amount}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </main>

      {sorted.length === 0 && <p style={emptyStyle}>没有匹配的美食</p>}

      {/* Detail Modal */}
      {detailMeal && (
        <div style={modalOverlayStyle} onClick={() => { setDetailMeal(null); setHoverEat(null); }}>
          <div style={{ ...modalStyle, maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <button style={modalCloseStyle} onClick={() => setDetailMeal(null)}>✕</button>
            <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
              {detailMeal.cover_url ? (
                <div style={{ width: 230, height: 150, borderRadius: 14, overflow: 'hidden', background: C.border, flexShrink: 0 }}>
                  <img src={detailMeal.cover_url} alt={detailMeal.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
                </div>
              ) : (
                <div style={{ width: 230, height: 150, borderRadius: 14, background: C.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, flexShrink: 0 }}>🍽️</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 8px' }}>{detailMeal.title}</h2>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <span style={{ ...badgeStyle(RC[detailMeal.rating] || '#71717a'), fontSize: 13, fontWeight: 700 }}>{detailMeal.rating}</span>
                  {eatCounts[detailMeal.id] ? (
                    <span ref={eatSpanRef} style={{ padding: '4px 10px', borderRadius: 20, fontSize: 13, color: '#fbbf24', background: 'rgba(245,158,11,0.1)', cursor: 'pointer' }}
                      onMouseEnter={() => { if (eatTimer.current) clearTimeout(eatTimer.current); setHoverEatDetail(true); }}
                      onMouseLeave={() => { eatTimer.current = setTimeout(() => setHoverEatDetail(false), 200); }}>
                      🍴 吃了 {eatCounts[detailMeal.id]} 次
                    </span>
                  ) : null}
                </div>
                {mealTags(detailMeal.id).length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {mealTags(detailMeal.id).map(t => (
                      <span key={t.tag} style={{ padding: '6px 14px', borderRadius: 20, background: C.border, fontSize: 12, color: C.textSec }}>{t.tag}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          {hoverEatDetail && eatDetails[detailMeal.id] && (
            <div style={{ position: 'fixed', left: 0, top: 0, zIndex: 9999, pointerEvents: 'none' }}
              ref={el => { if (!el || !eatSpanRef.current) return; const r = eatSpanRef.current.getBoundingClientRect(); el.style.left = r.left + 'px'; el.style.top = (r.bottom + 4) + 'px'; }}>
              <div style={{ pointerEvents: 'auto', background: '#16162a', border: '1px solid #2a2a40', borderRadius: 8, padding: '6px 8px', minWidth: 120, maxHeight: 160, overflow: 'auto' }}>
                {eatDetails[detailMeal.id].slice(0, 20).map((ev, i) => (
                  <span key={i} style={{ display: 'block', fontSize: 10, color: '#a1a1aa', padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>{ev.date}{ev.amount ? ` ¥${ev.amount}` : ''}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
