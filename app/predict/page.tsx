'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/auth';
import { usePrivateAccess } from '@/lib/private';
import {
  C, pageStyle, headerStyle, h1Style, backLinkStyle, emptyStyle,
  loadingContainerStyle, spinnerStyle, loadingTextStyle,
} from '@/lib/card-styles';
import {
  computeTiming, predictNextEntityMarkov, computeGroupDependencies, weekdayName,
  countdownText, fmtDate, CONFIDENCE_LABEL, CONFIDENCE_COLOR, assocColor, assocLabel,
  predictNoveltyMeal, predictNewSongCount,
  buildDailyFeatures, computeCrossDomain, predictScenarioMotifs, detectChangePoints, detectRegimes, clusterDayArchetypes,
  forecastFutureRegimes, setHolidaySet, fetchHolidays,
  type EventLogLite, type EventGroupLite, type EntityRank, type MarkovItem, type GroupDep,
  type MoodPoint, type SleepPoint, type ForecastSeries, type ForecastResult,
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
  const [moodData, setMoodData] = useState<MoodPoint[]>([]);
  const [sleepData, setSleepData] = useState<SleepPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const { unlocked, refreshKey } = usePrivateAccess();

  useEffect(() => { fetchData(); }, [refreshKey]);

  const fetchData = async () => {
    setLoading(true);

    // 尝试从网络拉取当年节假日表，失败时退回到内置表
    const thisYear = new Date().getFullYear();
    try { setHolidaySet(await fetchHolidays(thisYear)); } catch { /* 静默使用内置表 */ }

    let groupsData: EventGroupLite[] = [];
    if (unlocked) {
      const gHash = getSession();
      if (gHash) {
        const { data: privGroups } = await supabase.rpc('fn_get_event_groups_admin', { p_hash: gHash });
        if (privGroups && Array.isArray(privGroups)) groupsData = privGroups as EventGroupLite[];
      }
    }
    if (!groupsData.length) {
      const { data: gData } = await supabase.from('event_groups').select('id, name, icon, color, sort_order').order('sort_order');
      groupsData = (gData || []) as EventGroupLite[];
    }
    setGroups(groupsData);

    const [{ data: lData }, { data: mData }, { data: tData }, { data: mealData }, { data: moodData }, { data: sleepData }] =
      await Promise.all([
        supabase.from('event_logs').select('id, group_id, event_at, refs'),
        supabase.from('music_list').select('id, title, artist, created_at'),
        supabase.from('music_tags').select('music_id, singability, likability'),
        supabase.from('meals').select('id, title, rating'),
        supabase.from('mood_logs').select('created_at, mood_score'),
        supabase.from('health_sleep').select('start_date, duration_minutes'),
      ]);

    let mergedLogs = (lData || []) as EventLogLite[];
    if (unlocked) {
      const hash = getSession();
      if (hash) {
        const { data: priv } = await supabase.rpc('fn_get_event_logs_admin', { p_hash: hash });
        if (priv && Array.isArray(priv)) {
          const privLogs = (priv as Array<Record<string, unknown>>).map((r) => ({
            id: r.id as string,
            group_id: r.group_id as string,
            event_at: r.event_at as string,
            refs: (r.refs as { id: string; title: string }[]) || undefined,
          })) as EventLogLite[];
          // 以 id 去重合并（私密日志补齐公开所缺）
          const byId = new Map<string, EventLogLite>();
          for (const l of mergedLogs) if (l.id) byId.set(l.id, l);
          for (const l of privLogs) if (l.id && !byId.has(l.id)) byId.set(l.id, l);
          mergedLogs = [...byId.values()];
        }
      }
    }
    setRawLogs(mergedLogs);

    const mb: Record<string, MusicLite> = {};
    for (const m of (mData || []) as MusicLite[]) mb[m.id] = m;
    setMusicById(mb);

    const tb: Record<string, MusicTagLite> = {};
    for (const t of (tData || []) as MusicTagLite[]) tb[t.music_id] = t;
    setTagByMusic(tb);

    const ml: Record<string, MealLite> = {};
    for (const m of (mealData || []) as MealLite[]) ml[m.id] = m;
    setMealById(ml);

    setMoodData((moodData || []) as MoodPoint[]);
    setSleepData((sleepData || []) as SleepPoint[]);

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

  // 高级预测：每日特征 + 跨域联动 + 场景motif + 习惯漂移 + 日常原型聚类
  const dailyFeatures = useMemo(
    () => buildDailyFeatures(rawLogs, groups, moodData, sleepData),
    [rawLogs, groups, moodData, sleepData]
  );
  const crossDomain = useMemo(() => computeCrossDomain(dailyFeatures, groups), [dailyFeatures, groups]);
  const mealMotif = useMemo(
    () => (mealGroup ? predictScenarioMotifs(rawLogs, groups, mealGroup.id) : null),
    [mealGroup, rawLogs, groups]
  );
  const songMotif = useMemo(
    () => (songGroup ? predictScenarioMotifs(rawLogs, groups, songGroup.id) : null),
    [songGroup, rawLogs, groups]
  );
  const changePoints = useMemo(() => detectChangePoints(logsByGroup, groups), [logsByGroup, groups]);
  const regimes = useMemo(() => detectRegimes(logsByGroup, groups), [logsByGroup, groups]);
  // 阶段起伏预测：基于历史 regime 向前外推未来曲线（必须放在 regimes 之后）
  const forecast = useMemo(
    () => forecastFutureRegimes(regimes, groups, logsByGroup, { horizonWeeks: 16 }),
    [regimes, groups]
  );
  const archetypes = useMemo(() => clusterDayArchetypes(dailyFeatures, groups, 4), [dailyFeatures, groups]);

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
            {mealMotif && (
              <div style={{ fontSize: 12, color: C.textSec, marginTop: 12 }}>
                🎲 大餐常伴随：
                {mealMotif.companions.length
                  ? mealMotif.companions.map((c) => `${c.icon}${c.name} ×${c.lift.toFixed(1)}`).join(' · ')
                  : '无明显关联活动'}
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
            {songMotif && (
              <div style={{ fontSize: 12, color: C.textSec, marginTop: 12 }}>
                🎲 唱K 常伴随：
                {songMotif.companions.length
                  ? songMotif.companions.map((c) => `${c.icon}${c.name} ×${c.lift.toFixed(1)}`).join(' · ')
                  : '无明显关联活动'}
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

      {/* ── 跨域联动（心情/睡眠 × 事件） ── */}
      <Section title="🧠 跨域联动（心情 / 睡眠 × 事件）">
        {crossDomain.hasMood || crossDomain.hasSleep ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {crossDomain.byGroup.slice(0, 8).map((s) => (
              <div key={s.groupId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: C.surface, border: '1px solid ' + C.border }}>
                <span style={{ fontSize: 16 }}>{s.groupIcon}</span>
                <span style={{ flex: 1, fontSize: 13, color: C.text }}>{s.groupName}</span>
                {crossDomain.hasMood && (
                  <span style={{ fontSize: 12, color: s.moodLift >= 0 ? '#4ade80' : '#f87171', width: 76, textAlign: 'right' }}>
                    心情 {s.moodOn ? (s.moodLift >= 0 ? '+' : '') + s.moodLift.toFixed(1) : '—'}
                  </span>
                )}
                {crossDomain.hasSleep && (
                  <span style={{ fontSize: 12, color: s.sleepLiftMin >= 0 ? '#4ade80' : '#f87171', width: 80, textAlign: 'right' }}>
                    睡眠 {s.sleepLiftMin >= 0 ? '+' : ''}{s.sleepLiftMin.toFixed(0)}′
                  </span>
                )}
              </div>
            ))}
            <p style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
              数值 = 该事件发生的日子，心情分 / 睡眠时长相对你整体基线的平均偏差（偏差越大越能说明它影响你的状态）。
            </p>
          </div>
        ) : (
          <p style={emptyStyle}>还没有心情 / 睡眠记录，无法做跨域联动</p>
        )}
      </Section>

      {/* ── 习惯漂移 / 阶段起伏（预测） ── */}
      <Section title="📉 习惯漂移 / 阶段起伏（预测）">
        {changePoints.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {changePoints.map((cp) => (
              <div key={cp.groupId} style={{ padding: '11px 14px', borderRadius: 12, background: C.surface, border: '1px solid ' + C.border }}>
                <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
                  {cp.groupIcon} {cp.groupName}：自 {cp.date} 起频率{cp.drop ? '下降' : '上升'} {(Math.abs(cp.relChange) * 100).toFixed(0)}%
                </div>
                <div style={{ fontSize: 12, color: C.textSec, marginTop: 4 }}>
                  {cp.beforeRate.toFixed(2)} 次/天 → {cp.afterRate.toFixed(2)} 次/天（{cp.drop ? '变冷' : '变热'}）
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={emptyStyle}>暂未发现明显的习惯频率突变（或数据不足）</p>
        )}
        {forecast.series.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: C.textSec, margin: '16px 0 10px', fontWeight: 600 }}>🔮 未来阶段起伏预测</div>
            <ForecastChart forecast={forecast} />
          </>
        )}
      </Section>

      {/* ── 日常原型聚类 ── */}
      <Section title="🗓️ 日常原型">
        {archetypes.archetypes.length ? (
          <>
            {archetypes.nextClusterLabel && (
              <div style={{ padding: '10px 14px', borderRadius: 12, marginBottom: 12, background: C.surface, border: '1px solid ' + C.borderLit, fontSize: 13, color: C.text }}>
                明天大概率：<b style={{ color: C.accentLt }}>{archetypes.nextClusterLabel}</b>
                {' '}（典型：{archetypes.archetypes.find((a) => a.label === archetypes.nextClusterLabel)?.topGroups.map((t) => t.name).join(' · ')}）
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
              {archetypes.archetypes.map((a) => (
                <div key={a.id} style={{ padding: 12, borderRadius: 12, background: C.surface, border: '1px solid ' + C.border }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    {a.label} <span style={{ fontSize: 11, color: C.textDim, fontWeight: 400 }}>· {a.size}天</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.textSec, marginTop: 5 }}>{a.topGroups.map((t) => `${t.icon}${t.name}`).join(' ')}</div>
                  {a.avgMood !== undefined && <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>均心情 {a.avgMood.toFixed(1)}</div>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <p style={emptyStyle}>天数不足，无法聚类（至少需要 4 天）</p>
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

                    {/* 日类型偏好：工作日 / 周末 / 节假日（按每天发生率归一） */}
                    {(() => {
                      const dr = t.dayTypeRate;
                      const labels: Record<string, string> = { weekday: '工作日', weekend: '周末', holiday: '节假日' };
                      if (!t.modalDayType) {
                        return (
                          <div style={{ marginTop: 10, fontSize: 11, color: C.textDim }}>
                            日类型：无明显偏好（每天发生率≈均匀）
                            <span style={{ marginLeft: 8 }}>
                              工{dr.weekday.toFixed(2)} · 末{dr.weekend.toFixed(2)} · 假{dr.holiday.toFixed(2)} 次/天
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div style={{ marginTop: 10, fontSize: 11, color: C.textSec }}>
                          日类型偏好：偏 {labels[t.modalDayType]}（{t.dayTypePrefIndex.toFixed(2)}× 整体）
                          <span style={{ marginLeft: 8, color: C.textDim }}>
                            工{dr.weekday.toFixed(2)} · 末{dr.weekend.toFixed(2)} · 假{dr.holiday.toFixed(2)} 次/天
                          </span>
                        </div>
                      );
                    })()}

                    {/* 时段偏好：凌晨/上午/下午/晚间（北京时间，去均匀基线） */}
                    {(() => {
                      const td = t.todDist;
                      const labels = ['凌晨', '上午', '下午', '晚间'];
                      if (!t.timeOfDayPref) {
                        return (
                          <div style={{ marginTop: 6, fontSize: 11, color: C.textDim }}>
                            时段：无明显偏好（各段≈均匀）
                            <span style={{ marginLeft: 8 }}>
                              {labels.map((l, i) => `${l}${(td[i] * 100).toFixed(0)}%`).join(' · ')}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div style={{ marginTop: 6, fontSize: 11, color: C.textSec }}>
                          时段偏好：偏{t.timeOfDayPref}
                          {t.prefHour !== null && <span style={{ marginLeft: 4 }}>（峰值 {t.prefHour}时）</span>}
                          <span style={{ marginLeft: 8, color: C.textDim }}>
                            {labels.map((l, i) => `${l}${(td[i] * 100).toFixed(0)}%`).join(' · ')}
                          </span>
                        </div>
                      );
                    })()}

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
        <p>高级：跨域联动(心情/睡眠) + 生存分析(危险率) + 场景motif + 习惯漂移 + K-means日常原型 + 阶段起伏外推(未来预测)</p>
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
  const predBjHour = (new Date(timing.predictedNextAt).getUTCHours() + 8) % 24;
  return (
    <div style={{ marginTop: -4, marginBottom: 12, padding: '9px 12px', borderRadius: 10, background: C.surface, border: '1px solid ' + C.border }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>📅</span>
        <span style={{ fontSize: 13, color: C.text }}>
          预计下次{label}：<b style={{ color: C.accentLt }}>{fmtDate(timing.predictedNextAt)}</b>
          {timing.prefHour !== null && (
            <span style={{ fontSize: 11, color: C.textDim, marginLeft: 6 }}>约 {predBjHour}时</span>
          )}
          {timing.modalDayType && (
            <span style={{ fontSize: 11, color: C.textDim, marginLeft: 6 }}>
              倾向于{timing.modalDayType === 'holiday' ? '节假日' : timing.modalDayType === 'weekend' ? '周末' : '工作日'}
            </span>
          )}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: cd.overdue ? C.red : C.textSec, whiteSpace: 'nowrap' }}>{cd.text}</span>
        <span style={{ fontSize: 11, color: confColor, border: `1px solid ${confColor}`, padding: '1px 7px', borderRadius: 10, whiteSpace: 'nowrap' }}>
          {CONFIDENCE_LABEL[timing.confidence]}
        </span>
      </div>
      {timing.hazardNow !== undefined && (
        <div style={{ fontSize: 11, color: C.textDim, marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>今天发生概率 <b style={{ color: C.text }}>{(timing.hazardNow * 100).toFixed(0)}%</b></span>
          <span>已隔 <b style={{ color: C.text }}>{timing.currentGapDays!.toFixed(0)}</b> 天</span>
          {timing.offRoutine && <span style={{ color: C.red }}>⚠️ 已偏离常规节奏</span>}
        </div>
      )}
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

function smoothPath(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}` : '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function maSmooth(points: { x: number; y: number }[], window = 7) {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const lo = Math.max(0, i - Math.floor(window / 2));
    const hi = Math.min(points.length - 1, i + Math.floor(window / 2));
    let sum = 0, cnt = 0;
    for (let j = lo; j <= hi; j++) { sum += points[j].y; cnt++; }
    out.push({ x: points[i].x, y: sum / cnt });
  }
  return out;
}

/* ── 阶段起伏预测图：历史 regime 向前外推 → 7 天移动平均 + Catmull-Rom 样条平滑 + 悬停探测 ── */
function ForecastChart({ forecast }: { forecast: ForecastResult }) {
  const [normalize, setNormalize] = useState(false); // 默认统一刻度（/天），看实际量级
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const W = 720, H = 340;
  const padL = 42, padR = 14, padT = 14, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const horizon = forecast.horizonWeeks;
  const horizonDays = horizon * 7;

  const palette = ['#818cf8', '#4ade80', '#eab308', '#f87171', '#a855f7', '#22d3ee', '#fb923c', '#f472b6', '#34d399', '#60a5fa'];
  const colorOf = (s: ForecastSeries, i: number) => (s.color && s.color.startsWith('#')) ? s.color : palette[i % palette.length];

  const seriesMax = (s: ForecastSeries) => Math.max(1e-6, ...s.forecast.map((p) => p.rate));
  const xAt = (d: number) => padL + (d / horizonDays) * plotW;
  const yTopFor = (s: ForecastSeries) => (normalize ? seriesMax(s) : forecast.maxRate);
  const yAt = (rate: number, s: ForecastSeries) => {
    const top = yTopFor(s);
    return padT + plotH - (Math.min(rate, top) / top) * plotH;
  };

  // 平滑曲线：先 7 天移动平均降噪，再用 Catmull-Rom 样条连接成丝滑曲线。
  const buildPath = (s: ForecastSeries) => {
    const raw = s.forecast.map((p, d) => ({ x: xAt(d), y: p.rate }));
    const smoothed = maSmooth(raw, 7);
    const pts = smoothed.map((p) => ({ ...p, y: yAt(p.y, s) }));
    return { mean: smoothPath(pts), dots: smoothed.map((p, d) => ({ day: d, x: p.x, y: yAt(p.y, s), rate: raw[d].y })) };
  };

  // 预计算各系列（按天）的克里金路径 + 置信带 + 逐日点，供绘制与悬停共用
  const seriesPaths = useMemo(
    () => forecast.series.filter((s) => !hidden.has(s.groupId)).map((s) => ({ s, ...buildPath(s) })),
    [hidden, normalize, forecast, horizonDays]
  );

  const yTicks = 4;
  const yGrid = Array.from({ length: yTicks + 1 }, (_, i) => {
    const frac = i / yTicks;
    return { y: padT + plotH - frac * plotH, val: normalize ? frac : forecast.maxRate * frac };
  });

  // X 刻度：每隔几周标一个日期（直接用今天 + w*7 天算，避免依赖每日采样数组下标）
  const tickStep = Math.max(1, Math.round(horizon / 8));
  const xTicks: { w: number; label: string }[] = [];
  for (let w = 0; w <= horizon; w += tickStep) {
    const d = new Date(Date.now() + w * 7 * 86400000);
    xTicks.push({ w, label: `${d.getMonth() + 1}/${d.getDate()}` });
  }

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    if (x < padL || x > padL + plotW) { setHoverDay(null); return; }
    const frac = (x - padL) / plotW;
    setHoverDay(Math.max(0, Math.min(horizonDays, Math.round(frac * horizonDays))));
  };

  const visible = forecast.series.filter((s) => !hidden.has(s.groupId));
  const tipRows = hoverDay != null
    ? seriesPaths.map(({ s, dots }) => ({ s, v: dots[hoverDay].rate })).sort((a, b) => b.v - a.v)
    : [];

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
    border: '1px solid ' + (active ? C.accent : C.border),
    background: active ? C.accent + '22' : 'transparent', color: active ? C.accentLt : C.textSec,
  });

  const rowH = 14, boxW = 178;
  const boxX = hoverDay != null ? Math.min(W - padR - boxW, Math.max(padL, xAt(hoverDay) + 10)) : 0;
  const boxY = padT + 6;
  const bandFill = (kind: 'hot' | 'cold' | 'normal') => (kind === 'hot' ? '#4ade80' : kind === 'cold' ? '#f87171' : null);
  // 悬停高亮：只完整显示当前线，其余线变淡
  const [hoverGroupId, setHoverGroupId] = useState<string | null>(null);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.textSec }}>纵轴：预测次/天（从今天起 {horizonDays} 天）</span>
        <button onClick={() => setNormalize((v) => !v)} style={toggleStyle(normalize)}>
          {normalize ? '相对自身峰值（看起伏形状）' : '统一刻度（看量级）'}
        </button>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', background: C.surface, borderRadius: 14, border: '1px solid ' + C.border, cursor: 'crosshair' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverDay(null)}
      >
        {/* 横向网格 + Y 轴标签 */}
        {yGrid.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke={C.border} strokeWidth={1} strokeDasharray="3 4" opacity={0.25} />
            <text x={padL - 6} y={g.y + 3} textAnchor="end" fontSize={10} fill={C.textDim}>
              {normalize ? g.val.toFixed(2) : g.val.toFixed(1)}
            </text>
          </g>
        ))}

        {/* X 刻度（日期）：只在关键周标，避免过密 */}
        {xTicks.map((tk, i) => (
          <g key={i}>
            <line x1={xAt(tk.w * 7)} y1={padT} x2={xAt(tk.w * 7)} y2={padT + plotH} stroke={C.border} strokeWidth={1} strokeDasharray="2 4" opacity={0.35} />
            <text x={xAt(tk.w * 7)} y={H - 8} textAnchor="middle" fontSize={10} fill={C.textDim}>{tk.label}</text>
          </g>
        ))}

        {/* 今天标记（左边缘 = 第 0 周） */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke={C.accentLt} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.6} />
        <text x={padL + 4} y={padT - 3} fontSize={10} fill={C.accentLt}>今天</text>

        {/* 平滑预测曲线：7 天移动平均 + Catmull-Rom 样条；悬停时高亮当前线，其余线淡化 */}
        {visible.map((s) => {
          const oi = forecast.series.indexOf(s);
          const { mean } = buildPath(s);
          const col = colorOf(s, oi);
          const isDim = hoverGroupId != null && hoverGroupId !== s.groupId;
          return (
            <g key={s.groupId}
               onMouseEnter={() => setHoverGroupId(s.groupId)}
               onMouseLeave={() => setHoverGroupId(null)}
               style={{ pointerEvents: 'all' }}
            >
              {/* invisible 更宽的热区，便于悬停 */}
              <path d={mean} fill="none" stroke="transparent" strokeWidth={12} strokeLinejoin="round" strokeLinecap="round" />
              <path d={mean} fill="none" stroke={col} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" opacity={isDim ? 0.12 : 0.9} />
            </g>
          );
        })}

        {/* 悬停竖向引导线 + 数据点 */}
        {hoverDay != null && (() => {
          const x = xAt(hoverDay);
          return (
            <g>
              <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke={C.textSec} strokeWidth={1} opacity={0.5} />
              {seriesPaths.map(({ s, dots }) => {
                const y = dots[hoverDay].y;
                return <circle key={s.groupId} cx={x} cy={y} r={3} fill={colorOf(s, forecast.series.indexOf(s))} stroke={C.surface} strokeWidth={1.5} />;
              })}
            </g>
          );
        })()}

        {/* 悬停浮窗 */}
        {hoverDay != null && tipRows.length > 0 && (() => {
          const date = new Date(Date.now() + hoverDay * 86400000);
          const boxH = 8 + 16 + tipRows.length * rowH;
          const title = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
          const dtLabel = seriesPaths[0]?.s.forecast[hoverDay]?.dayType;
          const dtText = dtLabel === 'holiday' ? '节假日' : dtLabel === 'weekend' ? '周末' : '工作日';
          return (
            <g>
              <rect x={boxX} y={boxY} width={boxW} height={boxH} rx={8} fill={C.card} stroke={C.borderLit} opacity={0.97} />
              <text x={boxX + 10} y={boxY + 16} fontSize={10} fill={C.textSec}>{title} · 第 {hoverDay} 天 · {dtText}</text>
              {tipRows.map((r, i) => (
                <g key={r.s.groupId}>
                  <circle cx={boxX + 14} cy={boxY + 30 + i * rowH} r={3} fill={colorOf(r.s, forecast.series.indexOf(r.s))} />
                  <text x={boxX + 24} y={boxY + 34 + i * rowH} fontSize={10} fill={C.text}>{r.s.icon} {r.s.name}</text>
                  <text x={boxX + boxW - 10} y={boxY + 34 + i * rowH} fontSize={10} fill={C.text} textAnchor="end">{r.v.toFixed(2)} 次/天</text>
                </g>
              ))}
            </g>
          );
        })()}
      </svg>

      {/* 图例（点击可隐藏/显示单条曲线；悬停高亮对应曲线） */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {forecast.series.map((s, i) => {
          const off = hidden.has(s.groupId);
          const col = colorOf(s, i);
          const isDim = hoverGroupId != null && hoverGroupId !== s.groupId;
          return (
            <button
              key={s.groupId}
              onClick={() => { const h = new Set(hidden); if (h.has(s.groupId)) h.delete(s.groupId); else h.add(s.groupId); setHidden(h); }}
              onMouseEnter={() => setHoverGroupId(s.groupId)}
              onMouseLeave={() => setHoverGroupId(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', opacity: (off || isDim) ? 0.45 : 1, background: off ? 'transparent' : col + '22', border: '1px solid ' + (off ? C.border : col), color: off ? C.textDim : C.text }}
            >
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: col, display: 'inline-block' }} />
              {s.icon} {s.name}
            </button>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: C.textDim, marginTop: 8 }}>
        按历史「工作日 / 周末 / 节假日」各自频次加权外推未来 {horizonDays} 天；先 7 天移动平均降噪，再用 Catmull-Rom 样条连成平滑曲线。悬停看某天类型与各线预测次/天。
      </p>
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
