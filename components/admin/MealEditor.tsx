'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { C, searchInputStyle } from '@/lib/card-styles';

interface MealRecord { id: string; title: string; rating: string; }
interface MealTag { id?: string; meal_id: string; tag: string; note?: string; }

const RATINGS = ['夯', '顶级', '人上人', 'NPC', '拉完了'];
const RC: Record<string, string> = { '夯': '#a855f7', '顶级': '#4ade80', '人上人': '#eab308', 'NPC': '#6b7280', '拉完了': '#f87171' };
const PRESET_TAGS = ['中餐', '日料', '韩餐', '西餐', '火锅', '烧烤', '甜品', '自助',  '东北菜', '湘菜', '川菜', '粤菜', '海鲜', '蒸锅','烤肉','菌类','披萨','刺身','生腌','东南亚'];

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

  // New meal
  const [newTitle, setNewTitle] = useState('');
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
      await supabase.from('meals').update({ rating: selectedRating, title: editTitle.trim() }).eq('id', selectedId);
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
      const { error } = await supabase.from('meals').insert({ title: newTitle.trim(), rating: newRating });
      if (error) throw error;
      setNewTitle(''); setView('meals');
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
    const v = tagInput.trim(); if (!v) return;
    if (!selectedTags.includes(v)) setSelectedTags(prev => [...prev, v]);
    setTagInput('');
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return meals;
    const q = search.toLowerCase();
    return meals.filter(m => m.title.toLowerCase().includes(q));
  }, [meals, search]);

  const selected = meals.find(m => m.id === selectedId);

  const actBtn = (bg: string, color: string): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 8, border: `1px solid ${color}40`, background: bg, color,
    fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
  });

  const iS: React.CSSProperties = {
    padding: '8px 12px', borderRadius: 8, border: '1px solid #27273d', background: '#121224',
    color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };

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

      {/* Meals list */}
      {view === 'meals' && (
        <>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索美食..." style={searchInputStyle} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {filtered.map(m => {
              const isSel = m.id === selectedId;
              return (
                <div key={m.id} onClick={() => handleSelect(m)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                  borderRadius: 10, background: isSel ? 'rgba(99,102,241,0.1)' : '#121224',
                  border: `1px solid ${isSel ? C.accent : '#2a2a40'}`, cursor: 'pointer',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.text, flex: 1 }}>{m.title}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: RC[m.rating] || C.textDim }}>{m.rating}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Add form */}
      {view === 'add' && (
        <div style={{ maxWidth: 400 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 12, color: C.textDim }}>名称</label>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="美食名称" style={iS} />
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
              style={{ ...iS, fontSize: 16, fontWeight: 600, width: '100%' }} />
            <button onClick={() => setSelectedId(null)} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18, marginLeft: 8 }}>✕</button>
          </div>

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
            {/* Selected tags display */}
            {selectedTags.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {selectedTags.map(tag => (
                  <span key={tag} onClick={() => toggleTag(tag)} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px',
                    borderRadius: 14, background: 'rgba(99,102,241,0.15)', color: '#818cf8',
                    fontSize: 11, cursor: 'pointer',
                  }}>{tag} ×</span>
                ))}
              </div>
            )}
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

          <button onClick={handleSave} disabled={saving} style={{
            width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
            background: C.accent, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            opacity: saving ? 0.6 : 1,
          }}>{saving ? '保存中...' : '💾 保存'}</button>
          {msg && <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: msg.startsWith('✅') ? '#4ade80' : '#f87171' }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
