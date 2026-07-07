'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import type { EventGroup, EventLog } from '@/lib/types';

const PAGE_SIZE = 30;

export function EventCounter() {
  const [groups, setGroups] = useState<EventGroup[]>([]);
  const [allLogs, setAllLogs] = useState<EventLog[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  // 管理事件组
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupIcon, setNewGroupIcon] = useState('📌');
  const [newGroupColor, setNewGroupColor] = useState('#6366f1');
  const [newGroupPrivate, setNewGroupPrivate] = useState(false);

  // 记录事件
  const [recordDate, setRecordDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [recordTime, setRecordTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  });
  // song refs for karaoke
  const [songSearch, setSongSearch] = useState('');
  const [songList, setSongList] = useState<{id:string;title:string;artist:string[]}[]>([]);
  const [selectedRefs, setSelectedRefs] = useState<{id:string;title:string}[]>([]);
  const [showSongPicker, setShowSongPicker] = useState<string | null>(null); // group id when picking
  const [editLogId, setEditLogId] = useState<string | null>(null); // log id when editing existing

  useEffect(() => {
    fetchGroups();
    fetchAllLogs();
    loadSongs();
  }, []);

  const loadSongs = async () => {
    const {data} = await supabase.from('music_list').select('id,title,artist').order('title').limit(500);
    setSongList(data || []);
  };

  const fetchGroups = async () => {
    const hash = getSession();
    if (hash) {
      const { data, error } = await supabase.rpc('fn_get_event_groups_admin', { p_hash: hash });
      if (!error && data && !data.error) {
        setGroups(data);
        return;
      }
    }
    const { data } = await supabase.from('event_groups').select('*').order('sort_order', { ascending: true });
    setGroups(data || []);
  };

  const fetchAllLogs = async () => {
    setLoading(true);
    const hash = getSession();
    if (hash) {
      const { data, error } = await supabase.rpc('fn_get_event_logs_admin', {
        p_hash: hash,
        p_start_date: null,
        p_end_date: null,
      });
      if (!error && data) {
        setAllLogs(data || []);
        setLoading(false);
        return;
      }
    }
    // fallback: 直接查
    const { data } = await supabase
      .from('event_logs')
      .select('*, event_groups(name, icon, color, is_private)')
      .order('event_at', { ascending: false })
      .limit(1000);
    setAllLogs(data || []);
    setLoading(false);
  };

  // ─── 每组总计数 ───
  const groupCounts = useMemo(() => {
    const map: Record<string, number> = {};
    allLogs.forEach(l => { map[l.group_id] = (map[l.group_id] || 0) + 1; });
    return map;
  }, [allLogs]);

  const totalEvents = allLogs.length;

  // ─── 记录事件 ───
  const logEvent = async (groupId: string, refs?: {id:string;title:string}[]) => {
    setLoading(true);
    try {
      const eventAt = new Date(`${recordDate}T${recordTime}:00`).toISOString();
      const p_refs = refs || [];
      const { data, error } = await supabase.rpc('fn_log_event', {
        p_hash: getSession() || '',
        p_group_id: groupId,
        p_event_at: eventAt,
        p_refs: p_refs.length > 0 ? p_refs : null,
      });
      if (error) {
        setMessage({ text: `❌ 记录失败: ${error.message}`, type: 'err' });
      } else if (data?.error) {
        setMessage({ text: `❌ ${data.error}`, type: 'err' });
      } else {
        setMessage({ text: '✅ 已记录', type: 'ok' });
        setSelectedRefs([]);
        fetchAllLogs();
      }
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'err' });
    }
    setLoading(false);
  };

  // ─── 更新已有事件 ───
  const updateLogRefs = async (logId: string, refs: {id:string;title:string}[], groupId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase.from('event_logs').update({ refs: refs.length > 0 ? refs : null }).eq('id', logId);
      if (error) {
        setMessage({ text: `❌ 更新失败: ${error.message}`, type: 'err' });
      } else {
        setMessage({ text: '✅ 已更新', type: 'ok' });
        setSelectedRefs([]);
        setEditLogId(null);
        setShowSongPicker(null);
        fetchAllLogs();
      }
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'err' });
    }
    setLoading(false);
  };

  // ─── 删除事件 ───
  const deleteLog = async (logId: string) => {
    if (!confirm('确定删除这条记录？')) return;
    try {
      const { data, error } = await supabase.rpc('fn_delete_event_log', {
        p_hash: getSession() || '',
        p_log_id: logId,
      });
      if (error) setMessage({ text: `❌ ${error.message}`, type: 'err' });
      else if (data?.error) setMessage({ text: `❌ ${data.error}`, type: 'err' });
      else {
        setMessage({ text: '✅ 已删除', type: 'ok' });
        fetchAllLogs();
      }
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'err' });
    }
  };

  // ─── 事件组管理 ───
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
    } catch (e: any) { setMessage({ text: `❌ ${e.message}`, type: 'err' }); }
    setLoading(false);
  };

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

  const deleteGroup = async (id: string) => {
    if (!confirm('确定删除此事件组？相关记录也会被删除。')) return;
    try {
      await supabase.rpc('fn_delete_event_group', {
        p_hash: getSession() || '',
        p_group_id: id,
      });
      fetchGroups();
      fetchAllLogs();
    } catch {}
  };

  // ─── 分页 ───
  const totalPages = Math.ceil(allLogs.length / PAGE_SIZE);
  const pagedLogs = allLogs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div style={styles.wrap}>
      <h3 style={styles.h3}>📅 事件计数</h3>

      {message && (
        <p style={{ fontSize: 13, color: message.type === 'ok' ? '#4ade80' : '#f87171', margin: '0 0 12px', wordBreak: 'break-all' }}>
          {message.text}
        </p>
      )}

      {/* 统计卡片 */}
      <div style={{ ...styles.section, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {groups.map(g => (
            <div key={g.id} style={{ ...styles.statCard, borderColor: g.color || '#6366f1' }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{g.icon}</div>
              <div style={{ fontSize: 12, color: '#a1a1aa' }}>{g.name}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#e4e4e7', marginTop: 4 }}>
                {groupCounts[g.id!] || 0}
              </div>
              <div style={{ fontSize: 11, color: '#52525b' }}>次</div>
            </div>
          ))}
        </div>
      </div>

      {/* 快速记录 */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>➕ 快速记录</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <input type="date" value={recordDate} onChange={e => setRecordDate(e.target.value)}
            style={styles.input} />
          <input type="time" value={recordTime} onChange={e => setRecordTime(e.target.value)}
            style={styles.input} />
          <span style={{ fontSize: 11, color: '#52525b' }}>选择日期和时间后点击下方卡片</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {groups.map(g => {
            const isKaraoke = g.name === '唱k' || g.name === '户外唱歌';
            return (
            <button key={g.id} onClick={() => {
              if (isKaraoke) { setShowSongPicker(g.id!); setSelectedRefs([]); setSongSearch(''); }
              else logEvent(g.id!);
            }} disabled={loading} style={{
              ...styles.recordBtn,
              borderColor: g.color || '#6366f1',
              opacity: loading ? 0.5 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}>
              <span style={{ fontSize: 24 }}>{g.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{g.name}</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#818cf8', marginTop: 2 }}>＋</span>
            </button>
          )})}
        </div>
      </div>

      {/* Song picker modal for karaoke */}
      {showSongPicker && (
        <div style={{ ...styles.section, background: '#0a0a18', border: '1px solid #2a2a40' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <span style={{ fontSize:13, fontWeight:600, color:'#e4e4e7' }}>
              {editLogId ? '✏️ 编辑歌曲' : '🎵 选择歌曲（可选）'}
            </span>
            <button onClick={() => { setShowSongPicker(null); setEditLogId(null); setSelectedRefs([]); }}
              style={{...styles.cancelBtn, padding:'4px 12px'}}>✕</button>
          </div>
          {selectedRefs.map(s => (
            <span key={s.id} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',margin:'0 4px 4px 0',
              borderRadius:6,background:'rgba(99,102,241,0.15)',color:'#818cf8',fontSize:11}}>
              {s.title}
              <button onClick={() => setSelectedRefs(prev => prev.filter(x => x.id !== s.id))}
                style={{background:'none',border:'none',color:'#818cf8',cursor:'pointer',padding:0,fontSize:10}}>✕</button>
            </span>
          ))}
          <div style={{display:'flex',gap:6,marginTop:6}}>
            <input value={songSearch} onChange={e => setSongSearch(e.target.value)} placeholder="搜索歌曲..."
              style={styles.input} />
            <button onClick={() => {
              if (editLogId) {
                updateLogRefs(editLogId, selectedRefs, showSongPicker);
              } else {
                logEvent(showSongPicker, selectedRefs);
                setShowSongPicker(null);
              }
            }} style={{...styles.saveBtn, width: editLogId ? 'auto' : 80, padding: editLogId ? '6px 14px' : undefined}}>
              {editLogId ? `保存(${selectedRefs.length})` : `记录${selectedRefs.length>0?`(${selectedRefs.length})`:''}`}
            </button>
            {!editLogId && (
              <button onClick={() => {
                logEvent(showSongPicker);
                setShowSongPicker(null);
              }} style={{...styles.saveBtn, background:'#52525b', width:60}}>跳过</button>
            )}
          </div>
          {songSearch && (
            <div style={{maxHeight:200,overflow:'auto',marginTop:8}}>
              {songList.filter(s => s.title.toLowerCase().includes(songSearch.toLowerCase()) && !selectedRefs.find(r => r.id === s.id)).slice(0,20).map(s => (
                <div key={s.id} onClick={() => setSelectedRefs(prev => [...prev, {id:s.id,title:s.title}])}
                  style={{padding:'5px 8px',cursor:'pointer',fontSize:12,color:'#a1a1aa',borderRadius:4,borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                  {s.title} — {(s.artist||[]).join('/')}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 事件组管理 */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>⚙️ 事件组管理</span>
          <button onClick={() => setShowGroupManager(!showGroupManager)} style={styles.toggleBtn}>
            {showGroupManager ? '收起' : '展开'}
          </button>
        </div>

        {showGroupManager && (
          <div style={styles.groupManager}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {groups.map(g => (
                <div key={g.id} style={{ ...styles.groupChip, borderColor: g.color || '#6366f1', opacity: g.is_private ? 0.6 : 1 }}>
                  <span>{g.icon} {g.name}</span>
                  <button onClick={() => togglePrivacy(g)} style={styles.privacyBtn}
                    title={g.is_private ? '设为公开' : '设为隐私'}>
                    {g.is_private ? '🔒' : '🔓'}
                  </button>
                  <button onClick={() => deleteGroup(g.id!)} style={styles.groupDelBtn}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                placeholder="事件组名称" style={{ ...styles.input, width: 140 }} />
              <div style={{ display: 'flex', gap: 4 }}>
                {['🚬', '🧋', '🎤', '🎵', '📌', '💪', '📚', '🎮', '🍜', '☕'].map(ic => (
                  <button key={ic} onClick={() => setNewGroupIcon(ic)} style={{
                    ...styles.iconBtn,
                    ...(newGroupIcon === ic ? { borderColor: '#6366f1', background: 'rgba(99,102,241,0.15)' } : {}),
                  }}>{ic}</button>
                ))}
                <input value={newGroupIcon} onChange={e => setNewGroupIcon(e.target.value)}
                  style={{ ...styles.input, width: 48, padding: '4px 6px', fontSize: 14, textAlign: 'center' }}
                  title="自定义 emoji" />
              </div>
              <input type="color" value={newGroupColor} onChange={e => setNewGroupColor(e.target.value)}
                style={{ width: 32, height: 32, border: 'none', background: 'transparent', cursor: 'pointer' }} />
              <label style={{ fontSize: 12, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={newGroupPrivate} onChange={e => setNewGroupPrivate(e.target.checked)} />
                隐私
              </label>
              <button onClick={addGroup} disabled={loading}
                style={{ ...styles.saveBtn, opacity: loading ? 0.6 : 1 }}>添加</button>
            </div>
          </div>
        )}
      </div>

      {/* 全部记录列表（分页） */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>📋 全部记录（{totalEvents} 条）</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {pagedLogs.length === 0 && (
            <p style={{ textAlign: 'center', color: '#52525b', fontSize: 13, padding: 20 }}>暂无记录</p>
          )}
          {pagedLogs.map(l => {
            const g = groups.find(gg => gg.id === l.group_id);
            const songs = l.refs || [];
            const isKaraoke = g && (g.name === '唱k' || g.name === '户外唱歌');
            return (
              <div key={l.id} style={styles.logRow}>
                <span style={{ color: g?.color || '#818cf8', fontSize: 18, minWidth: 30 }}>{g?.icon}</span>
                <span style={{ color: '#e4e4e7', fontSize: 14, fontWeight: 500, minWidth: 80 }}>{g?.name}</span>
                <span style={{ color: '#a1a1aa', fontSize: 12, fontFamily: 'monospace', minWidth: 120 }}>
                  {l.event_at ? new Date(l.event_at).toLocaleDateString('zh-CN') + ' ' +
                    new Date(l.event_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
                {songs.length > 0 ? (
                  <span style={{ color: '#818cf8', fontSize: 11, flex: 1 }}>
                    {songs.map(s => s.title).join(' / ')}
                  </span>
                ) : isKaraoke ? (
                  <span style={{ color: '#52525b', fontSize: 11, flex: 1 }}>未记录歌曲</span>
                ) : null}
                {isKaraoke && (
                  <button onClick={(ev) => { ev.stopPropagation(); setEditLogId(l.id!); setShowSongPicker(l.group_id); setSelectedRefs(songs); setSongSearch(''); }}
                    style={{ background:'rgba(99,102,241,0.15)', border:'none', color:'#818cf8', fontSize: 11, cursor:'pointer', padding:'2px 8px', borderRadius: 4 }}>
                    ✏️ 编辑歌曲
                  </button>
                )}
                <span onClick={() => deleteLog(l.id!)} style={{ color: '#f87171', fontSize: 11, cursor: 'pointer', marginLeft: 'auto' }}>点此删除</span>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              style={{ ...styles.pageBtn, opacity: page === 0 ? 0.4 : 1 }}>← 上一页</button>
            <span style={{ color: '#a1a1aa', fontSize: 12 }}>
              {page + 1} / {totalPages}
            </span>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
              style={{ ...styles.pageBtn, opacity: page >= totalPages - 1 ? 0.4 : 1 }}>下一页 →</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───
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
S.groupDelBtn = { background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12, padding: '0 4px' };
S.privacyBtn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '0 4px' };
S.statCard = {
  flex: '1 1 120px', maxWidth: 160, padding: '16px', borderRadius: 12,
  border: '1px solid', background: '#121224', textAlign: 'center',
};
S.recordBtn = {
  padding: '12px 20px', borderRadius: 12, border: '2px solid',
  background: '#121224', color: '#e4e4e7', cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s',
};
S.logRow = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px',
  borderRadius: 8, background: '#121224', cursor: 'pointer',
};
S.pageBtn = {
  padding: '6px 14px', borderRadius: 8, border: '1px solid #2a2a40',
  background: '#121224', color: '#a1a1aa', cursor: 'pointer', fontSize: 12,
};
