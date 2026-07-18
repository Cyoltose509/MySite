'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import {
  C, pageStyle, headerStyle, h1Style, backLinkStyle, emptyStyle,
  loadingContainerStyle, spinnerStyle, loadingTextStyle,
} from '@/lib/card-styles';
import {
  computeTiming, predictNextEntityMarkov, computeGroupDependencies, weekdayName,
  countdownText, fmtDate, CONFIDENCE_LABEL, CONFIDENCE_COLOR, assocColor, assocLabel,
  predictNoveltyMeal, predictNewSongCount,
  type EventLogLite, type EventGroupLite, type EntityRank, type MarkovItem, type GroupDep,
} from '@/lib/prediction';

interface MusicLite { id: string; title: string; artist: string[]; created_at?: string; }
interface MusicTagLite { music_id: string; singability?: number; likability?: number; }
interface MealLite { id: string; title: string; rating: string; }

// 大餐评分（序数）→ 偏好分 0..1
const MEAL_PREF: Record<string, number> = { '夯': 1.0, '顶级': 0.8, '人上人': 0.55, 'NPC': 0.3, '拉完了': 0.1 };

export default function PredictPage() {
  const [groups, setGroups] = useState<EventGroupLite[]>([]);
  const [rawLogs, setRawLogs] = useState<EventLogLite[]>([]);
  const [musicById, setMusicById] = useState<Record<string, MusicLite>>({});
  const [tagByMusic, setTagByMusic] = useState<Record<string, MusicTagLite>>({});
  const [mealById, setMealById] = useState<Record<string, MealLite>>({});
  const [songTopN, setSongTopN] = useState(10);
  const [songTopNInput, setSongTopNInput] = useState('10');
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: gData }, { data: lData }, { data: mData }, { data: tData }, { data: mealData }] =
      await Promise.all([
        supabase.from('event_groups').select('id, name, icon, color, sort_order').order('sort_order'),
        supabase.from('event_logs').select('id, group_id, event_at, refs'),
        supabase.from('music_list').select('id, title, artist, created_at'),
        supabase.from('music_tags').select('music_id, singability, likability'),
        supabase.from('meals').select('id, title, rating'),
      ]);

    setGroups((gData || []) as EventGroupLite[]);
    setRawLogs((lData || []) as EventLogLite[]);

    const mb: Record<string, MusicLite> = {};
    for (const m of (mData || []) as MusicLite[]) mb[m.id] = m;
    setMusicById(mb);

    const tb: Record<string, MusicTagLite> = {};
    for (const t of (tData || []) as MusicTagLite[]) tb[t.music_id] = t;
    setTagByMusic(tb);

    const ml: Record<string, MealLite> = {};
    for (const m of (mealData || []) as MealLite[]) ml[m.id] = m;
    setMealById(ml);

    setLoading(false);
  };

  const logsByGroup = useMemo(() => {
    const m: Record<string, EventLogLite[]> = {};
    for (const l of rawLogs) { (m[l.group_id] ||= []).push(l); }
    return m;
  }, [rawLogs]);

  const timingByGroup = useMemo(() => {
    const m: Record<string, ReturnType<typeof computeTiming>> = {};
    for (const g of groups) m[g.id] = computeTiming(logsByGroup[g.id] || []);
    return m;
  }, [groups, logsByGroup]);

  const nextEvent = useMemo(() => {
    let best: { group: EventGroupLite; at: string; cd: { text: string; overdue: boolean } } | null = null;
    for (const g of groups) {
      const t = timingByGroup[g.id];
      if (!t.predictedNextAt) continue;
      const cd = countdownText(t.predictedNextAt);
      if (cd.overdue) continue;
      if (!best || new Date(t.predictedNextAt).getTime() < new Date(best.at).getTime()) {
        best = { group: g, at: t.predictedNextAt, cd };
      }
    }
    return best;
  }, [groups, timingByGroup]);

  const mealGroup = useMemo(() => groups.find((g) => g.name === '大餐') || null, [groups]);
  const songGroup = useMemo(() => groups.find((g) => /歌|唱|k/i.test(g.name)) || null, [groups]);

  // 偏好分映射
  const mealPref = (id: string): number => {
    const r = mealById[id]?.rating;
    return r && r in MEAL_PREF ? MEAL_PREF[r] : 0.5;
  };
  const songMaxRaw = useMemo(() => {
    const vals = Object.values(tagByMusic).map((t) => (t.likability || 0) * (t.singability || 0));
    return Math.max(1, ...vals);
  }, [tagByMusic]);
  const songPref = (id: string): number => {
    const t = tagByMusic[id];
    const raw = (t?.likability || 0) * (t?.singability || 0);
    return songMaxRaw > 0 ? 0.15 + 0.85 * (raw / songMaxRaw) : 0.5;
  };
  // 新鲜度：最近加入歌单的歌权重更高（按 created_at 距今天数指数衰减，半衰期≈14天）
  const songFresh = (id: string): number => {
    const ca = musicById[id]?.created_at;
    if (!ca) return 1;
    const ageDays = (Date.now() - new Date(ca).getTime()) / 86400000;
    if (!(ageDays >= 0)) return 1;
    return 1 + 1.4 * Math.exp(-ageDays / 14);
  };

  // 时间预测：大餐组直接用 timing；歌组把 唱k/户外唱歌 等多个歌组日志合并
  const mealTiming = useMemo(
    () => (mealGroup ? timingByGroup[mealGroup.id] : null),
    [mealGroup, timingByGroup]
  );
  const songGroups = useMemo(() => groups.filter((g) => /歌|唱|k/i.test(g.name)), [groups]);
  const songLogs = useMemo(
    () => songGroups.flatMap((g) => logsByGroup[g.id] || []),
    [songGroups, logsByGroup]
  );
  const songTiming = useMemo(() => computeTiming(songLogs), [songLogs]);

  const mealPred = useMemo(
    () => (mealGroup ? predictNextEntityMarkov(logsByGroup[mealGroup.id] || [], { prefScore: mealPref }) : null),
    [mealGroup, logsByGroup, mealById]
  );
  // 大餐「吃前所未见新菜」概率
  const mealNovelty = useMemo(
    () => (mealGroup ? predictNoveltyMeal(logsByGroup[mealGroup.id] || []) : null),
    [mealGroup, logsByGroup]
  );
  // 已唱过的歌（用于区分"还没唱过"的冷启动歌）
  const sungIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of songLogs) for (const r of (l.refs || [])) if (r && r.id) s.add(String(r.id));
    return s;
  }, [songLogs]);
  // 冷启动候选（喂给模型）：歌单里有、且从没在唱K记录里出现过的歌；只取近期（≈60天内）新加的，避免把整库老歌灌进列表
  const songColdCandidates = useMemo(() => {
    const cutoff = Date.now() - 60 * 86400000;
    return Object.values(musicById)
      .filter((m) => m.created_at && new Date(m.created_at).getTime() >= cutoff && !sungIds.has(m.id))
      .map((m) => ({ id: m.id, title: m.title }));
  }, [musicById, sungIds]);
  // 只算一次全量排序；改首数时不重算，仅展示时 slice 取前 N
  const songPred = useMemo(
    () => (songGroup ? predictNextEntityMarkov(songLogs, { prefScore: songPref, freshScore: songFresh, coldCandidates: songColdCandidates, mode: 'membership' }) : null),
    [songGroup, songLogs, tagByMusic, songMaxRaw, songColdCandidates]
  );
  // 唱歌「下次唱多少首新歌」分布
  const songNewCount = useMemo(
    () => (songGroup ? predictNewSongCount(songLogs) : null),
    [songGroup, songLogs]
  );

  const deps = useMemo(() => computeGroupDependencies(groups, logsByGroup, 2), [groups, logsByGroup]);

  const songArtist = (id: string) => musicById[id]?.artist || [];
  const songSing = (id: string) => tagByMusic[id]?.singability;
  const songLike = (id: string) => tagByMusic[id]?.likability;
  const mealRating = (id: string) => mealById[id]?.rating ?? '—';

  if (loading) return (
    <div style={loadingContainerStyle}>
      <div style={spinnerStyle} />
      <p style={loadingTextStyle}>读取事件规律中...</p>
    </div>
  );

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={backLinkStyle}>← 返回</Link>
        <h1 style={h1Style}>🔮 预测中心</h1>
      </header>
      <p style={{ color: C.textSec, fontSize: 13, marginTop: -4, marginBottom: 24 }}>
        基于事件计数规律 · 季节性周期 + Markov 转移×偏好评分 + 跨事件依赖建模
      </p>

      {nextEvent ? (
        <div style={{
          padding: 24, borderRadius: 18, marginBottom: 28,
          background: `linear-gradient(135deg, ${C.accent}22, ${C.surface})`,
          border: '1px solid ' + C.borderLit,
        }}>
          <div style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>即将到来</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 40 }}>{nextEvent.group.icon}</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{nextEvent.group.name}</div>
              <div style={{ fontSize: 13, color: C.accentLt, marginTop: 2 }}>
                {fmtDate(nextEvent.at)} · {nextEvent.cd.text}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ ...emptyStyle, border: '1px dashed ' + C.border, borderRadius: 14, marginBottom: 28 }}>
          暂无足够规律来预测下次事件，多记录一些事件吧
        </div>
      )}

      {/* ── 下一次大餐吃什么 ── */}
      <Section title="🍽️ 下一次大餐吃什么">
        {mealPred && mealPred.nextTop.length ? (
          <>
            <HeroCard
              icon="🍴"
              title={mealPred.nextTop[0].title}
              subtitle={mealHeadline(mealPred)}
              accent={C.gold}
              badge={`概率 ${(mealPred.nextTop[0].prob * 100).toFixed(0)}%`}
            />
            <TimeLine timing={mealTiming} label="大餐" />
            <ProbList
              items={mealPred.nextTop.slice(0, 3)}
              render={(e) => e.title}
              meta={(e) => `${(e.prob * 100).toFixed(0)}% · 评分 ${mealRating(e.id)}`}
            />
            {mealNovelty && mealNovelty.prob > 0 && (
              <div style={{
                padding: 14, borderRadius: 12, marginTop: 12,
                background: 'linear-gradient(135deg, #22c55e22, ' + C.surface + ')',
                border: '1px solid ' + C.borderLit,
              }}>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 4 }}>
                  🆕 也有 {(mealNovelty.prob * 100).toFixed(0)}% 概率吃个「前所未见的新菜」
                </div>
                <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.6 }}>
                  基于你过去 {mealNovelty.sessions} 顿大餐，有 {mealNovelty.newIntroductions} 顿是第一次吃这道菜。
                </div>
              </div>
            )}
            <RecencyList ranking={mealPred.ranking.slice(0, 5)} verb="吃过" emptyStyle={emptyStyle} />
          </>
        ) : (
          <p style={emptyStyle}>还没有「大餐」事件记录</p>
        )}
      </Section>

      {/* ── 下一次歌唱什么 ── */}
      <Section title="🎤 下一场可能唱的歌单">
        {songPred && songPred.nextTop.length ? (
          <>
            <HeroCard
              icon="🎵"
              title={songPred.nextTop[0].title}
              subtitle={
                songArtist(songPred.nextTop[0].id).length
                  ? `${songArtist(songPred.nextTop[0].id).join(' / ')} · ${songHeadline(songPred)}`
                  : songHeadline(songPred)
              }
              accent={C.purple}
              badge={songSing(songPred.nextTop[0].id) != null ? `唱 ${songSing(songPred.nextTop[0].id)}` : `${(songPred.nextTop[0].prob * 100).toFixed(0)}%`}
            />
            <TimeLine timing={songTiming} label="唱K" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px' }}>
              <span style={{ fontSize: 12, color: C.textSec }}>预测首数</span>
              <input
                type="number"
                min={1}
                max={60}
                value={songTopNInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  setSongTopNInput(raw);
                  const v = Math.floor(Number(raw));
                  if (!Number.isNaN(v) && v >= 1) setSongTopN(Math.min(60, v));
                }}
                onBlur={() => {
                  const v = Math.floor(Number(songTopNInput));
                  const clamped = Math.min(60, Math.max(1, Number.isNaN(v) ? 1 : v));
                  setSongTopN(clamped);
                  setSongTopNInput(String(clamped));
                }}
                style={{
                  width: 64, fontSize: 12, padding: '4px 8px', borderRadius: 8, textAlign: 'center',
                  background: C.surface, color: C.text, border: '1px solid ' + C.border,
                  MozAppearance: 'textfield',
                }}
              />
              <span style={{ fontSize: 12, color: C.textDim }}>首（1–60）</span>
            </div>
            <ProbList
              items={songPred.nextTop.slice(0, songTopN)}
              render={(e) => `${e.title}${songArtist(e.id).length ? ` — ${songArtist(e.id).join(' / ')}` : ''}`}
              meta={(e) => `${(e.prob * 100).toFixed(0)}%${songSing(e.id) != null ? ` · 唱${songSing(e.id)}` : ''}${songLike(e.id) != null ? ` ♥${songLike(e.id)}` : ''}`}
            />
            {songNewCount && songNewCount.totalSessions >= 2 && (
              <div style={{ fontSize: 12, color: C.textSec, marginTop: 14 }}>
                🆕 下场预计唱 <b style={{ color: C.text }}>{songNewCount.expected.toFixed(1)}</b> 首新歌（此前没唱过的），至少 1 首的概率 <b style={{ color: C.text }}>{(songNewCount.pAtLeastOne * 100).toFixed(0)}%</b>。
              </div>
            )}
            <RecencyList ranking={songPred.ranking.slice(0, 5)} verb="唱过" emptyStyle={emptyStyle} />
          </>
        ) : (
          <p style={emptyStyle}>还没有「歌 / 唱K」事件记录</p>
        )}
      </Section>

      {/* ── 事件关联（树图/关系图） ── */}
      <Section title="🔗 事件关联">
        {deps.length ? (
          <>
            <DependencyGraph groups={groups} deps={deps} />
          </>
        ) : (
          <p style={emptyStyle}>暂未发现明显的跨事件关联（或数据不足）</p>
        )}
      </Section>

      {/* ── 各事件组的节奏预测 ── */}
      <section style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 16 }}>📅 各事件节奏预测</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))', gap: 12 }}>
          {groups.map((g) => {
            const t = timingByGroup[g.id];
            const cd = countdownText(t.predictedNextAt);
            const confColor = CONFIDENCE_COLOR[t.confidence];
            return (
              <div key={g.id} style={{
                padding: 16, borderRadius: 14, background: C.surface, border: '1px solid ' + C.border,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 22 }}>{g.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{g.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: confColor, border: `1px solid ${confColor}`, padding: '1px 7px', borderRadius: 10 }}>
                    {CONFIDENCE_LABEL[t.confidence]}
                  </span>
                </div>
                {t.count < 2 ? (
                  <div style={{ fontSize: 12, color: C.textDim }}>仅 {t.count} 次记录，规律不足</div>
                ) : (
                  <>
                    <Row label="上次" value={fmtDate(t.lastAt)} />
                    <Row label="平均间隔" value={`${t.avgIntervalDays!.toFixed(1)} 天`} />
                    <Row label="下次预测" value={fmtDate(t.predictedNextAt)} highlight />
                    <div style={{ fontSize: 12, marginTop: 6, color: cd.overdue ? C.red : C.accentLt }}>{cd.text}</div>

                    {/* 近期间隔 mini bar */}
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11, color: C.textSec, marginBottom: 4 }}>近期间隔</div>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 24, overflow: 'hidden' }}>
                        {t.recentIntervals.map((d, i) => {
                          const max = Math.max(...t.recentIntervals) || 1;
                          const h = Math.max(4, Math.min(24, (d / max) * 24));
                          return <div key={i} title={`${d.toFixed(1)} 天`} style={{ flex: 1, height: h, background: C.borderLit, borderRadius: 2 }} />;
                        })}
                      </div>
                    </div>

                    {/* 星期季节性 */}
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11, color: C.textSec, marginBottom: 4 }}>
                        星期规律：{t.seasonality >= 0.12 && t.modalWeekday !== null
                          ? `偏 ${weekdayName(t.modalWeekday)}（强度 ${(t.seasonality * 100).toFixed(0)}%）`
                          : '无明显星期规律'}
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 34, overflow: 'hidden' }}>
                        {t.weekdayDist.map((p, i) => {
                          const h = Math.max(4, p * 30);
                          const isModal = i === t.modalWeekday;
                          return (
                            <div key={i} title={`${weekdayName(i)}: ${(p * 100).toFixed(0)}%`}
                              style={{ flex: 1, height: h, background: isModal ? C.accent : C.borderLit, borderRadius: 3 }} />
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        {t.weekdayDist.map((_, i) => (
                          <span key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: C.textDim }}>{WEEKDAY_SHORT[i]}</span>
                        ))}
                      </div>
                    </div>

                    {t.band.p25 && t.band.p75 && (
                      <div style={{ fontSize: 11, color: C.textSec, marginTop: 10 }}>
                        大概率区间：{fmtDate(t.band.p25)} ~ {fmtDate(t.band.p75)}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <footer style={{ marginTop: 48, paddingTop: 20, borderTop: '1px solid ' + C.border, textAlign: 'center', fontSize: 12, color: C.textSec, lineHeight: 1.7 }}>
        <p>模型：指数衰减加权间隔 + 星期季节性修正 + 经验分位预测区间</p>
        <p>下一个对象：一阶 Markov 转移 × 偏好评分（大餐评分 / 歌曲 喜欢度×能唱度）</p>
        <p>跨事件：日频 Pearson 相关 + 条件共现（关系图展示）</p>
        <p>Powered by DataHub</p>
      </footer>
    </div>
  );
}

/* ── 文案辅助 ── */
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

function mealHeadline(p: { lastEntity: { title: string } | null; lastSessionSize: number }): string {
  if (p.lastSessionSize > 1) return `基于上次「大餐」的 ${p.lastSessionSize} 条记录 → 按评分加权推荐`;
  if (p.lastEntity) return `结合上次吃「${p.lastEntity.title}」→ 按评分加权推荐`;
  return '按评分加权 → 最可能是它';
}
function songHeadline(p: { lastEntity: { title: string } | null; lastSessionSize: number }): string {
  if (p.lastSessionSize > 1) return `基于上次唱K的 ${p.lastSessionSize} 首曲目偏好推算`;
  if (p.lastEntity) return `结合上次唱「${p.lastEntity.title}」→ 加权推荐`;
  return '按喜欢度×能唱度加权 → 推荐';
}

/* ── 时间线（下一次大餐 / 唱K 的发生时间） ── */
function TimeLine({ timing, label }: { timing: ReturnType<typeof computeTiming> | null; label: string }) {
  if (!timing || timing.count < 2 || !timing.predictedNextAt) {
    return (
      <div style={{ fontSize: 12, color: C.textDim, marginTop: -4, marginBottom: 12 }}>
        暂无足够规律预测「{label}」的发生时间（至少需 2 次记录）
      </div>
    );
  }
  const cd = countdownText(timing.predictedNextAt);
  const confColor = CONFIDENCE_COLOR[timing.confidence];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginTop: -4, marginBottom: 12,
      padding: '9px 12px', borderRadius: 10, background: C.surface, border: '1px solid ' + C.border,
    }}>
      <span style={{ fontSize: 16 }}>📅</span>
      <span style={{ fontSize: 13, color: C.text }}>
        预计下次{label}：<b style={{ color: C.accentLt }}>{fmtDate(timing.predictedNextAt)}</b>
      </span>
      <span style={{ marginLeft: 'auto', fontSize: 12, color: cd.overdue ? C.red : C.textSec, whiteSpace: 'nowrap' }}>{cd.text}</span>
      <span style={{ fontSize: 11, color: confColor, border: `1px solid ${confColor}`, padding: '1px 7px', borderRadius: 10, whiteSpace: 'nowrap' }}>
        {CONFIDENCE_LABEL[timing.confidence]}
      </span>
    </div>
  );
}

