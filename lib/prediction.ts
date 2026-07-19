/**
 * 预测算法库 —— 基于事件计数（event_logs / event_groups）做规律预测。
 * 纯函数，无外部依赖，方便在客户端（静态导出）直接调用或单测。
 *
 * 设计思路（带 ML 思维）：
 *  1) 节奏预测：指数衰减加权间隔（近期行为权重更高，近似自激/聚类），
 *     叠加「星期季节性」周期模型，并给出经验分位预测区间（不确定性量化）。
 *  2) 下一个对象（大餐/歌）：用一阶 Markov 链建模「上次 X → 下次 Y」的转移概率，
 *     而非朴素轮转；数据不足时退化为全局频率基线。
 *  3) 事件非独立：跨事件组做日频 Pearson 相关 + 条件共现概率 P(B|A)，
 *     揭示「大餐后常跟着唱歌」这类依赖结构。
 */

export interface EventLogLite {
  id?: string;
  group_id: string;
  event_at: string;
  refs?: { id?: string; title?: string; amount?: number }[] | null;
}
export interface EventGroupLite {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export type Confidence = 'high' | 'medium' | 'low' | 'unknown';

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const weekdayName = (d: number) => WEEKDAYS[((d % 7) + 7) % 7];

/* ── 基础统计 ── */
const DAY = 86400000;

export type DayType = 'weekday' | 'weekend' | 'holiday';

/* 默认内置 2026 年中国主要法定假日（含连休），同时支持客户端 fetch 网络节假日表后覆盖。 */
let HOLIDAY_SET = new Set<string>([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
]);

export function setHolidaySet(s: Set<string>) { HOLIDAY_SET = s; }
export function getHolidaySet(): Set<string> { return HOLIDAY_SET; }

/** 判断某天是工作日 / 周末 / 节假日（节假日优先于周末）。 */
/** 把任意时间换算成「北京时间」下的分量（数据以 UTC 存储，中国本地 = UTC+8）。
 *  用 UTC+8 固定偏移再读 UTC 字段，保证结果不随查看者浏览器时区漂移。 */
function bjParts(d: Date | string): { y: number; m: number; day: number; wd: number; hour: number } {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const bj = new Date(dt.getTime() + 8 * 3600 * 1000); // 偏移后是“北京本地钟面”
  return {
    y: bj.getUTCFullYear(),
    m: bj.getUTCMonth(),
    day: bj.getUTCDate(),
    wd: bj.getUTCDay(),
    hour: bj.getUTCHours(),
  };
}

/** 北京时间下的日期键 YYYY-MM-DD（用于节假日匹配、按天聚合）。 */
function bjDateKey(d: Date | string): string {
  const p = bjParts(d);
  const mm = String(p.m + 1).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.y}-${mm}-${dd}`;
}

export function classifyDay(d: Date | string): DayType {
  const key = bjDateKey(d);
  if (HOLIDAY_SET.has(key)) return 'holiday';
  const wd = bjParts(d).wd;
  return wd === 0 || wd === 6 ? 'weekend' : 'weekday';
}

/** 事件时间的「北京时间小时」(0..23)。数据以 UTC 存储，中国本地 = UTC+8；
 *  直接读 getHours() 会随查看者浏览器时区漂移，这里用 UTC+8 固定换算保证确定性。 */
export function bjHour(event_at: string | Date): number {
  return bjParts(event_at).hour;
}

/** 把某个 UTC 毫秒时刻的「北京小时」改成指定值（保留北京日期与分钟），用于把预测时刻对齐到偏好时段。 */
function setBjHour(ms: number, hour: number): number {
  const bj = new Date(ms + 8 * 3600 * 1000);
  bj.setUTCHours(hour, 0, 0, 0); // 北京小时设为偏好值，分钟清零
  return bj.getTime() - 8 * 3600 * 1000;
}

/** 从公开 API 拉取指定年份的节假日；失败时返回内置表。 */
export async function fetchHolidays(year: number): Promise<Set<string>> {
  try {
    const res = await fetch(`https://date.nager.at/api/v3/publicholidays/${year}/CN`);
    if (!res.ok) return HOLIDAY_SET;
    const data: { date: string }[] = await res.json();
    const merged = new Set(HOLIDAY_SET);
    for (const h of data) if (h.date) merged.add(h.date);
    return merged;
  } catch {
    return HOLIDAY_SET;
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stddev = (xs: number[], m: number) =>
  xs.length ? Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) : 0;
const quantile = (xs: number[], q: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
};
const pearson = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
};
const bisect = (sorted: number[], t: number): number => {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < t) lo = mid + 1; else hi = mid; }
  return lo;
};

/* ── 1) 节奏预测（季节性 + 预测区间） ── */
export interface TimingStat {
  count: number;
  lastAt: string | null;
  avgIntervalDays: number | null;       // 指数衰减加权均值
  medianIntervalDays: number | null;
  cv: number | null;                    // 变异系数（越小越规律）
  predictedNextAt: string | null;       // 季节性修正后的点预测
  baselineNextAt: string | null;        // 朴素均值（对照）
  confidence: Confidence;
  recentIntervals: number[];
  weekdayDist: number[];                // 长度 7，经验发生概率
  modalWeekday: number | null;          // 0..6
  dayTypeRate: Record<DayType, number>; // 工作日/周末/节假日 每天发生率（已去除天数基数影响）
  dayTypePrefIndex: number;              // 偏好类型的「每天发生率 / 整体每天发生率」，≈1 表示无偏好
  modalDayType: DayType | null;          // 真实的日类型偏好（无显著偏好时为 null）
  timeOfDayPref: '凌晨' | '上午' | '下午' | '晚间' | null; // 时段偏好（北京时间，去均匀基线后）
  prefHour: number | null;              // 高频小时（北京时间 0..23）
  todDist: number[];                     // 长度 4：凌晨/上午/下午/晚间 占比（经验概率）
  seasonality: number;                  // 0..1 周期性强度
  band: { p25: string | null; p50: string | null; p75: string | null }; // 预测区间
  // 生存分析 / 危险率（高级时序模型）
  currentGapDays?: number;     // 距上次已隔多少天（实时）
  hazardNow?: number;          // P(今天发生 | 已存活到当前间隔)
  survivalNow?: number;        // P(至今仍未发生)
  offRoutine?: boolean;        // 当前间隔已超过历史 p75 → 偏离常规节奏
}

