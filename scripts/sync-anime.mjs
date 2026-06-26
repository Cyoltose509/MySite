/**
 * scripts/sync-anime.mjs
 * CLI: sync anime data from GitHub to Supabase
 * No CORS issues, no rate limit problems
 *
 * Usage: node scripts/sync-anime.mjs
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

const REPO = 'cyoltose509/my-anime-list';
const BRANCH = 'v4';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const TREE_API = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;

function log(icon, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`\x1b[90m[${t}]\x1b[0m ${icon} ${msg}`);
}

// --- Parse frontmatter (Quartz YAML list format) ---
// tags in frontmatter are a YAML list:
//   tags:
//     - 奇幻
//     - 观看状态-看完
//     - 评级-夯
// We extract status/rating from special tag prefixes, rest become tags
function parseAnimeMarkdown(text, filepath) {
  const filename = filepath.split('/').pop() || '';
  let title = filename.replace(/\.md$/i, '').trim();

  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return { title, status: '未知', tags: [] };
  }

  const fm = fmMatch[1];

  // Extract title from frontmatter if present
  const titleMatch = fm.match(/^title:\s*(.+)/im);
  if (titleMatch) title = titleMatch[1].trim().replace(/^["']|["']$/g, '');

  // Parse tags: YAML list format (lines starting with "  - ")
  const tagsSection = fm.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/im);
  const rawTags = [];
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
      inlineTags[1].split(',').forEach(t => {
        const cleaned = t.trim().replace(/['"]/g, '');
        if (cleaned) rawTags.push(cleaned);
      });
    }
  }

  // Extract status/rating from tags like "观看状态-看完" "评级-夯"
  let status = '未知';
  let rating = null;
  const cleanTags = [];

  for (const tag of rawTags) {
    if (tag.startsWith('观看状态-')) {
      status = tag.replace('观看状态-', '');
    } else if (tag.startsWith('评级-')) {
      rating = tag.replace('评级-', '');
    } else if (tag.startsWith('记忆程度-')) {
      // skip, not stored separately
    } else {
      cleanTags.push(tag);
    }
  }

  return { title, status, rating, tags: cleanTags };
}

async function main() {
  console.log('\n\x1b[36m=== 番剧同步 (CLI) ===\x1b[0m\n');

  // 1. Fetch tree
  log('\x1b[34m→\x1b[0m', '获取仓库文件树...');
  const treeResp = await fetch(TREE_API);
  if (!treeResp.ok) {
    log('\x1b[31m✕\x1b[0m', `GitHub API 错误: ${treeResp.status}`);
    process.exit(1);
  }
  const tree = await treeResp.json();

  const animeFiles = tree.tree.filter(
    f => f.type === 'blob' &&
    f.path.includes('番剧大全') &&
    f.path.endsWith('.md') &&
    !f.path.endsWith('index.md')
  );

  log('\x1b[32m✓\x1b[0m', `找到 ${animeFiles.length} 个番剧文件`);

  // 2. Parse all files (concurrency=15)
  log('\x1b[34m→\x1b[0m', '开始解析番剧文件...');
  const results = [];
  const BATCH = 15;

  for (let i = 0; i < animeFiles.length; i += BATCH) {
    const batch = animeFiles.slice(i, i + BATCH);
    const parsed = await Promise.all(
      batch.map(async (file) => {
        try {
          const rawUrl = `${RAW}/${encodeURIComponent(file.path)}`;
          const r = await fetch(rawUrl);
          if (!r.ok) return null;
          return parseAnimeMarkdown(await r.text(), file.path);
        } catch { return null; }
      })
    );
    results.push(...parsed.filter(Boolean));

    const pct = Math.min(100, Math.round(((i + BATCH) / animeFiles.length) * 100));
    process.stdout.write(`\r\x1b[90m[${t()}]\x1b[0m \x1b[34m→\x1b[0m 解析进度: ${Math.min(i + BATCH, animeFiles.length)}/${animeFiles.length} (${pct}%) - ${results.length} 条有效`);
  }
  console.log('');

  log('\x1b[32m✓\x1b[0m', `解析完成: ${results.length} 条番剧数据`);

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

  log('\x1b[32m✓\x1b[0m', '数据库已连接，开始写入...');

  // Clear existing and insert
  await client.query('DELETE FROM public.anime_list');

  let inserted = 0;
  for (let i = 0; i < results.length; i += 50) {
    const chunk = results.slice(i, i + 50);
    const values = [];
    const params = [];
    chunk.forEach((a, idx) => {
      const base = idx * 6;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
      params.push(a.title, a.status || '未知', a.progress || 0, a.rating || null, a.tags || null, 'github');
    });

    await client.query(
      `INSERT INTO public.anime_list (title, status, progress, rating, tags, source)
       VALUES ${values.join(', ')}`,
      params
    );
    inserted += chunk.length;
    process.stdout.write(`\r\x1b[90m[${t()}]\x1b[0m \x1b[34m→\x1b[0m 写入进度: ${inserted}/${results.length}`);
  }
  console.log('');

  await client.end();

  // Summary
  console.log('\n\x1b[32m========================================\x1b[0m');
  console.log(`\x1b[32m  ✅ 番剧同步完成！\x1b[0m`);
  console.log(`\x1b[32m  总计: ${results.length} 条\x1b[0m`);
  console.log(`\x1b[32m  写入: ${inserted} 条\x1b[0m`);
  console.log('\x1b[32m========================================\x1b[0m\n');

  // Status breakdown
  const statusCount = {};
  results.forEach(a => { statusCount[a.status] = (statusCount[a.status] || 0) + 1; });
  console.log('  状态分布:');
  for (const [s, c] of Object.entries(statusCount)) {
    console.log(`    ${s}: ${c}`);
  }
  console.log('');
}

function t() { return new Date().toTimeString().slice(0, 8); }

main().catch(e => {
  console.error(`\n\x1b[31m[ERROR]\x1b[0m ${e.message}\n`);
  process.exit(1);
});
