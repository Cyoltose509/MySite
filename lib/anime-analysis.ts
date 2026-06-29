/**
 * 番剧偏好分析引擎
 * 纯前端计算：PCA + DBSCAN + 统计 + 异常检测
 * 设计为可复用于 /music 页面
 */

import type { AnimeItem } from './anime-data';

// ── 常量 ──
const RATING_SCORE: Record<string, number> = { '夯': 5, '顶级': 4, '人上人': 3, 'NPC': 2, '拉完了': 1 };
const RATING_ORDER = ['夯', '顶级', '人上人', 'NPC', '拉完了'];

// ── 预处理 ──
interface ParsedAnime {
  title: string;
  rating: string;
  ratingScore: number;
  tags: string[];
  watchStatus: string | null;
  tagVector: Float64Array;
  compositeScore: number;
}

export function parseAnimeData(items: AnimeItem[]) {
  const allTagsSet = new Set<string>();
  for (const a of items) {
    for (const t of a.tags) allTagsSet.add(t);
  }
  const allTags = [...allTagsSet].sort();
  const tagIdx = new Map<string, number>();
  allTags.forEach((t, i) => tagIdx.set(t, i));

  const parsed: ParsedAnime[] = [];
  for (const a of items) {
    if (!a.rating || !RATING_SCORE[a.rating]) continue;
    if (a.tags.length === 0) continue;
    const vec = new Float64Array(allTags.length);
    for (const t of a.tags) {
      const idx = tagIdx.get(t);
      if (idx !== undefined) vec[idx] = 1;
    }
    const watchMult = a.status === '中道崩殂' ? 0.7 : 1.0;
    parsed.push({
      title: a.title,
      rating: a.rating,
      ratingScore: RATING_SCORE[a.rating],
      tags: a.tags,
      watchStatus: a.status,
      tagVector: vec,
      compositeScore: RATING_SCORE[a.rating] * watchMult,
    });
  }
  return { parsed, allTags, tagIdx };
}

// ── 统计 ──
export function computeStats(parsed: ParsedAnime[]) {
  const ratingCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  for (const p of parsed) {
    ratingCounts[p.rating] = (ratingCounts[p.rating] || 0) + 1;
    if (p.watchStatus) statusCounts[p.watchStatus] = (statusCounts[p.watchStatus] || 0) + 1;
  }
  return {
    total: parsed.length,
    ratingCounts,
    statusCounts,
    avgScore: parsed.reduce((s, p) => s + p.compositeScore, 0) / parsed.length,
    dropped: statusCounts['中道崩殂'] || 0,
  };
}

// ── PCA (2 components, power iteration) ──
export function computePCA(parsed: ParsedAnime[], allTags: string[], nComponents = 2) {
  const n = parsed.length;
  const d = allTags.length;
  if (n < 3 || d < 2) return { points: parsed.map(() => [0, 0] as [number, number]), explained: 0 };

  // Build data matrix
  const X = new Float64Array(n * d);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      X[i * d + j] = parsed[i].tagVector[j];
    }
  }

  // Center
  const mean = new Float64Array(d);
  for (let j = 0; j < d; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i * d + j];
    mean[j] = s / n;
  }

  // Standardize (divide by std)
  const std = new Float64Array(d);
  for (let j = 0; j < d; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const diff = X[i * d + j] - mean[j];
      s += diff * diff;
    }
    std[j] = Math.sqrt(s / n) || 1;
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      X[i * d + j] = (X[i * d + j] - mean[j]) / std[j];
    }
  }

  // Covariance matrix via power iteration
  const points: [number, number][] = [];
  const eigenvectors: number[][] = [];

  for (let comp = 0; comp < nComponents; comp++) {
    // Power iteration
    let v = new Float64Array(d);
    for (let j = 0; j < d; j++) v[j] = Math.random();

    for (let iter = 0; iter < 50; iter++) {
      const next = new Float64Array(d);
      // X^T X v = cov * v scaled
      for (let j = 0; j < d; j++) {
        let s = 0;
        for (let i = 0; i < n; i++) {
          let xiDotV = 0;
          for (let k = 0; k < d; k++) xiDotV += X[i * d + k] * v[k];
          s += X[i * d + j] * xiDotV;
        }
        next[j] = s / n;
      }

      // Deflate against previous eigenvectors
      for (const prev of eigenvectors) {
        let dot = 0;
        for (let j = 0; j < d; j++) dot += next[j] * prev[j];
        for (let j = 0; j < d; j++) next[j] -= dot * prev[j];
      }

      // Normalize
      let norm = 0;
      for (let j = 0; j < d; j++) norm += next[j] * next[j];
      norm = Math.sqrt(norm);
      if (norm < 1e-10) break;
      for (let j = 0; j < d; j++) next[j] /= norm;

      // Check convergence
      let diff = 0;
      for (let j = 0; j < d; j++) diff += (next[j] - v[j]) * (next[j] - v[j]);
      v = next;
      if (diff < 1e-8) break;
    }
    eigenvectors.push(Array.from(v));

    // Project
    if (comp === 0) points.length = 0;
    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let j = 0; j < d; j++) dot += X[i * d + j] * v[j];
      if (comp === 0) points.push([dot, 0]);
      else points[i][1] = dot;
    }
  }

  // Variance explained (approximate from eigenvalues)
  const totalVar = d; // standardized variables have variance 1 each
  let explainedVar = 0;
  for (const ev of eigenvectors) {
    let s = 0;
    for (const v of ev) s += v * v;
    explainedVar += s;
  }
  const explained = Math.min(explainedVar / totalVar, 1);

  // Scale to [-5, 5] range for display
  let maxVal = 0;
  for (const p of points) { maxVal = Math.max(maxVal, Math.abs(p[0]), Math.abs(p[1])); }
  const scale = maxVal > 0 ? 4 / maxVal : 1;
  for (const p of points) { p[0] *= scale; p[1] *= scale; }

  return { points, explained };
}

