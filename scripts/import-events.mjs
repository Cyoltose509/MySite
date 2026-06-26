/**
 * scripts/import-events.mjs
 *
 * 从 data.csv 解析事件记录，通过 RPC 导入 event_logs 表。
 * 运行前确保：
 *   1. 已执行 supabase/migration-v4.sql
 *   2. .env.local 里有 SUPABASE 凭证
 *   3. 在 .env.local 里加 ADMIN_PASSWORD=zs235711131719（或你的管理员密码）
 *
 * 用法：node scripts/import-events.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

// 手动加载 .env.local
const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);
const envPath = join(_dirname, '..', '.env.local');

const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  envVars[key] = val;
}

const supabase = createClient(
  envVars.NEXT_PUBLIC_SUPABASE_URL,
  envVars.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 管理员密码（从 .env.local 的 ADMIN_PASSWORD 读取，或手动填这里）
const ADMIN_PASSWORD = envVars.ADMIN_PASSWORD || 'zs235711131719';
const ADMIN_HASH = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');

/**
 * 解析 data.csv
 */
function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let currentGroup = '';
  let currentDate = '';
  const events = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 分组标题行
    if (!line.includes(',') && ['炉管', '奶茶', '唱k', '户外唱歌'].includes(line)) {
      currentGroup = line;
      continue;
    }

    // 日期行 YYYY/MM/DD
    if (!line.includes(',') && /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(line)) {
      currentDate = line;
      continue;
    }

    // 时间戳行：HH:MM:SS.mmm, 1
    if (line.includes(',') && /^\d{1,2}:\d{2}:\d{2}\.\d+,\s*1$/.test(line)) {
      if (!currentGroup || !currentDate) continue;
      const [timeStr] = line.split(',');
      const t = timeStr.trim();
      const [yyyy, mm, dd] = currentDate.split('/');
      const isoDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      // 加 +08:00 时区后缀（CSV 里是北京时间）
      events.push({ group: currentGroup, event_at: `${isoDate}T${t}+08:00` });
    }
  }

  return events;
}

async function main() {
  const args = process.argv.slice(2);
  const shouldClear = args.includes('--clear') || args.includes('-c');

  console.log('解析 data.csv ...');
  const events = parseCsv(join(_dirname, '..', 'data.csv'));
  console.log(`共解析到 ${events.length} 条事件记录`);

  if (events.length === 0) {
    console.error('没有解析到任何记录，请检查 data.csv 格式');
    process.exit(1);
  }

  // 获取事件组
  console.log('获取事件组 ...');
  const { data: groups, error: gErr } = await supabase
    .from('event_groups')
    .select('id, name');
  if (gErr) { console.error('获取事件组失败:', gErr.message); process.exit(1); }

  const groupMap = {};
  for (const g of groups) groupMap[g.name] = g.id;
  console.log('事件组:', Object.keys(groupMap).join(', '));

  // 清空已有数据
  if (shouldClear) {
    console.log('');
    console.log('正在清空已有记录...');
    const { error: clearErr } = await supabase.rpc('fn_clear_event_logs', { p_hash: ADMIN_HASH });
    if (clearErr) {
      console.error('清空失败:', clearErr.message);
      console.log('尝试逐条删除...');
      let offset = 0;
      let totalDeleted = 0;
      while (true) {
        const { data: logs, error: fErr } = await supabase
          .from('event_logs')
          .select('id')
          .range(offset, offset + 99);
        if (fErr || !logs || logs.length === 0) break;
        for (const log of logs) {
          const { error: dErr } = await supabase.rpc('fn_delete_event_log', {
            p_hash: ADMIN_HASH,
            p_log_id: log.id,
          });
          if (!dErr) totalDeleted++;
        }
        if (logs.length < 100) break;
        offset += 100;
      }
      console.log(`已删除 ${totalDeleted} 条旧记录`);
    } else {
      console.log('已清空所有旧记录');
    }
    console.log('');
  }

  // 分批通过 RPC 插入（每批50条，并行调用）
  const BATCH = 50;
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH);
    const promises = batch
      .filter(e => groupMap[e.group])
      .map(e =>
        supabase.rpc('fn_log_event', {
          p_hash: ADMIN_HASH,
          p_group_id: groupMap[e.group],
          p_event_at: e.event_at,
        }).then(({ error }) => {
          if (error) {
            failed++;
            return { ok: false, err: error.message, e };
          }
          inserted++;
          return { ok: true };
        })
      );

    const results = await Promise.all(promises);
    const errs = results.filter(r => !r.ok).slice(0, 3);
    if (errs.length) {
      console.warn(`批次 ${Math.floor(i / BATCH) + 1}: ${errs.length} 条失败`);
      for (const e of errs) console.warn('  ', e.err);
    } else {
      console.log(`批次 ${Math.floor(i / BATCH) + 1}/${Math.ceil(events.length / BATCH)}: 完成 (累计 ${inserted})`);
    }
  }

  console.log('');
  console.log(`✅ 导入完成！成功 ${inserted} 条，失败 ${failed} 条`);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
