// chatbot.js — mô hình AI giao tiếp cơ bản tiếng Việt, chạy offline, không cần thư viện.
// Mô hình: phân loại ý định (intent) bằng hồi quy softmax trên đặc trưng băm (từ, cặp từ, cụm 3 ký tự),
// tự huấn luyện trong < 1 giây. Hiểu cả câu không dấu và gõ sai nhẹ. Có trí nhớ ngắn (tên người dùng),
// biết giờ/ngày, tính toán đơn giản, và ghi lại câu chưa hiểu để bạn bổ sung dữ liệu.
//
//   import { createChatbot } from '../../kit/chatbot.js';
//   import { INTENTS } from '../../kit/chatbot-data.js';
//   const bot = createChatbot({ intents: INTENTS, botName: 'Mây' });
//   bot.train();                          // hoặc bot.load(jsonDaLuu) để bỏ qua bước huấn luyện
//   bot.reply('xin chao');                // → { text, intent, confidence }
//   bot.unknown                           // các câu bot chưa hiểu → thêm vào dữ liệu rồi train lại
//   bot.fallback = async (text) => ...    // tuỳ chọn: chuyển câu khó sang LLM/máy chủ (dùng replyAsync)
//
// Định dạng intent: { tag, patterns: [...câu mẫu], responses: [...câu trả lời] }
//   Câu trả lời có thể chứa {name} {bot} {time} {date} {weekday}; hoặc là hàm (ctx) => string.

const D = 1 << 13; // số chiều đặc trưng băm (8192)

// Bỏ dấu tiếng Việt, giữ nguyên độ dài chuỗi (để cắt lại được tên từ câu gốc).
export function normalize(s) {
  let out = '';
  for (const ch of String(s).toLowerCase()) {
    const c = ch === 'đ' ? 'd' : ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += c.length === 1 ? c : ch;
  }
  return out;
}

function hash(str) { // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % D;
}

export function featurize(text) {
  const words = normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
  const f = new Map();
  const add = (k, w) => { const i = hash(k); f.set(i, (f.get(i) || 0) + w); };
  words.forEach((w, i) => {
    add('w:' + w, 1);
    if (i > 0) add('b:' + words[i - 1] + '_' + w, 1);
    const p = ' ' + w + ' ';
    for (let j = 0; j + 3 <= p.length; j++) add('c:' + p.slice(j, j + 3), 0.4);
  });
  let n = 0; for (const v of f.values()) n += v * v;
  n = Math.sqrt(n) || 1;
  const idx = [], val = [];
  for (const [k, v] of f) { idx.push(k); val.push(v / n); }
  return { idx, val };
}

