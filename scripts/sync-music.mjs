/**
 * scripts/sync-music.mjs
 * CLI: sync Netease Cloud Music playlist to Supabase
 * Direct server-side request, no CORS issues
 *
 * Usage: node scripts/sync-music.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// --- Load .env.local ---
const envPath = resolve(projectRoot, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD_HASH = process.env.NEXT_PUBLIC_ADMIN_PASSWORD_HASH;

if (!DATABASE_URL) {
  console.error('\x1b[31m[ERROR]\x1b[0m DATABASE_URL not found in .env.local');
  process.exit(1);
}
if (!PASSWORD_HASH) {
  console.error('\x1b[31m[ERROR]\x1b[0m NEXT_PUBLIC_ADMIN_PASSWORD_HASH not found in .env.local');
  process.exit(1);
}

const PLAYLIST_ID = '7611680006';
const NETEASE = 'https://music.163.com';

function log(icon, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`\x1b[90m[${t}]\x1b[0m ${icon} ${msg}`);
}

function t() { return new Date().toTimeString().slice(0, 8); }

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': NETEASE,
  'Cookie': 'os=pc',
};

async function main() {
  console.log('\n\x1b[36m=== 网易云音乐同步 (CLI) ===\x1b[0m\n');

  // 1. Get playlist + trackIds
  log('\x1b[34m→\x1b[0m', `获取歌单 ${PLAYLIST_ID} 信息...`);

  const playlistResp = await fetch(
    `${NETEASE}/api/v6/playlist/detail?id=${PLAYLIST_ID}&n=0`,
    { headers: HEADERS }
  );
  const playlistJson = await playlistResp.json();

  if (playlistJson.code !== 200 || !playlistJson.playlist) {
    log('\x1b[31m✕\x1b[0m', `歌单获取失败: ${playlistJson.code}`);
    process.exit(1);
  }

  const playlistName = playlistJson.playlist.name;
  const trackIds = (playlistJson.playlist.trackIds || []).map(t => t.id);

  log('\x1b[32m✓\x1b[0m', `歌单「${playlistName}」共 ${trackIds.length} 首歌曲`);

  if (trackIds.length === 0) {
    log('\x1b[33m!\x1b[0m', '歌单为空');
    process.exit(0);
  }

  // 2. Batch fetch song details (50 per batch)
  log('\x1b[34m→\x1b[0m', '开始获取歌曲详情...');

  const tracks = [];
  const BATCH = 50;

  for (let i = 0; i < trackIds.length; i += BATCH) {
    const batchIds = trackIds.slice(i, i + BATCH);
    const idsParam = '[' + batchIds.join(',') + ']';

    const resp = await fetch(
      `${NETEASE}/api/song/detail?ids=${idsParam}`,
      { headers: HEADERS }
    );
    const data = await resp.json();

    if (data.code === 200 && data.songs) {
      for (const s of data.songs) {
        tracks.push({
          netease_id: String(s.id),
          title: s.name || '',
          artist: s.artists?.[0]?.name || 'Unknown',
          album: s.album?.name || '',
          duration: (s.duration || 0) > 1000 ? Math.floor(s.duration / 1000) : (s.duration || 0),
        });
      }
    }

    const pct = Math.round(Math.min(i + BATCH, trackIds.length) / trackIds.length * 100);
    process.stdout.write(`\r\x1b[90m[${t()}]\x1b[0m \x1b[34m→\x1b[0m 获取详情: ${Math.min(i + BATCH, trackIds.length)}/${trackIds.length} (${pct}%)`);
  }
  console.log('');

  log('\x1b[32m✓\x1b[0m', `获取到 ${tracks.length} 首歌曲详情`);

  // 3. Write to Supabase via direct PostgreSQL
  log('\x1b[34m→\x1b[0m', '连接数据库...');
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Verify password hash
  const { rows } = await client.query(
    'SELECT 1 FROM public.admin_config WHERE password_hash = $1',
    [PASSWORD_HASH]
  );
  if (rows.length === 0) {
    log('\x1b[31m✕\x1b[0m', '密码哈希验证失败');
    await client.end();
    process.exit(1);
  }

  log('\x1b[32m✓\x1b[0m', '数据库已连接');

  // Clear existing and insert
  await client.query('DELETE FROM public.music_list');

  let inserted = 0;
  for (let i = 0; i < tracks.length; i += 50) {
    const chunk = tracks.slice(i, i + 50);
    const values = [];
    const params = [];
    chunk.forEach((t, idx) => {
      const base = idx * 5;
      // pg driver sends JS strings as text params, so use ::bigint cast
      // to let PostgreSQL convert the text value to bigint
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::bigint, $${base + 5})`);
      params.push(t.title, t.artist, t.album, String(t.netease_id), t.duration);
    });

    await client.query(
      `INSERT INTO public.music_list (title, artist, album, netease_id, duration)
       VALUES ${values.join(', ')}`,
      params
    );
    inserted += chunk.length;
  }

  await client.end();

  // Summary
  console.log('\n\x1b[32m========================================\x1b[0m');
  console.log(`\x1b[32m  ✅ 网易云同步完成！\x1b[0m`);
  console.log(`\x1b[32m  歌单: ${playlistName}\x1b[0m`);
  console.log(`\x1b[32m  总计: ${trackIds.length} 首\x1b[0m`);
  console.log(`\x1b[32m  写入: ${inserted} 首\x1b[0m`);
  console.log('\x1b[32m========================================\x1b[0m\n');

  // Artist breakdown (top 10)
  const artistCount = {};
  tracks.forEach(t => { artistCount[t.artist] = (artistCount[t.artist] || 0) + 1; });
  const sorted = Object.entries(artistCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('  歌手 TOP 10:');
  for (const [a, c] of sorted) {
    console.log(`    ${a}: ${c} 首`);
  }
  console.log('');
}

main().catch(e => {
  console.error(`\n\x1b[31m[ERROR]\x1b[0m ${e.message}\n`);
  process.exit(1);
});
