'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getPrivateSession } from '@/lib/auth';
import { usePrivateAccess } from '@/lib/private';
import {
  C, pageStyle, headerStyle, h1Style, backLinkStyle, emptyStyle,
  loadingContainerStyle, spinnerStyle, loadingTextStyle,
} from '@/lib/card-styles';
import {
  computeTiming, predictNextEntityMarkov, blendMarkovResults, computeGroupDependencies, weekdayName,
  countdownText, fmtDate, CONFIDENCE_LABEL, CONFIDENCE_COLOR, assocColor, assocLabel,
  predictNoveltyMeal, predictNewSongCount,
  buildDailyFeatures, computeCrossDomain, predictScenarioMotifs, detectRegimes,
  forecastFutureRegimes, forecastScalarSeries, computeDomainTriad, setHolidaySet, fetchHolidays,
  median, mean, linregSlope,
  type EventLogLite, type EventGroupLite, type EntityRank, type MarkovItem, type GroupDep,
  type MoodPoint, type ForecastSeries, type ForecastResult, type DomainTriad, type ScalarForecastResult,
} from '@/lib/prediction';
import { currentTag, tagAt, locationTagActivityProfile, predictLocationTransition, forecastLocationState, logsForTag, type LocStay, type LocTagStay, type LocationTransitionResult, type LocationStateForecast } from '@/lib/location-predict';
import { groupBySleepDay, utcToBeijing } from '@/lib/sleep-utils';
import { tagMeta } from '@/lib/location-place';
import { computeAttribution, fmtOnset, fmtAbs, fmtSign, type Attribution } from '@/lib/insights';

