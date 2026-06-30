'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, clearSession } from '@/lib/auth';
import { withBasePath } from '@/lib/base-path';
import { SyncPanel } from '@/components/admin/SyncPanel';
import { MusicTagEditor } from '@/components/admin/MusicTagEditor';
import { SteamGameEditor } from '@/components/admin/SteamGameEditor';
import { MoodLogger } from '@/components/admin/MoodLogger';
import { EventCounter } from '@/components/admin/EventCounter';

type TabId = 'sync' | 'music' | 'games' | 'mood' | 'events';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'sync', label: '数据同步', icon: '🔄' },
  { id: 'music', label: '音乐标签', icon: '🎵' },
  { id: 'games', label: '游戏标签', icon: '🎮' },
  { id: 'mood', label: '心情记录', icon: '🧠' },
  { id: 'events', label: '事件计数', icon: '📅' },
];

export default function AdminPage() {
  const [auth, setAuth] = useState(false);
  const [checking, setChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('sync');
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
        <div style={styles.spinnerWrap}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>验证登录...</p>
        </div>
      </div>
    );
  }

  if (!auth) return null;

  return (
    <div style={styles.page}>
      {/* Top Nav */}
      <nav style={styles.nav}>
        <div style={styles.navLeft}>
          <img src={withBasePath('/avatar.png')} alt="avatar" width={36} height={36}
            style={{ borderRadius: 10, border: '2px solid #6366f1' }} />
          <span style={styles.brand}>DataHub · 管理后台</span>
        </div>
        <button onClick={handleLogout} style={styles.logoutBtn}>
          → 返回首页
        </button>
      </nav>

      {/* Tab Bar */}
      <div style={styles.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tabBtn,
              ...(activeTab === tab.id ? styles.tabActive : {}),
            }}
          >
            <span style={styles.tabIcon}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <main style={styles.content}>
        {activeTab === 'sync' && <SyncPanel />}
        {activeTab === 'music' && <MusicTagEditor />}
        {activeTab === 'games' && <SteamGameEditor />}
        {activeTab === 'mood' && <MoodLogger />}
        {activeTab === 'events' && <EventCounter />}
      </main>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {};
const styles = S;

S.page = { minHeight: '100vh', background: '#0d0d1a' };
S.nav = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '16px 28px', borderBottom: '1px solid #1e1e32', backdropFilter: 'blur(10px)',
};
S.navLeft = { display: 'flex', alignItems: 'center', gap: 12 };
S.brand = { fontSize: 16, fontWeight: 700, color: '#e4e4e7', letterSpacing: -0.3 };
S.logoutBtn = {
  padding: '8px 18px', borderRadius: 10, border: '1px solid #27273d',
  background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 13,
};
S.loading = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
};
S.spinnerWrap = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 };
S.spinner = {
  width: 36, height: 36, borderRadius: '50%', border: '3px solid #27273d',
  borderTopColor: '#6366f1', animation: 'spin 0.8s linear infinite',
};
S.loadingText = { fontSize: 13, color: '#71717a' };
S.tabBar = {
  display: 'flex', gap: 4, padding: '14px 28px 0',
};
S.tabBtn = {
  display: 'flex', alignItems: 'center', gap: 7,
  padding: '10px 20px', borderRadius: 10, border: 'none',
  background: 'transparent', color: '#71717a', cursor: 'pointer',
  fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
};
S.tabActive = { color: '#fff', background: '#16162a' };
S.tabIcon = { fontSize: 16 };
S.content = { padding: '24px 28px', maxWidth: 1200, margin: '0 auto' };
