// input.js — điều khiển cho điện thoại (joystick + nút) và bàn phím cho PC.
// Cần nạp trước: <script src="../../libs/input/nipplejs.min.js"></script>
// Dùng: const input = createInput({ buttons: ['jump', 'action'] });
//   mỗi frame đọc input.move.x / input.move.y (-1..1), input.pressed('jump') (true 1 lần mỗi lần bấm)
export function createInput({ buttons = ['jump'], labels = {} } = {}) {
  const state = { move: { x: 0, y: 0 }, held: new Set(), queue: new Set() };

  // Joystick nửa trái màn hình
  const zone = document.createElement('div');
  Object.assign(zone.style, { position: 'fixed', left: 0, top: 0, width: '50%', height: '100%', zIndex: 10, touchAction: 'none' });
  document.body.appendChild(zone);
  if (window.nipplejs) {
    const joy = window.nipplejs.create({ zone, mode: 'dynamic', color: 'white', size: 110 });
    joy.on('move', (_, d) => {
      if (!d || !d.vector) return;
      const f = Math.min(d.force ?? 1, 1);
      state.move.x = d.vector.x * f;
      state.move.y = d.vector.y * f;
    });
    joy.on('end', () => { state.move.x = 0; state.move.y = 0; });
  }

  // Nút bên phải
  const bar = document.createElement('div');
  Object.assign(bar.style, { position: 'fixed', right: '24px', bottom: '24px', display: 'flex', gap: '16px', zIndex: 11 });
  document.body.appendChild(bar);
  for (const name of buttons) {
    const b = document.createElement('button');
    b.textContent = labels[name] || name.toUpperCase();
    Object.assign(b.style, {
      width: '72px', height: '72px', borderRadius: '50%', border: '2px solid rgba(255,255,255,.7)',
      background: 'rgba(0,0,0,.35)', color: '#fff', font: 'bold 13px system-ui', touchAction: 'none', userSelect: 'none',
    });
    const down = (e) => { e.preventDefault(); state.held.add(name); state.queue.add(name); };
    const up = (e) => { e.preventDefault(); state.held.delete(name); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    bar.appendChild(b);
  }

  // Bàn phím (PC)
  const keys = new Set();
  const keyMap = { Space: 'jump', KeyE: 'action', KeyF: 'action', ShiftLeft: 'run' };
  addEventListener('keydown', (e) => {
    if (keys.has(e.code)) return;
    keys.add(e.code);
    const n = keyMap[e.code];
    if (n) { state.held.add(n); state.queue.add(n); }
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    const n = keyMap[e.code];
    if (n) state.held.delete(n);
  });

  return {
    get move() {
      const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const ky = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      if (kx || ky) { const l = Math.hypot(kx, ky); return { x: kx / l, y: ky / l }; }
      return state.move;
    },
    held: (n) => state.held.has(n),
    pressed: (n) => { const v = state.queue.has(n); state.queue.delete(n); return v; },
    keyMap,
  };
}

// Màn hình yêu cầu xoay ngang (chỉ hiện trên điện thoại dọc)
export function requireLandscape(text = 'Xoay ngang điện thoại để chơi') {
  const o = document.createElement('div');
  o.textContent = '⟳ ' + text;
  Object.assign(o.style, {
    position: 'fixed', inset: 0, display: 'none', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
    background: '#111', color: '#fff', font: '600 20px system-ui', zIndex: 1000, padding: '24px',
  });
  document.body.appendChild(o);
  const check = () => {
    const portrait = innerHeight > innerWidth && matchMedia('(pointer: coarse)').matches;
    o.style.display = portrait ? 'flex' : 'none';
  };
  addEventListener('resize', check);
  check();
}