interface MusicLite { id: string; title: string; artist: string[]; created_at?: string; }
interface MusicTagLite { music_id: string; singability?: number; likability?: number; }
interface MealLite { id: string; title: string; rating: string; }
interface SleepSeg { start_date: string; end_date: string; sleep_type: string; duration_minutes: number; }

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
  const [sleepData, setSleepData] = useState<SleepSeg[]>([]);
  const [locationStays, setLocationStays] = useState<LocStay[]>([]);
  const [tagStays, setTagStays] = useState<LocTagStay[]>([]);
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
      const gHash = getPrivateSession();
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

    const [{ data: lData }, { data: mData }, { data: tData }, { data: mealData }, moodRes, sleepRes] =
      await Promise.all([
        supabase.from('event_logs').select('id, group_id, event_at, refs'),
        supabase.from('music_list').select('id, title, artist, created_at'),
        supabase.from('music_tags').select('music_id, singability, likability'),
        supabase.from('meals').select('id, title, rating'),
        supabase.rpc('fn_get_mood_logs_public'),
        supabase.from('health_sleep').select('start_date, end_date, sleep_type, duration_minutes'),
      ]);

    let mergedLogs = (lData || []) as EventLogLite[];
    if (unlocked) {
      const hash = getPrivateSession();
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

    setMoodData((moodRes.data || []) as MoodPoint[]);
    setSleepData((sleepRes.data || []) as SleepSeg[]);

    // 公开标签时段（不含城市）：始终拉取，用于公开标签规律
    const { data: tag } = await supabase.rpc('fn_get_location_tag_stays');
    if (tag && Array.isArray(tag)) {
      setTagStays(
        (tag as Array<Record<string, unknown>>).map((r) => ({
          started_at: r.started_at as string,
          ended_at: (r.ended_at as string) ?? null,
          tag: (r.tag as string) || '其他',
        })) as LocTagStay[]
      );
    } else {
      setTagStays([]);
    }

    // 位置数据（私密）：解锁后拉取，用于「位置规律」联动
    if (unlocked) {
      const lHash = getPrivateSession();
      if (lHash) {
        const { data: loc } = await supabase.rpc('fn_get_location_stays', { p_hash: lHash });
        if (loc && Array.isArray(loc)) {
          setLocationStays(
            (loc as Array<Record<string, unknown>>).map((r) => ({
              id: r.id as string,
              started_at: r.started_at as string,
              ended_at: (r.ended_at as string) ?? null,
              country: (r.country as string) || '中国',
              province: (r.province as string) ?? null,
              city: (r.city as string) ?? null,
              tag: (r.tag as string) || '其他',
            })) as LocStay[]
          );
        }
      }
    } else {
      setLocationStays([]);
    }

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

  // ── 公开标签规律（不含城市）──
  const currentTagCtx = useMemo(() => currentTag(tagStays), [tagStays]);
  const tagProfile = useMemo(
    () => locationTagActivityProfile(rawLogs, tagStays, groups),
    [rawLogs, tagStays, groups]
  );
  // 当前标签条件下的事件日志（仅取在该标签时段发生的）
  const songLogsByTag = useMemo(
    () => (currentTagCtx
      ? songLogs.filter((l) => tagAt(new Date(l.event_at).getTime(), tagStays)?.tag === currentTagCtx.tag)
      : []),
    [songLogs, currentTagCtx, tagStays]
  );
  const mealLogsByTag = useMemo(
    () => (currentTagCtx && mealGroup
      ? (logsByGroup[mealGroup.id] || []).filter((l) => tagAt(new Date(l.event_at).getTime(), tagStays)?.tag === currentTagCtx.tag)
      : []),
    [mealGroup, logsByGroup, currentTagCtx, tagStays]
  );
  // 标签预测：≥3 次活动才用本地规律；旅游标签随机性强，直接回退整体
  const isTagRandom = currentTagCtx?.tag === '旅游';
  const songPredTag = useMemo(
    () => (currentTagCtx && !isTagRandom && songLogsByTag.length >= 3
      ? predictNextEntityMarkov(songLogsByTag, { prefScore: songPref, freshScore: songFresh, coldCandidates: songColdCandidates, mode: 'membership' })
      : null),
    [currentTagCtx, isTagRandom, songLogsByTag, songPref, songFresh, songColdCandidates]
  );
  const mealPredTag = useMemo(
    () => (currentTagCtx && !isTagRandom && mealLogsByTag.length >= 3 && mealGroup
      ? predictNextEntityMarkov(mealLogsByTag, { prefScore: mealPref })
      : null),
    [currentTagCtx, isTagRandom, mealLogsByTag, mealGroup, mealPref, mealById]
  );
  // 大餐主预测：优先用「当前位置」本地规律；否则回退整体规律。
  const mealMain = mealPredTag ?? mealPred;
  const usingLocationMeal = !!mealPredTag && !!currentTagCtx;
  // 新菜概率也跟随主预测：本地记录足够时按本地算，否则按整体算。
  const mealNoveltyMain = useMemo(
    () => (usingLocationMeal && mealLogsByTag.length
      ? predictNoveltyMeal(mealLogsByTag)
      : mealNovelty),
    [usingLocationMeal, mealLogsByTag, mealNovelty]
  );
  // 把「前所未见新菜」并入大餐分类分布（与新菜互斥：新菜概率 = nov，其余已知菜 = (1-nov)·原概率，总和恒为 1）。
  // 合并后统一排序——概率最高时「新菜」自然排到最前，不再单独成框、也不会让总概率超过 100%。
  const mealCombined = useMemo(() => {
    if (!mealMain) return null;
    const nov = mealNoveltyMain && mealNoveltyMain.prob > 0 ? mealNoveltyMain.prob : 0;
    const items: MarkovItem[] = mealMain.nextTop.map((e) => ({
      ...e,
      prob: (1 - nov) * e.prob,
      isNew: false,
    }));
    if (nov > 0) {
      items.unshift({ id: '__novel__', title: '🆕 前所未见的新菜', prob: nov, fromTransition: false, pref: null, isNew: true });
    }
    items.sort((a, b) => (b.prob ?? 0) - (a.prob ?? 0));
    return { items, nov };
  }, [mealMain, mealNoveltyMain]);
  // 唱歌主预测：地区只起偏置、不主导（融合全局 + 当前位置本地规律，
  // 权重 0.4 → 全局数据始终保留，不会"只看该地区数据"）。整份歌单基于 songMain。
  const SONG_LOCAL_WEIGHT = 0.4;
  const songMain = useMemo(
    () => (songPred ? blendMarkovResults(songPred, songPredTag, SONG_LOCAL_WEIGHT) : null),
    [songPred, songPredTag]
  );
  const usingLocationSong = !!songPredTag && !!currentTagCtx;

  // ── 位置变动规律（标签级公开 / 地点级私密）──
  const locTrans = useMemo<LocationTransitionResult | null>(() => {
    if (!tagStays.length) return null;
    return predictLocationTransition(tagStays, unlocked ? locationStays : null);
  }, [tagStays, locationStays, unlocked]);
  const locState = useMemo<LocationStateForecast | null>(() => (locTrans ? forecastLocationState(locTrans, 16) : null), [locTrans]);
  // 各事件组 × 各标签 的节奏（分地点讨论）
  const locTags = useMemo(() => tagProfile.map((p) => p.tag), [tagProfile]);
  const timingByTag = useMemo(() => {
    const m: Record<string, Record<string, ReturnType<typeof computeTiming>>> = {};
    for (const g of groups) {
      const lg = logsByGroup[g.id];
      if (!lg || lg.length < 2) continue;
      const mm: Record<string, ReturnType<typeof computeTiming>> = {};
      for (const tag of locTags) {
        const sub = logsForTag(lg, tagStays, tag);
        if (sub.length >= 2) mm[tag] = computeTiming(sub);
      }
      if (Object.keys(mm).length) m[g.id] = mm;
    }
    return m;
  }, [groups, logsByGroup, tagStays, locTags]);
  // 跨域联动用的「位置偏向」：每个事件组最具代表性的地点（lift 最高）
  const groupLiftByTag = useMemo(() => {
    const m: Record<string, { tag: string; lift: number } | null> = {};
    for (const p of tagProfile) {
      for (const a of p.activities) {
        if (a.lift > 1.15) {
          const cur = m[a.groupId];
          if (!cur || a.lift > cur.lift) m[a.groupId] = { tag: p.tag, lift: a.lift };
        }
      }
    }
    return m;
  }, [tagProfile]);

  const deps = useMemo(() => computeGroupDependencies(groups, logsByGroup, 2), [groups, logsByGroup]);

  // 高级预测：每日特征 + 跨域联动 + 三者两两关系 + 场景motif + 阶段起伏
  const dailyFeatures = useMemo(
    () => buildDailyFeatures(rawLogs, groups, moodData, sleepData),
    [rawLogs, groups, moodData, sleepData]
  );
  const crossDomain = useMemo(() => computeCrossDomain(dailyFeatures, groups), [dailyFeatures, groups]);

  // 三者两两关系（心情 / 睡眠 / 位置）
  const domainTriad = useMemo(
    () => computeDomainTriad(dailyFeatures, (ts) => tagAt(ts, tagStays)?.tag ?? null),
    [dailyFeatures, tagStays]
  );

  // ── 心情 / 睡眠 预测曲线用的每日序列 ──
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const moodDaily = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of moodData) {
      const d = new Date(r.created_at).toISOString().slice(0, 10);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(r.mood_score);
    }
    return [...m.entries()].map(([date, v]) => ({ date, value: avg(v) }));
  }, [moodData]);

  const sleepNightly = useMemo(() => {
    // 与 /sleep 页保持一致：以北京 18:00 为一天起点；睡眠时长 = 非 in_bed 段总分钟；入睡时间 = 最长 in_bed 段起点
    const byNight = groupBySleepDay(sleepData);
    const onset: { date: string; value: number | undefined }[] = [];
    const dur: { date: string; value: number | undefined }[] = [];
    for (const night of byNight) {
      if (!night.segs.length) continue;
      const sorted = night.segs.slice().sort((a, b) => a.start_date.localeCompare(b.start_date));
      const inBedSegs = sorted.filter((s) => s.sleep_type === 'in_bed');
      const mainBed = inBedSegs.length
        ? inBedSegs.reduce((a, b) => ((a.duration_minutes || 0) >= (b.duration_minutes || 0) ? a : b))
        : sorted[0];
      const { beijingHr } = utcToBeijing(mainBed.start_date);
      const hr = beijingHr >= 18 ? beijingHr : beijingHr + 24; // 早凌晨归到 24+，曲线连续
      onset.push({ date: night.day, value: hr });
      dur.push({ date: night.day, value: (night.asleepMin || 0) / 60 }); // 内部转为小时，展示更直观
    }
    return { onset, dur };
  }, [sleepData]);

  // 跨域归因：把联动关系提炼成「能直接读」的结论列表（按效应量排序）
  const attribution = useMemo<Attribution[]>(() => {
    if (!moodDaily.length && !sleepNightly.dur.length) return [];
    return computeAttribution({
      crossDomain,
      moodDaily,
      sleepOnset: sleepNightly.onset,
      sleepDur: sleepNightly.dur,
      resolveTag: (ts) => tagAt(ts, tagStays)?.tag ?? null,
    });
  }, [crossDomain, moodDaily, sleepNightly, tagStays]);

  // 心情不做自身历史外推（无稳定周期、硬外推只会造假规律），
  // 改由「睡眠时长」+「所在地」这两个【可预测变量】驱动：
  //   心情(d) ≈ 基线 + 斜率·(预测睡眠时长(d) − 平均睡眠) + Σ 地点概率·该地点心情偏离
  const moodFc = useMemo<ScalarForecastResult>(() => {
    if (!moodDaily.length) return { points: [], level: null, hasEnough: false };
    const baseMood = median(moodDaily.map((d) => d.value));
    const DAY = 86400000;
    // 睡眠时长未来预测（与下方 durFc 同口径），作为心情的「睡眠驱动」输入
    const sleepFc = forecastScalarSeries(sleepNightly.dur, { horizonWeeks: 4, minHistory: 14, seasonal: true, revertWeeks: 8 });

    // ① 睡眠驱动：对齐「同日有心情 + 有睡眠时长」的日子，回归 心情 ~ 睡眠小时
    const durByDate = new Map(sleepNightly.dur.map((d) => [d.date, d.value]));
    const pairs: { mood: number; dur: number }[] = [];
    for (const m of moodDaily) {
      const dv = durByDate.get(m.date);
      if (dv != null && isFinite(dv)) pairs.push({ mood: m.value, dur: dv });
    }
    const avgSleepHr = pairs.length ? mean(pairs.map((p) => p.dur)) : 7;
    const sleepSlope = linregSlope(pairs.map((p) => p.dur), pairs.map((p) => p.mood)); // Δ心情/Δ小时

    // ② 位置驱动：各地点相对基线的心情偏离（全量，而非只取偏离最大者）
    const byTag: Record<string, number[]> = {};
    for (const m of moodDaily) {
      const ts = new Date(m.date + 'T00:00:00Z').getTime();
      const tag = tagAt(ts, tagStays)?.tag ?? null;
      if (!tag) continue;
      if (!byTag[tag]) byTag[tag] = [];
      byTag[tag].push(m.value);
    }
    const tagMood: Record<string, number> = {};
    for (const [tag, arr] of Object.entries(byTag)) {
      if (arr.length >= 3) tagMood[tag] = mean(arr) - baseMood;
    }

    const todayMid = new Date(); todayMid.setUTCHours(0, 0, 0, 0);
    const hist = moodDaily.map((d) => ({
      dayOffset: Math.round((new Date(d.date + 'T00:00:00Z').getTime() - todayMid.getTime()) / DAY),
      dateISO: new Date(d.date + 'T00:00:00Z').toISOString(),
      value: d.value, isFuture: false,
    }));
    const futRaw = sleepFc.points.filter((p) => p.isFuture);
    const fut = futRaw.map((p) => {
      const w = Math.min(Math.ceil(p.dayOffset / 7), Math.max(0, (locState?.weeks.length ?? 1) - 1));
      const dist = locState?.weeks[w]?.dist ?? {};
      let locDev = 0;
      for (const [tag, prob] of Object.entries(dist)) locDev += (tagMood[tag] ?? 0) * prob;
      const sleepDev = sleepSlope * ((p.value ?? avgSleepHr) - avgSleepHr);
      return { dayOffset: p.dayOffset, dateISO: p.dateISO, value: baseMood + sleepDev + locDev, isFuture: true };
    });
    return { points: [...hist, ...fut], level: baseMood, hasEnough: true };
  }, [moodDaily, sleepNightly, locState, tagStays]);
  // 睡眠（入睡/时长）也吃【所在地】因素：各地点相对全量基线的偏离，
  // 按位置预测的逐周概率加权，叠加到 forecastScalarSeries 的未来点上（与心情同一套路）。
  const onsetLocDev = useMemo(() => {
    const vals = sleepNightly.onset.filter((d) => d.value != null && isFinite(d.value)).map((d) => d.value as number);
    const base = vals.length ? median(vals) : 0;
    const byTag: Record<string, number[]> = {};
    for (const o of sleepNightly.onset) {
      if (o.value == null || !isFinite(o.value)) continue;
      const ts = new Date(o.date + 'T00:00:00Z').getTime();
      const tag = tagAt(ts, tagStays)?.tag ?? null;
      if (!tag) continue;
      (byTag[tag] ||= []).push(o.value);
    }
    const out: Record<string, number> = {};
    for (const [tag, arr] of Object.entries(byTag)) if (arr.length >= 3) out[tag] = mean(arr) - base;
    return out;
  }, [sleepNightly, tagStays]);

  const durLocDev = useMemo(() => {
    const vals = sleepNightly.dur.filter((d) => d.value != null && isFinite(d.value)).map((d) => d.value as number);
    const base = vals.length ? median(vals) : 0;
    const byTag: Record<string, number[]> = {};
    for (const d of sleepNightly.dur) {
      if (d.value == null || !isFinite(d.value)) continue;
      const ts = new Date(d.date + 'T00:00:00Z').getTime();
      const tag = tagAt(ts, tagStays)?.tag ?? null;
      if (!tag) continue;
      (byTag[tag] ||= []).push(d.value);
    }
    const out: Record<string, number> = {};
    for (const [tag, arr] of Object.entries(byTag)) if (arr.length >= 3) out[tag] = mean(arr) - base;
    return out;
  }, [sleepNightly, tagStays]);

  const onsetFc = useMemo<ScalarForecastResult>(() => {
    const base = forecastScalarSeries(sleepNightly.onset, { horizonWeeks: 4, minHistory: 14, seasonal: true, revertWeeks: 8 });
    return applyLocationDeviation(base, onsetLocDev, locState);
  }, [sleepNightly, onsetLocDev, locState]);

  const durFc = useMemo<ScalarForecastResult>(() => {
    const base = forecastScalarSeries(sleepNightly.dur, { horizonWeeks: 4, minHistory: 14, seasonal: true, revertWeeks: 8 });
    return applyLocationDeviation(base, durLocDev, locState);
  }, [sleepNightly, durLocDev, locState]);
  const mealMotif = useMemo(
    () => (mealGroup ? predictScenarioMotifs(rawLogs, groups, mealGroup.id) : null),
    [mealGroup, rawLogs, groups]
  );
  const songMotif = useMemo(
    () => (songGroup ? predictScenarioMotifs(rawLogs, groups, songGroup.id) : null),
    [songGroup, rawLogs, groups]
  );
  const regimes = useMemo(() => detectRegimes(logsByGroup, groups), [logsByGroup, groups]);
  // 阶段起伏预测：基于历史 regime 向前外推未来曲线（必须放在 regimes 之后）
  const forecast = useMemo(
    () => forecastFutureRegimes(regimes, groups, logsByGroup, { horizonWeeks: 16 }),
    [regimes, groups]
  );
  // 事件历史实际频次（近 10 天，每日计数），画进事件预测曲线作精确历史段
  const eventHistory = useMemo(() => {
    const out: Record<string, { day: number; rate: number }[]> = {};
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const WIN = 10;
    for (const g of groups) {
      const logs = logsByGroup[g.id] || [];
      const cnt = new Map<number, number>();
      for (const l of logs) {
        const d = new Date(l.event_at); d.setUTCHours(0, 0, 0, 0);
        const off = Math.round((d.getTime() - today.getTime()) / 86400000);
        if (off < -WIN || off > 0) continue;
        cnt.set(off, (cnt.get(off) || 0) + 1);
      }
      const arr: { day: number; rate: number }[] = [];
      for (let off = -WIN; off <= 0; off++) arr.push({ day: off, rate: cnt.get(off) || 0 });
      out[g.id] = arr;
    }
    return out;
  }, [groups, logsByGroup]);
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

      {/* ── 位置变动预测（状态序列 Markov 转移） ── */}
      <Section title="📍 位置变动预测">
        {!locTrans || !locTrans.current ? (
          <p style={emptyStyle}>还没有位置记录，去 /admin 记录停留段后，这里会预测你下一次「换地方」的时间与去向。</p>
        ) : (
          <div style={{ padding: 18, borderRadius: 16, background: `linear-gradient(135deg, ${tagMeta(locTrans.current.tag).color}22, ${C.surface})`, border: '1px solid ' + C.borderLit }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: C.text }}>
                当前 <b style={{ color: tagMeta(locTrans.current.tag).color }}>{tagMeta(locTrans.current.tag).icon} {locTrans.current.tag}</b>
                {locTrans.current.place && unlocked && <b style={{ color: C.accentLt, marginLeft: 6 }}>{locTrans.current.place}</b>}
                {locTrans.current.since && <span style={{ fontSize: 11, color: C.textDim, marginLeft: 6 }}>自 {fmtDate(locTrans.current.since)} 起</span>}
              </span>
            </div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, color: C.text }}>
                {locTrans.predictedSwitchInDays != null
                  ? (locTrans.predictedSwitchInDays <= 0.5 ? '随时可能切换' : `约 ${Math.round(locTrans.predictedSwitchInDays)} 天后切换`)
                  : '切换时间暂无规律'}
              </span>
              {locTrans.nextTag && (
                <span style={{ fontSize: 13, color: C.text, background: C.surface, border: '1px solid ' + C.border, padding: '4px 10px', borderRadius: 10 }}>
                  → {tagMeta(locTrans.nextTag.tag).icon} {locTrans.nextTag.tag}
                  <b style={{ color: tagMeta(locTrans.nextTag.tag).color, marginLeft: 6 }}>{(locTrans.nextTag.prob * 100).toFixed(0)}%</b>
                </span>
              )}
              {locTrans.nextPlace && unlocked && (
                <span style={{ fontSize: 12, color: C.textSec }}>大概率去 {locTrans.nextPlace.place}</span>
              )}
            </div>
            {locTrans.enough && locTrans.transitions.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>你常这样走（转移概率）</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[...locTrans.transitions].sort((a, b) => b.count - a.count).slice(0, 5).map((t) => (
                    <span key={`${t.from}->${t.to}`} style={{ fontSize: 12, color: C.text, background: C.surface, border: '1px solid ' + C.border, padding: '3px 9px', borderRadius: 8 }}>
                      {tagMeta(t.from).icon}→{tagMeta(t.to).icon} {(t.prob * 100).toFixed(0)}%
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ── 下一次大餐吃什么 ── */}
      <Section title="🍽️ 下一次大餐吃什么">
        {mealCombined && mealCombined.items.length ? (
          <>
            <HeroCard
              icon="🍴"
              title={mealCombined.items[0].title}
              subtitle={
                usingLocationMeal && currentTagCtx
                  ? `📍 ${tagMeta(currentTagCtx.tag).icon}${currentTagCtx.tag}本地规律 · ${mealHeadline(mealMain!)}`
                  : mealHeadline(mealMain!)
              }
              accent={C.gold}
              badge={`概率 ${(mealCombined.items[0].prob * 100).toFixed(0)}%`}
            />
            <TimeLine timing={mealTiming} label="大餐" />
            <ProbList
              items={mealCombined.items.slice(0, 3)}
              render={(e) => e.title}
              meta={(e) => `${(e.prob * 100).toFixed(0)}% · ${e.isNew ? '新餐' : `评分 ${mealRating(e.id)}`}`}
            />
            {mealMotif && (
              <div style={{ fontSize: 12, color: C.textSec, marginTop: 12 }}>
                🎲 大餐常伴随：
                {mealMotif.companions.length
                  ? mealMotif.companions.map((c) => `${c.icon}${c.name} ×${c.lift.toFixed(1)}`).join(' · ')
                  : '无明显关联活动'}
              </div>
            )}
            <RecencyList ranking={mealMain!.ranking.slice(0, 5)} verb="吃过" emptyStyle={emptyStyle} />
          </>
        ) : (
          <p style={emptyStyle}>还没有「大餐」事件记录</p>
        )}
      </Section>

      {/* ── 下一次歌唱什么 ── */}
      <Section title="🎤 下一场可能唱的歌单">
        {songMain && songMain.nextTop.length ? (
          <>
            <HeroCard
              icon="🎵"
              title={songMain.nextTop[0].title}
              subtitle={
                usingLocationSong && currentTagCtx
                  ? `📍 兼顾${tagMeta(currentTagCtx.tag).icon}${currentTagCtx.tag}本地偏置 · ${songHeadline(songMain)}`
                  : (songArtist(songMain.nextTop[0].id).length
                      ? `${songArtist(songMain.nextTop[0].id).join(' / ')} · ${songHeadline(songMain)}`
                      : songHeadline(songMain))
              }
              accent={C.purple}
              badge={songSing(songMain.nextTop[0].id) != null ? `唱 ${songSing(songMain.nextTop[0].id)}` : `${(songMain.nextTop[0].prob * 100).toFixed(0)}%`}
            />
            {usingLocationSong && currentTagCtx ? (
              <div style={{ fontSize: 12, color: C.textSec, marginTop: -2, marginBottom: 12 }}>
                📍 歌单以整体唱歌规律为主，并融入当前位置 {tagMeta(currentTagCtx.tag).icon}{currentTagCtx.tag} 的本地偏置（地区权重 40%）
              </div>
            ) : currentTagCtx && (
              <div style={{ fontSize: 12, color: C.textDim, marginTop: -2, marginBottom: 12 }}>
                📍 {tagMeta(currentTagCtx.tag).icon}{currentTagCtx.tag}：本地记录不足，仅用整体规律
              </div>
            )}
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
              items={songMain.nextTop.slice(0, songTopN)}
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
            <RecencyList ranking={songMain.ranking.slice(0, 5)} verb="唱过" emptyStyle={emptyStyle} />
          </>
        ) : (
          <p style={emptyStyle}>还没有「歌 / 唱K」事件记录</p>
        )}
      </Section>

      {/* ── 事件关联（树图/关系图） ── */}
      <Section title="🔗 事件关联">
        {deps.length ? (
          <DependencyGraph groups={groups} deps={deps} />
        ) : (
          <p style={emptyStyle}>暂未发现明显的跨事件关联（或数据不足）</p>
        )}
        {(domainTriad.moodSleep != null || domainTriad.moodLoc || domainTriad.sleepLoc) && (
          <TriadRows triad={domainTriad} />
        )}
      </Section>

      {/* ── 跨域联动（心情/睡眠/位置 × 事件） ── */}
      <Section title="🧠 跨域联动（心情 / 睡眠 / 位置 × 事件）">
        {crossDomain.hasMood || crossDomain.hasSleep || tagProfile.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {crossDomain.byGroup.slice(0, 12).map((s) => {
              const loc = groupLiftByTag[s.groupId];
              return (
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
                  {tagProfile.length > 0 && (
                    <span style={{ fontSize: 12, width: 96, textAlign: 'right', color: loc ? tagMeta(loc.tag).color : C.textDim }}>
                      {loc ? `${tagMeta(loc.tag).icon}${loc.tag} ×${loc.lift.toFixed(1)}` : '位置 —'}
                    </span>
                  )}
                </div>
              );
            })}
            <p style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
              数值 = 该事件发生的日子，心情分 / 睡眠时长相对整体基线的平均偏差；位置列 = 该事件最偏好的地点（发生频率相对基线倍数，&gt;1 即此地更常见）。
            </p>
          </div>
        ) : (
          <p style={emptyStyle}>还没有心情 / 睡眠 / 位置记录，无法做跨域联动</p>
        )}
      </Section>

      {/* ── 跨域归因：什么在影响你 ── */}
      <Section title="🔍 是什么在影响你">
        {attribution.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {attribution.map((a) => {
              const color = a.dir === 'up' ? '#4ade80' : a.dir === 'down' ? '#f87171' : '#9ca3af';
              const confLabel = { high: '规律', medium: '较规律', low: '随性', unknown: '样本少' }[a.confidence];
              const deltaText =
                a.unit === 'r'
                  ? `r=${a.delta > 0 ? '+' : ''}${a.delta.toFixed(2)}`
                  : a.metric === '睡眠' || a.factor.startsWith('在')
                  ? `${fmtSign(a.delta)}${fmtAbs(a.delta, 1)}${a.unit}`
                  : `${fmtSign(a.delta)}${fmtAbs(a.delta)}${a.unit}`;
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: C.surface, border: '1px solid ' + C.border }}>
                  <span style={{ flex: 1, fontSize: 13, color: C.text }}>{a.factor}</span>
                  <span style={{ fontSize: 11, color: C.textSec, width: 64, textAlign: 'right' }}>{a.metric}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color, width: 84, textAlign: 'right' }}>{deltaText}</span>
                  <span style={{ fontSize: 10, color: C.textDim, width: 44, textAlign: 'right' }}>{confLabel}·{a.n}</span>
                </div>
              );
            })}
            <p style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
              按「效应量 × 置信度」排序；绿=正相关 / 红=负相关。睡眠以「前一天 → 次日心情」的滞后效应计算（避免把结果当原因）。
            </p>
          </div>
        ) : (
          <p style={emptyStyle}>还需要更多心情 / 睡眠 / 事件记录，才能归纳出影响规律</p>
        )}
      </Section>

      {/* ── 阶段起伏 / 位置状态（预测） ── */}
      <Section title="📉 阶段起伏 / 位置状态（预测）">
        {locState && locState.weeks.length > 1 && (
          <>
            <div style={{ fontSize: 12, color: C.textSec, margin: '0 0 10px', fontWeight: 600 }}>📍 位置状态预测（未来 16 周身处各地点的概率）</div>
            <LocationStateChart loc={locState} />
          </>
        )}
        {forecast.series.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: C.textSec, margin: '16px 0 10px', fontWeight: 600 }}>🔮 未来事件起伏预测</div>
            <ForecastChart forecast={forecast} history={eventHistory} />
          </>
        )}
        {moodFc.hasEnough && (
          <>
            <div style={{ fontSize: 12, color: C.textSec, margin: '20px 0 10px', fontWeight: 600 }}>💗 心情趋势预测</div>
            <ScalarChart title="心情评分" result={moodFc} color="#a855f7" unit="分" fmt={(v) => v.toFixed(1) + ' 分'} />
          </>
        )}
        {onsetFc.hasEnough && durFc.hasEnough && (
          <>
            <div style={{ fontSize: 12, color: C.textSec, margin: '20px 0 10px', fontWeight: 600 }}>😴 睡眠趋势预测</div>
            <ScalarChart
              title="入睡时间"
              result={onsetFc}
              color="#60a5fa"
              unit="时"
              invertY
              fmt={(v) => {
                const totalMin = (((v % 24) + 24) % 24) * 60;
                const hh = Math.floor(totalMin / 60);
                const m = Math.round(totalMin % 60);
                return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
              }}
            />
            <div style={{ height: 14 }} />
            <ScalarChart title="睡眠时长" result={durFc} color="#34d399" unit="小时" fmt={(v) => `${v.toFixed(1)} 小时`} />
          </>
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
                    {timingByTag[g.id] && (() => {
                      const items = Object.entries(timingByTag[g.id]!)
                        .filter(([, tt]) => tt.avgIntervalDays != null)
                        .map(([tag, tt]) => ({ tag, days: tt.avgIntervalDays! }));
                      if (!items.length) return null;
                      return (
                        <div style={{ fontSize: 11, color: C.textSec, marginTop: 10 }}>
                          📍 分地点平均间隔：{items.map((it) => `${tagMeta(it.tag).icon}${it.tag} ${it.days.toFixed(1)}天`).join(' · ')}
                        </div>
                      );
                    })()}
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
        <p>位置：停留段一阶 Markov 转移（预测换地方时间/去向）+ 分地点事件节奏 + 位置状态外推（与事件起伏并列）</p>
        <p>高级：跨域联动(心情/睡眠/位置 两两关系) + 生存分析(危险率) + 场景motif + 阶段起伏外推(未来预测) + 心情/睡眠趋势预测</p>
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
  const strength = Math.max(Math.abs(dep.liftBA - 1), Math.abs(dep.liftAB - 1), Math.abs(dep.corr));
  return (
    <div>
      <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 10 }}>
        {dep.aIcon} {dep.aName} ↔ {dep.bIcon} {dep.bName}
        <span style={{ float: 'right', fontSize: 11, color: C.textDim, cursor: 'pointer' }} onClick={onBack}>← 返回</span>
      </div>
      <Row label="关联方向" value={assocLabel(dep.assoc)} highlight />
      <Row label={`发生 ${dep.aName} 后 ${dep.windowDays} 天内出现 ${dep.bName}`} value={`${(dep.pGivenA * 100).toFixed(0)}%`} />
      <Row label={`发生 ${dep.bName} 后 ${dep.windowDays} 天内出现 ${dep.aName}`} value={`${(dep.pGivenB * 100).toFixed(0)}%`} />
      <Row label={`${dep.aName} 期间 ${dep.bName} 日均发生率`} value={`×${(dep.liftAB * 100).toFixed(0)}%（相对平时）`} />
      <Row label={`${dep.bName} 期间 ${dep.aName} 日均发生率`} value={`×${(dep.liftBA * 100).toFixed(0)}%（相对平时）`} />
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

// 把「各地点相对基线的偏离」按位置预测的逐周概率加权，叠加到标量预测的未来点上。
// 历史点保持精确（不动），只调未来点的 value，从而让睡眠/心情随「换地方」一起起伏。
function applyLocationDeviation(
  base: ScalarForecastResult,
  tagDev: Record<string, number>,
  locState: { weeks: { dist: Record<string, number> }[] } | null
): ScalarForecastResult {
  const fut = base.points
    .filter((p) => p.isFuture)
    .map((p) => {
      const w = Math.min(Math.ceil(p.dayOffset / 7), Math.max(0, (locState?.weeks.length ?? 1) - 1));
      const dist = locState?.weeks[w]?.dist ?? {};
      let locDev = 0;
      for (const [tag, prob] of Object.entries(dist)) locDev += (tagDev[tag] ?? 0) * prob;
      return { ...p, value: (p.value ?? 0) + locDev };
    });
  const hist = base.points.filter((p) => !p.isFuture);
  return { ...base, points: [...hist, ...fut] };
}

/* ── 阶段起伏预测图：历史 regime 向前外推 → 7 天移动平均 + Catmull-Rom 样条平滑 + 悬停探测 ── */
function ForecastChart({ forecast, history }: { forecast: ForecastResult; history?: Record<string, { day: number; rate: number }[]> }) {
  const [normalize, setNormalize] = useState(false); // 默认统一刻度（/天），看实际量级
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const W = 720, H = 340;
  const padL = 42, padR = 14, padT = 14, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const horizon = forecast.horizonWeeks;
  const horizonDays = horizon * 7;
  const HIST_DAYS = 10;
  const minDay = -HIST_DAYS;
  const span = horizonDays - minDay;

  const palette = ['#818cf8', '#4ade80', '#eab308', '#f87171', '#a855f7', '#22d3ee', '#fb923c', '#f472b6', '#34d399', '#60a5fa'];
  const colorOf = (s: ForecastSeries, i: number) => (s.color && s.color.startsWith('#')) ? s.color : palette[i % palette.length];

  // 历史实际频次峰值（近 HIST_DAYS 天），用于统一纵轴
  let histMaxRate = 0;
  if (history) { for (const arr of Object.values(history)) for (const p of arr) if (p.rate > histMaxRate) histMaxRate = p.rate; }
  const yTopGlobal = Math.max(forecast.maxRate, histMaxRate, 1e-6);

  const seriesMax = (s: ForecastSeries) => Math.max(1e-6, ...s.forecast.map((p) => p.rate));
  const xAt = (d: number) => padL + ((d - minDay) / span) * plotW;
  const yTopFor = (s: ForecastSeries) => (normalize ? seriesMax(s) : yTopGlobal);
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
  // 精确折线（不做平滑/回归），用于历史实际频次
  const lineThrough = (arr: { x: number; y: number }[]) =>
    arr.length ? arr.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') : '';

  // 预计算各系列（按天）的克里金路径 + 置信带 + 逐日点，供绘制与悬停共用
  const seriesPaths = useMemo(
    () => forecast.series.filter((s) => !hidden.has(s.groupId)).map((s) => ({ s, ...buildPath(s) })),
    [hidden, normalize, forecast, horizonDays]
  );

  const yTicks = 4;
  const yGrid = Array.from({ length: yTicks + 1 }, (_, i) => {
    const frac = i / yTicks;
    return { y: padT + plotH - frac * plotH, val: normalize ? frac : yTopGlobal * frac };
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
    // x 轴范围是 [minDay, horizonDays]；但 dots 仅覆盖预测段 [0, maxIdx]，历史段(<0)不挂悬停点
    const day = minDay + frac * span;
    const maxIdx = seriesPaths.length ? seriesPaths[0].dots.length - 1 : 0;
    const d = Math.round(day);
    if (d < 0 || d > maxIdx) { setHoverDay(null); return; }
    setHoverDay(d);
  };

  const visible = forecast.series.filter((s) => !hidden.has(s.groupId));
  const tipRows = hoverDay != null && hoverDay >= 0 && seriesPaths.length > 0 && hoverDay < seriesPaths[0].dots.length
    ? seriesPaths.map(({ s, dots }) => (dots[hoverDay] ? { s, v: dots[hoverDay].rate } : null)).filter((r): r is { s: ForecastSeries; v: number } => r != null).sort((a, b) => b.v - a.v)
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
        <span style={{ fontSize: 12, color: C.textSec }}>纵轴：预测次/天（近 {HIST_DAYS} 天实际 + 未来 {horizonDays} 天预测）</span>
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

        {/* 今天标记（第 0 天） */}
        <line x1={xAt(0)} y1={padT} x2={xAt(0)} y2={padT + plotH} stroke={C.accentLt} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.6} />
        <text x={xAt(0) + 4} y={padT - 3} fontSize={10} fill={C.accentLt}>今天</text>
        <text x={padL + 2} y={H - 8} fontSize={10} fill={C.textDim}>10天前</text>

        {/* 历史实际频次（近 10 天，精确实线，未平滑） */}
        {visible.map((s) => {
          const arr = history?.[s.groupId];
          if (!arr || !arr.length) return null;
          const col = colorOf(s, forecast.series.indexOf(s));
          const isDim = hoverGroupId != null && hoverGroupId !== s.groupId;
          return (
            <path key={'h-' + s.groupId} d={lineThrough(arr.map((p) => ({ x: xAt(p.day), y: yAt(p.rate, s) })))}
              fill="none" stroke={col} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={isDim ? 0.12 : 0.85} />
          );
        })}

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
        {hoverDay != null && seriesPaths.length > 0 && hoverDay < seriesPaths[0].dots.length && (() => {
          const x = xAt(hoverDay);
          return (
            <g>
              <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke={C.textSec} strokeWidth={1} opacity={0.5} />
              {seriesPaths.map(({ s, dots }) => {
                const dot = dots[hoverDay];
                if (!dot) return null;
                return <circle key={s.groupId} cx={x} cy={dot.y} r={3} fill={colorOf(s, forecast.series.indexOf(s))} stroke={C.surface} strokeWidth={1.5} />;
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
        近 {HIST_DAYS} 天实际频次（实线，精确未平滑）+ 未来 {horizonDays} 天预测（按历史「工作日 / 周末 / 节假日」频次加权外推，7 天移动平均 + Catmull-Rom 样条）。悬停看某天类型与各线预测次/天。
      </p>
    </div>
  );
}

/* ── 子组件 ── */

/* 三者两两关系图（心情 / 睡眠 / 位置）：仿事件关联，边粗细=关系强度，颜色表方向。 */
/* 三者两两关系（心情/睡眠/位置）：以关系行形式并入「事件关联」区，不单独画三角图 */
function TriadRows({ triad }: { triad: DomainTriad }) {
  const color = (v: number) => (v > 0.12 ? '#4ade80' : v < -0.12 ? '#f87171' : '#9ca3af');
  const rel = (v: number) => (v > 0.12 ? '同向' : v < -0.12 ? '反向' : '无关');
  const rows = [
    {
      key: 'ms', a: '💗', b: '😴', label: '心情 ↔ 睡眠',
      text: triad.moodSleep != null ? `Pearson r = ${triad.moodSleep.toFixed(2)}（${rel(triad.moodSleep)}）` : '数据不足',
      v: triad.moodSleep ?? 0,
    },
    {
      key: 'ml', a: '💗', b: '📍', label: '心情 ↔ 位置',
      text: triad.moodLoc ? `在 ${triad.moodLoc.tag} ${triad.moodLoc.z > 0 ? '偏高' : '偏低'} ${Math.abs(triad.moodLoc.z).toFixed(1)}σ` : '数据不足',
      v: triad.moodLoc?.z ?? 0,
    },
    {
      key: 'sl', a: '😴', b: '📍', label: '睡眠 ↔ 位置',
      text: triad.sleepLoc ? `在 ${triad.sleepLoc.tag} ${triad.sleepLoc.z > 0 ? '偏长' : '偏短'} ${Math.abs(triad.sleepLoc.z).toFixed(1)}σ` : '数据不足',
      v: triad.sleepLoc?.z ?? 0,
    },
  ];
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, color: C.textSec, fontWeight: 600, marginBottom: 8 }}>💞 心情 / 睡眠 / 位置 两两关系</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: C.surface, border: '1px solid ' + C.border }}>
            <span style={{ fontSize: 16 }}>{r.a}</span>
            <span style={{ fontSize: 14, color: C.textSec }}>↔</span>
            <span style={{ fontSize: 16 }}>{r.b}</span>
            <span style={{ flex: 1, fontSize: 13, color: C.text }}>{r.label}</span>
            <span style={{ fontSize: 12, color: color(r.v), width: 180, textAlign: 'right' }}>{r.text}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>
        心情↔睡眠为 Pearson 相关；心情/睡眠↔位置为相对整体基线偏离最大的地点（|z|≥0.4σ 才计为有关系）。
      </p>
    </div>
  );
}

/* 标量时间序列预测图：近 10 天实际值（精确实线）+ 未来预测（虚线 + Catmull-Rom 平滑），悬停看某天值。 */
function ScalarChart({
  title, result, color, unit, fmt, invertY = false,
}: { title: string; result: ScalarForecastResult; color: string; unit: string; fmt: (v: number) => string; invertY?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const DAY = 86400000;
  const W = 720, H = 240, padL = 46, padR = 14, padT = 14, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const ALL = 10; // 历史只画最近 10 天
  // 历史（精确实际值，不做平滑）+ 未来预测
  const pts = result.points.filter((p) => !p.isFuture || p.dayOffset >= 0);
  const hist = pts.filter((p) => !p.isFuture && p.dayOffset >= -ALL);
  const fut = pts.filter((p) => p.isFuture);
  if (!hist.length && !fut.length) return null;
  const xs = [...hist, ...fut].map((p) => p.dayOffset);
  const minX = hist.length ? Math.min(...xs, -ALL) : Math.min(...xs, 0);
  const maxX = Math.max(...xs);
  const ys = [...hist, ...fut].map((p) => p.value);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  const ypad = (yMax - yMin) * 0.1 || 1;
  yMin -= ypad; yMax += ypad;
  const xAt = (d: number) => padL + ((d - minX) / (maxX - minX || 1)) * plotW;
  // invertY=true：值越小越靠上（如入睡时间——早睡在上、晚睡在下），更符合直觉
  const yAt = (v: number) => invertY
    ? padT + ((v - yMin) / (yMax - yMin || 1)) * plotH
    : padT + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const lineThrough = (arr: { x: number; y: number }[]) =>
    arr.length ? arr.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') : '';
  const histPath = lineThrough(hist.map((p) => ({ x: xAt(p.dayOffset), y: yAt(p.value) })));
  const futPath = smoothPath(fut.map((p) => ({ x: xAt(p.dayOffset), y: yAt(p.value) })));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    if (x < padL || x > padL + plotW) { setHover(null); return; }
    const d = minX + ((x - padL) / plotW) * (maxX - minX);
    let best = pts[0], bd = Infinity;
    for (const p of pts) { const dd = Math.abs(p.dayOffset - d); if (dd < bd) { bd = dd; best = p; } }
    setHover(best.dayOffset);
  };
  const hov = hover != null ? pts.find((p) => p.dayOffset === hover) : null;

  const yTicks = 4;
  const yGrid = Array.from({ length: yTicks + 1 }, (_, i) => {
    const frac = i / yTicks;
    return { y: invertY ? padT + frac * plotH : padT + plotH - frac * plotH, val: yMin + frac * (yMax - yMin) };
  });
  const tickStep = Math.max(1, Math.round((maxX - minX) / 8));
  const xTicks: { d: number; label: string }[] = [];
  for (let d = Math.ceil(minX / tickStep) * tickStep; d <= maxX; d += tickStep) {
    const dt = new Date(Date.now() + d * DAY);
    xTicks.push({ d, label: `${dt.getMonth() + 1}/${dt.getDate()}` });
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: C.surface, borderRadius: 14, border: '1px solid ' + C.border, cursor: 'crosshair' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {yGrid.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke={C.border} strokeWidth={1} strokeDasharray="3 4" opacity={0.22} />
            <text x={padL - 6} y={g.y + 3} textAnchor="end" fontSize={10} fill={C.textDim}>{fmt(g.val)}</text>
          </g>
        ))}
        {xTicks.map((tk, i) => (
          <g key={i}>
            <line x1={xAt(tk.d)} y1={padT} x2={xAt(tk.d)} y2={padT + plotH} stroke={C.border} strokeWidth={1} strokeDasharray="2 4" opacity={0.3} />
            <text x={xAt(tk.d)} y={H - 8} textAnchor="middle" fontSize={10} fill={C.textDim}>{tk.label}</text>
          </g>
        ))}
        <line x1={xAt(0)} y1={padT} x2={xAt(0)} y2={padT + plotH} stroke={C.accentLt} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.6} />
        <text x={xAt(0) + 4} y={padT - 3} fontSize={10} fill={C.accentLt}>今天</text>
        {histPath && <path d={histPath} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />}
        {futPath && <path d={futPath} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" strokeOpacity={0.9} />}
        {hov && (
          <g>
            <line x1={xAt(hov.dayOffset)} y1={padT} x2={xAt(hov.dayOffset)} y2={padT + plotH} stroke={C.textSec} strokeWidth={1} opacity={0.5} />
            <circle cx={xAt(hov.dayOffset)} cy={yAt(hov.value)} r={3.5} fill={color} stroke={C.surface} strokeWidth={1.5} />
          </g>
        )}
      </svg>
      {hov && (
        <div style={{ fontSize: 11, color: C.textSec, marginTop: 6 }}>
          {new Date(Date.now() + hov.dayOffset * DAY).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} · {hov.dayOffset === 0 ? '今天' : hov.dayOffset > 0 ? `未来第 ${hov.dayOffset} 天` : `${Math.abs(hov.dayOffset)} 天前`}：<b style={{ color: C.text }}>{fmt(hov.value)}</b>
        </div>
      )}
      <p style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>
        {title}：实线=近 {ALL} 天实际值（精确未平滑），虚线=未来 {Math.round(maxX / 7)} 周预测（Catmull-Rom 平滑，无模糊区间）。睡眠按工作日/周末节律外推，心情由睡眠时长+所在地驱动。
      </p>
    </div>
  );
}

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

