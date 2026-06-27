/**
 * Shared card styles for music & anime pages
 * Both pages use the same visual language: cover as blurred background, overlay, content on top
 */

import type { CSSProperties } from 'react';

/* ── Colour tokens ── */
export const C = {
  bg:        '#0a0a14',
  surface:   '#121224',
  card:      '#16162a',
  border:    '#1e1e32',
  borderLit: '#27273d',
  text:      '#e4e4e7',
  textSec:   '#a1a1aa',
  textDim:   '#71717a',
  textDead:  '#52525b',
  accent:    '#6366f1',
  accentLt:  '#818cf8',
  red:       '#f87171',
  green:     '#4ade80',
  gold:      '#eab308',
  purple:    '#a855f7',
  gray:      '#6b7280',
} as const;

/* ── Shared layout ── */
export const pageStyle: CSSProperties = {
  minHeight: '100vh', maxWidth: 1100, margin: '0 auto', padding: '28px 20px 40px',
};

/* ── Card grid (5 columns) ── */
export const cardGridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10,
};

/* ── Card (cover as blurred background) ── */
export const cardStyle: CSSProperties = {
  position: 'relative', overflow: 'hidden', borderRadius: 12, cursor: 'pointer',
  transition: 'transform 0.15s, box-shadow 0.15s',
  border: '1px solid ' + C.border, minHeight: 120,
};

export const cardBgStyle = (url: string): CSSProperties => ({
  position: 'absolute', inset: 0,
  backgroundImage: `url(${url})`,
  backgroundSize: 'cover', backgroundPosition: 'center',
  filter: 'brightness(1) saturate(1)', transform: 'scale(1)',
  zIndex: 0,
});

export const cardOverlayStyle: CSSProperties = {
  position: 'absolute', inset: 0, zIndex: 1,
  background: 'linear-gradient(135deg, rgba(18,18,36,1) 0%, rgba(10,10,20,0.3) 100%)',
};

export const cardContentStyle: CSSProperties = {
  position: 'relative', zIndex: 2, padding: '10px 12px',
  display: 'flex', flexDirection: 'column', gap: 3,
};

/* ── Typography inside cards ── */
export const cardTitleStyle = (highlighted: boolean): CSSProperties => ({
  fontSize: 13, fontWeight: 600, color: highlighted ? C.accentLt : C.text, margin: 0, lineHeight: 1.3,
});

export const cardArtistStyle: CSSProperties = { fontSize: 11, color: C.textSec, margin: 0 };
export const cardAlbumStyle: CSSProperties  = { color: C.textDead };
export const cardDurationStyle: CSSProperties = { fontSize: 10, color: C.textDim };

/* ── Badges ── */
export const badgeStyle = (color: string): CSSProperties => ({
  fontSize: 10, padding: '2px 6px', borderRadius: 12, fontWeight: 500,
  background: color + '22', color,
});

/* ── Tag chips ── */
export const tagChipStyle: CSSProperties = {
  fontSize: 9, padding: '1px 6px', borderRadius: 10,
  background: 'rgba(30,30,50,0.7)', color: C.textSec,
};
export const tagMoreStyle: CSSProperties = { fontSize: 9, color: C.textDim };

/* ── Empty state ── */
export const emptyStyle: CSSProperties = {
  textAlign: 'center', color: C.textDead, fontSize: 13, padding: 48,
};

/* ── Header ── */
export const headerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8,
};
export const backLinkStyle: CSSProperties = { fontSize: 13, color: C.textDim, textDecoration: 'none' };
export const h1Style: CSSProperties = {
  fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, flex: 1,
};
export const countBadgeStyle: CSSProperties = {
  padding: '4px 14px', borderRadius: 20, background: C.card,
  border: '1px solid ' + C.borderLit, fontSize: 13, color: C.accentLt,
};

/* ── Controls / filters ── */
export const controlsStyle: CSSProperties = { marginBottom: 16 };
export const sourceNoteStyle: CSSProperties = { fontSize: 11, color: C.textDead, margin: '0 0 16px' };
export const filterRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
export const filterLabelStyle: CSSProperties = { fontSize: 12, color: C.textDead, fontWeight: 600 };
export const filterTabsStyle: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
export const filterTabStyle: CSSProperties = {
  padding: '5px 12px', borderRadius: 20,
  border: '1px solid rgba(255,255,255,0.16)',
  background: 'transparent', color: C.textSec, cursor: 'pointer', fontSize: 11,
  outline: 'none',
};
export const filterTabActiveStyle: CSSProperties = {
  ...filterTabStyle, background: C.accent, color: '#fff', borderColor: C.accent, fontWeight: 600,
};
export const tagCountStyle: CSSProperties = { fontSize: 10, color: '#ffffff99', marginLeft: 2 };
export const statsRowStyle: CSSProperties = { display: 'flex', gap: 10, fontSize: 12, color: C.textDim, marginTop: 4 };

/* ── Search input ── */
export const searchInputStyle: CSSProperties = {
  width: '100%', padding: '10px 16px', borderRadius: 12,
  border: '1px solid ' + C.border, background: C.surface, color: C.text,
  fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 12,
};

/* ── Modal (shared) ── */
export const modalOverlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
};
export const modalStyle: CSSProperties = {
  background: C.card, border: '1px solid #2a2a40', borderRadius: 24, padding: 36,
  maxWidth: 640, width: '92%', maxHeight: '85vh', overflowY: 'auto', position: 'relative',
};
export const modalCloseStyle: CSSProperties = {
  position: 'absolute', top: 20, right: 24,
  background: 'none', border: 'none', color: C.textDim, fontSize: 22, cursor: 'pointer',
};

/* ── Modal: cover placeholder ── */
export const modalCoverPlaceholderStyle = (size = 160): CSSProperties => ({
  width: size, height: size, borderRadius: 14, background: C.border,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 36, color: C.textDead, fontWeight: 700, flexShrink: 0,
});

/* ── Loading spinner ── */
export const loadingContainerStyle: CSSProperties = {
  minHeight: '80vh', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 16,
};
export const spinnerStyle: CSSProperties = {
  width: 36, height: 36, borderRadius: '50%',
  border: '3px solid ' + C.border, borderTopColor: C.accent,
  animation: 'spin 0.8s linear infinite',
};
export const loadingTextStyle: CSSProperties = { fontSize: 14, color: C.textSec, margin: 0 };

/* ── Error box ── */
export const errorBoxStyle: CSSProperties = {
  background: '#1e0a0a', border: '1px solid #7f1d1d', borderRadius: 12, padding: 24, marginTop: 24,
};
export const errorTitleStyle: CSSProperties = { fontSize: 16, color: C.red, fontWeight: 700, margin: '0 0 8px' };
export const errorMsgStyle: CSSProperties = { fontSize: 13, color: C.text, margin: '0 0 16px', lineHeight: 1.6 };
export const retryBtnStyle: CSSProperties = {
  padding: '8px 20px', borderRadius: 8, border: '1px solid ' + C.accent,
  background: 'transparent', color: C.accentLt, cursor: 'pointer', fontSize: 13,
};

/* ── Score bar (music detail modal) ── */
export const scoreRowStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20,
};
export const scoreBarContainerStyle: CSSProperties = {
  height: 10, background: C.border, borderRadius: 5, overflow: 'hidden', marginBottom: 6,
};
export const scoreLabelStyle: CSSProperties = { fontSize: 13, color: C.textSec, display: 'block', marginBottom: 6 };
export const scoreNumStyle: CSSProperties = { fontSize: 16, fontWeight: 700, color: C.text };
