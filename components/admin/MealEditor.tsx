'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import {
  C, cardGridStyle, cardStyle, cardContentStyle, cardTitleStyle,
  badgeStyle, tagChipStyle, tagMoreStyle, emptyStyle, searchInputStyle,
} from '@/lib/card-styles';

interface MealRecord { id: string; title: string; cover_url?: string; rating: string; }
interface MealTag { id?: string; meal_id: string; tag: string; note?: string; }

const RATINGS = ['夯', '顶级', '人上人', 'NPC', '拉完了'];
const RC: Record<string, string> = { '夯': '#a855f7', '顶级': '#4ade80', '人上人': '#eab308', 'NPC': '#6b7280', '拉完了': '#f87171' };
const PRESET_TAGS = ['中餐', '日料', '韩餐', '西餐', '火锅', '烧烤', '甜品', '面食', '自助', '小龙虾', '早茶', '东北菜', '湘菜', '川菜', '粤菜', '海鲜', '炸鸡', '螺蛳粉', '沙拉', '咖啡'];

export function MealEditor() {
  const [meals, setMeals] = useState<MealRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedNote, setSelectedNote] = useState('');
  const [selectedRating, setSelectedRating] = useState('NPC');
  const [tagInput, setTagInput] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editCover, setEditCover] = useState('');

  // New meal form
  const [newTitle, setNewTitle] = useState('');
  const [newCover, setNewCover] = useState('');
  const [newRating, setNewRating] = useState('NPC');
  const [view, setView] = useState<'meals' | 'add'>('meals');

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    const { data } = await supabase.from('meals').select('*').order('created_at');
    setMeals(data || []);
  };

  const handleSelect = async (m: MealRecord) => {
    setSelectedId(m.id);
    setSelectedRating(m.rating || 'NPC');
    setEditTitle(m.title);
    setEditCover(m.cover_url || '');
    setSelectedNote('');
    setSelectedTags([]);
    setMsg('');

    const { data: tags } = await supabase.from('meal_tags').select('*').eq('meal_id', m.id);
    if (tags && tags.length > 0) {
      setSelectedTags(tags.map(t => t.tag));
      setSelectedNote(tags[0].note || '');
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    const hash = getSession(); if (!hash) return;
    setSaving(true);
    try {
      await supabase.from('meals').update({
        rating: selectedRating,
        title: editTitle.trim(),
        cover_url: editCover.trim() || null,
      }).eq('id', selectedId);

      await supabase.from('meal_tags').delete().eq('meal_id', selectedId);
      if (selectedTags.length > 0) {
        for (const tag of selectedTags) {
          await supabase.from('meal_tags').insert({ meal_id: selectedId, tag, note: selectedNote });
        }
      }
      setMsg('✅ 已保存');
      fetchData();
    } catch (e: any) { setMsg('❌ ' + e.message); }
    setSaving(false);
    setTimeout(() => setMsg(''), 2500);
  };

  const handleDelete = async () => {
    if (!selectedId || !confirm('确定删除？')) return;
    await supabase.from('meals').delete().eq('id', selectedId);
    await supabase.from('meal_tags').delete().eq('meal_id', selectedId);
    setSelectedId(null);
    fetchData();
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    const hash = getSession(); if (!hash) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('meals').insert({
        title: newTitle.trim(), cover_url: newCover.trim() || null, rating: newRating,
      });
      if (error) throw error;
      setNewTitle(''); setNewCover(''); setView('meals');
      setMsg('✅ 已创建');
      fetchData();
    } catch (e: any) { setMsg('❌ ' + e.message); }
    setSaving(false);
    setTimeout(() => setMsg(''), 2500);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const addCustomTag = () => {
    const v = tagInput.trim();
    if (!v) return;
    if (!selectedTags.includes(v)) setSelectedTags(prev => [...prev, v]);
    setTagInput('');
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return meals;
    const q = search.toLowerCase();
    return meals.filter(m => m.title.toLowerCase().includes(q));
  }, [meals, search]);

  const selected = meals.find(m => m.id === selectedId);

  // Inline styles
  const actBtn = (bg: string, color: string): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 8, border: `1px solid ${color}40`, background: bg, color,
    fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
  });

  return (
    <div>
      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[{ v: 'meals', label: '🍽️ 美食' }, { v: 'add', label: '➕ 添加' }].map(t => (
          <button key={t.v} onClick={() => setView(t.v as any)} style={{
            padding: '6px 16px', borderRadius: 20, border: '1px solid ' + (view === t.v ? C.accent : '#27273d'),
            background: view === t.v ? C.accent : 'transparent', color: view === t.v ? '#fff' : C.textDim,
            fontSize: 13, cursor: 'pointer', fontWeight: 600,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Meals grid */}
      {view === 'meals' && (
        <>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索美食..."
            style={searchInputStyle} />

          <div style={{ ...cardGridStyle, marginTop: 12 }}>
            {filtered.length === 0 && <p style={emptyStyle}>暂无美食</p>}
            {filtered.map(m => {
              const tags = m.id === null ? [] : [];
              const isSelected = m.id === selectedId;
              return (
                <article key={m.id} onClick={() => handleSelect(m)} style={{
                  ...cardStyle, cursor: 'pointer',
                  ...(isSelected ? { borderColor: C.accent, background: 'rgba(99,102,241,0.08)', boxShadow: '0 0 12px rgba(99,102,241,0.15)' } : {}),
                }}>
                  {m.cover_url && (
                    <div style={{ position: 'absolute', inset: 0, zIndex: 0,
                      backgroundImage: `url(${m.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center',
                      filter: 'brightness(0.5)',
                    }} />
                  )}
                  <div style={cardContentStyle}>
                    <p style={cardTitleStyle(false)}>{m.title}</p>
                    <span style={{ ...badgeStyle(RC[m.rating] || '#71717a'), fontWeight: 700 }}>{m.rating}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {/* Add form */}
      {view === 'add' && (
        <div style={{ maxWidth: 500 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 12, color: C.textDim }}>名称</label>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="美食名称" style={iS} />
            <label style={{ fontSize: 12, color: C.textDim }}>封面URL（可选）</label>
            <input value={newCover} onChange={e => setNewCover(e.target.value)} placeholder="https://..." style={iS} />
            <label style={{ fontSize: 12, color: C.textDim }}>评级</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {RATINGS.map(r => (
                <button key={r} onClick={() => setNewRating(r)} style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid ' + (newRating === r ? RC[r] : '#27273d'),
                  background: newRating === r ? RC[r] : 'transparent', color: newRating === r ? '#fff' : C.textDim,
                  fontSize: 12, cursor: 'pointer', fontWeight: 600,
                }}>{r}</button>
              ))}
            </div>
            <button onClick={handleCreate} disabled={saving} style={{
              padding: '8px 0', borderRadius: 10, border: 'none', background: C.accent, color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%', opacity: saving ? 0.6 : 1,
            }}>➕ 添加美食</button>
            {msg && <div style={{ fontSize: 12, color: msg.startsWith('✅') ? '#4ade80' : '#f87171', textAlign: 'center' }}>{msg}</div>}
          </div>
        </div>
      )}

      {/* Edit panel */}
      {selected && (
        <div style={{
          position: 'fixed', top: 0, right: 0, width: 420, maxWidth: '90vw', height: '100vh',
          background: C.bg, borderLeft: '1px solid #1e1e32', zIndex: 100, overflowY: 'auto',
          padding: '20px 24px', boxShadow: '-8px 0 24px rgba(0,0,0,.6)',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                style={{ ...iS, fontSize: 14, fontWeight: 600, width: '100%', marginBottom: 6 }} />
              <input value={editCover} onChange={e => setEditCover(e.target.value)}
                placeholder="封面URL" style={{ ...iS, fontSize: 11, width: '100%', marginBottom: 4 }} />
            </div>
            <button onClick={() => { setSelectedId(null); }} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={handleDelete} style={actBtn('#3b1010', '#f87171')}>🗑 删除</button>
          </div>

          {/* Rating */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>评级</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {RATINGS.map(r => (
                <button key={r} onClick={() => setSelectedRating(r)} style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid ' + (selectedRating === r ? RC[r] : '#27273d'),
                  background: selectedRating === r ? RC[r] : 'transparent', color: selectedRating === r ? '#fff' : C.textDim,
                  fontSize: 12, cursor: 'pointer', fontWeight: 600,
                }}>{r}</button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>标签</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {PRESET_TAGS.map(tag => (
                <button key={tag} onClick={() => toggleTag(tag)} style={{
                  padding: '4px 10px', borderRadius: 14, border: '1px solid ' + (selectedTags.includes(tag) ? C.accent : '#27273d'),
                  background: selectedTags.includes(tag) ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: selectedTags.includes(tag) ? '#818cf8' : C.textDim, fontSize: 11, cursor: 'pointer',
                }}>{tag}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCustomTag(); }}
                placeholder="自定义标签" style={{ ...iS, width: 140 }} />
              <button onClick={addCustomTag} style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid #27273d',
                background: 'transparent', color: C.textDim, fontSize: 11, cursor: 'pointer',
              }}>添加</button>
            </div>
          </div>

          {/* Note */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>备注</p>
            <textarea value={selectedNote} onChange={e => setSelectedNote(e.target.value)}
              placeholder="写点感想..."
              style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: C.surface, color: C.text, fontSize: 13, outline: 'none', resize: 'vertical', minHeight: 60, boxSizing: 'border-box' }}
              rows={3} />
          </div>

          {/* Save */}
          <button onClick={handleSave} disabled={saving} style={{
            width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
            background: C.accent, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            opacity: saving ? 0.6 : 1,
          }}>{saving ? '保存中...' : '💾 保存'}</button>
          {msg && (
            <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: msg.startsWith('✅') ? '#4ade80' : '#f87171' }}>{msg}</div>
          )}
        </div>
      )}
    </div>
  );
}

const iS: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid #27273d', background: '#121224',
  color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