// ── DBSCAN ──
export function computeDBSCAN(
  points: [number, number][],
  eps = 0.8,
  minPts = 4
): { labels: Int32Array; nClusters: number; noise: number } {
  const n = points.length;
  const labels = new Int32Array(n).fill(-1);

  // Pre-compute neighbors
  const neighbors: number[][] = [];
  for (let i = 0; i < n; i++) {
    const nbr: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = points[i][0] - points[j][0];
      const dy = points[i][1] - points[j][1];
      if (dx * dx + dy * dy < eps * eps) nbr.push(j);
    }
    neighbors.push(nbr);
  }

  let clusterId = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue;
    if (neighbors[i].length < minPts) continue;
    // Expand cluster
    labels[i] = clusterId;
    const seeds = [...neighbors[i]];
    let k = 0;
    while (k < seeds.length) {
      const p = seeds[k];
      if (labels[p] === -1) {
        labels[p] = clusterId;
        if (neighbors[p].length >= minPts) {
          for (const q of neighbors[p]) {
            if (!seeds.includes(q) && labels[q] === -1) seeds.push(q);
          }
        }
      }
      k++;
    }
    clusterId++;
  }

  let noise = 0;
  for (let i = 0; i < n; i++) if (labels[i] === -1) noise++;

  return { labels, nClusters: clusterId, noise };
}

export function computeClusterInfo(
  parsed: ParsedAnime[],
  labels: Int32Array,
  nClusters: number,
  points: [number, number][],
  allTags: string[]
) {
  const info: { id: number; n: number; avg: number; topTags: string[]; cx: number; cy: number }[] = [];
  for (let cid = 0; cid < nClusters; cid++) {
    const members = parsed.filter((_, i) => labels[i] === cid);
    if (members.length === 0) continue;
    const n = members.length;
    const avg = members.reduce((s, p) => s + p.compositeScore, 0) / n;

    // Top tags in cluster
    const tagCounts = new Map<string, number>();
    for (const m of members) {
      for (const t of m.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
    const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);

    // Centroid
    let cx = 0, cy = 0;
    let cnt = 0;
    for (let i = 0; i < parsed.length; i++) {
      if (labels[i] === cid) { cx += points[i][0]; cy += points[i][1]; cnt++; }
    }
    info.push({ id: cid, n, avg, topTags, cx: cx / cnt, cy: cy / cnt });
  }
  return info;
}

// ── 标签组合默契度矩阵 ──
export interface TagComboResult {
  tags: string[];
  matrix: number[][];  // [i][j] = average compositeScore when both tags present
  counts: number[][];  // [i][j] = co-occurrence count
}

export function computeTagComboMatrix(
  parsed: ParsedAnime[],
  allTags: string[],
  tagIdx: Map<string, number>,
  topN = 12
): TagComboResult {
  const n = allTags.length;
  // Tag preference averages
  const tagMeans = new Float64Array(n);
  const tagFreqs = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let s = 0, c = 0;
    for (const p of parsed) {
      if (p.tagVector[j] > 0) { s += p.compositeScore; c++; }
    }
    tagMeans[j] = c >= 3 ? s / c : 0;
    tagFreqs[j] = c;
  }

  // Pick top tags by preference
  const order = [...Array(n).keys()].sort((a, b) => tagMeans[b] - tagMeans[a]);
  const topIdx = order.filter(i => tagFreqs[i] >= 5).slice(0, topN);

  const K = topIdx.length;
  const tags = topIdx.map(i => allTags[i]);
  const matrix: number[][] = Array.from({ length: K }, () => Array(K).fill(NaN));
  const counts: number[][] = Array.from({ length: K }, () => Array(K).fill(0));

  for (let ri = 0; ri < K; ri++) {
    for (let ci = 0; ci < K; ci++) {
      if (ri === ci) continue;
      const idxI = topIdx[ri];
      const idxJ = topIdx[ci];
      let s = 0, c = 0;
      for (const p of parsed) {
        if (p.tagVector[idxI] > 0 && p.tagVector[idxJ] > 0) { s += p.compositeScore; c++; }
      }
      counts[ri][ci] = c;
      if (c >= 3) matrix[ri][ci] = s / c;
    }
  }

  return { tags, matrix, counts };
}