/* ── 位置状态预测图：未来各周处于各地点的概率（堆叠面积） ── */
function LocationStateChart({ loc }: { loc: LocationStateForecast }) {
  const [hoverWeek, setHoverWeek] = useState<number | null>(null);
  const W = 720, H = 220, padL = 38, padR = 14, padT = 12, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const horizon = loc.horizonWeeks;
  const tags = Object.keys(loc.weeks[0].dist);
  const xAt = (w: number) => padL + (w / horizon) * plotW;
  const yAt = (frac: number) => padT + plotH - frac * plotH;

  const areas = tags.map((tag, ti) => {
    const top: { x: number; y: number }[] = [];
    const bottom: { x: number; y: number }[] = [];
    const lowerAt = (w: number) => {
      let c = 0;
      for (let i = 0; i < ti; i++) c += loc.weeks[w].dist[tags[i]] || 0;
      return c;
    };
    for (let w = 0; w <= horizon; w++) {
      const lower = lowerAt(w);
      const upper = lower + (loc.weeks[w].dist[tag] || 0);
      bottom.push({ x: xAt(w), y: yAt(lower) });
      top.push({ x: xAt(w), y: yAt(upper) });
    }
    const pts = [...top, ...bottom.reverse()];
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
    return { tag, d, color: tagMeta(tag).color };
  });

  const xTicks: { w: number; label: string }[] = [];
  const step = Math.max(1, Math.round(horizon / 8));
  for (let w = 0; w <= horizon; w += step) {
    const dt = new Date(Date.now() + w * 7 * 86400000);
    xTicks.push({ w, label: `${dt.getMonth() + 1}/${dt.getDate()}` });
  }

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    if (x < padL || x > padL + plotW) { setHoverWeek(null); return; }
    const frac = (x - padL) / plotW;
    setHoverWeek(Math.max(0, Math.min(horizon, Math.round(frac * horizon))));
  };

  const hov = hoverWeek != null ? loc.weeks[hoverWeek] : null;
  const hovRows = hov ? tags.map((t) => ({ tag: t, p: hov.dist[t] || 0 })).sort((a, b) => b.p - a.p) : [];
  const boxX = hoverWeek != null ? Math.min(W - padR - 150, Math.max(padL, xAt(hoverWeek) + 10)) : 0;
  const boxY = padT + 6;
  const boxH = 22 + hovRows.length * 16;
  const startTag = tags.find((t) => (loc.weeks[0].dist[t] || 0) > 0.5);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: C.surface, borderRadius: 14, border: '1px solid ' + C.border, cursor: 'crosshair' }}
        onMouseMove={onMove} onMouseLeave={() => setHoverWeek(null)}>
        {[0, 0.5, 1].map((f, i) => (
          <g key={i}>
            <line x1={padL} y1={yAt(f)} x2={W - padR} y2={yAt(f)} stroke={C.border} strokeWidth={1} strokeDasharray="3 4" opacity={0.25} />
            <text x={padL - 6} y={yAt(f) + 3} textAnchor="end" fontSize={10} fill={C.textDim}>{Math.round(f * 100)}%</text>
          </g>
        ))}
        {xTicks.map((tk, i) => (
          <g key={i}>
            <line x1={xAt(tk.w)} y1={padT} x2={xAt(tk.w)} y2={padT + plotH} stroke={C.border} strokeWidth={1} strokeDasharray="2 4" opacity={0.3} />
            <text x={xAt(tk.w)} y={H - 8} textAnchor="middle" fontSize={10} fill={C.textDim}>{tk.label}</text>
          </g>
        ))}
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke={C.accentLt} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.6} />
        <text x={padL + 4} y={padT - 3} fontSize={10} fill={C.accentLt}>今天</text>
        {areas.map((a) => (
          <path key={a.tag} d={a.d} fill={a.color} fillOpacity={0.75} stroke="none" />
        ))}
        {hoverWeek != null && (
          <line x1={xAt(hoverWeek)} y1={padT} x2={xAt(hoverWeek)} y2={padT + plotH} stroke={C.textSec} strokeWidth={1} opacity={0.6} />
        )}
        {hoverWeek != null && hov && (
          <g>
            <rect x={boxX} y={boxY} width={150} height={boxH} rx={8} fill={C.card} stroke={C.borderLit} opacity={0.97} />
            <text x={boxX + 10} y={boxY + 16} fontSize={10} fill={C.textSec}>
              {new Date(Date.now() + hoverWeek * 7 * 86400000).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} · 第 {hoverWeek} 周
            </text>
            {hovRows.map((r, i) => (
              <g key={r.tag}>
                <circle cx={boxX + 14} cy={boxY + 28 + i * 16} r={3} fill={tagMeta(r.tag).color} />
                <text x={boxX + 24} y={boxY + 32 + i * 16} fontSize={10} fill={C.text}>{tagMeta(r.tag).icon} {r.tag}</text>
                <text x={boxX + 140} y={boxY + 32 + i * 16} fontSize={10} fill={C.text} textAnchor="end">{(r.p * 100).toFixed(0)}%</text>
              </g>
            ))}
          </g>
        )}
      </svg>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: C.textSec, marginTop: 8, flexWrap: 'wrap' }}>
        {tags.map((t) => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: tagMeta(t).color, display: 'inline-block' }} />
            {tagMeta(t).icon} {t}
          </span>
        ))}
      </div>
      <p style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>
        基于位置转移 Markov 链向前外推：当前{startTag ? `在 ${tagMeta(startTag).icon}${startTag}` : '所在地'}，逐周推算处于各地点的概率（悬停看某周分布）。
      </p>
    </div>
  );
}
