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
  seasonality: number;                  // 0..1 周期性强度
  band: { p25: string | null; p50: string | null; p75: string | null }; // 预测区间
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
    seasonality: 0, band: { p25: null, p50: null, p75: null },
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
  for (const l of sorted) hist[new Date(l.event_at).getDay()]++;
  const total = count;
  const weekdayDist = hist.map((h) => h / total);
  let modalWeekday: number | null = null, maxP = -1;
  weekdayDist.forEach((p, i) => { if (p > maxP) { maxP = p; modalWeekday = i; } });
  // 周期性强度：相对均匀分布的偏离度
  const seasonality = Math.max(0, Math.min(1, (maxP - 1 / 7) / (6 / 7)));

  // 季节性修正点预测：从朴素均值起，向前最多 7 天对齐到高频星期几
  let predMs = lastMs + wmean * DAY;
  if (seasonality >= 0.12 && modalWeekday !== null) {
    const d = new Date(predMs);
    for (let k = 0; k < 7; k++) {
      if (d.getDay() === modalWeekday) { predMs = d.getTime(); break; }
      d.setDate(d.getDate() + 1);
    }
  }
  const predictedNextAt = new Date(predMs).toISOString();

  // 预测区间（经验分位）
  const addDays = (ms: number, days: number | null) =>
    days === null ? null : new Date(ms + days * DAY).toISOString();
  const band = {
    p25: addDays(lastMs, quantile(deltas, 0.25)),
    p50: addDays(lastMs, quantile(deltas, 0.5)),
    p75: addDays(lastMs, quantile(deltas, 0.75)),
  };

  return {
    count, lastAt, avgIntervalDays: wmean, medianIntervalDays: med, cv,
    predictedNextAt, baselineNextAt, confidence, recentIntervals: deltas,
    weekdayDist, modalWeekday, seasonality, band,
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