// ── 标签×评级 热力图 ──
export interface TagRatingResult {
  tags: string[];
  ratings: string[];
  counts: number[][];  // [tag][rating]
}

export function computeTagRatingHeatmap(
  parsed: ParsedAnime[],
  allTags: string[],
  tagIdx: Map<string, number>,
  maxTags = 30
): TagRatingResult {
  const n = allTags.length;
  const counts = Array.from({ length: n }, () => new Float64Array(5));
  const total = new Float64Array(n);

  for (const p of parsed) {
    const ri = RATING_ORDER.indexOf(p.rating);
    if (ri < 0) continue;
    for (let j = 0; j < n; j++) {
      if (p.tagVector[j] > 0) { counts[j][ri]++; total[j]++; }
    }
  }

  // Filter and sort by total frequency
  const valid = [...Array(n).keys()].filter(i => total[i] >= 2);
  valid.sort((a, b) => total[b] - total[a]);

  const show = valid.slice(0, 15);
  return {
    tags: show.map(i => allTags[i]),
    ratings: RATING_ORDER,
    counts: show.map(i => Array.from(counts[i]) as number[]),
  };
}

// ── 弃坑率 ──
export interface DropRateResult {
  tag: string;
  rate: number;
  total: number;
  dropped: number;
}

export function computeDropRates(parsed: ParsedAnime[], allTags: string[], tagIdx: Map<string, number>, minCount = 3): DropRateResult[] {
  const results: DropRateResult[] = [];
  for (let j = 0; j < allTags.length; j++) {
    let total = 0, dropped = 0;
    for (const p of parsed) {
      if (p.tagVector[j] > 0) { total++; if (p.watchStatus === '中道崩殂') dropped++; }
    }
    if (total >= minCount) {
      results.push({ tag: allTags[j], rate: dropped / total, total, dropped });
    }
  }
  results.sort((a, b) => b.rate - a.rate);
  return results;
}

// ── 标签影响力 (chi-square) ──
export interface InfluenceResult {
  tag: string;
  net: number;    // high% - low%
  chi2: number;
  p: number;
  freq: number;
}

export function computeInfluence(parsed: ParsedAnime[], allTags: string[], tagIdx: Map<string, number>): InfluenceResult[] {
  const results: InfluenceResult[] = [];
  for (let j = 0; j < allTags.length; j++) {
    const freq = parsed.filter(p => p.tagVector[j] > 0).length;
    if (freq < 3) continue;

    // Observed table: [has tag, no tag] × [5 ratings]
    const obs = [new Float64Array(5), new Float64Array(5)];
    for (const p of parsed) {
      const ri = RATING_ORDER.indexOf(p.rating);
      if (ri < 0) continue;
      obs[p.tagVector[j] > 0 ? 0 : 1][ri]++;
    }

    // Chi-square
    const rowSums = obs.map(r => r.reduce((a, b) => a + b, 0));
    const colSums = Array.from({ length: 5 }, (_, ci) => obs[0][ci] + obs[1][ci]);
    const total = rowSums.reduce((a, b) => a + b, 0);
    let chi2 = 0;
    for (let ri = 0; ri < 2; ri++) {
      for (let ci = 0; ci < 5; ci++) {
        const expected = rowSums[ri] * colSums[ci] / total;
        if (expected > 0) chi2 += (obs[ri][ci] - expected) ** 2 / expected;
      }
    }

    // p-value approximation (chi-square with 4 df)
    const p = Math.exp(-chi2 * 0.45);

    // Net effect: high rating % - low rating %
    const highPct = (obs[0][0] + obs[0][1]) / Math.max(rowSums[0], 1);
    const lowPct = (obs[0][3] + obs[0][4]) / Math.max(rowSums[0], 1);
    const net = highPct - lowPct;

    results.push({ tag: allTags[j], net, chi2, p, freq });
  }
  results.sort((a, b) => b.net - a.net);
  return results;
}

