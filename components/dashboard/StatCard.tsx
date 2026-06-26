import React from 'react';

interface StatCardProps {
  label: string;
  value: number;
}

export function StatCard({ label, value }: StatCardProps) {
  return (
    <div style={styles.card}>
      <p style={styles.label}>{label}</p>
      <p style={styles.value}>{value}</p>
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
  label: {
    fontSize: 13,
    color: 'var(--color-muted)',
    margin: 0,
    marginBottom: 8,
  },
  value: {
    fontSize: 32,
    fontWeight: 700,
    color: 'var(--color-accent)',
    margin: 0,
  },
};
