'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import { isAuthenticated } from '@/lib/auth';
import { getAnimeList, type AnimeItem } from '@/lib/anime-data';
import { StatCard } from '@/components/dashboard/StatCard';

export default function DashboardPage() {
  const [animeList, setAnimeList] = useState<AnimeItem[]>([]);
  const [musicCount, setMusicCount] = useState(0);
  const [moodCount, setMoodCount] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [recentMusic, setRecentMusic] = useState<any[]>([]);
  const [recentMoods, setRecentMoods] = useState<any[]>([]);
  const [recentEvents, setRecentEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setIsLoggedIn(isAuthenticated());
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const loggedIn = isAuthenticated();

    // Anime: direct from GitHub (no DB)
    const animeData = await getAnimeList().catch(() => [] as AnimeItem[]);

    // Music/Mood/Events: from Supabase
    const { count: mc } = await supabase
      .from('music_list')
      .select('*', { count: 'exact', head: true });

    let mq = supabase.from('mood_logs').select('*', { count: 'exact', head: true });
    if (!loggedIn) mq = mq.eq('visibility', 'public');
    const { count: lc } = await mq;

    let eq = supabase.from('events').select('*', { count: 'exact', head: true });
    if (!loggedIn) eq = eq.eq('visibility', 'public');
    const { count: ec } = await eq;

    let moodQ = supabase.from('mood_logs').select('*').order('created_at', { ascending: false });
    if (!loggedIn) moodQ = moodQ.eq('visibility', 'public');

    let eventQ = supabase.from('events').select('*').order('event_date', { ascending: false });
    if (!loggedIn) eventQ = eventQ.eq('visibility', 'public');

    const [{ data: musicData }, { data: moodData }, { data: eventData }] = await Promise.all([
      supabase.from('music_list').select('*').order('play_count', { ascending: false }).limit(8),
      moodQ.limit(8),
      eventQ.limit(6),
    ]);

    setAnimeList(animeData);
    setMusicCount(mc || 0);
    setMoodCount(lc || 0);
    setEventCount(ec || 0);
    setRecentMusic(musicData || []);
    setRecentMoods(moodData || []);
    setRecentEvents(eventData || []);
    setLoading(false);
  };

  const getStatusColor = (status: string) => {
    const map: Record<string, string> = {
      '看完': '#4ade80', '正在看': '#60a5fa', '中道崩殂': '#f87171',
    };
    return map[status] || '#71717a';
  };

  const animeCount = animeList.length;
  const recentAnime = animeList
    .sort((a, b) => {
      const order: Record<string, number> = { '正在看': 0, '看完': 1, '中道崩殂': 2, '未知': 3 };
      return (order[a.status] ?? 4) - (order[b.status] ?? 4);
    })
    .slice(0, 8);

  if (loading) return (
    <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={css.spinner} />
      <p style={{ fontSize: 13, color: '#71717a' }}>加载数据...</p>
    </div>
  );

  return (
    <div style={css.page}>
      <header style={css.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Image src="/avatar.png" alt="avatar" width={48} height={48}
            style={{ borderRadius: 14, border: '2px solid #6366f1' }} />
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.5' }}>
              个人数据中枢
            </h1>
            <p style={{ fontSize: 13, color: '#52525b', margin: '2px 0 0 0' }}>
              Personal Data Hub
            </p>
          </div>
        </div>
        {isLoggedIn && (
          <Link href="/admin" style={{
            padding: '8px 18px', borderRadius: 10, border: '1px solid #27273d',
            color: '#818cf8', fontSize: 13, textDecoration: 'none',
          }}>进入管理 →</Link>
        )}
      </header>

      {/* Stats */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <Link href="/anime" style={{ textDecoration: 'none' }}><StatCard label="🎬 番剧总数" value={animeCount} /></Link>
          <Link href="/music" style={{ textDecoration: 'none' }}><StatCard label="🎵 音乐收藏" value={musicCount} /></Link>
          <Link href="/mood" style={{ textDecoration: 'none' }}><StatCard label="🧠 心情记录" value={moodCount} /></Link>
          <Link href="/events" style={{ textDecoration: 'none' }}><StatCard label="📅 生活事件" value={eventCount} /></Link>
        </div>
      </section>

      {/* Main Grid */}
      <main style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
        {/* Anime Card */}
        <section style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#e4e4e7', margin: 0 }}>🎬 最近番剧</h3>
            <Link href="/anime" style={{ fontSize: 12, color: '#6366f1', textDecoration: 'none' }}>查看全部</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {recentAnime.length === 0 && <p style={{ textAlign: 'center', color: '#52525b', fontSize: 13, padding: 28 }}>加载中...</p>}
            {recentAnime.map((a, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 10 }}>
                <span style={{ fontSize: 13, color: '#d4d4d8', fontWeight: 500 }}>{a.title}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500, background: `${getStatusColor(a.status)}22`, color: getStatusColor(a.status) }}>{a.status}</span>
                  {a.rating && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#1e1e32', color: '#d4d4d8' }}>{a.rating}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Music Card */}
        <section style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#e4e4e7', margin: 0 }}>🎵 热门音乐</h3>
            <Link href="/music" style={{ fontSize: 12, color: '#6366f1', textDecoration: 'none' }}>查看全部</Link>
          </div>
          <p style={{ fontSize: 10, color: '#52525b', margin: '0 0 6px' }}>数据来源：网易云音乐</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {recentMusic.length === 0 && <p style={{ textAlign: 'center', color: '#52525b', fontSize: 13, padding: 28 }}>暂无数据</p>}
            {recentMusic.map((m: any) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: '#d4d4d8', fontWeight: 500, display: 'block' }}>{m.title}</span>
                  <span style={{ fontSize: 11, color: '#71717a' }}>{m.artist}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Mood Card */}
        <section style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#e4e4e7', margin: 0 }}>🧠 心情动态</h3>
            <Link href="/mood" style={{ fontSize: 12, color: '#6366f1', textDecoration: 'none' }}>查看全部</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentMoods.length === 0 && <p style={{ textAlign: 'center', color: '#52525b', fontSize: 13, padding: 28 }}>暂无记录</p>}
            {recentMoods.map((m: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 10 }}>
                <span style={{ fontSize: 26 }}>{m.mood.split(' ')[0]}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, color: '#d4d4e7' }}>
                    {m.comment ? (m.comment.slice(0, 50) + (m.comment.length > 50 ? '...' : '')) : m.mood}
                  </span>
                  <span style={{ fontSize: 11, color: '#52525b' }}>
                    {new Date(m.created_at).toLocaleDateString('zh-CN')}
                    {m.visibility === 'private' && <span style={{ color: '#fbbf24', marginLeft: 6 }}>🔒</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Events Card */}
        <section style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#e4e4e7', margin: 0 }}>📅 最近事件</h3>
            <Link href="/events" style={{ fontSize: 12, color: '#6366f1', textDecoration: 'none' }}>查看全部</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentEvents.length === 0 && <p style={{ textAlign: 'center', color: '#52525b', fontSize: 13, padding: 28 }}>暂无事件</p>}
            {recentEvents.map((e: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'start', padding: '10px 12px', borderRadius: 10 }}>
                <span style={{ fontSize: 22 }}>{e.icon || '📌'}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, color: '#d4d4d8', fontWeight: 500 }}>{e.title}</span>
                  <span style={{ fontSize: 11, color: '#52525b' }}>
                    {new Date(e.event_date).toLocaleDateString('zh-CN')}
                    {e.visibility === 'private' && <span style={{ color: '#fbbf24', marginLeft: 6 }}>🔒</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer style={{ marginTop: 48, paddingTop: 20, borderTop: '1px solid #1e1e32', textAlign: 'center', fontSize: 12, color: '#3f3f50' }}>
        <p>Powered by DataHub · Built with Next.js + Supabase</p>
      </footer>
    </div>
  );
}

const css = {
  page: { minHeight: '100vh', maxWidth: 1100, margin: '0 auto', padding: '28px 20px 40px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 36 },
  spinner: { width: 36, height: 36, borderRadius: '50%', border: '3px solid #1e1e32', borderTopColor: '#6366f1', animation: 'spin 0.8s linear infinite' },
};

const cardStyle = {
  background: '#121224', border: '1px solid #1e1e32', borderRadius: 16, padding: 22,
};
