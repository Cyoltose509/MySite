'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { PRESET_MOODS } from '@/lib/types';

interface MoodRecord {
  id: string;
  mood: string;
  comment: string;
  singability?: number;
  likability?: number;
  visibility: 'public' | 'private';
  created_at: string;
  updated_at: string;
}

export function MoodLogger() {
  const [logs, setLogs] = useState<MoodRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  // Form state
  const [mood, setMood] = useState('');
  const [comment, setComment] = useState('');
  const [singability, setSingability] = useState(5);
  const [likability, setLikability] = useState(5);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [customDate, setCustomDate] = useState('');
  // Edit mode
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { fetchLogs(); }, []);

  const fetchLogs = async () => {
    const { data } = await supabase
      .from('mood_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    setLogs(data || []);
  };

  const resetForm = () => {
    setMood(''); setComment(''); setSingability(3); setLikability(3);
    setVisibility('public'); setCustomDate(''); setEditingId(null); setMessage(null);
  };

  const handleSave = async () => {
    if (!mood) { setMessage({ text: '请选择或输入心情', type: 'err' }); return; }

    setLoading(true);
    const hash = getSession() || '';

    try {
      if (editingId) {
        await supabase.rpc('fn_update_mood_log', {
          p_hash: hash,
          p_log_id: editingId,
          p_mood: mood,
          p_comment: comment || null,
          p_singability: singability || null,
          p_likability: likability || null,
          p_visibility: visibility,
        });
        setMessage({ text: '✅ 心情记录已更新', type: 'ok' });
      } else {
        await supabase.rpc('fn_save_mood_log', {
          p_hash: hash,
          p_mood: mood,
          p_comment: comment || null,
          p_singability: singability || null,
          p_likability: likability || null,
          p_visibility: visibility,
          p_created_at: customDate ? new Date(customDate).toISOString() : null,
        });
        setMessage({ text: '✅ 心情记录已保存', type: 'ok' });
      }
      resetForm();
      fetchLogs();
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'err' });
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这条心情记录？')) return;
    try {
      const hash = getSession() || '';
      await supabase.rpc('fn_delete_mood_log', { p_hash: hash, p_log_id: id });
      fetchLogs();
      if (editingId === id) resetForm();
    } catch {}
  };

  const startEdit = (log: MoodRecord) => {
    setEditingId(log.id);
    setMood(log.mood);
    setComment(log.comment || '');
    setSingability(log.singability || 5);
    setLikability(log.likability || 5);
    setVisibility(log.visibility);
    setCustomDate(log.created_at ? new Date(log.created_at).toISOString().slice(0, 16) : '');
    setMessage(null);
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.h3}>🧠 心情记录</h3>

      {/* Form Section */}
      <div style={styles.formSection}>
        <p style={styles.sectionTitle}>{editingId ? '编辑记录' : '添加新记录'}</p>

        {/* Preset moods */}
        <div style={styles.presetRow}>
          {PRESET_MOODS.map((m) => (
            <button key={m} onClick={() => setMood(m)} style={{
              ...styles.presetBtn, ...(mood === m ? styles.presetActive : {}),
            }}>{m.split(' ')[0]}</button>
          ))}
        </div>

        {/* Custom mood input */}
        <input value={mood} onChange={(e) => setMood(e.target.value)}
          placeholder="自定义心情..." style={styles.input} />

        {/* Comment */}
        <textarea value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder="备注 / 评论..."
          style={styles.textarea} rows={3} />

        {/* Sliders */}
        <div style={styles.slidersRow}>
          <div style={styles.sliderGroup}>
            <label style={styles.sliderLabel}>🎤 能唱度: {singability}/10</label>
            <input type="range" min="1" max="10" value={singability}
              onChange={(e) => setSingability(Number(e.target.value))} style={styles.range} />
          </div>
          <div style={styles.sliderGroup}>
            <label style={styles.sliderLabel}>❤️ 喜欢度: {likability}/10</label>
            <input type="range" min="1" max="10" value={likability}
              onChange={(e) => setLikability(Number(e.target.value))} style={styles.range} />
          </div>
        </div>

        {/* Date & Visibility */}
        <div style={styles.row}>
          <input type="datetime-local" value={customDate} onChange={(e) => setCustomDate(e.target.value)}
            style={{...styles.input, flex: 1}} placeholder="自定义时间 (可选)" />
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as any)} style={{...styles.select, flex: 0.5}}>
            <option value="public">🌐 公开</option>
            <option value="private">🔒 私密</option>
          </select>
        </div>

        {/* Action Buttons */}
        <div style={styles.actionRow}>
          <button onClick={handleSave} disabled={loading}
            style={{...styles.saveBtn, opacity: loading ? 0.6 : 1}}>
            {loading ? '保存中...' : (editingId ? '更新记录' : '保存记录')}
          </button>
          {editingId && (
            <button onClick={resetForm} style={styles.cancelBtn}>取消编辑</button>
          )}
        </div>

        {message && <p style={{...styles.msg, color: message.type === 'ok' ? '#4ade80' : '#f87171'}}>{message.text}</p>}
      </div>

      {/* List Section */}
      <div style={styles.listSection}>
        <p style={styles.sectionTitle}>历史记录 ({logs.length})</p>
        {logs.length === 0 && <p style={styles.emptyText}>暂无记录</p>}
        <div style={styles.logList}>
          {logs.map((log) => (
            <div key={log.id} style={{
              ...styles.logItem,
              borderLeftColor: log.visibility === 'private' ? '#f59e0b' : '#6366f1',
            }}>
              <div style={styles.logHeader}>
                <span style={styles.logMood}>{log.mood}</span>
                <span style={{
                  ...styles.logVisBadge,
                  background: log.visibility === 'private' ? 'rgba(245,158,11,0.15)' : 'rgba(99,102,241,0.15)',
                  color: log.visibility === 'private' ? '#fbbf24' : '#818cf8',
                }}>
                  {log.visibility === 'private' ? '私密' : '公开'}
                </span>
              </div>
              {log.comment && <p style={styles.logComment}>{log.comment}</p>}
              <div style={styles.logMeta}>
                <span>{new Date(log.created_at).toLocaleString('zh-CN')}</span>
                {(log.singability || log.likability) && (
                  <>
                    {log.singability && <span>🎤{log.singability}</span>}
                    {log.likability && <span>❤️{log.likability}</span>}
                  </>
                )}
              </div>
              <div style={styles.logActions}>
                <button onClick={() => startEdit(log)} style={styles.editBtn}>编辑</button>
                <button onClick={() => handleDelete(log.id)} style={styles.delBtn}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {};
const styles = S;

S.card = { background: '#16162a', border: '1px solid #2a2a40', borderRadius: 16, padding: 24 };
S.h3 = { fontSize: 16, fontWeight: 600, color: '#e4e4e7', margin: 0, marginBottom: 20 };
S.formSection = { marginBottom: 24 };
S.sectionTitle = { fontSize: 13, fontWeight: 600, color: '#d4d4d8', margin: '0 0 10px' };
S.presetRow = { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 };
S.presetBtn = {
  width: 42, height: 42, borderRadius: 10, border: '1px solid #2a2a40',
  background: 'transparent', fontSize: 18, cursor: 'pointer',
};
S.presetActive = { borderColor: '#6366f1', background: 'rgba(99,102,241,0.15)' };
S.input = { padding: '9px 12px', borderRadius: 8, border: '1px solid #2a2a40', background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none' };
S.select = S.input;
S.textarea = { padding: '9px 12px', borderRadius: 8, border: '1px solid #2a2a40', background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit' };
S.slidersRow = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 };
S.sliderGroup = { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 };
S.sliderLabel = { fontSize: 12, color: '#a1a1aa' };
S.range = { accentColor: '#6366f1' };
S.row = { display: 'flex', gap: 8, marginTop: 4 };
S.actionRow = { display: 'flex', gap: 10, marginTop: 12 };
S.saveBtn = { flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
S.cancelBtn = { padding: '10px 16px', borderRadius: 10, border: '1px solid #2a2a40', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 13 };
S.msg = { fontSize: 13, margin: '8px 0 0', minHeight: 18 };
S.listSection = {};
S.emptyText = { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 16 };
S.logList = { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' };
S.logItem = {
  padding: '12px 14px', borderRadius: 10, background: '#121224',
  borderLeft: '3px solid transparent', transition: 'background 0.15s',
};
S.logHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 };
S.logMood = { fontSize: 15, fontWeight: 600, color: '#e4e4e7' };
S.logVisBadge = { fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 500 };
S.logComment = { fontSize: 12, color: '#a1a1aa', margin: '0 0 6px', lineHeight: 1.5 };
S.logMeta = { display: 'flex', gap: 12, fontSize: 11, color: '#52525b', marginBottom: 6 };
S.logActions = { display: 'flex', gap: 8 };
S.editBtn = { padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(99,102,241,0.15)', color: '#818cf8', cursor: 'pointer', fontSize: 11 };
S.delBtn = { padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.15)', color: '#f87171', cursor: 'pointer', fontSize: 11 };
