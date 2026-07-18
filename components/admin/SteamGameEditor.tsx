'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { getAnimeList } from '@/lib/anime-data';
import { getQuickSearchIndex } from '@/lib/search';
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
  metrics?: Record<string, string>;
}

interface GameTag { id?: string; game_id: string; tag: string; rating?: string; note?: string; }

const RATINGS = ['夯', '顶级', '人上人', 'NPC', '拉完了'];
const RATING_ORDER: Record<string, number> = { '夯': 0, '顶级': 1, '人上人': 2, 'NPC': 3, '拉完了': 4 };
const RC: Record<string, string> = { '夯': '#a855f7', '顶级': '#4ade80', '人上人': '#eab308', 'NPC': '#6b7280', '拉完了': '#f87171' };
const PRESET_GAME_TAGS = ['RPG', 'FPS', '动作', '冒险', '策略', '模拟', '独立', '休闲', '恐怖', '肉鸽', '开放世界', '多人', '像素', '剧情'];
const METRIC_PRESETS = [
  { key: 'playtime', label: '🕐 游玩时长', desc: '分钟' },
  { key: 'achievements', label: '🏆 成就', desc: '已获得/总数' },
  { key: 'characters', label: '👤 角色', desc: '已获得角色数' },
  { key: 'clears', label: '🔄 通关', desc: '通关次数' },
] as const;

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
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const [newMetricKey, setNewMetricKey] = useState('');
  const [newMetricVal, setNewMetricVal] = useState('');
  const [newMetricCustomKey, setNewMetricCustomKey] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editStoreUrl, setEditStoreUrl] = useState('');
  const [editCustomCover, setEditCustomCover] = useState('');
  // entity refs
  const [refsAnime, setRefsAnime] = useState<string[]>([]);
  const [refsMusic, setRefsMusic] = useState<{id:string;title:string}[]>([]);
  const [refAnimeSearch, setRefAnimeSearch] = useState('');
  const [refMusicSearch, setRefMusicSearch] = useState('');
  const [animeList, setAnimeList] = useState<string[]>([]);
  const [musicListRef, setMusicListRef] = useState<{id:string;title:string}[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addCover, setAddCover] = useState('');

  useEffect(() => { fetchData(); loadRefLists(); }, []);

  const loadRefLists = async () => {
    try { const ad = await getAnimeList(); setAnimeList(ad.map((a:any) => a.title)); } catch {}
    const { data: ml } = await supabase.from('music_list').select('id,title').order('title');
    setMusicListRef(ml || []);
  };

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
    let list = search.trim() ? games.filter(g => g.title.toLowerCase().includes(q)) : games;
    return list.sort((a, b) => {
      const ta = tagsMap[a.id]?.[0];
      const tb = tagsMap[b.id]?.[0];
      const oa = RATING_ORDER[ta?.rating || ''] ?? 99;
      const ob = RATING_ORDER[tb?.rating || ''] ?? 99;
      if (oa !== ob) return oa - ob;
      return a.title.localeCompare(b.title);
    });
  }, [games, search, tagsMap]);

  const handleSelect = (g: GameRecord) => {
    setSelectedId(g.id); setSelectedGame(g);
    setEditTitle(g.title);
    setEditStoreUrl(g.store_url || '');
    setEditCustomCover(g.custom_cover || '');
    const tags = tagsMap[g.id] || [];
    setSelectedTags(tags.map(t => t.tag));
    setRating(tags[0]?.rating || '');
    setNote(tags[0]?.note || '');
    const m = { ...(g.metrics || {}) };
    if (g.playtime_forever > 0 && !m.playtime) {
      m.playtime = String(g.playtime_forever);
    }
    setMetrics(m);
    loadRefs(g.id);
  };

  const loadRefs = async (gameId: string) => {
    // Both directions
    const {data: out} = await supabase.from('entity_refs')
      .select('target_type,target_id').eq('source_type','game').eq('source_id',gameId);
    const {data: inv} = await supabase.from('entity_refs')
      .select('source_type,source_id').eq('target_type','game').eq('target_id',gameId);
    const animeSet = new Set<string>();
    const musicMap = new Map<string,string>();
    for (const r of (out||[])) {
      if (r.target_type === 'anime') animeSet.add(r.target_id);
      else if (r.target_type === 'music') {
        const m = musicListRef.find(ml => ml.id === r.target_id);
        musicMap.set(r.target_id, m?.title || r.target_id);
      }
    }
    for (const r of (inv||[])) {
      if (r.source_type === 'anime') animeSet.add(r.source_id);
      else if (r.source_type === 'music') {
        const m = musicListRef.find(ml => ml.id === r.source_id);
        musicMap.set(r.source_id, m?.title || r.source_id);
      }
    }
    setRefsAnime([...animeSet]);
    setRefsMusic([...musicMap].map(([id,title]) => ({id,title})));
  };

  const handleSave = async () => {
    if (!selectedId || selectedTags.length === 0) return;
    const hash = getSession(); if (!hash) return;
    setSaving(true);
    const pt = metrics.playtime ? (parseInt(metrics.playtime) || 0) : 0;
    const { error } = await supabase.rpc('fn_save_steam_tag', {
      p_hash: hash, p_game_id: selectedId, p_tags: selectedTags,
      p_rating: rating || null, p_note: note || null,
    });
    if (!error) {
      await supabase.from('steam_games').update({ playtime_forever: pt, metrics, title: editTitle, store_url: editStoreUrl || null, custom_cover: editCustomCover || null }).eq('id', selectedId);
    }
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
      steam_app_id: -Date.now(), title: addTitle.trim(), playtime_forever: 0, is_manual: true,
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                style={{ ...iS, fontWeight: 600, fontSize: 14, marginBottom: 8 }} />
              <input value={editStoreUrl} onChange={e => setEditStoreUrl(e.target.value)}
                placeholder="商店链接" style={{ ...iS, fontSize: 11, marginBottom: 6, padding: '5px 10px' }} />
              <input value={editCustomCover} onChange={e => setEditCustomCover(e.target.value)}
                placeholder="封面图链接" style={{ ...iS, fontSize: 11, padding: '5px 10px' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => handleBlacklist(selectedGame)}
                style={actBtn('#3b1818', '#f87171')}>黑名单</button>
              <button onClick={() => { const g = selectedGame; setSelectedGame(null); setSelectedId(null); handleDelete(g); }}
                style={actBtn('#3b1010', '#f87171')}>删除</button>
              <button onClick={() => { setSelectedId(null); setSelectedGame(null); }}
                style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>评级</p>
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

          {/* Metrics */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <p style={{ fontSize: 11,color: C.text, margin: 0 }}>数据指标</p>
              {!selectedGame.is_manual && selectedGame.steam_app_id > 0 && (
                <button onClick={async () => {
                  setSaving(true);
                  try {
                    const { data, error } = await supabase.functions.invoke('sync-steam', {
                      body: { mode: 'achievements', appid: selectedGame.steam_app_id, gameId: selectedId },
                    });
                    if (error) { setMsg('❌ ' + error.message); }
                    else if (data?.ok) { setMetrics(prev => ({ ...prev, achievements: data.achievements ?? prev.achievements })); setMsg('✅ ' + (data.note || '已导入')); }
                    else setMsg('❌ ' + (data?.error || '导入失败'));
                  } catch { setMsg('❌ 网络错误'); }
                  setSaving(false);
                  setTimeout(() => setMsg(''), 2500);
                }} disabled={saving} style={{
                  padding: '4px 12px', borderRadius: 8, border: '1px solid #1e3a5f', background: '#0a1628',
                  color: '#60a5fa', fontSize: 11, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.5 : 1,
                }}>🔄 导入 Steam 成就</button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(metrics).map(([k, v]) => {
                const preset = METRIC_PRESETS.find(p => p.key === k);
                return (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: C.textDim, minWidth: 80 }}>{preset?.label || k}</span>
                    <input value={v} onChange={e => setMetrics(prev => ({ ...prev, [k]: e.target.value }))}
                      style={{ ...iS, flex: 1, padding: '6px 10px' }} />
                    <button onClick={() => setMetrics(prev => { const n = { ...prev }; delete n[k]; return n; })}
                      style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #3b1818', background: 'transparent',
                        color: '#f87171', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                  </div>
                );
              })}

              {/* Add new */}
              <div style={{ display: 'flex', gap: 6, paddingTop: 2 }}>
                <select value={newMetricKey} onChange={e => setNewMetricKey(e.target.value)}
                  style={{ ...iS, width: 100, padding: '5px 8px', cursor: 'pointer', flexShrink: 0 }}>
                  <option value="">+ 添加</option>
                  {METRIC_PRESETS.filter(p => !metrics[p.key]).map(p => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                  <option value="__custom__">自定义</option>
                </select>
                {newMetricKey === '__custom__' && (
                  <input placeholder="键名" value={newMetricCustomKey} onChange={e => setNewMetricCustomKey(e.target.value)}
                    style={{ ...iS, width: 70, padding: '5px 8px', flexShrink: 0 }} />
                )}
                {newMetricKey && (
                  <input placeholder="数值" value={newMetricVal} onChange={e => setNewMetricVal(e.target.value)}
                    style={{ ...iS, flex: 1, padding: '5px 8px' }} />
                )}
                {newMetricKey && (
                  <button onClick={() => {
                    if (!newMetricVal) return;
                    const key = newMetricKey === '__custom__' ? newMetricCustomKey : newMetricKey;
                    if (!key) return;
                    setMetrics(prev => ({ ...prev, [key]: newMetricVal }));
                    setNewMetricKey(''); setNewMetricVal(''); setNewMetricCustomKey('');
                  }} style={{
                    padding: '5px 12px', borderRadius: 6, border: 'none', background: C.accent, color: '#fff', fontSize: 13, cursor: 'pointer',
                  }}>✓</button>
                )}
              </div>
            </div>
          </div>

          <TagInput selectedTags={selectedTags} onTagsChange={setSelectedTags}
            presetTags={PRESET_GAME_TAGS} customTagsAll={customTagsAll} />

          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: '#52525b', marginBottom: 6 }}>笔记</p>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="可选..."
              style={{ width: '100%', height: 60, background: '#121224', border: '1px solid #27273d', borderRadius: 8,
                padding: 8, color: C.text, fontSize: 12, resize: 'vertical'               }} />
          </div>

          {/* Entity refs */}
          <div style={{ marginBottom: 14, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>🔗 关联作品</div>
            {/* Anime */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: '#52525b', marginBottom: 4 }}>番剧</div>
              {refsAnime.map(a => (
                <span key={a} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',margin:'0 4px 4px 0',
                  borderRadius:6,background:'rgba(168,85,247,0.12)',color:'#c084fc',fontSize:11}}>
                  {a}
                  <button onClick={async () => {
                    await supabase.from('entity_refs').delete()
                      .or(`and(source_type.eq.game,source_id.eq.${selectedId},target_type.eq.anime,target_id.eq.${a}),and(source_type.eq.anime,source_id.eq.${a},target_type.eq.game,target_id.eq.${selectedId})`);
                    setRefsAnime(prev => prev.filter(x => x !== a));
                  }} style={{background:'none',border:'none',color:'#c084fc',cursor:'pointer',padding:0,fontSize:10}}>✕</button>
                </span>
              ))}
              <div style={{display:'flex',gap:4,marginTop:4}}>
                <input value={refAnimeSearch} onChange={e => setRefAnimeSearch(e.target.value)} placeholder="搜索番剧..."
                  style={{padding:'4px 8px',borderRadius:6,border:'1px solid #27273d',background:'#121224',color:C.text,fontSize:11,width:120}} />
                {refAnimeSearch && animeList.filter(a => {
                  if (refsAnime.includes(a)) return false;
                  return getQuickSearchIndex(a).includes(refAnimeSearch.toLowerCase());
                }).slice(0,5).map(a => (
                  <span key={a} onClick={async () => {
                    await supabase.from('entity_refs').insert({source_type:'game',source_id:selectedId,target_type:'anime',target_id:a});
                    setRefsAnime(prev => [...prev, a]); setRefAnimeSearch('');
                  }} style={{padding:'3px 8px',borderRadius:6,background:'rgba(168,85,247,0.08)',color:'#c084fc',fontSize:11,cursor:'pointer',whiteSpace:'nowrap'}}>
                    + {a}
                  </span>
                ))}
              </div>
            </div>
            {/* Music */}
            <div>
              <div style={{ fontSize: 11, color: '#52525b', marginBottom: 4 }}>歌曲</div>
              {refsMusic.map(m => (
                <span key={m.id} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',margin:'0 4px 4px 0',
                  borderRadius:6,background:'rgba(59,130,246,0.12)',color:'#60a5fa',fontSize:11}}>
                  {m.title}
                  <button onClick={async () => {
                    await supabase.from('entity_refs').delete()
                      .or(`and(source_type.eq.game,source_id.eq.${selectedId},target_type.eq.music,target_id.eq.${m.id}),and(source_type.eq.music,source_id.eq.${m.id},target_type.eq.game,target_id.eq.${selectedId})`);
                    setRefsMusic(prev => prev.filter(x => x.id !== m.id));
                  }} style={{background:'none',border:'none',color:'#60a5fa',cursor:'pointer',padding:0,fontSize:10}}>✕</button>
                </span>
              ))}
              <div style={{display:'flex',gap:4,marginTop:4}}>
                <input value={refMusicSearch} onChange={e => setRefMusicSearch(e.target.value)} placeholder="搜索歌曲..."
                  style={{padding:'4px 8px',borderRadius:6,border:'1px solid #27273d',background:'#121224',color:C.text,fontSize:11,width:120}} />
                {refMusicSearch && musicListRef.filter(m => {
                  if (refsMusic.find(r => r.id === m.id)) return false;
                  return getQuickSearchIndex(m.title).includes(refMusicSearch.toLowerCase());
                }).slice(0,5).map(m => (
                  <span key={m.id} onClick={async () => {
                    await supabase.from('entity_refs').insert({source_type:'game',source_id:selectedId,target_type:'music',target_id:m.id});
                    setRefsMusic(prev => [...prev, m]); setRefMusicSearch('');
                  }} style={{padding:'3px 8px',borderRadius:6,background:'rgba(59,130,246,0.08)',color:'#60a5fa',fontSize:11,cursor:'pointer',whiteSpace:'nowrap'}}>
                    + {m.title}
                  </span>
                ))}
              </div>
            </div>
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
