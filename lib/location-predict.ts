// 位置 × 预测 的桥接层：把 location_stays 的「时空区间」叠到事件日志上，
// 回答「在不同地点，做事规律有什么不同」（如 武汉常户外唱歌、广州常唱k）。
import { effectivePlace, tagMeta } from './location-place';
import type { EventLogLite, EventGroupLite } from './prediction';

export interface LocStay {
  id?: string;
  started_at: string;
  ended_at: string | null;
  country: string;
  province: string | null;
  city: string | null;
  tag: string;
}

export interface LocContext {
  place: string; // effectivePlace（国内隐藏"中国"）
  tag: string;   // 家/学校/旅游/其他
}

/** 某时刻所处的地点：按 location_stays 区间覆盖判断。移动中/未记录 → null。 */
export function placeAt(ts: number, stays: LocStay[]): LocContext | null {
  for (const s of stays) {
    const start = new Date(s.started_at).getTime();
    const end = s.ended_at ? new Date(s.ended_at).getTime() : Number.POSITIVE_INFINITY;
    if (ts >= start && ts <= end) {
      return { place: effectivePlace(s), tag: tagMeta(s.tag).label };
    }
  }
  return null;
}

export interface LocTagStay {
  started_at: string;
  ended_at: string | null;
  tag: string;
}

export interface TagContext {
  tag: string;
}

/** 某时刻所处的标签：按公开标签时段覆盖判断。移动中/未记录 → null。 */
export function tagAt(ts: number, stays: LocTagStay[]): TagContext | null {
  for (const s of stays) {
    const start = new Date(s.started_at).getTime();
    const end = s.ended_at ? new Date(s.ended_at).getTime() : Number.POSITIVE_INFINITY;
    if (ts >= start && ts <= end) {
      return { tag: tagMeta(s.tag).label };
    }
  }
  return null;
}

/** 当前所在标签：优先未结束的；否则取最近开始。无数据 → null。 */
export function currentTag(stays: LocTagStay[]): (TagContext & { since: string | null }) | null {
  if (!stays.length) return null;
  const open = stays.find((s) => !s.ended_at);
  const pick = open || [...stays].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
  return { tag: tagMeta(pick.tag).label, since: pick.started_at };
}

/** 当前所在地点：优先「至今」未结束的那条；否则取最近开始的一条。无数据 → null。 */
export function currentLocation(stays: LocStay[]): (LocContext & { since: string | null }) | null {
  if (!stays.length) return null;
  const open = stays.find((s) => !s.ended_at);
  const pick =
    open ||
    [...stays].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
  return { place: effectivePlace(pick), tag: tagMeta(pick.tag).label, since: pick.started_at };
}

export interface TagActivity {
  groupId: string;
  name: string;
  icon: string;
  count: number;
  share: number;
  lift: number;
}
export interface TagProfile {
  tag: string;
  totalEvents: number;
  activities: TagActivity[];
}

/**
 * 按标签（家/学校/旅游/其他）统计做事倾向：不含具体城市，公开可调用。
 * 返回每个标签最具代表性的活动（lift>1.15）。
 */
