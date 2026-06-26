'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import {
  C, cardGridStyle, cardStyle, cardBgStyle, cardOverlayStyle,
  cardContentStyle, cardTitleStyle, cardArtistStyle, cardAlbumStyle,
  badgeStyle, tagChipStyle, emptyStyle,
  headerStyle, backLinkStyle, h1Style, countBadgeStyle,
  filterRowStyle, filterLabelStyle,
  searchInputStyle, loadingContainerStyle, spinnerStyle, loadingTextStyle,
} from '@/lib/card-styles';
import type { MusicTag } from '@/lib/types';

interface MusicItem {
  id: string;
  title: string;
  artist: string;
  album?: string;
}

export function MusicTagEditor() {
  const [musicList, setMusicList] = useState<MusicItem[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<string, MusicTag[]>>({});
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMusic, setSelectedMusic] = useState<MusicItem | null>(null);

  // Tag form state
  const [tagInput, setTagInput] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [likability, setLikability] = useState(5);
  const [singability, setSingability] = useState(5);
  const [comment, setComment] = useState('');

  // UI states
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    const { data: music } = await supabase
      .from('music_list')
      .select('*')
      .order('title', { ascending: true })
      .limit(500);
    setMusicList(music || []);

    const { data: tags } = await supabase.from('music_tags').select('*');
    if (tags) {
      const map: Record<string, MusicTag[]> = {};
      tags.forEach((t: any) => {
        if (!map[t.music_id]) map[t.music_id] = [];
        map[t.music_id].push(t as MusicTag);
      });
      setTagsMap(map);
    }
  };

  // Sort: un-tagged first, then tagged
  const sortedList = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = search.trim()
      ? musicList.filter(m => m.title.toLowerCase().includes(q) || m.artist.toLowerCase().includes(q))
      : musicList;
    return [...filtered.filter(m => !tagsMap[m.id]?.length), ...filtered.filter(m => tagsMap[m.id]?.length > 0)];
  }, [musicList, search, tagsMap]);

  const currentTags = selectedId ? (tagsMap[selectedId] || []) : [];
  const hasExistingTags = currentTags.length > 0;

  const handleSelect = (m: MusicItem) => {
    setSelectedId(m.id);
    setSelectedMusic(m);
    if (tagsMap[m.id]?.length > 0) {
      const existing = tagsMap[m.id][0];
      setSelectedTags(currentTags.map(t => t.tag));
      setLikability(existing.likability || 5);
      setSingability(existing.singability || 5);
      setComment(existing.comment || '');
    } else {
      setSelectedTags([]);
      setLikability(5);
      setSingability(5);
      setComment('');
    }
    setMessage(null);
    setShowEditor(true);
  };

  const togglePresetTag = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const addCustomTag = () => {
    const v = tagInput.trim();
    if (!v) return;
    if (!selectedTags.includes(v)) {
      setSelectedTags(prev => [...prev, v]);
    }
    setTagInput('');
  };

  const handleSave = async () => {
    if (!selectedId) { setMessage({ text: '请先选择一首音乐', type: 'err' }); return; }
    const finalTags = [...new Set([...selectedTags].filter(Boolean))];
    if (finalTags.length === 0) { setMessage({ text: '至少需要一个标签', type: 'err' }); return; }

    setLoading(true);
    const hash = getSession() || '';

    try {
      // Delete existing tags first
      if (hasExistingTags) {
        for (const t of currentTags) {
          const res = await supabase.rpc('fn_delete_music_tag', { p_hash: hash, p_tag_id: t.id });
          if (res.data?.error) { setMessage({ text: `❌ 删除失败: ${res.data.error}`, type: 'err' }); setLoading(false); return; }
        }
      }

      // Insert new tags
      for (const t of finalTags) {
        const res = await supabase.rpc('fn_save_music_tag', {
          p_hash: hash,
          p_music_id: selectedId,
          p_tag: t,
          p_likability: likability,
          p_singability: singability,
          p_comment: comment || null,
        });
        if (res.data?.error) { setMessage({ text: `❌ 保存失败: ${res.data.error}`, type: 'err' }); setLoading(false); return; }
      }

      setMessage({ text: `✅ 已保存 ${finalTags.length} 个标签`, type: 'ok' });
      setShowEditor(false);
      fetchData();
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'err' });
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ ...filterRowStyle, marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.text }}>🎵 音乐标签管理</h3>
        <span style={{ ...countBadgeStyle, marginLeft: 8 }}>{musicList.length} 首</span>
      </div>

      {message && (
        <p style={{ fontSize: 13, color: message.type === 'ok' ? '#4ade80' : '#f87171', margin: '0 0 12px' }}>
          {message.text}
        </p>
      )}

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="🔍 搜索音乐..."
        style={{ ...searchInputStyle, marginBottom: 16, maxWidth: 400 }}
      />

      {/* Cards Grid */}
      {sortedList.length === 0 ? (
        <p style={emptyStyle}>暂无数据（先同步音乐）</p>
      ) : (
        <div style={cardGridStyle}>
          {sortedList.map((m) => {
            const isTagged = tagsMap[m.id]?.length > 0;
            const isSelected = selectedId === m.id;
            return (
                <div
                key={m.id}
                onClick={() => handleSelect(m)}
                style={{
                  ...cardStyle,
                  ...(isSelected ? { borderColor: C.accent, boxShadow: `0 0 0 1px ${C.accent}` } : {}),
                  ...(isTagged ? { opacity: 0.75 } : {}),
                  position: 'relative' as const,
                }}
              >
                {/* Subtle background */}
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 12,
                  background: 'rgba(99,102,241,0.04)',
                  zIndex: 0, pointerEvents: 'none',
                }} />
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 12,
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.08), transparent 60%)',
                  zIndex: 0, pointerEvents: 'none',
                }} />

                  <div style={cardContentStyle}>
                  <div style={cardTitleStyle(false)}>{m.title}</div>
                  <div style={cardArtistStyle}>{m.artist}</div>
                  {m.album && <div style={cardAlbumStyle}>{m.album}</div>}

                  {/* Tag status badge */}
                  <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {isTagged ? (
                      <span style={badgeStyle('rgba(99,102,241,0.18)')}>
                        已标记 {tagsMap[m.id].length} 个标签
                      </span>
                    ) : (
                      <span style={badgeStyle('rgba(255,255,255,0.06)')}>
                        未标记
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Panel (show when a card is selected) */}
      {showEditor && selectedMusic && (
        <div style={editorPanelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h4 style={{ margin: 0, fontSize: 14, color: C.text, fontWeight: 600 }}>
              ✏️ {selectedMusic.title} - {selectedMusic.artist}
            </h4>
            <button onClick={() => { setShowEditor(false); setSelectedId(null); }}
              style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18 }}>
              ✕
            </button>
          </div>

          {/* Existing Tags */}
          {hasExistingTags && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: C.textSec, marginBottom: 6 }}>已有标签</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {currentTags.map((t) => (
                  <span key={t.id} style={{ ...tagChipStyle, background: '#27273d', color: C.text, fontSize: 11 }}>
                    {t.tag}
                    {t.likability && <span style={{ marginLeft: 4, color: '#f87171', fontSize: 10 }}>♥{t.likability}</span>}
                    <button onClick={async () => {
                      await supabase.rpc('fn_delete_music_tag', { p_hash: getSession() || '', p_tag_id: t.id! });
                      setMessage({ text: '标签已删除', type: 'ok' });
                      fetchData();
                    }} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12, marginLeft: 4 }}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Preset Tags */}
          <div style={{ fontSize: 12, color: C.textSec, marginBottom: 6 }}>选择标签</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {['学习', '工作', '运动', '放松', '睡眠', '开车',
              '悲伤', '快乐', '愤怒', '恋爱', '怀旧', '励志',
              '电子', '摇滚', '民谣', '古典', '爵士', '流行',
              'ACG', 'Vocaloid', '游戏BGM', '纯音乐',
            ].map((tag) => (
              <button
                key={tag}
                onClick={() => togglePresetTag(tag)}
                style={{
                  padding: '4px 10px', borderRadius: 20, border: '1px solid',
                  borderColor: selectedTags.includes(tag) ? C.accent : 'rgba(255,255,255,0.1)',
                  background: selectedTags.includes(tag) ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: selectedTags.includes(tag) ? C.accent : C.textSec,
                  cursor: 'pointer', fontSize: 11,
                }}
              >{tag}</button>
            ))}
          </div>

          {/* Custom Tag Input */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCustomTag(); }}
              placeholder="输入自定义标签..."
              style={{ flex: 1, ...searchInputStyle, marginBottom: 0 }}
            />
            <button onClick={addCustomTag} style={{
              padding: '6px 14px', borderRadius: 8, border: '1px solid ' + C.accent,
              background: 'rgba(99,102,241,0.1)', color: C.accent, cursor: 'pointer', fontSize: 12,
            }}>添加</button>
          </div>

          {/* Selected tags preview */}
          {selectedTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {selectedTags.map(t => (
                <span key={t} style={{ ...tagChipStyle, background: C.accent, color: '#fff', fontSize: 11 }}>
                  {t}
                  <button onClick={() => setSelectedTags(prev => prev.filter(x => x !== t))}
                    style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12, marginLeft: 4 }}>×</button>
                </span>
              ))}
            </div>
          )}

          {/* Sliders: likability + singability */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: C.textSec }}>喜欢度: <span style={{ color: C.accent, fontWeight: 600 }}>{likability}/10</span></label>
              <input type="range" min={1} max={10} value={likability}
                onChange={e => setLikability(Number(e.target.value))}
                style={{ width: '100%', accentColor: C.accent, marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.textSec }}>能唱度: <span style={{ color: C.accent, fontWeight: 600 }}>{singability}/10</span></label>
              <input type="range" min={1} max={10} value={singability}
                onChange={e => setSingability(Number(e.target.value))}
                style={{ width: '100%', accentColor: C.accent, marginTop: 4 }} />
            </div>
          </div>

          {/* Comment */}
          <div style={{ fontSize: 12, color: C.textSec, marginBottom: 6 }}>备注/评论</div>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="写点感想..."
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.1)', background: C.surface,
              color: C.text, fontSize: 13, outline: 'none',
              resize: 'vertical', minHeight: 60, boxSizing: 'border-box',
            }}
            rows={3}
          />

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={handleSave} disabled={loading}
              style={{
                flex: 1, padding: '8px 16px', borderRadius: 10, border: 'none',
                background: C.accent, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                opacity: loading ? 0.6 : 1,
              }}>
              {loading ? '保存中...' : (hasExistingTags ? '更新标签' : '保存标签')}
            </button>
            <button onClick={() => { setShowEditor(false); setSelectedId(null); }}
              style={{
                padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                background: 'transparent', color: C.textSec, fontSize: 13, cursor: 'pointer',
              }}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Editor Panel Style ─────────────────────────────
const editorPanelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0, right: 0, width: 400, maxWidth: '90vw', height: '100vh',
  background: C.bg, borderLeft: '1px solid rgba(255,255,255,0.08)',
  padding: 20, overflowY: 'auto', zIndex: 100,
  boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
};
