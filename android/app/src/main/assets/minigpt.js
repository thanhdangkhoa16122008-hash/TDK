// Tự sinh từ mini-gpt/mobile/minigpt.js — đừng sửa tay.
/* MiniGPT chạy bằng JavaScript thuần: điện thoại (WebView của app Mây AI), trình duyệt, hoặc Node.
 * Không cần thư viện, không cần mạng. Đọc file .mgpt do export_mobile.py tạo ra.
 *
 *   const lib = MiniGPTLib();
 *   const m = lib.load(arrayBufferCuaFileMgpt);       // → { tok, info, step, generate, chatIds }
 *   for (const id of m.generate(m.chatIds([{ role: 'user', content: 'Xin chào' }]), { temperature: 0.7 })) …
 *
 * Mọi thứ nằm trong hàm MiniGPTLib() để có thể đưa nguyên khối vào Web Worker (fn.toString()).
 * Phép tính khớp PyTorch: LayerNorm eps 1e-5, GELU dạng erf, chú ý nhân quả có bộ nhớ đệm KV, wte dùng chung cho đầu ra.
 */
function MiniGPTLib() {
  'use strict';

  // ---------- đọc file .mgpt ----------
  function f16(h) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) return s * 5.960464477539063e-8 * f;
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  function parse(buf) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'MGPT') throw new Error('Đây không phải file MiniGPT (.mgpt)');
    const ver = dv.getUint32(4, true);
    if (ver !== 1) throw new Error('Phiên bản file .mgpt chưa hỗ trợ: ' + ver);
    const hlen = dv.getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hlen)));
    const base = Math.ceil((12 + hlen) / 16) * 16;
    const T = {};
    for (const [name, t] of Object.entries(header.tensors)) {
      const rows = t.shape[0], cols = t.shape.length > 1 ? t.shape[1] : 1, n = rows * cols;
      if (t.dtype === 'i8') {
        T[name] = { q: new Int8Array(buf, base + t.offset, n), s: new Float32Array(buf, base + t.scale_offset, rows), rows, cols };
      } else if (t.dtype === 'f16') {
        const h = new Uint16Array(buf, base + t.offset, n), f = new Float32Array(n);
        for (let i = 0; i < n; i++) f[i] = f16(h[i]);
        T[name] = { f, rows, cols };
      } else {
        T[name] = { f: new Float32Array(buf, base + t.offset, n), rows, cols };
      }
    }
    return { header, T };
  }

  // ---------- phép tính cơ bản ----------
  function matvec(out, W, x) {                 // out[r] = Σ W[r, i] · x[i]
    const rows = W.rows, cols = W.cols;
    if (W.q) {
      const q = W.q, s = W.s;
      for (let r = 0, o = 0; r < rows; r++, o += cols) {
        let a = 0, b = 0, c = 0, d = 0, i = 0;
        for (; i < cols - 3; i += 4) {
          a += q[o + i] * x[i]; b += q[o + i + 1] * x[i + 1]; c += q[o + i + 2] * x[i + 2]; d += q[o + i + 3] * x[i + 3];
        }
        for (; i < cols; i++) a += q[o + i] * x[i];
        out[r] = (a + b + c + d) * s[r];
      }
    } else {
      const w = W.f;
      for (let r = 0, o = 0; r < rows; r++, o += cols) {
        let a = 0, b = 0, c = 0, d = 0, i = 0;
        for (; i < cols - 3; i += 4) {
          a += w[o + i] * x[i]; b += w[o + i + 1] * x[i + 1]; c += w[o + i + 2] * x[i + 2]; d += w[o + i + 3] * x[i + 3];
        }
        for (; i < cols; i++) a += w[o + i] * x[i];
        out[r] = a + b + c + d;
      }
    }
  }

  function rowOf(out, W, r) {                  // lấy một hàng (tra bảng nhúng)
    const cols = W.cols, o = r * cols;
    if (W.q) { const s = W.s[r]; for (let i = 0; i < cols; i++) out[i] = W.q[o + i] * s; }
    else for (let i = 0; i < cols; i++) out[i] = W.f[o + i];
  }

  function layerNorm(out, x, w, b, n) {
    let m = 0;
    for (let i = 0; i < n; i++) m += x[i];
    m /= n;
    let v = 0;
    for (let i = 0; i < n; i++) { const d = x[i] - m; v += d * d; }
    const r = 1 / Math.sqrt(v / n + 1e-5);
    for (let i = 0; i < n; i++) out[i] = (x[i] - m) * r * w[i] + (b ? b[i] : 0);
  }

  function erf(x) {                            // Abramowitz–Stegun 7.1.26, sai số < 1,5e-7
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  }
  const gelu = (x) => 0.5 * x * (1 + erf(x * 0.7071067811865476));

  // ---------- bộ tách từ BPE (khớp minigpt/tokenizer.py) ----------
  function Tokenizer(tk) {
    const ranks = new Map();
    tk.merges.forEach(([a, b], i) => ranks.set(a * 65536 + b, i));
    const vocab = [];
    for (let i = 0; i < 256; i++) vocab.push(Uint8Array.of(i));
    for (const [a, b] of tk.merges) {
      const x = vocab[a], y = vocab[b], z = new Uint8Array(x.length + y.length);
      z.set(x); z.set(y, x.length); vocab.push(z);
    }
    const special = {}, specialInv = {};
    tk.special_tokens.forEach((t, i) => { special[t] = vocab.length + i; specialInv[vocab.length + i] = new TextEncoder().encode(t); });
    // Mẫu tách thô giống Python: \w, \d, \s của Python viết lại bằng lớp Unicode cho JS.
    const S = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
    const re = new RegExp(` ?[\\p{L}\\p{Nl}\\p{No}]+| ?\\p{Nd}{1,3}| ?_+| ?[^${S}\\p{L}\\p{N}_]+|[${S}]+(?![^${S}])|[${S}]+`, 'gu');
    const enc = new TextEncoder();
    const cache = new Map();

    function bpe(chunk) {
      let ids = cache.get(chunk);
      if (ids) return ids;
      ids = Array.from(enc.encode(chunk));
      while (ids.length > 1) {
        let best = -1, bestRank = Infinity;
        for (let i = 0; i < ids.length - 1; i++) {
          const r = ranks.get(ids[i] * 65536 + ids[i + 1]);
          if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
        }
        if (best < 0) break;
        const a = ids[best], b = ids[best + 1], nid = 256 + bestRank, out = [];
        for (let i = 0; i < ids.length;) {
          if (i + 1 < ids.length && ids[i] === a && ids[i + 1] === b) { out.push(nid); i += 2; } else { out.push(ids[i]); i++; }
        }
        ids = out;
      }
      if (cache.size > 200000) cache.clear();
      cache.set(chunk, ids);
      return ids;
    }

    return {
      special,
      vocabSize: vocab.length + tk.special_tokens.length,
      encode(text) {
        const out = [];
        for (const m of text.normalize('NFC').matchAll(re)) for (const id of bpe(m[0])) out.push(id);
        return out;
      },
      bytes(ids) {
        let n = 0;
        for (const i of ids) n += (vocab[i] || specialInv[i]).length;
        const b = new Uint8Array(n);
        let o = 0;
        for (const i of ids) { const v = vocab[i] || specialInv[i]; b.set(v, o); o += v.length; }
        return b;
      },
      decode(ids) { return new TextDecoder().decode(this.bytes(ids)); },
    };
  }

  // ---------- mô hình ----------
  function load(buf) {
    const { header, T } = parse(buf);
    const cfg = header.config;
    const C = cfg.n_embd, H = cfg.n_head, hs = C / H, L = cfg.n_layer, BS = cfg.block_size, V = cfg.vocab_size;
    const tok = Tokenizer(header.tokenizer);
    const Kc = [], Vc = [];
    for (let l = 0; l < L; l++) { Kc.push(new Float32Array(BS * C)); Vc.push(new Float32Array(BS * C)); }
    const x = new Float32Array(C), h = new Float32Array(C), qkv = new Float32Array(3 * C), att = new Float32Array(C);
    const tmp = new Float32Array(C), ff = new Float32Array(4 * C), sc = new Float32Array(BS), logits = new Float32Array(V);
    const pe = new Float32Array(C), scale = 1 / Math.sqrt(hs);
    const blk = [];
    for (let l = 0; l < L; l++) {
      const p = `blocks.${l}.`, g = (n) => T[p + n];
      blk.push({
        ln1w: g('ln1.weight').f, ln1b: g('ln1.bias') && g('ln1.bias').f, qkv: g('attn.qkv.weight'), qkvb: g('attn.qkv.bias') && g('attn.qkv.bias').f,
        proj: g('attn.proj.weight'), projb: g('attn.proj.bias') && g('attn.proj.bias').f,
        ln2w: g('ln2.weight').f, ln2b: g('ln2.bias') && g('ln2.bias').f, fc: g('mlp.fc.weight'), fcb: g('mlp.fc.bias') && g('mlp.fc.bias').f,
        mproj: g('mlp.proj.weight'), mprojb: g('mlp.proj.bias') && g('mlp.proj.bias').f,
      });
    }
    const lnfw = T['ln_f.weight'].f, lnfb = T['ln_f.bias'] && T['ln_f.bias'].f;
    const addb = (y, b, n) => { if (b) for (let i = 0; i < n; i++) y[i] += b[i]; };

    /** Đưa 1 token qua mô hình ở vị trí pos (ghi bộ nhớ đệm KV). Trả về logits nếu cần. */
    function step(token, pos, wantLogits) {
      rowOf(x, T.wte, token);
      rowOf(pe, T.wpe, pos);
      for (let i = 0; i < C; i++) x[i] += pe[i];
      for (let l = 0; l < L; l++) {
        const B = blk[l], K = Kc[l], Vv = Vc[l];
        layerNorm(h, x, B.ln1w, B.ln1b, C);
        matvec(qkv, B.qkv, h); addb(qkv, B.qkvb, 3 * C);
        K.set(qkv.subarray(C, 2 * C), pos * C);
        Vv.set(qkv.subarray(2 * C, 3 * C), pos * C);
        for (let hd = 0; hd < H; hd++) {
          const qo = hd * hs;
          let max = -Infinity;
          for (let j = 0; j <= pos; j++) {
            const ko = j * C + qo;
            let s = 0;
            for (let d = 0; d < hs; d++) s += qkv[qo + d] * K[ko + d];
            s *= scale; sc[j] = s;
            if (s > max) max = s;
          }
          let sum = 0;
          for (let j = 0; j <= pos; j++) { const e = Math.exp(sc[j] - max); sc[j] = e; sum += e; }
          for (let d = 0; d < hs; d++) att[qo + d] = 0;
          for (let j = 0; j <= pos; j++) {
            const p = sc[j] / sum, vo = j * C + qo;
            for (let d = 0; d < hs; d++) att[qo + d] += p * Vv[vo + d];
          }
        }
        matvec(tmp, B.proj, att); addb(tmp, B.projb, C);
        for (let i = 0; i < C; i++) x[i] += tmp[i];
        layerNorm(h, x, B.ln2w, B.ln2b, C);
        matvec(ff, B.fc, h); addb(ff, B.fcb, 4 * C);
        for (let i = 0; i < 4 * C; i++) ff[i] = gelu(ff[i]);
        matvec(tmp, B.mproj, ff); addb(tmp, B.mprojb, C);
        for (let i = 0; i < C; i++) x[i] += tmp[i];
      }
      if (!wantLogits) return null;
      layerNorm(h, x, lnfw, lnfb, C);
      matvec(logits, T.wte, h);
      return logits;
    }

    function sample(lg, hist, o) {
      const n = lg.length, z = new Float64Array(n);
      for (let i = 0; i < n; i++) z[i] = lg[i];
      if (o.repetition_penalty && o.repetition_penalty !== 1) {          // bớt lặp lại
        for (const t of new Set(hist.slice(-64))) z[t] = z[t] > 0 ? z[t] / o.repetition_penalty : z[t] * o.repetition_penalty;
      }
      if (!(o.temperature > 0)) { let b = 0; for (let i = 1; i < n; i++) if (z[i] > z[b]) b = i; return b; }
      let idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => z[b] - z[a]);
      if (o.top_k) idx = idx.slice(0, o.top_k);
      const m = z[idx[0]];
      let p = idx.map((i) => Math.exp((z[i] - m) / o.temperature));
      let s = p.reduce((a, b) => a + b, 0);
      p = p.map((v) => v / s);
      if (o.top_p && o.top_p < 1) {                                        // lấy mẫu nhân (nucleus)
        let c = 0, k = 0;
        while (k < p.length && c <= o.top_p) { c += p[k]; k++; }
        idx = idx.slice(0, Math.max(1, k)); p = p.slice(0, Math.max(1, k));
        s = p.reduce((a, b) => a + b, 0); p = p.map((v) => v / s);
      }
      let r = Math.random(), acc = 0;
      for (let i = 0; i < p.length; i++) { acc += p[i]; if (r <= acc) return idx[i]; }
      return idx[idx.length - 1];
    }

    // Bộ nhớ đệm KV được giữ giữa các lần gọi: kvIds = các token đang nằm trong bộ nhớ đệm (vị trí 0..n-1).
    // Lần sau chỉ cần tính phần khác đi (vd tin nhắn mới), phần đầu giống nhau (lời nhắc hệ thống, lượt cũ) dùng lại.
    let kvIds = [];

    function feed(ids, wantLogits) {             // đưa ids vào bộ nhớ đệm, dùng lại phần đầu trùng
      let c = 0;
      const lim = Math.min(kvIds.length, ids.length - (wantLogits ? 1 : 0));
      while (c < lim && kvIds[c] === ids[c]) c++;
      let lg = null;
      for (let i = c; i < ids.length; i++) lg = step(ids[i], i, wantLogits && i === ids.length - 1);
      kvIds = ids.slice();
      return { logits: lg, reused: c };
    }

    /** Tính sẵn bộ nhớ đệm cho đoạn mở đầu (vd lời nhắc hệ thống) để lượt chat đầu nhanh hơn. */
    function prime(ids) { feed(ids.slice(0, BS - 1), false); }

    /** Sinh từng token (generator), cùng cách làm với GPT.generate bên Python. */
    function* generate(ids, opts) {
      const o = Object.assign({ max_new_tokens: 200, temperature: 0.7, top_k: 40, top_p: 0.9, repetition_penalty: 1.15, stop: [] }, opts);
      const stop = new Set(o.stop);
      let hist = ids.slice(-(BS - 1));
      if (!hist.length) hist = [0];
      let lg = feed(hist, true).logits;
      let pos = hist.length;
      for (let n = 0; n < o.max_new_tokens; n++) {
        const nxt = sample(lg, hist, o);
        if (stop.has(nxt)) return;
        yield nxt;
        hist.push(nxt);
        if (pos >= BS) {                                                    // hết ngữ cảnh: trượt cửa sổ, tính lại
          hist = hist.slice(-Math.floor(BS * 3 / 4));
          kvIds = [];
          lg = feed(hist, true).logits;
          pos = hist.length;
        } else {
          lg = step(nxt, pos, true);
          kvIds.push(nxt);
          pos++;
        }
      }
    }

    /** Khung hội thoại giống minigpt/chat_format.py (render + add_generation_prompt). */
    function chatIds(messages, system) {
      const sp = tok.special, ids = [];
      const msgs = messages.length && messages[0].role === 'system' ? messages : [{ role: 'system', content: system || header.system }].concat(messages);
      const role = { system: sp['<|system|>'], user: sp['<|user|>'], assistant: sp['<|assistant|>'] };
      for (const m of msgs) { ids.push(role[m.role]); for (const t of tok.encode(String(m.content).trim())) ids.push(t); ids.push(sp['<|end|>']); }
      ids.push(sp['<|assistant|>']);
      const keep = BS - Math.min(200, Math.floor(BS / 2));                // chừa chỗ cho câu trả lời
      return ids.slice(-keep);
    }

    let params = 0;
    for (const t of Object.values(T)) params += t.rows * t.cols;
    function systemIds(system) {
      const sp = tok.special;
      return [sp['<|system|>']].concat(tok.encode(String(system || header.system).trim()), [sp['<|end|>']]);
    }

    return {
      tok, step, generate, chatIds, header, prime, systemIds, reset() { kvIds = []; },
      stopIds: [tok.special['<|end|>'], tok.special['<|endoftext|>']],
      info: { params, n_layer: L, n_embd: C, block_size: BS, vocab: V, quant: header.quant, kind: header.kind },
    };
  }

  return { load, parse, Tokenizer };
}

