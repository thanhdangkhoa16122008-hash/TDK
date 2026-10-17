// hud.js — giao diện riêng của game: mục tiêu, phụ đề, đọc thư, bàn phím mật mã, ổ khóa hình,
// nhật ký, tạm dừng, màn đen/khe tủ, màn kết. Mọi bảng đều có class tdk-ui để không bị tính là vuốt camera.
import { SFX } from '../../kit/sfx.js';
import { drawShape, SHAPE_NAME } from './props.js';

const CSS = `
.hud{position:fixed;z-index:30;font-family:system-ui,-apple-system,sans-serif;color:#eee;-webkit-user-select:none;user-select:none}
.tdk-toasts{top:58px!important}
.tdk-prompt{bottom:60px!important}
.tdk-dialog{bottom:62px!important;width:min(600px,calc(100% - 220px))!important}
.cine .tdk-dialog{top:max(10px,env(safe-area-inset-top));bottom:auto!important}
.cine .tdk-hotbar,.cine .hud-obj{opacity:0}
.tdk-slot{width:44px!important;height:44px!important;font-size:22px!important}
.tdk-slot.sel{border-color:#ffffff40!important;background:rgba(0,0,0,.45)!important}
.tdk-hotbar{bottom:max(8px,env(safe-area-inset-bottom))!important;left:calc(50% - 90px)!important}
.tdk-bars{top:max(10px,env(safe-area-inset-top))!important;left:max(12px,env(safe-area-inset-left))!important}
.hud-obj{top:36px;left:max(12px,env(safe-area-inset-left));max-width:42vw;font-size:13px;font-weight:600;line-height:1.3;color:#d8d2c4;text-shadow:0 1px 3px #000;pointer-events:none;transition:color .4s}
.hud-obj.new{color:#ffd54f}
.hud-top{top:max(8px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));display:flex;gap:8px;z-index:41}
.hud-top button{width:44px;height:44px;border-radius:12px;border:1px solid #ffffff40;background:#0008;color:#fff;font-size:20px;touch-action:manipulation}
.hud-room{top:14px;left:50%;transform:translateX(-50%);font:600 15px Georgia,serif;letter-spacing:2px;color:#cfc7b5;opacity:0;transition:opacity .8s;pointer-events:none;text-shadow:0 2px 6px #000}
.hud-sub{left:50%;bottom:98px;transform:translateX(-50%);max-width:min(560px,62vw);text-align:center;font-size:14px;line-height:1.4;background:#000a;padding:7px 14px;border-radius:10px;opacity:0;transition:opacity .3s;pointer-events:none}
.hud-sub b{color:#ffd54f}
.hud-cross{left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#fff8;pointer-events:none;transition:all .15s}
.hud-cross.on{width:22px;height:22px;margin:-11px;background:transparent;border:2px solid #ffd54fcc}
.hud-fade{inset:0;background:#000;opacity:0;pointer-events:none;z-index:85;transition:opacity .4s}
.hud-red{inset:0;pointer-events:none;z-index:25;opacity:0;background:radial-gradient(ellipse at center,transparent 45%,#a0000099 100%);transition:opacity .3s}
.hud-slats{inset:0;pointer-events:none;z-index:24;display:none;background:repeating-linear-gradient(180deg,#000 0 18px,transparent 18px 34px),radial-gradient(ellipse at center,transparent 40%,#000 100%)}
.hud-modal{inset:0;z-index:80;background:#000c;display:flex;align-items:center;justify-content:center;padding:10px}
.hud-paper{box-sizing:border-box;background:#d9cfb4;color:#2a2018;border-radius:4px;box-shadow:0 10px 40px #000;max-width:min(620px,92vw);max-height:88vh;overflow:auto;padding:16px 22px;font:16px/1.5 Georgia,serif;position:relative}
.hud-paper h3{margin:0 0 8px;font:700 18px Georgia,serif;color:#5a1a10}
.hud-paper pre{white-space:pre-wrap;font:inherit;margin:0}
.hud-paper .hud-row{position:sticky;bottom:-16px;margin:10px -22px -16px;padding:8px 22px;background:#d9cfb4ee}
.hud-paper img{display:block;max-width:100%;max-height:52vh;margin:0 auto 8px;border:1px solid #0003}
.hud-row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.hud-btn{background:#2a1a12;color:#fff;border:1px solid #ffffff40;border-radius:10px;padding:10px 18px;font:700 15px system-ui;touch-action:manipulation}
.hud-btn:active{filter:brightness(1.4)}
.hud-btn.gold{background:#b8860b;border-color:#ffd54f}
.hud-panel{box-sizing:border-box;background:#16141a;border:1px solid #ffffff25;border-radius:16px;padding:14px 18px;box-shadow:0 10px 40px #000;max-height:92vh;overflow:auto}
.hud-panel h2{margin:0 0 8px;font:700 18px Georgia,serif;text-align:center;color:#e8e0d0}
.kp{display:flex;gap:18px;align-items:center}
.kp-left{display:flex;flex-direction:column;gap:10px;align-items:center;width:200px}
.kp-disp{width:190px;height:52px;border-radius:8px;background:#061006;border:2px solid #333;color:#7dff8a;font:700 34px ui-monospace,monospace;letter-spacing:12px;display:flex;align-items:center;justify-content:center;text-shadow:0 0 8px #3f3}
.kp-disp.bad{color:#ff5050;text-shadow:0 0 8px #f33;animation:shake .3s}
.kp-disp.ok{color:#9dffaa;background:#0a2a0a}
@keyframes shake{25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
.kp-hint{font-size:12px;color:#999;text-align:center;max-width:220px}
.kp-hint.warn{color:#ffcf6a;font-size:13px}
.kp-grid{display:grid;grid-template-columns:repeat(3,58px);gap:8px}
.kp-grid button{height:50px;border-radius:10px;border:1px solid #555;background:#2a2a30;color:#fff;font:700 22px system-ui;touch-action:manipulation}
.kp-grid button:active{background:#4a4a55}
.sl{display:flex;gap:14px;justify-content:center;margin:6px 0}
.sl-w{display:flex;flex-direction:column;align-items:center;gap:6px}
.sl-w button{width:84px;height:40px;border-radius:10px;border:1px solid #555;background:#2a2a30;color:#fff;font-size:18px;touch-action:manipulation}
.sl-w canvas{width:84px;height:84px;background:#e9e1cc;border-radius:10px;border:3px solid #5a4030}
.sl-n{font-size:12px;color:#aaa;height:14px}
.jr-list{display:flex;flex-direction:column;gap:8px;min-width:260px}
.end{inset:0;z-index:95;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;text-align:center}
.end h1{margin:0;font:800 30px Georgia,serif;color:#e8e0d0;letter-spacing:3px}
.end pre{white-space:pre-wrap;font:16px/1.6 Georgia,serif;color:#bbb;max-width:600px;margin:0}
.end .st{font-size:13px;color:#888}
button:disabled{opacity:.5}
@media (max-height:340px){
.hud-panel{padding:8px 14px}.hud-panel h2{font-size:15px;margin:0 0 4px}
.kp-grid button{height:40px}.kp-disp{height:42px;font-size:28px}
.sl-w canvas{width:60px;height:60px}.sl-w button{width:64px;height:30px}.sl{margin:2px 0}
.hud-row{margin-top:6px}.hud-btn{padding:8px 14px}
.hud-paper{padding:10px 16px;font-size:15px}
}
`;

