/**
 * 音乐偏好分析引擎
 * 纯前端计算：统计 + 标签分析 + 异常检测 + 声线分析
 * 设计为可复用于音乐场景
 */

// ── 常量 ──
const LIKABILITY_LABELS = ['', '拉完了', 'NPC', '人上人', '顶级', '夯'];

// ── 输入类型 ──
export interface MusicAnalysisItem {
  id: string;
  title: string;
  artist: string;
  tags: string[];
  likability: number;   // 1-5
  singability: number;  // 1-5
  voice?: string;       // male / female / duet
  playCount: number;
}

// ── 预处理 ──
interface ParsedMusic {
  id: string;
  title: string;
  artist: string;
  artists: string[];  // split by " / "
  tags: string[];
  likability: number;
  singability: number;
  voice: string | null;
  playCount: number;
  tagVector: Float64Array;
}

export function parseMusicData(items: MusicAnalysisItem[]) {
  const allTagsSet = new Set<string>();
  for (const m of items) {
    for (const t of m.tags) allTagsSet.add(t);
  }
  const allTags = [...allTagsSet].sort();
  const tagIdx = new Map<string, number>();
  allTags.forEach((t, i) => tagIdx.set(t, i));

  const parsed: ParsedMusic[] = [];
  for (const m of items) {
    if (!m.likability || m.tags.length === 0) continue;
    const vec = new Float64Array(allTags.length);
    for (const t of m.tags) {
      const idx = tagIdx.get(t);
      if (idx !== undefined) vec[idx] = 1;
    }
    parsed.push({
      id: m.id,
      title: m.title,
      artist: m.artist,
      artists: m.artist.split(' / ').map(s => s.trim()).filter(Boolean),
      tags: m.tags,
      likability: m.likability,
      singability: m.singability || 0,
      voice: m.voice || null,
      playCount: m.playCount || 0,
      tagVector: vec,
    });
  }
  return { parsed, allTags, tagIdx };
}

export function computeStats(parsed: ParsedMusic[]) {
  const likeCounts: Record<number, number> = {};
  const singCounts: Record<number, number> = {};
  const voiceCounts: Record<string, number> = {};

  for (const p of parsed) {
    likeCounts[p.likability] = (likeCounts[p.likability] || 0) + 1;
    if (p.singability) singCounts[p.singability] = (singCounts[p.singability] || 0) + 1;
    if (p.voice) voiceCounts[p.voice] = (voiceCounts[p.voice] || 0) + 1;
  }
  return {
    total: parsed.length,
    avgLikability: parsed.reduce((s, p) => s + p.likability, 0) / parsed.length,
    avgSingability: parsed.filter(p => p.singability > 0).reduce((s, p) => s + p.singability, 0) / Math.max(parsed.filter(p => p.singability > 0).length, 1),
    likeCounts,
    singCounts,
    voiceCounts,
  };
}

// ── 标签组合默契度（喜欢度） ──
export interface TagComboResult {
  tags: string[];
  matrix: number[][];
  counts: number[][];
}

export function computeTagComboMatrix(parsed: ParsedMusic[], allTags: string[], tagIdx: Map<string, number>, topN = 12): TagComboResult {
  const n = allTags.length;
  const tagFreqs = new Float64Array(n);
  for (const p of parsed) {
    for (let j = 0; j < n; j++) { if (p.tagVector[j] > 0) tagFreqs[j]++; }
  }
  const order = [...Array(n).keys()].filter(i => tagFreqs[i] >= 3).sort((a, b) => tagFreqs[b] - tagFreqs[a]);
  const topIdx = order.slice(0, topN);
  const K = topIdx.length;
  const tags = topIdx.map(i => allTags[i]);
  const matrix: number[][] = Array.from({ length: K }, () => Array(K).fill(NaN));
  const counts: number[][] = Array.from({ length: K }, () => Array(K).fill(0));

  for (let ri = 0; ri < K; ri++) {
    for (let ci = 0; ci < K; ci++) {
      if (ri === ci) continue;
      const idxI = topIdx[ri], idxJ = topIdx[ci];
      let s = 0, c = 0;
      for (const p of parsed) {
        if (p.tagVector[idxI] > 0 && p.tagVector[idxJ] > 0) { s += p.likability; c++; }
      }
      counts[ri][ci] = c;
      if (c >= 2) matrix[ri][ci] = s / c;
    }
  }
  return { tags, matrix, counts };
}

