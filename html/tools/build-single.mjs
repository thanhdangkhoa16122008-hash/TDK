#!/usr/bin/env node
// build-single.mjs — đóng gói 1 game HTML (index.html + thư viện + kit) thành MỘT file chạy offline.
// Dùng: node html/tools/build-single.mjs html/templates/adventure-3d-starter [ra/file.html]
// Cần gói esbuild: tự tìm ở /opt/npm-tools, thư mục gốc repo, hoặc chạy `npm i -D esbuild` một lần.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(new URL(import.meta.url).pathname);
const req = createRequire(import.meta.url);
let esbuild;
for (const p of ['esbuild', '/opt/npm-tools/node_modules/esbuild', resolve(here, '../../node_modules/esbuild')]) {
  try { esbuild = req(p); break; } catch {}
}
if (!esbuild) { console.error('Thiếu esbuild. Chạy: npm i -D esbuild'); process.exit(1); }

const gameDir = resolve(process.argv[2] || '.');
const outFile = resolve(process.argv[3] || join(gameDir, 'dist', basename(gameDir) + '.html'));
let html = readFileSync(join(gameDir, 'index.html'), 'utf8');

// 1) importmap → plugin phân giải 'three', 'three/addons/...', 'cannon-es' cho MỌI file (cả kit/)
const mapMatch = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
const imports = mapMatch ? JSON.parse(mapMatch[1]).imports : {};
const importMapPlugin = {
  name: 'importmap',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (imports[args.path]) return { path: resolve(gameDir, imports[args.path]) };
      const pre = Object.keys(imports).filter((k) => k.endsWith('/') && args.path.startsWith(k)).sort((a, b) => b.length - a.length)[0];
      if (pre) return { path: resolve(gameDir, imports[pre], args.path.slice(pre.length)) };
      return null;
    });
  },
};

// 2) đóng gói script module nội tuyến
const modMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!modMatch) throw new Error('Không tìm thấy <script type="module"> trong index.html');
const result = await esbuild.build({
  stdin: { contents: modMatch[1], resolveDir: gameDir, sourcefile: 'index.html.js', loader: 'js' },
  bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, logLevel: 'warning',
  plugins: [importMapPlugin],
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// 3) nhúng asset (model/âm thanh) được nhắc tới bằng chuỗi 'models/...', 'sounds/...', 'textures/...'
const assetsRoot = resolve(here, '..', 'assets');
const mime = { glb: 'model/gltf-binary', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', png: 'image/png', jpg: 'image/jpeg' };
const found = new Set();
for (const m of js.matchAll(/["'`]((?:models|sounds|textures)\/[^"'`\s]+\.(glb|mp3|ogg|wav|png|jpg))["'`]/g)) found.add(m[1]);
const assetMap = {};
let assetBytes = 0;
for (const p of found) {
  const f = join(assetsRoot, p);
  if (!existsSync(f)) { console.warn('  ! không thấy asset:', p); continue; }
  const buf = readFileSync(f);
  assetBytes += buf.length;
  assetMap[p] = `data:${mime[p.split('.').pop()]};base64,${buf.toString('base64')}`;
}
if (found.size) console.log(`  nhúng ${Object.keys(assetMap).length} asset (${(assetBytes / 1024).toFixed(0)} KB)`);
const assetScript = Object.keys(assetMap).length ? `<script>window.__ASSETS=${JSON.stringify(assetMap)};</script>` : '';

// 4) ghép lại
html = html.replace(mapMatch?.[0] || '', '');
html = html.replace(modMatch[0], () => `${assetScript}<script type="module">${js}</script>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  const p = resolve(gameDir, src);
  return `<script>${readFileSync(p, 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
});
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`Xong: ${outFile} (${(html.length / 1024).toFixed(0)} KB)`);
