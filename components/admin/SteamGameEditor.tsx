'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import {
  C, cardGridStyle, cardStyle, cardContentStyle,
  cardTitleStyle, cardArtistStyle, cardDurationStyle,
  badgeStyle, tagChipStyle, emptyStyle,
  filterRowStyle, countBadgeStyle,
  searchInputStyle, loadingContainerStyle, spinnerStyle, loadingTextStyle,
} from '@/lib/card-styles';

interface GameRecord {
  id: string;
  title: string;
  playtime_forever: number;
}

interface GameTag {
  id?: string;
  game_id: string;
  tag: string;
  rating?: string;
  note?: string;
}

const RATINGS = ['夯', '顶级', '人上人', 'NPC', '拉完了'];
const RATING_COLORS: Record<string, string> = { '夯': '#a855f7', '顶级': '#4ade80', '人上人': '#eab308', 'NPC': '#6b7280', '拉完了': '#f87171' };

const PRESET_GAME_TAGS = ['RPG', 'FPS', '动作', '冒险', '策略', '模拟', '独立', '休闲', '恐怖', '肉鸽', '开放世界', '多人', '像素', '剧情'];

export function SteamGameEditor() {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<string, GameTag[]>>({});
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<GameRecord | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [rating, setRating] = useState('');
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    const { data: g } = await supabase.from('steam_games').select('id,title,playtime_forever').order('playtime_forever', { ascending: false });
    setGames(g || []);
    const { data: t } = await supabase.from('steam_tags').select('*');
    if (t) {
      const map: Record<string, GameTag[]> = {};
      t.forEach((x: any) => { if (!map[x.game_id]) map[x.game_id] = []; map[x.game_id].push(x); });
      setTagsMap(map);
    }
  };

  const sorted = useMemo(() => {
    const q = search.toLowerCase();
    return search.trim()
      ? games.filter(g => g.title.toLowerCase().includes(q))
      : games;
  }, [games, search]);

  const handleSelect = (g: GameRecord) => {
    setSelectedId(g.id);
    setSelectedGame(g);
    const tags = tagsMap[g.id] || [];
    setSelectedTags(tags.map(t => t.tag));
    setRating(tags[0]?.rating || '');
    setNote(tags[0]?.note || '');
    setEditingId(tags[0]?.id || null);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleSave = async () => {
    if (!selectedId || selectedTags.length === 0) return;
    const hash = getSession();
    if (!hash) return;
    setSaving(true);
    const { error } = await supabase.rpc('fn_save_steam_tag', {
      p_hash: hash,
      p_game_id: selectedId,
      p_tags: selectedTags,
      p_rating: rating || null,
      p_note: note || null,
    });
    setSaving(false);
    if (error) { setMsg('❌ 保存失败'); } else { setMsg('✅ 已保存'); fetchData(); }
    setTimeout(() => setMsg(''), 2000);
  };

  const fmtPlaytime = (min: number) => {
    if (min < 60) return `${min}m`;
    return `${Math.round(min / 60)}h`;
  };

  return (
    <div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜索游戏..." style={searchInputStyle} />

      {sorted.length === 0 ? <p style={emptyStyle}>没有匹配的游戏</p> : (
        <div style={{ ...cardGridStyle, marginTop: 12 }}>
          {sorted.map(g => {
            const tags = tagsMap[g.id] || [];
            const hasTags = tags.length > 0;
            return (
              <div key={g.id} onClick={() => handleSelect(g)} style={{
                ...cardStyle, border: '1px solid rgba(255,255,255,0.16)',
                ...(selectedId === g.id ? { borderColor: C.accent, background: 'rgba(99,102,241,0.1)', boxShadow: '0 0 12px rgba(99,102,241,0.15)' } : {}),
                ...(hasTags && selectedId !== g.id ? { opacity: 0.7 } : {}),
                position: 'relative',
              }}>
                <div style={cardContentStyle}>
                  <div style={cardTitleStyle(hasTags)}>{g.title}</div>
                  <div style={cardDurationStyle}>🕐 {fmtPlaytime(g.playtime_forever)}</div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {tags[0]?.rating && <span style={{ ...badgeStyle(RATING_COLORS[tags[0].rating]), fontWeight: 700 }}>{tags[0].rating}</span>}
                  </div>
                  {tags.length > 0 && (
                    <div style={{ marginTop: 4, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {tags.slice(0, 5).map(t => <span key={t.id} style={tagChipStyle}>{t.tag}</span>)}
                      {tags.length > 5 && <span style={{ fontSize: 10, color: '#71717a' }}>+{tags.length - 5}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Panel */}
      {selectedGame && (
        <div style={{ position: 'fixed', top: 0, right: 0, width: 420, maxWidth: '90vw', height: '100vh',
          background: C.bg, borderLeft: '1px solid rgba(255,255,255,0.08)', padding: 20, overflowY: 'auto',
          zIndex: 100, boxShadow: '-4px 0 24px rgba(0,0,0,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 14, color: C.text, fontWeight: 600 }}>✏️ {selectedGame.title}</h4>
            <button onClick={() => { setSelectedId(null); setSelectedGame(null); }}
              style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>

          {/* Rating */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: '#52525b', marginBottom: 6 }}>评级</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {RATINGS.map(r => (
                <button key={r} onClick={() => setRating(r)}
                  style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid ' + (rating === r ? RATING_COLORS[r] : '#27273d'),
                    background: rating === r ? RATING_COLORS[r] : 'transparent', color: rating === r ? '#fff' : C.textDim,
                    fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>{r}</button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: '#52525b', marginBottom: 6 }}>标签</p>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {PRESET_GAME_TAGS.map(t => (
                <button key={t} onClick={() => toggleTag(t)}
                  style={{ padding: '4px 10px', borderRadius: 14, border: '1px solid ' + (selectedTags.includes(t) ? C.accent : '#27273d'),
                    background: selectedTags.includes(t) ? C.accent : 'transparent', color: selectedTags.includes(t) ? '#fff' : C.textDim,
                    fontSize: 11, cursor: 'pointer' }}>{t}</button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: '#52525b', marginBottom: 6 }}>笔记</p>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="可选..."
              style={{ width: '100%', height: 60, background: '#121224', border: '1px solid #27273d', borderRadius: 8,
                padding: 8, color: C.text, fontSize: 12, resize: 'vertical' }} />
          </div>

          <button onClick={handleSave} disabled={saving}
            style={{ width: '100%', padding: 10, borderRadius: 10, border: 'none', background: C.accent,
              color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? '保存中...' : '💾 保存'}
          </button>
          {msg && <p style={{ textAlign: 'center', fontSize: 12, marginTop: 8, color: msg.includes('✅') ? '#4ade80' : '#f87171' }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