// ── 标签 × 喜欢度热力图 ──
export interface TagRatingResult {
  tags: string[];
  ratings: string[];
  counts: number[][];
}

export function computeTagLikeHeatmap(parsed: ParsedMusic[], allTags: string[], tagIdx: Map<string, number>): TagRatingResult {
  const n = allTags.length, J = 5;
  const counts = Array.from({ length: n }, () => new Float64Array(J));
  const total = new Float64Array(n);

  for (const p of parsed) {
    const ri = p.likability - 1;
    if (ri < 0 || ri >= J) continue;
    for (let j = 0; j < n; j++) {
      if (p.tagVector[j] > 0) { counts[j][ri]++; total[j]++; }
    }
  }

  const valid = [...Array(n).keys()].filter(i => total[i] >= 2);
  valid.sort((a, b) => total[b] - total[a]);
  const show = valid.slice(0, 15);
  return {
    tags: show.map(i => allTags[i]),
    ratings: LIKABILITY_LABELS.slice(1),
    counts: show.map(i => Array.from(counts[i]) as number[]),
  };
}

// ── 标签 × 能唱度热力图 ──
export function computeTagSingHeatmap(parsed: ParsedMusic[], allTags: string[], tagIdx: Map<string, number>): TagRatingResult {
  const n = allTags.length, J = 5;
  const counts = Array.from({ length: n }, () => new Float64Array(J));
  const total = new Float64Array(n);

  for (const p of parsed) {
    if (!p.singability) continue;
    const ri = p.singability - 1;
    if (ri < 0 || ri >= J) continue;
    for (let j = 0; j < n; j++) {
      if (p.tagVector[j] > 0) { counts[j][ri]++; total[j]++; }
    }
  }

  const valid = [...Array(n).keys()].filter(i => total[i] >= 2);
  valid.sort((a, b) => total[b] - total[a]);
  const show = valid.slice(0, 15);
  return {
    tags: show.map(i => allTags[i]),
    ratings: LIKABILITY_LABELS.slice(1),
    counts: show.map(i => Array.from(counts[i]) as number[]),
  };
}

// ── 标签影响力 (喜欢度) ──
export interface InfluenceResult {
  tag: string;
  net: number; chi2: number; p: number; freq: number;
}

export function computeInfluence(parsed: ParsedMusic[], allTags: string[], tagIdx: Map<string, number>): InfluenceResult[] {
  const results: InfluenceResult[] = [], J = 5;
  const ratings = Array.from({ length: J }, (_, i) => i + 1);

  for (let j = 0; j < allTags.length; j++) {
    const freq = parsed.filter(p => p.tagVector[j] > 0).length;
    if (freq < 3) continue;

    const obs = [new Float64Array(J), new Float64Array(J)];
    for (const p of parsed) {
      const ri = p.likability - 1;
      if (ri < 0 || ri >= J) continue;
      obs[p.tagVector[j] > 0 ? 0 : 1][ri]++;
    }

    const rowSums = obs.map(r => r.reduce((a, b) => a + b, 0));
    const colSums = Array.from({ length: J }, (_, ci) => obs[0][ci] + obs[1][ci]);
    const total = rowSums.reduce((a, b) => a + b, 0);
    if (total < 10) continue;

    let chi2 = 0;
    for (let ri = 0; ri < 2; ri++) {
      for (let ci = 0; ci < J; ci++) {
        const expected = rowSums[ri] * colSums[ci] / total;
        if (expected > 0) chi2 += (obs[ri][ci] - expected) ** 2 / expected;
      }
    }

    const p = Math.exp(-chi2 * 0.45);
    const highPct = (obs[0][3] + obs[0][4]) / Math.max(rowSums[0], 1); // rate 4-5
    const lowPct = (obs[0][0] + obs[0][1]) / Math.max(rowSums[0], 1);  // rate 1-2
    const net = highPct - lowPct;

    results.push({ tag: allTags[j], net, chi2, p, freq });
  }
  results.sort((a, b) => b.net - a.net);
  return results;
}

// ── 评分反常歌曲 ──
export interface AnomalyResult {
  id: string;
  title: string;
  artist: string;
  score: number;
  ratingLabel: string;
  expected: number;
  diff: number;
  tags: string[];
}

