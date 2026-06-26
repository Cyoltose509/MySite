'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { isAuthenticated } from '@/lib/auth';

interface MoodRecord {
  id: string;
  mood: string;
  comment?: string;
  singability?: number;
  likability?: number;
  visibility: 'public' | 'private';
  created_at: string;
}

export default function MoodPage() {
  const [logs, setLogs] = useState<MoodRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchLogs(); }, []);

  const fetchLogs = async () => {
    let q = supabase.from('mood_logs').select('*').order('created_at', { ascending: false }).limit(200);
    if (!isAuthenticated()) q = q.eq('visibility', 'public');
    const { data } = await q;
    setLogs(data || []);
    setLoading(false);
  };

  // Mood distribution for simple chart
  const moodDist = logs.reduce((acc, l) => {
    const emoji = l.mood.split(' ')[0] || l.mood;
    acc[emoji] = (acc[emoji] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return <div style={S.loading}><div style={S.spinner} /><p>加载中...</p></div>;
  }

  return (
    <div style={S.page}>
      <header style={S.header}>
        <Link href="/" style={S.back}>← 首页</Link>
        <h1 style={S.h1}>🧠 心情记录</h1>
        <span style={S.badge}>{logs.length} 条</span>
        {isAuthenticated() && (
          <Link href="/admin" style={S.adminLink}>管理 →</Link>
        )}
      </header>

      {/* Mood Distribution Bar */}
      {Object.keys(moodDist).length > 0 && (
        <section style={S.distBar}>
          {Object.entries(moodDist)
            .sort((a, b) => b[1] - a[1])
            .map(([emoji, count]) => (
              <div key={emoji} style={{ ...S.distItem, flex: count }}>
                <span style={S.distEmoji}>{emoji}</span>
                <span style={S.distCount}>{count}</span>
              </div>
            ))}
        </section>
      )}

      {/* Timeline */}
      <main style={S.timeline}>
        {logs.map((log) => (
          <article key={log.id} style={S.logCard}>
            <div style={S.logLeft}>
              <span style={S.logEmoji}>{log.mood.split(' ')[0]}</span>
              <div style={S.logDate}>
                <p style={S.dateMain}>
                  {new Date(log.created_at).toLocaleDateString('zh-CN', {
                    month: 'long', day: 'numeric',
                  })}
                </p>
                <p style={S.dateSub}>
                  {new Date(log.created_at).toLocaleTimeString('zh-CN', {
                    hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              </div>
            </div>

            <div style={S.logBody}>
              <p style={S.moodText}>{log.mood}</p>

              {log.comment && (
                <p style={S.commentText}>{log.comment}</p>
              )}

              {(log.singability || log.likability) && (
                <div style={S.sliderRow}>
                  {log.singability && (
                    <span style={S.sliderChip}>🎤 能唱度 {log.singability}/5</span>
                  )}
                  {log.likability && (
                    <span style={S.sliderChip}>❤️ 喜欢度 {log.likability}/5</span>
                  )}
                </div>
              )}

              <div style={S.logFooter}>
                <span style={{
                  ...S.visBadge,
                  color: log.visibility === 'private' ? '#fbbf24' : '#818cf8',
                  background: log.visibility === 'private' ? 'rgba(245,158,11,0.12)' : 'rgba(99,102,241,0.12)',
                }}>
                  {log.visibility === 'private' ? '🔒 私密' : '🌐 公开'}
                </span>
              </div>
            </div>
          </article>
        ))}

        {logs.length === 0 && <p style={S.empty}>暂无心情记录</p>}
      </main>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {};
S.page = { minHeight: '100vh', maxWidth: 800, margin: '0 auto', padding: '28px 20px 40px' };
S.loading = { minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 };
S.spinner = { width: 36, height: 36, borderRadius: '50%', border: '3px solid #1e1e32', borderTopColor: '#6366f1', animation: 'spin 0.8s linear infinite' };
S.header = { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 };
S.back = { fontSize: 13, color: '#71717a', textDecoration: 'none' };
S.h1 = { fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, flex: 1 };
S.badge = { padding: '4px 14px', borderRadius: 20, background: '#16162a', border: '1px solid #27273d', fontSize: 13, color: '#818cf8' };
S.adminLink = { padding: '6px 14px', borderRadius: 10, border: '1px solid #27273d', color: '#818cf8', fontSize: 12, textDecoration: 'none' };
S.distBar = {
  display: 'flex', alignItems: 'flex-end', gap: 4,
  padding: '18px 22px', background: '#121224',
  border: '1px solid #1e1e32', borderRadius: 16, marginBottom: 28, height: 80,
};
S.distItem = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'flex-end', minWidth: 32, transition: 'flex 0.3s ease',
};
S.distEmoji = { fontSize: 16, marginBottom: 4 };
S.distCount = { fontSize: 11, color: '#52525b', fontWeight: 600 };
S.timeline = { display: 'flex', flexDirection: 'column', gap: 12 };
S.logCard = {
  display: 'flex', gap: 16, padding: '18px 20px',
  background: '#121224', border: '1px solid #1e1e32', borderRadius: 16,
};
S.logLeft = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 60 };
S.logEmoji = { fontSize: 30 };
S.dateMain = { fontSize: 12, fontWeight: 600, color: '#d4d4d8', margin: 0, textAlign: 'center' };
S.dateSub = { fontSize: 10, color: '#52525b', margin: 0 };
S.logBody = { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 };
S.moodText = { fontSize: 15, fontWeight: 600, color: '#e4e4e7', margin: 0 };
S.commentText = { fontSize: 13, color: '#a1a1aa', margin: 0, lineHeight: 1.6 };
S.sliderRow = { display: 'flex', gap: 8, marginTop: 2 };
S.sliderChip = { fontSize: 11, padding: '3px 10px', borderRadius: 20, background: '#1e1e32', color: '#a1a1aa' };
S.logFooter = { marginTop: 4 };
S.visBadge = { fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 500 };
S.empty = { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 48 };
