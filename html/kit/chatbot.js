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

export const OOS = 'ngoai_pham_vi';
const D = 1 << 13;

export function normalize(s) { // bỏ dấu, giữ nguyên độ dài chuỗi
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
export const featurize = (t) => toSparse(rawFeatures(t));

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

export function createChatbot({ intents, knowledge = [], botName = 'Mây', threshold = 0.3, kbHigh = 0.6, kbLow = 0.44, seed = 7 } = {}) {
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
export function needsThinking(text, r) {
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
