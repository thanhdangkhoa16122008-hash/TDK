// Tự sinh bởi android/build-assets.mjs — đừng sửa tay.
// chatbot.js — mô hình AI giao tiếp tiếng Việt, chạy offline, không cần thư viện.
//
// Bên trong:
//   1. Bộ phân loại ý định: hồi quy softmax trên đặc trưng băm (từ, cặp từ, cụm 3 ký tự) → hiểu câu
//      không dấu, gõ sai nhẹ. Dữ liệu được tự nhân lên (thêm "nhé/ạ/ơi…", lỗi gõ) khi huấn luyện.
//   2. Lớp "ngoài phạm vi" (OOS) → biết nói "không biết" thay vì trả lời bừa.
//   3. Kho kiến thức hỏi–đáp: tìm câu hỏi gần nhất bằng cosine có trọng số IDF.
//   4. Ngữ cảnh nhiều lượt: nhớ tên, hỏi lại ("còn bạn?"), nhắc lại, trò chơi đoán số / câu đố,
//      tách câu ghép ("chào bạn, mình buồn quá").
//   5. Học thêm khi đang chạy: bot.teach(câu, chủ đề), bot.learnAnswer(câu hỏi, câu trả lời).
//
//   import { createChatbot } from '../../kit/chatbot.js';
//   import { INTENTS, KNOWLEDGE } from '../../kit/chatbot-data.js';
//   const bot = createChatbot({ intents: INTENTS, knowledge: KNOWLEDGE, botName: 'Mây' });
//   bot.train();                       // ~1 giây
//   bot.reply('xin chao')              // → { text, intent, confidence, parts }
//   bot.teach('mệt xỉu luôn', 'cam_xuc_buon');  bot.learnAnswer('trường mình tên gì', 'THPT ABC');
//   bot.fallback = async (text, ctx) => '...'   // tuỳ chọn: câu khó chuyển sang LLM (dùng replyAsync)
//
// Intent: { tag, label, patterns: [...], responses: [...] }. Câu trả lời là chuỗi hoặc hàm (ctx) => chuỗi.
//   Biến trong câu trả lời: {name} {bot} {time} {date} {weekday}; {ask:name} = bot chờ người dùng nói tên.

const OOS = 'ngoai_pham_vi';
const D = 1 << 13;

function normalize(s) { // bỏ dấu, giữ nguyên độ dài chuỗi
  let out = '';
  for (const ch of String(s).toLowerCase()) {
    const c = ch === 'đ' ? 'd' : ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += c.length === 1 ? c : ch;
  }
  return out;
}
const words = (s) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % D;
}

function rawFeatures(text) {
  const w = words(text), f = new Map();
  const add = (k, v) => { const i = hash(k); f.set(i, (f.get(i) || 0) + v); };
  w.forEach((x, i) => {
    add('w:' + x, 1);
    if (i > 0) add('b:' + w[i - 1] + '_' + x, 1);
    const p = ' ' + x + ' ';
    for (let j = 0; j + 3 <= p.length; j++) add('c:' + p.slice(j, j + 3), 0.35);
  });
  return f;
}
function toSparse(f, weight) {
  let n = 0; const idx = [], val = [];
  for (const [k, v0] of f) { const v = weight ? v0 * (weight[k] ?? weight.__max) : v0; /* từ lạ = hiếm nhất */ idx.push(k); val.push(v); n += v * v; }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < val.length; i++) val[i] /= n;
  return { idx, val };
}
const featurize = (t) => toSparse(rawFeatures(t));

function rng(seed) { return () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 4294967296; }

// Nhân dữ liệu: thêm từ đệm đầu/cuối câu và lỗi gõ để mô hình bền hơn với cách nói thật.
const SUF = ['nhé', 'đi', 'vậy', 'ạ', 'nha', 'thế', 'hả', 'á', 'đó', 'nhỉ', 'luôn', 'ha'];
const PRE = ['ơi', 'à', 'ừm', 'này', 'cho mình hỏi', 'bạn ơi', 'ê', 'thế'];
function typo(s, r) {
  const w = s.split(' '); const cand = w.map((x, i) => [x, i]).filter(([x]) => x.length > 3);
  if (!cand.length) return s;
  const [x, i] = cand[Math.floor(r() * cand.length)], j = 1 + Math.floor(r() * (x.length - 2)), op = r();
  w[i] = op < 0.4 ? x.slice(0, j) + x.slice(j + 1) : op < 0.7 ? x.slice(0, j - 1) + x[j] + x[j - 1] + x.slice(j + 1) : x.slice(0, j) + x[j] + x.slice(j);
  return w.join(' ');
}
function augment(p, r, n) {
  const out = [p];
  for (let i = 0; i < n; i++) {
    const k = r(); let v = p;
    if (k < 0.35) v = p + ' ' + SUF[Math.floor(r() * SUF.length)];
    else if (k < 0.6) v = PRE[Math.floor(r() * PRE.length)] + ' ' + p;
    else if (k < 0.85) v = typo(p, r);
    else v = PRE[Math.floor(r() * PRE.length)] + ' ' + typo(p, r) + ' ' + SUF[Math.floor(r() * SUF.length)];
    out.push(v);
  }
  return out;
}

const UNKNOWN = ['Câu này mình chưa biết. Bạn hỏi cách khác, hoặc dạy mình nhé!', 'Mình chưa học tới chủ đề này, xin lỗi bạn.', 'Hmm, mình không chắc. Mình chỉ là AI nhỏ chạy offline thôi.'];
const QUIT = /^(thoi|dung|chiu|bo cuoc|khong choi|nghi|stop|dap an|giai di|noi dap an)( (luon|di|nhe|roi|choi|la gi))?$/;

