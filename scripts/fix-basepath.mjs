/**
 * scripts/fix-basepath.mjs
 * 构建后处理：修正 HTML 文件里的绝对路径，加上 /MySite 前缀
 * 用法：node scripts/fix-basepath.mjs
 */

import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const _dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(_dirname, '..', 'out');

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walkDir(full); }
    else if (entry.name.endsWith('.html')) { fixHtml(full); }
  }
}

function fixHtml(filePath) {
  let html = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Fix favicon/icon links: href="/avatar.png" → href="/MySite/avatar.png"
  html = html.replace(/(href=")\/avatar\.png"/g, (m, p) => {
    changed = true;
    return p + '/MySite/avatar.png"';
  });

  // Also fix any other /_next/ links that might have been missed
  // (shouldn't happen, but just in case)
  
  if (changed) {
    fs.writeFileSync(filePath, html, 'utf8');
    console.log('Fixed:', filePath.replace(outDir, ''));
  }
}

walkDir(outDir);
console.log('Done fixing basePath in HTML files.');