let root = null;
const el = (cls, parent = document.body, tag = 'div') => {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
};
// Nút kích hoạt bằng pointerup: Chrome Android hủy "click" khi còn một ngón khác đang chạm màn hình
// (vd. ngón trái đang giữ joystick), nên không dựa vào click. Hành động gán qua b.onclick như bình thường.
const btn = (parent, text, cls = 'hud-btn') => {
  const b = el(cls, parent, 'button');
  b.textContent = text;
  let pid = null, viaPointer = 0;
  const fire = (e) => { if (!b.disabled) b.onclick?.(e); };
  b.addEventListener('pointerdown', (e) => { e.stopPropagation(); pid = e.pointerId; });
  b.addEventListener('pointerup', (e) => { if (e.pointerId !== pid) return; pid = null; viaPointer = performance.now(); fire(e); });
  b.addEventListener('pointercancel', () => (pid = null));
  b.addEventListener('pointerleave', () => (pid = null));
  // click đi kèm lần chạm vừa xử lý ở pointerup thì bỏ (tránh chạy 2 lần); click khác (bàn phím, .click()) vẫn chạy
  b.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    if (viaPointer && performance.now() - viaPointer < 800) { viaPointer = 0; return; }
    viaPointer = 0;
    fire(e);
  }, true);
  return b;
};

