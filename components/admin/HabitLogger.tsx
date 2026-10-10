'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/rank';
import type { Habit, HabitSession } from '@/lib/habit-utils';
import { groupByDay, computeStats, fmtHM } from '@/lib/habit-utils';

const PAGE_SIZE = 20;
const ICONS = ['🎹', '🏃', '📚', '🧘', '💪', '✍️', '🎨', '🗣', '🌱', '⏰'];
const COLORS = ['#8d9c1c', '#6366f1', '#059669', '#db2777', '#d97706', '#2563eb', '#7c3aed'];

/** 计时状态存 localStorage：换标签页、跳去别的页面、刷新浏览器都还在（用户要「全局记忆」） */
const TIMER_KEY = 'datahub_habit_timer';

const fmtElapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

const localDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export function HabitLogger() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [sessions, setSessions] = useState<HabitSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);
  const [page, setPage] = useState(0);
  const [showManager, setShowManager] = useState(false);

  // 录入
  const [habitId, setHabitId] = useState('');
  const [date, setDate] = useState(() => localDateStr(new Date()));
  const [time, setTime] = useState(() => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  });
  const [duration, setDuration] = useState('');
  const [note, setNote] = useState('');
  const [editId, setEditId] = useState<string | null>(null);

  // 计时器（开始 → 停止，自动算时长落库）
  const [running, setRunning] = useState<{ habitId: string; name: string; icon: string; startAt: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // 习惯管理
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('🎹');
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [newPrivate, setNewPrivate] = useState(false);

  const load = async () => {
    try {
      const [hs, ss] = await Promise.all([
        fetchAll('habits', 'id,name,icon,color,sort_order,is_private'),
        fetchAll('habit_sessions', 'id,habit_id,start_at,duration_min,note'),
      ]);
      const h = (hs as Habit[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setHabits(h);
      setSessions((ss as HabitSession[]).sort((a, b) => b.start_at.localeCompare(a.start_at)));
      if (h.length && !habitId) setHabitId(h[0].id);
    } catch (e: any) {
      setMessage({ text: `❌ 加载失败: ${e.message}`, type: 'err' });
    }
  };

  useEffect(() => { load(); }, []);

  // 恢复上次未停止的计时（刷新/跳转回来仍继续计时）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TIMER_KEY);
      if (raw) {
        const r = JSON.parse(raw);
        if (r && r.habitId && r.startAt) {
          setRunning(r);
          setNow(Date.now());
        }
      }
    } catch { /* localStorage 不可用时忽略 */ }
  }, []);

  // 运行中才每秒跳一次，避免无谓重渲染
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const startTimer = () => {
    if (!habitId) { setMessage({ text: '请先选择习惯再开始计时', type: 'err' }); return; }
    if (running) { setMessage({ text: '已有进行中的计时，请先停止', type: 'err' }); return; }
    const h = habits.find(x => x.id === habitId);
    if (!h) { setMessage({ text: '找不到该习惯', type: 'err' }); return; }
    const r = { habitId, name: h.name, icon: h.icon || '🎯', startAt: new Date().toISOString() };
    setRunning(r);
    setNow(Date.now());
    try { localStorage.setItem(TIMER_KEY, JSON.stringify(r)); } catch { /* 忽略 */ }
    setMessage({ text: `⏱ 开始记录「${h.name}」，练完点「停止并记录」`, type: 'ok' });
  };

  const stopTimer = async () => {
    if (!running) return;
    const ms = Math.max(0, now - new Date(running.startAt).getTime());
    // 四舍五入到分钟；不足 1 分钟按 1 分钟记（DB 有 duration_min > 0 约束）
    const mins = Math.max(1, Math.round(ms / 60000));
    setRunning(null);
    setNow(Date.now());
    try { localStorage.removeItem(TIMER_KEY); } catch { /* 忽略 */ }
    const { error } = await supabase.from('habit_sessions').insert({
      habit_id: running.habitId,
      start_at: running.startAt,
      duration_min: mins,
      note: note.trim() || null,
    });
    if (error) {
      setMessage({ text: `❌ 保存失败: ${error.message}（计时已停止，可手动补录）`, type: 'err' });
      return;
    }
    setMessage({ text: `✅ 已记录「${running.name}」${fmtHM(mins)}`, type: 'ok' });
    setDuration('');
    setNote('');
    load();
  };

  /** 放弃计时（点错了起手时用），不落库 */
  const discardTimer = () => {
    if (!running) return;
    if (!confirm(`放弃这次「${running.name}」计时？本次不会记录。`)) return;
    setRunning(null);
    try { localStorage.removeItem(TIMER_KEY); } catch { /* 忽略 */ }
    setMessage({ text: '已放弃本次计时', type: 'ok' });
  };

  // 每个习惯的汇总
  const perHabit = useMemo(() => {
    const out: Record<string, ReturnType<typeof computeStats>> = {};
    for (const h of habits) {
      out[h.id] = computeStats(groupByDay(sessions.filter(s => s.habit_id === h.id)));
    }
    return out;
  }, [habits, sessions]);

  const saveSession = async () => {
    if (!habitId) { setMessage({ text: '请先选择习惯', type: 'err' }); return; }
    const d = parseInt(duration, 10);
    if (!d || d <= 0) { setMessage({ text: '请填写有效时长（分钟）', type: 'err' }); return; }
    setLoading(true);
    const payload = {
      habit_id: habitId,
      start_at: new Date(`${date}T${time}:00`).toISOString(),
      duration_min: d,
      note: note.trim() || null,
    };
    const { error } = editId
      ? await supabase.from('habit_sessions').update(payload).eq('id', editId)
      : await supabase.from('habit_sessions').insert(payload);
    setLoading(false);
    if (error) { setMessage({ text: `❌ ${editId ? '更新' : '记录'}失败: ${error.message}`, type: 'err' }); return; }
    setMessage({ text: editId ? '✅ 已更新' : '✅ 已记录', type: 'ok' });
    setEditId(null);
    setDuration('');
    setNote('');
    load();
  };

  // 把某条记录回填进录入表单（start_at 是 UTC，转本地日期/时间再回填）
  const startEdit = (s: HabitSession) => {
    const d = new Date(s.start_at);
    setEditId(s.id);
    setHabitId(s.habit_id);
    setDate(localDateStr(d));
    setTime(d.toTimeString().slice(0, 5));
    setDuration(String(s.duration_min));
    setNote(s.note || '');
    setMessage(null);
  };

  const cancelEdit = () => {
    setEditId(null);
    setDuration('');
    setNote('');
  };

  const removeSession = async (id: string) => {
    if (!confirm('确定删除这条练习记录？')) return;
    const { error } = await supabase.from('habit_sessions').delete().eq('id', id);
    if (error) setMessage({ text: `❌ 删除失败: ${error.message}`, type: 'err' });
    else { setMessage({ text: '✅ 已删除', type: 'ok' }); load(); }
  };

  const addHabit = async () => {
    if (!newName.trim()) { setMessage({ text: '请输入习惯名称', type: 'err' }); return; }
    const { error } = await supabase.from('habits').insert({
      name: newName.trim(), icon: newIcon, color: newColor,
      sort_order: habits.length, is_private: newPrivate,
    });
    if (error) setMessage({ text: `❌ 添加失败: ${error.message}`, type: 'err' });
    else { setMessage({ text: '✅ 习惯已添加', type: 'ok' }); setNewName(''); setNewPrivate(false); load(); }
  };

  const togglePrivate = async (h: Habit) => {
    const { error } = await supabase.from('habits').update({ is_private: !h.is_private }).eq('id', h.id);
    if (error) setMessage({ text: `❌ 操作失败: ${error.message}`, type: 'err' });
    else load();
  };

  const deleteHabit = async (h: Habit) => {
    if (!confirm(`确定删除「${h.name}」？其下所有练习记录也会被删除。`)) return;
    const { error } = await supabase.from('habits').delete().eq('id', h.id);
    if (error) setMessage({ text: `❌ 删除失败: ${error.message}`, type: 'err' });
    else { setMessage({ text: '✅ 已删除', type: 'ok' }); load(); }
  };

  const totalPages = Math.ceil(sessions.length / PAGE_SIZE);
  const paged = sessions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const nameOf = (id: string) => habits.find(h => h.id === id);

  return (
    <div style={S.wrap}>
      <h3 style={S.h3}>🎯 自律养成</h3>
      <p style={S.desc}>
        记录「几点开始 + 练了多久」。这类活动不参与事件计数，也不会进入预测模型——
        和「喝了几次奶茶」这种可计数事件是两类东西。
      </p>

      {message && (
        <p style={{ fontSize: 13, color: message.type === 'ok' ? '#4ade80' : '#f87171', margin: '0 0 12px' }}>
          {message.text}
        </p>
      )}

      {/* 汇总卡 */}
      <div style={{ ...S.section, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {habits.map(h => {
            const st = perHabit[h.id];
            return (
              <div key={h.id} style={{ ...S.statCard, borderColor: h.color || '#6366f1' }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{h.icon}</div>
                <div style={{ fontSize: 12, color: '#a1a1aa' }}>{h.name}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#e4e4e7', marginTop: 4 }}>
                  {st ? fmtHM(st.totalMin) : '0m'}
                </div>
                <div style={{ fontSize: 11, color: '#52525b' }}>
                  {st ? `${st.count} 次 · ${st.dayCount} 天 · 连续 ${st.streak} 天` : '暂无'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 计时器：开始 / 停止 */}
      <div style={S.section}>
        <div style={S.sectionHeader}>
          <span style={S.sectionTitle}>⏱ 计时记录</span>
          <span style={{ fontSize: 11, color: '#52525b' }}>
            {running ? '计时中，状态全局保留（刷新/跳页都不会丢）' : '开始后去练，练完点停止自动算时长'}
          </span>
        </div>
        {!running ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={startTimer} disabled={loading}
              style={{ ...S.saveBtn, fontSize: 14, padding: '12px 22px' }}>
              ▶ 开始记录当前时间
            </button>
            <span style={{ fontSize: 12, color: '#71717a' }}>
              将记录到：{habits.find(h => h.id === habitId)
                ? `${habits.find(h => h.id === habitId)!.icon} ${habits.find(h => h.id === habitId)!.name}`
                : '（先在下方选择习惯）'}
            </span>
          </div>
        ) : (
          <div style={S.timerBox}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 18 }}>{running.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7' }}>{running.name}</span>
              <span style={{
                fontSize: 26, fontWeight: 800, color: '#fbbf24', fontFamily: 'monospace',
                letterSpacing: 1,
              }}>
                {fmtElapsed(now - new Date(running.startAt).getTime())}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#71717a', marginTop: 2 }}>
              开始于 {localDateStr(new Date(running.startAt))} {new Date(running.startAt).toTimeString().slice(0, 5)}
              （{now - new Date(running.startAt).getTime() >= 60000
                ? `停止后约记 ${fmtHM(Math.max(1, Math.round((now - new Date(running.startAt).getTime()) / 60000)))}`
                : '不足 1 分钟，将按 1 分钟记'}）
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={stopTimer} disabled={loading}
                style={{ ...S.saveBtn, fontSize: 14, padding: '10px 20px', background: '#16a34a' }}>
                ⏹ 停止并记录
              </button>
              <button onClick={discardTimer}
                style={{ ...S.saveBtn, background: '#52525b' }}>放弃</button>
            </div>
          </div>
        )}
      </div>

      {/* 录入 / 编辑 */}
      <div style={S.section}>
        <div style={S.sectionHeader}>
          <span style={{ ...S.sectionTitle, color: editId ? '#818cf8' : undefined }}>
            {editId ? '✏️ 正在编辑记录' : '➕ 记录一次练习'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          {habits.map(h => (
            <button key={h.id} onClick={() => setHabitId(h.id)} style={{
              ...S.habitBtn,
              borderColor: habitId === h.id ? (h.color || '#6366f1') : '#2a2a40',
              background: habitId === h.id ? `${h.color || '#6366f1'}22` : '#121224',
            }}>
              <span style={{ fontSize: 18 }}>{h.icon}</span>
              <span style={{ fontSize: 13 }}>{h.name}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.input} />
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...S.input, width: 110 }} />
          <span style={{ fontSize: 12, color: '#71717a' }}>开始</span>
          <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
            placeholder="时长（分钟）" style={{ ...S.input, width: 120 }} />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="备注（可选）"
            style={{ ...S.input, flex: 1, minWidth: 160 }} />
          <button onClick={saveSession} disabled={loading}
            style={{ ...S.saveBtn, opacity: loading ? 0.6 : 1 }}>{editId ? '保存修改' : '记录'}</button>
          {editId && (
            <button onClick={cancelEdit} style={{ ...S.saveBtn, background: '#52525b' }}>取消</button>
          )}
        </div>
      </div>

      {/* 习惯管理 */}
      <div style={S.section}>
        <div style={S.sectionHeader}>
          <span style={S.sectionTitle}>⚙️ 习惯管理</span>
          <button onClick={() => setShowManager(!showManager)} style={S.toggleBtn}>
            {showManager ? '收起' : '展开'}
          </button>
        </div>
        {showManager && (
          <div style={S.groupManager}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {habits.map(h => (
                <div key={h.id} style={{ ...S.groupChip, borderColor: h.color || '#6366f1' }}>
                  <span>{h.icon} {h.name}</span>
                  <button onClick={() => togglePrivate(h)} style={S.privacyBtn}
                    title={h.is_private ? '设为公开' : '设为私密'}>
                    {h.is_private ? '🔒' : '🔓'}
                  </button>
                  <button onClick={() => deleteHabit(h)} style={S.groupDelBtn}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="习惯名称" style={{ ...S.input, width: 140 }} />
              <div style={{ display: 'flex', gap: 4 }}>
                {ICONS.map(ic => (
                  <button key={ic} onClick={() => setNewIcon(ic)} style={{
                    ...S.iconBtn,
                    ...(newIcon === ic ? { borderColor: '#6366f1', background: 'rgba(99,102,241,0.15)' } : {}),
                  }}>{ic}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {COLORS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)} aria-label={c} style={{
                    width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
                    background: c,
                    border: newColor === c ? '2px solid #e4e4e7' : '1px solid #2a2a40',
                  }} />
                ))}
              </div>
              <label style={{ fontSize: 12, color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={newPrivate} onChange={e => setNewPrivate(e.target.checked)} />
                私密
              </label>
              <button onClick={addHabit} style={S.saveBtn}>添加</button>
            </div>
          </div>
        )}
      </div>

      {/* 记录列表 */}
      <div style={S.section}>
        <div style={S.sectionHeader}>
          <span style={S.sectionTitle}>📋 全部记录（{sessions.length} 条）</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {paged.length === 0 && (
            <p style={{ textAlign: 'center', color: '#52525b', fontSize: 13, padding: 20 }}>暂无记录</p>
          )}
          {paged.map(s => {
            const h = nameOf(s.habit_id);
            const d = new Date(s.start_at);
            const editing = editId === s.id;
            return (
              <div key={s.id} style={{
                ...S.logRow,
                ...(editing ? { border: '1px solid #3a3a5a', background: '#16162e' } : {}),
              }}>
                <span style={{ color: h?.color || '#818cf8', fontSize: 18, minWidth: 30 }}>{h?.icon || '•'}</span>
                <span style={{ color: '#e4e4e7', fontSize: 14, fontWeight: 500, minWidth: 90 }}>{h?.name || '已删除'}</span>
                <span style={{ color: '#a1a1aa', fontSize: 12, fontFamily: 'monospace', minWidth: 130 }}>
                  {localDateStr(d)} {d.toTimeString().slice(0, 5)}
                </span>
                <span style={{ color: h?.color || '#818cf8', fontSize: 12, flex: 1 }}>
                  ⏱ {fmtHM(s.duration_min)}{s.note ? ` · ${s.note}` : ''}
                </span>
                <button onClick={() => startEdit(s)}
                  style={{ ...S.rowBtn, color: editing ? '#818cf8' : '#a1a1aa' }}>
                  {editing ? '编辑中' : '编辑'}
                </button>
                <span onClick={() => removeSession(s.id)} style={{ color: '#f87171', fontSize: 11, cursor: 'pointer' }}>
                  删除
                </span>
              </div>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              style={{ ...S.pageBtn, opacity: page === 0 ? 0.4 : 1 }}>← 上一页</button>
            <span style={{ color: '#a1a1aa', fontSize: 12 }}>{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
              style={{ ...S.pageBtn, opacity: page >= totalPages - 1 ? 0.4 : 1 }}>下一页 →</button>
          </div>
        )}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {};
const styles = S;

S.wrap = { background: '#16162a', border: '1px solid #2a2a40', borderRadius: 16, padding: 24 };
S.h3 = { fontSize: 16, fontWeight: 600, color: '#e4e4e7', margin: 0 };
S.desc = { fontSize: 12, color: '#71717a', lineHeight: 1.6, margin: '8px 0 20px' };
S.section = { marginBottom: 24 };
S.sectionHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 };
S.sectionTitle = { fontSize: 13, fontWeight: 600, color: '#d4d4d8' };
S.toggleBtn = { padding: '4px 12px', borderRadius: 6, border: '1px solid #2a2a40', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 12 };
S.input = { padding: '8px 10px', borderRadius: 8, border: '1px solid #2a2a40', background: '#121224', color: '#e4e4e7', fontSize: 13, outline: 'none' };
S.iconBtn = { width: 30, height: 30, borderRadius: 6, border: '1px solid #2a2a40', background: 'transparent', fontSize: 14, cursor: 'pointer' };
S.saveBtn = { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
S.habitBtn = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1px solid', color: '#e4e4e7', cursor: 'pointer' };
S.groupManager = { padding: 12, borderRadius: 10, background: '#121224', marginBottom: 12 };
S.groupChip = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid', fontSize: 13, color: '#e4e4e7' };
S.groupDelBtn = { background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12, padding: '0 4px' };
S.privacyBtn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '0 4px' };
S.statCard = { flex: '1 1 130px', maxWidth: 180, padding: '14px', borderRadius: 12, border: '1px solid', background: '#121224', textAlign: 'center' };
S.logRow = { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderRadius: 8, background: '#121224' };
S.rowBtn = { background: 'rgba(99,102,241,0.15)', border: 'none', fontSize: 11, cursor: 'pointer', padding: '2px 8px', borderRadius: 4 };
S.timerBox = { padding: '16px 18px', borderRadius: 12, background: '#121224', border: '1px solid #3a3a2a' };
S.pageBtn = { padding: '6px 14px', borderRadius: 8, border: '1px solid #2a2a40', background: '#121224', color: '#a1a1aa', cursor: 'pointer', fontSize: 12 };