export function computeTiming(logs: EventLogLite[]): TimingStat {
  const sorted = [...logs].sort(
    (a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime()
  );
  const count = sorted.length;
  const lastAt = count ? sorted[count - 1].event_at : null;

  const empty: TimingStat = {
    count, lastAt, avgIntervalDays: null, medianIntervalDays: null, cv: null,
    predictedNextAt: null, baselineNextAt: null, confidence: 'unknown',
    recentIntervals: [], weekdayDist: [0, 0, 0, 0, 0, 0, 0], modalWeekday: null,
    dayTypeRate: { weekday: 0, weekend: 0, holiday: 0 }, dayTypePrefIndex: 1, modalDayType: null,
    timeOfDayPref: null, prefHour: null, todDist: [0, 0, 0, 0],
    seasonality: 0, band: { p25: null, p50: null, p75: null },
    currentGapDays: undefined, hazardNow: undefined, survivalNow: undefined, offRoutine: undefined,
  };
  if (count < 2) return empty;

  // 取最近 8 次事件，间隔用指数衰减加权（近期权重更高 → 体现聚类/自激）
  const recent = sorted.slice(-Math.min(8, count));
  const deltas: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    deltas.push((new Date(recent[i].event_at).getTime() - new Date(recent[i - 1].event_at).getTime()) / DAY);
  }
  const n = deltas.length;
  const lambda = 0.5;
  let wsum = 0, wmean = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.exp(-lambda * (n - 1 - i));
    wsum += w; wmean += w * deltas[i];
  }
  wmean = wsum ? wmean / wsum : mean(deltas);
  const mPlain = mean(deltas);
  const med = median(deltas);
  const sd = stddev(deltas, wmean);
  const cv = wmean > 0 ? sd / wmean : null;

  let confidence: Confidence = 'unknown';
  if (cv !== null) {
    if (cv < 0.4) confidence = 'high';
    else if (cv < 0.9) confidence = 'medium';
    else confidence = 'low';
  }

  const lastMs = new Date(sorted[sorted.length - 1].event_at).getTime();
  const baselineNextAt = new Date(lastMs + mPlain * DAY).toISOString();

  // 星期季节性：统计所有事件落在各星期几的经验频率
  const hist = [0, 0, 0, 0, 0, 0, 0];
  for (const l of sorted) hist[bjParts(l.event_at).wd]++;
  const total = count;
  const weekdayDist = hist.map((h) => h / total);
  let modalWeekday: number | null = null, maxP = -1;
  weekdayDist.forEach((p, i) => { if (p > maxP) { maxP = p; modalWeekday = i; } });
  // 周期性强度：相对均匀分布的偏离度
  const seasonality = Math.max(0, Math.min(1, (maxP - 1 / 7) / (6 / 7)));

  // 日类型偏好（关键：去除“天数不等”带来的基准率/量纲影响）
  // 一周 5 个工作日 vs 2 个周末日，均匀行为天然 71% 落在工作日。
  // 所以必须按「每天发生率」= 该类天事件数 / 该类天天数 归一，再比较是否真偏离均匀。
  const winStart = new Date(sorted[0].event_at); winStart.setUTCHours(0, 0, 0, 0);
  const winEnd = new Date(sorted[count - 1].event_at); winEnd.setUTCHours(0, 0, 0, 0);
  const spanDays = Math.max(1, Math.round((winEnd.getTime() - winStart.getTime()) / DAY) + 1);
  const dtCnt = { weekday: 0, weekend: 0, holiday: 0 };
  const dtDays = { weekday: 0, weekend: 0, holiday: 0 };
  for (let i = 0; i < spanDays; i++) {
    const dt = new Date(winStart.getTime() + i * DAY);
    dtDays[classifyDay(dt)]++;
  }
  for (const l of sorted) dtCnt[classifyDay(l.event_at)]++;
  const dayTypeRate = {
    weekday: dtDays.weekday ? dtCnt.weekday / dtDays.weekday : 0,
    weekend: dtDays.weekend ? dtCnt.weekend / dtDays.weekend : 0,
    holiday: dtDays.holiday ? dtCnt.holiday / dtDays.holiday : 0,
  };
  const overallDayRate = count / spanDays;
  // 偏好判定：某类天的每天发生率明显高于整体（>LIFT 倍）才算“偏”，否则视作无偏好
  const DT_LIFT = 1.25;
  const dtTypes: DayType[] = ['weekday', 'weekend', 'holiday'];
  let modalDayType: DayType | null = null;
  let bestRate = -1;
  for (const t of dtTypes) { if (dayTypeRate[t] > bestRate) { bestRate = dayTypeRate[t]; modalDayType = t; } }
  let dayTypePrefIndex = 1;
  if (modalDayType && bestRate > overallDayRate * DT_LIFT && overallDayRate > 0) {
    dayTypePrefIndex = bestRate / overallDayRate;
  } else {
    modalDayType = null; // 无显著偏好（含均匀行为与样本不足）
  }

  // 时段偏好（北京时间小时；4 段各 6 小时，均匀基线 = 每段 25%）
  // 同样要去均匀基线：某段占比明显高于 25%×LIFT 才算“偏好时段”，否则视作无偏好。
  const TOD = [
    { name: '凌晨' as const, lo: 0, hi: 5 },
    { name: '上午' as const, lo: 6, hi: 11 },
    { name: '下午' as const, lo: 12, hi: 17 },
    { name: '晚间' as const, lo: 18, hi: 23 },
  ];
  const hourCnt = new Array(24).fill(0);
  for (const l of sorted) hourCnt[bjHour(l.event_at)]++;
  const todCnt = TOD.map((p) => hourCnt.slice(p.lo, p.hi + 1).reduce((a, b) => a + b, 0));
  const todTotal = todCnt.reduce((a, b) => a + b, 0) || 1;
  const todDist = todCnt.map((c) => c / todTotal);
  const TOD_LIFT = 1.4; // 阈值 25% × 1.4 = 35%
  let timeOfDayPref: '凌晨' | '上午' | '下午' | '晚间' | null = null;
  let bestTod = -1, bestTodShare = -1;
  todDist.forEach((s, i) => { if (s > bestTodShare) { bestTodShare = s; bestTod = i; } });
  if (bestTodShare > 0.25 * TOD_LIFT) timeOfDayPref = TOD[bestTod].name;
  let prefHour: number | null = null, bestH = -1;
  hourCnt.forEach((c, h) => { if (c > bestH) { bestH = c; prefHour = h; } });
  if (bestH <= 0) prefHour = null;

  // 季节性修正点预测：从朴素均值起，先对齐高频星期几，再对齐高频日类型（限制 ±7 天）
  let predMs = lastMs + wmean * DAY;
  if (seasonality >= 0.12 && modalWeekday !== null) {
    const d = new Date(predMs);
    for (let k = 0; k < 7; k++) {
      if (bjParts(d).wd === modalWeekday) { predMs = d.getTime(); break; }
      d.setDate(d.getDate() + 1);
    }
  }
  if (modalDayType) {
    const d = new Date(predMs);
    for (let k = 0; k < 7; k++) {
      if (classifyDay(d) === modalDayType) { predMs = d.getTime(); break; }
      d.setDate(d.getDate() + 1);
    }
  }
  // 把预测时刻的“北京小时”对齐到偏好时段（prefHour 来自数据；分钟清零避免抖动）
  if (prefHour !== null) predMs = setBjHour(predMs, prefHour);
  const predictedNextAt = new Date(predMs).toISOString();

  // 预测区间（经验分位）
  const addDays = (ms: number, days: number | null) =>
    days === null ? null : new Date(ms + days * DAY).toISOString();
  const band = {
    p25: addDays(lastMs, quantile(deltas, 0.25)),
    p50: addDays(lastMs, quantile(deltas, 0.5)),
    p75: addDays(lastMs, quantile(deltas, 0.75)),
  };

  // 生存分析 / 危险率：给定「已隔 currentGap 天没发生」，估计今天发生的概率
  const currentGapDays = Math.max(0, (Date.now() - lastMs) / DAY);
  const survCount = deltas.filter((g) => g > currentGapDays).length;
  const survivalNow = n ? survCount / n : 0;
  const atRisk = deltas.filter((g) => g >= currentGapDays).length;
  const inBin = deltas.filter((g) => g >= currentGapDays && g < currentGapDays + 1).length;
  const hazardNow = atRisk ? inBin / atRisk : 0;
  const p75gap = quantile(deltas, 0.75) ?? wmean;
  const offRoutine = currentGapDays > p75gap;

  return {
    count, lastAt, avgIntervalDays: wmean, medianIntervalDays: med, cv,
    predictedNextAt, baselineNextAt, confidence, recentIntervals: deltas,
    weekdayDist, modalWeekday, dayTypeRate, dayTypePrefIndex, modalDayType,
    timeOfDayPref, prefHour, todDist, seasonality, band,
    currentGapDays, hazardNow, survivalNow, offRoutine,
  };
}

/* ── 2) 下一个具体对象（会话级 Markov 转移 × 偏好评分） ── */
export interface EntityRank { id: string; title: string; count: number; lastAt: string; daysSince: number; }
export interface MarkovItem { id: string; title: string; prob: number; fromTransition: boolean; pref: number | null; }
export interface EntityMarkov {
  lastEntity: { id: string; title: string } | null; // 仅展示用（上次会话里最后一个对象）
  lastSessionSize: number;                            // 上次会话涉及的对象数（唱K 常为几十）
  nextTop: MarkovItem[];
  ranking: EntityRank[];
  totalSessions: number;
  usedMarkov: boolean;
}

