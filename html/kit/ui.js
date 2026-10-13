// ui.js — giao diện game cho điện thoại: thông báo, hội thoại có lựa chọn, thanh đồ, menu, loading.
//   UI.toast('Nhặt được 5 xu');
//   const pick = await UI.dialog('Bà lão', 'Cháu có muốn vào nhà không?', ['Có', 'Không']); // trả về chỉ số
//   const bar = UI.hotbar(6); bar.set(0, { icon: '🌱', count: 3 }); bar.onSelect = (i) => ...
//   UI.menu('Tạm dừng', [{ label: 'Tiếp tục', action: () => {} }, ...]);
//   const L = UI.loading('Đang tải...'); L.progress(0.5); L.done();
//   UI.bar('hp', { label: '❤', color: '#e53935' }).set(0.7);
const CSS = `
.tdk-ui{position:fixed;z-index:40;font-family:system-ui,-apple-system,sans-serif;color:#fff;-webkit-user-select:none;user-select:none}
.tdk-toasts{top:12px;right:12px;display:flex;flex-direction:column;gap:6px;align-items:flex-end;pointer-events:none}
.tdk-toast{background:rgba(20,20,28,.82);padding:8px 14px;border-radius:10px;font-size:14px;font-weight:600;animation:tdkIn .25s ease-out;box-shadow:0 4px 12px #0005}
@keyframes tdkIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.tdk-dialog{left:50%;bottom:110px;transform:translateX(-50%);width:min(680px,calc(100% - 32px));background:rgba(15,15,22,.9);border:1px solid #ffffff30;border-radius:14px;padding:14px 18px;box-shadow:0 8px 24px #0008;z-index:60}
.tdk-dialog .who{font-weight:800;color:#ffd54f;margin-bottom:4px;font-size:15px}
.tdk-dialog .txt{font-size:16px;line-height:1.45;min-height:2.9em}
.tdk-dialog .choices{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.tdk-btn{background:#ffffff1a;border:1px solid #ffffff40;color:#fff;border-radius:10px;padding:10px 16px;font:700 15px system-ui;touch-action:manipulation}
.tdk-btn:active{background:#ffffff40}
.tdk-btn.primary{background:#ffc107;color:#222;border-color:#ffc107}
.tdk-hint{position:absolute;right:14px;bottom:8px;font-size:12px;opacity:.6}
.tdk-hotbar{left:50%;bottom:12px;transform:translateX(-50%);display:flex;gap:6px}
.tdk-slot{width:52px;height:52px;border-radius:10px;background:rgba(0,0,0,.45);border:2px solid #ffffff40;display:flex;align-items:center;justify-content:center;font-size:26px;position:relative;touch-action:manipulation}
.tdk-slot.sel{border-color:#ffc107;background:rgba(255,193,7,.25)}
.tdk-slot .n{position:absolute;right:4px;bottom:1px;font-size:12px;font-weight:800;text-shadow:0 1px 2px #000}
.tdk-overlay{inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:80}
.tdk-panel{background:#1b1b24;border-radius:16px;padding:20px 24px;min-width:240px;display:flex;flex-direction:column;gap:10px;box-shadow:0 10px 30px #000a}
.tdk-panel h2{margin:0 0 6px;font-size:22px;text-align:center}
.tdk-loading{inset:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;z-index:90}
.tdk-track{width:min(320px,70vw);height:10px;border-radius:5px;background:#333;overflow:hidden}
.tdk-fill{height:100%;width:0;background:linear-gradient(90deg,#ffc107,#ff7043);transition:width .2s}
.tdk-bars{top:12px;left:12px;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.tdk-bar{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:700;text-shadow:0 1px 2px #000}
.tdk-bar .tdk-track{width:120px;height:8px}
.tdk-float{position:fixed;z-index:45;pointer-events:none;font:800 16px system-ui;color:#ffeb3b;text-shadow:0 2px 3px #000;animation:tdkUp 1s ease-out forwards}
@keyframes tdkUp{to{opacity:0;transform:translateY(-40px)}}
.tdk-prompt{left:50%;bottom:90px;transform:translateX(-50%);background:rgba(0,0,0,.6);padding:6px 14px;border-radius:20px;font-size:14px;font-weight:700;pointer-events:none}
`;
let styled = false;
const el = (cls, parent = document.body, tag = 'div') => {
  if (!styled) { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); styled = true; }
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
};
let toastBox, barsBox, promptEl;

