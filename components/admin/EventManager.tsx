'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { EVENT_TYPES, type EventItem } from '@/lib/types';

export function EventManager() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  // Form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [eventType, setEventType] = useState('life');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [icon, setIcon] = useState('📌');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { fetchEvents(); }, []);

  const fetchEvents = async () => {
    // Admin sees all events (public + private)
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('event_date', { ascending: false })
      .limit(100);
    setEvents(data || []);
  };

  const resetForm = () => {
    setTitle(''); setDescription(''); setEventType('life');
    setVisibility('public'); setIcon('📌'); setEditingId(null);
    setEventDate(new Date().toISOString().slice(0, 10)); setMessage(null);
  };

  const handleSave = async () => {
    if (!title || !eventDate) { setMessage({ text: '标题和日期必填', type: 'err' }); return; }

    setLoading(true);
    const hash = getSession() || '';

    try {
      if (editingId) {
        await supabase.rpc('fn_update_event', {
          p_hash: hash,
          p_event_id: editingId,
          p_title: title,
          p_description: description || null,
          p_event_date: eventDate,
          p_event_type: eventType,
          p_visibility: visibility,
          p_icon: icon,
        });
        setMessage({ text: '✅ 事件已更新', type: 'ok' });
      } else {
        await supabase.rpc('fn_save_event', {
          p_hash: hash,
          p_title: title,
          p_description: description || null,
          p_event_date: eventDate,
          p_event_type: eventType,
          p_visibility: visibility,
          p_icon: icon,
        });
        setMessage({ text: '✅ 事件已保存', type: 'ok' });
      }
      resetForm();
      fetchEvents();
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'err' });
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此事件？')) return;
    try {
      const hash = getSession() || '';
      await supabase.rpc('fn_delete_event', { p_hash: hash, p_event_id: id });
      fetchEvents();
      if (editingId === id) resetForm();
    } catch {}
  };

  const startEdit = (ev: EventItem) => {
    setEditingId(ev.id!);
    setTitle(ev.title);
    setDescription(ev.description || '');
    setEventDate(ev.event_date);
    setEventType(ev.event_type || 'life');
    setVisibility(ev.visibility || 'public');
    setIcon(ev.icon || '📌');
    setMessage(null);
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.h3}>📅 事件管理</h3>

      {/* Form */}
      <div style={styles.formSection}>
        <p style={styles.sectionTitle}>{editingId ? '编辑事件' : '添加新事件'}</p>

        <input value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="事件标题 *" style={styles.input} />

        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="事件描述..."
          style={styles.textarea} rows={2} />

        {/* Date + Type Row */}
        <div style={styles.row}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>日期 *</label>
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} style={styles.input} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>类型</label>
            <select value={eventType} onChange={(e) => setEventType(e.target.value)} style={styles.select}>
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Icon + Visibility Row */}
        <div style={styles.row}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>图标</label>
            <div style={styles.iconGrid}>
              {['🎉', '💼', '🏠', '✈️', '🎯', '🎂', '📚', '🏆', '💻', '❤️', '🔥', '⭐'].map((emoji) => (
                <button key={emoji} onClick={() => setIcon(emoji)}
                  style={{
                    ...styles.iconBtn, ...(icon === emoji ? styles.iconActive : {}),
                  }}>{emoji}</button>
              ))}
            </div>
          </div>
          <div style={{ flex: 0.5 }}>
            <label style={styles.label}>可见性</label>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as any)} style={styles.select}>
              <option value="public">🌐 公开</option>
              <option value="private">🔒 私密</option>
            </select>
          </div>
        </div>

        <div style={styles.actionRow}>
          <button onClick={handleSave} disabled={loading}
            style={{...styles.saveBtn, opacity: loading ? 0.6 : 1}}>
            {loading ? '保存中...' : (editingId ? '更新事件' : '保存事件')}
          </button>
          {editingId && <button onClick={resetForm} style={styles.cancelBtn}>取消</button>}
        </div>

        {message && <p style={{...styles.msg, color: message.type === 'ok' ? '#4ade80' : '#f87171'}}>{message.text}</p>}
      </div>

      {/* List */}
      <div style={styles.listSection}>
        <p style={styles.sectionTitle}>事件列表 ({events.length})</p>
        {events.length === 0 && <p style={styles.emptyText}>暂无事件</p>}

        <div style={styles.eventList}>
          {events.map((ev) => {
            const typeInfo = EVENT_TYPES.find(t => t.value === ev.event_type);
            return (
              <div key={ev.id} style={{
                ...styles.eventItem,
                borderLeftColor: ev.visibility === 'private' ? '#f59e0b' : '#6366f1',
              }}>
                <div style={styles.eventHeader}>
                  <span style={styles.eventIcon}>{ev.icon || '📌'}</span>
                  <div style={styles.eventTitleWrap}>
                    <span style={styles.eventTitle}>{ev.title}</span>
                    <span style={{
                      ...styles.visBadge,
                      background: ev.visibility === 'private' ? 'rgba(245,158,11,0.15)' : 'rgba(99,102,241,0.15)',
                      color: ev.visibility === 'private' ? '#fbbf24' : '#818cf8',
                    }}>{ev.visibility === 'private' ? '私密' : '公开'}
                    </span>
                  </div>
                </div>
                {ev.description && <p style={styles.eventDesc}>{ev.description}</p>}
                <div style={styles.eventMeta}>
                  <span>{typeInfo?.label || ev.event_type}</span>
                  <span>{new Date(ev.event_date).toLocaleDateString('zh-CN')}</span>
                </div>
                <div style={styles.actions}>
                  <button onClick={() => startEdit(ev)} style={styles.editBtn}>编辑</button>
                  <button onClick={() => handleDelete(ev.id!)} style={styles.delBtn}>删除</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {};
const styles = S;

S.card = { background: '#16162a', border: '1px solid #2a2a40', borderRadius: 16, padding: 24 };
S.h3 = { fontSize: 16, fontWeight: 600, color: '#e4e4e7', margin: 0, marginBottom: 20 };
S.formSection = { marginBottom: 20 };
S.sectionTitle = { fontSize: 13, fontWeight: 600, color: '#d4d4d8', margin: '0 0 10px' };
S.input = { padding: '9px 12px', borderRadius: 8, border: '1px solid #2a2a40', background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' };
S.select = S.input;
S.textarea = { padding: '9px 12px', borderRadius: 8, border: '1px solid #2a2a40', background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit', width: '100%' };
S.row = { display: 'flex', gap: 10 };
S.label = { display: 'block', fontSize: 11, color: '#71717a', marginBottom: 4, marginTop: 8 };
S.iconGrid = { display: 'flex', gap: 6, flexWrap: 'wrap' };
S.iconBtn = { width: 34, height: 34, borderRadius: 8, border: '1px solid #2a2a40', background: 'transparent', fontSize: 16, cursor: 'pointer' };
S.iconActive = { borderColor: '#6366f1', background: 'rgba(99,102,241,0.15)' };
S.actionRow = { display: 'flex', gap: 10, marginTop: 14 };
S.saveBtn = { flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
S.cancelBtn = { padding: '10px 16px', borderRadius: 10, border: '1px solid #2a2a40', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 13 };
S.msg = { fontSize: 13, margin: '8px 0 0', minHeight: 18 };
S.listSection = {};
S.emptyText = { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 16 };
S.eventList = { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 350, overflowY: 'auto' };
S.eventItem = { padding: '12px 14px', borderRadius: 10, background: '#121224', borderLeft: '3px solid transparent' };
S.eventHeader = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 };
S.eventIcon = { fontSize: 22 };
S.eventTitleWrap = { display: 'flex', alignItems: 'center', gap: 8, flex: 1 };
S.eventTitle = { fontSize: 14, fontWeight: 600, color: '#e4e4e7' };
S.visBadge = { fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 500 };
S.eventDesc = { fontSize: 12, color: '#a1a1aa', margin: '0 0 6px', lineHeight: 1.5 };
S.eventMeta = { display: 'flex', gap: 12, fontSize: 11, color: '#52525b', marginBottom: 6 };
S.actions = { display: 'flex', gap: 8 };
S.editBtn = { padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(99,102,241,0.15)', color: '#818cf8', cursor: 'pointer', fontSize: 11 };
S.delBtn = { padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.15)', color: '#f87171', cursor: 'pointer', fontSize: 11 };
