// test-chatbot.mjs — huấn luyện chatbot và đo độ chính xác trên câu CHƯA từng thấy.
//   node html/tools/test-chatbot.mjs            → báo cáo độ chính xác
//   node html/tools/test-chatbot.mjs --chat     → chat thử trong terminal
//   node html/tools/test-chatbot.mjs --export   → lưu model đã train ra html/kit/chatbot-model.json
import { createChatbot } from '../kit/chatbot.js';
import { INTENTS } from '../kit/chatbot-data.js';
import { writeFileSync } from 'node:fs';
import readline from 'node:readline';

const bot = createChatbot({ intents: INTENTS, botName: 'Mây' });
const t0 = performance.now();
const info = bot.train();
console.log(`Train: ${info.samples} câu, ${info.intents} ý định, ${(performance.now() - t0).toFixed(0)} ms, đúng trên tập học ${(info.trainAccuracy * 100).toFixed(1)}%`);

// Câu kiểm tra: không trùng câu mẫu; có câu không dấu, viết tắt, gõ sai.
const TEST = [
  ['chao ban nhe', 'chao_hoi'], ['xin chào bạn nhỏ', 'chao_hoi'], ['helo', 'chao_hoi'],
  ['tam biet nhe', 'tam_biet'], ['mình phải đi rồi, hẹn gặp lại', 'tam_biet'],
  ['cam on ban nhieu', 'cam_on'], ['thank bạn', 'cam_on'],
  ['ban ten la gi vay', 'hoi_ten_bot'], ['cho hỏi bạn là ai thế', 'hoi_ten_bot'],
  ['ban co nho ten minh khong', 'hoi_ten_user'],
  ['dạo này bạn khỏe không', 'hoi_tham'], ['ban on chu', 'hoi_tham'],
  ['hôm nay mình rất vui', 'cam_xuc_vui'], ['toi on ma', 'cam_xuc_vui'],
  ['hôm nay mình buồn lắm', 'cam_xuc_buon'], ['toi met moi qua', 'cam_xuc_buon'],
  ['chán ghê không biết làm gì', 'chan'],
  ['ban may tuoi', 'hoi_tuoi'], ['ai lập trình ra bạn vậy', 'hoi_nguoi_tao'],
  ['bạn có thể giúp gì cho tôi', 'kha_nang'],
  ['may gio roi ban', 'hoi_gio'], ['hom nay thu may', 'hoi_ngay'],
  ['ke chuyen cuoi di', 'chuyen_cuoi'], ['kể một câu chuyện hài', 'chuyen_cuoi'],
  ['ban thong minh that', 'khen'], ['bạn ngốc quá', 'che'],
  ['ok luôn', 'dong_y'], ['khong can dau', 'tu_choi'],
  ['xin loi nhe', 'xin_loi'], ['hôm nay trời mưa không', 'thoi_tiet'],
  ['đói quá ăn gì giờ', 'doi_bung'], ['buon ngu qua di', 'buon_ngu'],
  ['ban thich choi game khong', 'so_thich'], ['làm sao học tốt hơn', 'hoc_tap'],
  ['tôi muốn học làm game', 'lam_game'], ['ban biet tinh toan khong', 'tinh_toan'],
];

let ok = 0; const fails = [];
for (const [q, want] of TEST) {
  const [top] = bot.predict(q);
  if (top.intent === want && top.confidence >= 0.25) ok++; else fails.push(`  "${q}" → ${top.intent} (${(top.confidence * 100).toFixed(0)}%), cần ${want}`);
}
console.log(`Câu chưa thấy: ${ok}/${TEST.length} đúng (${(ok / TEST.length * 100).toFixed(1)}%)`);
if (fails.length) console.log('Sai:\n' + fails.join('\n'));

// Kỹ năng ngoài mô hình
const checks = [
  ['12 nhân 3', /36/], ['10 chia 4', /2,5/], ['(2+3)*4', /20/],
  ['tên tôi là khoa', /Khoa/], ['tên tôi là gì', /Khoa/],
  ['asdkjh qwe zzz', null],
];
let ok2 = 0;
for (const [q, re] of checks) {
  const r = bot.reply(q);
  const pass = re ? re.test(r.text) : r.intent === 'khong_hieu';
  if (pass) ok2++; else console.log(`  KỸ NĂNG SAI: "${q}" → ${r.text}`);
}
console.log(`Kỹ năng (toán, nhớ tên, nhận biết câu lạ): ${ok2}/${checks.length}`);

if (process.argv.includes('--export')) {
  writeFileSync(new URL('../kit/chatbot-model.json', import.meta.url), JSON.stringify(bot.toJSON()));
  console.log('Đã lưu html/kit/chatbot-model.json');
}
if (process.argv.includes('--chat')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'Bạn: ' });
  rl.prompt();
  rl.on('line', (l) => { const r = bot.reply(l); console.log(`Mây: ${r.text}  [${r.intent} ${(r.confidence * 100).toFixed(0)}%]`); rl.prompt(); });
} else process.exit(ok / TEST.length >= 0.8 && ok2 === checks.length ? 0 : 1);
