'use client';

import { useState } from 'react';
import { getSession } from '@/lib/auth';
import { fetchNeteasePlaylist, syncNeteaseToSupabase } from '@/lib/sync/netease';
import { SyncProgressModal, SyncStep } from '@/components/ui/SyncProgressModal';

export function SyncPanel() {
  const [syncing, setSyncing] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [progressSteps, setProgressSteps] = useState<SyncStep[]>([]);
  const [lastResult, setLastResult] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addStep = (step: SyncStep) => {
    setProgressSteps((prev) => [...prev.slice(-50), step]);
  };

  const handleMusicSync = async () => {
    if (syncing) return;
    const hash = getSession();
    if (!hash) { setError('请先登录'); return; }

    setSyncing('music');
    setShowProgress(true);
    setProgressSteps([]);
    setError(null);

    try {
      const playlistData = await fetchNeteasePlaylist(hash, addStep);
      await syncNeteaseToSupabase(playlistData, hash, addStep);
      setLastResult(`✅ 音乐同步完成，共 ${playlistData.total} 首`);
    } catch (err: any) {
      setError(err.message || '同步失败');
      setLastResult('❌ 音乐同步失败');
    }
    setSyncing(null);
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.h3}>🔄 数据同步</h3>

      <div style={styles.note}>
        <p style={styles.noteText}>
          <span style={styles.noteIcon}>💡</span>
          番剧数据直接从 GitHub 仓库实时读取，无需同步。点击{' '}
          <a href="/anime" style={styles.link}>番剧页面</a>
          {' '}查看，数据自动缓存 6 小时。
        </p>
      </div>

      <div style={styles.btnRow}>
        <button onClick={handleMusicSync} disabled={!!syncing}
          style={{ ...styles.btn, ...(syncing === 'music' ? styles.btnActive : {}) }}>
          {syncing === 'music' ? '⏳ 同步中...' : '🎵 同步网易云歌单'}
        </button>
      </div>

      {lastResult && (
        <p style={{
          ...styles.result,
          background: lastResult.includes('✅') ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
          color: lastResult.includes('✅') ? '#4ade80' : '#f87171',
        }}>{lastResult}</p>
      )}

      <div style={styles.info}>
        <div style={styles.infoRow}>
          <span style={styles.infoLabel}>番剧源</span>
          <span style={styles.infoValue}>GitHub 实时读取</span>
        </div>
        <div style={styles.infoRow}>
          <span style={styles.infoLabel}>网易云歌单</span>
          <span style={styles.infoValue}>7611680006</span>
        </div>
      </div>

      <SyncProgressModal
        isOpen={showProgress}
        steps={progressSteps}
        error={error}
        onClose={() => { setShowProgress(false); setError(null); }}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#16162a',
    border: '1px solid #2a2a40',
    borderRadius: 16,
    padding: 24,
  },
  h3: {
    fontSize: 16,
    fontWeight: 600,
    color: '#e4e4e7',
    margin: 0,
    marginBottom: 20,
  },
  note: {
    padding: '12px 16px',
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: 10,
    marginBottom: 16,
  },
  noteText: {
    fontSize: 12,
    color: '#a1a1aa',
    margin: 0,
    lineHeight: 1.6,
  },
  noteIcon: {
    marginRight: 4,
  },
  link: {
    color: '#818cf8',
    textDecoration: 'none',
  },
  btnRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  btn: {
    padding: '12px 16px',
    borderRadius: 10,
    border: '1px solid #2a2a40',
    background: 'transparent',
    color: '#e4e4e7',
    cursor: 'pointer',
    fontSize: 13,
    textAlign: 'left',
    transition: 'all 0.2s',
  },
  btnActive: {
    borderColor: '#6366f1',
    background: 'rgba(99,102,241,0.1)',
    color: '#818cf8',
  },
  result: {
    fontSize: 13,
    marginTop: 14,
    marginBottom: 0,
    padding: '10px 14px',
    borderRadius: 8,
  },
  info: {
    marginTop: 18,
    padding: '12px 16px',
    background: '#121224',
    borderRadius: 10,
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
  },
  infoLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#52525b',
  },
  infoValue: {
    fontSize: 12,
    color: '#a1a1aa',
    fontFamily: 'monospace',
  },
};
