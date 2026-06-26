'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AnimeStats } from '@/components/dashboard/AnimeStats';
import { MusicStats } from '@/components/dashboard/MusicStats';
import { MoodTrends } from '@/components/dashboard/MoodTrends';
import { StatCard } from '@/components/dashboard/StatCard';

interface AnimeRecord {
  id: string;
  title: string;
  status: string;
  progress: number;
  rating: string;
  updated_at: string;
}

interface MusicRecord {
  id: string;
  title: string;
  artist: string;
  play_count: number;
}

interface MoodRecord {
  mood: string;
  created_at: string;
  visibility: string;
}

export default function DashboardPage() {
  const [animeCount, setAnimeCount] = useState(0);
  const [musicCount, setMusicCount] = useState(0);
  const [moodCount, setMoodCount] = useState(0);
  const [animeList, setAnimeList] = useState<AnimeRecord[]>([]);
  const [musicList, setMusicList] = useState<MusicRecord[]>([]);
  const [moodList, setMoodList] = useState<MoodRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);

    const { count: ac } = await supabase
      .from('anime_list')
      .select('*', { count: 'exact', head: true });

    const { count: mc } = await supabase
      .from('music_list')
      .select('*', { count: 'exact', head: true });

    const { count: lc } = await supabase
      .from('mood_logs')
      .select('*', { count: 'exact', head: true })
      .eq('visibility', 'public');

    const { data: animeData } = await supabase
      .from('anime_list')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100);

    const { data: musicData } = await supabase
      .from('music_list')
      .select('*')
      .order('play_count', { ascending: false })
      .limit(100);

    const { data: moodData } = await supabase
      .from('mood_logs')
      .select('*')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(100);

    setAnimeCount(ac || 0);
    setMusicCount(mc || 0);
    setMoodCount(lc || 0);
    setAnimeList(animeData || []);
    setMusicList(musicData || []);
    setMoodList(moodData || []);
    setLoading(false);
  };

  if (loading) {
    return (
      <div style={styles.loading}>
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.h1}>📊 个人数据中心</h1>
        <p style={styles.subtitle}>Public Dashboard</p>
      </header>

      <div style={styles.statsRow}>
        <StatCard label="番剧总数" value={animeCount} />
        <StatCard label="音乐总数" value={musicCount} />
        <StatCard label="心情记录" value={moodCount} />
      </div>

      <div style={styles.grid}>
        <AnimeStats data={animeList} />
        <MusicStats data={musicList} />
      </div>

      <div style={styles.fullWidth}>
        <MoodTrends data={moodList} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '32px 24px',
  },
  header: {
    marginBottom: 32,
  },
  h1: {
    fontSize: 28,
    fontWeight: 700,
    color: 'var(--color-text)',
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--color-muted)',
    margin: '4px 0 0 0',
  },
  loading: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-muted)',
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16,
    marginBottom: 32,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 24,
    marginBottom: 32,
  },
  fullWidth: {
    width: '100%',
  },
};
