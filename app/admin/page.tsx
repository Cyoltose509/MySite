'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, clearSession } from '@/lib/auth';
import { SyncPanel } from '@/components/admin/SyncPanel';
import { MusicTagEditor } from '@/components/admin/MusicTagEditor';
import { MoodLogger } from '@/components/admin/MoodLogger';

export default function AdminPage() {
  const [auth, setAuth] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login');
    } else {
      setAuth(true);
    }
    setChecking(false);
  }, []);

  const handleLogout = () => {
    clearSession();
    router.push('/login');
  };

  if (checking) {
    return (
      <div style={styles.loading}>
        <p>检查登录状态...</p>
      </div>
    );
  }

  if (!auth) return null;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.h1}>🔧 管理后台</h1>
        <button onClick={handleLogout} style={styles.logoutBtn}>
          退出登录
        </button>
      </header>

      <div style={styles.grid}>
        <SyncPanel />
        <MusicTagEditor />
      </div>

      <div style={styles.fullWidth}>
        <MoodLogger />
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
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  h1: {
    fontSize: 28,
    fontWeight: 700,
    color: 'var(--color-text)',
    margin: 0,
  },
  logoutBtn: {
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'transparent',
    color: 'var(--color-text)',
    cursor: 'pointer',
    fontSize: 13,
  },
  loading: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-muted)',
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