let objEl, subEl, crossEl, fadeEl, slatsEl, roomEl, redEl;
const subQueue = [];
let subBusy = false, subTimer = 0;

export const HUD = {
  open: 0, // số bảng đang mở → game tạm dừng khi > 0

  init({ onPause, onJournal }) {
    if (root) return;
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    root = true;
    objEl = el('hud hud-obj');
    roomEl = el('hud hud-room');
    subEl = el('hud hud-sub');
    crossEl = el('hud hud-cross');
    fadeEl = el('hud hud-fade');
    slatsEl = el('hud hud-slats');
    redEl = el('hud hud-red');
    const top = el('hud hud-top tdk-ui');
    const j = btn(top, '📖', ''); j.title = 'Nhật ký'; j.onclick = onJournal;
    const p = btn(top, '⏸', ''); p.title = 'Tạm dừng'; p.onclick = onPause;
  },

  objective(text) {
    if (objEl.dataset.t === text) return;
    const changed = !!objEl.dataset.t;
    objEl.dataset.t = text;
    objEl.textContent = '◆ ' + text;
    if (changed) { objEl.classList.add('new'); setTimeout(() => objEl.classList.remove('new'), 2500); }
  },

  room(name) {
    roomEl.textContent = name;
    roomEl.style.opacity = 1;
    clearTimeout(roomEl._t);
    roomEl._t = setTimeout(() => (roomEl.style.opacity = 0), 1800);
  },

  // Phụ đề tự ẩn (độc thoại ngắn, không cần chạm)
  sub(html, ms) {
    if (subQueue.some((q) => q[0] === html)) return; // không lặp câu đang chờ
    subQueue.push([html, ms || Math.max(2400, html.replace(/<[^>]+>/g, '').length * 60), performance.now()]);
    if (!subBusy) this._nextSub();
  },
  // xóa hàng chờ và hiện ngay câu mới
  subNow(html, ms) { subQueue.length = 0; subBusy = true; subQueue.push([html, ms || Math.max(2400, html.replace(/<[^>]+>/g, '').length * 60), performance.now()]); this._nextSub(); },
  _nextSub() {
    clearTimeout(subTimer);
    // câu chờ quá 9 giây đã lỗi thời (sự kiện đã qua) → bỏ
    while (subQueue.length && performance.now() - subQueue[0][2] > 9000) subQueue.shift();
    const n = subQueue.shift();
    if (!n) { subBusy = false; subEl.style.opacity = 0; return; }
    subBusy = true;
    subEl.innerHTML = n[0];
    subEl.style.opacity = 1;
    subTimer = setTimeout(() => { subEl.style.opacity = 0; subTimer = setTimeout(() => this._nextSub(), 300); }, n[1]);
  },
  clearSubs() { subQueue.length = 0; },

  cross(on) { crossEl.classList.toggle('on', !!on); },
  red(v) { redEl.style.opacity = v; },
  slats(on) { slatsEl.style.display = on ? 'block' : 'none'; },
  fade(v, ms = 400, color = '#000') {
    fadeEl.style.background = color;
    fadeEl.style.transition = ms ? `opacity ${ms}ms` : 'none';
    void fadeEl.offsetWidth;
    fadeEl.style.opacity = v;
    return new Promise((r) => setTimeout(r, ms + 30));
  },

  _modal(build) {
    return new Promise((resolve) => {
      HUD.open++;
      document.exitPointerLock?.();
      const o = el('hud hud-modal tdk-ui');
      o.addEventListener('pointerdown', (e) => e.stopPropagation());
      let closed = false;
      const close = (v) => { if (closed) return; closed = true; o.remove(); HUD.open = Math.max(0, HUD.open - 1); resolve(v); };
      build(o, close);
    });
  },

  // Đọc thư / xem tranh. note = { title, text, image?: canvas }
  note(note) {
    return this._modal((o, close) => {
      const p = el('hud-paper', o);
      el('', p, 'h3').textContent = note.title;
      if (note.image) { const img = el('', p, 'img'); img.src = note.image.toDataURL(); }
      if (note.text) el('', p, 'pre').textContent = note.text;
      const row = el('hud-row', p);
      btn(row, 'Đóng ✕').onclick = () => { SFX.play('click'); close(); };
      o.addEventListener('click', (e) => { if (e.target === o) close(); });
    });
  },

  // Bàn phím số. check(code) → true nếu đúng, hoặc chuỗi gợi ý / false nếu sai. Trả về true (mở được) / false (bỏ đi)
  keypad({ title, hint = '', len = 4, check }) {
    return this._modal((o, close) => {
      const p = el('hud-panel', o);
      el('', p, 'h2').textContent = title;
      const kp = el('kp', p);
      const left = el('kp-left', kp);
      const disp = el('kp-disp', left);
      const hintEl = el('kp-hint', left);
      hintEl.textContent = hint;
      const lrow = el('hud-row', left);
      btn(lrow, 'Thoát ✕').onclick = () => done(false);
      const grid = el('kp-grid', kp);
      let code = '', lock = false, solved = false, finished = false;
      const show = () => (disp.textContent = code.padEnd(len, '_'));
      show();
      const press = (k) => {
        if (lock) return;
        if (k === '⌫') code = code.slice(0, -1);
        else if (k === '✓') {
          if (code.length < len) return;
          lock = true;
          const res = check(code);
          if (res === true) {
            solved = true;
            disp.classList.add('ok'); disp.textContent = 'MỞ';
            SFX.play('unlock');
            setTimeout(() => done(true), 700);
          } else {
            disp.classList.add('bad'); disp.textContent = 'SAI';
            if (typeof res === 'string') { hintEl.textContent = res; hintEl.classList.add('warn'); }
            SFX.play('error');
            setTimeout(() => { disp.classList.remove('bad'); code = ''; show(); lock = false; }, 800);
          }
          return;
        } else if (code.length < len) code += k;
        SFX.play('click', { rate: 0.9 + Math.random() * 0.2 });
        show();
      };
      for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓']) {
        const b = btn(grid, k, '');
        if (k === '✓') b.style.background = '#2e5d2e';
        b.onclick = () => press(k);
      }
      const onKey = (e) => {
        if (/^\d$/.test(e.key)) press(e.key);
        else if (e.key === 'Backspace') press('⌫');
        else if (e.key === 'Enter') press('✓');
        else if (e.key === 'Escape') done(false);
      };
      addEventListener('keydown', onKey);
      function done(v) {
        if (finished || (solved && !v)) return; // đã đúng mã thì không cho "Thoát" làm mất kết quả
        finished = true;
        removeEventListener('keydown', onKey);
        close(v);
      }
    });
  },

  // Ổ khóa nhiều vòng hình. check(['star','fish',...]) → true nếu đúng, hoặc chuỗi gợi ý / false nếu sai
  symbolLock({ title, hint = '', shapes, len = 3, start = [], check }) {
    return this._modal((o, close) => {
      const p = el('hud-panel', o);
      el('', p, 'h2').textContent = title;
      const hintEl = el('kp-hint', p);
      hintEl.textContent = hint;
      Object.assign(hintEl.style, { marginBottom: '4px', maxWidth: 'none' });
      let solved = false;
      const row = el('sl', p);
      const idx = Array.from({ length: len }, (_, i) => start[i] ?? 0);
      const wheels = [];
      for (let i = 0; i < len; i++) {
        const w = el('sl-w', row);
        const up = btn(w, '▲', '');
        const cv = el('', w, 'canvas'); cv.width = cv.height = 168;
        const nm = el('sl-n', w);
        const dn = btn(w, '▼', '');
        const draw = () => {
          const g = cv.getContext('2d');
          g.clearRect(0, 0, 168, 168);
          drawShape(g, shapes[idx[i]], 84, 84, 58);
          nm.textContent = SHAPE_NAME[shapes[idx[i]]] || '';
        };
        up.onclick = () => { if (solved) return; idx[i] = (idx[i] + shapes.length - 1) % shapes.length; SFX.play('lock'); draw(); };
        dn.onclick = () => { if (solved) return; idx[i] = (idx[i] + 1) % shapes.length; SFX.play('lock'); draw(); };
        draw();
        wheels.push(cv);
      }
      const r = el('hud-row', p);
      r.style.justifyContent = 'center';
      btn(r, 'Thoát ✕').onclick = () => { if (!solved) close(false); };
      const ok = btn(r, 'Mở khóa', 'hud-btn gold');
      ok.onclick = () => {
        if (solved) return;
        const res = check(idx.map((k) => shapes[k]));
        if (res === true) {
          solved = true;
          p.querySelectorAll('button').forEach((b) => (b.disabled = true));
          SFX.play('unlock'); ok.textContent = '✓';
          setTimeout(() => close(true), 500);
        } else {
          SFX.play('error');
          if (typeof res === 'string') { hintEl.textContent = res; hintEl.classList.add('warn'); }
          wheels.forEach((c) => { c.style.animation = 'shake .3s'; setTimeout(() => (c.style.animation = ''), 320); });
        }
      };
    });
  },

  journal(list) {
    return this._modal((o, close) => {
      const p = el('hud-panel', o);
      el('', p, 'h2').textContent = '📖 Nhật ký';
      const box = el('jr-list', p);
      if (!list.length) el('kp-hint', box).textContent = 'Chưa có ghi chép nào.';
      for (const n of list) {
        const b = btn(box, '📄 ' + n.title);
        b.onclick = async () => {
          if (o.style.display === 'none') return;
          o.style.display = 'none'; HUD.open--;
          await HUD.note(n);
          HUD.open++; o.style.display = 'flex';
        };
      }
      const r = el('hud-row', p);
      btn(r, 'Đóng ✕').onclick = () => close();
    });
  },

  // Menu tạm dừng: items = [{ label: string | () => string, action, close?: bool }]
  menu(title, items) {
    return this._modal((o, close) => {
      const p = el('hud-panel', o);
      p.style.minWidth = '260px';
      el('', p, 'h2').textContent = title;
      const box = el('jr-list', p);
      for (const it of items) {
        const b = btn(box, typeof it.label === 'function' ? it.label() : it.label, it.gold ? 'hud-btn gold' : 'hud-btn');
        b.onclick = async () => {
          if (o.dataset.busy) return;
          o.dataset.busy = '1';
          let res;
          try { res = await it.action?.(); } finally { delete o.dataset.busy; }
          if (it.close !== false) close(res);
          else if (typeof it.label === 'function') b.textContent = it.label();
        };
      }
    });
  },

  ending({ title, text, stats, onRestart }) {
    const e = el('hud end tdk-ui');
    el('', e, 'h1').textContent = title;
    el('', e, 'pre').textContent = text;
    el('st', e).textContent = stats;
    const b = btn(e, 'Chơi lại', 'hud-btn gold');
    b.onclick = () => { b.disabled = true; onRestart(); };
    return e;
    e.style.opacity = 0; e.style.transition = 'opacity 2s';
    requestAnimationFrame(() => (e.style.opacity = 1));
  },
};
