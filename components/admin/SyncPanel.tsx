'use client';

import { useState } from 'react';
import { getSession } from '@/lib/auth';
import { syncAnimeFromGitHub } from '@/lib/sync/anime';
import { syncNeteasePlaylist } from '@/lib/sync/netease';

export function SyncPanel() {
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const handleAnimeSync = async () => {
    setLoading('anime');
    setMessage('');

    try {
      const result = await syncAnimeFromGitHub();
      setMessage(`✅ 番剧同步完成，共 ${result.count} 条`);
    } catch (err: any) {
      setMessage(`❌ 同步失败: ${err.message}`);
    }
    setLoading(null);
  };

  const handleMusicSync = async () => {
    setLoading('music');
    setMessage('');

    try {
      const result = await syncNeteasePlaylist();
      setMessage(`✅ 音乐同步完成，共 ${result.count} 条`);
    } catch (err: any) {
      setMessage(`❌ 同步失败: ${err.message}`);
    }
    setLoading(null);
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.h3}>🔄 数据同步</h3>

      <div style={styles.btnRow}>
        <button
          onClick={handleAnimeSync}
          disabled={loading !== null}
          style={styles.btn}
        >
          {loading === 'anime' ? '同步中...' : '🔗 同步番剧数据'}
        </button>

        <button
          onClick={handleMusicSync}
          disabled={loading !== null}
          style={styles.btn}
        >
          {loading === 'music' ? '同步中...' : '🎵 同步网易云歌单'}
        </button>
      </div>

      {message && <p style={styles.message}>{message}</p>}

      <div style={styles.note}>
        <p style={styles.noteText}>
          番剧数据源: https://cyoltose509.github.io/my-anime-list/
        </p>
        <p style={styles.noteText}>
          网易云歌单: 7611680006
        </p>
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
  btnRow: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  btn: {
    padding: '10px 16px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'transparent',
    color: 'var(--color-text)',
    cursor: 'pointer',
    fontSize: 13,
    textAlign: 'left' as const,
  },
  message: {
    fontSize: 13,
    marginTop: 16,
    marginBottom: 0,
    color: 'var(--color-text)',
  },
  note: {
    marginTop: 16,
    padding: '12px 16px',
    background: 'var(--color-bg)',
    borderRadius: 8,
  },
  noteText: {
    fontSize: 12,
    color: 'var(--color-muted)',
    margin: 0,
    marginBottom: 4,
  },
};
