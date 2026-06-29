'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { MOOD_SCORE_LABELS } from '@/lib/types';

interface MoodLogRow {
  id: string;
  mood: string;
  note: string | null;
  mood_score: number | null;
  visibility: 'public' | 'private';
  created_at: string;
  updated_at: string;
}

export function MoodLogger() {
  const [logs, setLogs] = useState<MoodLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  // Form state
  const [note, setNote] = useState('');
  const [moodScore, setMoodScore] = useState<number>(6);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [customDate, setCustomDate] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fillingGaps, setFillingGaps] = useState(false);

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
    setNote(''); setMoodScore(6);
    setVisibility('public'); setCustomDate(''); setEditingId(null); setMessage(null);
  };

  const handleSave = async () => {
    setLoading(true);
    const hash = getSession() || '';

    try {
      if (editingId) {
        await supabase.rpc('fn_update_mood_log', {
          p_hash: hash,
          p_log_id: editingId,
          p_mood: scoreLabel(moodScore),
          p_note: note || null,
          p_mood_score: moodScore || null,
          p_visibility: visibility,
        });
        setMessage({ text: '✅ 心情记录已更新', type: 'ok' });
      } else {
        await supabase.rpc('fn_save_mood_log', {
          p_hash: hash,
          p_mood: scoreLabel(moodScore),
          p_note: note || null,
          p_mood_score: moodScore || null,
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

  const startEdit = (log: MoodLogRow) => {
    setEditingId(log.id);
    setNote(log.note || '');
    setMoodScore(log.mood_score || 6);
    setVisibility(log.visibility);
    setCustomDate(log.created_at ? new Date(log.created_at).toISOString().slice(0, 16) : '');
    setMessage(null);
  };

  const handleFillGaps = async () => {
    if (!confirm('将自动补全从首条记录到今天之间所有空缺日期（心情7分，"今天是平平无奇的一天"），确定？')) return;
    setFillingGaps(true);
    setMessage(null);
    const hash = getSession() || '';

    try {
      // 1. 获取所有心情记录的日期
      const { data: allLogs } = await supabase
        .from('mood_logs')
        .select('created_at')
        .order('created_at', { ascending: true })
        .limit(5000);

      const existingDates = new Set<string>();
      if (allLogs) {
        for (const row of allLogs) {
          existingDates.add(new Date(row.created_at).toISOString().slice(0, 10));
        }
      }

      // 2. 找首条日期和今天之间的空缺
      const sortedDates = [...existingDates].sort();
      const firstDate = sortedDates[0];
      const today = new Date().toISOString().slice(0, 10);

      if (!firstDate) {
        setMessage({ text: '❌ 没有已有记录，无法补全', type: 'err' });
        setFillingGaps(false);
        return;
      }

      const missing: string[] = [];
      const cursor = new Date(firstDate + 'T00:00:00Z');
      const end = new Date(today + 'T00:00:00Z');

      while (cursor <= end) {
        const dateStr = cursor.toISOString().slice(0, 10);
        if (!existingDates.has(dateStr)) {
          missing.push(dateStr);
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      if (missing.length === 0) {
        setMessage({ text: '✅ 没有空缺日期', type: 'ok' });
        setFillingGaps(false);
        return;
      }

      // 3. 逐条插入
      let done = 0;
      for (const dateStr of missing) {
        await supabase.rpc('fn_save_mood_log', {
          p_hash: hash,
          p_mood: '平平无奇',
          p_note: '今天是平平无奇的一天',
          p_mood_score: 7,
          p_visibility: 'public',
          p_created_at: new Date(dateStr + 'T12:00:00Z').toISOString(),
        });
        done++;
      }

      setMessage({ text: `✅ 已补全 ${done} 天空缺`, type: 'ok' });
      fetchLogs();
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'err' });
    }
    setFillingGaps(false);
  };
  const scoreLabel = (n: number) => MOOD_SCORE_LABELS[n] || n;

  return (
    <div style={styles.card}>
      <h3 style={styles.h3}>🧠 心情记录</h3>

      {/* Form Section */}
      <div style={styles.formSection}>
        <p style={styles.sectionTitle}>{editingId ? '编辑记录' : '添加新记录'}</p>

        {/* 心情评分滑条（1-10） */}
        <div style={styles.sliderGroup}>
          <label style={styles.sliderLabel}>
            心情: {moodScore}/10 — {scoreLabel(moodScore)}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#71717a', flexShrink: 0 }}>很差</span>
            <input type="range" min="1" max="10" value={moodScore}
              onChange={(e) => setMoodScore(Number(e.target.value))}
              style={styles.range} />
            <span style={{ fontSize: 11, color: '#71717a', flexShrink: 0 }}>极佳</span>
          </div>
          {/* 10级刻度标签 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px', marginTop: 2 }}>
            {[1,2,3,4,5,6,7,8,9,10].map(n => (
              <span key={n} onClick={() => setMoodScore(n)}
                style={{
                  fontSize: 9, color: moodScore === n ? '#818cf8' : '#52525b',
                  cursor: 'pointer', fontWeight: moodScore === n ? 700 : 400,
                }}>{n}</span>
            ))}
          </div>
        </div>

        {/* 记录（原"备注/评论"） */}
        <textarea value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="记录..."
          style={styles.textarea} rows={3} />

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ ...styles.sectionTitle, margin: 0 }}>历史记录 ({logs.length})</p>
          <button onClick={handleFillGaps} disabled={fillingGaps} style={{
            padding: '5px 12px', borderRadius: 8, border: '1px solid #2a2a40',
            background: '#121224', color: '#818cf8', fontSize: 12, cursor: fillingGaps ? 'not-allowed' : 'pointer',
            opacity: fillingGaps ? 0.6 : 1,
          }}>
            {fillingGaps ? '补全中...' : '🔧 补全空缺'}
          </button>
        </div>
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
              {log.note && <p style={styles.logNote}>{log.note}</p>}
              <div style={styles.logMeta}>
                <span>{new Date(log.created_at).toLocaleString('zh-CN')}</span>
                {log.mood_score && (
                  <span>🧠 {log.mood_score}/10 {scoreLabel(log.mood_score)}</span>
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
S.input = { padding: '9px 12px', borderRadius: 8, border: '1px solid #2a2a40', background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' };
S.select = S.input;
S.textarea = { padding: '9px 12px', borderRadius: 8, border: '1px solid #2a2a40', background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit', width: '100%' };
S.sliderGroup = { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, marginBottom: 4 };
S.sliderLabel = { fontSize: 12, color: '#a1a1aa' };
S.range = { accentColor: '#6366f1', flex: 1 };
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
S.logNote = { fontSize: 12, color: '#a1a1aa', margin: '0 0 6px', lineHeight: 1.5, whiteSpace: 'pre-wrap' };
S.logMeta = { display: 'flex', gap: 12, fontSize: 11, color: '#52525b', marginBottom: 6, flexWrap: 'wrap' };
S.logActions = { display: 'flex', gap: 8 };
S.editBtn = { padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(99,102,241,0.15)', color: '#818cf8', cursor: 'pointer', fontSize: 11 };
S.delBtn = { padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.15)', color: '#f87171', cursor: 'pointer', fontSize: 11 };
