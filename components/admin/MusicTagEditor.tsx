'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { PRESET_TAGS } from '@/lib/types';

interface MusicItem {
  id: string;
  title: string;
  artist: string;
  album?: string;
  play_count?: number;
}

interface MusicTag {
  id: string;
  music_id: string;
  tag: string;
  likability?: number;
  singability?: number;
  comment?: string;
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
  const [editingTagId, setEditingTagId] = useState<string | null>(null);

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

  // Sort: un-tagged first, tagged items to bottom
  const sortedList = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = search.trim()
      ? musicList.filter(m => m.title.toLowerCase().includes(q) || m.artist.toLowerCase().includes(q))
      : musicList;
    // Untagged items first, tagged items to bottom
    return [...filtered.filter(m => !tagsMap[m.id]?.length), ...filtered.filter(m => tagsMap[m.id]?.length > 0)];
  }, [musicList, search, tagsMap]);

  const currentTags = selectedId ? (tagsMap[selectedId] || []) : [];
  const hasExistingTags = currentTags.length > 0;

  const handleSelectMusic = (m: MusicItem) => {
    setSelectedId(m.id);
    setSelectedMusic(m);
    // If already tagged, load existing values into form
    if (tagsMap[m.id]?.length > 0) {
      const existing = tagsMap[m.id][0];
      setEditingTagId(existing.id);
      setSelectedTags(currentTags.map(t => t.tag));
      setLikability(existing.likability || 5);
      setSingability(existing.singability || 5);
      setComment(existing.comment || '');
      setTagInput('');
    } else {
      setTagInput('');
      setSelectedTags([]);
      setLikability(5);
      setSingability(5);
      setComment('');
      setEditingTagId(null);
    }
    setMessage(null);
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
      // Delete existing tags first (to replace them all)
      if (hasExistingTags) {
        for (const t of currentTags) {
          await supabase.rpc('fn_delete_music_tag', { p_hash: hash, p_tag_id: t.id });
        }
      }

      // Insert new tags
      for (const t of finalTags) {
        await supabase.rpc('fn_save_music_tag', {
          p_hash: hash,
          p_music_id: selectedId,
          p_tag: t,
          p_likability: likability,
          p_singability: singability,
          p_comment: comment || null,
        });
      }

      setMessage({ text: `✅ 已保存 ${finalTags.length} 个标签`, type: 'ok' });
      setEditingTagId(null);
      fetchData();
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'err' });
    }
    setLoading(false);
  };

  const handleDeleteTag = async (tagId: string) => {
    const hash = getSession() || '';
    try {
      await supabase.rpc('fn_delete_music_tag', { p_hash: hash, p_tag_id: tagId });
      setMessage({ text: '标签已删除', type: 'ok' });
      fetchData();
    } catch {}
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.h3}>🏷 音乐标签管理</h3>

      {/* Search + List */}
      <div style={styles.listSection}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 搜索音乐..."
          style={styles.searchInput}
        />

        <div style={styles.musicList}>
          {sortedList.length === 0 && <p style={styles.emptyText}>暂无数据（先同步音乐）</p>}
          {sortedList.map((m) => {
            const isTagged = tagsMap[m.id]?.length > 0;
            return (
              <div
                key={m.id}
                onClick={() => handleSelectMusic(m)}
                style={{
                  ...styles.musicItem,
                  ...(selectedId === m.id ? styles.musicItemSelected : {}),
                  ...(isTagged ? styles.musicItemTagged : {}),
                }}
              >
                <div style={styles.musicInfo}>
                  <span style={{ ...styles.musicTitle, ...(isTagged ? { color: '#818cf8' } : {}) }}>{m.title}</span>
                  <span style={styles.musicArtist}>{m.artist}</span>
                </div>
                {isTagged && (
                  <div style={styles.tagIndicator}>
                    <span style={styles.tagBadge}>{tagsMap[m.id].length} 标签</span>
                    {tagsMap[m.id][0].likability && <span style={styles.scoreBadge}>♥{tagsMap[m.id][0].likability}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Editor Panel */}
      {selectedMusic && (
        <div style={styles.editorPanel}>
          <h4 style={styles.editorTitle}>
            编辑: {selectedMusic.title} - {selectedMusic.artist}
          </h4>

          {/* Existing Tags */}
          {hasExistingTags && (
            <div style={styles.existingTags}>
              <p style={styles.sectionLabel}>已有标签</p>
              <div style={styles.tagChips}>
                {currentTags.map((t) => (
                  <span key={t.id} style={styles.tagChip}>
                    {t.tag}
                    {t.likability && <span style={styles.chipScore}>♥{t.likability}</span>}
                    {t.singability && <span style={styles.chipScore}>♪{t.singability}</span>}
                    <button onClick={() => handleDeleteTag(t.id!)} style={styles.tagDelete}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Preset Tags */}
          <div style={styles.sectionLabel}>选择标签</div>
          <div style={styles.presetGrid}>
            {PRESET_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => togglePresetTag(tag)}
                style={{
                  ...styles.presetChip,
                  ...(selectedTags.includes(tag) ? styles.presetChipActive : {}),
                }}
              >
                {tag}
              </button>
            ))}
          </div>

          {/* Custom Tag Input with Add Button */}
          <div style={styles.customTagRow}>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCustomTag(); }}
              placeholder="输入自定义标签..."
              style={styles.customTagInput}
            />
            <button onClick={addCustomTag} style={styles.addTagBtn}>添加</button>
          </div>

          {/* Selected tags preview */}
          {selectedTags.length > 0 && (
            <div style={styles.selectedPreview}>
              {selectedTags.map(t => (
                <span key={t} style={styles.selectedTagChip}>
                  {t}
                  <button onClick={() => setSelectedTags(prev => prev.filter(x => x !== t))} style={styles.tagDelete}>×</button>
                </span>
              ))}
            </div>
          )}

          {/* Sliders Row: likability + singability (1-10) */}
          <div style={styles.slidersRow}>
            <div style={styles.sliderGroup}>
              <label style={styles.sliderLabel}>喜欢度: <span style={styles.sliderValue}>{likability}/10</span></label>
              <input type="range" min="1" max="10" value={likability}
                onChange={(e) => setLikability(Number(e.target.value))} style={styles.range} />
              <div style={styles.scaleMarks}>
                {[1,2,3,4,5,6,7,8,9,10].map(n => (
                  <span key={n} style={{ ...styles.scaleMark, ...(n === likability ? styles.scaleMarkActive : {}) }}>{n}</span>
                ))}
              </div>
            </div>
            <div style={styles.sliderGroup}>
              <label style={styles.sliderLabel}>能唱度: <span style={styles.sliderValue}>{singability}/10</span></label>
              <input type="range" min="1" max="10" value={singability}
                onChange={(e) => setSingability(Number(e.target.value))} style={styles.range} />
              <div style={styles.scaleMarks}>
                {[1,2,3,4,5,6,7,8,9,10].map(n => (
                  <span key={n} style={{ ...styles.scaleMark, ...(n === singability ? styles.scaleMarkActive : {}) }}>{n}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Comment textarea (larger) */}
          <div style={styles.sectionLabel}>备注/评论</div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="写点感想..."
            style={styles.textarea}
            rows={4}
          />

          {/* Actions */}
          <div style={styles.actionRow}>
            <button onClick={handleSave} disabled={loading}
              style={{ ...styles.saveBtn, opacity: loading ? 0.6 : 1 }}>
              {loading ? '保存中...' : (hasExistingTags ? '更新标签' : '保存标签')}
            </button>
          </div>

          {message && (
            <p style={{ ...styles.msg, color: message.type === 'ok' ? '#4ade80' : '#f87171' }}>
              {message.text}
            </p>
          )}
        </div>
      )}

      {!selectedMusic && <p style={styles.hint}>← 点击左侧列表中的歌曲来编辑标签</p>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {};
const styles = S;

S.card = { background: '#16162a', border: '1px solid #2a2a40', borderRadius: 16, padding: 24 };
S.h3 = { fontSize: 16, fontWeight: 600, color: '#e4e4e7', margin: 0, marginBottom: 16 };
S.listSection = { display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 340 };
S.searchInput = {
  width: '100%', padding: '9px 14px', borderRadius: 10, border: '1px solid #2a2a40',
  background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
S.musicList = { overflowY: 'auto', maxHeight: 260 };
S.emptyText = { textAlign: 'center', color: '#52525b', fontSize: 13, padding: 20 };
S.musicItem = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
  background: 'transparent', transition: 'background 0.15s',
  borderLeft: '3px solid transparent',
};
S.musicItemSelected = { background: '#1e1e38', borderLeftColor: '#6366f1' };
S.musicItemTagged = { background: '#0f0f1e', opacity: 0.85 };
S.musicInfo = { display: 'flex', flexDirection: 'column', gap: 2 };
S.musicTitle = { fontSize: 13, color: '#e4e4e7', fontWeight: 500 };
S.musicArtist = { fontSize: 11, color: '#71717a' };
S.tagIndicator = { display: 'flex', gap: 6, alignItems: 'center' };
S.tagBadge = {
  fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(99,102,241,0.15)',
  color: '#818cf8', whiteSpace: 'nowrap',
};
S.scoreBadge = { fontSize: 10, color: '#f87171', fontWeight: 600 };
S.editorPanel = { marginTop: 16, paddingTop: 16, borderTop: '1px solid #2a2a40' };
S.editorTitle = { fontSize: 14, color: '#d4d4d8', margin: '0 0 12px', fontWeight: 600 };
S.existingTags = { marginBottom: 12 };
S.sectionLabel = { fontSize: 12, color: '#a1a1aa', margin: '8px 0 6px' };
S.tagChips = { display: 'flex', flexWrap: 'wrap', gap: 6 };
S.tagChip = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px', borderRadius: 20, background: '#27273d', fontSize: 11, color: '#d4d4d8',
};
S.chipScore = { fontSize: 10, color: '#818cf8' };
S.tagDelete = {
  background: 'none', border: 'none', color: '#f87171', cursor: 'pointer',
  fontSize: 14, padding: 0, lineHeight: 1,
};
S.presetGrid = { display: 'flex', flexWrap: 'wrap', gap: 6 };
S.presetChip = {
  padding: '5px 12px', borderRadius: 20, border: '1px solid #2a2a40',
  background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 12,
  transition: 'all 0.15s',
};
S.presetChipActive = { borderColor: '#6366f1', background: 'rgba(99,102,241,0.15)', color: '#818cf8' };
S.customTagRow = { display: 'flex', gap: 8, marginTop: 8 };
S.customTagInput = {
  flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #2a2a40',
  background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none',
};
S.addTagBtn = {
  padding: '8px 16px', borderRadius: 8, border: '1px solid #6366f1',
  background: 'rgba(99,102,241,0.15)', color: '#818cf8', cursor: 'pointer', fontSize: 13,
};
S.selectedPreview = { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 };
S.selectedTagChip = {
  padding: '4px 10px', borderRadius: 20, background: '#6366f1', fontSize: 11, color: '#fff',
  display: 'inline-flex', alignItems: 'center', gap: 4,
};
S.slidersRow = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 12 };
S.sliderGroup = { display: 'flex', flexDirection: 'column', gap: 4 };
S.sliderLabel = { fontSize: 12, color: '#a1a1aa' };
S.sliderValue = { color: '#818cf8', fontWeight: 600 };
S.range = { accentColor: '#6366f1' };
S.scaleMarks = { display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#52525b', marginTop: 2 };
S.scaleMark = { width: 16, textAlign: 'center' };
S.scaleMarkActive = { color: '#818cf8', fontWeight: 600 };
S.textarea = {
  width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #2a2a40',
  background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none',
  resize: 'vertical', fontFamily: 'inherit', minHeight: 80, boxSizing: 'border-box',
};
S.actionRow = { display: 'flex', gap: 10, marginTop: 12 };
S.saveBtn = {
  flex: 1, padding: '10px', borderRadius: 10, border: 'none',
  background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
S.msg = { fontSize: 13, margin: '8px 0 0', minHeight: 18 };
S.hint = { textAlign: 'center', color: '#52525b', fontSize: 13, fontStyle: 'italic', marginTop: 12 };
