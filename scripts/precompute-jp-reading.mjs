// Precompute Japanese kanji->romaji readings for all songs.
// Runs at build time, writes public/jp-readings.json.

import pg from 'pg';
import Kuros from 'kuroshiro';
import KuromojiA from 'kuroshiro-analyzer-kuromoji';
const Kuroshiro = Kuros.default || Kuros;
const KuromojiAnalyzer = KuromojiA.default || KuromojiA;
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load DB URL from .env.local
const envPath = resolve(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL=(.+)/)?.[1]?.trim();
if (!dbUrl) { console.error('DATABASE_URL not found'); process.exit(1); }

const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function main() {
  // Initialize kuroshiro
  const ks = new Kuroshiro();
  await ks.init(new KuromojiAnalyzer());
  console.log('✅ Kuroshiro initialized');

  // Get all music
  const { rows } = await pool.query('SELECT id, title, artist FROM music_list ORDER BY created_at');
  console.log(`📀 ${rows.length} songs loaded`);

  const readings = {};
  for (const row of rows) {
    const text = [row.title, ...(row.artist || [])].join(' ');
    try {
      const romaji = await ks.convert(text, { to: 'romaji', mode: 'normal' });
      readings[row.id] = romaji.toLowerCase();
    } catch (e) {
      readings[row.id] = '';
    }
  }

  // Write output
  const outDir = resolve(__dirname, '..', 'public');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'jp-readings.json'), JSON.stringify(readings));
  console.log(`✅ Written ${Object.keys(readings).length} readings to public/jp-readings.json`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
