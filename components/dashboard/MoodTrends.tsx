'use client';

import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

interface MoodRecord {
  mood: string;
  created_at: string;
}

export function MoodTrends({ data }: { data: MoodRecord[] }) {
  const moodMap: Record<string, number> = {
    '😊': 5, '😄': 5, '开心': 5, '快乐': 5, 'happy': 5,
    '😐': 3, '平静': 3, 'calm': 3, '一般': 3,
    '😢': 1, '😞': 1, '难过': 1, 'sad': 1,
  };

  const trendData = data
    .map((item) => ({
      date: item.created_at?.slice(0, 10) || '',
      mood: item.mood,
      score: moodMap[item.mood] || 3,
    }))
    .reverse();

  return (
    <div style={styles.card}>
      <h3 style={styles.h3}>🧠 心情趋势</h3>
      {trendData.length === 0 ? (
        <p style={styles.empty}>暂无数据</p>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
            />
            <YAxis
              domain={[0, 5]}
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
            <Line
              type="monotone"
              dataKey="score"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-accent)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
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
  empty: {
    color: 'var(--color-muted)',
    fontSize: 14,
    textAlign: 'center' as const,
    padding: 40,
  },
};