/* ── 关系图（事件依赖，可交互） ── */
function DependencyGraph({ groups, deps }: { groups: EventGroupLite[]; deps: GroupDep[] }) {
  const W = 680, H = 480, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 72;
  const r = groups.length > 12 ? 20 : 26;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverPair, setHoverPair] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [selPair, setSelPair] = useState<string | null>(null);

  const pos = useMemo(() => {
    const m: Record<string, { x: number; y: number }> = {};
    groups.forEach((g, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / groups.length;
      m[g.id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
    });
    return m;
  }, [groups]);

  const pairKey = (d: GroupDep) => d.aId + '__' + d.bId;
  const isEdgeHot = (d: GroupDep) => {
    const k = pairKey(d);
    if (selPair) return k === selPair;
    if (hoverPair) return k === hoverPair;
    if (selId) return d.aId === selId || d.bId === selId;
    if (hoverId) return d.aId === hoverId || d.bId === hoverId;
    return false;
  };
  const isNodeHot = (id: string) => {
    if (selId) return id === selId || deps.some((d) => (d.aId === selId && d.bId === id) || (d.bId === selId && d.aId === id));
    if (hoverId) return id === hoverId || deps.some((d) => (d.aId === hoverId && d.bId === id) || (d.bId === hoverId && d.aId === id));
    return true;
  };

  // 选中详情
  const selNodeDeps = selId ? deps.filter((d) => d.aId === selId || d.bId === selId) : [];
  const selDep = (selPair ? deps.find((d) => pairKey(d) === selPair) : null) || null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', background: C.surface, borderRadius: 14, border: '1px solid ' + C.border, cursor: 'pointer' }}
        onClick={() => { setSelId(null); setSelPair(null); }}
      >
        {/* 边（曲线） */}
        {deps.map((d) => {
          const p1 = pos[d.aId], p2 = pos[d.bId];
          if (!p1 || !p2) return null;
          const hot = isEdgeHot(d);
          const strength = Math.max(Math.abs(d.corr), d.pGivenA, d.pGivenB, Math.min(1, Math.abs(d.assoc)));
          const color = assocColor(d.assoc);
          const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
          // 控制点：中点向外推一点，做出弧线
          const dx = mx - cx, dy = my - cy, len = Math.hypot(dx, dy) || 1;
          const cxp = mx + (dx / len) * 26, cyp = my + (dy / len) * 26;
          return (
            <path
              key={pairKey(d)}
              d={`M ${p1.x} ${p1.y} Q ${cxp} ${cyp} ${p2.x} ${p2.y}`}
              fill="none"
              stroke={color}
              strokeWidth={hot ? 2 + strength * 7 : 1 + strength * 5}
              strokeOpacity={hot ? 0.95 : selId || hoverId || selPair || hoverPair ? 0.12 : 0.3 + strength * 0.5}
              strokeLinecap="round"
              onMouseEnter={() => setHoverPair(pairKey(d))}
              onMouseLeave={() => setHoverPair(null)}
              onClick={(e) => { e.stopPropagation(); setSelId(null); setSelPair(pairKey(d)); }}
              style={{ transition: 'stroke-opacity .15s, stroke-width .15s' }}
            >
              <title>{`${d.aName} ↔ ${d.bName}\n关联方向：${assocLabel(d.assoc)}\nP(${d.bName}|${d.aName}) ${(d.pGivenA * 100).toFixed(0)}% · P(${d.aName}|${d.bName}) ${(d.pGivenB * 100).toFixed(0)}% · 日频相关 ${d.corr.toFixed(2)}`}</title>
            </path>
          );
        })}
        {/* 节点 */}
        {groups.map((g) => {
          const p = pos[g.id];
          const hot = isNodeHot(g.id);
          const isSel = selId === g.id;
          return (
            <g
              key={g.id}
              onMouseEnter={() => setHoverId(g.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={(e) => { e.stopPropagation(); setSelPair(null); setSelId(isSel ? null : g.id); }}
              style={{ cursor: 'pointer', opacity: hot ? 1 : 0.25, transition: 'opacity .15s' }}
            >
              <circle cx={p.x} cy={p.y} r={r + (isSel ? 4 : 0)} fill={C.surface} stroke={g.color || C.borderLit} strokeWidth={isSel ? 3.5 : 2} />
              <text x={p.x} y={p.y - 1} textAnchor="middle" fontSize={20}>{g.icon}</text>
              <text x={p.x} y={p.y + r + 14} textAnchor="middle" fontSize={11} fill={C.text}>{g.name}</text>
            </g>
          );
        })}
      </svg>

      {/* 图例 */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 11, color: C.textSec, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 18, height: 3, background: '#4ade80', borderRadius: 2, display: 'inline-block' }} /> 同去（常一起）</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 18, height: 3, background: '#f87171', borderRadius: 2, display: 'inline-block' }} /> 交替（各过各的）</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 18, height: 3, background: '#9ca3af', borderRadius: 2, display: 'inline-block' }} /> 无显著关联</span>
        <span>线越粗 = 关联越强</span>
      </div>

      {/* 详情面板 */}
      {(selNodeDeps.length > 0 || selDep) && (
        <div style={{ marginTop: 12, padding: 14, borderRadius: 12, background: C.surface, border: '1px solid ' + C.borderLit }}>
          {selDep ? (
            <DependencyDetail dep={selDep} onBack={() => setSelPair(null)} />
          ) : (
            <>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 8 }}>
                {groups.find((g) => g.id === selId)?.icon} {groups.find((g) => g.id === selId)?.name} 的关联事件
                <span style={{ float: 'right', fontSize: 11, color: C.textDim, cursor: 'pointer' }} onClick={() => setSelId(null)}>✕ 清除</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selNodeDeps.map((d) => {
                  const other = d.aId === selId ? d.bName : d.aName;
                  const otherIcon = d.aId === selId ? d.bIcon : d.aIcon;
                  const strength = Math.max(Math.abs(d.corr), d.pGivenA, d.pGivenB);
                  return (
                    <div key={pairKey(d)} onClick={() => setSelPair(pairKey(d))} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 9, border: '1px solid ' + C.border, cursor: 'pointer' }}>
                      <span style={{ fontSize: 16 }}>{otherIcon}</span>
                      <span style={{ fontSize: 13, color: C.text, flex: 1 }}>{other}</span>
                      <span style={{ fontSize: 11, color: assocColor(d.assoc) }}>{assocLabel(d.assoc)}</span>
                      <span style={{ fontSize: 11, color: C.textSec }}>强度 {(strength * 100).toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DependencyDetail({ dep, onBack }: { dep: GroupDep; onBack: () => void }) {
  const strength = Math.max(Math.abs(dep.corr), dep.pGivenA, dep.pGivenB, Math.min(1, Math.abs(dep.assoc)));
  return (
    <div>
      <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 10 }}>
        {dep.aIcon} {dep.aName} ↔ {dep.bIcon} {dep.bName}
        <span style={{ float: 'right', fontSize: 11, color: C.textDim, cursor: 'pointer' }} onClick={onBack}>← 返回</span>
      </div>
      <Row label="关联方向" value={assocLabel(dep.assoc)} highlight />
      <Row label={`发生 ${dep.aName} 后 ${dep.windowDays} 天内出现 ${dep.bName}`} value={`${(dep.pGivenA * 100).toFixed(0)}%`} />
      <Row label={`发生 ${dep.bName} 后 ${dep.windowDays} 天内出现 ${dep.aName}`} value={`${(dep.pGivenB * 100).toFixed(0)}%`} />
      <Row label="共现次数" value={`${dep.jointCount} 次`} />
      <Row label="关联强度" value={`${(strength * 100).toFixed(0)}%`} />
    </div>
  );
}

/* ── 子组件 ── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 16 }}>{title}</h2>
      {children}
    </section>
  );
}

function HeroCard({
  icon, title, subtitle, accent, badge,
}: { icon: string; title: string; subtitle: string; accent: string; badge?: string }) {
  return (
    <div style={{
      padding: 20, borderRadius: 16, marginBottom: 14,
      background: `linear-gradient(135deg, ${accent}1f, ${C.surface})`,
      border: '1px solid ' + accent,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 36 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>{title}</div>
          <div style={{ fontSize: 12, color: C.textSec, marginTop: 3 }}>{subtitle}</div>
        </div>
        {badge && (
          <span style={{ fontSize: 11, color: accent, border: `1px solid ${accent}`, padding: '3px 9px', borderRadius: 10, whiteSpace: 'nowrap' }}>
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

function ProbList({
  items, render, meta,
}: { items: MarkovItem[]; render: (e: MarkovItem) => string; meta: (e: MarkovItem) => string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
      {items.map((e, i) => (
        <div key={e.id} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
          borderRadius: 10, background: C.surface, border: '1px solid ' + C.border,
        }}>
          <span style={{ fontSize: 12, color: C.textDim, width: 18 }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{render(e)}</div>
            <div style={{ height: 4, marginTop: 5, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(4, e.prob * 100)}%`, height: '100%', background: C.accentLt }} />
            </div>
          </div>
          <span style={{ fontSize: 11, color: C.textSec, whiteSpace: 'nowrap' }}>{meta(e)}</span>
        </div>
      ))}
    </div>
  );
}

function RecencyList({ ranking, verb, emptyStyle }: { ranking: EntityRank[]; verb?: string; emptyStyle: React.CSSProperties }) {
  if (!ranking.length) return null;
  const v = verb || '吃过';
  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ fontSize: 12, color: C.textSec, cursor: 'pointer' }}>轮转历史（最久没出现排前）</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
        {ranking.map((e, i) => (
          <div key={e.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px',
            borderRadius: 9, background: C.surface, border: '1px solid ' + C.border,
          }}>
            <span style={{ fontSize: 11, color: C.textDim, width: 16 }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: 12, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
            <span style={{ fontSize: 11, color: C.textSec }}>{v} {e.count} 次 · {e.daysSince} 天前</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
      <span style={{ color: C.textSec }}>{label}</span>
      <span style={{ color: highlight ? C.accentLt : C.text, fontWeight: highlight ? 700 : 400 }}>{value}</span>
    </div>
  );
}
