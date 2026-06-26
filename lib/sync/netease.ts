/**
 * Netease Cloud Music sync module
 * Fetches playlist data from Netease API
 * and syncs to Supabase
 */

const NETEASE_API = 'https://music.163.com/api';

export interface NeteaseTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  playCount?: number;
}

export interface PlaylistData {
  tracks: NeteaseTrack[];
}

/**
 * Fetch playlist from Netease Cloud Music
 * Playlist ID: 7611680006
 */
export async function fetchNeteasePlaylist(): Promise<PlaylistData> {
  const playlistId = '7611680006';

  // Try multiple API endpoints (CORS proxies)
  const endpoints = [
    `https://music.163.com/api/playlist/detail?id=${playlistId}`,
    `https://netease-cloud-music-api-five.vercel.app/playlist/detail?id=${playlistId}`,
  ];

  let lastError: Error | null = null;

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (resp.ok) {
        const json = await resp.json();
        if (json.code === 200 || json.playlist) {
          const tracks = json.playlist?.tracks || json.result?.tracks || [];
          return {
            tracks: tracks.map((t: any) => ({
              id: String(t.id),
              name: t.name,
              artists: t.ar || t.artists || [],
            })),
          };
        }
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  // Fallback: return mock data for development
  if (process.env.NEXT_PUBLIC_DEV_MODE === 'true') {
    return {
      tracks: [
        { id: 'mock1', name: 'Mock Song 1', artists: [{ name: 'Mock Artist' }] },
        { id: 'mock2', name: 'Mock Song 2', artists: [{ name: 'Mock Artist' }] },
      ],
    };
  }

  throw lastError || new Error('无法获取网易云歌单数据');
}

/**
 * Sync music data to Supabase
 */
export async function syncNeteasePlaylist(
  passwordHash?: string
): Promise<{ count: number }> {
  const data = await fetchNeteasePlaylist();

  if (!passwordHash) {
    // Return data without syncing (for preview)
    return { count: data.tracks.length };
  }

  const musicData = data.tracks.map((track) => ({
    title: track.name,
    artist: track.artists.map((a: any) => a.name).join(', '),
    netease_id: track.id,
    play_count: 0,
  }));

  const { supabase } = require('@/lib/supabase');

  const { data: result, error } = await supabase.rpc('fn_sync_music', {
    p_hash: passwordHash,
    p_data: JSON.stringify(musicData),
  });

  if (error || (result && result.error)) {
    throw new Error(error?.message || result?.error || 'Sync failed');
  }

  return { count: musicData.length };
}
