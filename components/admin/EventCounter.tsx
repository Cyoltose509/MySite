'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import type { EventGroup, EventLog } from '@/lib/types';

export function EventCounter() {
  const [groups, setGroups] = useState<EventGroup[]>([]);
  const [logs, setLogs] = useState<EventLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  // 管理事件组 mode
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupIcon, setNewGroupIcon] = useState('📌');
  const [newGroupColor, setNewGroupColor] = useState('#6366f1');
  const [newGroupPrivate, setNewGroupPrivate] = useState(false);

  // 查看日期范围
  const [viewDate, setViewDate] = useState(() => new Date().toISOString().slice(0, 10));

  // 自定义时间（记录时指定时间）
  const [customTime, setCustomTime] = useState('');

  useEffect(() => { fetchGroups(); fetchLogs(); }, []);
  useEffect(() => { fetchLogs(); }, [viewDate]);

  // 通过 RPC 获取所有事件组（包括隐私的，绕过 RLS）
  const fetchGroups = async () => {
    const hash = getSession();
    if (!hash) { fetchGroupsPublic(); return; }
    const { data, error } = await supabase.rpc('fn_get_event_groups_admin', { p_hash: hash });
    if (error || !data || data.error) {
      // fallback: 直接查（可能看不到隐私组）
      fetchGroupsPublic();
    } else {
      setGroups(data);
    }
  };

  const fetchGroupsPublic = async () => {
    const { data } = await supabase
      .from('event_groups')
      .select('*')
      .order('sort_order', { ascending: true });
    setGroups(data || []);
  };

  // 通过 RPC 获取日志（admin 视角，看到所有包括隐私组的）
  const fetchLogs = async () => {
    const hash = getSession();
    const start = viewDate + 'T00:00:00';
    const end = viewDate + 'T23:59:59';

    if (hash) {
      const { data, error } = await supabase.rpc('fn_get_event_logs_admin', {
        p_hash: hash,
        p_start_date: viewDate,
        p_end_date: viewDate,
      });
      if (!error && data) {
        setLogs(data);
        return;
      }
    }
    // fallback: 直接查
    const { data } = await supabase
      .from('event_logs')
      .select('*, event_groups(name, icon, color, is_private)')
      .gte('event_at', start)
      .lte('event_at', end)
      .order('event_at', { ascending: false });
    setLogs(data || []);
  };

  // 获取某组今日次数
  const getGroupTodayCount = (groupId: string): number => {
    const today = new Date().toISOString().slice(0, 10);
    return logs.filter(l => l.group_id === groupId && l.event_at?.startsWith(today)).length;
  };

  // 记录事件
  const logEvent = async (groupId: string) => {
    setLoading(true);
    try {
      const eventAt = customTime
        ? new Date(viewDate + 'T' + customTime).toISOString()
        : undefined;
      const res = await supabase.rpc('fn_log_event', {
        p_hash: getSession() || '',
        p_group_id: groupId,
        p_event_at: eventAt,
      });
      if (res.data?.error) {
        setMessage({ text: `❌ ${res.data.error}`, type: 'err' });
      } else {
        setMessage({ text: '✅ 已记录', type: 'ok' });
        fetchLogs();
      }
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'err' });
    }
    setLoading(false);
  };

  // 删除某条记录
  const deleteLog = async (logId: string) => {
    if (!confirm('确定删除这条记录？')) return;
    try {
      await supabase.rpc('fn_delete_event_log', {
        p_hash: getSession() || '',
        p_log_id: logId,
      });
      setMessage({ text: '✅ 已删除', type: 'ok' });
      fetchLogs();
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'err' });
    }
  };

  // 添加事件组
  const addGroup = async () => {
    if (!newGroupName) { setMessage({ text: '请输入事件组名称', type: 'err' }); return; }
    setLoading(true);
    try {
      const res = await supabase.rpc('fn_save_event_group', {
        p_hash: getSession() || '',
        p_name: newGroupName,
        p_icon: newGroupIcon,
        p_color: newGroupColor,
        p_is_private: newGroupPrivate,
      });
      if (res.data?.error) {
        setMessage({ text: `❌ ${res.data.error}`, type: 'err' });
      } else {
        setNewGroupName('');
        setNewGroupPrivate(false);
        setMessage({ text: '✅ 事件组已添加', type: 'ok' });
        fetchGroups();
      }
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'err' });
    }
    setLoading(false);
  };

  // 切换事件组隐私状态
  const togglePrivacy = async (group: EventGroup) => {
    try {
      await supabase.rpc('fn_update_event_group', {
        p_hash: getSession() || '',
        p_group_id: group.id!,
        p_is_private: !group.is_private,
      });
      fetchGroups();
    } catch {}
  };

  // 删除事件组
  const deleteGroup = async (id: string) => {
    if (!confirm('确定删除此事件组？相关记录也会被删除。')) return;
    try {
      await supabase.rpc('fn_delete_event_group', {
        p_hash: getSession() || '',
        p_group_id: id,
      });
      fetchGroups();
      fetchLogs();
    } catch {}
  };

  // 近期有记录的日期
  const recentDates = useMemo(() => {
    const set = new Set(logs.map(l => l.event_at?.slice(0, 10)).filter(Boolean));
    return [...set].sort().reverse().slice(0, 30);
  }, [logs]);

  // 今日总次数
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayLogs = logs.filter(l => l.event_at?.startsWith(todayStr));
  const todayTotal = todayLogs.length;

  return (
    <div style={styles.wrap}>
      <h3 style={styles.h3}>📅 事件计数</h3>

      {message && (
        <p style={{ fontSize: 13, color: message.type === 'ok' ? '#4ade80' : '#f87171', margin: '0 0 12px' }}>
          {message.text}
        </p>
      )}

      {/* 事件组管理 */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>事件组</span>
          <button onClick={() => setShowGroupManager(!showGroupManager)}
            style={styles.toggleBtn}>
            {showGroupManager ? '收起' : '管理'}
          </button>
        </div>

        {showGroupManager && (
          <div style={styles.groupManager}>
            {/* 现有组 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {groups.map(g => (
                <div key={g.id} style={{
                  ...styles.groupChip,
                  borderColor: g.color || '#6366f1',
                  opacity: g.is_private ? 0.6 : 1,
                }}>
                  <span>{g.icon} {g.name}</span>
                  <button onClick={() => togglePrivacy(g)} style={styles.privacyBtn}
                    title={g.is_private ? '点击设为公开' : '点击设为隐私'}>
                    {g.is_private ? '🔒' : '🔓'}
                  </button>
                  <button onClick={() => deleteGroup(g.id!)} style={styles.groupDelBtn}>✕</button>
                </div>
              ))}
            </div>
            {/* 添加新组 */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                placeholder="事件组名称" style={{ ...styles.input, width: 140 }} />
              <div style={{ display: 'flex', gap: 4 }}>
                {['🚬', '🧋', '🎤', '🎵', '📌', '💪', '📚', '🎮', '🍜', '☕'].map(ic => (
                  <button key={ic} onClick={() => setNewGroupIcon(ic)}
                    style={{
                      ...styles.iconBtn,
                      ...(newGroupIcon === ic ? { borderColor: '#6366f1', background: 'rgba(99,102,241,0.15)' } : {}),
                    }}>{ic}</button>
                ))}
              </div>
              <input type="color" value={newGroupColor} onChange={e => setNewGroupColor(e.target.value)}
                style={{ width: 32, height: 32, border: 'none', background: 'transparent', cursor: 'pointer' }} />
              <label style={{ fontSize: 12, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={newGroupPrivate} onChange={e => setNewGroupPrivate(e.target.checked)} />
                隐私（不公开）
              </label>
              <button onClick={addGroup} disabled={loading}
                style={{ ...styles.saveBtn, opacity: loading ? 0.6 : 1 }}>添加</button>
            </div>
          </div>
        )}

        {/* 组快速预览 */}
        {!showGroupManager && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {groups.map(g => (
              <div key={g.id} style={{
                ...styles.groupChipStatic,
                background: (g.color || '#6366f1') + '18',
                borderColor: g.color || '#6366f1',
                opacity: g.is_private ? 0.5 : 1,
              }}>
                <span>{g.icon} {g.name}</span>
                {g.is_private && <span style={{ fontSize: 10, color: '#f87171' }}>🔒</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 今日快速记录 */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>
            📆 快速记录（{new Date().toLocaleDateString('zh-CN')}）
            {todayTotal > 0 && <span style={{ color: '#4ade80', marginLeft: 8 }}>已记录 {todayTotal} 次</span>}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          {groups.map(g => {
            const cnt = getGroupTodayCount(g.id!);
            return (
              <div key={g.id} style={{
                ...styles.todayCard,
                borderColor: g.color || '#6366f1',
                opacity: g.is_private ? 0.6 : 1,
              }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{g.icon}</div>
                <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 6 }}>{g.name}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#e4e4e7', marginBottom: 8 }}>{cnt}</div>
                <button onClick={() => logEvent(g.id!)} disabled={loading}
                  style={styles.logBtn}>＋ 记录</button>
              </div>
            );
          })}
        </div>
        {/* 自定义时间 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#a1a1aa' }}>指定时间：</label>
          <input type="time" value={customTime} onChange={e => setCustomTime(e.target.value)}
            style={styles.input} />
          <span style={{ fontSize: 11, color: '#52525b' }}>(留空=当前时间)</span>
        </div>
      </div>

      {/* 日期选择 + 记录列表 */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>📋 记录列表</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <input type="date" value={viewDate}
            onChange={e => setViewDate(e.target.value)}
            style={styles.input} />
          <button onClick={() => setViewDate(new Date().toISOString().slice(0, 10))}
            style={{ ...styles.smallBtn2, background: '#27273d' }}>今天</button>
          <button onClick={() => {
            const d = new Date(viewDate);
            d.setDate(d.getDate() - 1);
            setViewDate(d.toISOString().slice(0, 10));
          }} style={styles.smallBtn2}>← 前一天</button>
          <button onClick={() => {
            const d = new Date(viewDate);
            d.setDate(d.getDate() + 1);
            setViewDate(d.toISOString().slice(0, 10));
          }} style={styles.smallBtn2}>后一天 →</button>
        </div>

        {/* 记录列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
          {logs.length === 0 && (
            <p style={{ textAlign: 'center', color: '#52525b', fontSize: 13, padding: 20 }}>暂无记录</p>
          )}
          {logs.map(l => {
            const g = groups.find(gg => gg.id === l.group_id);
            const time = l.event_at ? new Date(l.event_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
            return (
              <div key={l.id} style={styles.logRow}
                onClick={() => deleteLog(l.id!)}>
                <span style={{ color: g?.color || '#818cf8', fontSize: 18, minWidth: 30 }}>{g?.icon}</span>
                <span style={{ color: '#e4e4e7', fontSize: 14, fontWeight: 500, minWidth: 80 }}>{g?.name}</span>
                <span style={{ color: '#a1a1aa', fontSize: 13, fontFamily: 'monospace' }}>{time}</span>
                <span style={{ color: '#52525b', fontSize: 11, marginLeft: 'auto' }}>
                  {new Date(l.event_at).toLocaleDateString('zh-CN')}
                </span>
                <span style={{ color: '#f87171', fontSize: 11, cursor: 'pointer', marginLeft: 8 }}>点击删除</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 统计概览 */}
      {groups.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionTitle}>📊 统计概览</span>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {groups.map(g => {
              const total = logs.filter(l => l.group_id === g.id).length;
              return (
                <div key={g.id} style={{
                  ...styles.statCard,
                  borderColor: g.color || '#6366f1',
                }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{g.icon}</div>
                  <div style={{ fontSize: 12, color: '#a1a1aa' }}>{g.name}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#e4e4e7', marginTop: 4 }}>{total}</div>
                  <div style={{ fontSize: 11, color: '#52525b' }}>次（当前视图）</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {};
const styles = S;

S.wrap = { background: '#16162a', border: '1px solid #2a2a40', borderRadius: 16, padding: 24 };
S.h3 = { fontSize: 16, fontWeight: 600, color: '#e4e4e7', margin: 0, marginBottom: 20 };
S.section = { marginBottom: 24 };
S.sectionHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 };
S.sectionTitle = { fontSize: 13, fontWeight: 600, color: '#d4d4d8' };
S.toggleBtn = { padding: '4px 12px', borderRadius: 6, border: '1px solid #2a2a40', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 12 };
S.input = { padding: '8px 10px', borderRadius: 8, border: '1px solid #2a2a40', background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none' };
S.iconBtn = { width: 30, height: 30, borderRadius: 6, border: '1px solid #2a2a40', background: 'transparent', fontSize: 14, cursor: 'pointer' };
S.saveBtn = { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
S.groupManager = { padding: '12px', borderRadius: 10, background: '#121224', marginBottom: 12 };
S.groupChip = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid', fontSize: 13, color: '#e4e4e7' };
S.groupChipStatic = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid', fontSize: 13, color: '#e4e4e7' };
S.groupDelBtn = { background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12, padding: '0 4px' };
S.privacyBtn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '0 4px' };
S.todayCard = {
  flex: '1 1 140px', maxWidth: 180, padding: '16px', borderRadius: 12,
  border: '1px solid', background: '#121224', textAlign: 'center',
};
S.logBtn = {
  padding: '6px 16px', borderRadius: 8, border: '1px solid #2a2a40',
  background: '#1a1a2e', color: '#818cf8', fontSize: 13, cursor: 'pointer',
  fontWeight: 600,
};
S.smallBtn2 = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid #2a2a40',
  background: '#121224', color: '#a1a1aa', fontSize: 12, cursor: 'pointer',
};
S.logRow = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px',
  borderRadius: 8, background: '#121224', fontSize: 13,
  transition: 'background 0.15s', cursor: 'pointer',
};
S.statCard = {
  flex: '1 1 120px', maxWidth: 160, padding: '16px', borderRadius: 12,
  border: '1px solid', background: '#121224', textAlign: 'center',
};