export function computeAnomalies(parsed: ParsedMusic[], allTags: string[], tagIdx: Map<string, number>): AnomalyResult[] {
  const n = allTags.length;
  const tagAvgs = new Float64Array(n);

  for (let j = 0; j < n; j++) {
    let s = 0, c = 0;
    for (const p of parsed) {
      if (p.tagVector[j] > 0) { s += p.likability; c++; }
    }
    tagAvgs[j] = c >= 3 ? s / c : NaN;
  }

  // artist-level averages
  const artistAvgs = new Map<string, { sum: number; count: number }>();
  for (const p of parsed) {
    for (const a of p.artists) {
      const entry = artistAvgs.get(a) || { sum: 0, count: 0 };
      entry.sum += p.likability;
      entry.count++;
      artistAvgs.set(a, entry);
    }
  }

  const anomalies: AnomalyResult[] = [];
  for (const p of parsed) {
    // tag-based expected
    let sumTags = 0, countTags = 0;
    for (let j = 0; j < n; j++) {
      if (p.tagVector[j] > 0 && !isNaN(tagAvgs[j])) { sumTags += tagAvgs[j]; countTags++; }
    }
    const tagExpected = countTags > 0 ? sumTags / countTags : null;

    // artist-based expected
    let sumArtist = 0, countArtist = 0;
    for (const a of p.artists) {
      const entry = artistAvgs.get(a);
      if (entry && entry.count >= 3) { sumArtist += entry.sum / entry.count; countArtist++; }
    }
    const artistExpected = countArtist > 0 ? sumArtist / countArtist : null;

    // combine
    let expected: number;
    if (tagExpected !== null && artistExpected !== null) {
      expected = (tagExpected + artistExpected) / 2;
    } else if (tagExpected !== null) {
      expected = tagExpected;
    } else if (artistExpected !== null) {
      expected = artistExpected;
    } else {
      continue;
    }

    const diff = p.likability - expected;
    anomalies.push({
      id: p.id,
      title: p.title,
      artist: p.artist,
      score: p.likability,
      ratingLabel: LIKABILITY_LABELS[p.likability] || '',
      expected,
      diff,
      tags: p.tags,
    });
  }
  anomalies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return anomalies;
}

// ── 最喜欢的标签 ──
export interface FavoriteTagResult {
  tag: string;
  importance: number;
  avgScore: number;
  freq: number;
}

export function computeFavoriteTags(parsed: ParsedMusic[], allTags: string[], tagIdx: Map<string, number>): FavoriteTagResult[] {
  const results: FavoriteTagResult[] = [];
  for (let j = 0; j < allTags.length; j++) {
    let s = 0, c = 0;
    for (const p of parsed) {
      if (p.tagVector[j] > 0) { s += p.likability; c++; }
    }
    if (c >= 3) {
      const avg = s / c;
      results.push({ tag: allTags[j], importance: avg * Math.log(c + 1), avgScore: avg, freq: c });
    }
  }
  results.sort((a, b) => b.importance - a.importance);
  return results;
}

// ── 声线分析 ──
export interface VoiceAnalysis {
  voice: string;
  label: string;
  count: number;
  avgLike: number;
  avgSing: number;
  topTags: { tag: string; freq: number }[];
}

export function computeVoiceAnalysis(parsed: ParsedMusic[], allTags: string[], tagIdx: Map<string, number>): VoiceAnalysis[] {
  const voices = ['male', 'female', 'duet'];
  const labels: Record<string, string> = { male: '♂ 男声', female: '♀ 女声', duet: '♪ 男女' };

  return voices.map(v => {
    const members = parsed.filter(p => p.voice === v);
    const avgLike = members.length > 0 ? members.reduce((s, p) => s + p.likability, 0) / members.length : 0;
    const singMembers = members.filter(p => p.singability > 0);
    const avgSing = singMembers.length > 0 ? singMembers.reduce((s, p) => s + p.singability, 0) / singMembers.length : 0;

    const tagFreqs = new Map<string, number>();
    for (const p of members) {
      for (const t of p.tags) tagFreqs.set(t, (tagFreqs.get(t) || 0) + 1);
    }
    const topTags = [...tagFreqs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([tag, freq]) => ({ tag, freq }));

    return { voice: v, label: labels[v], count: members.length, avgLike, avgSing, topTags };
  }).filter(v => v.count > 0);
}

// ── 歌手影响力 ──
export interface ArtistInfluence {
  artist: string;
  count: number;
  avgLike: number;
  avgSing: number;
  topTags: string[];
}