/** Mã chạy trong Web Worker: nhận file, sinh chữ, gửi dần từng đoạn về trang. */
function miniGPTWorker(self) {
  const lib = MiniGPTLib();
  let m = null, stopFlag = false;
  const tick = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
  self.onmessage = async (e) => {
    const d = e.data;
    if (d.type === 'stop') { stopFlag = true; return; }
    try {
      if (d.type === 'load') {
        m = lib.load(d.buf);
        if (m.info.kind === 'chat') m.prime(m.systemIds());
        self.postMessage({ type: 'loaded', info: m.info });
      } else if (d.type === 'chat' || d.type === 'complete') {
        if (!m) throw new Error('Chưa nạp mô hình');
        stopFlag = false;
        const ids = d.type === 'chat' ? m.chatIds(d.messages) : m.tok.encode(d.text);
        const dec = new TextDecoder();
        const gen = m.generate(ids, Object.assign({ stop: m.stopIds }, d.opts));
        const t0 = Date.now();
        let text = '', n = 0, first = 0;
        for (;;) {
          const r = gen.next();
          if (r.done) break;
          if (!n) first = Date.now() - t0;
          n++;
          text += dec.decode(m.tok.bytes([r.value]), { stream: true });
          self.postMessage({ type: 'token', id: d.id, text });
          if (stopFlag) break;
          await tick();
        }
        text += dec.decode();
        const ms = Date.now() - t0;
        self.postMessage({ type: 'done', id: d.id, text, stats: { tokens: n, ms, firstMs: first, tps: n / Math.max(0.001, (ms - first) / 1000), stopped: stopFlag } });
      }
    } catch (err) {
      self.postMessage({ type: 'error', id: d.id, error: String((err && err.message) || err) });
    }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MiniGPTLib, miniGPTWorker };
