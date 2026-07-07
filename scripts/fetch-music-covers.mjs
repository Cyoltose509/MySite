/**
 * scripts/fetch-music-covers.mjs
 * Build-time script: fetch album cover URLs from NetEase Cloud Music API
 * Saves to public/music-covers.json (netease_id → cover URL)
 *
 * Usage: node scripts/fetch-music-covers.mjs
 *        node scripts/fetch-music-covers.mjs --force   (re-fetch even if cached)
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const OUTPUT = resolve(projectRoot, 'public/music-covers.json');

const NETEASE = 'https://music.163.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': NETEASE,
  'Cookie': 'os=pc',
};
const BATCH = 50;

// --- Load .env.local for DB connection ---
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

function log(icon, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`\x1b[90m[${t}]\x1b[0m ${icon} ${msg}`);
}

async function main() {
  const force = process.argv.includes('--force');

  // Check existing cache
  if (!force && existsSync(OUTPUT)) {
    const existing = JSON.parse(readFileSync(OUTPUT, 'utf-8'));
    const count = Object.keys(existing).filter(k => k !== '_timestamp').length;
    if (count > 0) {
      log('\x1b[32m✓\x1b[0m', `已有 ${count} 条封面缓存，跳过（使用 --force 强制刷新）`);
      return;
    }
  }

  console.log('\n\x1b[36m=== 网易云专辑封面抓取 ===\x1b[0m\n');

  // 1. Get all netease_ids from Supabase
  log('\x1b[34m→\x1b[0m', '从数据库获取 netease_id 列表...');

  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows } = await client.query('SELECT netease_id::text, title FROM public.music_list WHERE netease_id IS NOT NULL');
  await client.end();

  if (rows.length === 0) {
    log('\x1b[33m!\x1b[0m', '数据库无歌曲数据');
    process.exit(0);
  }

  log('\x1b[32m✓\x1b[0m', `获取到 ${rows.length} 个 netease_id`);

  // Build lookup: netease_id → title (for logging)
  const idToTitle = {};
  rows.forEach(r => { idToTitle[r.netease_id] = r.title; });

  // 2. Batch fetch song details from NetEase API to get album.picUrl
  log('\x1b[34m→\x1b[0m', '开始从网易云API抓取专辑封面...');

  const covers = {};  // netease_id (string) → picUrl
  const ids = rows.map(r => r.netease_id);
  let fetched = 0;

  for (let i = 0; i < ids.length; i += BATCH) {
    const batchIds = ids.slice(i, i + BATCH);
    const idsParam = '[' + batchIds.join(',') + ']';

    try {
      const resp = await fetch(
        `${NETEASE}/api/song/detail?ids=${idsParam}`,
        { headers: HEADERS, signal: AbortSignal.timeout(15000) }
      );
      const data = await resp.json();

      if (data.code === 200 && data.songs) {
        for (const s of data.songs) {
          const picUrl = s.album?.picUrl;
          if (picUrl) {
            covers[String(s.id)] = picUrl;
          }
        }
      }
    } catch (e) {
      log('\x1b[31m✕\x1b[0m', `批次 ${i}-${i + BATCH} 失败: ${e.message}`);
    }

    fetched += batchIds.length;
    const pct = Math.round(Math.min(fetched, ids.length) / ids.length * 100);
    process.stdout.write(`\r\x1b[90m[${new Date().toTimeString().slice(0,8)}]\x1b[0m \x1b[34m→\x1b[0m 抓取封面: ${Math.min(fetched, ids.length)}/${ids.length} (${pct}%)`);
  }
  console.log('');

  const coverCount = Object.keys(covers).length;
  log('\x1b[32m✓\x1b[0m', `成功抓取 ${coverCount}/${ids.length} 个封面`);

  // 3. Save to JSON
  const output = { ...covers, _timestamp: Date.now() };
  writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  log('\x1b[32m✓\x1b[0m', `保存到 ${OUTPUT} (${(JSON.stringify(output).length / 1024).toFixed(1)} KB)`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