// ── 标签影响力 (能唱度) ──
export function computeInfluenceSingability(parsed: ParsedMusic[], allTags: string[], tagIdx: Map<string, number>): InfluenceResult[] {
  const results: InfluenceResult[] = [], J = 5;
  const singParsed = parsed.filter(p => p.singability > 0);
  if (singParsed.length < 10) return results;

  for (let j = 0; j < allTags.length; j++) {
    const freq = singParsed.filter(p => p.tagVector[j] > 0).length;
    if (freq < 3) continue;

    const obs = [new Float64Array(J), new Float64Array(J)];
    for (const p of singParsed) {
      const ri = p.singability - 1;
      if (ri < 0 || ri >= J) continue;
      obs[p.tagVector[j] > 0 ? 0 : 1][ri]++;
    }

    const rowSums = obs.map(r => r.reduce((a, b) => a + b, 0));
    const colSums = Array.from({ length: J }, (_, ci) => obs[0][ci] + obs[1][ci]);
    const total = rowSums.reduce((a, b) => a + b, 0);
    if (total < 10) continue;

    let chi2 = 0;
    for (let ri = 0; ri < 2; ri++) {
      for (let ci = 0; ci < J; ci++) {
        const expected = rowSums[ri] * colSums[ci] / total;
        if (expected > 0) chi2 += (obs[ri][ci] - expected) ** 2 / expected;
      }
    }
    const p = Math.exp(-chi2 * 0.45);
    const highPct = (obs[0][3] + obs[0][4]) / Math.max(rowSums[0], 1);
    const lowPct = (obs[0][0] + obs[0][1]) / Math.max(rowSums[0], 1);
    results.push({ tag: allTags[j], net: highPct - lowPct, chi2, p, freq });
  }
  results.sort((a, b) => b.net - a.net);
  return results;
}

// ── 评分反常歌曲 (能唱度) ──
export function computeAnomaliesSingability(parsed: ParsedMusic[], allTags: string[], tagIdx: Map<string, number>): AnomalyResult[] {
  const n = allTags.length;
  const singParsed = parsed.filter(p => p.singability > 0);
  const tagAvgs = new Float64Array(n);

  for (let j = 0; j < n; j++) {
    let s = 0, c = 0;
    for (const p of singParsed) {
      if (p.tagVector[j] > 0) { s += p.singability; c++; }
    }
    tagAvgs[j] = c >= 3 ? s / c : NaN;
  }

  // artist-level averages for singability
  const artistAvgs = new Map<string, { sum: number; count: number }>();
  for (const p of singParsed) {
    for (const a of p.artists) {
      const entry = artistAvgs.get(a) || { sum: 0, count: 0 };
      entry.sum += p.singability;
      entry.count++;
      artistAvgs.set(a, entry);
    }
  }

  const anomalies: AnomalyResult[] = [];
  for (const p of singParsed) {
    // tag-based expected
    let sumTags = 0, countTags = 0;
    for (let j = 0; j < n; j++) {
      if (p.tagVector[j] > 0 && !isNaN(tagAvgs[j])) { sumTags += tagAvgs[j]; countTags++; }
    }
    const tagExpected = countTags > 0 ? sumTags / countTags : null;

    // artist-based expected
    let sumArtist = 0, countArtist = 0;
    for (const a of p.artists) {
      const entry = artistAvgs.get(a);
      if (entry && entry.count >= 3) { sumArtist += entry.sum / entry.count; countArtist++; }
    }
    const artistExpected = countArtist > 0 ? sumArtist / countArtist : null;

    let expected: number;
    if (tagExpected !== null && artistExpected !== null) {
      expected = (tagExpected + artistExpected) / 2;
    } else if (tagExpected !== null) {
      expected = tagExpected;
    } else if (artistExpected !== null) {
      expected = artistExpected;
    } else {
      continue;
    }

    const diff = p.singability - expected;
    anomalies.push({
      id: p.id,
      title: p.title, artist: p.artist,
      score: p.singability,
      ratingLabel: LIKABILITY_LABELS[p.singability] || '',
      expected, diff, tags: p.tags,
    });
  }
  anomalies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return anomalies;
}

