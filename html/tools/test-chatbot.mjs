// test-chatbot.mjs — huấn luyện chatbot và đo chất lượng trên câu CHƯA từng thấy.
//   node html/tools/test-chatbot.mjs            → báo cáo
//   node html/tools/test-chatbot.mjs --chat     → chat thử trong terminal
import { createChatbot } from '../kit/chatbot.js';
import { INTENTS, KNOWLEDGE } from '../kit/chatbot-data.js';
import readline from 'node:readline';

const make = () => createChatbot({ intents: structuredClone(INTENTS.map((i) => ({ ...i, responses: [] }))).map((i, k) => ({ ...i, responses: INTENTS[k].responses })), knowledge: structuredClone(KNOWLEDGE), botName: 'Mây' });
const bot = make();
const t0 = performance.now();
const info = bot.train();
console.log(`Train: ${info.patterns} câu mẫu → ${info.samples} sau nhân dữ liệu, ${info.intents} chủ đề, ${info.facts} mục kiến thức, ${(performance.now() - t0).toFixed(0)} ms, đúng tập học ${(info.trainAccuracy * 100).toFixed(1)}%`);

// 1) Ý định — câu không có trong dữ liệu (không dấu, viết tắt, gõ sai, thêm từ đệm)
const INTENT_TEST = [
  ['chao ban nhe', 'chao_hoi'], ['xin chào bạn nhỏ', 'chao_hoi'], ['helo', 'chao_hoi'], ['chào buổi trưa', 'chao_hoi'],
  ['tam biet nhe', 'tam_biet'], ['mình phải đi rồi hẹn gặp lại', 'tam_biet'], ['thôi mình đi đây', 'tam_biet'],
  ['cam on ban nhieu', 'cam_on'], ['thank bạn', 'cam_on'], ['cảm ơn mây nhé', 'cam_on'],
  ['ban ten la gi vay', 'hoi_ten_bot'], ['cho hỏi bạn là ai thế', 'hoi_ten_bot'],
  ['ban co nho ten minh khong', 'hoi_ten_user'],
  ['dạo này bạn khỏe không', 'hoi_tham'], ['ban on chu', 'hoi_tham'],
  ['hôm nay mình rất vui', 'cam_xuc_vui'], ['toi on ma', 'cam_xuc_vui'],
  ['hôm nay mình buồn lắm', 'cam_xuc_buon'], ['toi met moi qua', 'cam_xuc_buon'], ['mình thấy cô đơn quá', 'cam_xuc_buon'],
  ['chán ghê không biết làm gì', 'chan'], ['bực quá đi mất', 'tuc_gian'], ['mình sợ lắm', 'so_hai'],
  ['ban may tuoi', 'hoi_tuoi'], ['ai lập trình ra bạn vậy', 'hoi_nguoi_tao'], ['bạn có phải người thật không', 'hoi_la_may'],
  ['bạn có thể giúp gì cho tôi', 'kha_nang'], ['bạn sống ở đâu thế', 'hoi_o_dau'],
  ['may gio roi ban', 'hoi_gio'], ['hom nay thu may', 'hoi_ngay'],
  ['ke chuyen cuoi di', 'chuyen_cuoi'], ['kể một câu chuyện hài', 'chuyen_cuoi'], ['đố mình một câu', 'cau_do'], ['chơi trò đoán số đi', 'choi_doan_so'],
  ['ban thong minh that', 'khen'], ['bạn ngốc quá', 'che'], ['hahaha', 'cuoi'],
  ['ok luôn', 'dong_y'], ['khong can dau', 'tu_choi'], ['xin loi nhe', 'xin_loi'], ['hôm nay trời mưa không', 'thoi_tiet'],
  ['đói quá ăn gì giờ', 'doi_bung'], ['buon ngu qua di', 'buon_ngu'], ['đau đầu quá trời', 'suc_khoe'],
  ['ban thich lam gi', 'so_thich'], ['làm sao học tốt hơn', 'hoc_tap'], ['tôi muốn học làm game', 'lam_game'],
  ['bạn có người yêu không', 'tinh_yeu'], ['còn bạn thì sao', 'hoi_lai'], ['hôm nay là sinh nhật mình', 'chuc_mung'],
  ['gợi ý cho mình bài hát hay', 'am_nhac'], ['tối nay nên xem phim gì', 'phim'], ['bạn tính toán được không', 'tinh_toan'],
];
// 2) Ngoài phạm vi — phải nói "không biết", không được đoán bừa
const OOS_TEST = ['giá vàng thế giới tăng mạnh', 'bóng đá tối nay ai thắng', 'đặt giúp tôi một chiếc taxi', 'xyzzy plugh', 'nồi cơm điện bị hỏng',
  'tổng thống pháp là ai', 'cho tôi số điện thoại của bạn', 'cái ghế gỗ', 'mở youtube lên', 'thủ đô của wakanda là gì', 'hôm qua tôi đi chợ mua rau', 'chiếc xe màu đỏ'];