export function locationTagActivityProfile(
  logs: EventLogLite[],
  stays: LocTagStay[],
  groups: EventGroupLite[]
): TagProfile[] {
  if (!stays.length || !logs.length) return [];
  const totalAll = logs.length;
  const groupAll = new Map<string, number>();
  for (const l of logs) groupAll.set(l.group_id, (groupAll.get(l.group_id) || 0) + 1);
  const gmap = new Map(groups.map((g) => [g.id, g]));

  const byTag = new Map<string, { counts: Map<string, number>; total: number }>();
  for (const s of stays) {
    const label = tagMeta(s.tag).label;
    if (!byTag.has(label)) byTag.set(label, { counts: new Map(), total: 0 });
  }

  for (const l of logs) {
    const ctx = tagAt(new Date(l.event_at).getTime(), stays);
    if (!ctx) continue;
    const bucket = byTag.get(ctx.tag);
    if (!bucket) continue;
    bucket.counts.set(l.group_id, (bucket.counts.get(l.group_id) || 0) + 1);
    bucket.total++;
  }

  const out: TagProfile[] = [];
  for (const [tag, bucket] of byTag) {
    if (bucket.total === 0) continue;
    const activities: TagActivity[] = [];
    for (const [gid, count] of bucket.counts) {
      const g = gmap.get(gid);
      if (!g) continue;
      const share = count / bucket.total;
      const base = (groupAll.get(gid) || 0) / totalAll || 1e-9;
      const lift = share / base;
      activities.push({ groupId: gid, name: g.name, icon: g.icon, count, share, lift });
    }
    activities.sort((a, b) => b.lift - a.lift);
    const rep = activities.filter((a) => a.lift > 1.15).slice(0, 4);
    out.push({ tag, totalEvents: bucket.total, activities: rep });
  }
  out.sort((a, b) => b.totalEvents - a.totalEvents);
  return out;
}


export interface PlaceActivity {
  groupId: string;
  name: string;
  icon: string;
  count: number;   // 该地点发生次数
  share: number;   // 该地点内占比
  lift: number;    // 相对整体基线的提升（>1 即该地点更常发生）
}
export interface PlaceProfile {
  place: string;
  tag: string;
  totalEvents: number;
  activities: PlaceActivity[]; // 按 lift 降序，仅含 lift>1.15 的代表性活动
}

/**
 * 各地做事倾向：对每个地点，统计各事件组次数，计算相对整体基线的 lift，
 * 取最具代表性的活动（lift>1.15）。直接回答「在武汉常户外唱歌、在广州常唱k」这类规律。
 * 同名的多条 stay（如两次武汉）自动合并统计。
 */
export function locationActivityProfile(
  logs: EventLogLite[],
  stays: LocStay[],
  groups: EventGroupLite[]
): PlaceProfile[] {
  if (!stays.length || !logs.length) return [];
  const totalAll = logs.length;
  const groupAll = new Map<string, number>();
  for (const l of logs) groupAll.set(l.group_id, (groupAll.get(l.group_id) || 0) + 1);
  const gmap = new Map(groups.map((g) => [g.id, g]));

  const byPlace = new Map<string, { stay: LocStay; counts: Map<string, number>; total: number }>();
  for (const s of stays) byPlace.set(effectivePlace(s), { stay: s, counts: new Map(), total: 0 });

  for (const l of logs) {
    const ctx = placeAt(new Date(l.event_at).getTime(), stays);
    if (!ctx) continue;
    const bucket = byPlace.get(ctx.place);
    if (!bucket) continue;
    bucket.counts.set(l.group_id, (bucket.counts.get(l.group_id) || 0) + 1);
    bucket.total++;
  }

  const out: PlaceProfile[] = [];
  for (const [place, bucket] of byPlace) {
    if (bucket.total === 0) continue;
    const activities: PlaceActivity[] = [];
    for (const [gid, count] of bucket.counts) {
      const g = gmap.get(gid);
      if (!g) continue;
      const share = count / bucket.total;
      const base = (groupAll.get(gid) || 0) / totalAll || 1e-9;
      const lift = share / base;
      activities.push({ groupId: gid, name: g.name, icon: g.icon, count, share, lift });
    }
    activities.sort((a, b) => b.lift - a.lift);
    const rep = activities.filter((a) => a.lift > 1.15).slice(0, 4);
    out.push({ place, tag: tagMeta(bucket.stay.tag).label, totalEvents: bucket.total, activities: rep });
  }
  out.sort((a, b) => b.totalEvents - a.totalEvents);
  return out;
}

