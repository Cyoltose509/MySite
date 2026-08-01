'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getQuickSearchIndex } from '@/lib/search';
import { C, searchInputStyle } from '@/lib/card-styles';

interface Person {
  id: string;
  name: string;
  nickname: string | null;
  tags: string[];
}

const TAG_COLOR = '#34d399';

function TagChip({ label, count, active, onClick, onDelete }: { label: string; count: number; active: boolean; onClick: () => void; onDelete?: () => void }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 4px 3px 11px', borderRadius: 14,
      border: '1px solid ' + (active ? TAG_COLOR : '#27273d'),
      background: active ? TAG_COLOR + '22' : 'transparent', whiteSpace: 'nowrap',
    }}>
      <button onClick={onClick} style={{ background: 'none', border: 'none', color: active ? TAG_COLOR : C.textSec, cursor: 'pointer', fontSize: 12, fontWeight: active ? 600 : 400, padding: 0 }}>{label}</button>
      <span style={{ fontSize: 10, color: active ? '#fff' : C.textDim, background: active ? TAG_COLOR + '55' : '#1c1c30', padding: '0 6px', borderRadius: 8 }}>{count}</span>
      {onDelete && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="删除标签"
          style={{ background: 'none', border: 'none', color: active ? TAG_COLOR : C.textDim, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', marginLeft: -2 }}>×</button>
      )}
    </span>
  );
}

