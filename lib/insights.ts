/**
 * 洞察算法库 —— 在 lib/prediction.ts 的预测内核之上，产出「人能直接用」的结论：
 *  1) computeAttribution  跨域归因：到底是什么在影响你的心情 / 睡眠（排序后的结论列表）
 *  2) detectAnomalies     异常预警：近期实测连续偏离历史基线时给出提醒（睡眠类用于 /sleep）
 * 全部为纯函数，无外部依赖，方便静态导出站内客户端直接调用或单测。
 */

import {
  mean, median, linregSlope,
  type CrossDomainResult,
} from './prediction';

/* ── 工具 ── */
const confOf = (n: number): 'high' | 'medium' | 'low' | 'unknown' => {
  if (n >= 40) return 'high';
  if (n >= 15) return 'medium';
  if (n >= 5) return 'low';
  return 'unknown';
};
const CONF_W: Record<'high' | 'medium' | 'low' | 'unknown', number> = { high: 1, medium: 0.7, low: 0.4, unknown: 0.2 };

const localPearson = (xs: number[], ys: number[]): number => {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
};

export const fmtSign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '±');
export const fmtAbs = (v: number, d = 2) => Math.abs(v).toFixed(d);

/** 入睡小时（24+ 标度，如 25.5=次日 1:30）转可读文本 */
export function fmtOnset(v: number): string {
  const hh = Math.floor(v) % 24;
  const mm = Math.round((v - Math.floor(v)) * 60);
  const mmStr = String(mm).padStart(2, '0');
  return v >= 24 ? `次日 ${String(hh).padStart(2, '0')}:${mmStr}` : `${String(hh).padStart(2, '0')}:${mmStr}`;
}

/* ── 1) 跨域归因 ── */
export interface Attribution {
  id: string;
  factor: string;          // 影响因子，如「大餐」「睡眠不足」「在『家』」
  metric: string;          // 受影响指标，如「心情」「睡眠」
  dir: 'up' | 'down' | 'flat';
  delta: number;           // 效应量（心情=分；睡眠时长=小时；入睡=小时）
  unit: string;            // 展示单位，如「分」「h」
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  n: number;
  detail: string;          // 完整结论句
}