/* ───────────────────────────────────────────────────────────
 * 位置变动规律：把连续停留段视为「状态序列」，做一阶 Markov 转移 +
 * 段长统计，回答「我当前在哪、大概多久后会换地方、下一站最可能是哪」。
 * 标签级（家/学校/旅游/其他）公开可得；地点级（城市）需私密解锁。
 * ─────────────────────────────────────────────────────────── */
const DAY = 86400000;

export interface RunSegment {
  tag: string;
  place: string | null;
  started_at: string;
  ended_at: string | null; // 折叠后的末端（连续同标签取最晚）
  durationDays: number;    // 折叠段跨度（开段=截至现在的已停留）
}

export interface LocationTransitionResult {
  current: { tag: string; place: string | null; since: string | null } | null;
  enough: boolean; // 是否有足够段做转移预测
  runs: RunSegment[]; // 折叠连续同标签后的状态序列（时间序）
  avgDurationDays: Record<string, number>; // 各标签平均段长（天）
  transitions: { from: string; to: string; count: number; prob: number }[];
  nextTag: { tag: string; prob: number } | null;     // 当前标签下一步最可能去的标签
  nextPlace: { place: string; prob: number } | null; // 当前地点下一步最可能去的地点（需私密）
  predictedSwitchInDays: number | null; // 预计还有多少天切换（当前标签平均段长 - 已停留）
}

/** 折叠连续同标签的停留段为状态序列（同标签多段合并，跨度重算）。 */
function collapseRuns<T extends { tag: string; place: string | null; started_at: string; ended_at: string | null }>(
  stays: T[]
): RunSegment[] {
  const sorted = [...stays].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  const now = Date.now();
  const runs: RunSegment[] = [];
  for (const s of sorted) {
    const start = new Date(s.started_at).getTime();
    const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
    const dur = Math.max(0, (end - start) / DAY);
    const last = runs[runs.length - 1];
    if (last && last.tag === s.tag) {
      last.ended_at = s.ended_at ?? last.ended_at;
      last.durationDays = Math.max(0, (end - new Date(last.started_at).getTime()) / DAY);
    } else {
      runs.push({ tag: s.tag, place: s.place, started_at: s.started_at, ended_at: s.ended_at, durationDays: dur });
    }
  }
  return runs;
}

