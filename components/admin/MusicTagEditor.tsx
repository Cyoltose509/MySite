'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { hashPassword, getSession } from '@/lib/auth';

export function MusicTagEditor() {
  const [musicList, setMusicList] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [tag, setTag] = useState('');
  const [mood, setMood] = useState('');
  const [intensity, setIntensity] = useState(3);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchMusic();
  }, []);

  const fetchMusic = async () => {
    const { data } = await supabase
      .from('music_list')
      .select('*')
      .order('play_count', { ascending: false })
      .limit(200);
    setMusicList(data || []);
  };

  const handleSave = async () => {
    if (!selectedId || !tag) {
      setMessage('请选择音乐并输入标签');
      return;
    }

    setLoading(true);
    const passwordHash = getSession() || '';

    const { data, error } = await supabase.rpc('fn_save_music_tag', {
      p_hash: passwordHash,
      p_music_id: selectedId,
      p_tag: tag,
      p_mood: mood || null,
      p_intensity: intensity,
    });

    if (error || (data && data.error)) {
      setMessage(`❌ 保存失败: ${error?.message || data?.error}`);
    } else {
      setMessage('✅ 标签已保存');
      setTag('');
      setMood('');
    }
    setLoading(false);
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.h3}>🏷 音乐标签编辑</h3>

      <div style={styles.form}>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={styles.select}
        >
          <option value="">选择音乐...</option>
          {musicList.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title} - {m.artist}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="标签 (如: 学习、运动、放松)"
          style={styles.input}
        />

        <input
          type="text"
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          placeholder="心情 (happy / calm / sad / energetic)"
          style={styles.input}
        />

        <div style={styles.intensityRow}>
          <span style={styles.intensityLabel}>强度:</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setIntensity(n)}
              style={
                intensity === n
                  ? { ...styles.intensityBtn, ...styles.intensityActive }
                  : styles.intensityBtn
              }
            >
              {n}
            </button>
          ))}
        </div>

        <button
          onClick={handleSave}
          disabled={loading}
          style={styles.btn}
        >
          {loading ? '保存中...' : '保存标签'}
        </button>

        {message && <p style={styles.message}>{message}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: 24,
  },
  h3: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--color-text)',
    margin: 0,
    marginBottom: 16,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  select: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: 13,
  },
  input: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: 13,
    outline: 'none',
  },
  intensityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  intensityLabel: {
    fontSize: 13,
    color: 'var(--color-muted)',
  },
  intensityBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    border: '1px solid var(--color-border)',
    background: 'transparent',
    color: 'var(--color-text)',
    cursor: 'pointer',
    fontSize: 13,
  },
  intensityActive: {
    background: 'var(--color-accent)',
    color: '#fff',
    borderColor: 'var(--color-accent)',
  },
  btn: {
    padding: '10px 0',
    borderRadius: 8,
    border: 'none',
    background: 'var(--color-accent)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  message: {
    fontSize: 13,
    margin: 0,
    color: 'var(--color-text)',
  },
};
