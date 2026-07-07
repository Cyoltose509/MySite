'use client';

import {useState, useEffect, useMemo} from 'react';
import {supabase} from '@/lib/supabase';
import {getSession} from '@/lib/auth';
import {getAnimeList} from '@/lib/anime-data';
import {
    C, cardGridStyle, cardStyle, cardContentStyle,
    cardTitleStyle, cardArtistStyle, cardAlbumStyle,
    badgeStyle, tagChipStyle, tagMoreStyle, emptyStyle,
    filterRowStyle, countBadgeStyle,
    searchInputStyle, loadingContainerStyle, spinnerStyle, loadingTextStyle,
} from '@/lib/card-styles';
import type {MusicTag} from '@/lib/types';
import {PRESET_TAGS} from '@/lib/types';


const RATING_LABELS = ['', '拉完了', 'NPC', '人上人', '顶级', '夯'];

interface MusicItem {
    id: string;
    title: string;
    artist: string[];
    album?: string;
    netease_id?: number | string;
}

export function MusicTagEditor() {
    const [musicList, setMusicList] = useState<MusicItem[]>([]);
    const [tagsMap, setTagsMap] = useState<Record<string, MusicTag[]>>({});
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedMusic, setSelectedMusic] = useState<MusicItem | null>(null);
    const [tagInput, setTagInput] = useState('');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [likability, setLikability] = useState(3);
    const [singability, setSingability] = useState(3);
    const [voice, setVoice] = useState('');
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const [refsAnime, setRefsAnime] = useState<string[]>([]);
    const [refsGames, setRefsGames] = useState<{id:string;title:string}[]>([]);
    const [animeSearch, setAnimeSearch] = useState('');
    const [gameSearch, setGameSearch] = useState('');
    const [animeList, setAnimeList] = useState<string[]>([]);
    const [gameList, setGameList] = useState<{id:string;title:string}[]>([]);

    const miniInput: React.CSSProperties = {padding:'4px 8px',borderRadius:6,border:'1px solid rgba(255,255,255,0.1)',background:C.surface,color:C.text,fontSize:11,width:120};

    useEffect(() => {
        fetchData();
        loadRefLists();
    }, []);

    const loadRefLists = async () => {
        // Load anime titles
        try {
            const animeData = await getAnimeList();
            setAnimeList(animeData.map((a:any) => a.title));
        } catch {}
        // Load games
        const {data: games} = await supabase.from('steam_games').select('id,title').order('title');
        setGameList(games || []);
    };

    const loadRefs = async (musicId: string) => {
        // Both directions
        const {data: out} = await supabase.from('entity_refs')
            .select('target_type,target_id').eq('source_type','music').eq('source_id',musicId);
        const {data: inv} = await supabase.from('entity_refs')
            .select('source_type,source_id').eq('target_type','music').eq('target_id',musicId);
        const animeSet = new Set<string>();
        const gameMap = new Map<string,string>();
        for (const r of (out||[])) {
            if (r.target_type === 'anime') animeSet.add(r.target_id);
            else if (r.target_type === 'game') {
                const g = gameList.find(gl => gl.id === r.target_id);
                gameMap.set(r.target_id, g?.title || r.target_id);
            }
        }
        for (const r of (inv||[])) {
            if (r.source_type === 'anime') animeSet.add(r.source_id);
            else if (r.source_type === 'game') {
                const g = gameList.find(gl => gl.id === r.source_id);
                gameMap.set(r.source_id, g?.title || r.source_id);
            }
        }
        setRefsAnime([...animeSet]);
        setRefsGames([...gameMap].map(([id,title]) => ({id,title})));
    };

    const fetchData = async () => {
        const {data: music} = await supabase.from('music_list').select('*').order('title', {ascending: true}).limit(500);
        setMusicList(music || []);
        // Fetch all tags via pagination (Supabase server caps at 1000 per request)
        let allTags: any[] = [];
        let page = 0;
        while (true) {
          const {data: tags} = await supabase.from('music_tags').select('*').range(page * 1000, (page + 1) * 1000 - 1);
          if (!tags || tags.length === 0) break;
          allTags = allTags.concat(tags);
          if (tags.length < 1000) break;
          page++;
        }
        const map: Record<string, MusicTag[]> = {};
        allTags.forEach((t: any) => {
          if (!map[t.music_id]) map[t.music_id] = [];
          map[t.music_id].push(t as MusicTag);
        });
        setTagsMap(map);
    };

    const sortedList = useMemo(() => {
        const q = search.toLowerCase();
        const filtered = search.trim()
            ? musicList.filter(m => m.title.toLowerCase().includes(q) || (m.artist || []).join(' / ').toLowerCase().includes(q))
            : musicList;
        return [...filtered.filter(m => !tagsMap[m.id]?.[0]?.voice), ...filtered.filter(m => tagsMap[m.id]?.[0]?.voice)];
    }, [musicList, search, tagsMap]);

    const customTagsAll = useMemo(() => {
        const s = new Set<string>();
        Object.values(tagsMap).flat().forEach(t => {
            if (!PRESET_TAGS.includes(t.tag)) {
                s.add(t.tag);
            }
        });
        return [...s].sort();
    }, [tagsMap]);

    const currentTags = selectedId ? (tagsMap[selectedId] || []) : [];
    const hasExistingTags = currentTags.length > 0;

    const handleSelect = (m: MusicItem) => {
        setSelectedId(m.id);
        setSelectedMusic(m);
        if (tagsMap[m.id]?.[0]?.voice) {
            const ex = tagsMap[m.id][0];
            setSelectedTags(tagsMap[m.id].map(t => t.tag));
            setLikability(ex.likability || 3);
            setSingability(ex.singability || 3);
            setVoice(ex.voice || '');
            setNote(ex.note || '');
        } else {
            setSelectedTags([]);
            setLikability(3);
            setSingability(3);
            setVoice('');
            setNote('');
        }
        setMessage(null);
        setShowEditor(true);
        loadRefs(m.id);
    };

    const togglePreset = (tag: string) => {
        setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
    };

    const addCustomTag = () => {
        const v = tagInput.trim();
        if (!v) return;
        if (!selectedTags.includes(v)) setSelectedTags(prev => [...prev, v]);
        setTagInput('');
    };

    const handleSave = async () => {
        if (!selectedId) {
            setMessage({text: '请先选择一首音乐', type: 'err'});
            return;
        }
        const final = [...new Set(selectedTags.filter(Boolean))];
        if (!final.length) {
            setMessage({text: '至少需要一个标签（想清空标签请全部删除后刷新页面）', type: 'err'});
            return;
        }
        setLoading(true);
        const hash = getSession() || '';
        try {
            // 删除旧标签
            if (hasExistingTags) {
                for (const t of currentTags) {
                    const {data: delData, error: delError} = await supabase.rpc('fn_delete_music_tag', {
                        p_hash: hash, p_tag_id: t.id
                    });
                    if (delError) {
                        setMessage({text: `❌ 删除失败: ${delError.message}`, type: 'err'});
                        setLoading(false);
                        return;
                    }
                    if (delData?.error) {
                        setMessage({text: `❌ 删除失败: ${delData.error}`, type: 'err'});
                        setLoading(false);
                        return;
                    }
                }
            }
            // 保存新标签
            for (const t of final) {
                const {data: saveData, error: saveError} = await supabase.rpc('fn_save_music_tag', {
                    p_hash: hash, p_music_id: selectedId, p_tag: t,
                    p_likability: likability || null, p_singability: singability || null,
                    p_note: note || null, p_voice: voice || null,
                });
                if (saveError) {
                    setMessage({text: `❌ 保存失败: ${saveError.message}`, type: 'err'});
                    setLoading(false);
                    return;
                }
                if (saveData?.error) {
                    setMessage({text: `❌ ${saveData.error}`, type: 'err'});
                    setLoading(false);
                    return;
                }
            }
            setMessage({text: `✅ 已保存 ${final.length} 个标签`, type: 'ok'});
            setShowEditor(false);
            fetchData();
        } catch (e: any) {
            setMessage({text: `❌ 异常: ${e.message}`, type: 'err'});
        }
        setLoading(false);
    };

    /* ── render ───────────────────────────────────── */
    return (
        <div style={{padding: 24, maxWidth: 1200, margin: '0 auto'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20}}>
                <h3 style={{margin: 0, fontSize: 16, fontWeight: 600, color: C.text}}>🎵 音乐标签管理</h3>
                <span style={{
                    padding: '4px 12px',
                    borderRadius: 20,
                    background: 'rgba(99,102,241,0.12)',
                    color: C.accent,
                    fontSize: 12
                }}>{musicList.length} 首</span>
            </div>

            {message && (
                <p style={{fontSize: 13, color: message.type === 'ok' ? '#4ade80' : '#f87171', margin: '0 0 12px'}}>
                    {message.text}
                </p>
            )}

            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜索音乐..."
                   style={{...searchInputStyle, marginBottom: 16, maxWidth: 400}}/>

            {sortedList.length === 0 ? (
                <p style={emptyStyle}>暂无数据（先同步音乐）</p>
            ) : (
                <div style={cardGridStyle}>
                    {sortedList.map(m => {
                        const tagged = !!tagsMap[m.id]?.[0]?.voice;
                        const sel = selectedId === m.id;
                        return (
                            <div key={m.id} onClick={() => handleSelect(m)} style={{
                                ...cardStyle,
                                border: '1px solid rgba(255,255,255,0.16)',
                                ...(sel ? {
                                    borderColor: C.accent,
                                    background: 'rgba(99,102,241,0.1)',
                                    boxShadow: `0 0 12px rgba(99,102,241,0.15)`
                                } : {}),
                                ...(tagged && !sel ? {opacity: 0.7} : {}),
                                position: 'relative',
                            }}>
                                <div style={cardContentStyle}>
                                    <div style={cardTitleStyle(false)}>{m.title}</div>
                                    <div style={cardArtistStyle}>{(m.artist || []).join(' / ')}</div>
                                    <div style={{marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap'}}>
                                        {(() => {
                                          const tgs = tagsMap[m.id] || [];
                                          const t = tgs[0];
                                          return <>
                                            {t?.likability && <span style={badgeStyle(C.red)}>♥{RATING_LABELS[t.likability]}</span>}
                                            {t?.singability && <span style={badgeStyle(C.accentLt)}>🎤{RATING_LABELS[t.singability]}</span>}
                                          </>;
                                        })()}
                                    </div>
                                    {(() => {
                                      const tgs = tagsMap[m.id] || [];
                                      if (tgs.length === 0) return <div style={{marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap'}}>
                                        <span style={badgeStyle('rgba(255,255,255,0.06)')}>未标记</span>
                                      </div>;
                                      return <div style={{marginTop: 6, display: 'flex', gap: 3, flexWrap: 'wrap'}}>
                                        {tgs.slice(0, 6).map(t => <span key={t.id} style={tagChipStyle}>{t.tag}</span>)}
                                        {tgs.length > 6 && <span style={tagMoreStyle}>+{tgs.length - 6}</span>}
                                      </div>;
                                    })()}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Editor Panel ───────────────────────────── */}
            {showEditor && selectedMusic && (
                <div style={{
                    position: 'fixed', top: 0, right: 0, width: 400, maxWidth: '90vw', height: '100vh',
                    background: C.bg, borderLeft: '1px solid rgba(255,255,255,0.08)',
                    padding: 20, overflowY: 'auto', zIndex: 100, boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
                }}>
                    {/* close bar */}
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16}}>
                        <h4 style={{margin: 0, fontSize: 14, color: C.text, fontWeight: 600}}>
                            ✏️ {selectedMusic.title} - {(selectedMusic.artist || []).join(' / ')}
                        </h4>
                        <button onClick={() => {
                            setShowEditor(false);
                            setSelectedId(null);
                        }}
                                style={{background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18}}>✕
                        </button>
                    </div>

                    {/* existing tags */}
                    {hasExistingTags && (
                        <div style={{marginBottom: 12}}>
                            <div style={{fontSize: 12, color: C.textSec, marginBottom: 6}}>已有标签</div>
                            <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                                {currentTags.map(t => (
                                    <span key={t.id} style={{...tagChipStyle, background: '#27273d', color: C.text, fontSize: 11}}>
                    {t.tag}
                                        <button onClick={async () => {
                                            await supabase.rpc('fn_delete_music_tag', {p_hash: getSession() || '', p_tag_id: t.id!});
                                            setMessage({text: '标签已删除', type: 'ok'});
                                            fetchData();
                                        }} style={{
                                            background: 'none',
                                            border: 'none',
                                            color: '#f87171',
                                            cursor: 'pointer',
                                            fontSize: 12,
                                            marginLeft: 4
                                        }}>×</button>
                  </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* preset tags */}
                    <div style={{fontSize: 12, color: C.textSec, marginBottom: 6}}>选择标签</div>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8}}>
                        {PRESET_TAGS.map(tag => (
                            <button key={tag} onClick={() => togglePreset(tag)} style={{
                                padding: '4px 10px', borderRadius: 20, border: '1px solid',
                                borderColor: selectedTags.includes(tag) ? C.accent : 'rgba(255,255,255,0.1)',
                                background: selectedTags.includes(tag) ? 'rgba(99,102,241,0.15)' : 'transparent',
                                color: selectedTags.includes(tag) ? C.accent : C.textSec,
                                cursor: 'pointer', fontSize: 11,
                            }}>{tag}</button>
                        ))}
                    </div>

                    {/* custom tags quick-select */}
                    {customTagsAll.length > 0 && (
                        <div style={{marginBottom: 12}}>
                            <div style={{fontSize: 11, color: C.textDim, marginBottom: 4}}>已有自定义标签（点击快速添加）</div>
                            <div style={{display: 'flex', flexWrap: 'wrap', gap: 4}}>
                                {customTagsAll.map(t => (
                                    <button key={t} onClick={() => {
                                        if (!selectedTags.includes(t)) setSelectedTags(prev => [...prev, t]);
                                    }} style={{
                                        padding: '3px 8px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)',
                                        background: selectedTags.includes(t) ? 'rgba(99,102,241,0.15)' : 'transparent',
                                        color: selectedTags.includes(t) ? C.accentLt : C.textDim,
                                        cursor: 'pointer', fontSize: 10,
                                    }}>{t}</button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* custom tag input */}
                    <div style={{display: 'flex', gap: 8, marginBottom: 12}}>
                        <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                               onKeyDown={e => {
                                   if (e.key === 'Enter') addCustomTag();
                               }}
                               placeholder="输入自定义标签..."
                               style={{flex: 1, ...searchInputStyle, marginBottom: 0}}/>
                        <button onClick={addCustomTag} style={{
                            padding: '6px 14px', borderRadius: 8, border: '1px solid ' + C.accent,
                            background: 'rgba(99,102,241,0.1)', color: C.accent, cursor: 'pointer', fontSize: 12,
                        }}>添加
                        </button>
                    </div>

                    {/* selected tags preview */}
                    {selectedTags.length > 0 && (
                        <div style={{display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12}}>
                            {selectedTags.map(t => (
                                <span key={t} style={{...tagChipStyle, background: C.accent, color: '#fff', fontSize: 11}}>
                  {t}
                                    <button onClick={() => setSelectedTags(prev => prev.filter(x => x !== t))}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: '#fff',
                                                cursor: 'pointer',
                                                fontSize: 12,
                                                marginLeft: 4
                                            }}>×</button>
                </span>
                            ))}
                        </div>
                    )}

                    {/* rating: likability + singability (1-5) slider */}
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12}}>
                        <div>
                            <label style={{fontSize: 12, color: C.textSec}}>喜欢度</label>
                            <div style={{marginTop: 8}}>
                                <input type="range" min="1" max="5" value={likability}
                                       onChange={(e) => setLikability(Number(e.target.value))}
                                       style={{width: '100%', cursor: 'pointer'}}/>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: 10,
                                    color: C.textDim,
                                    marginTop: 2
                                }}>
                                    <span>拉完了</span><span>NPC</span><span>人上人</span><span>顶级</span><span>夯</span>
                                </div>
                                <div style={{
                                    textAlign: 'center',
                                    fontSize: 13,
                                    color: '#f87171',
                                    fontWeight: 600,
                                    marginTop: 4
                                }}>{RATING_LABELS[likability]}</div>
                            </div>
                        </div>
                        <div>
                            <label style={{fontSize: 12, color: C.textSec}}>能唱度</label>
                            <div style={{marginTop: 8}}>
                                <input type="range" min="1" max="5" value={singability}
                                       onChange={(e) => setSingability(Number(e.target.value))}
                                       style={{width: '100%', cursor: 'pointer'}}/>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: 10,
                                    color: C.textDim,
                                    marginTop: 2
                                }}>
                                    <span>拉完了</span><span>NPC</span><span>人上人</span><span>顶级</span><span>夯</span>
                                </div>
                                <div style={{
                                    textAlign: 'center',
                                    fontSize: 13,
                                    color: '#4ade80',
                                    fontWeight: 600,
                                    marginTop: 4
                                }}>{RATING_LABELS[singability]}</div>
                            </div>
                        </div>
                    </div>

                    {/* voice */}
                    <div style={{marginBottom: 12}}>
                        <div style={{fontSize: 12, color: C.textSec, marginBottom: 6}}>声线</div>
                        <div style={{display: 'flex', gap: 8}}>
                            {[
                                {value: '', label: '不设置'},
                                {value: 'male', label: '♂ 男声'},
                                {value: 'female', label: '♀ 女声'},
                                {value: 'duet', label: '♪ 男女'},
                            ].map(opt => (
                                <button key={opt.value} onClick={() => setVoice(opt.value)} style={{
                                    padding: '5px 12px', borderRadius: 8, border: '1px solid',
                                    borderColor: voice === opt.value ? C.accent : 'rgba(255,255,255,0.1)',
                                    background: voice === opt.value ? 'rgba(99,102,241,0.12)' : 'transparent',
                                    color: voice === opt.value ? C.accentLt : C.textSec,
                                    cursor: 'pointer', fontSize: 12,
                                }}>{opt.label}</button>
                            ))}
                        </div>
                    </div>

                    {/* note */}
                    <div style={{fontSize: 12, color: C.textSec, marginBottom: 6}}>记录</div>
                    <textarea value={note} onChange={e => setNote(e.target.value)}
                              placeholder="写点感想..."
                              style={{
                                  width: '100%', padding: '8px 12px', borderRadius: 10,
                                  border: '1px solid rgba(255,255,255,0.1)', background: C.surface,
                                  color: C.text, fontSize: 13, outline: 'none',
                                  resize: 'vertical', minHeight: 60, boxSizing: 'border-box',
                              }} rows={3}/>

                    {/* Entity refs */}
                    <div style={{marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10}}>
                        <div style={{fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8}}>🔗 关联作品</div>

                        {/* Anime refs */}
                        <div style={{marginBottom: 10}}>
                            <div style={{fontSize: 11, color: C.textSec, marginBottom: 4}}>番剧</div>
                            {refsAnime.map(a => (
                                <span key={a} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',margin:'0 4px 4px 0',
                                    borderRadius:6,background:'rgba(168,85,247,0.12)',color:'#c084fc',fontSize:11}}>
                                    {a}
                                    <button onClick={async () => {
                                        await supabase.from('entity_refs').delete()
                                            .or(`and(source_type.eq.music,source_id.eq.${selectedId},target_type.eq.anime,target_id.eq.${a}),and(source_type.eq.anime,target_type.eq.music,target_id.eq.${selectedId},source_id.eq.${a})`);
                                        setRefsAnime(prev => prev.filter(x => x !== a));
                                    }} style={{background:'none',border:'none',color:'#c084fc',cursor:'pointer',padding:0,fontSize:10}}>✕</button>
                                </span>
                            ))}
                            <div style={{display:'flex',gap:4,marginTop:4}}>
                                <input value={animeSearch} onChange={e => setAnimeSearch(e.target.value)} placeholder="搜索番剧..."
                                    style={miniInput} />
                                {animeSearch && animeList.filter(a => a.includes(animeSearch) && !refsAnime.includes(a)).slice(0,5).map(a => (
                                    <span key={a} onClick={async () => {
                                        await supabase.from('entity_refs').insert({source_type:'music',source_id:selectedId,target_type:'anime',target_id:a});
                                        setRefsAnime(prev => [...prev, a]); setAnimeSearch('');
                                    }} style={{padding:'3px 8px',borderRadius:6,background:'rgba(168,85,247,0.08)',color:'#c084fc',fontSize:11,cursor:'pointer',whiteSpace:'nowrap'}}>
                                        + {a}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* Game refs */}
                        <div>
                            <div style={{fontSize: 11, color: C.textSec, marginBottom: 4}}>游戏</div>
                            {refsGames.map(g => (
                                <span key={g.id} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',margin:'0 4px 4px 0',
                                    borderRadius:6,background:'rgba(74,222,128,0.12)',color:'#4ade80',fontSize:11}}>
                                    {g.title}
                                    <button onClick={async () => {
                                        await supabase.from('entity_refs').delete()
                                            .or(`and(source_type.eq.music,source_id.eq.${selectedId},target_type.eq.game,target_id.eq.${g.id}),and(source_type.eq.game,source_id.eq.${g.id},target_type.eq.music,target_id.eq.${selectedId})`);
                                        setRefsGames(prev => prev.filter(x => x.id !== g.id));
                                    }} style={{background:'none',border:'none',color:'#4ade80',cursor:'pointer',padding:0,fontSize:10}}>✕</button>
                                </span>
                            ))}
                            <div style={{display:'flex',gap:4,marginTop:4}}>
                                <input value={gameSearch} onChange={e => setGameSearch(e.target.value)} placeholder="搜索游戏..."
                                    style={miniInput} />
                                {gameSearch && gameList.filter(g => g.title.toLowerCase().includes(gameSearch.toLowerCase()) && !refsGames.find(r => r.id === g.id)).slice(0,5).map(g => (
                                    <span key={g.id} onClick={async () => {
                                        await supabase.from('entity_refs').insert({source_type:'music',source_id:selectedId,target_type:'game',target_id:g.id});
                                        setRefsGames(prev => [...prev, g]); setGameSearch('');
                                    }} style={{padding:'3px 8px',borderRadius:6,background:'rgba(74,222,128,0.08)',color:'#4ade80',fontSize:11,cursor:'pointer',whiteSpace:'nowrap'}}>
                                        + {g.title}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* actions */}
                    <div style={{display: 'flex', gap: 10, marginTop: 14}}>
                        <button onClick={handleSave} disabled={loading}
                                style={{
                                    flex: 1, padding: '8px 16px', borderRadius: 10, border: 'none',
                                    background: C.accent, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                    opacity: loading ? 0.6 : 1,
                                }}>
                            {loading ? '保存中...' : (hasExistingTags ? '更新标签' : '保存标签')}
                        </button>
                        <button onClick={() => {
                            setShowEditor(false);
                            setSelectedId(null);
                        }}
                                style={{
                                    padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                                    background: 'transparent', color: C.textSec, fontSize: 13, cursor: 'pointer',
                                }}>取消
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
