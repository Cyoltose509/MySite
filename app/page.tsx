'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { isAuthenticated } from '@/lib/auth';
import { withBasePath } from '@/lib/base-path';
import { MOOD_EMOJIS, MOOD_SCORE_LABELS } from '@/lib/types';
import { C, pageStyle, headerStyle, h1Style, backLinkStyle, loadingContainerStyle, spinnerStyle, loadingTextStyle } from '@/lib/card-styles';

interface MoodLog {
  id: string;
  mood: string;
  note?: string;
  mood_score?: number;
  created_at: string;
  visibility?: string;
}

interface EventGroup {
  id: string;
  name: string;
  icon: string;
  color: string;
  is_private: boolean;
  count?: number;
}

export default function DashboardPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [recentMoods, setRecentMoods] = useState<MoodLog[]>([]);
  const [recentSleep, setRecentSleep] = useState<any[]>([]);
  const [eventGroups, setEventGroups] = useState<EventGroup[]>([]);
  const [animeCount, setAnimeCount] = useState(0);
  const [musicCount, setMusicCount] = useState(0);
  const [gameCount, setGameCount] = useState(0);
  const [sleepAvg, setSleepAvg] = useState('--');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setIsLoggedIn(isAuthenticated());
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const loggedIn = isAuthenticated();

    // 心情动态
    let moodQ = supabase.from('mood_logs').select('*').order('created_at', { ascending: false });
    if (!loggedIn) moodQ = moodQ.eq('visibility', 'public');

    // 事件组
    const { data: gData } = await supabase
      .from('event_groups')
      .select('*')
      .order('sort_order', { ascending: true });

    // 查询每个事件组的计数
    const groupsWithCount: EventGroup[] = [];
    if (gData) {
      for (const g of gData) {
        const { count } = await supabase
          .from('event_logs')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', g.id);
        groupsWithCount.push({ ...g, count: count || 0 });
      }
    }

    // 番剧总数
    const { count: ac } = await supabase
      .from('anime_list')
      .select('*', { count: 'exact', head: true });

    // 歌单总数
    const { count: mc } = await supabase
      .from('music_list')
      .select('*', { count: 'exact', head: true });

    // 游戏总数
    const { count: gc } = await supabase
      .from('steam_games')
      .select('*', { count: 'exact', head: true });

    // 睡眠平均时长（最近30天）
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data: sleepData } = await supabase
      .from('health_sleep')
      .select('duration_minutes, sleep_type')
      .gte('start_date', thirtyDaysAgo.toISOString())
      .in('sleep_type', ['asleep_core', 'asleep_deep', 'asleep_rem', 'asleep_unspecified']);

    let avgHours = '--';
    if (sleepData && sleepData.length > 0) {
      const totalMin = sleepData.reduce((a, b) => a + (b.duration_minutes || 0), 0);
      const avgMin = Math.round(totalMin / sleepData.length);
      avgHours = `${Math.floor(avgMin / 60)}h${avgMin % 60 ? `${avgMin % 60}m` : ''}`;
    }

    const { data: moodData } = await moodQ.limit(8);
    const { data: sleepData2 } = await supabase
      .from('health_sleep')
      .select('*')
      .order('start_date', { ascending: false })
      .limit(5);

    setEventGroups(groupsWithCount);
    setRecentMoods(moodData || []);
    setRecentSleep(sleepData2 || []);
    setAnimeCount(ac || 0);
    setMusicCount(mc || 0);
    setGameCount(gc || 0);
    setSleepAvg(avgHours);
    setLoading(false);
  };

  const scoreLabel = (s?: number) => s ? MOOD_SCORE_LABELS[s] || '' : '';

  if (loading) return (
    <div style={loadingContainerStyle}>
      <div style={spinnerStyle} />
      <p style={loadingTextStyle}>加载数据...</p>
    </div>
  );

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={withBasePath('/avatar.png')} alt="avatar" width={48} height={48}
            style={{ borderRadius: 14, border: '2px solid ' + C.accent }} />
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.5' }}>
              个人数据中枢
            </h1>
            <p style={{ fontSize: 13, color: C.textSec, margin: '2px 0 0 0' }}>
              Personal Data Hub
            </p>
          </div>
        </div>
        {isLoggedIn && (
          <Link href="/admin" style={{
            padding: '8px 18px', borderRadius: 10, border: '1px solid ' + C.border,
            color: C.accent, fontSize: 13, textDecoration: 'none',
          }}>进入管理 →</Link>
        )}
      </header>

      {/* 数据概览 - 番剧 & 音乐 & 睡眠统计卡片 */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {/* 番剧统计卡片 */}
          <Link href="/anime" style={{ textDecoration: 'none' }}>
            <div style={{
              padding: 16, borderRadius: 14, background: C.surface, border: '1px solid ' + C.border,
              textAlign: 'center', transition: 'all 0.2s', cursor: 'pointer',
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📺</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 4 }}>{animeCount}</div>
              <div style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>部番剧</div>
              <div style={{ fontSize: 11, color: C.accent }}>查看详情 →</div>
            </div>
          </Link>

          {/* 歌单总数统计卡片 */}
          <Link href="/music" style={{ textDecoration: 'none' }}>
            <div style={{
              padding: 16, borderRadius: 14, background: C.surface, border: '1px solid ' + C.border,
              textAlign: 'center', transition: 'all 0.2s', cursor: 'pointer',
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🎵</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 4 }}>{musicCount}</div>
              <div style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>首歌曲</div>
              <div style={{ fontSize: 11, color: C.accent }}>查看详情 →</div>
            </div>
          </Link>

          {/* 游戏统计卡片 */}
          <Link href="/games" style={{ textDecoration: 'none' }}>
            <div style={{
              padding: 16, borderRadius: 14, background: C.surface, border: '1px solid ' + C.border,
              textAlign: 'center', transition: 'all 0.2s', cursor: 'pointer',
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🎮</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 4 }}>{gameCount}</div>
              <div style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>款游戏</div>
              <div style={{ fontSize: 11, color: C.accent }}>查看详情 →</div>
            </div>
          </Link>

          {/* 睡眠数据卡片 */}
          {/*<Link href="/sleep" style={{ textDecoration: 'none' }}>*/}
          {/*  <div style={{*/}
          {/*    padding: 16, borderRadius: 14, background: C.surface, border: '1px solid ' + C.border,*/}
          {/*    textAlign: 'center', transition: 'all 0.2s', cursor: 'pointer',*/}
          {/*  }}>*/}
          {/*    <div style={{ fontSize: 28, marginBottom: 8 }}>😴</div>*/}
          {/*    <div style={{ fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 4 }}>{sleepAvg}h</div>*/}
          {/*    <div style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>平均睡眠</div>*/}
          {/*    <div style={{ fontSize: 11, color: C.accent }}>查看详情 →</div>*/}
          {/*  </div>*/}
          {/*</Link>*/}
        </div>
      </section>

      {/* 事件计数总览 */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: 0 }}>📅 事件计数</h2>
          <Link href="/events" style={{ fontSize: 12, color: C.accent, textDecoration: 'none' }}>查看详情 →</Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {eventGroups.map(g => (
            <Link key={g.id} href="/events" style={{ textDecoration: 'none' }}>
              <div style={{
                padding: 20, borderRadius: 16, background: C.surface, border: '1px solid ' + C.border,
                textAlign: 'center', transition: 'border-color 0.15s',
              }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{g.icon}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: C.text, marginBottom: 4 }}>{g.count || 0}</div>
                <div style={{ fontSize: 12, color: C.textSec }}>{g.name}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 心情动态 */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: 0 }}>🧠 心情动态</h2>
          <Link href="/mood" style={{ fontSize: 12, color: C.accent, textDecoration: 'none' }}>查看全部 →</Link>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recentMoods.length === 0 && <p style={{ textAlign: 'center', color: C.textSec, fontSize: 13, padding: 28 }}>暂无记录</p>}
          {recentMoods.map((m, i) => (
            <div key={m.id || i} style={{
              display: 'flex', gap: 12, padding: '12px 16px', borderRadius: 12,
              background: C.surface, border: '1px solid ' + C.border,
            }}>
              <span style={{ fontSize: 26 }}>{MOOD_EMOJIS[(m.mood_score || 6) - 1]}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <span style={{ fontSize: 13, color: C.text, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {m.note ? (m.note.length > 60 ? m.note.slice(0, 60) + '...' : m.note) : scoreLabel(m.mood_score)}
                  {m.mood_score && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: C.accent }}>{scoreLabel(m.mood_score)}</span>
                  )}
                </span>
                  <span style={{ fontSize: 11, color: C.textSec }}>
                  {new Date(m.created_at).toLocaleDateString('zh-CN')}
                  {m.visibility === 'private' && <span style={{ color: '#fbbf24', marginLeft: 6 }}>🔒</span>}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 最近睡眠 */}
      {recentSleep.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: 0 }}>😴 最近睡眠</h2>
            <Link href="/sleep" style={{ fontSize: 12, color: C.accent, textDecoration: 'none' }}>查看全部 →</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentSleep.map((s, i) => (
              <div key={s.id || i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                borderRadius: 10, background: C.surface, border: '1px solid ' + C.border,
              }}>
                <span style={{ fontSize: 10, color: C.textDead, fontFamily: 'monospace', minWidth: 90 }}>
                  {s.start_date.slice(0, 10)}
                </span>
                <span style={{
                  fontSize: 11, color: s.sleep_type === 'in_bed' ? '#818cf8' : '#6366f1', minWidth: 70,
                }}>
                  {s.sleep_type === 'in_bed' ? '卧床' : s.sleep_type === 'asleep_core' ? '核心' : s.sleep_type === 'asleep_deep' ? '深度' : s.sleep_type === 'asleep_rem' ? 'REM' : '睡眠'}
                </span>
                <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>
                  {s.duration_minutes}分钟
                </span>
                <span style={{ fontSize: 10, color: C.textDead, fontFamily: 'monospace' }}>
                  {new Date(s.start_date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} ~
                  {new Date(s.end_date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer style={{ marginTop: 48, paddingTop: 20, borderTop: '1px solid ' + C.border, textAlign: 'center', fontSize: 12, color: C.textSec }}>
        <p>Powered by DataHub · Built with Next.js + Supabase</p>
      </footer>
    </div>
  );
}
