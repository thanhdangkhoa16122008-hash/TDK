#!/usr/bin/env node
// build-single.mjs — đóng gói 1 game HTML (index.html + thư viện + kit) thành MỘT file chạy offline.
// Dùng: node html/tools/build-single.mjs html/templates/mobile-3d-starter [ra/file.html]
// Cần esbuild: dùng `npx esbuild` nếu có mạng, hoặc biến môi trường ESBUILD=/đường/dẫn/esbuild.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const gameDir = resolve(process.argv[2] || '.');
const outFile = resolve(process.argv[3] || join(gameDir, 'dist', basename(gameDir) + '.html'));
let html = readFileSync(join(gameDir, 'index.html'), 'utf8');

const esbuild = process.env.ESBUILD || (existsSync('/opt/npm-tools/node_modules/.bin/esbuild') ? '/opt/npm-tools/node_modules/.bin/esbuild' : null);

// 1) đọc importmap
const mapMatch = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
const imports = mapMatch ? JSON.parse(mapMatch[1]).imports : {};
const aliases = [];
for (const [k, v] of Object.entries(imports)) {
  if (k.endsWith('/')) continue; // prefix (vd three/addons/) xử lý bằng plugin đơn giản bên dưới
  aliases.push(`--alias:${k}=${resolve(gameDir, v)}`);
}
const prefixes = Object.entries(imports).filter(([k]) => k.endsWith('/'));

// 2) tách script module nội tuyến
const modMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!modMatch) throw new Error('Không tìm thấy <script type="module"> trong index.html');
let code = modMatch[1];
for (const [k, v] of prefixes) {
  code = code.replaceAll(`'${k}`, `'${resolve(gameDir, v)}/`).replaceAll(`"${k}`, `"${resolve(gameDir, v)}/`);
}
const tmp = join(gameDir, '.build-tmp');
mkdirSync(tmp, { recursive: true });
const entry = join(gameDir, '.build-entry.mjs');
writeFileSync(entry, code);
const bundled = join(tmp, 'bundle.js');
const args = [entry, '--bundle', '--minify', '--format=esm', `--outfile=${bundled}`, '--log-level=warning', ...aliases];
try {
  if (esbuild) execFileSync(esbuild, args, { stdio: 'inherit' });
  else execFileSync('npx', ['--yes', 'esbuild', ...args], { stdio: 'inherit' });
} finally {
  rmSync(entry, { force: true });
}
const js = readFileSync(bundled, 'utf8').replace(/<\/script/gi, '<\\/script');
rmSync(tmp, { recursive: true, force: true });

// 3) ghép lại
html = html.replace(mapMatch?.[0] || '', '');
html = html.replace(modMatch[0], () => `<script type="module">${js}</script>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  const p = resolve(gameDir, src);
  return `<script>${readFileSync(p, 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
});
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`Xong: ${outFile} (${(html.length / 1024).toFixed(0)} KB)`);