export interface EntityMarkovOptions {
  prefScore?: (id: string) => number;
  // 新鲜度乘子：最近加入歌单的歌权重更高（调用方按 created_at 算好传进来，默认 1）
  freshScore?: (id: string) => number;
  // 冷启动候选：歌单里有、但从未在事件记录里出现过的对象（如刚加进歌单还没唱过的歌）
  // 给一个随新鲜度缩放的弱先验，让「新歌」也能进列表（N 取大时自然排在后面）
  coldCandidates?: { id: string; title: string }[];
  // 概率语义：
  //  'categorical'（默认）—— 下一次只发生「一个」对象（如一顿大餐=一道菜），概率加起来=1（softmax）。
  //  'membership'  —— 一次活动包含「一组」对象（如一场唱K=几十首歌），歌与歌不互斥，
  //                   概率表示「该对象出现在下一场活动里的概率」(0..1)，不要求总和为 1。
  //                   这样不会因候选太多被摊薄成 1%~2%。
  mode?: 'categorical' | 'membership';
  // 注意：返回的是全量排序后的候选（最多 MAX_CANDIDATES 条）。
  // 「取前 N 项」由调用方在展示时 slice，避免改数量时重复计算整张转移矩阵。
}

/**
 * 会话级（session-bag）Markov + 偏好乘子。
 *
 * 关键修正：一次活动（一场唱K / 一顿大餐）在同一个 event_log 里存了若干对象，
 * 且它们**共享同一个 event_at**——场内顺序不可靠（只是 refs 数组的插入顺序）。
 * 因此不能再像旧版那样"按时间戳排序后取最后一个对象 = 上次唱的歌"来做一阶转移，
 * 那样会把任意插入顺序当成真实歌唱顺序，转移链整体失真。
 *
 * 新做法：
 *  - 把每个 event_log 视为一个「会话」，取其去重后的对象集合（bag）。
 *  - 转移统计建立在「会话之间」：S_i 的每个对象 x → S_{i+1} 的每个对象 y。
 *  - 预测时，从「上次会话的全部对象」聚合它们的出边，再乘偏好分。
 * 这样完全不依赖场内顺序，对"一场几十首"的唱K 数据稳健。
 *
 * 偏好乘子：综合分 = 转移权重 × (0.4 + 1.2·偏好)，偏好 0..1。
 */
export function predictNextEntityMarkov(
  logs: EventLogLite[],
  opts: EntityMarkovOptions = {}
): EntityMarkov {
  const prefScore = opts.prefScore;

  // 1) 构建会话：每个 event_log = 一次活动，refs 去重为该次涉及的对象集合
  interface Sess { at: number; ids: string[]; titles: Map<string, string>; }
  const sessions: Sess[] = [];
  for (const log of logs) {
    const refs = (log.refs as any[]) || [];
    const ids: string[] = [];
    const titles = new Map<string, string>();
    for (const r of refs) {
      if (!r || !r.id) continue;
      const id = String(r.id);
      if (!titles.has(id)) { ids.push(id); titles.set(id, r.title || id); }
    }
    if (!ids.length) continue;
    sessions.push({ at: new Date(log.event_at).getTime(), ids, titles });
  }
  sessions.sort((a, b) => a.at - b.at);

  const globalCount = new Map<string, number>();
  const titlesAll = new Map<string, string>();
  for (const s of sessions) for (const id of s.ids) { globalCount.set(id, (globalCount.get(id) || 0) + 1); titlesAll.set(id, s.titles.get(id)!); }

  // 2) 会话级转移：S_i 的 x → S_{i+1} 的 y
  const trans = new Map<string, Map<string, number>>();
  const outDeg = new Map<string, number>();
  for (let i = 0; i + 1 < sessions.length; i++) {
    const A = sessions[i].ids, B = sessions[i + 1].ids;
    for (const x of A) {
      if (!trans.has(x)) trans.set(x, new Map());
      const m = trans.get(x)!;
      for (const y of B) m.set(y, (m.get(y) || 0) + 1);
    }
  }
  for (const [x, m] of trans) outDeg.set(x, [...m.values()].reduce((a, b) => a + b, 0));

  const lastSession = sessions.length ? sessions[sessions.length - 1] : null;
  const lastSessionIds = lastSession ? lastSession.ids : [];
  const lastEntity = lastSessionIds.length
    ? { id: lastSessionIds[lastSessionIds.length - 1], title: lastSession!.titles.get(lastSessionIds[lastSessionIds.length - 1])! }
    : null;

  // 3) 预测下一个对象：从「上次会话所有对象」聚合出边
  const cand = new Map<string, number>();
  for (const x of lastSessionIds) {
    const m = trans.get(x);
    if (!m) continue;
    const od = outDeg.get(x) || 1;
    for (const [y, c] of m) cand.set(y, (cand.get(y) || 0) + c / od);
  }

  // membership 模式：统计「与上次会话重叠的历史会话对」里，各对象出现在下一场的概率
  const lastSet = new Set(lastSessionIds);
  let overlapPairs = 0;
  const nextCount = new Map<string, number>();
  if (opts.mode === 'membership' && lastSet.size) {
    for (let i = 0; i + 1 < sessions.length; i++) {
      const A = sessions[i].ids;
      let ov = false;
      for (const x of A) { if (lastSet.has(x)) { ov = true; break; } }
      if (!ov) continue;
      overlapPairs++;
      for (const y of sessions[i + 1].ids) nextCount.set(y, (nextCount.get(y) || 0) + 1);
    }
  }

  const ids = [...globalCount.keys()];
  const scored: { id: string; title: string; transW: number; score: number; pref: number | null; fresh: number; isCold: boolean; prob?: number }[] = ids.map((id) => {
    // 无出边（新会话 / 数据少）→ 弱全局频率先验
    const transW = cand.has(id) ? cand.get(id)! : (globalCount.get(id)! / Math.max(1, sessions.length - 1)) * 0.25;
    const pref = prefScore ? prefScore(id) : 0.6;          // 0..1
    const fresh = opts.freshScore ? opts.freshScore(id) : 1;  // 新鲜度乘子（新歌 > 1）
    const score = transW * (0.4 + 1.2 * pref) * fresh;     // 排序用（偏好乘子 0.4..1.6，再乘新鲜度）
    return { id, title: titlesAll.get(id)!, transW, score, pref: prefScore ? pref : null, fresh, isCold: false };
  });
  // 冷启动：歌单里有但从未在记录里出现过的对象（如刚加进歌单还没唱过的歌），给随新鲜度缩放的弱先验
  const coldCands = opts.coldCandidates || [];
  const seenCold = new Set(ids);
  const COLD_PRIOR = 0.12;
  for (const cc of coldCands) {
    if (seenCold.has(cc.id)) continue;
    const f = opts.freshScore ? opts.freshScore(cc.id) : 1;
    scored.push({ id: cc.id, title: cc.title, transW: 0, score: COLD_PRIOR * f, pref: null, fresh: f, isCold: true });
    seenCold.add(cc.id);
  }

  // 计算每条的概率（语义由 mode 决定）
  const sum = scored.reduce((a, b) => a + b.score, 0) || 1;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  for (const s of scored) {
    if (opts.mode === 'membership') {
      // 概率 = 「该歌出现在下一场歌单里的概率」(0..1)，不要求总和为 1
      if (s.isCold) {
        // 从未唱过：靠新鲜度给一个合理的初始概率（新歌更可能很快被点）
        s.prob = clamp(0.15 * s.fresh, 0, 0.6);
      } else {
        const transP = overlapPairs > 0
          ? (nextCount.get(s.id) || 0) / overlapPairs
          : (globalCount.get(s.id)! / Math.max(1, sessions.length - 1)); // 无重叠历史→回落到历史出现率
        const pref = s.pref ?? 0.6;
        const boost = (0.7 + 0.3 * pref) * (1 + 0.3 * (s.fresh - 1)); // 喜欢/能唱/新鲜 微调
        s.prob = clamp(transP * boost, 0, 0.98);
      }
    } else {
      // categorical：下一次只发生一个对象 → softmax 归一化（概率总和=1）
      s.prob = s.score / sum;
    }
  }

  // 全量排序返回（调用方再 slice 取前 N 项，改数量无需重算）
  const MAX_CANDIDATES = 80;
  const nextTop: MarkovItem[] = scored
    .map((s) => ({ id: s.id, title: s.title, prob: s.prob ?? 0, fromTransition: cand.has(s.id), pref: s.pref }))
    .sort((a, b) => (b.prob ?? 0) - (a.prob ?? 0))
    .slice(0, MAX_CANDIDATES);

  const usedMarkov = lastSessionIds.some((x) => (trans.get(x)?.size || 0) > 0);

  // 轮转历史排名（最久没出现排前）
  const lastMap: Record<string, string> = {};
  const countMap: Record<string, number> = {};
  for (const s of sessions) for (const id of s.ids) {
    countMap[id] = (countMap[id] || 0) + 1;
    const iso = new Date(s.at).toISOString();
    if (!lastMap[id] || iso > lastMap[id]) lastMap[id] = iso;
  }
  const now = Date.now();
  const ranking = Object.keys(lastMap)
    .map((id) => ({ id, title: titlesAll.get(id)!, count: countMap[id], lastAt: lastMap[id], daysSince: Math.floor((now - new Date(lastMap[id]).getTime()) / DAY) }))
    .sort((a, b) => b.daysSince - a.daysSince);

  return { lastEntity, lastSessionSize: lastSessionIds.length, nextTop, ranking, totalSessions: sessions.length, usedMarkov };
}

