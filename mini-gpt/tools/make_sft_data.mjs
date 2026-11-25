// Tạo data/sft_vi.jsonl (dữ liệu dạy hội thoại) từ dữ liệu sẵn có trong repo:
//   html/kit/chatbot-data.js (51 chủ đề + 84 mục kiến thức) và ai-studio/data/chat_vi.jsonl (hội thoại viết tay).
//   node tools/make_sft_data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { INTENTS, KNOWLEDGE } from '../../html/kit/chatbot-data.js';

let seed = 7;
const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const fill = (s) => s.replace(/\{name\}/g, 'bạn').replace(/\{bot\}/g, 'Mây').replace(/\{ask:name\}/g, '').trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Chủ đề có câu trả lời động (giờ, trò chơi…) → câu trả lời tĩnh hợp lý cho mô hình học.
const STATIC = {
  hoi_gio: ['Mình không xem được đồng hồ, bạn nhìn góc màn hình điện thoại nhé.'],
  hoi_ngay: ['Mình không biết hôm nay là ngày nào vì không có lịch, bạn xem trên điện thoại nhé.'],
  hoi_ten_user: ['Bạn chưa cho mình biết tên. Bạn tên gì nhỉ?'],
  lap_lai: ['Bạn muốn mình nói lại phần nào? Mình giải thích lại ngắn gọn hơn nhé.'],
  hoi_lai: ['Mình vẫn ổn, cảm ơn bạn đã hỏi! Còn bạn thì sao?'],
  cau_do: ['Câu đố: Cái gì càng lau càng ướt? Đáp án: cái khăn lau!', 'Câu đố: Cái gì có răng mà không cắn? Đáp án: cái lược.'],
  choi_doan_so: ['Mình nghĩ một số từ 1 đến 10, bạn đoán thử xem! (Mình là mô hình nhỏ nên chỉ chơi vui thôi nhé.)'],
  ngoai_pham_vi: ['Câu này mình chưa biết, mình là mô hình nhỏ nên kiến thức còn hạn chế.', 'Mình không chắc về điều này. Bạn thử tra trên mạng để có thông tin chính xác nhé.'],
};

const convs = [];
const single = [];
for (const it of INTENTS) {
  const answers = STATIC[it.tag] || it.responses.filter((r) => typeof r === 'string' && !/\{(time|date|weekday)\}/.test(r)).map(fill);
  if (!answers.length) continue;
  it.patterns.forEach((p, i) => {
    const pair = [{ role: 'user', content: cap(p) }, { role: 'assistant', content: answers[i % answers.length] }];
    single.push(pair);
    convs.push({ messages: pair });
  });
}
for (const k of KNOWLEDGE) for (const q of k.q) {
  const pair = [{ role: 'user', content: cap(q) + '?' }, { role: 'assistant', content: k.a }];
  single.push(pair);
  convs.push({ messages: pair });
}
// Ghép ngẫu nhiên thành hội thoại 2–3 lượt để mô hình quen nhìn ngữ cảnh nhiều lượt.
for (let i = 0; i < 300; i++) {
  const n = 2 + Math.floor(rnd() * 2);
  convs.push({ messages: Array.from({ length: n }, () => pick(single)).flat() });
}
// Hội thoại viết tay chất lượng cao: lặp 3 lần để có trọng số lớn hơn.
const hand = readFileSync(new URL('../../ai-studio/data/chat_vi.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
for (let r = 0; r < 3; r++) convs.push(...hand);

writeFileSync(new URL('../data/sft_vi.jsonl', import.meta.url), convs.map((c) => JSON.stringify(c)).join('\n') + '\n');
console.log(`data/sft_vi.jsonl: ${convs.length} hội thoại (${single.length} cặp hỏi–đáp, 300 hội thoại ghép, ${hand.length}×3 viết tay)`);