export function predictLocationTransition(
  tagStays: LocTagStay[],
  locationStays: LocStay[] | null
): LocationTransitionResult {
  const runs = collapseRuns(
    tagStays.map((s) => ({ tag: tagMeta(s.tag).label, place: null, started_at: s.started_at, ended_at: s.ended_at }))
  );
  const now = Date.now();

  // 平均段长（用已闭合段，稳健）
  const durByTag: Record<string, number[]> = {};
  for (const r of runs) {
    if (r.ended_at) (durByTag[r.tag] ||= []).push(r.durationDays);
  }
  const avgDurationDays: Record<string, number> = {};
  for (const [tag, arr] of Object.entries(durByTag)) {
    avgDurationDays[tag] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  // 转移计数（连续 run 间标签变化）
  const tcount: Record<string, Record<string, number>> = {};
  for (let i = 0; i + 1 < runs.length; i++) {
    const a = runs[i].tag, b = runs[i + 1].tag;
    if (a === b) continue;
    (tcount[a] ||= {}); tcount[a][b] = (tcount[a][b] || 0) + 1;
  }
  const transitions: LocationTransitionResult['transitions'] = [];
  for (const [from, m] of Object.entries(tcount)) {
    const tot = Object.values(m).reduce((a, b) => a + b, 0);
    for (const [to, c] of Object.entries(m)) transitions.push({ from, to, count: c, prob: tot ? c / tot : 0 });
  }

  // 当前状态：含 now 的 run
  const currentRun =
    runs.find((r) => {
      const start = new Date(r.started_at).getTime();
      const end = r.ended_at ? new Date(r.ended_at).getTime() : now;
      return now >= start && now <= end;
    }) || runs[runs.length - 1] || null;

  const current = currentRun ? { tag: currentRun.tag, place: currentRun.place, since: currentRun.started_at } : null;

  // 下一步标签
  let nextTag: { tag: string; prob: number } | null = null;
  if (current) {
    const outs = transitions.filter((t) => t.from === current.tag).sort((a, b) => b.prob - a.prob);
    if (outs.length) nextTag = { tag: outs[0].to, prob: outs[0].prob };
  }

  // 预计切换天数
  let predictedSwitchInDays: number | null = null;
  if (current && currentRun) {
    const avg = avgDurationDays[current.tag];
    if (avg) {
      const elapsed = Math.max(0, (now - new Date(currentRun.started_at).getTime()) / DAY);
      predictedSwitchInDays = Math.max(0, avg - elapsed);
    }
  }

  // 地点级（需私密）
  let nextPlace: { place: string; prob: number } | null = null;
  if (locationStays && locationStays.length) {
    const placeRuns = collapseRuns(
      locationStays.map((s) => ({ tag: tagMeta(s.tag).label, place: effectivePlace(s), started_at: s.started_at, ended_at: s.ended_at }))
    );
    const pcount: Record<string, Record<string, number>> = {};
    for (let i = 0; i + 1 < placeRuns.length; i++) {
      const a = placeRuns[i].place, b = placeRuns[i + 1].place;
      if (!a || !b || a === b) continue;
      (pcount[a] ||= {}); pcount[a][b] = (pcount[a][b] || 0) + 1;
    }
    if (currentRun && currentRun.place) {
      const outs = Object.entries(pcount[currentRun.place] || {}).sort((a, b) => b[1] - a[1]);
      if (outs.length) {
        const tot = outs.reduce((s, [, c]) => s + c, 0);
        nextPlace = { place: outs[0][0], prob: tot ? outs[0][1] / tot : 0 };
      }
    }
  }

  const enough = runs.length >= 3 && transitions.length > 0;
  return { current, enough, runs, avgDurationDays, transitions, nextTag, nextPlace, predictedSwitchInDays };
}

/** 取某标签时段内发生的事件日志（用于分地点做节奏/推荐）。 */
export function logsForTag(logs: EventLogLite[], stays: LocTagStay[], tag: string): EventLogLite[] {
  return logs.filter((l) => tagAt(new Date(l.event_at).getTime(), stays)?.tag === tag);
}

/* ── 位置状态预测：把转移矩阵向前外推，得到未来每周处于各地点的概率分布 ── */
export interface LocationStateForecast {
  horizonWeeks: number;
  weeks: { week: number; dist: Record<string, number> }[];
}
export function forecastLocationState(t: LocationTransitionResult, horizonWeeks = 16): LocationStateForecast {
  const tags = Array.from(new Set(t.runs.map((r) => r.tag)));
  const P: Record<string, Record<string, number>> = {};
  for (const tag of tags) {
    P[tag] = {};
    const outs = t.transitions.filter((x) => x.from === tag);
    for (const o of outs) P[tag][o.to] = o.prob;
    if (!outs.length) P[tag][tag] = 1; // 终端状态：留在原地
  }
  let cur: Record<string, number> = {};
  if (t.current) {
    for (const tag of tags) cur[tag] = t.current.tag === tag ? 1 : 0;
  } else {
    const tot = tags.length || 1;
    for (const tag of tags) cur[tag] = 1 / tot;
  }
  const weeks: LocationStateForecast['weeks'] = [{ week: 0, dist: { ...cur } }];
  for (let w = 1; w <= horizonWeeks; w++) {
    const next: Record<string, number> = {};
    for (const tag of tags) {
      let s = 0;
      for (const from of tags) s += (cur[from] || 0) * (P[from][tag] || 0);
      next[tag] = s;
    }
    weeks.push({ week: w, dist: next });
    cur = next;
  }
  return { horizonWeeks, weeks };
}