export function PeopleTagEditor() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [extraTags, setExtraTags] = useState<string[]>([]); // 用户新建但尚未分配给任何人的标签（仅当前会话）
  const [newTag, setNewTag] = useState('');
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase.from('people').select('id,name,nickname,tags').order('name');
    const ppl = (data as Person[]) || [];
    setPeople(ppl.map((p) => ({ ...p, tags: p.tags || [] })));
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // 标签主键列表 = 所有人物标签的并集 + 用户新建的空标签
  const tagList = useMemo(() => {
    const s = new Set<string>();
    people.forEach((p) => (p.tags || []).forEach((t) => s.add(t)));
    extraTags.forEach((t) => s.add(t));
    return [...s].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [people, extraTags]);

  // 每个标签对应的人数
  const tagCounts = useMemo(() => {
    const m: Record<string, number> = {};
    people.forEach((p) => (p.tags || []).forEach((t) => { m[t] = (m[t] || 0) + 1; }));
    return m;
  }, [people]);

  useEffect(() => {
    if (!selectedTag && tagList.length) setSelectedTag(tagList[0]);
  }, [tagList, selectedTag]);

  const filteredPeople = useMemo(() => {
    if (!search.trim()) return people;
    const q = search.toLowerCase();
    return people.filter(
      (p) =>
        getQuickSearchIndex(p.name.toLowerCase()).includes(q) ||
        getQuickSearchIndex((p.nickname || '').toLowerCase()).includes(q),
    );
  }, [people, search]);

  const addTag = () => {
    const v = newTag.trim();
    if (!v || tagList.includes(v)) { setNewTag(''); return; }
    setExtraTags((prev) => [...prev, v]);
    setSelectedTag(v);
    setNewTag('');
  };

  const deleteTag = async (tag: string) => {
    if (!confirm(`确定删除标签「${tag}」？会从所有人的标签里移除它`)) return;
    const affected = people.filter((p) => (p.tags || []).includes(tag));
    // 乐观更新：本地先移除
    setPeople((prev) => prev.map((x) => (x.tags || []).includes(tag) ? { ...x, tags: x.tags.filter((t) => t !== tag) } : x));
    setExtraTags((prev) => prev.filter((t) => t !== tag));
    if (selectedTag === tag) {
      const rest = tagList.filter((t) => t !== tag);
      setSelectedTag(rest.length ? rest[0] : null);
    }
    try {
      for (const p of affected) {
        const nextTags = (p.tags || []).filter((t) => t !== tag);
        const { error } = await supabase
          .from('people')
          .update({ tags: nextTags, updated_at: new Date().toISOString() })
          .eq('id', p.id);
        if (error) throw error;
      }
      setMsg({ text: `✅ 已删除标签「${tag}」`, ok: true });
    } catch (e: any) {
      setMsg({ text: '❌ ' + (e?.message || e), ok: false });
      fetchData(); // 失败回滚
    }
    setTimeout(() => setMsg(null), 2500);
  };

  const togglePerson = async (p: Person) => {
    if (!selectedTag) return;
    const has = (p.tags || []).includes(selectedTag);
    const nextTags = has ? p.tags.filter((t) => t !== selectedTag) : [...p.tags, selectedTag];
    // 乐观更新
    setPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, tags: nextTags } : x)));
    setSavingId(p.id);
    try {
      const { error } = await supabase
        .from('people')
        .update({ tags: nextTags, updated_at: new Date().toISOString() })
        .eq('id', p.id);
      if (error) throw error;
    } catch (e: any) {
      // 回滚
      setPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, tags: p.tags } : x)));
      setMsg({ text: '❌ ' + (e?.message || e), ok: false });
      setTimeout(() => setMsg(null), 2500);
    }
    setSavingId(null);
  };

  const selectedCount = selectedTag ? (tagCounts[selectedTag] || 0) : 0;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>
          以标签为主键：选一个标签，下面列出所有人，逐个切换「有 / 无」。切换即时保存到数据库。
        </p>
      </div>

      {msg && <p style={{ fontSize: 13, color: msg.ok ? '#4ade80' : '#f87171', margin: '0 0 12px' }}>{msg.text}</p>}

      {loading ? (
        <p style={{ color: C.textDim, fontSize: 13 }}>加载中…</p>
      ) : (
        <>
          {/* 标签主键选择区 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center', marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid ' + C.border }}>
            {tagList.map((t) => (
              <TagChip key={t} label={t} count={tagCounts[t] || 0} active={selectedTag === t} onClick={() => setSelectedTag(t)} onDelete={() => deleteTag(t)} />
            ))}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTag(); }}
                placeholder="新建标签" style={{ width: 120, padding: '5px 10px', borderRadius: 14, border: '1px solid #27273d', background: '#121224', color: C.text, fontSize: 12, outline: 'none' }} />
              <button onClick={addTag} style={{ padding: '5px 12px', borderRadius: 14, border: '1px solid ' + TAG_COLOR, background: 'transparent', color: TAG_COLOR, fontSize: 12, cursor: 'pointer' }}>+ 新建</button>
            </div>
          </div>

          {!selectedTag ? (
            <p style={{ color: C.textDim, fontSize: 13 }}>请选择一个标签</p>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
                  「{selectedTag}」：<span style={{ color: TAG_COLOR }}>{selectedCount}</span> / {people.length} 人
                </span>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 搜索人物（支持拼音）"
                  style={{ ...searchInputStyle, maxWidth: 280 }} />
              </div>

              <div style={{ maxHeight: '62vh', overflowY: 'auto', border: '1px solid ' + C.border, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  {filteredPeople.map((p) => {
                    const has = (p.tags || []).includes(selectedTag!);
                    const saving = savingId === p.id;
                    return (
                      <button key={p.id} onClick={() => togglePerson(p)} disabled={saving}
                        title={p.nickname ? `「${p.nickname}」` : undefined} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 14,
                        border: '1px solid ' + (has ? TAG_COLOR : '#3a3a5a'),
                        background: has ? TAG_COLOR + '22' : 'transparent',
                        color: has ? TAG_COLOR : C.textSec, cursor: 'pointer', fontSize: 12,
                        fontWeight: has ? 600 : 400, opacity: saving ? 0.6 : 1, whiteSpace: 'nowrap',
                      }}>
                        {has && <span style={{ fontSize: 10 }}>✓</span>}
                        {p.name}
                      </button>
                    );
                  })}
                  {filteredPeople.length === 0 && (
                    <span style={{ color: C.textDim, fontSize: 13 }}>没有匹配的人物</span>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