// ── 最能唱的标签 ──
export function computeFavoriteTagsSingability(parsed: ParsedMusic[], allTags: string[], tagIdx: Map<string, number>): FavoriteTagResult[] {
  const results: FavoriteTagResult[] = [];
  for (let j = 0; j < allTags.length; j++) {
    let s = 0, c = 0;
    for (const p of parsed) {
      if (p.tagVector[j] > 0 && p.singability > 0) { s += p.singability; c++; }
    }
    if (c >= 3) {
      const avg = s / c;
      results.push({ tag: allTags[j], importance: avg * Math.log(c + 1), avgScore: avg, freq: c });
    }
  }
  results.sort((a, b) => b.importance - a.importance);
  return results;
}

// ── 歌手排名构建（拆分多人合作，每人独立计算）──
function buildArtistStats(parsed: ParsedMusic[]) {
  const byArtist = new Map<string, ParsedMusic[]>();
  for (const p of parsed) {
    if (!p.artists || p.artists.length === 0) continue;
    for (const a of p.artists) {
      if (!a) continue;
      if (!byArtist.has(a)) byArtist.set(a, []);
      byArtist.get(a)!.push(p);
    }
  }
  return byArtist;
}

// ── 最喜欢的歌手 (喜欢度加权) ──
export function computeFavoriteArtists(parsed: ParsedMusic[], minSongs = 2): ArtistInfluence[] {
  const byArtist = buildArtistStats(parsed);
  const results: ArtistInfluence[] = [];
  for (const [artist, songs] of byArtist) {
    if (songs.length < minSongs) continue;
    const avgLike = songs.reduce((s, p) => s + p.likability, 0) / songs.length;
    const singSongs = songs.filter(p => p.singability > 0);
    const avgSing = singSongs.length > 0 ? singSongs.reduce((s, p) => s + p.singability, 0) / singSongs.length : 0;
    const tagFreqs = new Map<string, number>();
    for (const p of songs) { for (const t of p.tags) tagFreqs.set(t, (tagFreqs.get(t) || 0) + 1); }
    results.push({
      artist, count: songs.length, avgLike, avgSing,
      topTags: [...tagFreqs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]),
    });
  }
  results.sort((a, b) => b.avgLike - a.avgLike);
  return results;
}

// ── 最拟合的歌手 (能唱度加权) ──
export function computeSingableArtists(parsed: ParsedMusic[], minSongs = 2): ArtistInfluence[] {
  const byArtist = buildArtistStats(parsed);
  const results: ArtistInfluence[] = [];
  for (const [artist, songs] of byArtist) {
    if (songs.length < minSongs) continue;
    const singSongs = songs.filter(p => p.singability > 0);
    if (singSongs.length < minSongs) continue;
    const avgLike = songs.reduce((s, p) => s + p.likability, 0) / songs.length;
    const avgSing = singSongs.reduce((s, p) => s + p.singability, 0) / singSongs.length;
    const tagFreqs = new Map<string, number>();
    for (const p of songs) { for (const t of p.tags) tagFreqs.set(t, (tagFreqs.get(t) || 0) + 1); }
    results.push({
      artist, count: songs.length, avgLike, avgSing,
      topTags: [...tagFreqs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]),
    });
  }
  results.sort((a, b) => b.avgSing - a.avgSing);
  return results;
}


// ── 主入口 ──
export function runFullAnalysis(items: MusicAnalysisItem[]) {
  const { parsed, allTags, tagIdx } = parseMusicData(items);
  const stats = computeStats(parsed);

  return {
    stats, parsed, allTags, tagIdx,
    tagLike: () => computeTagLikeHeatmap(parsed, allTags, tagIdx),
    tagSing: () => computeTagSingHeatmap(parsed, allTags, tagIdx),
    influence: () => computeInfluence(parsed, allTags, tagIdx),
    influenceSing: () => computeInfluenceSingability(parsed, allTags, tagIdx),
    anomalies: () => computeAnomalies(parsed, allTags, tagIdx),
    anomaliesSing: () => computeAnomaliesSingability(parsed, allTags, tagIdx),
    favoriteTags: () => computeFavoriteTags(parsed, allTags, tagIdx),
    favoriteTagsSing: () => computeFavoriteTagsSingability(parsed, allTags, tagIdx),
    voiceAnalysis: () => computeVoiceAnalysis(parsed, allTags, tagIdx),
    favoriteArtists: () => computeFavoriteArtists(parsed),
    singableArtists: () => computeSingableArtists(parsed),
  };
}