function createChatbot({ intents, knowledge = [], botName = 'Mây', threshold = 0.3, kbHigh = 0.6, kbLow = 0.44, seed = 7 } = {}) {
  const tags = intents.map((i) => i.tag);
  const K = tags.length, oosK = tags.indexOf(OOS);
  let W = new Float32Array(K * D), B = new Float32Array(K);
  const data = [];
  const r = rng(seed);

  function scores(x) {
    const z = new Float64Array(K); let m = -Infinity;
    for (let k = 0; k < K; k++) {
      let s = B[k]; const o = k * D;
      for (let j = 0; j < x.idx.length; j++) s += W[o + x.idx[j]] * x.val[j];
      z[k] = s; if (s > m) m = s;
    }
    let sum = 0;
    for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - m); sum += z[k]; }
    for (let k = 0; k < K; k++) z[k] /= sum;
    return z;
  }
  function step(x, y, a, l2) {
    const p = scores(x);
    for (let k = 0; k < K; k++) {
      const g = p[k] - (k === y ? 1 : 0); if (Math.abs(g) < 1e-4) continue;
      const o = k * D; B[k] -= a * g;
      for (let j = 0; j < x.idx.length; j++) { const t = o + x.idx[j]; W[t] -= a * (g * x.val[j] + l2 * W[t]); }
    }
  }

  // ---- kho kiến thức (IDF tính trên toàn bộ câu hỏi + câu mẫu) ----
  let idf = {}, kbVecs = [];
  function buildKB() {
    const docs = [...knowledge.flatMap((e) => [...e.q, e.a]), ...intents.flatMap((i) => i.patterns)];
    const df = {};
    for (const d of docs) for (const k of new Set(rawFeatures(d).keys())) df[k] = (df[k] || 0) + 1;
    idf = { __max: Math.log(1 + docs.length) + 1 }; for (const k in df) idf[k] = Math.log((1 + docs.length) / (1 + df[k])) + 1;
    kbVecs = knowledge.flatMap((e, ei) => [...e.q.map((q) => ({ ei, w: 1, v: toSparse(rawFeatures(q), idf) })), { ei, w: 0.85, v: toSparse(rawFeatures(e.a), idf) }]);
  }
  function kbSearch(text) {
    const q = toSparse(rawFeatures(text), idf); const qm = new Map(q.idx.map((k, i) => [k, q.val[i]]));
    let best = { sim: 0, entry: null };
    // điểm = trung bình (cosine, độ phủ câu hỏi): độ phủ = phần "năng lượng" của câu hỏi tìm thấy trong mục này
    for (const { ei, w: f, v } of kbVecs) {
      let cos = 0, cov = 0;
      for (let j = 0; j < v.idx.length; j++) { const w = qm.get(v.idx[j]); if (w) { cos += w * v.val[j]; cov += w * w; } }
      const s = f * (0.5 * cos + 0.5 * cov);
      if (s > best.sim) best = { sim: s, entry: knowledge[ei] };
    }
    return best;
  }

  const ctx = { name: null, bot: botName, last: null, prev: null, lastReply: '', expect: null, game: null, turns: 0, history: [], dialog: [] };
  const lastPick = {};
  const pickR = (arr, key) => { // tránh lặp lại câu vừa nói
    if (arr.length === 1) return arr[0];
    let i; do i = Math.floor(Math.random() * arr.length); while (i === lastPick[key]);
    lastPick[key] = i; return arr[i];
  };

  function fill(s) {
    const now = new Date();
    const wd = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'][now.getDay()];
    if (s.includes('{ask:name}')) { ctx.expect = 'name'; s = s.replace('{ask:name}', ''); }
    return s.replace(/\{name\}/g, ctx.name || 'bạn').replace(/\{bot\}/g, botName)
      .replace(/\{time\}/g, `${now.getHours()} giờ ${String(now.getMinutes()).padStart(2, '0')} phút`)
      .replace(/\{date\}/g, `ngày ${now.getDate()} tháng ${now.getMonth() + 1} năm ${now.getFullYear()}`)
      .replace(/\{weekday\}/g, wd).trim();
  }

  function setName(n) {
    ctx.name = n; ctx.expect = null;
    return pickR([`Rất vui được làm quen, ${n}!`, `Chào ${n}, mình nhớ tên bạn rồi nhé.`, `${n}, tên hay đấy! Mình là ${botName}.`], 'name');
  }

  function handleGame(raw) {
    const g = ctx.game, n = normalize(raw).trim();
    if (g.type === 'guess') {
      const m = n.match(/-?\d+/);
      if (QUIT.test(n)) { ctx.game = null; return `Thôi nhé. Số mình nghĩ là ${g.n}.`; }
      if (!m) return null;
      const v = +m[0]; g.tries++;
      if (v === g.n) { ctx.game = null; return `Chính xác! Là ${g.n}. Bạn đoán ${g.tries} lần${g.tries <= 7 ? ', giỏi quá!' : '.'}`; }
      return `${v} ${v < g.n ? 'nhỏ hơn' : 'lớn hơn'} số của mình. Đoán tiếp đi!`;
    }
    if (g.type === 'riddle') {
      if (QUIT.test(n)) { ctx.game = null; return `Đáp án là: ${g.r.a}`; }
      g.tries++;
      if (g.r.answers.some((a) => n.includes(normalize(a)))) { ctx.game = null; return `Đúng rồi! ${g.r.a}`; }
      if (g.tries >= 3) { ctx.game = null; return `Chưa đúng. Đáp án là: ${g.r.a}`; }
      return 'Chưa đúng, thử lại nhé! (gõ "chịu" để xem đáp án)';
    }
    return null;
  }

  // "mây giỏi quá" → "bạn giỏi quá". So khớp có dấu để không nhầm "mấy/máy" với "Mây".
  const botRe = new RegExp('(^|[^\\p{L}])' + botName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}])', 'gu');
  const asModel = (seg) => seg.toLowerCase().replace(botRe, '$1bạn');

  function understand(seg, expect) {
    const name = extractName(seg);
    if (name) return { text: setName(name), intent: 'gioi_thieu_ten', confidence: 1 };
    const mseg = asModel(seg);
    const p = scores(featurize(mseg)); let k = 0; for (let i = 1; i < K; i++) if (p[i] > p[k]) k = i;
    const top = { intent: tags[k], confidence: p[k] };
    const shortWords = seg.trim().split(/\s+/);
    if (expect === 'name' && shortWords.length <= 3 && /^[\p{L} ]+$/u.test(seg.trim()) && (top.intent === OOS || top.confidence < 0.55)) {
      return { text: setName(shortWords.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')), intent: 'gioi_thieu_ten', confidence: 1 };
    }
    const kb = kbVecs.length ? kbSearch(mseg) : { sim: 0 };
    const known = top.intent !== OOS && top.confidence >= threshold;
    if (kb.entry?.taught && kb.sim >= kbLow - 0.1) return { text: kb.entry.a, intent: 'kien_thuc', confidence: kb.sim, taught: true }; // điều người dùng dạy được ưu tiên
    if (kb.sim >= kbHigh && (!known || top.confidence < 0.8)) return { text: kb.entry.a, intent: 'kien_thuc', confidence: kb.sim };
    if (known) {
      const it = intents[k]; const resp = pickR(it.responses, it.tag);
      ctx.prev = ctx.last; ctx.last = it.tag;
      return { text: fill(typeof resp === 'function' ? resp(ctx) : resp), intent: it.tag, confidence: top.confidence };
    }
    if (kb.sim >= kbLow) return { text: kb.entry.a, intent: 'kien_thuc', confidence: kb.sim };
    return { text: pickR(UNKNOWN, '?'), intent: 'khong_hieu', confidence: top.intent === OOS ? 1 - top.confidence : top.confidence };
  }

  const bot = {
    ctx, unknown: [], fallback: null, intents, knowledge,

    train({ epochs = 18, lr = 0.6, l2 = 2e-5, aug = 3 } = {}) {
      W = new Float32Array(K * D); B = new Float32Array(K); data.length = 0;
      intents.forEach((it, k) => it.patterns.forEach((p) => augment(p, r, aug).forEach((v) => data.push([featurize(v), k]))));
      for (let e = 0; e < epochs; e++) {
        for (let i = data.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [data[i], data[j]] = [data[j], data[i]]; }
        const a = lr / (1 + e * 0.15);
        for (const [x, y] of data) step(x, y, a, l2);
      }
      buildKB();
      let ok = 0; for (const [x, y] of data) { const p = scores(x); let m = 0; for (let i = 1; i < K; i++) if (p[i] > p[m]) m = i; if (m === y) ok++; }
      return { samples: data.length, patterns: intents.reduce((s, i) => s + i.patterns.length, 0), intents: K, facts: knowledge.length, trainAccuracy: ok / data.length };
    },

    predict(text) {
      const p = scores(featurize(text));
      return tags.map((t, k) => ({ intent: t, confidence: p[k] })).sort((a, b) => b.confidence - a.confidence);
    },
    searchKnowledge: (text) => kbSearch(text),

    // Dạy thêm 1 câu cho 1 chủ đề, học ngay (không cần train lại từ đầu).
    teach(text, tag) {
      const k = tags.indexOf(tag); if (k < 0) throw new Error('Không có chủ đề ' + tag);
      intents[k].patterns.push(text);
      const xs = augment(text, r, 5).map((v) => featurize(v));
      xs.forEach((x) => data.push([x, k]));
      for (let rep = 0; rep < 12; rep++) {
        for (const x of xs) step(x, k, 0.3, 0);
        for (let i = 0; i < 40; i++) { const [x, y] = data[Math.floor(r() * data.length)]; step(x, y, 0.1, 0); }
      }
      return bot.predict(text)[0];
    },
    learnAnswer(question, answer) {
      knowledge.push({ q: [question], a: answer, taught: true }); buildKB();
    },

    // Ghi 1 lượt hội thoại do bên ngoài tạo (vd câu trả lời của LLM) để giữ ngữ cảnh.
    remember(role, text) { ctx.dialog.push({ role, content: String(text) }); if (ctx.dialog.length > 24) ctx.dialog.shift(); if (role === 'assistant') { ctx.lastReply = text; ctx.history.push(text); } },

    reply(text) {
      ctx.turns++;
      const raw = String(text).trim();
      if (raw) bot.remember('user', raw);
      if (!raw) return done([{ text: 'Bạn muốn nói gì với mình nào?', intent: 'empty', confidence: 1 }]);
      if (ctx.game) { const g = handleGame(raw); if (g) return done([{ text: g, intent: 'tro_choi', confidence: 1 }]); }
      const math = tryMath(raw);
      if (math !== null) return done([{ text: `Kết quả là ${math}.`, intent: 'tinh_toan', confidence: 1 }]);

      const expect = ctx.expect; ctx.expect = null; // bot chờ tên chỉ trong 1 lượt
      const segs = raw.split(/[.!?;\n]+|,(?!\d)/).map((s) => s.trim()).filter((s) => words(s).length);
      let parts = (segs.length ? segs : [raw]).map((sg) => understand(sg, expect));
      if (parts.length > 1) {
        const filler = ['khong_hieu', 'dong_y', 'tu_choi', 'cuoi'];
        if (parts.some((p) => !filler.includes(p.intent))) parts = parts.filter((p) => !filler.includes(p.intent));
        const seen = new Set(); parts = parts.filter((p) => !seen.has(p.intent) && seen.add(p.intent)).slice(-2);
      }
      if (parts.length === 1 && parts[0].intent === 'khong_hieu') bot.unknown.push(raw);
      const res = done(parts);
      if (ctx.game && res.intent !== 'tro_choi' && !/Câu đố|đoán/.test(res.text)) res.text += ctx.game.type === 'guess' ? ' (Mình vẫn đang chờ bạn đoán số đấy!)' : ' (Câu đố vẫn chờ bạn trả lời nhé!)';
      return res;
    },

    async replyAsync(text) {
      const r0 = bot.reply(text);
      if (bot.fallback && needsThinking(text, r0)) {
        try { const t = await bot.fallback(text, ctx, r0); if (t) { ctx.dialog.pop(); bot.remember('assistant', t); return { ...r0, text: t, intent: 'fallback' }; } } catch (e) { console.warn('[chatbot] fallback lỗi:', e.message); }
      }
      return r0;
    },
  };

  function done(parts) {
    const text = parts.map((p) => p.text).join(' ');
    ctx.lastReply = text; ctx.history.push(text); if (ctx.history.length > 20) ctx.history.shift();
    ctx.dialog.push({ role: 'assistant', content: text }); if (ctx.dialog.length > 24) ctx.dialog.shift();
    const main = parts[parts.length - 1];
    return { text, intent: main.intent, confidence: main.confidence, parts };
  }

  return bot;
}

// Bộ phân luồng: câu nào mô hình nhỏ tự trả lời được, câu nào cần một mô hình lớn suy luận.
//   true  → nên chuyển cho LLM (bot.fallback / Claude)   false → trả lời offline là đủ
const LOCAL_ONLY = ['tinh_toan', 'tro_choi', 'gioi_thieu_ten', 'empty', 'cau_do', 'choi_doan_so', 'hoi_gio', 'hoi_ngay', 'lap_lai', 'hoi_ten_user'];
const REASON = /\b(tai sao|vi sao|lam sao|lam the nao|nhu the nao|the nao (la|thi)|giai thich|so sanh|phan tich|khac nhau|giong nhau|y nghia|nguyen nhan|neu\b.*\bthi|gia su|chung minh|suy luan|viet (cho|giup|mot|1|bai|doan|thu|tho)|tom tat|dich (sang|cau|giup)|ke ve|ke cho|lap ke hoach|ke hoach|nen .* hay|uu (diem|nhuoc)|loi khuyen|tu van|huong dan (cach|minh|toi)|cach (de|nao|lam)|giai (bai|giup|phuong trinh)|vi du|tai sao lai|co nen)\b/;
function needsThinking(text, r) {
  if (!r || LOCAL_ONLY.includes(r.intent) || r.parts?.some((p) => p.taught)) return false;
  if (r.intent === 'khong_hieu') return true;
  const n = normalize(text), w = n.split(/\s+/).filter(Boolean).length;
  if (REASON.test(n)) return true;
  if (r.intent === 'kien_thuc') return r.confidence < 0.55 && w > 6;
  return w >= 14 && r.confidence < 0.7;
}

// "tên tôi là Khoa", "mình tên Lan", "gọi tôi là An", "tôi là Minh" → tên (giữ chữ hoa/dấu gốc)
function extractName(raw) {
  const n = normalize(raw);
  const m = n.match(/(?:ten (?:cua )?(?:toi|minh|em|tao|tui|anh|chi) la|(?:toi|minh|em|tao|tui) ten(?: la)?|goi (?:toi|minh|em|tao|tui) la|(?:^|\s)(?:toi|minh|tui|em) la)\s+([a-z][a-z ]{0,30})$/);
  if (!m) return null;
  const start = m.index + m[0].length - m[1].length;
  const name = raw.slice(start).trim().replace(/[.!?,]+$/, '').split(/\s+/).slice(0, 3);
  const bad = ['ai', 'gi', 'nguoi', 'ban', 'hoc', 'sinh', 'vien', 'buon', 'vui', 'met', 'doi', 'chan', 'on', 'khoe', 'con', 'giao', 'mot', 'dan', 'tre', 'lap', 'nhan', 'ca', 'fan', 'robot'];
  if (bad.includes(normalize(name[0]))) return null;
  return name.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// "12 + 5", "3 nhân 4", "10 chia 4", "(2+3)*4", "2 mũ 10", "căn 16"
function tryMath(raw) {
  let e = normalize(raw).replace(/,/g, '.')
    .replace(/\bcong\b/g, '+').replace(/\btru\b/g, '-').replace(/\b(nhan|x)\b/g, '*').replace(/\bchia\b/g, '/')
    .replace(/\b(mu|luy thua)\b/g, '**').replace(/\^/g, '**').replace(/[×]/g, '*').replace(/[÷:]/g, '/');
  const sq = e.match(/\bcan(?: bac hai)?(?: cua)?\s*(\d+(?:\.\d+)?)/);
  if (sq) return fmt(Math.sqrt(+sq[1]));
  const m = (e.match(/[-+*/().\d\s]+/g) || []).map((s) => s.trim()).find((s) => /\d\s*(?:\*\*|[-+*/])\s*[-(]*\d/.test(s));
  if (!m) return null;
  try { return fmt(Function('"use strict";return (' + m + ')')()); } catch { return null; } // m chỉ có số và + - * / ( ) .
}
function fmt(v) {
  if (!Number.isFinite(v)) return 'không xác định (chia cho 0?)';
  return String(Math.round(v * 1e6) / 1e6).replace('.', ',');
}

// chatbot-data.js — dữ liệu huấn luyện cho chatbot.js (tiếng Việt).
//   INTENTS   : chủ đề hội thoại. Thêm chủ đề: { tag, label, patterns (≥ 10 câu đa dạng), responses }.
//   KNOWLEDGE : kho kiến thức hỏi–đáp { q: [các cách hỏi], a: 'câu trả lời' }.
//   RIDDLES   : câu đố cho trò chơi.
// Không cần viết bản không dấu hay thêm "nhé/ạ" — mô hình tự làm khi học.

const rnd = (a) => a[Math.floor(Math.random() * a.length)];

const RIDDLES = [
  { q: 'Cái gì càng lau càng ướt?', answers: ['khan', 'khăn'], a: 'Cái khăn lau.' },
  { q: 'Con gì đầu dê mình ốc?', answers: ['con de', 'con dê', 'dê', 'de'], a: 'Con dốc (dê + ốc).' },
  { q: 'Cái gì có cổ mà không có đầu?', answers: ['ao', 'áo', 'chai'], a: 'Cái áo (hoặc cái chai).' },
  { q: 'Cái gì đen khi bạn mua, đỏ khi dùng và xám khi vứt đi?', answers: ['than'], a: 'Than.' },
  { q: 'Cái gì có răng mà không cắn?', answers: ['luoc', 'lược', 'cai luoc'], a: 'Cái lược.' },
  { q: 'Cái gì bạn phải giữ sau khi đã trao nó cho người khác?', answers: ['loi hua', 'lời hứa', 'hua'], a: 'Lời hứa.' },
  { q: 'Càng lấy đi nhiều thì nó càng lớn. Đó là gì?', answers: ['cai ho', 'cái hố', 'ho', 'hố'], a: 'Cái hố.' },
  { q: 'Cái gì chạy khắp nhà mà không có chân?', answers: ['nuoc', 'nước', 'day dien', 'dây điện', 'gio', 'gió'], a: 'Nước (hoặc dây điện, gió…).' },
  { q: 'Có 3 quả táo, bạn lấy đi 2 quả. Bạn có mấy quả?', answers: ['2', 'hai'], a: '2 quả — vì bạn lấy 2 quả mà!' },
  { q: 'Tháng nào có 28 ngày?', answers: ['tat ca', 'tất cả', 'thang nao cung', 'tháng nào cũng', 'ca 12', 'cả 12', '12 thang'], a: 'Tháng nào cũng có 28 ngày!' },
];

const INTENTS = [
  // ---- chào hỏi & xã giao ----
  { tag: 'chao_hoi', label: 'Chào hỏi',
    patterns: ['xin chào', 'chào bạn', 'chào', 'hello', 'hi', 'alo', 'hế lô', 'chào buổi sáng', 'chào buổi tối', 'chào buổi chiều', 'ê bạn ơi', 'chào cậu', 'hey', 'có ai ở đó không', 'chào bot', 'hello bạn nhé', 'xin chào cậu', 'chào em', 'chào anh', 'bạn ơi', 'ê', 'ơi', 'hi there', 'lô', 'good morning', 'mình mới đến', 'yo'],
    responses: ['Chào {name}! Hôm nay bạn thế nào?', 'Xin chào! Mình là {bot}. Bạn tên gì nhỉ?{ask:name}', 'Hế lô {name}! Rất vui được gặp bạn.', 'Chào bạn! Hôm nay có chuyện gì vui không?'] },
  { tag: 'tam_biet', label: 'Tạm biệt',
    patterns: ['tạm biệt', 'bye', 'bai bai', 'hẹn gặp lại', 'tôi đi đây', 'mình đi nhé', 'chào nhé tôi đi', 'thôi nghỉ nhé', 'gặp lại sau', 'good bye', 'thôi mình out đây', 'tôi phải đi rồi', 'hẹn mai nói chuyện tiếp', 'off đây', 'see you', 'mình đi học đây', 'thôi tạm biệt nhé', 'đi đây'],
    responses: ['Tạm biệt {name}, hẹn gặp lại nhé!', 'Bye bye! Nhớ quay lại nói chuyện với {bot} nha.', 'Chúc bạn một ngày tốt lành!'] },
  { tag: 'chuc_ngu_ngon', label: 'Chúc ngủ ngon',
    patterns: ['chúc ngủ ngon', 'ngủ ngon nhé', 'good night', 'mình đi ngủ đây', 'đi ngủ thôi', 'ngủ ngon', 'tôi ngủ đây', 'gn', 'mình ngủ trước nhé'],
    responses: ['Ngủ ngon nhé {name}, mơ đẹp!', 'Chúc bạn ngủ thật ngon, mai gặp lại!'] },
  { tag: 'cam_on', label: 'Cảm ơn',
    patterns: ['cảm ơn', 'cám ơn bạn', 'thanks', 'thank you', 'cảm ơn nhiều', 'cảm ơn nhé', 'tks', 'đa tạ', 'cảm ơn đã giúp', 'thank bạn', 'cảm ơn cậu', 'mình cảm ơn', 'thanks nhiều', 'cảm ơn bạn rất nhiều', 'ok cảm ơn'],
    responses: ['Không có gì đâu {name}!', 'Rất vui vì giúp được bạn.', 'Chuyện nhỏ thôi mà!'] },
  { tag: 'xin_loi', label: 'Xin lỗi',
    patterns: ['xin lỗi', 'sorry', 'tôi xin lỗi', 'mình lỡ lời', 'xin lỗi bạn nhé', 'cho tôi xin lỗi', 'mình sai rồi', 'tha lỗi cho mình', 'sorry nha'],
    responses: ['Không sao đâu {name}!', 'Mình không giận đâu mà.'] },
  { tag: 'dong_y', label: 'Đồng ý / Ừ',
    patterns: ['ừ', 'ok', 'được', 'đúng rồi', 'vâng', 'có', 'oke', 'chuẩn', 'đồng ý', 'ừm', 'uh huh', 'dạ', 'okela', 'chắc chắn rồi', 'tất nhiên', 'đúng vậy', 'yes', 'được thôi'],
    responses: ['Okie!', 'Tuyệt, vậy tiếp nhé.', 'Ừ, mình hiểu rồi.'] },
  { tag: 'tu_choi', label: 'Không / Từ chối',
    patterns: ['không', 'thôi', 'thôi bỏ đi', 'không muốn', 'không cần', 'không phải', 'sai rồi không phải vậy', 'nope', 'không đâu', 'khỏi', 'no', 'chưa', 'không thích', 'không được', 'thôi khỏi cảm ơn', 'không cần nữa', 'mình không muốn đâu'],
    responses: ['Được thôi, tùy bạn.', 'Ok, không sao cả.', 'Mình hiểu rồi.'] },
  { tag: 'cuoi', label: 'Cười / Haha',
    patterns: ['haha', 'hihi', 'hehe', 'lol', 'buồn cười quá', 'hài thật', 'kkk', 'cười đau bụng', 'hài vãi', ':))', 'xd', 'vui ghê', 'mắc cười quá'],
    responses: ['Hihi, bạn cười là mình vui rồi!', 'Haha, muốn nghe thêm chuyện cười không?', 'Thấy bạn vui là mình vui!'] },
  { tag: 'lap_lai', label: 'Nói lại',
    patterns: ['nói lại đi', 'bạn nói gì cơ', 'nhắc lại được không', 'hả bạn nói gì', 'lặp lại câu vừa rồi', 'mình chưa nghe rõ', 'gì cơ', 'nói lại lần nữa'],
    responses: [(c) => c.history.length ? `Mình vừa nói: "${c.history[c.history.length - 1]}"` : 'Mình chưa nói gì mà!'] },
  { tag: 'hoi_lai', label: 'Còn bạn thì sao?',
    patterns: ['còn bạn thì sao', 'bạn thì sao', 'còn bạn', 'còn cậu', 'bạn thế nào', 'thế còn bạn', 'bạn cũng vậy à', 'đến lượt bạn', 'and you'],
    responses: [(c) => ({
      hoi_tham: 'Mình vẫn ổn, cảm ơn bạn đã hỏi!', cam_xuc_vui: 'Mình cũng vui lây!', cam_xuc_buon: 'Mình thì ổn, nhưng mình lo cho bạn hơn.',
      so_thich: 'Mình thích trò chuyện, câu đố và game!', hoi_ten_user: `Mình là ${c.bot}.`, gioi_thieu_ten: `Mình là ${c.bot}, rất vui được làm quen!`,
      doi_bung: 'Mình là AI nên không biết đói, hihi.', buon_ngu: 'Mình không cần ngủ, nhưng bạn thì cần đấy!',
      chao_hoi: 'Mình khỏe, lúc nào cũng sẵn sàng nói chuyện!', am_nhac: 'Mình thích nhạc lofi nhẹ nhàng.', phim: 'Mình thích phim hoạt hình!',
    }[c.prev] || 'Mình vẫn ổn, cảm ơn bạn!')] },

  // ---- về bot ----
  { tag: 'hoi_ten_bot', label: 'Hỏi tên bot',
    patterns: ['bạn tên gì', 'tên bạn là gì', 'bạn là ai', 'mày là ai', 'cậu tên là gì', 'tôi nên gọi bạn là gì', 'giới thiệu bản thân đi', 'em tên gì', 'xưng tên đi', 'cho hỏi tên bạn', 'bạn tên là gì thế', 'tên của bạn', 'giới thiệu về bạn đi', 'ai đang nói chuyện với tôi'],
    responses: ['Mình là {bot}, một AI giao tiếp nhỏ chạy ngay trên máy bạn. Còn bạn tên gì?{ask:name}', 'Mình tên {bot}. Bạn tên gì nhỉ?{ask:name}', 'Gọi mình là {bot} nhé! Còn bạn?{ask:name}'] },
  { tag: 'hoi_ten_user', label: 'Hỏi tên người dùng',
    patterns: ['tên tôi là gì', 'bạn có nhớ tên tôi không', 'tôi tên gì', 'bạn biết tôi là ai không', 'nhớ tên mình không', 'tôi là ai', 'mình tên là gì nhỉ', 'bạn còn nhớ tôi không', 'đoán xem tôi tên gì'],
    responses: [(c) => c.name ? `Bạn là ${c.name}, mình nhớ mà!` : 'Mình chưa biết tên bạn. Bạn tên gì?{ask:name}'] },
  { tag: 'hoi_tham', label: 'Hỏi thăm',
    patterns: ['bạn khỏe không', 'bạn có khỏe không', 'dạo này thế nào', 'bạn sao rồi', 'hôm nay bạn thế nào', 'ổn không', 'bạn có vui không', 'how are you', 'khỏe chứ', 'bạn đang làm gì', 'dạo này sao rồi', 'hôm nay của bạn ra sao', 'bạn ổn chứ', 'bạn có mệt không'],
    responses: ['Mình ổn, cảm ơn bạn! Còn bạn thì sao?', 'Mình luôn sẵn sàng trò chuyện. Bạn thế nào?', 'Vui lắm vì có người nói chuyện cùng! Bạn khỏe không?'] },
  { tag: 'hoi_tuoi', label: 'Hỏi tuổi bot',
    patterns: ['bạn bao nhiêu tuổi', 'tuổi của bạn', 'bạn sinh năm nào', 'bạn mấy tuổi rồi', 'bạn già chưa', 'bạn được tạo khi nào', 'sinh nhật bạn là ngày nào', 'bạn còn nhỏ à'],
    responses: ['Mình mới được tạo ra thôi, tính ra chưa được tuổi nào!', 'Mình là AI nên không có tuổi, nhưng mình học nhanh lắm.'] },
  { tag: 'hoi_nguoi_tao', label: 'Ai tạo ra bot',
    patterns: ['ai tạo ra bạn', 'ai làm ra bạn', 'bạn được ai lập trình', 'cha đẻ của bạn là ai', 'ai viết ra bạn', 'bạn từ đâu ra', 'ai là chủ của bạn', 'bạn do ai phát triển'],
    responses: ['Mình được tạo ra trong bộ kit TDK, viết bằng JavaScript thuần.', 'Người làm ra mình là chủ của bộ kit TDK!'] },
  { tag: 'hoi_la_may', label: 'Bot là người hay máy',
    patterns: ['bạn là người thật à', 'bạn có phải robot không', 'bạn là máy à', 'bạn là AI à', 'có phải người thật đang chat không', 'bạn là trí tuệ nhân tạo hả', 'bạn có thật không', 'bạn là chatbot à', 'bạn hoạt động thế nào', 'bạn là robot hả', 'bạn là máy tính à', 'bạn có phải con người không'],
    responses: ['Mình là AI nhỏ chạy hoàn toàn trên máy bạn: mình nhận diện ý định câu nói rồi chọn câu trả lời phù hợp.', 'Mình là chatbot, không phải người thật. Nhưng mình nói chuyện vui lắm đấy!'] },
  { tag: 'cam_xuc_bot', label: 'Bot có cảm xúc không',
    patterns: ['bạn có cảm xúc không', 'bạn có biết buồn không', 'bạn có biết yêu không', 'bạn có suy nghĩ không', 'bạn có ý thức không', 'bạn có thấy cô đơn không', 'bạn có giận không'],
    responses: ['Mình không có cảm xúc thật như người, nhưng mình được làm ra để nói chuyện thân thiện với bạn.', 'Mình là chương trình nên không buồn vui thật, nhưng mình luôn muốn bạn vui!'] },
  { tag: 'hoi_o_dau', label: 'Bot ở đâu',
    patterns: ['bạn ở đâu', 'bạn sống ở đâu', 'nhà bạn ở đâu', 'bạn đến từ đâu', 'bạn ở nước nào', 'bạn đang ở chỗ nào'],
    responses: ['Mình sống ngay trong trình duyệt trên máy bạn, không cần internet!', 'Mình ở trong máy của bạn đấy. Bạn ở đâu?'] },
  { tag: 'kha_nang', label: 'Bot làm được gì',
    patterns: ['bạn làm được gì', 'bạn biết làm gì', 'bạn giúp được gì', 'chức năng của bạn', 'bạn có thể làm gì', 'help', 'hướng dẫn', 'trợ giúp', 'bạn biết gì', 'menu', 'tôi có thể hỏi gì', 'nói chuyện gì bây giờ'],
    responses: ['Mình biết: trò chuyện, tâm sự, nhớ tên bạn, xem giờ/ngày, tính toán ("2 mũ 10", "căn 81"), trả lời kiến thức cơ bản ("thủ đô Nhật Bản"), kể chuyện cười, câu đố và trò chơi đoán số!'] },
  { tag: 'khen', label: 'Khen bot',
    patterns: ['bạn giỏi quá', 'bạn thông minh', 'bạn dễ thương ghê', 'hay quá', 'bạn tuyệt vời', 'tôi thích bạn', 'giỏi lắm', 'bạn đáng yêu', 'quá đỉnh', 'bạn hay thật', 'đỉnh của chóp', 'bạn trả lời hay đấy'],
    responses: ['Hihi, cảm ơn {name} nhé!', 'Bạn làm mình ngại quá!', 'Bạn cũng tuyệt lắm đấy!'] },
  { tag: 'che', label: 'Chê bot',
    patterns: ['bạn ngu quá', 'bạn dở tệ', 'đồ ngốc', 'bạn chẳng biết gì', 'vô dụng', 'trả lời sai rồi', 'bạn kém quá', 'nói nhảm', 'bạn ngốc thế', 'chán bạn ghê', 'bot gì mà dở vậy', 'trả lời không liên quan', 'bot dở', 'ngu thế', 'đồ bot ngốc', 'bạn kém thông minh'],
    responses: ['Xin lỗi nhé, mình còn đang học. Bạn dạy mình bằng nút 👎 được không?', 'Mình sẽ cố gắng hơn. Cảm ơn bạn góp ý!'] },

  // ---- cảm xúc người dùng ----
  { tag: 'cam_xuc_vui', label: 'Người dùng vui',
    patterns: ['tôi khỏe', 'tôi ổn', 'mình vui lắm', 'hôm nay tuyệt vời', 'tôi rất vui', 'mọi thứ đều tốt', 'khỏe re', 'bình thường thôi', 'cũng tốt', 'tôi vừa được điểm cao', 'hạnh phúc quá', 'mình cũng ổn', 'tôi cũng khỏe', 'hôm nay vui', 'mình được khen', 'mình thi đỗ rồi'],
    responses: ['Tuyệt quá! Giữ năng lượng tích cực nhé {name}.', 'Nghe vui ghê! Có chuyện gì hay kể mình nghe với.', 'Thật tốt khi nghe vậy!'] },
  { tag: 'cam_xuc_buon', label: 'Người dùng buồn',
    patterns: ['tôi buồn', 'mình buồn quá', 'chán đời', 'tôi mệt', 'hôm nay tệ quá', 'tôi thấy cô đơn', 'tôi bị điểm kém', 'stress quá', 'áp lực quá', 'không vui', 'tôi muốn khóc', 'mệt mỏi quá', 'buồn ghê', 'tâm trạng tệ', 'không ai hiểu tôi', 'tôi thất bại rồi', 'tôi bị mắng', 'mình buồn lắm', 'hôm nay buồn quá', 'thấy buồn buồn', 'tủi thân quá'],
    responses: ['Mình rất tiếc. Bạn muốn kể mình nghe chuyện gì không?', 'Ai cũng có ngày tệ mà {name}. Nghỉ ngơi một chút, uống nước, rồi mọi chuyện sẽ ổn hơn.', 'Mình ở đây nghe bạn nói. Nếu buồn kéo dài, hãy chia sẻ với người thân bạn tin tưởng nhé.'] },
  { tag: 'tuc_gian', label: 'Người dùng tức giận',
    patterns: ['tôi đang tức', 'bực mình quá', 'điên mất', 'tức chết đi được', 'mình giận lắm', 'cay quá', 'ức chế quá', 'khó chịu quá', 'phát điên', 'nổi điên rồi', 'giận quá', 'tức sôi người', 'bực bội', 'mình đang nóng máu', 'tức anh ách'],
    responses: ['Hít thở sâu 3 lần nào {name}. Chuyện gì làm bạn bực vậy?', 'Bực thì cứ xả với mình, nhưng đừng quyết định gì lúc đang nóng nhé.'] },
  { tag: 'so_hai', label: 'Người dùng sợ',
    patterns: ['tôi sợ', 'sợ quá', 'mình sợ ma', 'tôi lo lắng', 'mình hồi hộp quá', 'sợ thi trượt', 'tôi thấy bất an', 'run quá', 'lo quá', 'mình đang lo', 'căng thẳng trước kỳ thi', 'mình sợ bóng tối', 'lo lắng không ngủ được'],
    responses: ['Đừng sợ, có mình ở đây nói chuyện với bạn mà.', 'Lo lắng là bình thường. Chia nhỏ việc ra, làm từng bước một nhé {name}.'] },
  { tag: 'chan', label: 'Chán / Rảnh',
    patterns: ['chán quá', 'buồn chán', 'không có gì làm', 'rảnh quá', 'làm gì bây giờ', 'gợi ý việc gì làm đi', 'tôi đang chán', 'nhàm chán', 'chán ghê', 'rảnh rỗi quá', 'chẳng biết làm gì', 'cả ngày chẳng có việc gì', 'giết thời gian thế nào', 'ngồi một mình chán', 'chán thật sự', 'buồn tẻ quá'],
    responses: ['Thử chơi đoán số với mình không? Gõ "chơi đoán số".', 'Hay mình đố bạn một câu nhé? Gõ "đố vui".', 'Lúc rảnh là lúc tốt để học thêm kỹ năng mới đấy!'] },
  { tag: 'dong_vien', label: 'Xin động viên',
    patterns: ['động viên tôi đi', 'cho tôi lời khuyên', 'nói gì đó tích cực đi', 'tôi cần động lực', 'tiếp thêm sức mạnh cho mình', 'khuyên mình với', 'làm sao để vượt qua', 'tôi muốn bỏ cuộc'],
    responses: ['Mỗi ngày tiến một bước nhỏ là đủ rồi. Bạn đã cố gắng hơn bạn nghĩ đấy {name}!', 'Đừng so sánh mình với người khác, hãy so với chính bạn hôm qua.', 'Khó khăn là tạm thời. Nghỉ một chút rồi làm tiếp, đừng bỏ cuộc!'] },
  { tag: 'suc_khoe', label: 'Sức khỏe',
    patterns: ['tôi bị ốm', 'đau đầu quá', 'mình bị sốt', 'đau bụng', 'tôi bị cảm', 'ho nhiều quá', 'mình không khỏe', 'chóng mặt quá', 'đau răng'],
    responses: ['Bạn nghỉ ngơi, uống nhiều nước nhé. Nếu không đỡ thì nên đi khám bác sĩ.', 'Mong bạn mau khỏe! Mình không phải bác sĩ, nếu đau nhiều hãy đi khám ngay nhé.'] },

  // ---- thời gian & tiện ích ----
  { tag: 'hoi_gio', label: 'Hỏi giờ',
    patterns: ['mấy giờ rồi', 'bây giờ là mấy giờ', 'giờ là bao nhiêu', 'xem giờ giúp tôi', 'cho tôi biết giờ', 'what time is it', 'giờ hiện tại', 'đồng hồ chỉ mấy giờ', 'giờ này là mấy giờ'],
    responses: ['Bây giờ là {time}.', 'Đồng hồ của mình chỉ {time}.'] },
  { tag: 'hoi_ngay', label: 'Hỏi ngày',
    patterns: ['hôm nay ngày mấy', 'hôm nay là ngày bao nhiêu', 'hôm nay thứ mấy', 'ngày hôm nay', 'bây giờ là tháng mấy', 'năm nay là năm bao nhiêu', 'hôm nay là thứ gì', 'nay ngày bao nhiêu', 'hôm nay mùng mấy', 'nay thứ mấy', 'thứ mấy hôm nay', 'đang là tháng mấy', 'ngày mấy rồi'],
    responses: ['Hôm nay là {weekday}, {date}.'] },
  { tag: 'tinh_toan', label: 'Tính toán',
    patterns: ['tính giúp tôi', 'bạn biết làm toán không', 'giải toán', 'phép tính', 'cộng trừ nhân chia', 'làm toán đi', 'bạn tính nhẩm được không'],
    responses: ['Gõ phép tính cho mình, ví dụ "15 + 27", "8 nhân 7", "2 mũ 10" hoặc "căn 144".'] },
  { tag: 'thoi_tiet', label: 'Thời tiết',
    patterns: ['thời tiết hôm nay thế nào', 'trời có mưa không', 'hôm nay nóng không', 'nhiệt độ bao nhiêu', 'mai trời thế nào', 'dự báo thời tiết', 'trời lạnh không', 'có bão không'],
    responses: ['Mình chạy offline nên chưa xem được thời tiết. Bạn thử nhìn ra cửa sổ nhé!'] },

  // ---- giải trí & trò chơi ----
  { tag: 'chuyen_cuoi', label: 'Kể chuyện cười',
    patterns: ['kể chuyện cười', 'kể gì vui đi', 'làm tôi cười đi', 'có chuyện gì hài không', 'nói đùa đi', 'joke', 'kể chuyện đi', 'chọc cười tôi đi', 'kể thêm chuyện nữa', 'một câu chuyện vui', 'có gì hài hước không'],
    responses: [
      'Tại sao máy tính hay bị lạnh? Vì nó để Windows mở suốt ngày!',
      'Lập trình viên đi chợ, vợ dặn: "Mua 1 ổ bánh mì, nếu có trứng thì mua 6." Anh ấy về với 6 ổ bánh mì.',
      'Bug không phải lỗi, nó là tính năng chưa được viết tài liệu thôi!',
      'Thầy hỏi: "Em nào cho thầy biết nước nào đông dân nhất?" Trò: "Dạ, nước... sôi ạ, vì nó toàn bong bóng!"',
      'Con hỏi bố: "Bố ơi, sao biển mặn?" Bố: "Vì cá... khóc nhiều quá con ạ."',
      'Tại sao con ma không nói dối? Vì người ta nhìn xuyên qua nó được!'] },
  { tag: 'cau_do', label: 'Câu đố',
    patterns: ['đố vui', 'đố mình đi', 'cho một câu đố', 'chơi đố vui', 'hỏi mình câu đố', 'đố mẹo', 'ra câu đố đi', 'câu đố hay', 'đố tôi đi'],
    responses: [(c) => { const r = rnd(RIDDLES); c.game = { type: 'riddle', r, tries: 0 }; return `Câu đố: ${r.q} (gõ "chịu" nếu bó tay)`; }] },
  { tag: 'choi_doan_so', label: 'Chơi đoán số',
    patterns: ['chơi đoán số', 'chơi game đi', 'chơi trò chơi', 'mình chơi gì đó đi', 'đoán số', 'chơi với mình đi', 'có trò gì chơi không', 'chơi game với tôi'],
    responses: [(c) => { c.game = { type: 'guess', n: 1 + Math.floor(Math.random() * 100), tries: 0 }; return 'Mình đã nghĩ một số từ 1 đến 100. Bạn đoán đi! (gõ "thôi" để dừng)'; }] },
  { tag: 'so_thich', label: 'Sở thích của bot',
    patterns: ['bạn thích gì', 'sở thích của bạn', 'bạn thích làm gì', 'bạn có thích game không', 'bạn thích màu gì', 'món ăn yêu thích của bạn', 'bạn hay làm gì lúc rảnh', 'bạn thích con vật nào', 'bạn thích ăn món gì', 'bạn có thích đọc sách không', 'bạn ghét gì'],
    responses: ['Mình thích trò chuyện và câu đố. Còn bạn thích gì?', 'Mình mê game lắm, nhất là game tự làm!', 'Màu yêu thích của mình là xanh da trời. Bạn thì sao?'] },
  { tag: 'am_nhac', label: 'Âm nhạc',
    patterns: ['bạn thích nghe nhạc không', 'gợi ý bài hát', 'hát cho tôi nghe', 'nghe nhạc gì bây giờ', 'bạn thích ca sĩ nào', 'bài hát hay', 'mình đang nghe nhạc'],
    responses: ['Mình không hát được, nhưng nghe lofi lúc học bài rất hợp đấy!', 'Lúc buồn nghe nhạc nhẹ, lúc tập thể dục nghe nhạc sôi động nhé. Bạn thích thể loại nào?'] },
  { tag: 'phim', label: 'Phim ảnh',
    patterns: ['xem phim gì bây giờ', 'gợi ý phim hay', 'bạn thích phim gì', 'phim hoạt hình hay', 'có phim nào hay không', 'tối nay xem phim gì', 'mình thích xem anime'],
    responses: ['Thử phim hoạt hình của Ghibli như "Vùng đất linh hồn" xem, hay lắm!', 'Phim hay thì nhiều, bạn thích hành động, hài hay kinh dị?'] },
  { tag: 'the_thao', label: 'Thể thao',
    patterns: ['bạn thích bóng đá không', 'tập thể dục thế nào', 'mình muốn giảm cân', 'môn thể thao nào tốt', 'đi chạy bộ', 'chơi cầu lông', 'mình muốn cao hơn'],
    responses: ['Mỗi ngày vận động 30 phút là đủ tốt cho sức khỏe rồi!', 'Chạy bộ, bơi, cầu lông đều tốt. Quan trọng là đều đặn nhé {name}.'] },
  { tag: 'sach', label: 'Đọc sách',
    patterns: ['gợi ý sách hay', 'nên đọc sách gì', 'bạn thích đọc sách không', 'sách nào hay', 'mình muốn đọc truyện'],
    responses: ['Thử "Đắc Nhân Tâm" hoặc "Nhà Giả Kim" xem, dễ đọc mà hay.', 'Đọc mỗi ngày 10 trang thôi, một năm được cả chục cuốn đấy!'] },

  // ---- đời sống ----
  { tag: 'doi_bung', label: 'Đói / Ăn uống',
    patterns: ['tôi đói', 'đói bụng quá', 'ăn gì bây giờ', 'gợi ý món ăn', 'trưa nay ăn gì', 'tối nay ăn gì', 'thèm ăn quá', 'khát nước', 'đói quá', 'sáng nay ăn gì', 'món gì ngon'],
    responses: ['Thử phở, bánh mì hay cơm tấm xem!', 'Ăn gì thì ăn, nhớ uống đủ nước nha {name}.', 'Mình không ăn được nhưng nghe bún chả là thấy ngon rồi!'] },
  { tag: 'buon_ngu', label: 'Buồn ngủ',
    patterns: ['buồn ngủ quá', 'tôi mệt muốn ngủ', 'thức khuya quá', 'mất ngủ', 'không ngủ được', 'ngủ thôi', 'mắt díp lại rồi', 'thức trắng đêm'],
    responses: ['Đi ngủ sớm đi {name}, sức khỏe là quan trọng nhất!', 'Thử bỏ điện thoại xuống, tắt đèn và thở chậm xem sao.'] },
  { tag: 'hoc_tap', label: 'Học tập',
    patterns: ['giúp tôi học bài', 'làm sao để học giỏi', 'tôi lười học', 'mẹo học tập', 'sắp thi rồi', 'học thế nào cho hiệu quả', 'tôi không hiểu bài', 'học tiếng anh thế nào', 'làm sao nhớ bài lâu', 'mai kiểm tra rồi'],
    responses: ['Mẹo: học 25 phút, nghỉ 5 phút (Pomodoro), và tự giải thích lại bài bằng lời của mình.', 'Chia nhỏ bài ra, làm bài tập trước khi đọc lại lý thuyết, ngủ đủ giấc trước khi thi nhé!', 'Muốn nhớ lâu: ôn lại sau 1 ngày, 3 ngày, rồi 1 tuần (lặp lại ngắt quãng).'] },
  { tag: 'gia_dinh', label: 'Gia đình',
    patterns: ['bố mẹ mắng tôi', 'gia đình mình', 'mình cãi nhau với bố mẹ', 'mẹ tôi', 'anh chị em', 'nhà mình đông người', 'bố mẹ không hiểu tôi', 'bị mẹ mắng', 'giận bố', 'bố mẹ cãi nhau', 'em mình lấy đồ của mình', 'nhớ nhà quá'],
    responses: ['Bố mẹ đôi khi nghiêm vì lo cho bạn. Thử nói chuyện bình tĩnh lúc mọi người vui vẻ xem.', 'Gia đình là quan trọng nhất. Kể mình nghe thêm được không?'] },
  { tag: 'ban_be', label: 'Bạn bè',
    patterns: ['tôi không có bạn', 'cãi nhau với bạn thân', 'bạn bè xa lánh tôi', 'làm sao để có nhiều bạn', 'bạn thân mình', 'bị bạn nói xấu', 'mình muốn kết bạn', 'không ai chơi với mình', 'mình bị cô lập ở lớp', 'chẳng ai muốn làm bạn với tôi'],
    responses: ['Muốn có bạn, hãy chủ động hỏi han và lắng nghe người khác trước nhé.', 'Cãi nhau là chuyện bình thường. Một lời xin lỗi chân thành thường giải quyết được nhiều thứ.'] },
  { tag: 'tinh_yeu', label: 'Tình cảm',
    patterns: ['bạn có người yêu chưa', 'tôi thích một bạn', 'thất tình rồi', 'làm sao để tỏ tình', 'crush không thích mình', 'mình bị từ chối', 'yêu là gì', 'mình đang yêu', 'bạn đã có người yêu chưa', 'bạn có bồ chưa', 'người yêu của bạn là ai', 'bạn có bạn gái không', 'mình thầm thích một bạn cùng lớp', 'làm sao để người ấy để ý', 'ngại nói ra tình cảm', 'mình nhớ người ấy'],
    responses: ['Mình là AI nên chưa có người yêu đâu, hihi. Còn bạn đang để ý ai à?', 'Cứ là chính mình, chân thành là được. Còn nếu bị từ chối thì không phải lỗi của bạn đâu {name}.'] },
  { tag: 'nghe_nghiep', label: 'Nghề nghiệp',
    patterns: ['sau này làm nghề gì', 'nghề nào kiếm nhiều tiền', 'chọn ngành gì', 'mình muốn làm lập trình viên', 'ước mơ của tôi', 'nên học đại học gì', 'công việc tương lai'],
    responses: ['Chọn nghề hợp với điều bạn thích và giỏi. Thử làm dự án nhỏ để biết mình có hợp không nhé!', 'Ước mơ của bạn là gì? Kể mình nghe với.'] },
  { tag: 'lap_trinh', label: 'Lập trình',
    patterns: ['học lập trình thế nào', 'ngôn ngữ lập trình nào dễ', 'code bị lỗi', 'javascript là gì', 'học python ở đâu', 'mình muốn học code', 'lập trình khó không'],
    responses: ['Bắt đầu với Python hoặc JavaScript, làm dự án nhỏ thật nhiều. Lỗi là thầy giáo tốt nhất!', 'Học lập trình: hiểu biến, điều kiện, vòng lặp, hàm, rồi làm ngay một game nhỏ.'] },
  { tag: 'lam_game', label: 'Làm game',
    patterns: ['làm game thế nào', 'tôi muốn làm game', 'hướng dẫn làm game', 'làm game bằng gì', 'học lập trình game', 'game engine nào tốt', 'làm game 3d', 'godot là gì'],
    responses: ['Bắt đầu với template trong html/templates hoặc Godot. Làm game nhỏ, hoàn thiện, rồi mới làm game lớn!', 'Xem file GAMEDEV.md trong repo TDK — có quy trình từng bước đấy.'] },
  { tag: 'chuc_mung', label: 'Chúc mừng / Lễ',
    patterns: ['hôm nay sinh nhật tôi', 'chúc mừng năm mới', 'chúc mừng sinh nhật', 'tết rồi', 'giáng sinh vui vẻ', 'merry christmas', 'happy new year', 'mai là sinh nhật mình'],
    responses: ['Chúc mừng {name}! Chúc bạn luôn vui khỏe và gặp nhiều may mắn!', 'Ôi tuyệt quá! Chúc bạn có một ngày thật đáng nhớ!'] },

  // ---- ngoài phạm vi: dạy mô hình biết nói "không biết" ----
  { tag: 'ngoai_pham_vi', label: '(Ngoài phạm vi)',
    patterns: ['giá vàng hôm nay bao nhiêu', 'giá bitcoin', 'kết quả xổ số', 'tin tức mới nhất', 'tỷ số trận bóng tối qua', 'chứng khoán hôm nay', 'giá xăng tăng chưa', 'giá vàng thế giới tăng mạnh',
      'ai là tổng thống mỹ', 'dịch câu này sang tiếng nhật', 'viết cho tôi một bài văn', 'giải phương trình bậc hai', 'tóm tắt cuốn sách này', 'viết code python cho tôi', 'đặt vé máy bay', 'gọi điện cho mẹ',
      'mở nhạc lên', 'tắt đèn đi', 'bật điều hòa', 'chỉ đường đến hà nội', 'đặt báo thức 6 giờ', 'mua hàng online', 'gửi tin nhắn cho bạn', 'chuyển tiền', 'mật khẩu wifi là gì',
      'công thức hóa học của axit sunfuric', 'định lý pitago phát biểu thế nào', 'lịch sử chiến tranh thế giới thứ hai', 'cách nấu thịt kho tàu', 'bệnh tiểu đường chữa thế nào', 'luật giao thông mới',
      'xe máy bị hỏng', 'iphone mới ra', 'cổ phiếu nào nên mua', 'tỉ giá đô la', 'cách hack facebook', 'phân tích bài thơ', 'quả táo có bao nhiêu calo', 'con mèo màu gì',
      'asdkjh', 'qwerty', 'zzz', 'abc xyz', 'hmmm', '...', 'jfkdls', 'lorem ipsum', 'aaaaa', 'test',
      'cái bàn', 'ngôi nhà màu xanh', 'xe đạp', 'cây bút chì', 'trên trời có mây', 'chiếc lá rơi', 'con đường làng', 'quyển vở mới'],
    responses: ['Mình chưa biết.'] },
];

// Kho kiến thức. Viết 2–3 cách hỏi cho mỗi mục; bot tìm câu gần nhất.
const KNOWLEDGE = [
  // địa lý Việt Nam
  { q: ['thủ đô của việt nam là gì', 'thủ đô nước ta', 'thủ đô việt nam'], a: 'Thủ đô của Việt Nam là Hà Nội.' },
  { q: ['thành phố đông dân nhất việt nam', 'thành phố lớn nhất việt nam'], a: 'TP. Hồ Chí Minh là thành phố đông dân nhất Việt Nam.' },
  { q: ['việt nam có bao nhiêu tỉnh thành', 'số tỉnh thành việt nam'], a: 'Từ 1/7/2025, Việt Nam có 34 tỉnh, thành phố (28 tỉnh và 6 thành phố trực thuộc trung ương).' },
  { q: ['núi cao nhất việt nam', 'đỉnh núi cao nhất việt nam'], a: 'Fansipan (3.143 m) ở Lào Cai là núi cao nhất Việt Nam.' },
  { q: ['sông dài nhất việt nam', 'con sông lớn nhất việt nam'], a: 'Sông Mê Kông (Cửu Long) là sông lớn nhất chảy qua Việt Nam; sông Hồng là sông lớn nhất miền Bắc.' },
  { q: ['việt nam có bao nhiêu dân tộc', 'số dân tộc ở việt nam'], a: 'Việt Nam có 54 dân tộc.' },
  { q: ['dân số việt nam', 'việt nam có bao nhiêu người'], a: 'Dân số Việt Nam khoảng hơn 100 triệu người (từ năm 2023).' },
  { q: ['quốc khánh việt nam ngày nào', 'ngày quốc khánh'], a: 'Quốc khánh Việt Nam là ngày 2 tháng 9 (năm 1945).' },
  { q: ['vịnh hạ long ở đâu', 'hạ long thuộc tỉnh nào'], a: 'Vịnh Hạ Long ở Quảng Ninh, là di sản thiên nhiên thế giới UNESCO.' },
  { q: ['tiền việt nam gọi là gì', 'đơn vị tiền tệ việt nam'], a: 'Tiền Việt Nam là đồng (VND).' },
  { q: ['quốc hoa việt nam', 'hoa biểu tượng của việt nam'], a: 'Hoa sen thường được coi là quốc hoa của Việt Nam.' },
  { q: ['ai là người đọc tuyên ngôn độc lập', 'tuyên ngôn độc lập năm 1945'], a: 'Chủ tịch Hồ Chí Minh đọc Tuyên ngôn Độc lập ngày 2/9/1945 tại Quảng trường Ba Đình.' },
  { q: ['chiến thắng điện biên phủ năm nào', 'điện biên phủ'], a: 'Chiến thắng Điện Biên Phủ năm 1954.' },
  { q: ['ai đánh thắng quân nguyên mông', 'trần hưng đạo là ai'], a: 'Trần Hưng Đạo lãnh đạo quân dân nhà Trần ba lần đánh thắng quân Nguyên Mông (thế kỷ 13).' },
  { q: ['ai dời đô về thăng long', 'lý thái tổ dời đô'], a: 'Lý Thái Tổ dời đô từ Hoa Lư về Thăng Long (Hà Nội) năm 1010.' },
  // thủ đô thế giới
  { q: ['thủ đô của pháp', 'thủ đô nước pháp là gì'], a: 'Thủ đô của Pháp là Paris.' },
  { q: ['thủ đô của nhật bản', 'thủ đô nhật là gì'], a: 'Thủ đô của Nhật Bản là Tokyo.' },
  { q: ['thủ đô của hàn quốc', 'thủ đô hàn quốc là gì'], a: 'Thủ đô của Hàn Quốc là Seoul.' },
  { q: ['thủ đô của trung quốc', 'thủ đô trung quốc là gì'], a: 'Thủ đô của Trung Quốc là Bắc Kinh.' },
  { q: ['thủ đô của mỹ', 'thủ đô hoa kỳ là gì'], a: 'Thủ đô của Mỹ là Washington, D.C.' },
  { q: ['thủ đô của anh', 'thủ đô nước anh là gì'], a: 'Thủ đô của Anh là London.' },
  { q: ['thủ đô của đức', 'thủ đô nước đức'], a: 'Thủ đô của Đức là Berlin.' },
  { q: ['thủ đô của nga', 'thủ đô nước nga'], a: 'Thủ đô của Nga là Moskva (Moscow).' },
  { q: ['thủ đô của thái lan', 'thủ đô thái lan là gì'], a: 'Thủ đô của Thái Lan là Bangkok.' },
  { q: ['thủ đô của lào', 'thủ đô nước lào'], a: 'Thủ đô của Lào là Viêng Chăn (Vientiane).' },
  { q: ['thủ đô của campuchia', 'thủ đô campuchia là gì'], a: 'Thủ đô của Campuchia là Phnôm Pênh.' },
  { q: ['thủ đô của úc', 'thủ đô nước úc'], a: 'Thủ đô của Úc là Canberra (không phải Sydney nhé!).' },
  { q: ['thủ đô của ý', 'thủ đô nước ý'], a: 'Thủ đô của Ý là Roma (Rome).' },
  { q: ['thủ đô của singapore'], a: 'Singapore là một thành phố – quốc gia, thủ đô cũng là Singapore.' },
  { q: ['thủ đô của ấn độ', 'thủ đô ấn độ là gì'], a: 'Thủ đô của Ấn Độ là New Delhi.' },
  { q: ['thủ đô của canada'], a: 'Thủ đô của Canada là Ottawa.' },
  { q: ['thủ đô của brazil'], a: 'Thủ đô của Brazil là Brasília.' },
  // địa lý thế giới
  { q: ['núi cao nhất thế giới', 'đỉnh núi cao nhất thế giới', 'everest cao bao nhiêu mét'], a: 'Everest (khoảng 8.849 m) là núi cao nhất thế giới.' },
  { q: ['sông dài nhất thế giới'], a: 'Sông Nin (Nile) thường được xem là dài nhất (~6.650 km), sông Amazon xếp sau sít sao.' },
  { q: ['đại dương lớn nhất', 'đại dương rộng nhất thế giới'], a: 'Thái Bình Dương là đại dương lớn nhất.' },
  { q: ['nước rộng nhất thế giới', 'quốc gia lớn nhất thế giới'], a: 'Nga là quốc gia rộng nhất thế giới.' },
  { q: ['nước đông dân nhất thế giới', 'quốc gia đông dân nhất'], a: 'Ấn Độ là nước đông dân nhất thế giới (vượt Trung Quốc từ năm 2023).' },
  { q: ['thế giới có bao nhiêu châu lục', 'có mấy châu lục'], a: 'Thế giới có 7 châu lục (theo cách chia phổ biến): Á, Âu, Phi, Bắc Mỹ, Nam Mỹ, Châu Đại Dương, Nam Cực.' },
  { q: ['sa mạc lớn nhất thế giới'], a: 'Nam Cực là sa mạc lớn nhất (sa mạc lạnh); sa mạc nóng lớn nhất là Sahara.' },
  // khoa học
  { q: ['trái đất quay quanh mặt trời mất bao lâu', 'một năm có bao nhiêu ngày'], a: 'Trái Đất quay quanh Mặt Trời mất khoảng 365,25 ngày — vì vậy cứ 4 năm có một năm nhuận 366 ngày.' },
  { q: ['hệ mặt trời có bao nhiêu hành tinh', 'có mấy hành tinh'], a: 'Hệ Mặt Trời có 8 hành tinh: Thủy, Kim, Trái Đất, Hỏa, Mộc, Thổ, Thiên Vương, Hải Vương.' },
  { q: ['hành tinh lớn nhất', 'hành tinh lớn nhất hệ mặt trời'], a: 'Sao Mộc là hành tinh lớn nhất Hệ Mặt Trời.' },
  { q: ['hành tinh gần mặt trời nhất'], a: 'Sao Thủy là hành tinh gần Mặt Trời nhất.' },
  { q: ['khoảng cách từ trái đất đến mặt trăng', 'mặt trăng cách trái đất bao xa'], a: 'Mặt Trăng cách Trái Đất trung bình khoảng 384.400 km.' },
  { q: ['tốc độ ánh sáng là bao nhiêu', 'ánh sáng đi nhanh thế nào'], a: 'Tốc độ ánh sáng trong chân không khoảng 300.000 km/giây (299.792.458 m/s).' },
  { q: ['nước sôi ở bao nhiêu độ', 'nhiệt độ sôi của nước'], a: 'Ở áp suất bình thường, nước sôi ở 100°C và đóng băng ở 0°C.' },
  { q: ['công thức hóa học của nước', 'nước là gì về hóa học'], a: 'Công thức hóa học của nước là H₂O.' },
  { q: ['con người hít khí gì', 'chúng ta thở khí gì'], a: 'Con người hít vào oxy (O₂) và thở ra khí cacbonic (CO₂).' },
  { q: ['cây xanh quang hợp như thế nào', 'quang hợp là gì'], a: 'Quang hợp: cây dùng ánh sáng, nước và CO₂ để tạo đường và thải ra oxy.' },
  { q: ['cơ thể người có bao nhiêu xương', 'người có mấy cái xương'], a: 'Người trưởng thành có 206 xương.' },
  { q: ['tim người có mấy ngăn', 'trái tim có bao nhiêu ngăn'], a: 'Tim người có 4 ngăn: 2 tâm nhĩ và 2 tâm thất.' },
  { q: ['động vật lớn nhất thế giới', 'con vật to nhất', 'loài vật to lớn nhất thế giới'], a: 'Cá voi xanh là động vật lớn nhất từng biết đến.' },
  { q: ['động vật chạy nhanh nhất', 'con vật nhanh nhất'], a: 'Báo săn (cheetah) chạy nhanh nhất trên cạn, khoảng 100–110 km/h.' },
  { q: ['ai phát minh ra bóng đèn', 'người phát minh bóng đèn'], a: 'Thomas Edison làm ra bóng đèn sợi đốt dùng được thực tế (1879); trước đó nhiều người đã thử nghiệm.' },
  { q: ['ai tìm ra định luật vạn vật hấp dẫn', 'newton là ai'], a: 'Isaac Newton đưa ra định luật vạn vật hấp dẫn và 3 định luật chuyển động.' },
  { q: ['einstein là ai', 'thuyết tương đối của ai'], a: 'Albert Einstein là nhà vật lý đưa ra thuyết tương đối, nổi tiếng với E = mc².' },
  { q: ['cầu vồng có mấy màu', 'màu của cầu vồng'], a: 'Cầu vồng thường được kể 7 màu: đỏ, cam, vàng, lục, lam, chàm, tím.' },
  // toán
  { q: ['số pi bằng bao nhiêu', 'pi là gì'], a: 'Số π ≈ 3,14159 — tỉ số giữa chu vi và đường kính hình tròn.' },
  { q: ['diện tích hình tròn tính thế nào', 'công thức diện tích hình tròn'], a: 'Diện tích hình tròn = π × r² (r là bán kính).' },
  { q: ['chu vi hình tròn tính thế nào', 'công thức chu vi hình tròn'], a: 'Chu vi hình tròn = 2 × π × r (hoặc π × đường kính).' },
  { q: ['diện tích hình chữ nhật', 'công thức diện tích hình chữ nhật'], a: 'Diện tích hình chữ nhật = dài × rộng.' },
  { q: ['diện tích tam giác tính thế nào', 'công thức diện tích tam giác'], a: 'Diện tích tam giác = (đáy × chiều cao) ÷ 2.' },
  { q: ['định lý pytago', 'định lý pitago là gì'], a: 'Định lý Pytago: trong tam giác vuông, a² + b² = c² (c là cạnh huyền).' },
  { q: ['số nguyên tố là gì', 'thế nào là số nguyên tố'], a: 'Số nguyên tố là số tự nhiên lớn hơn 1 chỉ chia hết cho 1 và chính nó: 2, 3, 5, 7, 11, 13…' },
  { q: ['tổng các góc trong tam giác', 'tam giác có tổng góc bao nhiêu'], a: 'Tổng ba góc trong một tam giác bằng 180°.' },
  { q: ['một km bằng bao nhiêu mét', '1 km bằng mấy m'], a: '1 km = 1.000 m.' },
  { q: ['một giờ có bao nhiêu giây', '1 tiếng bao nhiêu giây'], a: '1 giờ = 60 phút = 3.600 giây.' },
  { q: ['một ngày có bao nhiêu giờ'], a: '1 ngày có 24 giờ.' },
  // công nghệ
  { q: ['ai là gì', 'trí tuệ nhân tạo là gì'], a: 'Trí tuệ nhân tạo (AI) là máy tính được dạy để làm những việc cần "trí thông minh", như hiểu ngôn ngữ, nhận diện hình ảnh hay ra quyết định.' },
  { q: ['học máy là gì', 'machine learning là gì'], a: 'Học máy (machine learning) là cách cho máy tự rút ra quy luật từ dữ liệu thay vì lập trình từng quy tắc. Mình chính là một ví dụ nhỏ!' },
  { q: ['internet là gì', 'mạng internet là gì'], a: 'Internet là mạng toàn cầu nối hàng tỉ máy tính để trao đổi thông tin.' },
  { q: ['html là gì', 'html dùng để làm gì'], a: 'HTML là ngôn ngữ đánh dấu để dựng cấu trúc trang web.' },
  { q: ['python là gì', 'ngôn ngữ python'], a: 'Python là ngôn ngữ lập trình dễ học, dùng nhiều cho AI, dữ liệu và tự động hóa.' },
  { q: ['cpu là gì', 'bộ vi xử lý là gì'], a: 'CPU là bộ xử lý trung tâm — "bộ não" thực hiện lệnh của máy tính.' },
  { q: ['ram là gì', 'bộ nhớ ram', 'ram trong máy tính dùng để làm gì'], a: 'RAM là bộ nhớ tạm, giữ dữ liệu chương trình đang chạy; tắt máy là mất.' },
  { q: ['ai sáng lập microsoft', 'bill gates là ai'], a: 'Microsoft do Bill Gates và Paul Allen sáng lập năm 1975.' },
  { q: ['ai sáng lập apple', 'steve jobs là ai'], a: 'Apple do Steve Jobs, Steve Wozniak và Ronald Wayne sáng lập năm 1976.' },
  // văn hóa & khác
  { q: ['tết nguyên đán là gì', 'tết âm lịch'], a: 'Tết Nguyên Đán là Tết cổ truyền đầu năm âm lịch, dịp quan trọng nhất của người Việt.' },
  { q: ['tết trung thu ngày nào', 'trung thu là ngày mấy'], a: 'Tết Trung Thu vào ngày 15 tháng 8 âm lịch.' },
  { q: ['truyện kiều của ai', 'ai viết truyện kiều'], a: 'Truyện Kiều do đại thi hào Nguyễn Du viết.' },
  { q: ['ai viết bình ngô đại cáo', 'bình ngô đại cáo'], a: 'Bình Ngô đại cáo do Nguyễn Trãi viết năm 1428.' },
  { q: ['world cup tổ chức mấy năm một lần', 'world cup bao lâu một lần'], a: 'World Cup bóng đá được tổ chức 4 năm một lần.' },
  { q: ['một năm có bao nhiêu tuần'], a: 'Một năm có khoảng 52 tuần (52 tuần và 1–2 ngày).' },
  { q: ['năm nhuận là gì', 'thế nào là năm nhuận'], a: 'Năm nhuận dương lịch có 366 ngày (tháng 2 có 29 ngày), thường 4 năm một lần.' },
];
