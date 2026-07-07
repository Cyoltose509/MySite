/**
 * scripts/sync-steam.mjs
 * CLI: sync Steam game library + fetch game tags to Supabase
 *
 * Usage: node scripts/sync-steam.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import https from 'https';

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

const API_KEY = process.env.STEAM_API_KEY;
const STEAM_ID = process.env.STEAM_ID;

if (!API_KEY) { console.error('[ERROR] STEAM_API_KEY not found in .env.local'); process.exit(1); }
if (!STEAM_ID) { console.error('[ERROR] STEAM_ID not found in .env.local'); process.exit(1); }

function log(icon, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`\x1b[90m[${t}]\x1b[0m ${icon} ${msg}`);
}

function httpGet(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  console.log('\n\x1b[36m=== Steam 游戏库同步 ===\x1b[0m\n');

  // 1. Fetch game list
  log('\x1b[34m→\x1b[0m', '获取 Steam 游戏列表...');
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${API_KEY}&steamid=${STEAM_ID}&include_appinfo=true&include_played_free_games=true`;
  const resp = await fetch(url);
  const json = await resp.json();

  if (!json.response || !json.response.games) {
    log('\x1b[31m✕\x1b[0m', 'Steam API 返回空数据');
    process.exit(1);
  }

  const games = json.response.games;
  log('\x1b[32m✓\x1b[0m', `共 ${games.length} 款游戏`);

  // 2. Connect DB
  log('\x1b[34m→\x1b[0m', '连接数据库...');
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  log('\x1b[32m✓\x1b[0m', '数据库已连接');

  // 3. UPSERT games (skip blacklisted, skip manual)
  let count = 0, skipped = 0;
  for (const g of games) {
    const { rows: bl } = await client.query('SELECT 1 FROM public.steam_blacklist WHERE steam_app_id = $1', [g.appid]);
    if (bl.length > 0) { skipped++; continue; }
    await client.query(
      `INSERT INTO public.steam_games (steam_app_id, title, playtime_forever, playtime_2weeks, img_icon_url, img_logo_url, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (steam_app_id) DO UPDATE SET
         title = EXCLUDED.title, playtime_forever = EXCLUDED.playtime_forever,
         playtime_2weeks = EXCLUDED.playtime_2weeks, img_icon_url = EXCLUDED.img_icon_url,
         img_logo_url = EXCLUDED.img_logo_url, synced_at = now()`,
      [g.appid, g.name, g.playtime_forever || 0, g.playtime_2weeks || 0, g.img_icon_url || '', g.img_logo_url || '']
    );
    count++;
    if (count % 50 === 0) process.stdout.write(`\r\x1b[90m  ...\x1b[0m 已处理 ${count}/${games.length}`);
  }
  console.log('');
  log('\x1b[32m✓\x1b[0m', `已同步 ${count} 款游戏`);

  // 4. Fetch game tags from Steam Store API
  log('\x1b[34m→\x1b[0m', '获取游戏标签（Steam Store API）...');
  let tagCount = 0;
  for (let i = 0; i < games.length; i++) {
    const g = games[i];

    // Skip if game already has user tags
    const { rows: existing } = await client.query(
      'SELECT 1 FROM public.steam_tags WHERE game_id = (SELECT id FROM public.steam_games WHERE steam_app_id = $1) LIMIT 1',
      [g.appid]
    );
    if (existing.length > 0) {
      if ((i + 1) % 10 === 0) process.stdout.write(`\r\x1b[90m  ...\x1b[0m 标签: ${i + 1}/${games.length} (跳过已有)`);
      continue;
    }

    try {
      // Get genres from API
      const apiText = await httpGet(`https://store.steampowered.com/api/appdetails?appids=${g.appid}&l=schinese`);
      const detailJson = JSON.parse(apiText);
      const detail = detailJson[String(g.appid)];
      if (detail && detail.success && detail.data) {
        const d = detail.data;
        const tags = new Set();

        // Genres
        for (const genre of (d.genres || [])) {
          tags.add(genre.description);
        }

        // User tags from store page (may fail if network blocked)
        try {
          const html = await httpGet(`https://store.steampowered.com/app/${g.appid}/?l=schinese`);
          const m = html.match(/InitAppTagModal\s*\(\s*\d+\s*,\s*(\[[\s\S]*?\])\s*\)/);
          if (m) {
            const userTags = JSON.parse(m[1]);
            for (const t of userTags.slice(0, 5)) {
              if (t.name) tags.add(t.name.trim());
            }
          }
        } catch { /* store page unreachable, skip */ }

        if (tags.size > 0) {
          const gameId = await client.query(
            'SELECT id FROM public.steam_games WHERE steam_app_id = $1', [g.appid]
          );
          if (gameId.rows[0]) {
            for (const tag of tags) {
              await client.query(
                'INSERT INTO public.steam_tags (game_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [gameId.rows[0].id, tag]
              );
              tagCount++;
            }
          }
        }
      }
    } catch {
      // skip failed fetches
    }

    if ((i + 1) % 10 === 0) process.stdout.write(`\r\x1b[90m  ...\x1b[0m 标签: ${i + 1}/${games.length}`);
    // Rate limit: ~200ms between requests
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('');
  log('\x1b[32m✓\x1b[0m', `已导入 ${tagCount} 个 Steam 标签`);

  await client.end();

  // Summary
  console.log('\n\x1b[32m========================================\x1b[0m');
  console.log(`\x1b[32m  ✅ Steam 同步完成！${count} 款游戏，${tagCount} 个标签\x1b[0m`);
  console.log('\x1b[32m========================================\x1b[0m\n');

  // Top 10 by playtime
  const top10 = [...games].sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0)).slice(0, 10);
  console.log('  游玩时长 TOP 10:');
  for (const g of top10) {
    const h = Math.round(g.playtime_forever / 60);
    console.log(`    ${g.name}: ${h} 小时`);
  }
  console.log('');
}

main().catch(e => {
  console.error(`\n\x1b[31m[ERROR]\x1b[0m ${e.message}\n`);
  process.exit(1);
});
