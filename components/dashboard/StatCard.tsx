import React from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
}

export function StatCard({ label, value }: StatCardProps) {
  return (
    <div style={styles.card}>
      <p style={styles.label}>{label}</p>
      <p style={styles.value}>{value}</p>
      <div style={styles.glow} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#121224',
    border: '1px solid #1e1e32',
    borderRadius: 16,
    padding: 24,
    position: 'relative' as const,
    overflow: 'hidden',
    transition: 'border-color 0.2s, transform 0.15s',
  },
  label: {
    fontSize: 12,
    color: '#71717a',
    margin: 0,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 36,
    fontWeight: 800,
    color: '#fff',
    margin: 0,
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  glow: {
    position: 'absolute' as const,
    bottom: -20,
    right: -20,
    width: 80,
    height: 80,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)',
    pointerEvents: 'none' as const,
  },
};
