'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { TagInput } from '@/components/admin/TagInput';
import {
  C, cardGridStyle, cardStyle, cardContentStyle,
  cardTitleStyle, cardDurationStyle,
  badgeStyle, tagChipStyle, tagMoreStyle, emptyStyle,
  searchInputStyle,
} from '@/lib/card-styles';

interface GameRecord {
  id: string; steam_app_id: number; title: string;
  playtime_forever: number; is_manual: boolean;
  store_url?: string; custom_cover?: string;
}

interface GameTag { id?: string; game_id: string; tag: string; rating?: string; note?: string; }

const RATINGS = ['夯', '顶级', '人上人', 'NPC', '拉完了'];
const RC: Record<string, string> = { '夯': '#a855f7', '顶级': '#4ade80', '人上人': '#eab308', 'NPC': '#6b7280', '拉完了': '#f87171' };
const PRESET_GAME_TAGS = ['RPG', 'FPS', '动作', '冒险', '策略', '模拟', '独立', '休闲', '恐怖', '肉鸽', '开放世界', '多人', '像素', '剧情'];

export function SteamGameEditor() {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<string, GameTag[]>>({});
  const [blacklist, setBlacklist] = useState<{ id: string; steam_app_id: number; title: string }[]>([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'games' | 'blacklist' | 'add'>('games');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<GameRecord | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [rating, setRating] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addCover, setAddCover] = useState('');

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    const [{ data: g }, { data: t }, { data: bl }] = await Promise.all([
      supabase.from('steam_games').select('*').order('playtime_forever', { ascending: false }),
      supabase.from('steam_tags').select('*'),
      supabase.from('steam_blacklist').select('*').order('created_at', { ascending: false }),
    ]);
    setGames(g || []);
    if (t) { const m: Record<string, GameTag[]> = {}; t.forEach((x: any) => { if (!m[x.game_id]) m[x.game_id] = []; m[x.game_id].push(x); }); setTagsMap(m); }
    setBlacklist(bl || []);
  };

  const customTagsAll = useMemo(() => {
    const s = new Set<string>();
    Object.values(tagsMap).flat().forEach(t => { if (!PRESET_GAME_TAGS.includes(t.tag)) s.add(t.tag); });
    return [...s].sort();
  }, [tagsMap]);

  const sorted = useMemo(() => {
    const q = search.toLowerCase();
    return search.trim() ? games.filter(g => g.title.toLowerCase().includes(q)) : games;
  }, [games, search]);

  const handleSelect = (g: GameRecord) => {
    setSelectedId(g.id); setSelectedGame(g);
    const tags = tagsMap[g.id] || [];
    setSelectedTags(tags.map(t => t.tag));
    setRating(tags[0]?.rating || '');
    setNote(tags[0]?.note || '');
  };

  const handleSave = async () => {
    if (!selectedId || selectedTags.length === 0) return;
    const hash = getSession(); if (!hash) return;
    setSaving(true);
    const { error } = await supabase.rpc('fn_save_steam_tag', {
      p_hash: hash, p_game_id: selectedId, p_tags: selectedTags,
      p_rating: rating || null, p_note: note || null,
    });
    setSaving(false);
    if (error) { setMsg('❌ 保存失败'); } else { setMsg('✅ 已保存'); fetchData(); }
    setTimeout(() => setMsg(''), 2000);
  };

  const handleBlacklist = async (g: GameRecord) => {
    if (!g.steam_app_id) { setMsg('❌ 无法识别的游戏'); return; }
    try {
      const { error } = await supabase.rpc('fn_blacklist_steam', {
        p_steam_app_id: g.steam_app_id, p_title: g.title,
      });
      if (error) { setMsg('❌ ' + error.message); return; }
      setSelectedId(null);
      setSelectedGame(null);
      setMsg('✅ 已加入黑名单');
      setTimeout(() => setMsg(''), 1500);
      fetchData();
    } catch (e: any) {
      setMsg('❌ ' + (e.message || '操作失败'));
    }
  };
  const handleUnblacklist = async (id: string) => {
    await supabase.from('steam_blacklist').delete().eq('id', id);
    fetchData();
  };
  const handleDelete = async (g: GameRecord) => {
    if (!confirm(`删除 ${g.title}？`)) return;
    await supabase.from('steam_games').delete().eq('id', g.id);
    fetchData();
  };
  const handleAdd = async () => {
    if (!addTitle.trim()) return;
    const { error } = await supabase.from('steam_games').insert({
      steam_app_id: 0, title: addTitle.trim(), playtime_forever: 0, is_manual: true,
      store_url: addUrl.trim() || null, custom_cover: addCover.trim() || null,
    });
    if (error) { setMsg('❌ ' + error.message); } else { setMsg('✅ 已添加'); setAddTitle(''); setAddUrl(''); setAddCover(''); fetchData(); }
    setTimeout(() => setMsg(''), 2000);
  };

  const fmtPlaytime = (min: number) => min < 60 ? `${min}m` : `${Math.round(min / 60)}h`;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['games', 'blacklist', 'add'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: '8px 16px', borderRadius: 10, border: '1px solid ' + (view === v ? C.accent : '#27273d'),
            background: view === v ? C.accent : 'transparent', color: view === v ? '#fff' : C.textDim, fontSize: 13, cursor: 'pointer',
          }}>{{ games: '🎮 游戏', blacklist: '🚫 黑名单', add: '➕ 添加' }[v]}</button>
        ))}
      </div>

      {view === 'games' && (<>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜索游戏..." style={searchInputStyle} />
        {sorted.length === 0 ? <p style={emptyStyle}>没有匹配的游戏</p> : (
          <div style={{ ...cardGridStyle, marginTop: 12 }}>
            {sorted.map(g => {
              const tags = tagsMap[g.id] || [];
              const hasTags = tags.length > 0;
              return (
                <div key={g.id} onClick={() => handleSelect(g)} style={{
                  ...cardStyle, cursor: 'pointer', position: 'relative',
                  border: selectedId === g.id ? '1px solid ' + C.accent : '1px solid rgba(255,255,255,0.16)',
                  background: selectedId === g.id ? 'rgba(99,102,241,0.1)' : undefined,
                  boxShadow: selectedId === g.id ? '0 0 12px rgba(99,102,241,0.15)' : undefined,
                  opacity: hasTags && selectedId !== g.id ? 0.7 : 1,
                }}>
                  <div style={cardContentStyle}>
                    <div style={{ ...cardTitleStyle(hasTags), marginBottom: 2 }}>{g.title}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: '#52525b' }}>{fmtPlaytime(g.playtime_forever)}</span>
                      {g.is_manual && <span style={{ fontSize: 10, color: C.accent }}>手动</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                      {tags[0]?.rating && <span style={{ ...badgeStyle(RC[tags[0].rating]), fontWeight: 700, fontSize: 10 }}>{tags[0].rating}</span>}
                    </div>
                    {tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {tags.slice(0, 5).map(t => <span key={t.id} style={tagChipStyle}>{t.tag}</span>)}
                        {tags.length > 5 && <span style={tagMoreStyle}>+{tags.length - 5}</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>)}

      {view === 'blacklist' && (
        <div>
          <p style={{ fontSize: 12, color: '#52525b', marginBottom: 12 }}>黑名单中的游戏不在 /games 显示，同步时也会跳过</p>
          {blacklist.length === 0 ? <p style={emptyStyle}>黑名单为空</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {blacklist.map(b => (
                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', background: '#121224', borderRadius: 10, border: '1px solid #27273d' }}>
                  <span style={{ fontSize: 13, color: C.text }}>{b.title}</span>
                  <button onClick={() => handleUnblacklist(b.id)}
                    style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid #2a4a2a', background: 'transparent', color: '#4ade80', fontSize: 12, cursor: 'pointer' }}>取消</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'add' && (
        <div style={{ maxWidth: 500 }}>
          <div style={{ marginBottom: 12 }}><label style={lbl}>游戏名 *</label>
            <input value={addTitle} onChange={e => setAddTitle(e.target.value)} placeholder="例如：Hollow Knight" style={iS} /></div>
          <div style={{ marginBottom: 12 }}><label style={lbl}>商店链接 (可选)</label>
            <input value={addUrl} onChange={e => setAddUrl(e.target.value)} placeholder="https://..." style={iS} /></div>
          <div style={{ marginBottom: 16 }}><label style={lbl}>封面图链接 (可选)</label>
            <input value={addCover} onChange={e => setAddCover(e.target.value)} placeholder="https://..." style={iS} /></div>
          <button onClick={handleAdd}
            style={{ padding: '8px 20px', borderRadius: 10, border: 'none', background: C.accent, color: '#fff', fontSize: 14, cursor: 'pointer' }}>
            ➕ 添加游戏</button>
          {msg && <p style={{ marginTop: 8, fontSize: 12, color: msg.includes('✅') ? '#4ade80' : '#f87171' }}>{msg}</p>}
        </div>
      )}

      {selectedGame && (
        <div style={{ position: 'fixed', top: 0, right: 0, width: 420, maxWidth: '90vw', height: '100vh',
          background: C.bg, borderLeft: '1px solid rgba(255,255,255,0.08)', padding: 20, overflowY: 'auto',
          zIndex: 100, boxShadow: '-4px 0 24px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 14, color: C.text, fontWeight: 600 }}>✏️ {selectedGame.title}</h4>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => handleBlacklist(selectedGame)}
                style={actBtn('#3b1818', '#f87171')}>🚫 黑名单</button>
              <button onClick={() => { const g = selectedGame; setSelectedGame(null); setSelectedId(null); handleDelete(g); }}
                style={actBtn('#3b1010', '#f87171')}>🗑 删除</button>
              <button onClick={() => { setSelectedId(null); setSelectedGame(null); }}
                style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: '#52525b', marginBottom: 6 }}>评级</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {RATINGS.map(r => (
                <button key={r} onClick={() => setRating(r)} style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid ' + (rating === r ? RC[r] : '#27273d'),
                  background: rating === r ? RC[r] : 'transparent', color: rating === r ? '#fff' : C.textDim,
                  fontSize: 12, cursor: 'pointer', fontWeight: 600,
                }}>{r}</button>
              ))}
            </div>
          </div>

          <TagInput selectedTags={selectedTags} onTagsChange={setSelectedTags}
            presetTags={PRESET_GAME_TAGS} customTagsAll={customTagsAll} />

          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: '#52525b', marginBottom: 6 }}>笔记</p>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="可选..."
              style={{ width: '100%', height: 60, background: '#121224', border: '1px solid #27273d', borderRadius: 8,
                padding: 8, color: C.text, fontSize: 12, resize: 'vertical' }} />
          </div>
          <button onClick={handleSave} disabled={saving}
            style={{ width: '100%', padding: 10, borderRadius: 10, border: 'none', background: C.accent, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? '保存中...' : '💾 保存'}</button>
          {msg && <p style={{ textAlign: 'center', fontSize: 12, marginTop: 8, color: msg.includes('✅') ? '#4ade80' : '#f87171' }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: '#52525b', marginBottom: 4 };
const iS: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid #27273d', background: '#121224', color: '#fff', fontSize: 13, width: '100%' };
const actBtn = (bg: string, c: string): React.CSSProperties => ({ padding: '4px 12px', borderRadius: 8, border: '1px solid ' + bg, background: 'transparent', color: c, fontSize: 12, cursor: 'pointer' });
