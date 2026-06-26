'use client';

import React from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';

interface AnimeRecord {
  id: string;
  title: string;
  status: string;
  rating: string;
}

export function AnimeStats({ data }: { data: AnimeRecord[] }) {
  const statusCounts: Record<string, number> = {};
  const ratingCounts: Record<string, number> = {};

  data.forEach((item) => {
    const s = item.status || '未知';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
    const r = item.rating || '未评分';
    ratingCounts[r] = (ratingCounts[r] || 0) + 1;
  });

  const statusData = Object.entries(statusCounts).map(([name, value]) => ({
    name,
    value,
  }));

  const ratingData = Object.entries(ratingCounts).map(([name, value]) => ({
    name,
    value,
  }));

  const COLORS = ['#6c63ff', '#ff6b6b', '#51cf66', '#ffd43b', '#339af0'];

  return (
    <div style={styles.card}>
      <h3 style={styles.h3}>🎬 番剧统计</h3>
      <div style={styles.chartRow}>
        <div style={styles.chartBox}>
          <p style={styles.chartLabel}>观看状态</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
              >
                {statusData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: 'var(--color-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  color: 'var(--color-text)',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={styles.chartBox}>
          <p style={styles.chartLabel}>评分分布</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={ratingData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
              >
                {ratingData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: 'var(--color-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  color: 'var(--color-text)',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
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
  chartRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  chartBox: {
    minHeight: 200,
  },
  chartLabel: {
    fontSize: 12,
    color: 'var(--color-muted)',
    margin: 0,
    marginBottom: 8,
    textAlign: 'center' as const,
  },
};