export function computeAttribution(input: {
  crossDomain: CrossDomainResult;
  moodDaily: { date: string; value: number }[];
  sleepOnset: { date: string; value: number | undefined }[];
  sleepDur: { date: string; value: number | undefined }[];
  resolveTag: (ts: number) => string | null;
}): Attribution[] {
  const out: Attribution[] = [];

  // ① 睡眠时长 → 次日心情（lag-1 回归）
  {
    const durByDate = new Map(input.sleepDur.map((d) => [d.date, d.value]));
    const moodByDate = new Map(input.moodDaily.map((d) => [d.date, d.value]));
    const dates = [...moodByDate.keys()].sort();
    const pairs: { dur: number; next: number }[] = [];
    for (let i = 0; i < dates.length - 1; i++) {
      const dv = durByDate.get(dates[i]);
      const nm = moodByDate.get(dates[i + 1]);
      if (dv != null && nm != null && isFinite(dv)) pairs.push({ dur: dv, next: nm });
    }
    if (pairs.length >= 5) {
      const slope = linregSlope(pairs.map((p) => p.dur), pairs.map((p) => p.next));
      if (Math.abs(slope) >= 0.05) {
        out.push({
          id: 'sleep-dur-mood',
          factor: '睡眠不足（前一天）',
          metric: '次日心情',
          dir: slope < 0 ? 'down' : 'up',
          delta: slope,
          unit: '分/小时',
          confidence: confOf(pairs.length),
          n: pairs.length,
          detail: `睡眠每少 1 小时，次日心情约 ${fmtSign(slope)}${fmtAbs(slope)} 分（基于 ${pairs.length} 对昼夜样本）`,
        });
      }
    }
  }

  // ② 入睡时间 → 次日心情（lag-1 回归）
  {
    const onsetByDate = new Map(input.sleepOnset.map((d) => [d.date, d.value]));
    const moodByDate = new Map(input.moodDaily.map((d) => [d.date, d.value]));
    const dates = [...moodByDate.keys()].sort();
    const pairs: { onset: number; next: number }[] = [];
    for (let i = 0; i < dates.length - 1; i++) {
      const ov = onsetByDate.get(dates[i]);
      const nm = moodByDate.get(dates[i + 1]);
      if (ov != null && nm != null && isFinite(ov)) pairs.push({ onset: ov, next: nm });
    }
    if (pairs.length >= 5) {
      const slope = linregSlope(pairs.map((p) => p.onset), pairs.map((p) => p.next));
      if (Math.abs(slope) >= 0.03) {
        out.push({
          id: 'onset-mood',
          factor: '熬夜（前一天）',
          metric: '次日心情',
          dir: slope < 0 ? 'down' : 'up',
          delta: slope,
          unit: '分/小时',
          confidence: confOf(pairs.length),
          n: pairs.length,
          detail: `入睡每晚 1 小时，次日心情约 ${fmtSign(slope)}${fmtAbs(slope)} 分（基于 ${pairs.length} 对昼夜样本）`,
        });
      }
    }
  }

  // ③ 事件组 × 心情（取 |心情提升| 最大的前 3）
  for (const g of [...input.crossDomain.byGroup].sort((a, b) => Math.abs(b.moodLift) - Math.abs(a.moodLift)).slice(0, 3)) {
    if (Math.abs(g.moodLift) < 0.15 || g.moodOn == null) continue;
    out.push({
      id: `evt-mood-${g.groupId}`,
      factor: `${g.groupIcon} ${g.groupName}`,
      metric: '当天心情',
      dir: g.moodLift > 0 ? 'up' : 'down',
      delta: g.moodLift,
      unit: '分',
      confidence: confOf(g.eventDayCount),
      n: g.eventDayCount,
      detail: `有「${g.groupName}」的那些天，心情平均${g.moodLift > 0 ? '高出' : '低了'} ${fmtAbs(g.moodLift)} 分`,
    });
  }

  // ④ 事件组 × 睡眠时长（取 |睡眠提升(分钟)| 最大的前 3）
  for (const g of [...input.crossDomain.byGroup].sort((a, b) => Math.abs(b.sleepLiftMin) - Math.abs(a.sleepLiftMin)).slice(0, 3)) {
    if (Math.abs(g.sleepLiftMin) < 12 || g.sleepOn == null) continue;
    const h = g.sleepLiftMin / 60;
    out.push({
      id: `evt-sleep-${g.groupId}`,
      factor: `${g.groupIcon} ${g.groupName}`,
      metric: '当天睡眠',
      dir: g.sleepLiftMin > 0 ? 'up' : 'down',
      delta: h,
      unit: 'h',
      confidence: confOf(g.eventDayCount),
      n: g.eventDayCount,
      detail: `有「${g.groupName}」的那些天，睡眠时长平均${g.sleepLiftMin > 0 ? '多' : '少'} ${fmtAbs(h, 1)} 小时`,
    });
  }

  // ⑤ 位置 × 心情（相对全量基线偏离最大的地点）
  {
    const byTag: Record<string, number[]> = {};
    for (const m of input.moodDaily) {
      const tag = input.resolveTag(Date.parse(m.date + 'T00:00:00Z'));
      if (!tag) continue;
      (byTag[tag] ||= []).push(m.value);
    }
    const base = median(input.moodDaily.map((m) => m.value));
    let best: { tag: string; dev: number; n: number } | null = null;
    for (const [tag, arr] of Object.entries(byTag)) {
      if (arr.length < 3) continue;
      const dev = mean(arr) - base;
      if (!best || Math.abs(dev) > Math.abs(best.dev)) best = { tag, dev, n: arr.length };
    }
    if (best && Math.abs(best.dev) >= 0.2) {
      out.push({
        id: 'loc-mood',
        factor: `在『${best.tag}』`,
        metric: '心情',
        dir: best.dev > 0 ? 'up' : 'down',
        delta: best.dev,
        unit: '分',
        confidence: confOf(best.n),
        n: best.n,
        detail: `在『${best.tag}』时心情比平时${best.dev > 0 ? '高' : '低'} ${fmtAbs(best.dev)} 分`,
      });
    }
  }

  // ⑥ 位置 × 睡眠时长（相对全量基线偏离最大的地点）
  {
    const byTag: Record<string, number[]> = {};
    for (const d of input.sleepDur) {
      if (d.value == null || !isFinite(d.value)) continue;
      const tag = input.resolveTag(Date.parse(d.date + 'T00:00:00Z'));
      if (!tag) continue;
      (byTag[tag] ||= []).push(d.value);
    }
    if (Object.keys(byTag).length) {
      const all = Object.values(byTag).flat();
      const base = median(all);
      let best: { tag: string; dev: number; n: number } | null = null;
      for (const [tag, arr] of Object.entries(byTag)) {
        if (arr.length < 3) continue;
        const dev = mean(arr) - base;
        if (!best || Math.abs(dev) > Math.abs(best.dev)) best = { tag, dev, n: arr.length };
      }
      if (best && Math.abs(best.dev) >= 0.15) {
        out.push({
          id: 'loc-sleep',
          factor: `在『${best.tag}』`,
          metric: '睡眠',
          dir: best.dev > 0 ? 'up' : 'down',
          delta: best.dev,
          unit: 'h',
          confidence: confOf(best.n),
          n: best.n,
          detail: `在『${best.tag}』时睡眠时长比平时${best.dev > 0 ? '多' : '少'} ${fmtAbs(best.dev, 1)} 小时`,
        });
      }
    }
  }

  // ⑦ 心情 ↔ 睡眠时长 相关系数（同日配对）
  {
    const durByDate = new Map(input.sleepDur.map((d) => [d.date, d.value]));
    const pairs: { m: number; s: number }[] = [];
    for (const m of input.moodDaily) {
      const sv = durByDate.get(m.date);
      if (sv != null && isFinite(sv)) pairs.push({ m: m.value, s: sv });
    }
    if (pairs.length >= 5) {
      const r = localPearson(pairs.map((p) => p.s), pairs.map((p) => p.m));
      if (Math.abs(r) >= 0.12) {
        out.push({
          id: 'mood-sleep-corr',
          factor: '睡眠时长',
          metric: '心情',
          dir: r > 0 ? 'up' : 'down',
          delta: r,
          unit: 'r',
          confidence: confOf(pairs.length),
          n: pairs.length,
          detail: `心情与睡眠时长${r > 0 ? '正' : '负'}相关（r=${r > 0 ? '+' : ''}${r.toFixed(2)}，同日 ${pairs.length} 对样本）`,
        });
      }
    }
  }

  // 按「效应量 × 置信度」排序，让最值得看的排前面
  out.sort((a, b) => {
    const score = (x: Attribution) => Math.abs(x.delta) * (x.unit === 'h' ? 2 : 1) * CONF_W[x.confidence];
    return score(b) - score(a);
  });
  return out;
}

