/**
 * 游戏库偏好分析引擎
 * 分析维度：评级分布、游玩时长、标签影响力
 */

export interface GameAnalysisItem {
  id: string;
  title: string;
  playtime_forever: number;
  playtime_2weeks: number;
  rating?: string;
  tags: string[];
  note?: string;
}

// ── 评级分布 ──
export interface RatingDist {
  rating: string; count: number; totalPlaytime: number;
}
export function ratingDistribution(items: GameAnalysisItem[]): RatingDist[] {
  const map = new Map<string, { count: number; playtime: number }>();
  for (const item of items) {
    const r = item.rating || '未评级';
    const v = map.get(r) || { count: 0, playtime: 0 };
    v.count++;
    v.playtime += item.playtime_forever;
    map.set(r, v);
  }
  return [...map.entries()].map(([rating, v]) => ({ rating, count: v.count, totalPlaytime: v.playtime }));
}

// ── 最常玩的游戏 ──
export interface TopGame {
  title: string; playtime: number; rating?: string; tags: string[];
}
export function mostPlayed(items: GameAnalysisItem[], limit = 10): TopGame[] {
  return [...items].sort((a, b) => b.playtime_forever - a.playtime_forever).slice(0, limit).map(g => ({
    title: g.title,
    playtime: g.playtime_forever,
    rating: g.rating,
    tags: g.tags,
  }));
}

// ── 标签分布 ──
export interface TagCount { tag: string; count: number; avgPlaytime: number; }
export function tagDistribution(items: GameAnalysisItem[]): TagCount[] {
  const map = new Map<string, { count: number; totalPlaytime: number }>();
  for (const item of items) {
    for (const t of item.tags) {
      const v = map.get(t) || { count: 0, totalPlaytime: 0 };
      v.count++;
      v.totalPlaytime += item.playtime_forever;
      map.set(t, v);
    }
  }
  return [...map.entries()].map(([tag, v]) => ({
    tag, count: v.count, avgPlaytime: Math.round(v.totalPlaytime / v.count),
  })).sort((a, b) => b.count - a.count);
}

// ── 标签-评级 热力图 ──
export interface TagRatingCell {
  tag: string; rating: string; count: number;
}
export function tagRatingMatrix(items: GameAnalysisItem[]): { tags: string[]; ratings: string[]; cells: TagRatingCell[] } {
  const tags = new Map<string, Map<string, number>>();
  const ratingSet = new Set<string>();
  for (const item of items) {
    if (!item.rating) continue;
    ratingSet.add(item.rating);
    for (const t of item.tags) {
      if (!tags.has(t)) tags.set(t, new Map());
      const rm = tags.get(t)!;
      rm.set(item.rating, (rm.get(item.rating) || 0) + 1);
    }
  }
  const tagList = [...tags.keys()].sort();
  const ratingList = [...ratingSet].sort((a, b) => {
    const order: Record<string, number> = { '夯': 0, '顶级': 1, '人上人': 2, 'NPC': 3, '拉完了': 4 };
    return (order[a] ?? 99) - (order[b] ?? 99);
  });
  const cells: TagRatingCell[] = [];
  for (const tag of tagList) {
    const rm = tags.get(tag)!;
    for (const rating of ratingList) {
      cells.push({ tag, rating, count: rm.get(rating) || 0 });
    }
  }
  return { tags: tagList, ratings: ratingList, cells };
}
