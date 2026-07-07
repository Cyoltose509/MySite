'use client';

import { useState, useEffect, useRef } from 'react';

export interface SyncStep {
  phase: string;
  current: number;
  total: number;
  message: string;
}

interface SyncProgressModalProps {
  isOpen: boolean;
  steps: SyncStep[];
  onClose: () => void;
  error?: string | null;
}

export function SyncProgressModal({ isOpen, steps, onClose, error }: SyncProgressModalProps) {
  const [autoClose, setAutoClose] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const lastStep = steps[steps.length - 1];
  const isDone = lastStep?.phase === 'done' || !!error;

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps]);

  // Auto-close after success
  useEffect(() => {
    if (isDone && !error) {
      const timer = setTimeout(() => {
        setAutoClose(true);
        onClose();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isDone, error, onClose]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.titleRow}>
            {isDone && !error ? (
              <span style={styles.doneIcon}>✅</span>
            ) : error ? (
              <span style={styles.errorIcon}>❌</span>
            ) : (
              <span style={styles.spinner}>⏳</span>
            )}
            <h3 style={styles.title}>
              {error ? '同步出错' : isDone ? '同步完成' : '正在同步...'}
            </h3>
          </div>
          {!isDone || error ? (
            <button onClick={onClose} style={styles.closeBtn} title="关闭">
              ✕
            </button>
          ) : (
            <span style={styles.autoClose}>{autoClose ? '已自动关闭' : '2秒后关闭...'}</span>
          )}
        </div>

        {/* Progress bar */}
        {lastStep && lastStep.total > 0 && lastStep.phase !== 'done' && (
          <div style={styles.progressWrap}>
            <div style={styles.progressBg}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${Math.min(100, (lastStep.current / Math.max(lastStep.total, 1)) * 100)}%`,
                }}
              />
            </div>
            <span style={styles.progressText}>
              {lastStep.current} / {lastStep.total}
            </span>
          </div>
        )}

        {/* Log output */}
        <div ref={scrollRef} style={styles.logArea}>
          {steps.length === 0 && (
            <p style={styles.logLine}>等待开始...</p>
          )}
          {steps.map((step, i) => (
            <p key={i} style={{ ...styles.logLine, color: getPhaseColor(step.phase) }}>
              <span style={styles.timestamp}>
                [{new Date().toLocaleTimeString('zh-CN', { hour12: false })}]
              </span>{' '}
              {step.message}
            </p>
          ))}
          {error && (
            <p style={{ ...styles.logLine, ...styles.errorLine }}>
              ⚠️ 错误: {error}
            </p>
          )}
        </div>

        {/* Footer */}
        {(isDone || error) && (
          <div style={styles.footer}>
            {error && (
              <button onClick={onClose} style={styles.retryBtn}>
                关闭
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getPhaseColor(phase: string): string {
  switch (phase) {
    case 'done':
      return '#4ade80';
    case 'fetching':
      return '#60a5fa';
    case 'parsing':
      return '#fbbf24';
    case 'syncing':
      return '#a78bfa';
    default:
      return 'var(--color-muted)';
  }
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#1a1a2e',
    border: '1px solid #2d2d44',
    borderRadius: 16,
    width: '90%',
    maxWidth: 560,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #2d2d44',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  doneIcon: { fontSize: 20 },
  errorIcon: { fontSize: 20 },
  spinner: {
    fontSize: 18,
    animation: 'spin 1s linear infinite',
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e4e4e7',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#71717a',
    fontSize: 16,
    cursor: 'pointer',
    padding: 4,
    borderRadius: 6,
  },
  autoClose: {
    fontSize: 12,
    color: '#4ade80',
  },
  progressWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 20px',
    borderBottom: '1px solid #2d2d44',
  },
  progressBg: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    background: '#27273d',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: 11,
    color: '#71717a',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
  },
  logArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 20px',
    minHeight: 120,
    maxHeight: 300,
    fontFamily: '"Cascadia Code", "Fira Code", monospace',
    fontSize: 12,
    lineHeight: 1.8,
  },
  logLine: {
    margin: 0,
    padding: '2px 0',
  },
  timestamp: {
    color: '#52525b',
    marginRight: 8,
  },
  errorLine: {
    color: '#f87171',
    fontWeight: 500,
  },
  footer: {
    padding: '12px 20px',
    borderTop: '1px solid #2d2d44',
    textAlign: 'right',
  },
  retryBtn: {
    padding: '8px 24px',
    borderRadius: 8,
    border: 'none',
    background: '#ef4444',
    color: '#fff',
    fontSize: 13,
    cursor: 'pointer',
  },
};
