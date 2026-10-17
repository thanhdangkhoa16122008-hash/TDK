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
    // nipplejs 1.x gọi handler với MỘT đối tượng { type, target, data }; bản 0.x gọi (evt, data).
    // vector đã là vị trí núm / bán kính → lấy hướng chuẩn hóa rồi nhân lực một lần (tránh bình phương).
    joy.on('move', (e, d) => {
      d = d || (e && e.data);
      if (!d || !d.vector) return;
      const len = Math.hypot(d.vector.x, d.vector.y);
      if (len < 1e-4) { state.move.x = 0; state.move.y = 0; return; }
      const f = Math.min(Number.isFinite(d.force) ? d.force : len, 1);
      state.move.x = (d.vector.x / len) * f;
      state.move.y = (d.vector.y / len) * f;
    });
    joy.on('end', () => { state.move.x = 0; state.move.y = 0; });
  }
  // Nút bên phải
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'fixed', right: 'max(24px, env(safe-area-inset-right))', bottom: 'max(24px, env(safe-area-inset-bottom))',
    display: 'flex', gap: '16px', zIndex: 11,
  });
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
    b.addEventListener('pointercancel', up);
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

  // Mất focus (chuyển app, khóa màn hình): thả hết phím/nút/joystick để nhân vật không tự chạy tiếp
  const releaseAll = () => { keys.clear(); state.held.clear(); state.move.x = 0; state.move.y = 0; };
  addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

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
    releaseAll,
  };
}

// Màn hình yêu cầu xoay ngang (chỉ hiện trên điện thoại dọc).
// Có nút thử vào toàn màn hình + khóa ngang, và nút "Vẫn chơi màn dọc" để không bao giờ bị kẹt
// (app/khung xem không xoay được, hoặc máy tắt tự xoay). onPortrait() được gọi mỗi khi chuyển sang dọc.
export function requireLandscape(text = 'Xoay ngang điện thoại để chơi', onPortrait) {
  const o = document.createElement('div');
  o.className = 'tdk-ui';
  Object.assign(o.style, {
    position: 'fixed', inset: 0, display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px',
    textAlign: 'center', background: '#111', color: '#fff', font: '600 19px system-ui', zIndex: 1000, padding: '24px',
  });
  const msg = document.createElement('div');
  msg.textContent = '⟳ ' + text;
  const note = document.createElement('div');
  note.textContent = 'Nếu màn hình không tự xoay: bật "Tự động xoay" trong cài đặt nhanh của điện thoại.';
  Object.assign(note.style, { font: '400 13px system-ui', opacity: 0.7, maxWidth: '320px' });
  o.append(msg, note);
  let skip = false;
  const portraitNow = () => innerHeight > innerWidth && matchMedia('(pointer: coarse)').matches;
  const check = () => {
    const p = !skip && portraitNow();
    const was = o.style.display === 'flex';
    o.style.display = p ? 'flex' : 'none';
    if (p && !was) onPortrait?.();
  };
  const mk = (label, fn, primary) => {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      padding: '12px 22px', font: '700 16px system-ui', borderRadius: '10px', touchAction: 'manipulation',
      border: '1px solid #ffffff55', color: '#fff', background: primary ? '#7a1414' : '#ffffff1a', minWidth: '240px',
    });
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    o.appendChild(b);
  };
  mk('⤢ Toàn màn hình ngang', async () => {
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape');
    } catch (e) { /* khung xem không cho phép — dùng nút dưới */ }
    setTimeout(check, 300);
  }, true);
  mk('Vẫn chơi màn dọc', () => { skip = true; check(); });
  document.body.appendChild(o);
  addEventListener('resize', check);
  addEventListener('orientationchange', () => setTimeout(check, 200));
  check();
  return { check, get skipped() { return skip; } };
}

// Vào toàn màn hình rồi mới khóa ngang (Chrome Android chỉ cho khóa khi đã toàn màn hình). Lỗi thì bỏ qua.
export async function goFullscreenLandscape() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    await screen.orientation?.lock?.('landscape');
  } catch (e) { /* không hỗ trợ / bị khung xem từ chối */ }
}
