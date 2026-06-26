/**
 * Build-time script: Fetch anime cover URLs from anibk.com
 * Source URLs (anibk links) are extracted from md frontmatter.
 * Then fetch each anibk page directly to extract the cover image.
 *
 * Usage: node scripts/fetch-covers.mjs [--force]
 */

const REPO = 'cyoltose509/my-anime-list';
const BRANCH = 'v4';
const TREE_API = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

const OUTPUT_PATH = 'public/anime-covers.json';

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const args = process.argv.slice(2);
const force = args.includes('--force');

function log(msg) { console.log(msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Parse YAML frontmatter to extract title and source */
function parseFrontmatter(text) {
  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return { title: null, source: null };

  const fm = fmMatch[1];
  const lines = fm.split('\n');
  let title = null;
  let source = null;

  for (const line of lines) {
    const t = line.trim();
    if (t.match(/^title:/i)) {
      title = t.replace(/^title:\s*/i, '').trim().replace(/^["']|["']$/g, '');
    }
    if (t.match(/^source:/i)) {
      source = t.replace(/^source:\s*/i, '').trim().replace(/^["']|["']$/g, '');
    }
  }

  return { title, source };
}

/** Fetch anibk detail page and extract cover image URL */
async function anibkGetCover(pageUrl, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(pageUrl, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (!resp.ok) continue;
      const html = await resp.text();

      // bgmbk.tv cover image pattern (from generate_tier.py)
      const imgMatch = html.match(/https?:\/\/imgcn\d?\.bgmbk\.tv\/file\/bk\/\d+\/[a-f0-9]{20,}\.webp/);
      if (imgMatch) return imgMatch[0];

      // Alternative: any bgmbk image
      const altMatch = html.match(/https?:\/\/imgcn\d?\.bgmbk\.tv[^"'\s]+\.webp/);
      if (altMatch) return altMatch[0];

      return null;
    } catch {
      if (attempt < retries) await sleep(2000);
    }
  }
  return null;
}

/** Fetch a single md file from GitHub raw with retry */
async function fetchMd(filePath, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const rawUrl = `${RAW_BASE}/${encodeURIComponent(filePath)}`;
      const r = await fetch(rawUrl, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      return await r.text();
    } catch {
      if (attempt < retries) await sleep(3000);
    }
  }
  return null;
}

async function main() {
  log('=== Fetching anime cover URLs from anibk.com ===');

  // Check existing cache
  const fs = await import('fs');
  if (!force && fs.existsSync(OUTPUT_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
      if (existing._timestamp && Date.now() - existing._timestamp < 7 * 24 * 60 * 60 * 1000) {
        const count = Object.keys(existing).filter(k => k !== '_timestamp').length;
        log(`Cache is fresh (< 7 days, ${count} entries). Use --force to override.`);
        return;
      }
    } catch {}
  }

  // 1. Fetch GitHub tree
  log('Fetching GitHub tree...');
  const treeResp = await fetch(TREE_API);
  if (!treeResp.ok) {
    log(`GitHub API error: ${treeResp.status}`);
    process.exit(1);
  }
  const tree = await treeResp.json();

  const animeFiles = tree.tree.filter(
    f => f.type === 'blob' && f.path.includes('番剧大全') && f.path.endsWith('.md') && !f.path.endsWith('index.md')
  );
  log(`Found ${animeFiles.length} anime files`);

  // 2. Fetch all md files, extract title + anibk source URL
  log('Fetching md files to extract anibk source URLs...');
  const animeSources = []; // { title, sourceUrl }
  const BATCH = 5; // small batches to avoid GitHub rate limits
  let mdFetched = 0;
  let sourceFound = 0;

  for (let i = 0; i < animeFiles.length; i += BATCH) {
    const batch = animeFiles.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (file) => {
      const text = await fetchMd(file.path);
      return text ? { path: file.path, text } : null;
    }));

    for (const result of results) {
      if (!result) continue;
      mdFetched++;
      const fm = parseFrontmatter(result.text);
      const filename = result.path.split('/').pop() || '';
      const title = fm.title || filename.replace(/\.md$/i, '').trim();

      if (fm.source && fm.source.includes('anibk.com')) {
        animeSources.push({ title, sourceUrl: fm.source });
        sourceFound++;
      }
    }

    log(`  MD progress: ${Math.min(i + BATCH, animeFiles.length)}/${animeFiles.length} fetched, ${sourceFound} with anibk source`);
    if (i + BATCH < animeFiles.length) await sleep(1000);
  }

  log(`\nGot ${sourceFound} anibk source URLs out of ${mdFetched} md files fetched`);

  if (sourceFound === 0) {
    log('WARNING: No anibk source URLs found! Cannot fetch covers.');
    log('Check if GitHub raw is accessible or if md files have source fields.');
  }

  // 3. Fetch covers from anibk.com using source URLs
  log('\nFetching covers from anibk.com...');
  const covers = { _timestamp: Date.now() };
  let found = 0;
  let failed = 0;

  for (let i = 0; i < animeSources.length; i++) {
    const { title, sourceUrl } = animeSources[i];
    const coverUrl = await anibkGetCover(sourceUrl);

    if (coverUrl) {
      covers[title] = coverUrl;
      found++;
      log(`  ✓ [${i + 1}/${animeSources.length}] ${title}`);
    } else {
      failed++;
      log(`  ✗ [${i + 1}/${animeSources.length}] ${title} - no cover found at ${sourceUrl}`);
    }

    // Rate limiting: wait between requests
    await sleep(500);
  }

  // 4. Save to JSON
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(covers, null, 2));
  log(`\n=== Done: ${found} covers found, ${failed} failed out of ${animeSources.length} anibk URLs ===`);
  log(`Saved to ${OUTPUT_PATH}`);
}

main().catch(err => {
  log(`Error: ${err}`);
  process.exit(1);
});
