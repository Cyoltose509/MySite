/**
 * Netease Cloud Music sync module v3
 * Strategy:
 *   1. GET /api/v6/playlist/detail → get trackIds (full list)
 *   2. POST /api/song/detail (batch) → get track metadata
 *   3. Write to Supabase via RPC
 *
 * Browser: uses CORS proxy fallbacks
 * CLI (scripts/sync-music.mjs): direct request, no proxy needed
 */

const PLAYLIST_ID = '7611680006';
const NETEASE_BASE = 'https://music.163.com';

export interface NeteaseTrack {
  id: string;
  name: string;
  artist: string[];
  album: string;
  duration: number;
  tags: string[];
}

export interface PlaylistData {
  name: string;
  tracks: NeteaseTrack[];
  total: number;
}

export type ProgressCallback = (progress: {
  phase: 'fetching' | 'syncing' | 'done';
  current: number;
  total: number;
  message: string;
}) => void;

/**
 * Fetch all trackIds from playlist, then batch-fetch details
 */
export async function fetchNeteasePlaylist(
  _passwordHash?: string,
  onProgress?: ProgressCallback
): Promise<PlaylistData> {
  onProgress?.({ phase: 'fetching', current: 0, total: 0, message: '正在获取歌单信息...' });

  // Step 1: Get playlist + trackIds
  const playlistResp = await neteaseFetch(
    `${NETEASE_BASE}/api/v6/playlist/detail?id=${PLAYLIST_ID}&n=0`
  );
  const playlistJson = await playlistResp.json();

  if (playlistJson.code !== 200 || !playlistJson.playlist) {
    throw new Error(`歌单获取失败: ${playlistJson.code} ${playlistJson.msg || ''}`);
  }

  const playlistName: string = playlistJson.playlist.name || '';
  const trackIds: number[] = (playlistJson.playlist.trackIds || []).map(
    (t: any) => t.id
  );

  if (trackIds.length === 0) {
    throw new Error('歌单中没有歌曲');
  }

  onProgress?.({
    phase: 'fetching',
    current: 0,
    total: trackIds.length,
    message: `歌单「${playlistName}」共 ${trackIds.length} 首，开始获取详情...`,
  });

  // Step 2: Batch fetch song details (50 per batch)
  const BATCH = 50;
  const tracks: NeteaseTrack[] = [];

  for (let i = 0; i < trackIds.length; i += BATCH) {
    const batchIds = trackIds.slice(i, i + BATCH);
    const idsParam = '[' + batchIds.join(',') + ']';

    const detailResp = await neteaseFetch(
      `${NETEASE_BASE}/api/song/detail?ids=${idsParam}`
    );
    const detailJson = await detailResp.json();

    if (detailJson.code === 200 && detailJson.songs) {
      for (const s of detailJson.songs) {
        tracks.push({
          id: String(s.id),
          name: s.name || '',
          artist: (s.artists || []).map((a: any) => a.name),
          album: s.album?.name || s.al?.name || '',
          duration: (s.duration || s.dt || 0) > 1000
            ? Math.floor((s.duration || s.dt) / 1000)
            : (s.duration || s.dt || 0),
          tags: [],
        });
      }
    }

    onProgress?.({
      phase: 'fetching',
      current: Math.min(i + BATCH, trackIds.length),
      total: trackIds.length,
      message: `获取详情: ${Math.min(i + BATCH, trackIds.length)}/${trackIds.length}`,
    });
  }

  onProgress?.({
    phase: 'done',
    current: tracks.length,
    total: trackIds.length,
    message: `✅ 获取到 ${tracks.length} 首歌曲`,
  });

  return { name: playlistName, tracks, total: tracks.length };
}

/**
 * Fetch with CORS proxy fallback for browser, direct for CLI
 */
async function neteaseFetch(url: string): Promise<Response> {
  // Try direct first (works in Node CLI, may work in some browsers)
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Referer: NETEASE_BASE,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) return resp;
    throw new Error(`HTTP ${resp.status}`);
  } catch {
    // Browser CORS fallback: use public proxy
  }

  // CORS proxy fallbacks for browser
  const proxies = [
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  ];

  for (const proxy of proxies) {
    try {
      const resp = await fetch(proxy(url), {
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) return resp;
    } catch {
      // try next proxy
    }
  }

  throw new Error(
    '网易云请求失败：浏览器 CORS 限制。请使用命令行同步：npm run sync:music'
  );
}

/**
 * Sync music data to Supabase
 */
export async function syncNeteaseToSupabase(
  data: PlaylistData,
  passwordHash: string,
  onProgress?: ProgressCallback
): Promise<{ count: number }> {
  const { supabase } = require('@/lib/supabase');

  onProgress?.({
    phase: 'syncing',
    current: 0,
    total: data.tracks.length,
    message: '开始写入数据库...',
  });

  const CHUNK = 100;
  let synced = 0;
  for (let i = 0; i < data.tracks.length; i += CHUNK) {
    const chunk = data.tracks.slice(i, i + CHUNK);
    const musicData = chunk.map((t) => ({
      title: t.name,
      artist: t.artist,
      album: t.album,
      netease_id: t.id,
      duration: t.duration,
      tags: t.tags || [],
    }));

    const { error, data: result } = await supabase.rpc('fn_sync_music', {
      p_hash: passwordHash,
      p_data: musicData,
    });

    if (error || (result && result.error)) {
      throw new Error(error?.message || result?.error || 'Sync failed');
    }

    synced += chunk.length;
    onProgress?.({
      phase: 'syncing',
      current: synced,
      total: data.tracks.length,
      message: `同步进度: ${synced}/${data.tracks.length}`,
    });
  }

  onProgress?.({
    phase: 'done',
    current: synced,
    total: data.tracks.length,
    message: `✅ 同步完成！共 ${synced} 首歌曲`,
  });

  return { count: synced };
}