/* ── 2b) 新颖性预测：下一次活动会不会是「前所未有的新对象」 ── */
// 把每个 event_log 视为一次会话（去重对象集合），按时间排序
function buildSessions(logs: EventLogLite[]): { at: number; ids: string[] }[] {
  const sessions: { at: number; ids: string[] }[] = [];
  for (const log of logs) {
    const refs = (log.refs as any[]) || [];
    const ids = new Set<string>();
    for (const r of refs) { if (r && r.id) ids.add(String(r.id)); }
    const arr = [...ids];
    if (!arr.length) continue;
    sessions.push({ at: new Date(log.event_at).getTime(), ids: arr });
  }
  sessions.sort((a, b) => a.at - b.at);
  return sessions;
}

export interface NoveltyResult {
  prob: number;            // P(下次该活动 = 前所未有/未记录过的对象)
  sessions: number;
  newIntroductions: number; // 历史上有多少次是「首次出现该对象」
  recencyRate: number;     // 近期加权首现率（越近期权重越高）
}

/**
 * 大餐「吃前所未有的新菜」概率。
 * 思路：把每顿大餐当成一次会话，按时间顺序扫描；某次会话的对象若在此之前从未出现，
 * 说明这次吃的是「新菜」。概率 = 近期（指数衰减加权）首现率。
 * 这捕捉的是"你的大餐里常出现从没记录过的新菜"的经验规律。
 */
export function predictNoveltyMeal(logs: EventLogLite[]): NoveltyResult {
  const sessions = buildSessions(logs);
  const n = sessions.length;
  if (n < 2) return { prob: 0, sessions: n, newIntroductions: 0, recencyRate: 0 };
  const seen = new Set<string>();
  let newCount = 0;
  const lambda = 0.5;
  let wSum = 0, wNew = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.exp(-lambda * (n - 1 - i));
    wSum += w;
    let introduced = false;
    for (const id of sessions[i].ids) if (!seen.has(id)) { introduced = true; break; }
    if (introduced) { newCount++; wNew += w; }
    for (const id of sessions[i].ids) seen.add(id);
  }
  const recencyRate = wSum ? wNew / wSum : 0;
  // 平滑夹取：历史从不新也给 2% 底，避免永远显示 0；上限 95%
  const prob = Math.max(0.02, Math.min(0.95, recencyRate));
  return { prob, sessions: n, newIntroductions: newCount, recencyRate };
}

export interface NewCountResult {
  dist: { k: number; prob: number; count: number }[]; // k 首新歌 的概率
  expected: number;       // 期望新歌数
  pAtLeastOne: number;    // P(下场至少唱 1 首新歌)
  totalSessions: number;
}

/**
 * 唱歌「下次唱多少首新歌」的概率分布。
 * 思路：按时间顺序扫描每场唱K，统计每场里「首次出现（此前从未唱过）」的歌数，
 * 得到历史分布 → 归一化为 P(下场新歌数 = k)，并算期望与 P(≥1)。
 * 新歌 = 此前所有唱K记录里都没出现过的歌（无论它是否已在 music_list 里）。
 */
export function predictNewSongCount(logs: EventLogLite[]): NewCountResult {
  const sessions = buildSessions(logs);
  const n = sessions.length;
  if (n < 2) return { dist: [], expected: 0, pAtLeastOne: 0, totalSessions: n };
  const seen = new Set<string>();
  const hist: Record<number, number> = {};
  for (let i = 0; i < n; i++) {
    let newInSession = 0;
    for (const id of sessions[i].ids) if (!seen.has(id)) newInSession++;
    for (const id of sessions[i].ids) seen.add(id);
    hist[newInSession] = (hist[newInSession] || 0) + 1;
  }
  // 期望 / P(≥1) 用完整 hist 算（不截断，避免低估）
  let expected = 0, pAtLeastOne = 0;
  for (const key of Object.keys(hist)) {
    const k = Number(key), c = hist[k];
    expected += k * (c / n);
    if (k >= 1) pAtLeastOne += c / n;
  }
  // 展示用分布：0..cap-1 单独成行，≥cap 合并为「cap+」桶，使概率和=1
  const cap = 8;
  const dist: { k: number; prob: number; count: number }[] = [];
  for (let k = 0; k < cap; k++) {
    const c = hist[k] || 0;
    dist.push({ k, prob: c / n, count: c });
  }
  let tailC = 0;
  for (const key of Object.keys(hist)) { const k = Number(key); if (k >= cap) tailC += hist[k]; }
  if (tailC > 0) dist.push({ k: cap, prob: tailC / n, count: tailC }); // 末桶代表 cap+
  return { dist, expected, pAtLeastOne, totalSessions: n };
}

/* ── 3) 跨事件组依赖（事件非独立） ── */
export interface GroupDep {
  aId: string; bId: string; aName: string; bName: string; aIcon: string; bIcon: string;
  corr: number;            // 日频 Pearson 相关（对频率不平衡敏感，仅作辅助参考）
  pGivenA: number;         // P(组内 B 在 ±window 天出现 | A 发生)
  pGivenB: number;
  jointCount: number;
  windowDays: number;
  assoc: number;           // 关联方向（已扣除随机基线）：>0 倾向同去，<0 倾向交替（lift-1 的均值，裁剪到 [-2,2]）
  liftBA: number;          // P(B|A) / 随机基线（>1 即高于随机）
  liftAB: number;
}