/* ── 2) 异常预警 ── */
export interface AnomalyMetric { recent: number; baseline: number; dev: number; n: number }
export interface AnomalyReport {
  alert: boolean;
  mood?: AnomalyMetric;
  onset?: AnomalyMetric;
  dur?: AnomalyMetric;
  messages: string[];
}

export function detectAnomalies(input: {
  moodDaily: { date: string; value: number }[];
  sleepOnset: { date: string; value: number | undefined }[];
  sleepDur: { date: string; value: number | undefined }[];
  recentDays?: number;
}): AnomalyReport {
  const recentDays = input.recentDays ?? 7;
  const analyze = (series: { date: string; value: number | undefined }[]) => {
    const defined = series.filter((s) => s.value != null && isFinite(s.value as number));
    if (defined.length < 5) return null;
    const sorted = [...defined].sort((a, b) => a.date.localeCompare(b.date));
    const baseline = median(sorted.map((s) => s.value as number));
    const recentArr = sorted.slice(-recentDays).map((s) => s.value as number);
    if (recentArr.length < 2) return null;
    return { recent: mean(recentArr), baseline, dev: mean(recentArr) - baseline, n: recentArr.length };
  };

  const messages: string[] = [];
  const mood = analyze(input.moodDaily);
  const onset = analyze(input.sleepOnset);
  const dur = analyze(input.sleepDur);

  if (mood && mood.recent < mood.baseline - 0.6) {
    messages.push(`最近心情偏低（近 ${mood.n} 天均 ${mood.recent.toFixed(1)}，平时 ${mood.baseline.toFixed(1)}）`);
  }
  if (onset && onset.recent > onset.baseline + 0.4) {
    messages.push(`最近睡得偏晚（入睡约 ${fmtOnset(onset.recent)}，平时 ${fmtOnset(onset.baseline)}）`);
  }
  if (dur && dur.recent < dur.baseline - 0.4) {
    messages.push(`最近睡得偏短（均 ${dur.recent.toFixed(1)}h，平时 ${dur.baseline.toFixed(1)}h）`);
  }

  return {
    alert: messages.length > 0,
    mood: mood ?? undefined,
    onset: onset ?? undefined,
    dur: dur ?? undefined,
    messages,
  };
}
