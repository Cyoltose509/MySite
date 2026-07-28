'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getQuickSearchIndex } from '@/lib/search';
import { C, searchInputStyle, badgeStyle } from '@/lib/card-styles';

interface Person {
  id: string;
  name: string;
  rating: number | null;
  apt: string | null;
  tags: string[];
  nickname: string | null;
}

type RelKey = 'lover' | 'crush' | 'friend' | 'enemy' | 'roommate';

const REL_TYPES: { key: RelKey; label: string; color: string; reciprocal: boolean }[] = [
  { key: 'lover', label: '恋人', color: '#f472b6', reciprocal: true },
  { key: 'crush', label: '单相思', color: '#fb923c', reciprocal: false },
  { key: 'friend', label: '好朋友', color: '#4ade80', reciprocal: true },
  { key: 'enemy', label: '死对头', color: '#f87171', reciprocal: true },
  { key: 'roommate', label: '同宿舍', color: '#38bdf8', reciprocal: true },
];

// 从夯到拉（5 夯 … 1 拉完了）
const RATING_SCALE = [
  { label: '夯', value: 5 },
  { label: '顶级', value: 4 },
  { label: '人上人', value: 3 },
  { label: 'NPC', value: 2 },
  { label: '拉完了', value: 1 },
];
const RATING_COLOR: Record<number, string> = { 5: '#a855f7', 4: '#4ade80', 3: '#eab308', 2: '#6b7280', 1: '#f87171' };

function ratingLabel(v: number | null): string {
  if (v == null) return '未评';
  return RATING_SCALE.find((r) => r.value === v)?.label ?? '未评';
}

const EMPTY_REL: Record<RelKey, string[]> = { lover: [], crush: [], friend: [], enemy: [], roommate: [] };

// 把关系行聚合成「每人 → 各关系类型下的名字列表」（恋人/好朋友/死对头/同宿舍双向，单相思仅单向）
function buildRelationMap(people: Person[], relations: any[]): Record<string, Record<RelKey, string[]>> {
  const idToName = new Map(people.map((p) => [p.id, p.name]));
  const map: Record<string, Record<RelKey, string[]>> = {};
  people.forEach((p) => (map[p.id] = { lover: [], crush: [], friend: [], enemy: [], roommate: [] }));
  (relations || []).forEach((r) => {
    const s = idToName.get(r.source_id);
    const t = idToName.get(r.target_id);
    const src = map[r.source_id];
    if (!s || !t || !src) return;
    const rt = r.rel_type as RelKey;
    // 双向关系在库里存了 A→B 与 B→A 两条；聚合时只处理「自己为 source」的那条即可
    // （反向行会为对方补全），否则会重复。crush 仅单向，本来也只有 source→target 一条。
    src[rt].push(t);
  });
  return map;
}

// 表格列宽：名字 / 从夯到拉 / apt / 标签 / 同宿舍 / 恋人 / 单相思 / 好朋友 / 死对头
const GRID = '1.7fr 0.9fr 0.7fr 1.8fr 1.2fr 1.1fr 1.1fr 1.1fr 1.1fr';

type SortKey = 'name' | 'rating' | 'apt' | 'tags' | RelKey;

const COLS: { key: SortKey; label: string; color?: string }[] = [
  { key: 'name', label: '名字' },
  { key: 'rating', label: '从夯到拉' },
  { key: 'apt', label: 'apt' },
  { key: 'tags', label: '标签' },
  { key: 'roommate', label: '同宿舍', color: '#38bdf8' },
  { key: 'lover', label: '恋人', color: '#f472b6' },
  { key: 'crush', label: '单相思', color: '#fb923c' },
  { key: 'friend', label: '好朋友', color: '#4ade80' },
  { key: 'enemy', label: '死对头', color: '#f87171' },
];

// 关系名 → 颜色（与表头一致），用于把关系名单渲染成圆角 chip
const REL_COLOR: Record<RelKey, string> = {
  roommate: '#38bdf8', lover: '#f472b6', crush: '#fb923c', friend: '#4ade80', enemy: '#f87171',
};

