'use client';

import { TYPE_LABELS, TYPE_COLORS, buildTimeline } from '@/lib/sleep-utils';
import { C } from '@/lib/card-styles';

interface SleepSegment {
  id?: string; start_date: string; end_date: string;
  sleep_type: string; duration_minutes: number;
}

export function SleepTimeline({ segments }: { segments: SleepSegment[] }) {
  const { axisStart, axisEnd, bars } = buildTimeline(segments);
  if (bars.length === 0) return null;

  const inBed = segments.filter(s => s.sleep_type === 'in_bed').reduce((a, b) => a + (b.duration_minutes || 0), 0);
  const actualSleep = segments.filter(s => s.sleep_type !== 'in_bed').reduce((a, b) => a + (b.duration_minutes || 0), 0);

  const fmtHour = (h: number) => {
    const w = ((h % 24) + 24) % 24;
    return `${Math.floor(w).toString().padStart(2, '0')}:00`;
  };

  const ticks: number[] = [];
  for (let h = axisStart; h <= axisEnd; h++) ticks.push(h);
  const total = axisEnd - axisStart;

  return (
    <div style={{ padding: 12, borderRadius: 12, background: C.surface, border: '1px solid ' + C.border }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: C.textSec }}>
          {fmtHour(axisStart)} — {fmtHour(axisEnd)}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
          {inBed > 0 ? `${Math.floor(inBed / 60)}h${inBed % 60}m 卧床` : `${Math.floor(actualSleep / 60)}h${actualSleep % 60}m 睡眠`}
        </span>
      </div>

      {/* Time axis + bars */}
      <div style={{ position: 'relative', height: 42, marginLeft: 18, marginRight: 18 }}>
        {/* Axis line */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', paddingBottom: 8 }}>
          <div style={{ width: '100%', height: 1, background: '#2a2a3a' }} />
        </div>
        {/* Tick marks + labels */}
        {ticks.map(h => {
          const x = ((h - axisStart) / total) * 100;
          return (
            <div key={h} style={{ position: 'absolute', left: `${x}%`,  display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ marginTop: 12, width: 1, height: 6, background: '#3a3a4a' }} />
              <span style={{ marginTop: 2, fontSize: 9, color: '#52525b', whiteSpace: 'nowrap' }}>{fmtHour(h)}</span>
            </div>
          );
        })}
        {/* Bars */}
        <div style={{ position: 'absolute', inset: '0 0 50px 0', display: 'flex', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: '100%', height: 12 }}>
            {bars.map((b, i) => (
              <div key={i} style={{
                position: 'absolute', left: `${b.x}%`, width: `${b.w}%`, height: '100%',
                background: TYPE_COLORS[b.type] || '#4b5563', borderRadius: 3, opacity: 0.4,
              }} />
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
        {Object.entries(TYPE_COLORS).map(([k, v]) => {
          const min = segments.filter(s => s.sleep_type === k).reduce((a, b) => a + (b.duration_minutes || 0), 0);
          if (min === 0) return null;
          return (
            <span key={k} style={{ fontSize: 10, color: C.textDim }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, background: v, marginRight: 3, verticalAlign: 'middle' }} />
              {TYPE_LABELS[k]} {min}min
            </span>
          );
        })}
      </div>
    </div>
  );
}