export const UI = {
  toast(text, ms = 2200) {
    toastBox ||= el('tdk-ui tdk-toasts');
    const t = el('tdk-toast', toastBox);
    t.textContent = text;
    setTimeout(() => t.remove(), ms);
  },

  // Hội thoại kiểu game: chữ hiện dần, chạm để hiện hết / sang câu. Trả về chỉ số lựa chọn (hoặc -1).
  dialog(who, text, choices = [], { speed = 28, onChar } = {}) {
    return new Promise((resolve) => {
      const d = el('tdk-ui tdk-dialog');
      if (who) el('who', d).textContent = who;
      const txt = el('txt', d);
      const hint = el('tdk-hint', d);
      let i = 0, done = false;
      const finish = () => {
        done = true; txt.textContent = text; clearInterval(timer);
        if (choices.length) {
          hint.remove();
          const box = el('choices', d);
          choices.forEach((c, k) => {
            const b = el('tdk-btn', box, 'button');
            b.textContent = c;
            b.onclick = (e) => { e.stopPropagation(); d.remove(); resolve(k); };
          });
        } else hint.textContent = 'chạm để tiếp ▸';
      };
      const timer = setInterval(() => {
        txt.textContent = text.slice(0, ++i);
        onChar?.(text[i - 1]);
        if (i >= text.length) finish();
      }, 1000 / speed);
      d.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (!done) finish();
        else if (!choices.length) { d.remove(); resolve(-1); }
      });
    });
  },
  // Chuỗi hội thoại: [['Tên', 'câu 1'], ['Tên', 'câu 2', ['A', 'B']]]
  async story(lines, opts) {
    let last = -1;
    for (const [who, text, choices] of lines) last = await UI.dialog(who, text, choices, opts);
    return last;
  },

  hotbar(n = 6) {
    const bar = el('tdk-ui tdk-hotbar');
    const slots = [];
    const api = {
      selected: 0, items: Array(n).fill(null), onSelect: null,
      set(i, item) {
        api.items[i] = item;
        const s = slots[i];
        s.innerHTML = item ? `${item.icon || ''}${item.count > 1 ? `<span class="n">${item.count}</span>` : ''}` : '';
      },
      select(i) { slots[api.selected].classList.remove('sel'); api.selected = i; slots[i].classList.add('sel'); api.onSelect?.(i, api.items[i]); },
      get current() { return api.items[api.selected]; },
      el: bar,
    };
    for (let i = 0; i < n; i++) {
      const s = el('tdk-slot', bar);
      s.onpointerdown = (e) => { e.stopPropagation(); api.select(i); };
      slots.push(s);
    }
    slots[0].classList.add('sel');
    return api;
  },

  menu(title, items) {
    const o = el('tdk-ui tdk-overlay');
    const p = el('tdk-panel', o);
    el('', p, 'h2').textContent = title;
    items.forEach((it, k) => {
      const b = el('tdk-btn' + (k === 0 ? ' primary' : ''), p, 'button');
      b.textContent = it.label;
      b.onclick = () => { if (it.keepOpen !== true) o.remove(); it.action?.(); };
    });
    return { close: () => o.remove() };
  },

  loading(text = 'Đang tải...') {
    const o = el('tdk-ui tdk-loading');
    el('', o).textContent = text;
    const fill = el('tdk-fill', el('tdk-track', o));
    return { progress: (v) => (fill.style.width = Math.round(v * 100) + '%'), done: () => o.remove() };
  },

  bar(id, { label = '', color = '#4caf50', value = 1 } = {}) {
    barsBox ||= el('tdk-ui tdk-bars');
    const b = el('tdk-bar', barsBox);
    el('', b, 'span').textContent = label;
    const fill = el('tdk-fill', el('tdk-track', b));
    fill.style.background = color;
    const api = { set: (v) => (fill.style.width = Math.max(0, Math.min(1, v)) * 100 + '%') };
    api.set(value);
    return api;
  },

  // Chữ bay lên tại vị trí 3D (vd "+1 xu" trên đầu nhân vật)
  floatText(text, worldPos, camera, color) {
    const v = worldPos.clone().project(camera);
    const t = el('tdk-float');
    t.textContent = text;
    if (color) t.style.color = color;
    t.style.left = ((v.x + 1) / 2) * innerWidth - 20 + 'px';
    t.style.top = ((1 - v.y) / 2) * innerHeight - 20 + 'px';
    setTimeout(() => t.remove(), 1000);
  },

  // Gợi ý tương tác ("Chạm E để mở cửa"); prompt(null) để ẩn
  prompt(text) {
    promptEl ||= el('tdk-ui tdk-prompt');
    promptEl.style.display = text ? 'block' : 'none';
    if (text) promptEl.textContent = text;
  },
};
