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
.tdk-hotbar{bottom:max(8px,env(safe-area-inset-bottom))!important}
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
.hud-paper{background:#d9cfb4;color:#2a2018;border-radius:4px;box-shadow:0 10px 40px #000;max-width:min(620px,92vw);max-height:88vh;overflow:auto;padding:16px 22px;font:16px/1.5 Georgia,serif;position:relative}
.hud-paper h3{margin:0 0 8px;font:700 18px Georgia,serif;color:#5a1a10}
.hud-paper pre{white-space:pre-wrap;font:inherit;margin:0}
.hud-paper img{display:block;max-width:100%;max-height:52vh;margin:0 auto 8px;border:1px solid #0003}
.hud-row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.hud-btn{background:#2a1a12;color:#fff;border:1px solid #ffffff40;border-radius:10px;padding:10px 18px;font:700 15px system-ui;touch-action:manipulation}
.hud-btn:active{filter:brightness(1.4)}
.hud-btn.gold{background:#b8860b;border-color:#ffd54f}
.hud-panel{background:#16141a;border:1px solid #ffffff25;border-radius:16px;padding:14px 18px;box-shadow:0 10px 40px #000;max-height:92vh;overflow:auto}
.hud-panel h2{margin:0 0 8px;font:700 18px Georgia,serif;text-align:center;color:#e8e0d0}
.kp{display:flex;gap:18px;align-items:center}
.kp-left{display:flex;flex-direction:column;gap:10px;align-items:center;width:200px}
.kp-disp{width:190px;height:52px;border-radius:8px;background:#061006;border:2px solid #333;color:#7dff8a;font:700 34px ui-monospace,monospace;letter-spacing:12px;display:flex;align-items:center;justify-content:center;text-shadow:0 0 8px #3f3}
.kp-disp.bad{color:#ff5050;text-shadow:0 0 8px #f33;animation:shake .3s}
.kp-disp.ok{color:#9dffaa;background:#0a2a0a}
@keyframes shake{25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
.kp-hint{font-size:12px;color:#999;text-align:center}
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
`;

let root = null;
const el = (cls, parent = document.body, tag = 'div') => {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
};
const btn = (parent, text, cls = 'hud-btn') => { const b = el(cls, parent, 'button'); b.textContent = text; b.addEventListener('pointerdown', (e) => e.stopPropagation()); return b; };

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
    subQueue.push([html, ms || Math.max(2400, html.replace(/<[^>]+>/g, '').length * 60)]);
    if (!subBusy) this._nextSub();
  },
  // xóa hàng chờ và hiện ngay câu mới
  subNow(html, ms) { subQueue.length = 0; subBusy = true; subQueue.push([html, ms || Math.max(2400, html.replace(/<[^>]+>/g, '').length * 60)]); this._nextSub(); },
  _nextSub() {
    clearTimeout(subTimer);
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
      const close = (v) => { o.remove(); HUD.open--; resolve(v); };
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

  // Bàn phím số. check(code) → true nếu đúng. Trả về true (mở được) / false (bỏ đi)
  keypad({ title, hint = '', len = 4, check }) {
    return this._modal((o, close) => {
      const p = el('hud-panel', o);
      el('', p, 'h2').textContent = title;
      const kp = el('kp', p);
      const left = el('kp-left', kp);
      const disp = el('kp-disp', left);
      el('kp-hint', left).textContent = hint;
      const lrow = el('hud-row', left);
      btn(lrow, 'Thoát ✕').onclick = () => done(false);
      const grid = el('kp-grid', kp);
      let code = '', lock = false;
      const show = () => (disp.textContent = code.padEnd(len, '_'));
      show();
      const press = (k) => {
        if (lock) return;
        if (k === '⌫') code = code.slice(0, -1);
        else if (k === '✓') {
          if (code.length < len) return;
          lock = true;
          if (check(code)) {
            disp.classList.add('ok'); disp.textContent = 'MỞ';
            SFX.play('unlock');
            setTimeout(() => done(true), 700);
          } else {
            disp.classList.add('bad'); disp.textContent = 'SAI';
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
      function done(v) { removeEventListener('keydown', onKey); close(v); }
    });
  },

  // Ổ khóa nhiều vòng hình. check(['star','fish',...]) → true nếu đúng
  symbolLock({ title, hint = '', shapes, len = 3, start = [], check }) {
    return this._modal((o, close) => {
      const p = el('hud-panel', o);
      el('', p, 'h2').textContent = title;
      if (hint) { const h = el('kp-hint', p); h.textContent = hint; h.style.marginBottom = '4px'; }
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
        up.onclick = () => { idx[i] = (idx[i] + shapes.length - 1) % shapes.length; SFX.play('lock'); draw(); };
        dn.onclick = () => { idx[i] = (idx[i] + 1) % shapes.length; SFX.play('lock'); draw(); };
        draw();
        wheels.push(cv);
      }
      const r = el('hud-row', p);
      r.style.justifyContent = 'center';
      btn(r, 'Thoát ✕').onclick = () => close(false);
      const ok = btn(r, 'Mở khóa', 'hud-btn gold');
      ok.onclick = () => {
        if (check(idx.map((k) => shapes[k]))) { SFX.play('unlock'); ok.textContent = '✓'; setTimeout(() => close(true), 500); }
        else { SFX.play('error'); wheels.forEach((c) => { c.style.animation = 'shake .3s'; setTimeout(() => (c.style.animation = ''), 320); }); }
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
        b.onclick = async () => { o.style.display = 'none'; HUD.open--; await HUD.note(n); HUD.open++; o.style.display = 'flex'; };
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
          const res = await it.action?.();
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
    btn(e, 'Chơi lại', 'hud-btn gold').onclick = onRestart;
    e.style.opacity = 0; e.style.transition = 'opacity 2s';
    requestAnimationFrame(() => (e.style.opacity = 1));
  },
};
