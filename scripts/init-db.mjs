/**
 * scripts/init-db.mjs
 * One-shot database initializer.
 * Reads supabase/schema.sql and executes it against the Supabase PostgreSQL instance.
 *
 * Usage:
 *   node scripts/init-db.mjs
 *
 * Requires DATABASE_URL in .env.local or as an environment variable.
 */
import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// --- Load .env.local manually (no dotenv dependency) ---
const envPath = resolve(projectRoot, '.env.local');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('\x1b[31m[ERROR]\x1b[0m DATABASE_URL not found.');
  console.error('Add it to .env.local:');
  console.error('  DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres\n');
  process.exit(1);
}

const schemaPath = resolve(projectRoot, 'supabase', 'schema.sql');
if (!existsSync(schemaPath)) {
  console.error(`\x1b[31m[ERROR]\x1b[0m schema.sql not found at ${schemaPath}`);
  process.exit(1);
}

const sql = readFileSync(schemaPath, 'utf-8');

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

console.log('\n\x1b[36m[1/3]\x1b[0m Connecting to Supabase PostgreSQL...');
console.log(`       ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}\n`);

try {
  await client.connect();
  console.log('\x1b[32m       Connected.\x1b[0m\n');

  console.log('\x1b[36m[2/3]\x1b[0m Executing schema.sql...');
  console.log(`       (${sql.length.toLocaleString()} bytes)\n`);

  await client.query(sql);

  console.log('\x1b[32m       Schema executed successfully.\x1b[0m\n');

  // --- Verify ---
  console.log('\x1b[36m[3/3]\x1b[0m Verifying tables...\n');

  const { rows } = await client.query(`
    select tablename
    from pg_tables
    where schemaname = 'public'
    order by tablename;
  `);

  for (const row of rows) {
    const { rows: countRows } = await client.query(
      `select count(*) as cnt from public.${row.tablename}`
    );
    const count = parseInt(countRows[0].cnt, 10);
    console.log(`       \x1b[32m\u2713\x1b[0m ${row.tablename.padEnd(20)} ${count} rows`);
  }

  // Check RLS
  const { rows: rlsRows } = await client.query(`
    select tablename, rowsecurity
    from pg_tables
    where schemaname = 'public'
    order by tablename;
  `);

  console.log('\n       RLS status:');
  for (const row of rlsRows) {
    const status = row.rowsecurity ? '\x1b[32mON\x1b[0m' : '\x1b[31mOFF\x1b[0m';
    console.log(`       ${row.tablename.padEnd(20)} ${status}`);
  }

  // Check functions
  const { rows: fnRows } = await client.query(`
    select proname
    from pg_proc
    where pronamespace = (select oid from pg_namespace where nspname = 'public')
    order by proname;
  `);

  console.log('\n       RPC functions:');
  for (const row of fnRows) {
    console.log(`       \x1b[32m\u2713\x1b[0m ${row.proname}`);
  }

  console.log('\n\x1b[32m\u2713 Database initialized successfully!\x1b[0m\n');
} catch (err) {
  console.error('\n\x1b[31m[ERROR]\x1b[0m Failed to initialize database:\n');
  console.error(`  ${err.message}\n`);
  if (err.position) {
    const pos = parseInt(err.position, 10);
    const around = sql.slice(Math.max(0, pos - 100), pos + 100);
    console.error('  Near:\n');
    console.error(`    ...${around}...\n`);
  }
  process.exit(1);
} finally {
  await client.end();
}
