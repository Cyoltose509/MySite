'use client';

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

interface MusicRecord {
  id: string;
  title: string;
  artist: string;
  play_count: number;
}

export function MusicStats({ data }: { data: MusicRecord[] }) {
  const topPlayed = [...data]
    .sort((a, b) => (b.play_count || 0) - (a.play_count || 0))
    .slice(0, 10)
    .map((item) => ({
      name: item.title.length > 10 ? item.title.slice(0, 10) + '...' : item.title,
      plays: item.play_count || 0,
    }));

  return (
    <div style={styles.card}>
      <h3 style={styles.h3}>🎵 音乐统计</h3>
      <div style={styles.chartBox}>
        <p style={styles.chartLabel}>播放次数 TOP 10</p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={topPlayed} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis type="number" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="name"
              width={100}
              tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-card)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                color: 'var(--color-text)',
              }}
            />
            <Bar dataKey="plays" fill="var(--color-accent)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: 24,
  },
  h3: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--color-text)',
    margin: 0,
    marginBottom: 16,
  },
  chartBox: {
    minHeight: 300,
  },
  chartLabel: {
    fontSize: 12,
    color: 'var(--color-muted)',
    margin: 0,
    marginBottom: 12,
  },
};