export function computeGroupDependencies(
  groups: EventGroupLite[],
  logsByGroup: Record<string, EventLogLite[]>,
  windowDays = 2
): GroupDep[] {
  const W = windowDays * DAY;
  const out: GroupDep[] = [];

  // 全局去重天数（所有事件组的并集），用作"随机基线"的分母
  const allDaySet = new Set<string>();
  for (const g of groups) {
    for (const l of (logsByGroup[g.id] || [])) {
      allDaySet.add(new Date(l.event_at).toISOString().slice(0, 10));
    }
  }
  const totalDays = allDaySet.size || 1;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const A = groups[i], B = groups[j];
      const la = logsByGroup[A.id] || [];
      const lb = logsByGroup[B.id] || [];
      if (!la.length || !lb.length) continue;

      // 日频聚合
      const dayCount = (logs: EventLogLite[]) => {
        const m: Record<string, number> = {};
        for (const l of logs) { const k = new Date(l.event_at).toISOString().slice(0, 10); m[k] = (m[k] || 0) + 1; }
        return m;
      };
      const ca = dayCount(la), cb = dayCount(lb);
      const allDays = new Set([...Object.keys(ca), ...Object.keys(cb)]);
      const days = [...allDays].sort();
      const va = days.map((d) => ca[d] || 0);
      const vb = days.map((d) => cb[d] || 0);
      const corr = pearson(va, vb);

      // 条件共现
      const ta = la.map((l) => new Date(l.event_at).getTime()).sort((x, y) => x - y);
      const tb = lb.map((l) => new Date(l.event_at).getTime()).sort((x, y) => x - y);
      let matchedA = 0;
      for (const t of ta) {
        const idx = bisect(tb, t);
        const near = (idx < tb.length && Math.abs(tb[idx] - t) <= W) ||
          (idx > 0 && Math.abs(tb[idx - 1] - t) <= W);
        if (near) matchedA++;
      }
      let matchedB = 0;
      for (const t of tb) {
        const idx = bisect(ta, t);
        const near = (idx < ta.length && Math.abs(ta[idx] - t) <= W) ||
          (idx > 0 && Math.abs(ta[idx - 1] - t) <= W);
        if (near) matchedB++;
      }
      const pGivenA = matchedA / ta.length;
      const pGivenB = matchedB / tb.length;

      // 随机基线：随机一天落在某事件 ±window 窗口内的概率（事件日视为独立）
      const daysA = new Set(la.map((l) => new Date(l.event_at).toISOString().slice(0, 10))).size;
      const daysB = new Set(lb.map((l) => new Date(l.event_at).toISOString().slice(0, 10))).size;
      const nullBA = 1 - Math.pow(1 - daysB / totalDays, 2 * windowDays + 1);
      const nullAB = 1 - Math.pow(1 - daysA / totalDays, 2 * windowDays + 1);
      const liftBA = nullBA > 0 ? pGivenA / nullBA : 1;
      const liftAB = nullAB > 0 ? pGivenB / nullAB : 1;
      // 关联方向：扣除随机基线后的提升，双向平均，裁剪到 [-2,2]
      const assoc = (Math.max(-2, Math.min(2, liftBA - 1)) + Math.max(-2, Math.min(2, liftAB - 1))) / 2;

      const strength = Math.max(Math.abs(corr), pGivenA, pGivenB, Math.min(1, Math.abs(assoc)));
      if (strength < 0.25) continue;

      out.push({
        aId: A.id, bId: B.id, aName: A.name, bName: B.name, aIcon: A.icon, bIcon: B.icon,
        corr, pGivenA, pGivenB, jointCount: matchedA, windowDays,
        assoc, liftBA, liftAB,
      });
    }
  }
  out.sort((x, y) => Math.max(Math.abs(x.corr), x.pGivenA, x.pGivenB) - Math.max(Math.abs(y.corr), y.pGivenA, y.pGivenB));
  return out;
}

/* ── 4) 高级预测：跨域联动 / 生存分析 / 场景序列 / 习惯漂移 / 日常原型聚类 ── */

export interface MoodPoint { created_at: string; mood_score: number; }
export interface SleepPoint { start_date: string; duration_minutes: number; }
export interface DailyFeature {
  date: string;
  groupIds: string[];
  moodAvg?: number;
  sleepAvgMin?: number;
}

/** 把事件日志按天聚合，并 join 心情/睡眠，得到每天的「特征向量」。 */
export function buildDailyFeatures(
  logs: EventLogLite[],
  _groups: EventGroupLite[],
  mood: MoodPoint[],
  sleep: SleepPoint[]
): DailyFeature[] {
  const byDay = new Map<string, Set<string>>();
  for (const l of logs) {
    const d = new Date(l.event_at).toISOString().slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, new Set());
    byDay.get(d)!.add(l.group_id);
  }
  const moodByDay = new Map<string, number[]>();
  for (const m of mood) {
    const d = new Date(m.created_at).toISOString().slice(0, 10);
    if (!moodByDay.has(d)) moodByDay.set(d, []);
    moodByDay.get(d)!.push(m.mood_score);
  }
  const sleepByDay = new Map<string, number[]>();
  for (const s of sleep) {
    const d = new Date(s.start_date).toISOString().slice(0, 10);
    if (!sleepByDay.has(d)) sleepByDay.set(d, []);
    sleepByDay.get(d)!.push(s.duration_minutes);
  }
  const dates = new Set<string>([...byDay.keys(), ...moodByDay.keys(), ...sleepByDay.keys()]);
  const out: DailyFeature[] = [];
  for (const d of [...dates].sort()) {
    out.push({
      date: d,
      groupIds: [...(byDay.get(d) || [])],
      moodAvg: moodByDay.has(d) ? mean(moodByDay.get(d)!) : undefined,
      sleepAvgMin: sleepByDay.has(d) ? mean(sleepByDay.get(d)!) : undefined,
    });
  }
  return out;
}

/* 4a) 跨域联动：事件 × 心情 / 睡眠 */
export interface CrossGroupStat {
  groupId: string; groupName: string; groupIcon: string;
  eventDayCount: number;
  moodOn: number | null; moodLift: number;
  sleepOn: number | null; sleepLiftMin: number;
}
export interface CrossDomainResult {
  byGroup: CrossGroupStat[];
  moodBaseline: number | null;
  sleepBaselineMin: number | null;
  hasMood: boolean; hasSleep: boolean;
}
export function computeCrossDomain(daily: DailyFeature[], groups: EventGroupLite[]): CrossDomainResult {
  const moodDays = daily.filter((d) => d.moodAvg !== undefined);
  const sleepDays = daily.filter((d) => d.sleepAvgMin !== undefined);
  const moodBaseline = moodDays.length ? mean(moodDays.map((d) => d.moodAvg!)) : null;
  const sleepBaselineMin = sleepDays.length ? mean(sleepDays.map((d) => d.sleepAvgMin!)) : null;
  const byGroup: CrossGroupStat[] = [];
  for (const g of groups) {
    const ed = daily.filter((d) => d.groupIds.includes(g.id));
    if (ed.length < 2) continue;
    const moodOnDays = ed.filter((d) => d.moodAvg !== undefined);
    const sleepOnDays = ed.filter((d) => d.sleepAvgMin !== undefined);
    const moodOn = moodOnDays.length >= 2 ? mean(moodOnDays.map((d) => d.moodAvg!)) : null;
    const sleepOn = sleepOnDays.length >= 2 ? mean(sleepOnDays.map((d) => d.sleepAvgMin!)) : null;
    byGroup.push({
      groupId: g.id, groupName: g.name, groupIcon: g.icon,
      eventDayCount: ed.length,
      moodOn, moodLift: moodOn !== null && moodBaseline !== null ? moodOn - moodBaseline : 0,
      sleepOn, sleepLiftMin: sleepOn !== null && sleepBaselineMin !== null ? sleepOn - sleepBaselineMin : 0,
    });
  }
  byGroup.sort((a, b) => Math.abs(b.moodLift) - Math.abs(a.moodLift));
  return { byGroup, moodBaseline, sleepBaselineMin, hasMood: moodDays.length > 0, hasSleep: sleepDays.length > 0 };
}

/* 4b) 场景序列挖掘（motif）：某类事件发生时，常伴随哪些其他事件。
 * 用 lift = P(B|A) / P(B) 修正基准率，只保留真关联（lift>=1.2），避免把「高频活动」误判为伴随。
 * 按北京日期分桶，与日类型/时段口径一致。 */
