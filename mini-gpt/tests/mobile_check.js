// Chạy MiniGPT bằng JS trên đầu vào cho trước, in kết quả JSON để tests/test_mobile.py so với PyTorch.
//   node tests/mobile_check.js model.mgpt input.json
const fs = require('fs');
const { MiniGPTLib } = require('../mobile/minigpt.js');
const [file, inp] = process.argv.slice(2);
const buf = fs.readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const m = MiniGPTLib().load(ab);
const q = JSON.parse(fs.readFileSync(inp, 'utf8'));
const out = { encode: q.texts.map((t) => m.tok.encode(t)), decode_ok: q.texts.map((t) => m.tok.decode(m.tok.encode(t)) === t.normalize('NFC')) };
out.logits = q.seq.map((t, i) => Array.from(m.step(t, i, true)));                  // từng vị trí, qua bộ nhớ đệm KV
out.greedy = Array.from(m.generate(q.prompt, { temperature: 0, repetition_penalty: 1, max_new_tokens: q.n_gen, stop: [] }));
out.chat = m.chatIds(q.messages);
const t0 = Date.now(); let n = 0;
for (const _ of m.generate(q.prompt, { temperature: 0.8, max_new_tokens: 64, stop: [] })) n++;
out.tps = n / ((Date.now() - t0) / 1000);
// Dùng lại bộ nhớ đệm KV giữa các lượt phải cho kết quả y như mô hình mới nạp.
const G = (mm, ids) => Array.from(mm.generate(ids, { temperature: 0, repetition_penalty: 1, max_new_tokens: 12, stop: [] }));
const turn1 = m.chatIds(q.messages.slice(0, 1));
const ans1 = G(m, turn1);                                   // lượt 1 (bộ nhớ đệm giữ lại)
const turn2 = m.chatIds(q.messages);                        // lượt 2: thêm câu trả lời + câu hỏi mới
const reuse = G(m, turn2);
const fresh = G(MiniGPTLib().load(ab), turn2);
const pre = m.chatIds([]).slice(0, -1); m.prime(pre);        // tính sẵn lời nhắc hệ thống rồi hỏi
const primed = G(m, turn1);
out.reuse_ok = JSON.stringify(reuse) === JSON.stringify(fresh) && JSON.stringify(primed) === JSON.stringify(G(MiniGPTLib().load(ab), turn1)) && ans1.length > 0;
out.info = m.info;
console.log(JSON.stringify(out));
