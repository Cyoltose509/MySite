/** Shared sleep utilities: colors, labels, timezone conversion */

export const TYPE_LABELS: Record<string, string> = {
  in_bed: '卧床', asleep_core: '核心', asleep_deep: '深度',
  asleep_rem: 'REM', asleep_awake: '清醒', asleep_unspecified: '睡眠',
};

export const TYPE_COLORS: Record<string, string> = {
  in_bed: '#7c3aed', asleep_core: '#2563eb', asleep_deep: '#059669',
  asleep_rem: '#db2777', asleep_awake: '#d97706', asleep_unspecified: '#6366f1',
};

interface SleepSegment {
  id?: string; start_date: string; end_date: string;
  sleep_type: string; duration_minutes: number;
}

/** UTC ISO → { beijingHr: 0–24, beijingDateStr: '2026-06-30' } */
export function utcToBeijing(utcIso: string) {
  const d = new Date(utcIso);
  const bj = d.getTime() + 8 * 3600 * 1000;
  const h = (bj % 86400000) / 3600000;
  const bd = new Date(bj);
  const y = bd.getUTCFullYear(), m = String(bd.getUTCMonth() + 1).padStart(2, '0'), day = String(bd.getUTCDate()).padStart(2, '0');
  return { beijingHr: h, beijingDateStr: `${y}-${m}-${day}` };
}

/** Group segments by Beijing date */
export function groupByDay(segments: SleepSegment[]) {
  const days = new Map<string, { segs: SleepSegment[]; asleepMin: number }>();
  for (const s of segments) {
    const { beijingDateStr } = utcToBeijing(s.start_date);
    if (!days.has(beijingDateStr)) days.set(beijingDateStr, { segs: [], asleepMin: 0 });
    const day = days.get(beijingDateStr)!;
    day.segs.push(s);
    if (s.sleep_type !== 'in_bed') day.asleepMin += s.duration_minutes;
  }
  // Sort by date ascending
  return [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, ...v }));
}

/** Parse sleep records into a full-day timeline (18:00–18:00 next day, Beijing) */
export function buildTimeline(segments: SleepSegment[]) {
  if (segments.length === 0) return { axisStart: 18, axisEnd: 42, bars: [] as { type: string; x: number; w: number; min: number }[] };

  // Like /sleep: adjust Beijing hours so 18:00 is base, anything before gets +24
  function adjHr(utc: string) {
    const { beijingHr } = utcToBeijing(utc);
    return beijingHr >= 18 ? beijingHr : beijingHr + 24;
  }

  let minH = 48, maxH = 0;
  for (const s of segments) {
    const sh = adjHr(s.start_date);
    const eh = adjHr(s.end_date);
    if (sh < minH) minH = sh;
    if (eh > maxH) maxH = eh;
  }

  const axisStart = Math.max(0, Math.floor(minH) - 1);
  const axisEnd = Math.min(48, Math.ceil(maxH) + 1);
  const axisH = axisEnd - axisStart;

  const bars = segments.map(s => {
    const sh = adjHr(s.start_date);
    const eh = adjHr(s.end_date);
    return {
      type: s.sleep_type,
      x: ((sh - axisStart) / axisH) * 100,
      w: Math.max(((eh - sh) / axisH) * 100, 0.3),
      min: s.duration_minutes,
    };
  });

  return { axisStart, axisEnd, bars };
}
