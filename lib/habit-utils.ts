/** 自律养成（habits / habit_sessions）纯函数工具：按北京日聚合、区间条几何、统计。
 *  与 /sleep 的区间条视觉语言一致，但语义不同：这里是「几点开始、练了多久」，
 *  一次练习 = 一个区间（不是分段睡眠），因此不做 18:00 跨日重排。 */

export interface Habit {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  sort_order?: number | null;
  is_private?: boolean | null;
}

export interface HabitSession {
  id: string;
  habit_id: string;
  start_at: string;
  duration_min: number;
  note?: string | null;
}

export interface HabitSeg {
  id: string;
  /** 北京时间当日 0 点起的浮点小时，跨午夜可 >24 */
  startHr: number;
  endHr: number;
  durMin: number;
  note?: string | null;
}

export interface HabitDay {
  day: string; // 'YYYY-MM-DD'（北京）
  segs: HabitSeg[];
  totalMin: number;
  count: number;
}

const BJ_OFFSET_MS = 8 * 3600 * 1000;

/** UTC ISO → 北京时区的小时数（0~24，浮点）与日期串 */
export function utcToBeijingParts(utcIso: string) {
  const t = new Date(utcIso).getTime() + BJ_OFFSET_MS;
  const hr = (t % 86400000) / 3600000;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { hr, dateStr: `${y}-${m}-${day}` };
}

/** 会话 → 区间（结束时间 = 开始 + 时长，允许跨午夜 >24h） */
export function toSeg(s: HabitSession): HabitSeg {
  const { hr, dateStr } = utcToBeijingParts(s.start_at);
  const durHr = Math.max(s.duration_min, 0) / 60;
  return { id: s.id, startHr: hr, endHr: hr + durHr, durMin: s.duration_min, note: s.note };
}

/** 按北京日期分组，每天内部按开始时间升序 */
export function groupByDay(sessions: HabitSession[]): HabitDay[] {
  const map = new Map<string, HabitSeg[]>();
  for (const s of sessions) {
    const { dateStr } = utcToBeijingParts(s.start_at);
    const seg = toSeg(s);
    if (!map.has(dateStr)) map.set(dateStr, []);
    map.get(dateStr)!.push(seg);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, segs]) => {
      const sorted = segs.sort((a, b) => a.startHr - b.startHr);
      return {
        day,
        segs: sorted,
        totalMin: sorted.reduce((sum, x) => sum + x.durMin, 0),
        count: sorted.length,
      };
    });
}

/** 时间轴范围：包住所有区间，两端各留 1 小时余量（跨午夜时 endHr 可 >24） */
export function axisRange(days: HabitDay[]) {
  if (!days.length) return { startHr: 8, endHr: 24, hrs: 16 };
  let minHr = Infinity;
  let maxHr = -Infinity;
  for (const d of days) {
    for (const s of d.segs) {
      if (s.startHr < minHr) minHr = s.startHr;
      if (s.endHr > maxHr) maxHr = s.endHr;
    }
  }
  const start = Math.max(0, Math.floor(minHr) - 1);
  const end = Math.min(48, Math.ceil(maxHr) + 1);
  return { startHr: start, endHr: end, hrs: Math.max(1, end - start) };
}

/** 最长连续天数（按有练习的自然日计算） */
export function longestStreak(days: HabitDay[]): number {
  if (!days.length) return 0;
  let best = 1;
  let cur = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1].day + 'T00:00:00Z').getTime();
    const thisD = new Date(days[i].day + 'T00:00:00Z').getTime();
    const gapDays = Math.round((thisD - prev) / 86400000);
    if (gapDays === 1) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 1;
    }
  }
  return best;
}

export interface HabitStats {
  totalMin: number;
  count: number;
  avgMin: number;
  maxMin: number;
  maxDay: string;
  streak: number;
  dayCount: number;
}

export function computeStats(days: HabitDay[]): HabitStats | null {
  if (!days.length) return null;
  let totalMin = 0;
  let count = 0;
  let maxMin = -1;
  let maxDay = days[0].day;
  for (const d of days) {
    totalMin += d.totalMin;
    count += d.count;
    if (d.totalMin > maxMin) {
      maxMin = d.totalMin;
      maxDay = d.day;
    }
  }
  return {
    totalMin,
    count,
    avgMin: count ? Math.round(totalMin / count) : 0,
    maxMin: Math.max(maxMin, 0),
    maxDay,
    streak: longestStreak(days),
    dayCount: days.length,
  };
}

/** 分钟 → '1h 30m' */
export function fmtHM(min: number): string {
  if (!min || min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

/** 小时数 → '20:30'（用于 tooltip 区间；>24 显示次日） */
export function fmtClock(hr: number): string {
  const abs = ((hr % 24) + 24) % 24;
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  const nextDay = hr >= 24 ? '⁺¹' : '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${nextDay}`;
}
