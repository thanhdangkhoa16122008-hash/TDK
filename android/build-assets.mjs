// Tạo assets cho app: may-mini.js (từ html/kit) và minigpt.js (từ mini-gpt/mobile).
//   node android/build-assets.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const kit = new URL('../html/kit/', import.meta.url);
const strip = (s) => s.replace(/^export /gm, '');
const out = '// Tự sinh bởi android/build-assets.mjs — đừng sửa tay.\n' +
  strip(readFileSync(new URL('chatbot.js', kit), 'utf8')) + '\n' + strip(readFileSync(new URL('chatbot-data.js', kit), 'utf8'));
writeFileSync(new URL('app/src/main/assets/may-mini.js', import.meta.url), out);
console.log('may-mini.js:', out.length, 'bytes');
// Bộ chạy MiniGPT (một nguồn duy nhất: mini-gpt/mobile/minigpt.js)
const mg = readFileSync(new URL('../mini-gpt/mobile/minigpt.js', import.meta.url), 'utf8');
writeFileSync(new URL('app/src/main/assets/minigpt.js', import.meta.url), '// Tự sinh từ mini-gpt/mobile/minigpt.js — đừng sửa tay.\n' + mg);
console.log('minigpt.js:', mg.length, 'bytes');
