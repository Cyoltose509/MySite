// 位置展示/坐标的归一化逻辑：国家/省/市 → 对外展示名 + 地图坐标。
// 规则：国家为"中国"（或空）时对外不显示"中国"，只显示 市/省；选了其他国家则只显示国家。
import { cityCoord, type LngLat } from './china-cities';

export interface PlaceInput {
  country?: string | null;
  province?: string | null;
  city?: string | null;
}

/** 对外展示名：国内隐藏"中国"，优先市、其次省；国外显示国家 */
export function effectivePlace(r: PlaceInput): string {
  const isChina = !r.country || r.country === '中国';
  if (!isChina) return r.country as string;
  return (r.city && r.city.trim()) || (r.province && r.province.trim()) || '未知';
}

/** 地图坐标：[lng, lat] 或 null（无坐标则不画气泡） */
export function effectiveCoord(r: PlaceInput): LngLat | null {
  const isChina = !r.country || r.country === '中国';
  if (!isChina) return cityCoord(r.country as string);
  const c = (r.city && r.city.trim()) || '';
  if (c) {
    const cc = cityCoord(c);
    if (cc) return cc;
  }
  const p = (r.province && r.province.trim()) || '';
  return p ? cityCoord(p) : null;
}

// =====================================================
// 位置标签：家 / 学校 / 旅游 / 其他
// =====================================================
export const LOCATION_TAGS = ['家', '学校', '旅游', '其他'] as const;
export type LocationTag = (typeof LOCATION_TAGS)[number];

/** 标签 → 展示用的图标 + 颜色（用于地图信息框/列表徽标） */
export const TAG_META: Record<LocationTag, { icon: string; color: string }> = {
  家: { icon: '🏠', color: '#34d399' },
  学校: { icon: '🏫', color: '#60a5fa' },
  旅游: { icon: '✈️', color: '#f59e0b' },
  其他: { icon: '📌', color: '#a78bfa' },
};

export function tagMeta(tag: string | null | undefined): { icon: string; color: string; label: string } {
  const t = (LOCATION_TAGS as readonly string[]).includes(tag || '') ? (tag as LocationTag) : '其他';
  const m = TAG_META[t];
  return { icon: m.icon, color: m.color, label: t };
}
