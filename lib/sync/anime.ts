/**
 * Anime sync module
 * Fetches anime data from GitHub repo (raw Markdown files)
 * and syncs to Supabase
 */

const REPO_API = 'https://api.github.com/repos/cyoltose509/my-anime-list';
const RAW_BASE = 'https://raw.githubusercontent.com/cyoltose509/my-anime-list/v4';

export interface AnimeData {
  title: string;
  status: string;
  progress?: number;
  rating?: string;
}

/**
 * Fetch anime list from GitHub repo
 * Parses Markdown frontmatter from files in content/番剧大全/
 */
export async function syncAnimeFromGitHub(): Promise<{ count: number }> {
  // Fetch directory listing
  const dirUrl = `${REPO_API}/contents/content/%E7%95%AA%E5%89%A7%E5%A4%A7%E5%85%A8?ref=v4`;
  const resp = await fetch(dirUrl);
  if (!resp.ok) throw new Error('无法获取番剧目录');
  const files: { name: string; path: string; download_url: string }[] =
    await resp.json();

  const results: AnimeData[] = [];

  for (const file of files.slice(0, 50)) {
    // Limit to 50 for MVP
    try {
      const mdResp = await fetch(file.download_url);
      const mdText = await mdResp.text();
      const data = parseAnimeMarkdown(mdText, file.name);
      if (data) results.push(data);
    } catch {
      // Skip failed files
    }
  }

  // Sync to Supabase
  if (results.length > 0) {
    const { supabase } = require('@/lib/supabase');
    const { hashPassword } = require('@/lib/auth');

    // This needs to be called with admin password
    // For now, return the data and let the caller handle it
    return { count: results.length };
  }

  return { count: 0 };
}

/**
 * Parse anime data from Markdown frontmatter
 */
function parseAnimeMarkdown(text: string, filename: string): AnimeData | null {
  const title = filename.replace(/\.md$/i, '').replace(/[-_]/g, ' ');

  // Try to extract tags/status from content
  const statusMatch = text.match(/(看完|正在看|中道崩殂)/);
  const ratingMatch = text.match(/(夯|顶级|人上人|NPC|拉完了)/);

  const status = statusMatch ? statusMatch[1] : '未知';
  const rating = ratingMatch ? ratingMatch[1] : undefined;

  return { title, status, rating };
}

/**
 * Sync anime data to Supabase (client-side, requires password hash)
 */
export async function syncAnimeToSupabase(
  data: AnimeData[],
  passwordHash: string
): Promise<{ count: number }> {
  const { supabase } = require('@/lib/supabase');

  const { data: result, error } = await supabase.rpc('fn_sync_anime', {
    p_hash: passwordHash,
    p_data: JSON.stringify(data),
  });

  if (error || (result && result.error)) {
    throw new Error(error?.message || result?.error || 'Sync failed');
  }

  return { count: data.length };
}
