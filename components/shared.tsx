'use client';

import {
  loadingContainerStyle, spinnerStyle, loadingTextStyle,
} from '@/lib/card-styles';

/* ── 加载状态 ── */
export function PageLoading({ text = '加载中...' }: { text?: string }) {
  return <div style={loadingContainerStyle}><div style={spinnerStyle} /><p style={loadingTextStyle}>{text}</p></div>;
}
