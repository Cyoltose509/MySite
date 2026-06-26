'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { isAuthenticated } from '@/lib/auth';
import { EVENT_TYPES } from '@/lib/types';

interface EventRecord {
  id: string;
  title: string;
  description?: string;
  event_date: string;
  event_type?: 'life' | 'work' | 'travel' | 'milestone' | 'other';
  visibility: 'public' | 'private';
  icon?: string;
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [filterType, setFilterType] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchEvents(); }, []);

  const fetchEvents = async () => {
    let q = supabase.from('events').select('*').order('event_date', { ascending: false }).limit(200);
    if (!isAuthenticated()) q = q.eq('visibility', 'public');
    const { data } = await q;
    setEvents(data || []);
    setLoading(false);
  };

  // Group by year-month
  const filtered = filterType === 'all' ? events : events.filter((e) => e.event_type === filterType);
  const grouped = filtered.reduce((groups, ev) => {
    const key = new Date(ev.event_date).toISOString().slice(0, 7); // YYYY-MM
    if (!groups[key]) groups[key] = [];
    groups[key].push(ev);
    return groups;
  }, {} as Record<string, EventRecord[]>);

  const typeCounts = events.reduce((acc, e) => {
    acc[e.event_type || 'life'] = (acc[e.event_type || 'life'] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return <div style={S.loading}><div style={S.spinner} /><p>加载中...</p></div>;
  }

  return (
    <div style={S.page}>
      <header style={S.header}>
        <Link href="/" style={S.back}>← 首页</Link>
        <h1 style={S.h1}>📅 生活事件</h1>
        <span style={S.badge}>{events.length} 条</span>
        {isAuthenticated() && <Link href="/admin" style={S.adminLink}>管理 →</Link>}
      </header>

      {/* Type Filter */}
      <section style={S.filterRow}>
        <button onClick={() => setFilterType('all')}
          style={{...S.filterBtn, ...(filterType === 'all' ? S.filterBtnActive : {})}}>
          全部
        </button>
        {EVENT_TYPES.map((t) => (
          <button key={t.value} onClick={() => setFilterType(t.value)}
            style={{
              ...S.filterBtn,
              ...(filterType === t.value ? S.filterBtnActive : {}),
            }}>
            {t.label} ({typeCounts[t.value] || 0})
          </button>
        ))}
      </section>

      {/* Timeline */}
      <main style={S.timeline}>
        {Object.entries(grouped).map(([month, monthEvents]) => (
          <section key={month} style={S.monthGroup}>
            <h3 style={S.monthTitle}>
              {new Date(month).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}
            </h3>
            <div style={S.monthLine}>
              {monthEvents.map((ev) => {
                const typeInfo = EVENT_TYPES.find((t) => t.value === ev.event_type);
                return (
                  <article key={ev.id} style={{
                    ...S.eventCard,
                    borderLeftColor: ev.visibility === 'private' ? '#f59e0b' : '#6366f1',
                  }}>
                    <div style={S.eventIconWrap}>
                      <span style={S.eventIcon}>{ev.icon || (typeInfo?.icon || '📌')}</span>
                    </div>
                    <div style={S.eventBody}>
                      <h4 style={S.eventTitle}>{ev.title}</h4>
                      {ev.description && (
                        <p style={S.eventDesc}>{ev.description}</p>
                      )}
                      <div style={S.eventMeta}>
                        <span style={{
                          ...S.typeBadge,
                          background: '#16162a',
                        }}>{typeInfo?.label || ev.event_type}</span>
                        <span style={S.dateText}>
                          {new Date(ev.event_date).toLocaleDateString('zh-CN')}
                        </span>
                        <span style={{
                          ...(ev.visibility === 'private' ? S.privateBadge : S.publicBadge),
                        }}>
                          {ev.visibility === 'private' ? '私密' : '公开'}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        {filtered.length === 0 && <p style={S.empty}>暂无事件记录</p>}
      </main>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {};
S.page = { minHeight: '100vh', maxWidth: 800, margin: '0 auto', padding: '28px 20px 40px' };
S.loading = { minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 };
S.spinner = { width: 36, height: 36, borderRadius: '50%', border: '3px solid #1e1e32', borderTopColor: '#6366f1', animation: 'spin 0.8s linear infinite' };
S.header = { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 };
S.back = { fontSize: 13, color: '#71717a', textDecoration: 'none' };
S.h1 = { fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, flex: 1 };
S.badge = { padding: '4px 14px', borderRadius: 20, background: '#16162a', border: '1px solid #27273d', fontSize: 13, color: '#818cf8' };
S.adminLink = { padding: '6px 14px', borderRadius: 10, border: '1px solid #27273d', color: '#818cf8', fontSize: 12, textDecoration: 'none' };
S.filterRow = { display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' };
S.filterBtn = {
  padding: '6px 14px', borderRadius: 20, border: '1px solid #27273d',
  background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 11,
};
S.filterBtnActive = { background: '#16162a', color: '#fff', borderColor: '#6366f1' };
S.timeline = { display: 'flex', flexDirection: 'column', gap: 32 };
S.monthGroup = {};
S.monthTitle = { fontSize: 15, fontWeight: 700, color: '#d4d4d8', margin: '0 0 14px' };
S.monthLine = { display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 20, borderLeft: '2px solid #1e1e32', marginLeft: 9 };
S.eventCard = {
  display: 'flex', gap: 14, padding: '14px 18px', position: 'relative',
  background: '#121224', border: '1px solid #1e1e32', borderLeft: '3px solid transparent',
  borderRadius: 12, transition: 'border-color 0.15s',
};
S.eventIconWrap = {};
S.eventIcon = { fontSize: 26 };
S.eventBody = { flex: 1, minWidth: 0 };
S.eventTitle = { fontSize: 14, fontWeight: 600, color: '#e4e4e7', margin: '0 0 4px' };
S.eventDesc = { fontSize: 12, color: '#a1a1aa', margin: '0 0 8px', lineHeight: 1.5 };
S.eventMeta = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
S.typeBadge = { fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 500 };
S.dateText = { fontSize: 11, color: '#52525b' };
S.publicBadge = { color: '#818cf8', fontSize: 10 };
S.privateBadge = { color: '#fbbf24', fontSize: 10 };
S.empty = { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 48 };
