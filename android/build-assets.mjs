// Tạo app/src/main/assets/may-mini.js từ html/kit (Mây mini chạy offline khi chưa tải mô hình).
//   node android/build-assets.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const kit = new URL('../html/kit/', import.meta.url);
const strip = (s) => s.replace(/^export /gm, '');
const out = '// Tự sinh bởi android/build-assets.mjs — đừng sửa tay.\n' +
  strip(readFileSync(new URL('chatbot.js', kit), 'utf8')) + '\n' + strip(readFileSync(new URL('chatbot-data.js', kit), 'utf8'));
writeFileSync(new URL('app/src/main/assets/may-mini.js', import.meta.url), out);
console.log('may-mini.js:', out.length, 'bytes');