export interface MotifItem { groupId: string; name: string; icon: string; condProb: number; lift: number; }
export interface MotifResult { targetId: string; companions: MotifItem[]; }
export function predictScenarioMotifs(
  logs: EventLogLite[], groups: EventGroupLite[], targetId: string
): MotifResult {
  const dayGroups = new Map<string, Set<string>>();
  for (const l of logs) {
    const d = bjDateKey(l.event_at);
    if (!dayGroups.has(d)) dayGroups.set(d, new Set());
    dayGroups.get(d)!.add(l.group_id);
  }
  const totalDays = dayGroups.size;
  if (totalDays === 0) return { targetId, companions: [] };
  // 基准率 P(B)：含活动 B 的天数 / 总活跃天数
  const baseRate = new Map<string, number>();
  for (const s of dayGroups.values()) for (const gid of s) baseRate.set(gid, (baseRate.get(gid) || 0) + 1);
  for (const [gid, n] of baseRate) baseRate.set(gid, n / totalDays);

  const targetDays = [...dayGroups.values()].filter((s) => s.has(targetId));
  const nT = targetDays.length;
  if (nT < 2) return { targetId, companions: [] };
  const gmap = new Map(groups.map((g) => [g.id, g]));
  const co = new Map<string, number>();
  for (const s of targetDays) for (const gid of s) if (gid !== targetId) co.set(gid, (co.get(gid) || 0) + 1);
  const companions: MotifItem[] = [...co.entries()]
    .filter(([gid]) => gmap.has(gid)) // 丢弃孤儿组（数据里 group_id 无对应名字时），杜绝显示 UUID
    .map(([gid, c]) => {
      const cond = c / nT;
      const base = baseRate.get(gid) || 0;
      return { groupId: gid, name: gmap.get(gid)!.name, icon: gmap.get(gid)!.icon, condProb: cond, lift: base > 0 ? cond / base : 0 };
    })
    .filter((x) => x.lift >= 1.2) // 只保留「比平时显著更可能发生」的真关联
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 4);
  return { targetId, companions };
}

/* 4c) 习惯漂移检测（change-point）：在日频序列上找频率突变 */
export interface ChangePoint {
  groupId: string; groupName: string; groupIcon: string;
  date: string | null;
  beforeRate: number; afterRate: number;
  drop: boolean; relChange: number;
}
export function detectChangePoints(
  logsByGroup: Record<string, EventLogLite[]>,
  groups: EventGroupLite[]
): ChangePoint[] {
  const out: ChangePoint[] = [];
  for (const g of groups) {
    const logs = logsByGroup[g.id] || [];
    if (logs.length < 6) continue;
    const times = logs.map((l) => new Date(l.event_at).getTime()).sort((a, b) => a - b);
    const t0 = times[0], t1 = times[times.length - 1];
    if ((t1 - t0) / DAY < 21) continue;
    const dayCount = new Map<string, number>();
    for (const t of times) { const d = new Date(t).toISOString().slice(0, 10); dayCount.set(d, (dayCount.get(d) || 0) + 1); }
    const days = [...dayCount.keys()].sort();
    const counts = days.map((d) => dayCount.get(d)!);
    let best: { i: number; before: number; after: number; date: string; beforeSpan: number; afterSpan: number } | null = null;
    for (let i = 1; i < days.length; i++) {
      const beforeSpan = (new Date(days[i]).getTime() - new Date(days[0]).getTime()) / DAY || 1;
      const afterSpan = (new Date(days[days.length - 1]).getTime() - new Date(days[i]).getTime()) / DAY || 1;
      // 只在前/后段都足够长时考虑，避免把"最近几天集中爆发"或噪声误判为长期趋势
      if (beforeSpan < 21 || afterSpan < 10) continue;
      const before = counts.slice(0, i).reduce((a, b) => a + b, 0) / beforeSpan;
      const after = counts.slice(i).reduce((a, b) => a + b, 0) / afterSpan;
      const diff = Math.abs(after - before);
      if (!best || diff > Math.abs(best.after - best.before)) best = { i, before, after, date: days[i], beforeSpan, afterSpan };
    }
    if (best && best.before > 0) {
      const rel = (best.after - best.before) / best.before;
      if (Math.abs(rel) >= 0.4) {
        out.push({
          groupId: g.id, groupName: g.name, groupIcon: g.icon, date: best.date,
          beforeRate: best.before, afterRate: best.after, drop: best.after < best.before, relChange: rel,
        });
      }
    }
  }
  return out;
}

/* 4e) 季节性阶段检测（regime segmentation）：把时间线切成几段，标出「高频期 / 低频期」，
   抓的是「一阵子很勤、之后冷了」这种阶段性起伏（自顶向下二分分割，非固定周期）。 */
export interface Regime {
  startDate: string; endDate: string;   // 含端点的日期
  ratePerDay: number; count: number;
  kind: 'hot' | 'cold' | 'normal';      // 相对整体基线
}
export interface RegimeResult {
  groupId: string; groupName: string; groupIcon: string;
  baselinePerDay: number;
  regimes: Regime[];                    // 按时间排序
  current: Regime | null;               // 最新一段（仍在持续）
}
export function detectRegimes(
  logsByGroup: Record<string, EventLogLite[]>,
  groups: EventGroupLite[],
  minSpan = 14,
  maxSegments = 5
): RegimeResult[] {
  const out: RegimeResult[] = [];
  for (const g of groups) {
    const logs = logsByGroup[g.id] || [];
    if (logs.length < 8) continue;
    const times = logs.map((l) => new Date(l.event_at).getTime()).sort((a, b) => a - b);
    const t0 = times[0], t1 = times[times.length - 1];
    if ((t1 - t0) / DAY < 28) continue;          // 至少 4 周才谈阶段
    const dayCount = new Map<string, number>();
    for (const t of times) { const d = new Date(t).toISOString().slice(0, 10); dayCount.set(d, (dayCount.get(d) || 0) + 1); }
    const start = new Date(t0); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(t1); end.setUTCHours(0, 0, 0, 0);
    const totalDays = Math.floor((end.getTime() - start.getTime()) / DAY) + 1;
    const days: string[] = [];
    const counts: number[] = [];
    for (let i = 0; i < totalDays; i++) {
      const ts = start.getTime() + i * DAY;
      const d = new Date(ts).toISOString().slice(0, 10);
      days.push(d);
      counts.push(dayCount.get(d) || 0);
    }
    const n = days.length;
    const sumAll = counts.reduce((a, b) => a + b, 0);
    const baselinePerDay = sumAll / totalDays;
    const rateOf = (s: number, e: number) => {
      const span = (new Date(days[e]).getTime() - new Date(days[s]).getTime()) / DAY || 1;
      let c = 0; for (let i = s; i <= e; i++) c += counts[i];
      return { rate: c / span, count: c };
    };
    // 自顶向下二分分割：每次挑「前后速率差最大」的切点，直到无可分或达上限
    let segs: { start: number; end: number }[] = [{ start: 0, end: n - 1 }];
    while (segs.length < maxSegments) {
      let best: { segIdx: number; i: number; rel: number } | null = null;
      for (let si = 0; si < segs.length; si++) {
        const seg = segs[si];
        if (seg.end - seg.start + 1 < 2 * minSpan) continue;
        for (let i = seg.start + minSpan; i <= seg.end - minSpan; i++) {
          const b = rateOf(seg.start, i - 1);
          const a = rateOf(i, seg.end);
          const rel = b.rate > 0 ? Math.abs(a.rate - b.rate) / b.rate : (a.rate > 0 ? 1 : 0);
          if (!best || rel > best.rel) best = { segIdx: si, i, rel };
        }
      }
      if (!best || best.rel < 0.4) break;         // 差异不够大就不硬切
      const seg = segs[best.segIdx];
      segs.splice(best.segIdx, 1, { start: seg.start, end: best.i - 1 }, { start: best.i, end: seg.end });
    }
    if (segs.length < 2) continue;                // 没有显著阶段变化
    const regimes: Regime[] = segs.map((seg) => {
      const { rate, count } = rateOf(seg.start, seg.end);
      let kind: Regime['kind'] = 'normal';
      if (baselinePerDay > 0) {
        if (rate >= baselinePerDay * 1.35) kind = 'hot';
        else if (rate <= baselinePerDay * 0.65) kind = 'cold';
      }
      return { startDate: days[seg.start], endDate: days[seg.end], ratePerDay: rate, count, kind };
    });
    out.push({
      groupId: g.id, groupName: g.name, groupIcon: g.icon, baselinePerDay,
      regimes, current: regimes[regimes.length - 1] ?? null,
    });
  }
  return out;
}

