#!/usr/bin/env node
// test-game.mjs — chạy thử game trong Chrome không giao diện như một điện thoại màn ngang:
// bắt lỗi JS, đo FPS, giả lập điều khiển (đi, nhảy, kéo camera), chụp ảnh màn hình.
// Dùng:  node html/tools/test-game.mjs <đường dẫn index.html hoặc file .html> [--out thư-mục] [--seconds 6]
//        [--portrait] [--click "#play"] [--keys "KeyW:2,Space,KeyD:1"]
// Kết quả: in báo cáo + ảnh shot-*.png. Thoát mã 1 nếu có lỗi JS.
// Lưu ý: Chrome ở đây dựng hình bằng CPU (SwiftShader), nên FPS thấp hơn điện thoại thật nhiều lần —
// dùng FPS để so sánh tương đối giữa các bản, không phải con số tuyệt đối.
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join, extname, relative, dirname } from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const target = resolve(args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) || '.');
const out = resolve(opt('--out', '.'));
const seconds = Number(opt('--seconds', 6));
const clickSel = opt('--click', '#play, #start button, button.start');
const keys = opt('--keys', 'KeyW:1.5,Space,KeyD:1,KeyW:1');
const portrait = args.includes('--portrait');

const pwPath = (() => {
  try { return join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs'); } catch { return 'playwright'; }
})();
const { chromium } = await import(existsSync(pwPath) ? pwPath : 'playwright');

// phục vụ cả repo để đường dẫn tương đối ../../libs hoạt động
const repo = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const file = statSync(target).isDirectory() ? join(target, 'index.html') : target;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.png': 'image/png', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const p = join(repo, decodeURIComponent(q.url.split('?')[0]));
  if (!existsSync(p) || statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  r.end(readFileSync(p));
}).listen(0);
const port = srv.address().port;
const rel = relative(repo, file);
const query = opt('--query', '');
const url = (rel.startsWith('..') ? 'file://' + file : `http://localhost:${port}/${rel}`) + (query ? '?' + query : '');

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'] });
const vp = portrait ? { width: 390, height: 844 } : { width: 844, height: 390 };
const page = await browser.newPage({ viewport: vp, hasTouch: true, deviceScaleFactor: Number(opt("--dpr", 1)), userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile TDK-Test' });
const errors = [], warns = [], logs = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errors.push(t); else if (m.type() === 'warning') warns.push(t); else logs.push(t);
});
page.on('requestfailed', (r) => errors.push('Không tải được: ' + r.url().replace(`http://localhost:${port}`, '')));
await page.addInitScript(() => {
  window.__fps = []; let last = performance.now(), n = 0, acc = 0;
  const f = (t) => { n++; acc += t - last; last = t; if (acc >= 1000) { window.__fps.push(n * 1000 / acc); n = 0; acc = 0; } requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const loadMs = Date.now() - t0;
await page.screenshot({ path: join(out, 'shot-1-start.png') });

const btn = await page.$(clickSel);
if (btn) { await btn.click(); await page.waitForTimeout(800); }
// kịch bản phím
for (const step of keys.split(',').filter(Boolean)) {
  const [k, dur] = step.split(':');
  if (dur) { await page.keyboard.down(k); await page.waitForTimeout(Number(dur) * 1000); await page.keyboard.up(k); }
  else { await page.keyboard.press(k); await page.waitForTimeout(400); }
}
// kéo camera ở nửa phải (giống vuốt trên điện thoại)
await page.mouse.move(vp.width * 0.75, vp.height * 0.5);
await page.mouse.down();
await page.mouse.move(vp.width * 0.75 + 120, vp.height * 0.5, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, 'shot-2-play.png') });
await page.waitForTimeout(Math.max(0, seconds * 1000 - 4000));
await page.screenshot({ path: join(out, 'shot-3-later.png') });

const fps = await page.evaluate(() => window.__fps.slice(1));
const stats = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return { canvas: c ? `${c.width}x${c.height}` : 'KHÔNG CÓ', memMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, game: window.__game?.stats?.() || null };
});
await browser.close();
srv.close();

const avg = fps.length ? fps.reduce((a, b) => a + b) / fps.length : 0;
console.log(`\n== Kiểm tra: ${relative(process.cwd(), file)}`);
console.log(`Tải trang: ${loadMs} ms | Canvas: ${stats.canvas} | RAM JS: ${stats.memMB ?? '?'} MB`);
console.log(`FPS (giả lập CPU): tb ${avg.toFixed(1)}, thấp nhất ${fps.length ? Math.min(...fps).toFixed(1) : '-'}`);
if (stats.game) console.log('Game:', JSON.stringify(stats.game));
console.log(`Lỗi: ${errors.length ? '\n  - ' + [...new Set(errors)].join('\n  - ') : 'không có'}`);
if (warns.length) console.log(`Cảnh báo (${warns.length}): ${[...new Set(warns)].slice(0, 5).join(' | ')}`);
if (logs.length) console.log(`Log: ${[...new Set(logs)].slice(0, 8).join(' | ')}`);
console.log(`Ảnh: ${join(out, 'shot-{1-start,2-play,3-later}.png')}`);
process.exit(errors.length ? 1 : 0);
