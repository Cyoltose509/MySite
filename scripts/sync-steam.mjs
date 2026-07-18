/**
 * scripts/sync-steam.mjs
 * CLI: sync Steam game library + achievements + tags to Supabase.
 *
 * Behaviour (matches the /admin "sync" intent):
 *   - New games are INSERTed and reported.
 *   - playtime_forever / playtime_2weeks are updated UPWARD-ONLY (GREATEST),
 *     so a value already larger than what Steam reports is never lowered.
 *   - Achievements are stored in metrics.achievements as "achieved/total",
 *     also updated UPWARD-ONLY (keep the larger achieved count). Fetched for
 *     new games and for games that have no achievements yet.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchAchievements(appid) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?key=${API_KEY}&steamid=${STEAM_ID}&appid=${appid}&l=schinese`;
  try {
    const text = await httpGet(url);
    const json = JSON.parse(text);
    const stats = json?.playerstats;
    if (!stats || !stats.achievements) return null;
    const list = stats.achievements;
    const total = list.length;
    const achieved = list.filter((a) => a.achieved === 1).length;
    return total === 0 ? null : { achieved, total };
  } catch {
    return null;
  }
}

async function main() {
  console.log('\n\x1b[36m=== Steam 游戏库同步 ===\x1b[0m\n');

  // 1. Fetch game list
  log('\x1b[34m→\x1b[0m', '获取 Steam 游戏列表...');
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${API_KEY}&steamid=${STEAM_ID}&include_appinfo=true&include_played_free_games=true`;
  const resp = await fetch(url);
  const json = await resp.json();

  if (!json.response || !json.response.games) {
    log('\x1b[31m✕\x1b[0m', 'Steam API 返回空数据（库为空或被网络拦截）');
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

  // 3. Existing appids + playtime + metrics
  const { rows: existRows } = await client.query(
    'SELECT steam_app_id, playtime_forever, metrics FROM public.steam_games'
  );
  const existMap = new Map();
  for (const r of existRows) existMap.set(Number(r.steam_app_id), r);

  // 4. UPSERT games (upward-only playtime, detect new)
  let count = 0, newCount = 0, playtimeUpdated = 0;
  const newGames = [];
  for (const g of games) {
    const { rows: bl } = await client.query('SELECT 1 FROM public.steam_blacklist WHERE steam_app_id = $1', [g.appid]);
    if (bl.length > 0) continue;

    const ex = existMap.get(g.appid);
    const forever = g.playtime_forever || 0;
    const two = g.playtime_2weeks || 0;

    if (!ex) {
      await client.query(
        `INSERT INTO public.steam_games (steam_app_id, title, playtime_forever, playtime_2weeks, img_icon_url, img_logo_url, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (steam_app_id) DO NOTHING`,
        [g.appid, g.name, forever, two, g.img_icon_url || '', g.img_logo_url || '']
      );
      newCount++;
      newGames.push({ appid: g.appid, name: g.name });
    } else {
      const newForever = Math.max(Number(ex.playtime_forever) || 0, forever);
      const newTwo = Math.max(Number(ex.playtime_2weeks) || 0, two);
      if (newForever !== ex.playtime_forever || newTwo !== ex.playtime_2weeks) {
        await client.query(
          `UPDATE public.steam_games
           SET title = $2, playtime_forever = $3, playtime_2weeks = $4,
               img_icon_url = $5, img_logo_url = $6, synced_at = now()
           WHERE steam_app_id = $1`,
          [g.appid, g.name, newForever, newTwo, g.img_icon_url || '', g.img_logo_url || '']
        );
        playtimeUpdated++;
      }
    }
    count++;
    if (count % 50 === 0) process.stdout.write(`\r\x1b[90m  ...\x1b[0m 已处理 ${count}/${games.length}`);
  }
  console.log('');
  log('\x1b[32m✓\x1b[0m', `已同步 ${count} 款（新增 ${newCount}，时长更新 ${playtimeUpdated}）`);
  if (newGames.length) {
    const names = newGames.slice(0, 15).map((g) => g.name).join('、');
    log('\x1b[35m🆕\x1b[0m', `新游戏：${names}${newGames.length > 15 ? ` 等 ${newGames.length} 款` : ''}`);
  }

  // 5. Achievements: new games + games missing achievements (upward-only)
  log('\x1b[34m→\x1b[0m', '获取成就（新游戏 + 缺成就的游戏）...');
  const achTargets = [];
  for (const g of games) {
    const ex = existMap.get(g.appid);
    if (!ex) { achTargets.push(g.appid); continue; }
    const m = ex.metrics;
    if (!m || m.achievements === undefined) achTargets.push(g.appid);
  }
  let achUpdated = 0;
  for (let i = 0; i < achTargets.length; i++) {
    const appid = achTargets[i];
    const ach = await fetchAchievements(appid);
    if (!ach) { if ((i + 1) % 10 === 0) process.stdout.write(`\r\x1b[90m  ...\x1b[0m 成就: ${i + 1}/${achTargets.length}`); continue; }
    const val = `${ach.achieved}/${ach.total}`;
    // upward-only: only update when existing achieved < new achieved
    const r = await client.query(
      `UPDATE public.steam_games
       SET metrics = jsonb_set(COALESCE(metrics, '{}'::jsonb), '{achievements}', to_jsonb($2::text))
       WHERE steam_app_id = $1
         AND (metrics->>'achievements' IS NULL OR (split_part(metrics->>'achievements','/',1)::int) < $3)`,
      [appid, val, ach.achieved]
    );
    if (r.rowCount > 0) achUpdated++;
    if ((i + 1) % 10 === 0) process.stdout.write(`\r\x1b[90m  ...\x1b[0m 成就: ${i + 1}/${achTargets.length}`);
  }
  console.log('');
  log('\x1b[32m✓\x1b[0m', `成就更新 ${achUpdated} 款`);

  // 6. Fetch game tags from Steam Store API
  let tagCount = 0;
  if (process.env.SKIP_TAGS) {
    log('\x1b[33m⚠\x1b[0m', '已跳过标签抓取（SKIP_TAGS=1）');
  } else {
  log('\x1b[34m→\x1b[0m', '获取游戏标签（Steam Store API）...');
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const { rows: existing } = await client.query(
      'SELECT 1 FROM public.steam_tags WHERE game_id = (SELECT id FROM public.steam_games WHERE steam_app_id = $1) LIMIT 1',
      [g.appid]
    );
    if (existing.length > 0) {
      if ((i + 1) % 10 === 0) process.stdout.write(`\r\x1b[90m  ...\x1b[0m 标签: ${i + 1}/${games.length} (跳过已有)`);
      continue;
    }
    try {
      const apiText = await httpGet(`https://store.steampowered.com/api/appdetails?appids=${g.appid}&l=schinese`);
      const detailJson = JSON.parse(apiText);
      const detail = detailJson[String(g.appid)];
      if (detail && detail.success && detail.data) {
        const d = detail.data;
        const tags = new Set();
        for (const genre of (d.genres || [])) tags.add(genre.description);
        try {
          const html = await httpGet(`https://store.steampowered.com/app/${g.appid}/?l=schinese`);
          const m = html.match(/InitAppTagModal\s*\(\s*\d+\s*,\s*(\[[\s\S]*?\])\s*\)/);
          if (m) {
            const userTags = JSON.parse(m[1]);
            for (const t of userTags.slice(0, 5)) if (t.name) tags.add(t.name.trim());
          }
        } catch { /* store page unreachable, skip */ }
        if (tags.size > 0) {
          const gameId = await client.query('SELECT id FROM public.steam_games WHERE steam_app_id = $1', [g.appid]);
          if (gameId.rows[0]) {
            for (const tag of tags) {
              await client.query('INSERT INTO public.steam_tags (game_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gameId.rows[0].id, tag]);
              tagCount++;
            }
          }
        }
      }
    } catch { /* skip failed fetches */ }
    if ((i + 1) % 10 === 0) process.stdout.write(`\r\x1b[90m  ...\x1b[0m 标签: ${i + 1}/${games.length}`);
    await sleep(200);
  }
  console.log('');
  log('\x1b[32m✓\x1b[0m', `已导入 ${tagCount} 个 Steam 标签`);
  }

  await client.end();

  console.log('\n\x1b[32m========================================\x1b[0m');
  console.log(`\x1b[32m  ✅ Steam 同步完成！新增 ${newCount}，时长更新 ${playtimeUpdated}，成就更新 ${achUpdated}，标签 ${tagCount}\x1b[0m`);
  console.log('\x1b[32m========================================\x1b[0m\n');

  const top10 = [...games].sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0)).slice(0, 10);
  console.log('  游玩时长 TOP 10:');
  for (const g of top10) console.log(`    ${g.name}: ${Math.round(g.playtime_forever / 60)} 小时`);
  console.log('');
}

main().catch((e) => {
  console.error(`\n\x1b[31m[ERROR]\x1b[0m ${e.message}\n`);
  process.exit(1);
});
