'use client';

import { useState, useMemo, type ReactNode } from 'react';
import RankBoard from '@/components/rank/RankBoard';
import type { Domain } from '@/lib/rank';
import { C } from '@/lib/card-styles';

const TABS: { key: Domain; label: string; icon: string }[] = [
  { key: 'music_sing', label: '能唱度', icon: '🎤' },
  { key: 'music_like', label: '喜欢度', icon: '♥' },
];

export default function MusicRankPage() {
  const [view, setView] = useState<Domain>('music_sing');

  const tabBar = useMemo<ReactNode>(() => (
    <div style={{ display: 'flex', gap: 6 }}>
      {TABS.map((t) => {
        const active = t.key === view;
        return (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            style={{
              padding: '4px 14px', borderRadius: 20,
              border: `1px solid ${active ? C.accentLt : '#27273d'}`,
              background: active ? 'rgba(99,102,241,0.15)' : '#16162a',
              color: active ? C.accentLt : C.textSec, fontSize: 13, cursor: 'pointer',
            }}
          >
            {t.icon} {t.label}
          </button>
        );
      })}
    </div>
  ), [view]);

  const active = TABS.find((t) => t.key === view)!;

  return (
    <RankBoard
      key={view}
      domain={view}
      title={`音乐 · ${active.label} 从夯到拉`}
      icon={active.icon}
      backHref="/music"
      headerExtra={tabBar}
    />
  );
}
