'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';

export function MoodLogger() {
  const [mood, setMood] = useState('');
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const presetMoods = ['😊', '😄', '😐', '😢', '😞', '🔥', '😌', '💪'];

  const handleSave = async () => {
    if (!mood) {
      setMessage('请输入心情');
      return;
    }

    setLoading(true);
    const passwordHash = getSession() || '';

    const { data, error } = await supabase.rpc('fn_save_mood_log', {
      p_hash: passwordHash,
      p_mood: mood,
      p_text: text || null,
      p_visibility: visibility,
    });

    if (error || (data && data.error)) {
      setMessage(`❌ 保存失败: ${error?.message || data?.error}`);
    } else {
      setMessage('✅ 心情记录已保存');
      setMood('');
      setText('');
    }
    setLoading(false);
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.h3}>🧠 心情记录</h3>

      <div style={styles.form}>
        <div style={styles.presetRow}>
          {presetMoods.map((m) => (
            <button
              key={m}
              onClick={() => setMood(m)}
              style={
                mood === m
                  ? { ...styles.presetBtn, ...styles.presetActive }
                  : styles.presetBtn
              }
            >
              {m}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          placeholder="心情 (自定义或选择上方预设)"
          style={styles.input}
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="备注 (可选)"
          style={styles.textarea}
          rows={3}
        />

        <div style={styles.visibilityRow}>
          <label style={styles.label}>
            <input
              type="radio"
              name="visibility"
              checked={visibility === 'public'}
              onChange={() => setVisibility('public')}
            />
            <span style={styles.radioLabel}>公开</span>
          </label>
          <label style={styles.label}>
            <input
              type="radio"
              name="visibility"
              checked={visibility === 'private'}
              onChange={() => setVisibility('private')}
            />
            <span style={styles.radioLabel}>私密</span>
          </label>
        </div>

        <button
          onClick={handleSave}
          disabled={loading}
          style={styles.btn}
        >
          {loading ? '保存中...' : '保存记录'}
        </button>

        {message && <p style={styles.message}>{message}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: 24,
  },
  h3: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--color-text)',
    margin: 0,
    marginBottom: 16,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  presetRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  presetBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'transparent',
    fontSize: 18,
    cursor: 'pointer',
  },
  presetActive: {
    background: 'var(--color-accent)',
    borderColor: 'var(--color-accent)',
  },
  input: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: 13,
    outline: 'none',
  },
  textarea: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: 13,
    outline: 'none',
    resize: 'vertical' as const,
    fontFamily: 'inherit',
  },
  visibilityRow: {
    display: 'flex',
    gap: 16,
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
  },
  radioLabel: {
    fontSize: 13,
    color: 'var(--color-text)',
  },
  btn: {
    padding: '10px 0',
    borderRadius: 8,
    border: 'none',
    background: 'var(--color-accent)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  message: {
    fontSize: 13,
    margin: 0,
    color: 'var(--color-text)',
  },
};