// ── 时间趋势 ──
export interface TimeTrendResult {
  tag: string;
  series: { year: number; avgScore: number }[];
}

export function computeTimeTrends(
  parsed: ParsedAnime[],
  allTags: string[],
  tagIdx: Map<string, number>,
  topN = 8
): TimeTrendResult[] {
  // Get top tags by frequency
  const freqs = allTags.map((_, i) => parsed.filter(p => p.tagVector[i] > 0).length);
  const topIdx = freqs.map((f, i) => i).sort((a, b) => freqs[b] - freqs[a]).slice(0, topN);

  const results: TimeTrendResult[] = [];
  for (const idx of topIdx) {
    const byYear: Map<number, number[]> = new Map();
    for (const p of parsed) {
      if (p.tagVector[idx] === 0) continue;
      // Extract year from title (if present) or use body
      const yearMatch = p.title.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;
      if (!year || year < 2000 || year > 2030) continue;
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year)!.push(p.compositeScore);
    }
    const series = [...byYear.entries()]
      .map(([year, scores]) => ({ year, avgScore: scores.reduce((a, b) => a + b, 0) / scores.length }))
      .sort((a, b) => a.year - b.year);
    if (series.length >= 2) results.push({ tag: allTags[idx], series });
  }
  return results;
}

// ── 异常检测（评分反常的作品） ──
export interface AnomalyResult {
  title: string;
  score: number;
  rating: string;
  expected: number;
  diff: number;
  tags: string[];
}

export function computeAnomalies(parsed: ParsedAnime[], allTags: string[], tagIdx: Map<string, number>): AnomalyResult[] {
  const n = allTags.length;

  // Average score per tag
  const tagAvgs = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let s = 0, c = 0;
    for (const p of parsed) {
      if (p.tagVector[j] > 0) { s += p.compositeScore; c++; }
    }
    tagAvgs[j] = c >= 3 ? s / c : NaN;
  }

  // For each anime, compute expected score from its tags
  const anomalies: AnomalyResult[] = [];
  for (const p of parsed) {
    let sumAvgs = 0, countAvgs = 0;
    for (let j = 0; j < n; j++) {
      if (p.tagVector[j] > 0 && !isNaN(tagAvgs[j])) { sumAvgs += tagAvgs[j]; countAvgs++; }
    }
    if (countAvgs === 0) continue;
    const expected = sumAvgs / countAvgs;
    const diff = p.compositeScore - expected;
    anomalies.push({
      title: p.title,
      score: p.compositeScore,
      rating: p.rating,
      expected,
      diff,
      tags: p.tags,
    });
  }
  anomalies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return anomalies;
}

// ── 最喜欢的标签 (基于标签平均分 + 频次加权) ──
export interface FavoriteTagResult {
  tag: string;
  importance: number;
  avgScore: number;
  freq: number;
}

export function computeFavoriteTags(parsed: ParsedAnime[], allTags: string[], tagIdx: Map<string, number>): FavoriteTagResult[] {
  const results: FavoriteTagResult[] = [];
  for (let j = 0; j < allTags.length; j++) {
    let s = 0, c = 0;
    for (const p of parsed) {
      if (p.tagVector[j] > 0) { s += p.compositeScore; c++; }
    }
    if (c >= 3) {
      const avg = s / c;
      const importance = avg * Math.log(c + 1); // frequency-weighted score
      results.push({ tag: allTags[j], importance, avgScore: avg, freq: c });
    }
  }
  results.sort((a, b) => b.importance - a.importance);
  return results;
}

// ── 主入口：一键分析 ──
export function runFullAnalysis(items: AnimeItem[]) {
  const { parsed, allTags, tagIdx } = parseAnimeData(items);
  const stats = computeStats(parsed);

  return {
    stats, parsed, allTags, tagIdx,
    pca: () => computePCA(parsed, allTags),
    dbscan: (points: [number, number][]) => computeDBSCAN(points),
    clusterInfo: (labels: Int32Array, nClusters: number, points: [number, number][]) =>
      computeClusterInfo(parsed, labels, nClusters, points, allTags),
    tagCombo: () => computeTagComboMatrix(parsed, allTags, tagIdx),
    tagRating: () => computeTagRatingHeatmap(parsed, allTags, tagIdx),
    dropRates: () => computeDropRates(parsed, allTags, tagIdx),
    influence: () => computeInfluence(parsed, allTags, tagIdx),
    timeTrends: () => computeTimeTrends(parsed, allTags, tagIdx),
    anomalies: () => computeAnomalies(parsed, allTags, tagIdx),
    favoriteTags: () => computeFavoriteTags(parsed, allTags, tagIdx),
  };
}