function RelChips({ names, color }: { names: string[]; color: string }) {
  if (!names.length) return <span style={{ color: C.textDim }}>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {names.map((n) => (
        <span key={n} style={{ fontSize: 10, color, background: color + '22', padding: '2px 7px', borderRadius: 8, whiteSpace: 'nowrap' }}>{n}</span>
      ))}
    </div>
  );
}

export function PeopleEditor() {
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [rating, setRating] = useState<number>(3);
  const [apt, setApt] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [nickname, setNickname] = useState('');
  const [rel, setRel] = useState<Record<RelKey, string[]>>({ lover: [], crush: [], friend: [], enemy: [], roommate: [] });

  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [relByPerson, setRelByPerson] = useState<Record<string, Record<RelKey, string[]>>>({});

  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const fetchData = async () => {
    setLoading(true);
    const [{ data: ps }, { data: rs }] = await Promise.all([
      supabase.from('people').select('*').order('name'),
      supabase.from('people_relations').select('source_id,target_id,rel_type'),
    ]);
    const ppl = (ps as Person[]) || [];
    setPeople(ppl);
    setRelByPerson(buildRelationMap(ppl, (rs as any[]) || []));
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const nameToId = useMemo(() => {
    const m = new Map<string, string>();
    people.forEach((p) => m.set(p.name, p.id));
    return m;
  }, [people]);

  const presetTags = useMemo(() => {
    const s = new Set<string>();
    people.forEach((p) => (p.tags || []).forEach((t) => s.add(t)));
    return [...s].sort();
  }, [people]);

  const filtered = useMemo(() => {
    if (!search.trim()) return people;
    const q = search.toLowerCase();
    return people.filter((p) =>
      getQuickSearchIndex(p.name.toLowerCase()).includes(q) ||
      getQuickSearchIndex((p.nickname || '').toLowerCase()).includes(q) ||
      (p.tags || []).some((t) => getQuickSearchIndex(t.toLowerCase()).includes(q))
    );
  }, [people, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name, 'zh-Hans-CN'); break;
        case 'rating': cmp = (a.rating ?? 0) - (b.rating ?? 0); break;
        case 'apt': cmp = (a.apt || '').localeCompare(b.apt || ''); break;
        case 'tags': cmp = (a.tags?.length || 0) - (b.tags?.length || 0); break;
        case 'roommate':
        case 'lover':
        case 'crush':
        case 'friend':
        case 'enemy':
          cmp = (relByPerson[a.id]?.[sortKey].length || 0) - (relByPerson[b.id]?.[sortKey].length || 0);
          break;
      }
      return cmp * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir, relByPerson]);

  const selected = people.find((p) => p.id === selectedId) || null;
  const open = selected || adding;

  const resetForm = () => {
    setSelectedId(null); setAdding(false);
    setName(''); setRating(3); setApt(''); setTags([]);
    setNickname(''); setRel({ lover: [], crush: [], friend: [], enemy: [], roommate: [] });
    setTagInput('');
  };

  const handleSelect = async (p: Person) => {
    setSelectedId(p.id); setAdding(false); setMsg(null);
    setName(p.name); setRating(p.rating ?? 3); setApt(p.apt || '');
    setTags(p.tags || []); setNickname(p.nickname || '');
    // load relations
    const { data } = await supabase
      .from('people_relations')
      .select('source_id, target_id, rel_type')
      .or(`source_id.eq.${p.id},target_id.eq.${p.id}`);
    const next: Record<RelKey, string[]> = { lover: [], crush: [], friend: [], enemy: [], roommate: [] };
    const idToName = new Map(people.map((x) => [x.id, x.name]));
    (data || []).forEach((r: any) => {
      // 双向关系存了 A→B 与 B→A 两条，只处理「自己为 source」的那条，避免重复
      if (r.source_id !== p.id) return;
      const n = idToName.get(r.target_id);
      if (n) next[r.rel_type as RelKey].push(n);
    });
    setRel(next);
  };

  const toggleArr = (arr: string[], v: string): string[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const addCustom = (val: string, setter: (v: string) => void, arr: string[], setArr: (a: string[]) => void) => {
    const v = val.trim();
    if (!v) return;
    if (!arr.includes(v)) setArr([...arr, v]);
    setter('');
  };

  const handleSave = async () => {
    if (!name.trim()) { setMsg({ text: '❌ 名字不能为空', ok: false }); return; }
    setSaving(true); setMsg(null);
    try {
      let myId = selectedId;
      if (adding || !myId) {
        const { data, error } = await supabase
          .from('people')
          .insert({ name: name.trim(), rating, apt: apt || null, tags, nickname: nickname || null })
          .select('id');
        if (error) throw error;
        myId = (data as any[])[0].id;
        setSelectedId(myId); setAdding(false);
      } else {
        const { error } = await supabase
          .from('people')
          .update({ name: name.trim(), rating, apt: apt || null, tags, nickname: nickname || null, updated_at: new Date().toISOString() })
          .eq('id', myId);
        if (error) throw error;
      }
      // rebuild relations
      const reciprocal = REL_TYPES.filter((t) => t.reciprocal).map((t) => t.key);
      for (const t of reciprocal) {
        await supabase
          .from('people_relations')
          .delete()
          .or(`source_id.eq.${myId},target_id.eq.${myId}`)
          .eq('rel_type', t);
      }
      await supabase.from('people_relations').delete().eq('source_id', myId).eq('rel_type', 'crush');

      const rows: any[] = [];
      for (const t of REL_TYPES) {
        for (const nm of rel[t.key]) {
          const tid = nameToId.get(nm);
          if (!tid || tid === myId) continue;
          if (t.reciprocal) {
            rows.push({ source_id: myId, target_id: tid, rel_type: t.key });
            rows.push({ source_id: tid, target_id: myId, rel_type: t.key });
          } else {
            rows.push({ source_id: myId, target_id: tid, rel_type: t.key });
          }
        }
      }
      if (rows.length) {
        const { error } = await supabase.from('people_relations').insert(rows);
        if (error) throw error;
      }
      setMsg({ text: '✅ 已保存', ok: true });
      fetchData();
      resetForm(); // 保存后收起右侧编辑栏
    } catch (e: any) {
      setMsg({ text: '❌ ' + (e?.message || e), ok: false });
    }
    setSaving(false);
    setTimeout(() => setMsg(null), 2500);
  };

  const handleDelete = async () => {
    if (!selectedId || !confirm(`确定删除「${name}」？相关关系也会一并删除`)) return;
    await supabase.from('people').delete().eq('id', selectedId);
    resetForm();
    fetchData();
  };

  const handleExport = async () => {
    const { data: ps } = await supabase.from('people').select('*').order('name');
    const { data: rs } = await supabase.from('people_relations').select('source_id,target_id,rel_type');
    const relMap = buildRelationMap((ps as Person[]) || [], (rs as any[]) || []);
    const escCsv = (v: string) => {
      if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
      return v;
    };
    const header = ['名字', '从夯到拉', 'apt', '标签', '同宿舍', '外号', '恋人', '单相思', '好朋友', '死对头'];
    const lines = [header.map(escCsv).join(',')];
    (ps as Person[]).forEach((p) => {
      const m = relMap[p.id];
      lines.push([
        p.name,
        ratingLabel(p.rating),
        p.apt || '',
        (p.tags || []).join(','),
        (m?.roommate || []).join(','),
        p.nickname || '',
        (m?.lover || []).join(','),
        (m?.crush || []).join(','),
        (m?.friend || []).join(','),
        (m?.enemy || []).join(','),
      ].map(escCsv).join(','));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '人物总览导出.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const chipBtn = (active: boolean, color: string): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 14, border: '1px solid ' + (active ? color : '#27273d'),
    background: active ? color + '22' : 'transparent', color: active ? color : C.textDim,
    cursor: 'pointer', fontSize: 11,
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 搜索名字 / 外号 / 标签"
          style={{ ...searchInputStyle, maxWidth: 360 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { resetForm(); setAdding(true); }}
            style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid ' + C.accent, background: 'rgba(99,102,241,0.12)', color: C.accent, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
            ➕ 添加人物
          </button>
          <button onClick={handleExport}
            style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid #27273d', background: 'transparent', color: C.textSec, fontSize: 13, cursor: 'pointer' }}>
            ⬇️ 导出表格
          </button>
        </div>
      </div>

      {msg && <p style={{ fontSize: 13, color: msg.ok ? '#4ade80' : '#f87171', margin: '0 0 12px' }}>{msg.text}</p>}

      {loading ? (
        <p style={{ color: C.textDim, fontSize: 13 }}>加载中…</p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid ' + C.border, borderRadius: 12 }}>
          <div style={{ minWidth: 940 }}>
            {/* 表头 */}
            <div style={{
              display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '9px 14px',
              fontSize: 11, fontWeight: 600, borderBottom: '1px solid ' + C.border,
              background: '#16162a', position: 'sticky', top: 0, zIndex: 1, userSelect: 'none',
            }}>
              {COLS.map((c) => {
                const active = sortKey === c.key;
                return (
                  <span key={c.key} onClick={() => onSort(c.key)} title={`按${c.label}排序`}
                    style={{
                      color: active ? C.text : (c.color || C.textDim), cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                    }}>
                    {c.label}
                    <span style={{ fontSize: 9, opacity: active ? 1 : 0.35 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </span>
                );
              })}
            </div>
            {/* 数据行 */}
            {sorted.map((p) => {
              const isSel = p.id === selectedId;
              const m = relByPerson[p.id] || EMPTY_REL;
              const cell: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: C.textSec };
              return (
                <div key={p.id} onClick={() => handleSelect(p)} title={p.name}
                  style={{
                    display: 'grid', gridTemplateColumns: GRID, gap: 8, alignItems: 'center',
                    padding: '8px 14px', fontSize: 12, borderBottom: '1px solid #1a1a2c',
                    background: isSel ? 'rgba(99,102,241,0.10)' : 'transparent', cursor: 'pointer',
                  }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ color: C.text, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    {p.nickname && <div style={{ fontSize: 10, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>「{p.nickname}」</div>}
                  </div>
                  <span style={{ ...badgeStyle(RATING_COLOR[p.rating ?? 2]), fontSize: 11 }}>{ratingLabel(p.rating)}</span>
                  <span style={{ ...cell }}>{p.apt || '—'}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    {(p.tags || []).length ? (
                      p.tags.map((t) => (
                        <span key={t} style={{ fontSize: 10, color: C.textSec, background: '#1c1c30', padding: '2px 7px', borderRadius: 8, whiteSpace: 'nowrap' }}>{t}</span>
                      ))
                    ) : (
                      <span style={{ color: C.textDim }}>—</span>
                    )}
                  </div>
                  <RelChips names={m.roommate} color={REL_COLOR.roommate} />
                  <RelChips names={m.lover} color={REL_COLOR.lover} />
                  <RelChips names={m.crush} color={REL_COLOR.crush} />
                  <RelChips names={m.friend} color={REL_COLOR.friend} />
                  <RelChips names={m.enemy} color={REL_COLOR.enemy} />
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: '16px 14px', color: C.textDim, fontSize: 13 }}>没有匹配的人物</div>
            )}
          </div>
        </div>
      )}

      {/* ── Editor Panel ── */}
      {open && (
        <div style={{
          position: 'fixed', top: 0, right: 0, width: 440, maxWidth: '92vw', height: '100vh',
          background: C.bg, borderLeft: '1px solid #1e1e32', zIndex: 100, overflowY: 'auto',
          padding: '20px 24px', boxShadow: '-8px 0 24px rgba(0,0,0,.6)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{adding ? '➕ 新人物' : '✏️ 编辑'}</span>
            <button onClick={resetForm} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>

          {/* name */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>名字</p>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #27273d', background: '#121224', color: C.text, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* rating single-select */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>从夯到拉（单选）</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {RATING_SCALE.map((r) => (
                <button key={r.value} onClick={() => setRating(r.value)} style={{
                  flex: 1, padding: '6px 0', borderRadius: 8, border: '1px solid ' + (rating === r.value ? RATING_COLOR[r.value] : '#27273d'),
                  background: rating === r.value ? RATING_COLOR[r.value] : 'transparent', color: rating === r.value ? '#fff' : C.textDim,
                  fontSize: 12, cursor: 'pointer', fontWeight: 600,
                }}>{r.label}</button>
              ))}
            </div>
          </div>

          {/* apt */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>apt（分组）</p>
            <input value={apt} onChange={(e) => setApt(e.target.value)} placeholder="如 a / p / t" style={{ width: 120, padding: '6px 10px', borderRadius: 8, border: '1px solid #27273d', background: '#121224', color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* tags multi */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>标签（多选）</p>
            {tags.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                {tags.map((t) => <span key={t} onClick={() => setTags(tags.filter((x) => x !== t))} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 14, background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontSize: 11, cursor: 'pointer' }}>{t} ×</span>)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {presetTags.map((t) => <button key={t} onClick={() => setTags(toggleArr(tags, t))} style={chipBtn(tags.includes(t), C.accent)}>{t}</button>)}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(tagInput, setTagInput, tags, setTags); }}
                placeholder="自定义标签" style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #27273d', background: '#121224', color: C.text, fontSize: 12, outline: 'none' }} />
              <button onClick={() => addCustom(tagInput, setTagInput, tags, setTags)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #27273d', background: 'transparent', color: C.textDim, fontSize: 11, cursor: 'pointer' }}>添加</button>
            </div>
          </div>

          {/* nickname */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: C.text, marginBottom: 6 }}>绰号（可填）</p>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="如 坤坤（多个可用逗号分隔）" style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #27273d', background: '#121224', color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* relations */}
          <div style={{ marginBottom: 14, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>人物关系</p>
            {REL_TYPES.map((rt) => (
              <RelationPicker key={rt.key} label={rt.label} color={rt.color} reciprocal={rt.reciprocal}
                people={people} selfId={selectedId} selected={rel[rt.key]}
                onChange={(v) => setRel((prev) => ({ ...prev, [rt.key]: v }))} />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button onClick={handleSave} disabled={saving}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: C.accent, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? '保存中...' : '💾 保存'}
            </button>
            {selected && (
              <button onClick={handleDelete} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #f87171', background: 'transparent', color: '#f87171', fontSize: 13, cursor: 'pointer' }}>🗑</button>
            )}
          </div>
          {msg && <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: msg.ok ? '#4ade80' : '#f87171' }}>{msg.text}</div>}
        </div>
      )}
    </div>
  );
}

function RelationPicker({ label, color, reciprocal, people, selfId, selected, onChange }: {
  label: string; color: string; reciprocal: boolean;
  people: Person[]; selfId: string | null; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const toggle = (nm: string) => onChange(selected.includes(nm) ? selected.filter((x) => x !== nm) : [...selected, nm]);
  const candidates = useMemo(() => {
    const qq = q.toLowerCase();
    return people
      .filter((p) => p.id !== selfId && !selected.includes(p.name))
      .filter((p) => !qq || getQuickSearchIndex(p.name.toLowerCase()).includes(qq))
      .slice(0, 12);
  }, [people, selfId, selected, q]);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color, fontWeight: 600 }}>{label}</span>
        {reciprocal && <span style={{ fontSize: 10, color: C.textDim }}>双向</span>}
        {!reciprocal && <span style={{ fontSize: 10, color: C.textDim }}>单向</span>}
      </div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
          {selected.map((nm) => <span key={nm} onClick={() => toggle(nm)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 14, background: color + '22', color, fontSize: 11, cursor: 'pointer' }}>{nm} ×</span>)}
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`搜索并添加${label}…`} style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid #27273d', background: '#121224', color: C.text, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
      {candidates.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {candidates.map((p) => (
            <button key={p.id} onClick={() => { toggle(p.name); setQ(''); }} style={{ padding: '3px 9px', borderRadius: 12, border: '1px solid ' + color + '55', background: 'transparent', color: C.textSec, fontSize: 11, cursor: 'pointer' }}>+ {p.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
