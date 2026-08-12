'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { LocationAutocomplete } from '@/components/LocationAutocomplete';
import { filterCountrySuggestions, filterProvinceSuggestions, filterCitySuggestions } from '@/lib/locations-data';
import { effectivePlace, LOCATION_TAGS, TAG_META, type LocationTag } from '@/lib/location-place';

interface LocationStay {
  id: string;
  started_at: string;
  ended_at: string | null;
  country: string;
  province: string | null;
  city: string | null;
  tag: string;
  note: string | null;
  created_at: string;
}

const HOUR = 3600 * 1000;

function fmtDateInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtHour(ms: number): string {
  return String(new Date(ms).getHours()).padStart(2, '0');
}
function combineDateTime(dateStr: string, hourStr: string): number {
  const t = new Date(`${dateStr}T${hourStr || '00'}:00`).getTime();
  return isNaN(t) ? Date.now() : t;
}
function fmtLabel(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}时`;
}
function fmtRange(s?: number | null, e?: number | null, ongoing?: boolean): string {
  const a = s ? fmtLabel(s) : '?';
  const b = ongoing || e == null ? '至今' : fmtLabel(e);
  return `${a} → ${b}`;
}

export function LocationEditor() {
  const [stays, setStays] = useState<LocationStay[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  // 表单：国家 / 省 / 市（最小到市；国外只需国家）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [startMs, setStartMs] = useState<number>(Date.now() - 30 * 24 * HOUR);
  const [endMs, setEndMs] = useState<number>(Date.now());
  const [ongoing, setOngoing] = useState<boolean>(false);
  const [country, setCountry] = useState('中国');
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');
  const [tag, setTag] = useState<LocationTag>('其他');
  const [note, setNote] = useState('');

  const isChina = country === '中国' || country === '';

  useEffect(() => { fetchStays(); }, []);

  const fetchStays = async () => {
    setLoading(true);
    const hash = getSession();
    if (hash) {
      const { data, error } = await supabase.rpc('fn_get_location_stays', { p_hash: hash });
      if (!error && data && !data.error) {
        setStays(data as LocationStay[]);
        setLoading(false);
        return;
      }
    }
    setStays([]);
    setLoading(false);
  };

  // 时间轴滑动窗口已移除（用户不需要时间窗口 UI），仅保留日期+小时精确输入

  const loadForEdit = (s: LocationStay) => {
    setEditingId(s.id);
    setStartMs(new Date(s.started_at).getTime());
    const endT = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
    setEndMs(endT);
    setOngoing(!s.ended_at);
    setCountry(s.country || '中国');
    setProvince(s.province || '');
    setCity(s.city || '');
    setTag(((LOCATION_TAGS as readonly string[]).includes(s.tag) ? s.tag : '其他') as LocationTag);
    setNote(s.note || '');
    setMsg(null);
  };

  const resetForm = () => {
    setEditingId(null);
    setStartMs(Date.now() - 30 * 24 * HOUR);
    setEndMs(Date.now());
    setOngoing(false);
    setCountry('中国');
    setProvince('');
    setCity('');
    setTag('其他');
    setNote('');
  };

  const save = async () => {
    if (isChina) {
      if (!city.trim() && !province.trim()) { setMsg({ text: '国内位置请至少填写城市或省份', type: 'err' }); return; }
    } else if (!country.trim()) {
      setMsg({ text: '请选择国家', type: 'err' });
      return;
    }
    if (!ongoing && endMs <= startMs) { setMsg({ text: '结束时间需晚于开始时间', type: 'err' }); return; }
    setLoading(true);
    const hash = getSession() || '';
    const { data, error } = await supabase.rpc('fn_upsert_location_stay', {
      p_hash: hash,
      p_id: editingId || null,
      p_started_at: new Date(startMs).toISOString(),
      p_ended_at: ongoing ? null : new Date(endMs).toISOString(),
      p_country: isChina ? '中国' : country.trim(),
      p_province: isChina ? (province.trim() || null) : null,
      p_city: isChina ? (city.trim() || null) : null,
      p_tag: tag,
      p_note: note.trim() || null,
    });
    if (error) setMsg({ text: `❌ ${error.message}`, type: 'err' });
    else if (data?.error) setMsg({ text: `❌ ${data.error}`, type: 'err' });
    else {
      setMsg({ text: editingId ? '✅ 已更新' : '✅ 已添加', type: 'ok' });
      resetForm();
      fetchStays();
    }
    setLoading(false);
    setTimeout(() => setMsg(null), 2500);
  };

  const del = async (id: string) => {
    if (!confirm('确定删除这条位置记录？')) return;
    const { data, error } = await supabase.rpc('fn_delete_location_stay', { p_hash: getSession() || '', p_id: id });
    if (error) setMsg({ text: `❌ ${error.message}`, type: 'err' });
    else if (data?.error) setMsg({ text: `❌ ${data.error}`, type: 'err' });
    else { setMsg({ text: '✅ 已删除', type: 'ok' }); fetchStays(); }
    setTimeout(() => setMsg(null), 2500);
  };

  const iS: React.CSSProperties = {
    padding: '8px 10px', borderRadius: 8, border: '1px solid #2a2a40',
    background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={styles.wrap}>
      <h3 style={styles.h3}>📍 位置停留</h3>
      {msg && <p style={{ fontSize: 13, color: msg.type === 'ok' ? '#4ade80' : '#f87171', margin: '0 0 12px' }}>{msg.text}</p>}

      {/* 编辑卡片 */}
      <div style={{ ...styles.section, background: '#0a0a18', border: '1px solid #2a2a40' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e4e4e7', marginBottom: 10 }}>
          {editingId ? '✏️ 编辑位置记录' : '➕ 新增位置记录'}
        </div>

        {/* 精确输入（日期 + 小时，不取分钟） */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: '#a1a1aa', display: 'flex', flexDirection: 'column', gap: 4 }}>
            开始日期
            <input type="date" value={fmtDateInput(startMs)}
              onChange={e => setStartMs(combineDateTime(e.target.value, fmtHour(startMs)))} style={{ ...iS, width: 160 }} />
          </label>
          <label style={{ fontSize: 11, color: '#a1a1aa', display: 'flex', flexDirection: 'column', gap: 4 }}>
            开始小时
            <select value={fmtHour(startMs)}
              onChange={e => setStartMs(combineDateTime(fmtDateInput(startMs), e.target.value))}
              style={{ ...iS, width: 90 }}>
              {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')).map(h => (
                <option key={h} value={h}>{h} 时</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 11, color: '#a1a1aa', display: 'flex', flexDirection: 'column', gap: 4 }}>
            结束日期
            <input type="date" value={ongoing ? '' : fmtDateInput(endMs)} disabled={ongoing}
              onChange={e => setEndMs(combineDateTime(e.target.value, fmtHour(endMs)))}
              style={{ ...iS, width: 160, opacity: ongoing ? 0.4 : 1 }} />
          </label>
          <label style={{ fontSize: 11, color: '#a1a1aa', display: 'flex', flexDirection: 'column', gap: 4 }}>
            结束小时
            <select value={ongoing ? '00' : fmtHour(endMs)} disabled={ongoing}
              onChange={e => setEndMs(combineDateTime(fmtDateInput(endMs), e.target.value))}
              style={{ ...iS, width: 90, opacity: ongoing ? 0.4 : 1 }}>
              {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')).map(h => (
                <option key={h} value={h}>{h} 时</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 4, marginTop: 16 }}>
            <input type="checkbox" checked={ongoing} onChange={e => setOngoing(e.target.checked)} /> 至今（当前所在地）
          </label>
        </div>

        {/* 标签：家 / 学校 / 旅游 / 其他 */}
        <div style={{ fontSize: 11, color: '#a1a1aa', marginBottom: 6 }}>标签</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {LOCATION_TAGS.map(t => {
            const active = tag === t;
            const c = TAG_META[t].color;
            return (
              <button key={t} type="button" onClick={() => setTag(t)} style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 600,
                background: active ? c : '#121224', color: active ? '#0d0d1a' : '#a1a1aa',
                border: `1px solid ${active ? c : '#2a2a40'}`,
              }}>{TAG_META[t].icon} {t}</button>
            );
          })}
        </div>

        {/* 位置：国家 / 省 / 市 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: '#a1a1aa', display: 'flex', flexDirection: 'column', gap: 4 }}>
            国家
            <LocationAutocomplete value={country} onChange={setCountry} filter={filterCountrySuggestions}
              placeholder="如 中国 / 日本" style={{ ...iS, width: 160 }} />
          </label>
          {isChina && (
            <label style={{ fontSize: 11, color: '#a1a1aa', display: 'flex', flexDirection: 'column', gap: 4 }}>
              省份（国内可选）
              <LocationAutocomplete value={province} onChange={setProvince} filter={filterProvinceSuggestions}
                placeholder="如 湖北省" style={{ ...iS, width: 160 }} />
            </label>
          )}
          {isChina && (
            <label style={{ fontSize: 11, color: '#a1a1aa', display: 'flex', flexDirection: 'column', gap: 4 }}>
              城市（必填，最小到市）
              <LocationAutocomplete value={city} onChange={setCity} filter={filterCitySuggestions}
                placeholder="如 武汉市" style={{ ...iS, width: 160 }} />
            </label>
          )}
        </div>
        {!isChina && (
          <p style={{ fontSize: 11, color: '#52525b', marginTop: -4, marginBottom: 12 }}>
            国外位置无需填写省/市，地图按国家标注。
          </p>
        )}

        <label style={{ fontSize: 11, color: '#a1a1aa', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          备注
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="选填" style={{ ...iS, width: '100%' }} />
        </label>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={save} disabled={loading} style={{ ...styles.saveBtn, opacity: loading ? 0.6 : 1 }}>
            {editingId ? '💾 更新' : '➕ 添加'}
          </button>
          {editingId && <button onClick={resetForm} style={styles.cancelBtn}>取消</button>}
        </div>
        <p style={{ fontSize: 11, color: '#52525b', marginTop: 8 }}>
          预览：{effectivePlace({ country, province, city })} ｜ {TAG_META[tag].icon} {tag} ｜ {fmtRange(startMs, endMs, ongoing)}
        </p>
      </div>

      {/* 列表 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>📋 全部记录（{stays.length} 条）</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
          {stays.length === 0 && <p style={{ textAlign: 'center', color: '#52525b', fontSize: 13, padding: 20 }}>暂无记录</p>}
          {stays.map(s => {
            const sMs = new Date(s.started_at).getTime();
            const eMs = s.ended_at ? new Date(s.ended_at).getTime() : null;
            return (
              <div key={s.id} style={styles.row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#e4e4e7' }}>
                    📍 {effectivePlace(s)}
                    <span style={{ marginLeft: 8, fontSize: 11, color: TAG_META[(LOCATION_TAGS as readonly string[]).includes(s.tag) ? s.tag as LocationTag : '其他'].color }}>
                      {TAG_META[(LOCATION_TAGS as readonly string[]).includes(s.tag) ? s.tag as LocationTag : '其他'].icon} {s.tag}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#a1a1aa', fontFamily: 'monospace', marginTop: 2 }}>
                    {fmtRange(sMs, eMs, !s.ended_at)}
                  </div>
                  {s.note && <div style={{ fontSize: 11, color: '#71717a', marginTop: 2 }}>{s.note}</div>}
                </div>
                <button onClick={() => loadForEdit(s)} style={styles.editBtn}>编辑</button>
                <span onClick={() => del(s.id)} style={{ color: '#f87171', fontSize: 11, cursor: 'pointer', marginLeft: 4 }}>删除</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {};
const styles = S;
S.wrap = { background: '#16162a', border: '1px solid #2a2a40', borderRadius: 16, padding: 24 };
S.h3 = { fontSize: 16, fontWeight: 600, color: '#e4e4e7', margin: 0, marginBottom: 16 };
S.section = { marginBottom: 20 };
S.sectionTitle = { fontSize: 13, fontWeight: 600, color: '#d4d4d8' };
S.saveBtn = { padding: '8px 18px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
S.cancelBtn = { padding: '8px 16px', borderRadius: 8, border: '1px solid #2a2a40', background: 'transparent', color: '#a1a1aa', fontSize: 13, cursor: 'pointer' };
S.row = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, background: '#121224' };
S.editBtn = { padding: '4px 12px', borderRadius: 6, border: '1px solid #2a2a40', background: 'transparent', color: '#818cf8', fontSize: 12, cursor: 'pointer' };