/* 4d) 日常原型聚类（K-means on 每日事件向量） */
export interface Archetype {
  id: number; label: string; size: number;
  topGroups: { groupId: string; name: string; icon: string; freq: number }[];
  avgMood?: number;
}
export interface ArchetypeResult {
  archetypes: Archetype[];
  nextClusterId: number | null;
  nextClusterLabel: string | null;
}
const euclid = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
export function clusterDayArchetypes(daily: DailyFeature[], groups: EventGroupLite[], k = 4): ArchetypeResult {
  if (daily.length < k) return { archetypes: [], nextClusterId: null, nextClusterLabel: null };
  const gIdx = new Map(groups.map((g, i) => [g.id, i]));
  const feats = daily.map((d) => {
    const v = new Array(groups.length).fill(0);
    for (const gid of d.groupIds) { const i = gIdx.get(gid); if (i !== undefined) v[i] = 1; }
    return v;
  });
  // k-means++ 初始化
  const centroids: number[][] = [feats[Math.floor(Math.random() * feats.length)].slice()];
  while (centroids.length < k) {
    const d2 = feats.map((f) => Math.min(...centroids.map((c) => euclid(f, c) ** 2)));
    const sum = d2.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * sum, pick = 0;
    for (let i = 0; i < d2.length; i++) { r -= d2[i]; if (r <= 0) { pick = i; break; } }
    centroids.push(feats[pick].slice());
  }
  let assign = new Array(daily.length).fill(0);
  for (let iter = 0; iter < 25; iter++) {
    let changed = false;
    for (let i = 0; i < feats.length; i++) {
      let bc = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const dd = euclid(feats[i], centroids[c]); if (dd < bd) { bd = dd; bc = c; } }
      if (assign[i] !== bc) { assign[i] = bc; changed = true; }
    }
    const sums = Array.from({ length: k }, () => new Array(groups.length).fill(0));
    const cnts = new Array(k).fill(0);
    for (let i = 0; i < feats.length; i++) { cnts[assign[i]]++; for (let j = 0; j < groups.length; j++) sums[assign[i]][j] += feats[i][j]; }
    for (let c = 0; c < k; c++) if (cnts[c] > 0) centroids[c] = sums[c].map((s) => s / cnts[c]);
    if (!changed && iter > 0) break;
  }
  const archetypes: Archetype[] = [];
  for (let c = 0; c < k; c++) {
    const idxs = []; for (let i = 0; i < assign.length; i++) if (assign[i] === c) idxs.push(i);
    if (!idxs.length) continue;
    const freq = new Array(groups.length).fill(0);
    let moodSum = 0, moodN = 0;
    for (const i of idxs) {
      for (const gid of daily[i].groupIds) { const gi = gIdx.get(gid); if (gi !== undefined) freq[gi]++; }
      if (daily[i].moodAvg !== undefined) { moodSum += daily[i].moodAvg!; moodN++; }
    }
    const size = idxs.length;
    const topGroups = groups.map((g, gi) => ({ groupId: g.id, name: g.name, icon: g.icon, freq: freq[gi] / size }))
      .filter((t) => t.freq > 0).sort((a, b) => b.freq - a.freq).slice(0, 4);
    archetypes.push({ id: c, label: topGroups.length ? `${topGroups[0].name}型` : '休息型', size, topGroups, avgMood: moodN ? moodSum / moodN : undefined });
  }
  // 去重标签：若多个簇主群体相同，用次群体或序号区分
  const seen = new Map<string, number>();
  for (const a of archetypes) {
    const base = a.label;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    if (n > 0) {
      const alt = a.topGroups[1]?.name;
      a.label = alt ? `${alt}型` : `类型${a.id}`;
    }
  }
  const recent = assign[assign.length - 1];
  return { archetypes, nextClusterId: recent, nextClusterLabel: archetypes.find((a) => a.id === recent)?.label || null };
}

/* ── 5) 阶段起伏预测：基于已检测到的历史 regime，向前外推未来每个习惯的冷热起伏 ──
   思路：detectRegimes 把每个习惯历史切成若干「高频/低频/常态」段。对未来，观察这些段的
   「交替规律」与「典型段长」做外推：
     · 若历史段呈明显交替（hot↔cold 来回切换）→ 预测下一阶段为相反类型，按典型段长推进；
     · 若交替不明显 → 当前阶段缓慢回归基线（无显著起伏）。
   输出从今天起未来 horizonWeeks 周的「预测率曲线（次/周）」+ 每段预期 hot/cold/normal 区间带。 */
export interface ForecastPoint { week: number; dateISO: string; rate: number; dayType: DayType; }
export interface ForecastBand { fromWeek: number; toWeek: number; kind: 'hot' | 'cold' | 'normal'; rate: number; }
export interface ForecastSeries {
  groupId: string; name: string; icon: string; color: string;
  forecast: ForecastPoint[];        // 每天一个点，week = 天/7，第 0 天 = 今天
  bands: ForecastBand[];
  startRate: number;                // 今天起算率（= 当前阶段率 × 当天类型基线）
  baselinePerDay: number;
  dayTypeBase: { weekday: number; weekend: number; holiday: number; overall: number }; // 各天类型的天频次基线
}
export interface ForecastResult {
  series: ForecastSeries[];
  horizonWeeks: number;
  maxRate: number;
}

// 按天类型统计周频次基线：遍历观测窗口内每一天，累计该类型的事件数与天数
function dayTypeRates(logs: EventLogLite[]): { weekday: number; weekend: number; holiday: number; overall: number } {
  if (!logs.length) return { weekday: 0, weekend: 0, holiday: 0, overall: 0 };
  const times = logs.map((l) => new Date(l.event_at).getTime()).sort((a, b) => a - b);
  const start = new Date(times[0]); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(times[times.length - 1]); end.setUTCHours(0, 0, 0, 0);
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY) + 1);
  const byDay = new Map<string, number>();
  for (const t of times) {
    const k = bjDateKey(new Date(t));
    byDay.set(k, (byDay.get(k) || 0) + 1);
  }
  const cnt = { weekday: 0, weekend: 0, holiday: 0 };
  const days = { weekday: 0, weekend: 0, holiday: 0 };
  for (let i = 0; i < spanDays; i++) {
    const dt = new Date(start.getTime() + i * DAY);
    const k = bjDateKey(dt);
    const type = classifyDay(dt);
    days[type]++; cnt[type] += byDay.get(k) || 0;
  }
  const rate = (c: number, d: number) => (d > 0 ? c / d : 0);
  return {
    weekday: rate(cnt.weekday, days.weekday),
    weekend: rate(cnt.weekend, days.weekend),
    holiday: rate(cnt.holiday, days.holiday),
    overall: logs.length / spanDays,
  };
}