function rng(seed) { return () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 4294967296; }
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function createChatbot({ intents, botName = 'Mây', threshold = 0.25, seed = 42 } = {}) {
  const tags = intents.map((it) => it.tag);
  const K = tags.length;
  let W = new Float32Array(K * D), B = new Float32Array(K);

  function scores(x) {
    const z = new Float32Array(K);
    for (let k = 0; k < K; k++) {
      let s = B[k]; const o = k * D;
      for (let j = 0; j < x.idx.length; j++) s += W[o + x.idx[j]] * x.val[j];
      z[k] = s;
    }
    const m = Math.max(...z); let sum = 0;
    for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - m); sum += z[k]; }
    for (let k = 0; k < K; k++) z[k] /= sum;
    return z;
  }

  const ctx = { name: null, bot: botName, last: null, turns: 0 };

  const bot = {
    ctx, unknown: [], fallback: null,

    train({ epochs = 60, lr = 0.8, l2 = 1e-4 } = {}) {
      W = new Float32Array(K * D); B = new Float32Array(K);
      const data = [];
      intents.forEach((it, k) => it.patterns.forEach((p) => data.push([featurize(p), k])));
      const r = rng(seed);
      for (let e = 0; e < epochs; e++) {
        for (let i = data.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [data[i], data[j]] = [data[j], data[i]]; }
        const a = lr / (1 + e * 0.05);
        for (const [x, y] of data) {
          const p = scores(x);
          for (let k = 0; k < K; k++) {
            const g = p[k] - (k === y ? 1 : 0); const o = k * D;
            B[k] -= a * g;
            for (let j = 0; j < x.idx.length; j++) { const t = o + x.idx[j]; W[t] -= a * (g * x.val[j] + l2 * W[t]); }
          }
        }
      }
      let ok = 0; for (const [x, y] of data) { const p = scores(x); if (p.indexOf(Math.max(...p)) === y) ok++; }
      return { samples: data.length, intents: K, trainAccuracy: ok / data.length };
    },

    predict(text) {
      const p = scores(featurize(text));
      const ranked = tags.map((t, k) => ({ intent: t, confidence: p[k] })).sort((a, b) => b.confidence - a.confidence);
      return ranked;
    },

    reply(text) {
      ctx.turns++;
      const raw = String(text).trim();
      if (!raw) return { text: 'Bạn muốn nói gì với mình nào?', intent: 'empty', confidence: 1 };

      const math = tryMath(raw);
      if (math !== null) return out(`Kết quả là ${math}.`, 'tinh_toan', 1);

      const name = extractName(raw);
      if (name) {
        ctx.name = name;
        return out(fill(pick([`Rất vui được làm quen, ${name}!`, `Chào ${name}, mình nhớ tên bạn rồi nhé.`, `${name} — tên đẹp đấy! Mình là ${botName}.`])), 'gioi_thieu_ten', 1);
      }

      const [top] = bot.predict(raw);
      if (top.confidence < threshold) {
        bot.unknown.push(raw);
        return out(pick(['Mình chưa hiểu lắm, bạn nói cách khác được không?', 'Câu này khó quá, mình chưa học tới. Bạn hỏi kiểu khác nhé?', 'Hmm, mình chưa biết trả lời câu này.']), 'khong_hieu', top.confidence);
      }
      const it = intents.find((i) => i.tag === top.intent);
      ctx.last = top.intent;
      const r = pick(it.responses);
      return out(fill(typeof r === 'function' ? r(ctx) : r), top.intent, top.confidence);
    },

    async replyAsync(text) {
      const r = bot.reply(text);
      if (r.intent === 'khong_hieu' && bot.fallback) {
        try { const t = await bot.fallback(text, ctx); if (t) return { ...r, text: t, intent: 'fallback' }; } catch (e) { console.warn('[chatbot] fallback lỗi:', e.message); }
      }
      return r;
    },

    toJSON() { return { tags, D, W: Array.from(W, (v) => Math.round(v * 1e4) / 1e4), B: Array.from(B) }; },
    load(m) {
      if (m.D !== D || m.tags.join() !== tags.join()) throw new Error('Model không khớp dữ liệu intent — hãy train lại.');
      W = Float32Array.from(m.W); B = Float32Array.from(m.B);
    },
  };

  function out(t, intent, confidence) { return { text: t, intent, confidence }; }

  function fill(s) {
    const now = new Date();
    const wd = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'][now.getDay()];
    return s
      .replace(/\{name\}/g, ctx.name || 'bạn')
      .replace(/\{bot\}/g, botName)
      .replace(/\{time\}/g, `${now.getHours()} giờ ${String(now.getMinutes()).padStart(2, '0')} phút`)
      .replace(/\{date\}/g, `ngày ${now.getDate()} tháng ${now.getMonth() + 1} năm ${now.getFullYear()}`)
      .replace(/\{weekday\}/g, wd);
  }

  return bot;
}

// "tên tôi là Khoa", "mình tên là Lan", "gọi tôi là An", "tôi là Minh" → tên (giữ chữ hoa/dấu gốc)
function extractName(raw) {
  const n = normalize(raw);
  const m = n.match(/(?:ten (?:cua )?(?:toi|minh|em|tao|tui|anh|chi) la|(?:toi|minh|em|tao|tui) ten(?: la)?|goi (?:toi|minh|em|tao|tui) la|(?:^|\s)(?:toi|minh|tui) la)\s+([a-z][a-z ]{0,30})$/);
  if (!m) return null;
  const start = m.index + m[0].length - m[1].length;
  const name = raw.slice(start).trim().replace(/[.!?,]+$/, '').split(/\s+/).slice(0, 3);
  const bad = ['ai', 'gi', 'nguoi', 'ban', 'hoc', 'sinh', 'vien', 'buon', 'vui', 'met', 'doi', 'chan', 'on', 'khoe'];
  if (bad.includes(normalize(name[0]))) return null;
  return name.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// "12 + 5", "3 nhân 4", "10 chia 4", "bao nhiêu là 7 trừ 2"
function tryMath(raw) {
  let e = normalize(raw).replace(/,/g, '.')
    .replace(/\bcong\b/g, '+').replace(/\btru\b/g, '-').replace(/\b(nhan|x)\b/g, '*').replace(/\bchia\b/g, '/')
    .replace(/[×]/g, '*').replace(/[÷:]/g, '/');
  const m = (e.match(/[-+*/().\d\s]+/g) || []).map((s) => s.trim()).find((s) => /\d\s*[-+*/]\s*[-(]*\d/.test(s));
  if (!m) return null;
  try {
    const v = Function('"use strict";return (' + m + ')')(); // m chỉ chứa số, + - * / ( ) . nên an toàn
    if (!Number.isFinite(v)) return 'không xác định (chia cho 0?)';
    return String(Math.round(v * 1e6) / 1e6).replace('.', ',');
  } catch { return null; }
}
