/**
 * Anime data module — direct GitHub fetch + localStorage cache
 * Cover images: pre-built JSON from anibk.com (fetch-covers.mjs) + runtime fallback
 */

const REPO = 'cyoltose509/my-anime-list';
const BRANCH = 'v4';
const TREE_API = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

const CACHE_KEY = 'datahub_anime_cache';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Pre-built cover URLs (generated at build time by scripts/fetch-covers.mjs)
const COVERS_JSON_PATH = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/anime-covers.json`;

export interface AnimeItem {
  title: string;
  status: string;
  rating?: string | null;
  tags: string[];
  source?: string;       // anibk URL from md frontmatter
  body?: string;         // md body content (after frontmatter, for detail page)
  filePath?: string;     // original file path in GitHub repo (for link back)
}

interface CacheData {
  timestamp: number;
  data: AnimeItem[];
}

/**
 * Parse anime Markdown file (Quartz YAML frontmatter)
 * Tags are a YAML list; status/rating are embedded as special tags:
 *   - 观看状态-看完  → status = "看完"
 *   - 评级-夯       → rating = "夯"
 * Also extracts source field and body text.
 */
function parseAnimeMarkdown(text: string, filepath: string): AnimeItem | null {
  const filename = filepath.split('/').pop() || '';
  let title = filename.replace(/\.md$/i, '').trim();

  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return { title, status: '未知', tags: [], filePath: filepath };
  }

  const fm = fmMatch[1];
  const body = text.slice(fmMatch[0].length).trim();

  // Extract title from frontmatter
  const titleMatch = fm.match(/^title:\s*(.+)/im);
  if (titleMatch) title = titleMatch[1].trim().replace(/^["']|["']$/g, '');

  // Extract source
  const sourceMatch = fm.match(/^source:\s*(.+)/im);
  const source = sourceMatch ? sourceMatch[1].trim().replace(/^["']|["']$/g, '') : undefined;

  // Parse tags: YAML list format
  const rawTags: string[] = [];
  const tagsSection = fm.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/im);
  if (tagsSection) {
    const tagLines = tagsSection[1].matchAll(/^\s+-\s+(.+)$/gm);
    for (const m of tagLines) {
      rawTags.push(m[1].trim());
    }
  }
  // Also check inline format: tags: [a, b, c]
  if (rawTags.length === 0) {
    const inlineTags = fm.match(/^tags:\s*\[(.+)\]/im);
    if (inlineTags) {
      inlineTags[1].split(',').forEach((t) => {
        const cleaned = t.trim().replace(/['"]/g, '');
        if (cleaned) rawTags.push(cleaned);
      });
    }
  }

  // Extract status/rating from special tag prefixes
  let status = '未知';
  let rating: string | null = null;
  const cleanTags: string[] = [];

  for (const tag of rawTags) {
    if (tag.startsWith('观看状态-')) {
      status = tag.replace('观看状态-', '');
    } else if (tag.startsWith('评级-')) {
      rating = tag.replace('评级-', '');
    } else if (tag.startsWith('记忆程度-')) {
      // skip
    } else {
      cleanTags.push(tag);
    }
  }

  return { title, status, rating, tags: cleanTags, source, body, filePath: filepath };
}

/**
 * Fetch all anime from GitHub, with localStorage caching.
 * On cache hit, returns immediately. Otherwise fetches tree + raw files.
 */
export async function getAnimeList(
  onProgress?: (current: number, total: number) => void
): Promise<AnimeItem[]> {
  // Check cache
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed: CacheData = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL) {
          onProgress?.(parsed.data.length, parsed.data.length);
          return parsed.data;
        }
      }
    } catch {}
  }

  // 1. Fetch tree (single request)
  const treeResp = await fetch(TREE_API);
  if (!treeResp.ok) {
    throw new Error(`GitHub API 错误: ${treeResp.status}`);
  }
  const tree = await treeResp.json();

  const animeFiles = (tree.tree as any[]).filter(
    (f) =>
      f.type === 'blob' &&
      f.path.includes('番剧大全') &&
      f.path.endsWith('.md') &&
      !f.path.endsWith('index.md')
  );

  // 2. Fetch raw files in batches
  const results: AnimeItem[] = [];
  const BATCH = 25;

  for (let i = 0; i < animeFiles.length; i += BATCH) {
    const batch = animeFiles.slice(i, i + BATCH);
    const parsed = await Promise.all(
      batch.map(async (file) => {
        try {
          const rawUrl = `${RAW_BASE}/${encodeURIComponent(file.path)}`;
          const r = await fetch(rawUrl);
          if (!r.ok) return null;
          return parseAnimeMarkdown(await r.text(), file.path);
        } catch {
          return null;
        }
      })
    );
    results.push(...parsed.filter(Boolean) as AnimeItem[]);
    onProgress?.(Math.min(i + BATCH, animeFiles.length), animeFiles.length);
  }

  // 3. Cache
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ timestamp: Date.now(), data: results } satisfies CacheData)
      );
    } catch {}
  }

  return results;
}

/**
 * Force refresh: clear cache and re-fetch
 */
export function clearAnimeCache() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(CACHE_KEY);
  }
}

// ─────────────────────────────────────────────
// Anime cover image fetching
// ─────────────────────────────────────────────

// Pre-built cover map loaded from /anime-covers.json
let preBuiltCovers: Record<string, string> | null = null;

async function loadPreBuiltCovers(): Promise<Record<string, string>> {
  if (preBuiltCovers) return preBuiltCovers;

  try {
    const resp = await fetch(COVERS_JSON_PATH);
    if (resp.ok) {
      const data = await resp.json();
      // Remove metadata key
      preBuiltCovers = {};
      for (const [k, v] of Object.entries(data)) {
        if (k !== '_timestamp' && typeof v === 'string') {
          preBuiltCovers[k] = v;
        }
      }
      return preBuiltCovers;
    }
  } catch {}
  return {};
}

/** Load pre-built cover JSON (used by anime/page.tsx directly) */
export async function getAnimeCovers(): Promise<Record<string, string>> {
  return loadPreBuiltCovers();
}

/**
 * Get anime cover image URL.
 * Strategy:
 *   1. Check pre-built JSON (generated at build time from anibk.com)
 *   2. Cache in localStorage for fast subsequent access
 * Returns image URL string or null.
 */
export async function getAnimeCover(anime: AnimeItem): Promise<string | null> {
  // 1. Check pre-built covers JSON
  const covers = await loadPreBuiltCovers();
  const coverUrl = covers[anime.title];
  if (coverUrl) {
    // Also cache in localStorage
    saveCoverCache(anime.title, coverUrl);
    return coverUrl;
  }

  // 2. Check localStorage cache (in case pre-built was updated after cache)
  const localCache = loadCoverCache();
  if (localCache[anime.title] && Date.now() - localCache[anime.title].timestamp < 24 * 60 * 60 * 1000) {
    return localCache[anime.title].url;
  }

  // No cover available
  return null;
}

const COVER_CACHE_KEY = 'datahub_anime_cover_cache';

interface CoverCacheEntry {
  url: string;
  timestamp: number;
}

interface CoverCache {
  [title: string]: CoverCacheEntry;
}

function loadCoverCache(): CoverCache {
  try {
    const raw = localStorage.getItem(COVER_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCoverCache(title: string, url: string) {
  const cache = loadCoverCache();
  cache[title] = { url, timestamp: Date.now() };
  try { localStorage.setItem(COVER_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

/**
 * Generate link to the Quartz-published my-anime-list site
 * e.g. https://cyoltose509.github.io/my-anime-list/番剧大全/xxx
 */
export function getAnimeQuartzLink(anime: AnimeItem): string | null {
  if (!anime.filePath) return null;
  // filePath like "番剧大全/xxx.md" → strip .md
  const slug = anime.filePath.replace(/\.md$/i, '');
  return `https://cyoltose509.github.io/my-anime-list/${decodeURIComponent(slug)}`;
}