// 3) Kiến thức — hỏi khác cách viết trong kho
const KB_TEST = [['thủ đô nước Pháp là gì', 'Paris'], ['thu do nhat ban', 'Tokyo'], ['nui nao cao nhat viet nam', 'Fansipan'], ['he mat troi co may hanh tinh', '8 hành tinh'],
  ['số pi là bao nhiêu vậy', '3,14'], ['ai viết truyện kiều thế', 'Nguyễn Du'], ['nước sôi bao nhiêu độ c', '100'], ['con vật nào to nhất thế giới', 'cá voi xanh'],
  ['thủ đô của úc là thành phố nào', 'Canberra'], ['trí tuệ nhân tạo là cái gì', 'AI'], ['diện tích hình tròn', 'π'], ['việt nam có mấy dân tộc', '54']];

let ok = 0; const fails = [];
for (const [q, want] of INTENT_TEST) { const r = make2(q); if (r.intent === want) ok++; else fails.push(`  "${q}" → ${r.intent} (${(r.confidence * 100).toFixed(0)}%), cần ${want}`); }
function make2(q) { const b = bot; b.ctx.game = null; b.ctx.expect = null; const r = b.reply(q); b.ctx.game = null; return r; }
let oosOk = 0; for (const q of OOS_TEST) { const r = make2(q); if (r.intent === 'khong_hieu') oosOk++; else fails.push(`  [ngoài phạm vi] "${q}" → ${r.intent}: ${r.text}`); }
let kbOk = 0; for (const [q, want] of KB_TEST) { const r = make2(q); if (r.text.toLowerCase().includes(want.toLowerCase())) kbOk++; else fails.push(`  [kiến thức] "${q}" → ${r.intent}: ${r.text}`); }

// 4) Hội thoại nhiều lượt
const D = [];
const b2 = make(); b2.train();
const say = (q) => b2.reply(q).text;
say('xin chào'); say('bạn tên gì'); D.push(['trả lời tên ngắn sau khi bot hỏi', /Khoa/.test(say('Khoa'))]);
D.push(['nhớ tên', /Khoa/.test(say('bạn có nhớ tên mình không'))]);
say('bạn khỏe không'); D.push(['hỏi lại "còn bạn?" theo ngữ cảnh', /ổn/.test(say('còn bạn thì sao'))]);
D.push(['câu ghép 2 ý', b2.reply('chào bạn, hôm nay mình buồn quá').parts.length === 2]);
say('chơi đoán số'); const n = b2.ctx.game.n; D.push(['đoán số: gợi ý lớn/nhỏ', /(nhỏ|lớn) hơn/.test(say(String(n === 50 ? 49 : 50)))]);
D.push(['đoán số: đoán đúng', /Chính xác/.test(say(String(n)))]);
say('đố vui'); D.push(['câu đố: chịu → đáp án', /Đáp án/.test(say('chịu'))]);
D.push(['toán: 2 mũ 10', /1024/.test(say('2 mũ 10'))]); D.push(['toán: căn 144', /12/.test(say('căn 144'))]); D.push(['toán: (2+3)*4', /20/.test(say('(2+3)*4'))]);
const learnBot = make(); learnBot.train();
const before = learnBot.reply('mệt xỉu luôn á').intent; learnBot.teach('mệt xỉu luôn á', 'cam_xuc_buon');
D.push(['dạy thêm câu mới', learnBot.reply('mệt xỉu luôn á').intent === 'cam_xuc_buon' && learnBot.reply('xin chào').intent === 'chao_hoi']);
learnBot.learnAnswer('trường của mình tên là gì', 'Trường THPT Nguyễn Du.'); D.push(['dạy kiến thức mới', /Nguyễn Du/.test(learnBot.reply('trường mình tên gì').text)]);

const pct = (a, b) => `${a}/${b} (${(a / b * 100).toFixed(0)}%)`;
console.log(`Hiểu ý định (câu chưa thấy): ${pct(ok, INTENT_TEST.length)}`);
console.log(`Biết nói "không biết":       ${pct(oosOk, OOS_TEST.length)}`);
console.log(`Trả lời kiến thức:           ${pct(kbOk, KB_TEST.length)}`);
console.log(`Hội thoại & kỹ năng:         ${pct(D.filter((d) => d[1]).length, D.length)}`);
D.filter((d) => !d[1]).forEach((d) => console.log('  [hội thoại] SAI: ' + d[0]));
if (fails.length) console.log('Sai:\n' + fails.join('\n'));
console.log(`(trước khi dạy, "mệt xỉu luôn á" → ${before})`);

if (process.argv.includes('--chat')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'Bạn: ' });
  rl.prompt(); rl.on('line', (l) => { const r = b2.reply(l); console.log(`Mây: ${r.text}  [${r.intent} ${(r.confidence * 100).toFixed(0)}%]`); rl.prompt(); });
} else process.exit(ok / INTENT_TEST.length >= 0.85 && oosOk / OOS_TEST.length >= 0.75 && kbOk / KB_TEST.length >= 0.8 && D.every((d) => d[1]) ? 0 : 1);