/* 确定性字符串哈希 + mulberry32 伪随机：同一 group 每次刷新得到相同的段长抖动，避免曲线跳动 */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function forecastFutureRegimes(
  regimes: RegimeResult[],
  groups: EventGroupLite[] = [],
  logsByGroup: Record<string, EventLogLite[]> = {},
  opts: { horizonWeeks?: number } = {}
): ForecastResult {
  const H = opts.horizonWeeks ?? 16;
  const DAYW = 7;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const colorMap = new Map(groups.map((g) => [g.id, g.color]));

  const series: ForecastSeries[] = [];
  let maxRate = 0;

  for (const r of regimes) {
    if (!r.regimes.length) continue;
    const baseline = r.baselinePerDay;
    const segs = r.regimes;
    const cur = r.current ?? segs[segs.length - 1];
    const curRate = cur.ratePerDay;
    const curKind = cur.kind;

    // 各类（hot/cold/normal）的历史平均率，用于推导阶段摆幅乘子
    const avgOf = (kind: Regime['kind']) => {
      const rs = segs.filter((s) => s.kind === kind);
      if (!rs.length) return kind === 'hot' ? baseline * 1.5 : kind === 'cold' ? baseline * 0.4 : baseline;
      return mean(rs.map((s) => s.ratePerDay));
    };
    const hotAvg = avgOf('hot'), coldAvg = avgOf('cold');
    // 阶段摆幅乘子（相对基线）：保留历史 swing 幅度，夹取合理范围
    const HOT_MUL = Math.max(1.08, Math.min(2.2, hotAvg > 0 ? hotAvg / baseline : 1.4));
    const COLD_MUL = Math.max(0.2, Math.min(0.92, coldAvg > 0 ? coldAvg / baseline : 0.5));

    // 典型段长（周）：各段跨度中位数，夹取 [2,12]
    const durations = segs.map((s) => Math.max(1, (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / DAY / DAYW));
    const medianLen = Math.max(2, Math.min(12, Math.round(median(durations) || 4)));

    // 是否进入「阶段起伏」预测：历史上既出现过高频也出现过低频
    const kinds = segs.map((s) => s.kind);
    const oscillating = segs.length >= 3 && kinds.includes('hot') && kinds.includes('cold');

    // 当前阶段已持续周数 → 预期还剩多久进入下一阶段
    const ageWeeks = Math.max(0, (today.getTime() - new Date(cur.startDate).getTime()) / DAY / DAYW);
    const remaining = Math.max(1, Math.round(medianLen - ageWeeks));

    const flip = (k: Regime['kind']): Regime['kind'] =>
      k === 'hot' ? 'cold' : k === 'cold' ? 'hot' : (hotAvg >= coldAvg ? 'hot' : 'cold');

    // ── 阶段包络：用「乘子」而非绝对率，叠加到各天类型基线上 ──
    // 波动段 = 基线 × (1 + (peak-1)·sin(πt))，peak=HOT_MUL/COLD_MUL；平段=×1；mono 段平滑回归 ×1。
    const rnd = mulberry32(hashStr(r.groupId || r.groupName));
    type Env = { start: number; end: number; mode: 'flat' | 'wave' | 'mono'; peak: number; startMul: number };
    const envs: Env[] = [];

    if (!oscillating) {
      envs.push({ start: 0, end: H, mode: 'mono', peak: 1, startMul: baseline > 0 ? curRate / baseline : 1 });
    } else {
      const firstEnd = Math.min(remaining, H);
      if (firstEnd >= 1) envs.push({ start: 0, end: firstEnd, mode: 'flat', peak: 1, startMul: baseline > 0 ? curRate / baseline : 1 });
      let w = firstEnd;
      let kind = flip(curKind);
      while (w + 2 <= H) {
        const jit = 0.75 + 0.5 * rnd();
        const segLen = Math.max(2, Math.round(medianLen * jit));
        const nw = Math.min(w + segLen, H);
        envs.push({ start: w, end: nw, mode: 'wave', peak: kind === 'hot' ? HOT_MUL : COLD_MUL, startMul: 1 });
        w = nw; kind = flip(kind);
        if (nw >= H) break;
      }
      if (w < H) envs.push({ start: w, end: H, mode: 'flat', peak: 1, startMul: 1 });
    }

    const factorAt = (weekPos: number) => {
      const seg = envs.find((e) => weekPos >= e.start && weekPos <= e.end) || envs[envs.length - 1];
      const span = Math.max(1e-6, seg.end - seg.start);
      const t = Math.min(1, Math.max(0, (weekPos - seg.start) / span));
      if (seg.mode === 'flat') return seg.startMul; // 当前阶段延续：保持当前率/基线
      if (seg.mode === 'mono') return seg.startMul + (1 - seg.startMul) * (1 - Math.cos(Math.PI * t)) / 2;
      return 1 + (seg.peak - 1) * Math.sin(Math.PI * t); // wave：正弦半波乘子
    };

    // 各天类型的历史周频次基线（预测按天类型加权；无数据回退 overall）
    const dt = dayTypeRates(logsByGroup[r.groupId] || []);
    const baseFor = (type: DayType) => (dt[type] > 0 ? dt[type] : dt.overall);

    // 逐天生成预测：当天类型基线 × 阶段乘子
    const horizonDays = H * DAYW;
    const forecast: ForecastPoint[] = [];
    for (let d = 0; d <= horizonDays; d++) {
      const date = new Date(today.getTime() + d * DAY);
      const type = classifyDay(date);
      const rate = baseFor(type) * factorAt(d / DAYW);
      forecast.push({ week: d / DAYW, dateISO: date.toISOString(), rate, dayType: type });
      if (rate > maxRate) maxRate = rate;
    }

    series.push({
      groupId: r.groupId, name: r.groupName, icon: r.groupIcon,
      color: colorMap.get(r.groupId) || '',
      forecast, bands: [], startRate: forecast[0].rate, baselinePerDay: baseline, dayTypeBase: dt,
    });
  }
  return { series, horizonWeeks: H, maxRate: maxRate || 1 };
}

/* ── 工具：一维普通克里金（Ordinary Kriging）插值 ──
   用指数型半变异函数 γ(h)=nugget+sill·(1-exp(-h/range))，对每个预测点解
   Kriging 方程组得到最优线性无偏预测，并返回预测方差（可用于置信带）。 */
function invertMatrix(A: number[][]): number[][] {
  const n = A.length;
  const I = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const M = A.map((row) => [...row]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col; row < n; row++) if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    if (Math.abs(M[pivot][col]) < 1e-12) continue;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    [I[col], I[pivot]] = [I[pivot], I[col]];
    const piv = M[col][col];
    for (let j = 0; j < n; j++) { M[col][j] /= piv; I[col][j] /= piv; }
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col];
      for (let j = 0; j < n; j++) {
        M[row][j] -= f * M[col][j];
        I[row][j] -= f * I[col][j];
      }
    }
  }
  return I;
}
export interface KrigingPoint { x: number; y: number; variance: number; }
export function kriging1D(
  known: { x: number; y: number }[],
  queryX: number[],
  opts: { range?: number; nugget?: number; sill?: number } = {}
): KrigingPoint[] {
  const n = known.length;
  if (n < 2) return queryX.map((x) => ({ x, y: n ? known[0].y : 0, variance: 0 }));
  const range = opts.range ?? 1.5;
  const nugget = opts.nugget ?? 1e-4;
  const sill = opts.sill ?? 1;
  const gamma = (h: number) => nugget + sill * (1 - Math.exp(-h / range));
  // 构建 Kriging 矩阵（拉格朗日乘子处理未知均值）
  const K = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => {
    if (i === n || j === n) return i === n && j === n ? 0 : 1;
    return gamma(Math.abs(known[i].x - known[j].x));
  }));
  const Kinv = invertMatrix(K);
  return queryX.map((x) => {
    const k = Array.from({ length: n + 1 }, (_, i) => (i === n ? 1 : gamma(Math.abs(x - known[i].x))));
    const w = Kinv.map((row) => row.reduce((s, v, j) => s + v * k[j], 0));
    let y = 0, variance = w[n];
    for (let i = 0; i < n; i++) { y += w[i] * known[i].y; variance += w[i] * k[i]; }
    return { x, y, variance: Math.max(0, variance) };
  });
}

/* ── 工具 ── */
export function daysBetween(fromISO: string, toISO: string): number {
  return Math.floor((new Date(toISO).getTime() - new Date(fromISO).getTime()) / DAY);
}
export function countdownText(targetISO: string | null): { text: string; overdue: boolean } {
  if (!targetISO) return { text: '—', overdue: false };
  const d = daysBetween(new Date().toISOString(), targetISO);
  if (d > 0) return { text: `还有 ${d} 天`, overdue: false };
  if (d === 0) return { text: '就是今天！', overdue: false };
  return { text: `已逾期 ${Math.abs(d)} 天`, overdue: true };
}
export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: '规律', medium: '较规律', low: '随性', unknown: '数据不足',
};
export const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: '#4ade80', medium: '#eab308', low: '#f87171', unknown: '#6b7280',
};

/* ── 关联方向（已扣除随机基线）的配色与文案 ── */
export const assocColor = (a: number): string =>
  a > 0.1 ? '#4ade80' : a < -0.1 ? '#f87171' : '#9ca3af';
export const assocLabel = (a: number): string =>
  a > 0.1 ? '同去（高于随机，常一起发生）' : a < -0.1 ? '交替（低于随机，各过各的）' : '无显著关联（接近随机）';
