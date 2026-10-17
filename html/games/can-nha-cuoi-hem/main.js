// main.js — CĂN NHÀ CUỐI HẺM: kinh dị góc nhìn thứ nhất, khám phá + giải đố, cho điện thoại màn ngang.
// Chuỗi câu đố: thư của mẹ → hũ bánh (chìa phòng làm việc) → nhật ký + đồng hồ (mã két) → cầu chì → két sắt
// (ảnh + chìa phòng bé) → tranh của Hạnh (ổ khóa hình) → hộp nhạc, búp bê → bàn thờ → chạy ra cửa chính.
// Sau khi có điện, "chú cao cao" đi săn theo đợt: trốn vào tủ hoặc rọi đèn pin để làm nó chậm lại.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createWorld } from '../../kit/world.js';
import { createPostFX } from '../../kit/postfx.js';
import { buildGridLevel } from '../../kit/level.js';
import { PlayerController } from '../../kit/controls.js';
import { createInput, requireLandscape, goFullscreenLandscape } from '../../kit/input.js';
import { SFX, Music, unlockAudio } from '../../kit/sfx.js';
import { Tex } from '../../kit/textures.js';
import { UI } from '../../kit/ui.js';
import { weather, Shake } from '../../kit/fx.js';
import { createSave } from '../../kit/save.js';
import { BUILDERS, bakeStatic, itemMesh, glint, materials, SHAPES, CHEST_ANSWER } from './props.js';
import { Hunter, Nav, makeGirl } from './ghost.js';
import { HUD } from './hud.js';
import { Ambience, Drone, musicBox, randomCreak } from './audio.js';
import { ITEMS, NOTES, objective, INTRO, INTRO_SLAM, FINAL, ENDING } from './story.js';

// xoay dọc giữa chừng → tự tạm dừng (pauseMenu là function nên gọi được trước khi khai báo)
requireLandscape(undefined, () => pauseMenu());

// ---------- Bản đồ (mỗi ô 2.4m) ----------
// # tường  W cửa sổ  D cửa  . sàn  P người chơi  g điểm hù ở hành lang
// Đồ đạc: c đồng hồ  f sofa  n bàn+thư  i chân dung  j hũ bánh  k bồn rửa  b tủ có pin  T bàn bếp  h tủ trốn
//         r tủ lạnh  x hộp điện  l kệ  m gương+tủ cầu chì  U bồn tắm  d bàn+nhật ký  s két sắt  K kệ sách
//         q thư của mẹ  o giường+búp bê  v tranh  y giường bé  t rương  a bàn thờ
const MAP = `
####W#######W###W####
#.jk.b#xb.#m.#.d...s#
#..T..#...#.U#K.....#
#h...r#l..#..#b....h#
###D#####D##D####D###
W.....b............gW
###D#####D####D###D##
#.....c#....#...#...#
#f..n..#...q#v.y#...#
#......#...o#...#...#
#..P..i#h...#..t#.a.#
###D#W####W###W##W###`;
const CELL = 2.4, WALL_H = 3.0;
const rows = MAP.trim().split('\n');
const GW = Math.max(...rows.map((r) => r.length)), GH = rows.length;
const cellAt = (x, z) => (rows[z] && rows[z][x]) || ' ';
const FRONT = [3, 11];

// ---------- Thế giới ----------
const W = createWorld({ background: 0x000000, fog: [1.5, 15], fov: 70 });
W.scene.fog.color.set(0x030305);
const BASE_HEMI = 0.15;
W.hemi.intensity = BASE_HEMI;
W.hemi.color.set(0x7a88b8);
W.hemi.groundColor.set(0x1a140e);
// không dùng mặt trời: gỡ hẳn khỏi cảnh (đèn intensity 0 vẫn tốn công tính trong shader)
W.scene.remove(W.sun, W.sun.target);

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
const L = buildGridLevel(W.scene, world, CANNON, MAP, {
  cell: CELL, wallHeight: WALL_H, doorColor: 0x3a2618,
  materials: {
    wall: new THREE.MeshStandardMaterial({ map: Tex.wallpaper(), roughness: 0.95 }),
    floor: new THREE.MeshStandardMaterial({ map: Tex.wood({ planks: 6 }), roughness: 0.8, color: 0x9a8a7a }),
    ceiling: new THREE.MeshStandardMaterial({ map: Tex.concrete(), roughness: 1, color: 0x55524e }),
  },
});
const o0 = L.center(0, 0);
const toWorld = (gx, gz, y = 0) => new THREE.Vector3(o0.x + gx * CELL, y, o0.z + gz * CELL);
const toGrid = (p) => [Math.round((p.x - o0.x) / CELL), Math.round((p.z - o0.z) / CELL)];

// mặt đất ngoài nhà (thấy qua cửa sổ khi chớp)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(GW * CELL + 60, GH * CELL + 60), new THREE.MeshStandardMaterial({ color: 0x1c2218, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
W.scene.add(ground);

// ---------- Phòng (để biết người chơi đang ở đâu) ----------
const ROOMS = [['Phòng khách', 2, 8], ['Bếp', 2, 2], ['Nhà kho', 8, 2], ['Nhà tắm', 11, 2], ['Phòng làm việc', 15, 2], ['Hành lang', 5, 5], ['Phòng ngủ', 9, 8], ['Phòng bé Hạnh', 14, 8], ['Phòng thờ', 18, 8]];
const roomGrid = new Array(GW * GH).fill(null);
const isRoomCell = (x, z) => { const c = cellAt(x, z); return c !== '#' && c !== 'W' && c !== ' ' && c !== 'D'; };
for (const [name, sx, sz] of ROOMS) {
  const st = [[sx, sz]];
  while (st.length) {
    const [x, z] = st.pop();
    if (!isRoomCell(x, z) || roomGrid[z * GW + x]) continue;
    roomGrid[z * GW + x] = name;
    st.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
  }
}
const roomAt = (x, z) => (x >= 0 && z >= 0 && x < GW && z < GH ? roomGrid[z * GW + x] : null);

// ---------- Cửa ----------
const doorAt = (gx, gz) => L.doors.find((d) => d.position.distanceTo(toWorld(gx, gz)) < 0.1);
const DOORS = {
  kitchen: doorAt(3, 4), storage: doorAt(9, 4), bath: doorAt(12, 4), study: doorAt(17, 4),
  living: doorAt(3, 6), bedroom: doorAt(9, 6), child: doorAt(14, 6), altar: doorAt(18, 6), front: doorAt(...FRONT),
};
Object.assign(DOORS.study, { key: 'brass', flag: 'studyOpen', lockMsg: 'Cửa phòng làm việc của ba. Khóa rồi.' });
Object.assign(DOORS.child, { key: 'child', flag: 'childOpen', lockMsg: 'Phòng bé Hạnh. Khóa. Trên cửa dán hình con thỏ.' });

// ---------- Đồ đạc ----------
const PREF = { c: 'e', f: 'w', j: 'n', k: 'n', b: 'nswe', h: 'wes', r: 'es', x: 'nw', l: 'ws', m: 'nw', U: 'e', d: 'n', s: 'en', K: 'w', q: 'e', o: 'e', v: 'w', y: 'e', t: 'es', a: 's', i: 'e' };
const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const props = {};
for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
  const c = cellAt(x, z);
  if (!BUILDERS[c]) continue;
  const p = BUILDERS[c]();
  const pos = toWorld(x, z);
  for (const k of PREF[c] || '') {
    const [dx, dz] = DIRS[k];
    if (cellAt(x + dx, z + dz) !== '#') continue;
    const off = CELL / 2 - p.depth / 2 - 0.02;
    pos.x += dx * off; pos.z += dz * off;
    p.g.rotation.y = Math.atan2(-dx, -dz);
    break;
  }
  p.g.position.copy(pos);
  p.cell = [x, z];
  W.scene.add(p.g);
  (props[c] ||= []).push(p);
}
W.scene.updateMatrixWorld(true);
// va chạm cho đồ to: hộp bao quanh phần tĩnh
const furniture = new CANNON.Body({ mass: 0 });
const allProps = Object.values(props).flat();
for (const p of allProps) {
  if (p.focus) p.focusW = p.g.localToWorld(p.focus.clone());
  if (!p.collide) continue;
  const b = new THREE.Box3().setFromObject(p.stat).expandByScalar(-0.03);
  const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  furniture.addShape(new CANNON.Box(new CANNON.Vec3(s.x / 2, s.y / 2, s.z / 2)), new CANNON.Vec3(c.x, c.y, c.z));
}
world.addBody(furniture);

// ---------- Đèn trần ----------
const LAMP_AT = [[3.5, 8.5], [3, 2], [8, 2], [11.5, 2], [16.5, 2], [2.5, 5], [9.5, 5], [16, 5], [9.5, 8.5], [14, 8.5]];
const lampStat = new THREE.Group();
W.scene.add(lampStat);
const M = materials();
const shadeMat = M.rust.clone();
shadeMat.side = THREE.DoubleSide; // chao đèn hở: nhìn từ dưới lên vẫn thấy mặt trong
const lamps = LAMP_AT.map(([gx, gz]) => {
  const p = toWorld(gx, gz);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.45, 4), M.black);
  cord.position.set(p.x, WALL_H - 0.22, p.z);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.22, 0.16, 10, 1, true), shadeMat);
  shade.position.set(p.x, WALL_H - 0.5, p.z);
  lampStat.add(cord, shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1a1410 }));
  bulb.position.set(p.x, WALL_H - 0.56, p.z);
  W.scene.add(bulb);
  return { pos: bulb.position, bulb, room: roomAt(Math.round(gx), Math.round(gz)), t: Math.random() * 10, lvl: 0, d: 0 };
});
const altar = props.a[0];
const candleLamp = { pos: altar.g.localToWorld(new THREE.Vector3(0, 1.3, 0.25)), bulb: { material: { color: new THREE.Color() } }, room: 'Phòng thờ', candle: true, t: 0, lvl: 0, d: 0 };
lamps.push(candleLamp);
const pool = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffb070, 0, 9, 1.6); W.scene.add(l); return l; });

// gộp mọi phần tĩnh để giảm draw call
W.scene.updateMatrixWorld(true);
bakeStatic(W.scene, [...allProps.map((p) => p.stat), lampStat]);

// ---------- Lưu game ----------
const save = createSave('can-nha-cuoi-hem', {
  version: 1,
  defaults: { started: false, inv: [], taken: {}, flags: {}, notes: [], visited: {}, battery: 1, deaths: 0, time: 0, pos: null, yaw: Math.PI, sens: 1 },
});
let S = save.data;
// thiết lập (độ nhạy) lưu riêng để không mất khi chơi lại
const cfg = createSave('can-nha-cuoi-hem-cfg', { defaults: { sens: S.sens ?? 1 } });
const SENS = [0.0035, 0.006, 0.009], SENS_NAME = ['Thấp', 'Vừa', 'Cao'];
// trình duyệt/khung xem có cho lưu không (iframe sandbox có thể chặn localStorage)
const canSave = (() => { try { localStorage.setItem('tdk-probe', '1'); localStorage.removeItem('tdk-probe'); return true; } catch (e) { return false; } })();

// ---------- Người chơi ----------
const input = createInput({ buttons: ['light', 'action'], labels: { light: '🔦', action: '✋' } });
input.keyMap.KeyF = 'light';
input.keyMap.Space = 'action';
for (const b of document.querySelectorAll('button')) {
  if (b.textContent === '✋') { Object.assign(b.style, { width: '86px', height: '86px', fontSize: '34px', background: 'rgba(70,45,20,.5)' }); b.parentElement.style.alignItems = 'flex-end'; }
  if (b.textContent === '🔦') b.style.fontSize = '26px';
}
const startPos = toWorld(3, 10);
const pc = new PlayerController({
  world, CANNON, input, camera: W.camera, mode: 'first', start: new THREE.Vector3(startPos.x, 0.2, startPos.z),
  walk: 2.5, run: 4.3, jump: 0, radius: 0.3, sensitivity: SENS[cfg.data.sens] ?? SENS[1],
});
pc.yaw = Math.PI;
W.scene.add(W.camera);

// đèn pin gắn camera
const flash = new THREE.SpotLight(0xfff1d6, 75, 18, 0.5, 0.5, 1.2);
flash.position.set(0.22, -0.18, 0);
flash.target.position.set(0, -0.3, -3);
flash.castShadow = !W.mobile;
flash.shadow.mapSize.set(512, 512);
W.camera.add(flash, flash.target);
let lightOn = true;
const batteryBar = UI.bar('bat', { label: '🔋', color: '#ffd54f' });

const fx = createPostFX(W, 'horror');
fx.set({ bloomThreshold: 0.9 });
const dust = weather(W.scene, 'dust');
const shake = new Shake(W.camera);

// ---------- Ma ----------
const nav = new Nav({
  w: GW, h: GH, toGrid, toWorld: (x, z) => toWorld(x, z),
  walkable: (x, z) => { const c = cellAt(x, z); return c !== '#' && c !== 'W' && c !== ' ' && !(x === FRONT[0] && z === FRONT[1]); },
});
const hunter = new Hunter(W.scene, nav);
const girl = makeGirl();
girl.visible = false;
W.scene.add(girl);

// ---------- Kho đồ ----------
// cùng lúc giữ tối đa 3 món (+ chìa cổng ở cuối) → 4 ô là đủ, chừa chỗ cho nút 🔦 trên màn hẹp
const bar = UI.hotbar(4);
bar.onSelect = (i, it) => { if (it) UI.toast(`${ITEMS[it.id].icon} ${ITEMS[it.id].name}: ${ITEMS[it.id].desc}`, 3500); };
const has = (i) => S.inv.includes(i);
function refreshInv() { for (let i = 0; i < bar.items.length; i++) bar.set(i, S.inv[i] ? { id: S.inv[i], icon: ITEMS[S.inv[i]].icon } : null); }
function give(i, quiet) {
  if (!has(i)) S.inv.push(i);
  refreshInv();
  if (quiet) return;
  SFX.play('pickup');
  UI.toast(`${ITEMS[i].icon} ${ITEMS[i].name}`);
}
function take(i) { S.inv = S.inv.filter((x) => x !== i); refreshInv(); }

let mode = 'menu';          // menu | play | cutscene | dead | end
let hiddenIn = null;
function checkpoint() {
  if (!hiddenIn && mode === 'play') { S.pos = [+pc.position.x.toFixed(2), +pc.position.z.toFixed(2)]; S.yaw = pc.yaw; }
  save.write();
  HUD.objective(objective(S));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// gen tăng mỗi khi có sự kiện lớn (bị bắt, cảnh kết, thắng, chơi lại) → các chuỗi hiệu ứng cũ tự hủy
let gen = 0;
// chờ ms rồi chờ tiếp tới khi đang chơi (không mở bảng/tạm dừng); trả false nếu chuỗi đã bị hủy
async function waitPlay(ms, g) {
  await wait(ms);
  while (g === gen && (HUD.open > 0 || mode !== 'play')) await wait(100);
  return g === gen;
}
// chạy fn sau ms nếu chuỗi chưa bị hủy (âm thanh, phụ đề phụ)
const later = (ms, fn) => { const g = gen; setTimeout(() => { if (g === gen) fn(); }, ms); };
const clamp = THREE.MathUtils.clamp;

// ---------- Hiệu ứng chuyển động nhỏ ----------
const tweens = [];
function tween(obj, key, to, dur = 0.8) { tweens.push({ obj, key, from: obj[key], to, t: 0, dur }); }
function updateTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i];
    w.t += dt;
    const k = Math.min(1, w.t / w.dur), e = 1 - Math.pow(1 - k, 3);
    w.obj[w.key] = w.from + (w.to - w.from) * e;
    if (k >= 1) tweens.splice(i, 1);
  }
}

// ---------- Đốm sáng đánh dấu ----------
const glints = [];
function addGlint(pos, on) { const s = glint(); s.position.copy(pos); W.scene.add(s); glints.push({ s, on, ph: Math.random() * 6 }); }

// ---------- Vật tương tác ----------
// thing: { pos, label() → chữ gợi ý hoặc null (ẩn), act(), range, los:false (bỏ kiểm tra tầm nhìn) }
const things = [];
const thing = (pos, label, act, opts = {}) => { const t = { pos, label, act, range: 2.1, ...opts }; things.push(t); return t; };
const one = (c) => props[c][0];

// ghi chú phụ có ảnh (đồng hồ, tranh) để xem lại trong nhật ký
NOTES.clock = { title: 'Đồng hồ quả lắc', image: one('c').faceTex.image, text: 'Đồng hồ đã chết máy từ lâu. Kim giờ gần chạm số XII, kim phút chỉ số IX — 11 giờ 45.\nNgoài cửa sổ trời tối đen, như đêm hôm ấy.' };
NOTES.drawing = { title: 'Tranh của Hạnh', image: one('v').canvas, text: 'Nét bút sáp của trẻ con. Ba "người bạn" có ghi số bên dưới... và một bóng đen cao lêu nghêu ở góc tranh.' };

async function readNote(id) {
  if (!S.notes.includes(id)) S.notes.push(id);
  SFX.play('pickup', { rate: 1.6, volume: 0.4 });
  await HUD.note(NOTES[id]);
  checkpoint();
}
const seen = (id) => S.notes.includes(id);

// cửa
for (const d of L.doors) {
  if (d === DOORS.front) continue;
  thing(d.position.clone().setY(1.2), () => {
    if (d.locked) return d.key && has(d.key) ? `🔓 Mở khóa (${ITEMS[d.key].name})` : '🔒 Cửa bị khóa';
    return d.isOpen ? '✋ Đóng cửa' : '✋ Mở cửa';
  }, () => {
    if (d.locked) {
      if (d.key && has(d.key)) {
        d.locked = false; S.flags[d.flag] = true; take(d.key);
        SFX.play('unlock'); d.open(); SFX.play('door');
        checkpoint();
      } else { SFX.play('lock'); HUD.subNow(d.lockMsg || 'Khóa rồi.'); }
      return;
    }
    if (d.toggle()) SFX.play('door', { rate: 0.9 + Math.random() * 0.2 });
  }, { los: false, range: 2.2 });
}
// cửa chính
thing(DOORS.front.position.clone().setY(1.2), () => (has('gate') ? '🔓 MỞ CỬA CHÍNH' : '🔒 Cửa chính'), () => {
  if (has('gate')) return win();
  SFX.play('lock');
  HUD.subNow('Khóa cứng. Phải tìm chìa khóa cổng.');
}, { los: false, range: 2.3 });

// phòng khách
thing(one('n').focusW, () => (seen('intro') ? '📄 Đọc lại mảnh giấy' : '📄 Đọc mảnh giấy'), () => readNote('intro'));
addGlint(one('n').focusW.clone().setY(1.0), () => !seen('intro'));
thing(one('c').focusW, () => '🕰️ Xem đồng hồ', () => readNote('clock'));
thing(one('i').focusW, () => '🖼️ Xem tranh', () => HUD.subNow('Chân dung cả nhà. Khuôn mặt bé Hạnh bị ai đó cào nát.'));

// bếp
thing(one('j').focusW, () => (S.taken.jar ? null : '🍪 Mở hũ bánh'), () => {
  S.taken.jar = true; give('brass');
  HUD.subNow('Chìa khóa đồng... vẫn nằm đây sau hai mươi năm.');
  checkpoint();
});
addGlint(one('j').focusW.clone().setY(1.35), () => !S.taken.jar);
thing(one('k').focusW, () => '🚰 Bồn rửa', () => { HUD.subNow('Nước đen ngòm, bốc mùi tanh.'); SFX.play('knock', { volume: 0.4, pan: 0.6 }); });
thing(one('r').focusW, () => '🧊 Tủ lạnh', () => HUD.subNow('Không dám mở. Có gì đó đang rỉ ra từ khe cửa.'));

// pin
props.b.forEach((p, i) => {
  const id = 'bat' + i;
  const m = itemMesh('battery');
  m.position.copy(p.g.localToWorld(p.itemPos.clone()));
  m.rotation.y = Math.random() * 3;
  W.scene.add(m);
  p.battery = m;
  addGlint(m.position.clone().setY(m.position.y + 0.25), () => !S.taken[id]);
  thing(m.position, () => (S.taken[id] ? null : `🔋 Nhặt pin (đèn ${Math.round(S.battery * 100)}%)`), () => {
    const gain = Math.min(1, S.battery + 0.6) - S.battery;
    if (gain < 0.08) { HUD.subNow('Đèn pin còn gần đầy. Để dành cục pin này sau.'); return; }
    S.taken[id] = true; m.visible = false;
    S.battery += gain; lightOn = true;
    SFX.play('battery');
    UI.toast(`🔋 Pin đèn pin +${Math.round(gain * 100)}%`);
    checkpoint();
  }, { range: 2.0 });
});

// nhà kho: hộp điện
const fuseBox = one('x');
thing(fuseBox.focusW, () => (S.flags.power ? null : has('fuse') ? '🔌 Lắp cầu chì' : '⚡ Xem hộp điện'), () => {
  if (!has('fuse')) return readNote('fusebox');
  take('fuse');
  S.flags.power = true;
  huntTimer = 28;
  syncVisuals();
  checkpoint();
  SFX.play('lock');
  later(350, () => { SFX.play('hum'); SFX.play('unlock'); HUD.subNow('Có điện rồi! Két sắt trong phòng làm việc chắc đã dùng được.'); });
});

// nhà tắm: tủ dưới gương (cầu chì) + hù trong gương
const mirror = one('m');
thing(mirror.focusW, () => (S.taken.fuse ? null : '🚪 Mở tủ dưới gương'), () => {
  S.taken.fuse = true; give('fuse');
  checkpoint();
  mirrorScare();
});
async function mirrorScare() {
  const g = gen;
  if (!(await waitPlay(700, g))) return;
  // ngẩng lên nhìn gương...
  for (let i = 0; i < 20; i++) { pc.pitch += (0.05 - pc.pitch) * 0.2; if (!(await waitPlay(25, g))) return; }
  mirror.ghostFace.visible = true;
  SFX.play('scream', { volume: 0.7 }); SFX.play('glitch'); fx.flash(0.3); shake.add(0.5);
  await wait(380);
  mirror.ghostFace.visible = false;
  if (g === gen) HUD.subNow('...!! Trong gương... Chắc mình hoa mắt.');
}
addGlint(mirror.focusW.clone().setY(0.9), () => !S.taken.fuse);
thing(one('U').focusW, () => '🛁 Bồn tắm', () => HUD.subNow('Nước đen kịt. Mình không muốn biết dưới đáy có gì.'));

// phòng làm việc
thing(one('d').focusW, () => (seen('diary') ? '📖 Đọc lại nhật ký' : '📖 Đọc nhật ký'), () => readNote('diary'));
addGlint(one('d').focusW.clone().setY(1.1), () => !seen('diary'));
thing(one('K').focusW, () => '📚 Kệ sách', () => HUD.subNow('Toàn sổ sách kế toán của ba. Một cuốn bị xé hết trang.'));
const safe = one('s');
let safeWrong = 0;
thing(safe.focusW, () => (S.flags.safeOpen ? null : '🔐 Két sắt'), async () => {
  if (!S.flags.power) { SFX.play('error'); HUD.subNow('Màn hình két tối om. Két điện tử — phải có điện mới mở được.'); return; }
  const ok = await HUD.keypad({
    title: 'Két sắt điện tử', hint: 'Mã 4 chữ số', len: 4,
    check: (c) => {
      if (c === '2345') return true;
      safeWrong++;
      if (c === '1145') return 'Gần đúng... Ba ghi giờ theo kiểu 24 giờ, mà lúc đó là ban đêm.';
      if (safeWrong >= 2) return seen('diary') ? 'Mã là giờ chiếc đồng hồ quả lắc dừng lại, viết kiểu 24 giờ.' : 'Có lẽ trong phòng này có ghi chép gì đó...';
      return false;
    },
  });
  if (!ok) return;
  // đổi trạng thái + đưa đồ NGAY rồi lưu, hiệu ứng chạy sau (tải lại giữa chừng không mất đồ)
  S.flags.safeOpen = true;
  give('photo', true); give('child', true);
  checkpoint();
  tween(safe.door.rotation, 'y', -1.9, 1.2);
  SFX.play('door', { rate: 1.3 });
  later(600, () => { SFX.play('pickup'); UI.toast(`${ITEMS.photo.icon} ${ITEMS.photo.name}`); });
  later(1100, () => { SFX.play('pickup'); UI.toast(`${ITEMS.child.icon} ${ITEMS.child.name}`); HUD.subNow('Tấm ảnh cả nhà... và chìa khóa phòng bé Hạnh.'); });
});

// phòng ngủ
thing(one('q').focusW, () => (seen('mother') ? '📄 Đọc lại thư' : '📄 Đọc thư'), () => readNote('mother'));
addGlint(one('q').focusW.clone().setY(0.95), () => !seen('mother'));
const bed = one('o');
const doll = itemMesh('doll');
doll.position.copy(bed.g.localToWorld(bed.itemPos.clone()));
doll.rotation.y = bed.g.rotation.y + 0.6;
W.scene.add(doll);
addGlint(doll.position.clone().setY(doll.position.y + 0.45), () => !S.taken.doll);
thing(doll.position.clone().setY(doll.position.y + 0.15), () => (S.taken.doll ? null : '🧸 Nhặt búp bê'), () => {
  S.taken.doll = true; doll.visible = false; give('doll');
  checkpoint();
  dollScare();
});
async function dollScare() {
  const g = gen;
  if (!(await waitPlay(500, g))) return;
  if (DOORS.bedroom.isOpen) DOORS.bedroom.close();
  SFX.play('slam'); shake.add(0.6); blackout = 2.5;
  if (!(await waitPlay(400, g))) return;
  SFX.play('whisper');
  HUD.subNow('<i>"Trả... Mi-Mi... cho em..."</i>');
}

// phòng bé
thing(one('v').focusW, () => '🖍️ Xem bức tranh', () => readNote('drawing'), { range: 2.6 });
const chest = one('t');
let chestWrong = 0;
thing(chest.focusW, () => (S.flags.chestOpen ? null : '🔒 Rương bí mật'), async () => {
  if (!seen('chest')) await readNote('chest');
  const ok = await HUD.symbolLock({
    title: 'Ổ khóa 3 hình', hint: 'Xoay ▲▼ để chọn hình, rồi bấm Mở khóa', shapes: SHAPES, len: 3, start: [3, 4, 3],
    check: (arr) => {
      if (arr.join() === CHEST_ANSWER.join()) return true;
      if (++chestWrong >= 2) return seen('drawing') ? 'Bức tranh trên tường có đánh số các bạn của Hạnh: 1 → 2 → 3.' : 'Hạnh nói thứ tự nằm trong BỨC TRANH trên tường...';
      return false;
    },
  });
  if (!ok) return;
  S.flags.chestOpen = true;
  give('musicbox', true);
  checkpoint();
  chest.lock.visible = false;
  tween(chest.lid.rotation, 'x', -1.3, 1.0);
  SFX.play('door', { rate: 1.6, volume: 0.6 });
  later(700, () => {
    SFX.play('pickup'); UI.toast(`${ITEMS.musicbox.icon} ${ITEMS.musicbox.name}`);
    playBox({ vol: 0.45 });
    HUD.subNow('Hộp nhạc của Hạnh. Bài ru mẹ hay hát...');
  });
});
thing(one('y').focusW || one('y').g.position.clone().setY(0.6), () => '🛏️ Giường bé', () => HUD.subNow('Chăn vẫn gấp gọn. Trên gối còn vài sợi tóc dài.'));

// bàn thờ
const altarItems = {};
for (const k of ['photo', 'doll', 'musicbox']) {
  const m = itemMesh(k);
  m.position.copy(altar.slots[k].pos);
  altar.g.add(m);
  m.visible = false;
  altarItems[k] = m;
}
thing(altar.focusW, () => {
  if (S.flags.final) return null;
  const n = ['photo', 'doll', 'musicbox'].filter((k) => has(k)).length;
  return n ? `🕯️ Đặt lên bàn thờ (${n})` : '🕯️ Bàn thờ';
}, () => {
  const ALL = ['photo', 'doll', 'musicbox'];
  const items = ALL.filter((k) => has(k));
  if (!items.length) {
    if (ALL.every((k) => S.flags['altar_' + k])) { finale(); return; }
    const missing = ALL.filter((k) => !S.flags['altar_' + k]).map((k) => ITEMS[k].name.toLowerCase());
    HUD.subNow(missing.length === 3 ? 'Bàn thờ có ba chỗ trống: một khung ảnh, một vết bụi hình búp bê, một ô vuông nhỏ.' : `Bàn thờ còn thiếu: ${missing.join(', ')}.`);
    return;
  }
  for (const k of items) { take(k); S.flags['altar_' + k] = true; altarItems[k].visible = true; }
  items.forEach((k, i) => later(i * 300, () => SFX.play('pickup', { rate: 0.7 })));
  if (ALL.every((k) => S.flags['altar_' + k])) { finale(); return; }
  checkpoint();
  later(items.length * 300, () => { SFX.play('whisper', { volume: 0.4 }); HUD.subNow('Ngọn nến bùng lên một chút...'); });
});

// tủ để trốn
for (const p of props.h) thing(p.focusW, () => (S.flags.final ? null : '🚪 Trốn vào tủ'), () => hide(p));

// ---------- Trốn ----------
const hideLook = { yaw: 0, pitch: 0 };
let lightBeforeHide = true;
function hide(p) {
  if (hunter.state === 'hunt' && Math.hypot(hunter.pos.x - pc.position.x, hunter.pos.z - pc.position.z) < 1.4) { caught(); return; }
  hiddenIn = p;
  hideLook.yaw = 0; hideLook.pitch = -0.05;
  pc.look.take();
  pc.body.velocity.set(0, 0, 0);
  lightBeforeHide = lightOn;
  lightOn = false;
  HUD.slats(true);
  SFX.play('door', { volume: 0.5, rate: 1.5 });
  HUD.subNow('Đang trốn trong tủ... nín thở. Bấm ✋ để ra.');
}
function unhide() {
  const p = hiddenIn;
  hiddenIn = null;
  HUD.slats(false);
  SFX.play('door', { volume: 0.5, rate: 1.4 });
  const e = p.g.localToWorld(p.exitLocal.clone());
  pc.body.position.set(e.x, 0.2, e.z);
  pc.body.velocity.set(0, 0, 0);
  pc.yaw = p.g.rotation.y + Math.PI; pc.pitch = 0;
  lightOn = lightBeforeHide && S.battery > 0.01;
}
function updateHidden(t) {
  const [dx, dy] = pc.look.take();
  hideLook.yaw = clamp(hideLook.yaw - dx * pc.sensitivity, -0.7, 0.7);
  hideLook.pitch = clamp(hideLook.pitch - dy * pc.sensitivity, -0.5, 0.4);
  W.camera.position.copy(hiddenIn.g.localToWorld(hiddenIn.camLocal.clone()));
  W.camera.position.y += Math.sin(t * 1.4) * 0.012;
  W.camera.rotation.set(hideLook.pitch, hiddenIn.g.rotation.y + Math.PI + hideLook.yaw, 0, 'YXZ');
}

// ---------- Săn đuổi ----------
let huntTimer = 30, huntLeft = 0, warnT = 0, hiddenT = 0, chaseDelay = -1, ghostStepT = 0, heartT = 0, ghostFade = 0, scareT = 0, danger = 0;
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), fwd = new THREE.Vector3();
const ray = new THREE.Raycaster();
const blockers = [...L.walls, ...L.doors.map((d) => d.panel)];
function losClear(from, to) {
  tmpB.copy(to).sub(from);
  const dist = tmpB.length();
  ray.set(from, tmpB.divideScalar(dist));
  ray.far = Math.max(0.01, dist - 0.15);
  return ray.intersectObjects(blockers, false).length === 0;
}
function ghostLit() {
  if (!lightOn || !hunter.model.visible) return false;
  const head = tmpA.copy(hunter.pos); head.y = 1.7;
  const cam = W.camera.position;
  const d = head.distanceTo(cam);
  if (d > 11) return false;
  W.camera.getWorldDirection(fwd);
  if (tmpB.copy(head).sub(cam).normalize().dot(fwd) < Math.cos(0.4)) return false;
  return losClear(cam, head);
}
function pickSpawn(minD = 9, maxD = 16) {
  const dist = nav.distances(toGrid(pc.position));
  const opts = [];
  let far = null;
  for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
    const d = dist[z * GW + x];
    if (d < 0 || cellAt(x, z) === 'D') continue;
    if (d >= minD && d <= maxD && roomAt(x, z) !== curRoom) opts.push([x, z]);
    if (!far || d > far[0]) far = [d, x, z];
  }
  return opts.length ? opts[Math.floor(Math.random() * opts.length)] : [far[1], far[2]];
}
function startHunt() {
  hunter.spawn(pickSpawn());
  huntLeft = 24 + Math.random() * 8;
  hiddenT = 0;
  SFX.play('glitch');
  if (!S.flags.firstHunt) {
    S.flags.firstHunt = true; save.write();
    HUD.subNow('<b>BÓNG ĐEN đang săn bạn!</b> Trốn vào tủ 🚪 hoặc rọi đèn pin 🔦 vào nó để làm nó chậm lại.', 6500);
  } else HUD.subNow('Nó đang tới...');
}
function endHunt() {
  hunter.state = 'leaving';
  ghostFade = 1;
  huntTimer = 75 + Math.random() * 45;
  HUD.subNow('...Nó đi rồi.');
}
function updateHunt(dt) {
  const final = S.flags.final;
  if (chaseDelay > 0) {
    chaseDelay -= dt;
    if (chaseDelay <= 0) { hunter.spawn([17, 2]); SFX.play('scream', { volume: 0.6 }); }
  }
  if (hunter.state === 'leaving') {
    ghostFade -= dt;
    hunter.setOpacity(Math.max(0, ghostFade));
    if (ghostFade <= 0) hunter.despawn();
  }
  if (hunter.state !== 'hunt') {
    danger = Math.max(0, danger - dt);
    if (S.flags.power && !final && hunter.state === 'off') {
      huntTimer -= dt;
      if (huntTimer < 4.5 && huntTimer > 0 && warnT <= 0) { warnT = 4.5; SFX.play('hum'); HUD.sub('Đèn chập chờn... có gì đó đang đến.'); }
      if (huntTimer <= 0) startHunt();
    }
    Drone.set(danger * 0.5);
    return;
  }
  const lit = ghostLit();
  hunter.lit = lit;
  const speed = (final ? 3.35 : 2.3) * (lit ? 0.3 : 1);
  hunter.update(dt, hiddenIn ? null : pc.position, speed);
  const dist = Math.hypot(hunter.pos.x - pc.position.x, hunter.pos.z - pc.position.z);
  if (!hiddenIn && dist < 0.8) { caught(); return; }
  if (!final) {
    huntLeft -= dt;
    if (hiddenIn) hiddenT += dt;
    if (huntLeft <= 0 || hiddenT > 7) { endHunt(); return; }
  }
  danger = clamp(1 - dist / 14, 0, 1);
  Drone.set(0.25 + danger * 0.75);
  if ((heartT -= dt) <= 0) { SFX.play('heartbeat', { volume: 0.4 + danger * 0.6 }); heartT = 1.0 - danger * 0.6; }
  if ((ghostStepT -= dt) <= 0) {
    ghostStepT = final ? 0.55 : 0.75;
    W.camera.getWorldDirection(fwd);
    tmpA.copy(hunter.pos).sub(W.camera.position).normalize();
    const pan = clamp(-fwd.z * tmpA.x + fwd.x * tmpA.z, -1, 1);
    SFX.play('step', { volume: 0.25 + danger * 0.9, rate: 0.5, pan });
  }
  if (lit && Math.random() < dt * 3) SFX.play('glitch', { volume: 0.3 });
}

async function caught() {
  if (mode !== 'play') return;
  const g = ++gen;
  mode = 'dead';
  acting = false;
  S.deaths++;
  if (hiddenIn) { hiddenIn = null; HUD.slats(false); }
  HUD.clearSubs();
  chaseDelay = -1;
  hunter.jumpscare(W.camera);
  SFX.play('scream'); SFX.play('hit');
  shake.add(1); fx.flash(0.5); HUD.red(1);
  navigator.vibrate?.([200, 60, 300]);
  await wait(900);
  if (g !== gen) return;
  await HUD.fade(1, 500);
  if (g !== gen) return;
  hunter.despawn(); Drone.set(0); HUD.red(0); danger = 0;
  respawn();
  await wait(700);
  if (g !== gen) return;
  mode = 'play';
  HUD.fade(0, 1400);
  if (S.flags.final) { chaseDelay = 3.5; HUD.subNow('<b>Chạy!</b> Ra cửa chính ở phòng khách!'); }
  else { huntTimer = 50 + Math.random() * 30; HUD.subNow('Mình... vẫn còn sống? Nó tha cho mình lần này.'); }
  checkpoint();
}
function placePlayer(gx, gz, yaw) {
  const p = toWorld(gx, gz);
  pc.body.position.set(p.x, 0.2, p.z);
  pc.body.velocity.set(0, 0, 0);
  pc.position.set(p.x, 0.2, p.z);
  pc.yaw = yaw; pc.pitch = 0;
}
function respawn() {
  if (S.flags.final) placePlayer(18, 8, 0);
  else placePlayer(3, 9, 0);
  S.battery = Math.max(S.battery, 0.35);
}

// ---------- Kết ----------
function finale() {
  if (mode !== 'play') return;
  const g = ++gen;
  mode = 'cutscene';
  acting = false;
  // trạng thái cuối được ghi NGAY: tải lại giữa cảnh sẽ vào thẳng đoạn chạy thoát (applyState)
  S.flags.final = true;
  give('gate', true);
  save.write();
  document.exitPointerLock?.();
  HUD.clearSubs();
  hunter.despawn(); chaseDelay = -1; warnT = 0;
  Drone.set(0); danger = 0; HUD.red(0);
  finaleScene(g);
}
async function finaleScene(g) {
  // hồn bé Hạnh hiện ra giữa người chơi và bàn thờ, quay mặt về phía người chơi
  const ap = altar.g.localToWorld(new THREE.Vector3(0, 0, 0.9));
  const gp = pc.position.clone().setY(0);
  const dir = ap.clone().sub(gp).setY(0);
  gp.addScaledVector(dir.normalize(), Math.min(2.2, Math.max(0.9, ap.distanceTo(gp) * 0.6)));
  girl.position.copy(gp);
  girl.rotation.y = Math.atan2(-dir.x, -dir.z);
  girl.visible = true;
  girlTarget = 1;
  pc.yaw = Math.atan2(-(gp.x - pc.position.x), -(gp.z - pc.position.z));
  pc.pitch = -0.22;
  playBox({ vol: 0.5 });
  await wait(1500);
  if (g !== gen) return;
  document.body.classList.add('cine');
  await UI.story(FINAL);
  document.body.classList.remove('cine');
  if (g !== gen) return;
  SFX.play('pickup'); UI.toast(`${ITEMS.gate.icon} ${ITEMS.gate.name}`);
  girlTarget = 0;
  await wait(700);
  if (g !== gen) return;
  SFX.play('scream'); SFX.play('slam'); shake.add(0.8); fx.flash(0.35);
  DOORS.living.open(); DOORS.altar.open();
  HUD.subNow('<b>CHẠY!</b> Ra cửa chính ở phòng khách!', 4000);
  mode = 'play';
  chaseDelay = 2.5;
  checkpoint();
}
async function win() {
  if (mode === 'end') return;
  const g = ++gen;
  mode = 'end';
  S.flags.won = true;
  take('gate');
  DOORS.front.locked = false; DOORS.front.open();
  SFX.play('unlock'); SFX.play('door');
  hunter.despawn(); Drone.set(0); chaseDelay = -1;
  UI.prompt(null);
  await HUD.fade(1, 2500, '#cfd8e0');
  Music.stop();
  if (g !== gen) return;
  playBox({ vol: 0.4, speed: 0.85 });
  const m = Math.floor(S.time / 60), s = Math.floor(S.time % 60);
  HUD.ending({
    title: 'CĂN NHÀ CUỐI HẺM', text: ENDING,
    stats: `Thời gian: ${m} phút ${s} giây · Bị bắt: ${S.deaths} lần`,
    onRestart: restart,
  });
  save.reset(); S = save.data;
}
// Chơi lại: xóa tiến trình, tải lại trang; nếu khung xem chặn tải lại thì tự đặt lại ngay trong trang
function restart() {
  save.reset(); S = save.data;
  try { location.reload(); } catch (e) { /* bị chặn */ }
  setTimeout(softRestart, 1500);
}
function softRestart() {
  ++gen;
  document.querySelectorAll('.hud-modal, .end').forEach((e) => e.remove());
  HUD.open = 0;
  document.body.classList.remove('cine');
  hunter.despawn(); girl.visible = false; girlTarget = 0;
  chaseDelay = -1; danger = 0; blackout = 0; warnT = 0; acting = false;
  if (hiddenIn) { hiddenIn = null; HUD.slats(false); }
  HUD.red(0); HUD.clearSubs(); UI.prompt(null);
  tweens.length = 0;
  for (const d of L.doors) { d.locked = false; d.close(); d.angle = 0; }
  mirror.ghostFace.visible = false;
  lightOn = true;
  Music.start('horror');
  mode = 'menu';
  begin(true);
}

// ---------- Đồng bộ hình ảnh theo trạng thái (khi tải game) ----------
function syncVisuals() {
  fuseBox.slot.visible = !!S.flags.power;
  fuseBox.led.material.color.setHex(S.flags.power ? 0x22ff44 : 0x661111);
  safe.screen.material.color.setHex(S.flags.power ? 0x0a3a0a : 0x050805);
}
// Sửa save cũ bị kẹt do lưu giữa chừng (bản trước): cờ đã mở mà chưa có đồ, bàn thờ đủ mà chưa có chìa cổng
function repairSave() {
  const f = S.flags, add = (i) => { if (!S.inv.includes(i)) S.inv.push(i); };
  if (f.safeOpen && !f.altar_photo) add('photo');
  if (f.safeOpen && !f.childOpen) add('child');
  if (f.chestOpen && !f.altar_musicbox) add('musicbox');
  if (S.taken.doll && !f.altar_doll) add('doll');
  if (S.taken.jar && !f.studyOpen) add('brass');
  if (S.taken.fuse && !f.power) add('fuse');
  if (['photo', 'doll', 'musicbox'].every((k) => f['altar_' + k]) && !f.won) { f.final = true; add('gate'); }
  for (const k of ['photo', 'doll', 'musicbox']) if (f['altar_' + k]) S.inv = S.inv.filter((x) => x !== k);
}
function applyState() {
  repairSave();
  refreshInv();
  DOORS.study.locked = !S.flags.studyOpen;
  DOORS.child.locked = !S.flags.childOpen;
  DOORS.front.locked = true;
  props.b.forEach((p, i) => (p.battery.visible = !S.taken['bat' + i]));
  doll.visible = !S.taken.doll;
  safe.door.rotation.y = S.flags.safeOpen ? -1.9 : 0;
  chest.lid.rotation.x = S.flags.chestOpen ? -1.3 : 0;
  chest.lock.visible = !S.flags.chestOpen;
  for (const k in altarItems) altarItems[k].visible = !!S.flags['altar_' + k];
  syncVisuals();
  pc.sensitivity = SENS[cfg.data.sens] ?? SENS[1];
  if (S.flags.final) { respawn(); chaseDelay = 4; DOORS.living.open(); DOORS.altar.open(); }
  else if (S.pos) {
    pc.body.position.set(S.pos[0], 0.2, S.pos[1]); pc.position.set(S.pos[0], 0.2, S.pos[1]);
    pc.yaw = S.yaw;
  } else placePlayer(3, 10, Math.PI);
  if (S.flags.power) huntTimer = 40;
  HUD.objective(objective(S));
}

// ---------- Mỗi khung hình ----------
// hộp nhạc: dừng bản đang phát trước khi phát bản mới
let curBox = null;
function playBox(o) { curBox?.stop(); curBox = musicBox(o); }
let curRoom = null, blackout = 0, boltT = 9, boltFlash = 0, creakT = 25, stepT = 0, girlTarget = 0, acting = false;

function updateRoom() {
  const [gx, gz] = toGrid(pc.position);
  const r = roomAt(gx, gz);
  if (!r || r === curRoom) return;
  curRoom = r;
  HUD.room(r);
  Ambience.setRain(r === 'Nhà kho' ? 0.015 : 0.05);
  if (S.visited[r] || mode !== 'play') return;
  S.visited[r] = true;
  const first = {
    'Hành lang': 'Hành lang dài hun hút. Mùi ẩm mốc.',
    'Nhà kho': S.flags.power ? '' : 'Tối om. Hộp điện tổng chắc ở đây.',
    'Phòng làm việc': 'Phòng làm việc của ba. Mọi thứ vẫn y nguyên.',
    'Phòng thờ': 'Phòng thờ... Ai đã thắp nến ở đây?',
    'Phòng ngủ': 'Phòng ba mẹ. Tủ quần áo to — trốn được nếu cần.',
  }[r];
  if (first) HUD.sub(first);
  if (r === 'Phòng bé Hạnh' && !S.flags.chestOpen) { playBox({ vol: 0.18, speed: 0.9 }); HUD.sub('Tiếng hộp nhạc... phát ra từ cái rương?'); }
}

function updateLamps(dt) {
  // đèn đỏ chỉ bật khi đã vào đoạn chạy thoát (không bật giữa cảnh bé Hạnh)
  const final = S.flags.final && mode !== 'cutscene', alarm = warnT > 0 || hunter.state === 'hunt';
  if (warnT > 0) warnT -= dt;
  if (blackout > 0) blackout -= dt;
  const cam = W.camera.position;
  for (const f of lamps) {
    f.t += dt;
    let on;
    if (f.candle) on = !S.flags.won;
    else {
      on = S.flags.power && blackout <= 0 && (Math.sin(f.t * 13) + Math.sin(f.t * 7.3) > -1.6 || Math.random() < 0.3);
      if (on && (alarm || final)) on = Math.random() < (final ? 0.55 : 0.4);
    }
    f.lvl = on ? (f.candle ? 0.7 + Math.random() * 0.3 : 0.92 + Math.random() * 0.08) : 0;
    f.bulb.material.color.setHex(on ? (f.candle ? 0xff8a40 : final ? 0xff3020 : 0xffd9a0) : 0x1a1410);
    f.d = f.pos.distanceToSquared(cam) + (f.room === curRoom ? 0 : 40);
  }
  const act = lamps.filter((f) => (f.candle ? !S.flags.won : S.flags.power)).sort((a, b) => a.d - b.d);
  pool.forEach((l, i) => {
    const f = act[i];
    if (!f) { l.intensity = 0; return; }
    l.position.copy(f.pos); l.position.y -= 0.12;
    l.color.setHex(f.candle ? 0xff7a30 : final ? 0xff2a1a : 0xffb070);
    l.intensity = f.lvl * (f.candle ? 7 : 13);
    l.distance = f.candle ? 6 : 9;
  });
  for (const fl of altar.flames) { fl.scale.set(1, 0.8 + Math.random() * 0.5, 1); fl.visible = !S.flags.won; }
}

function updateLightning(dt) {
  boltT -= dt;
  if (boltT <= 0) {
    boltT = 14 + Math.random() * 26; boltFlash = 0.5;
    setTimeout(() => SFX.play('thunder', { volume: 0.7 }), 500 + Math.random() * 1500);
  }
  let k = 0;
  if (boltFlash > 0) { boltFlash -= dt; k = boltFlash > 0.38 || (boltFlash > 0.12 && boltFlash < 0.22) ? 1 : 0; }
  W.hemi.intensity = BASE_HEMI + k * (curRoom === 'Nhà kho' ? 0.1 : 0.7);
  W.scene.background.setRGB(0.25 * k, 0.28 * k, 0.4 * k);
}

function updateFlashlight(dt) {
  if (input.pressed('light')) {
    if (hiddenIn) { /* trong tủ không bật đèn */ }
    else if (S.battery > 0.01) { lightOn = !lightOn; SFX.play('click'); }
    else { SFX.play('error'); HUD.subNow('Hết pin rồi... Tìm pin 🔋'); }
  }
  if (lightOn) S.battery = Math.max(0, S.battery - dt * 0.0045 * (hunter.lit ? 4 : 1));
  if (S.battery <= 0 && lightOn) { lightOn = false; HUD.subNow('Đèn pin hết pin! Tìm pin 🔋 trên các tủ nhỏ.'); }
  const weak = S.battery < 0.2 ? (Math.random() < 0.06 ? 0.15 : 1) : 1;
  flash.intensity = lightOn ? 75 * weak * (0.6 + 0.4 * S.battery) : 0;
  batteryBar.set(S.battery);
}

function findTarget() {
  const cam = W.camera.position;
  W.camera.getWorldDirection(fwd);
  const cands = [];
  for (const t of things) {
    const lbl = t.label();
    if (!lbl) continue;
    tmpA.copy(t.pos).sub(cam);
    const dist = tmpA.length();
    if (dist > t.range) continue;
    const dot = tmpA.divideScalar(dist).dot(fwd);
    if (dot < (dist < 1.0 ? 0.2 : 0.62)) continue;
    cands.push({ t, lbl, score: dist * (1.7 - dot) });
  }
  cands.sort((a, b) => a.score - b.score);
  for (const c of cands.slice(0, 3)) if (c.t.los === false || losClear(cam, c.t.pos)) return c;
  return null;
}
function updateInteract() {
  const press = input.pressed('action');
  if (hiddenIn) { UI.prompt('✋ Ra khỏi tủ'); HUD.cross(false); if (press) unhide(); return; }
  const best = findTarget();
  UI.prompt(best ? best.lbl : null);
  HUD.cross(!!best);
  if (press && best && !acting) {
    let r;
    try { r = best.t.act(); } catch (e) { console.error(e); }
    // chỉ act mở bảng (thư, két, rương) trả về promise → chặn bấm chồng cho tới khi bảng đóng
    if (r && typeof r.then === 'function') { acting = true; r.catch((e) => console.error(e)).finally(() => (acting = false)); }
  }
}

function updateScares(dt) {
  // bóng đen đứng cuối hành lang (một lần)
  if (!S.flags.scareHall && seen('intro') && curRoom === 'Hành lang' && hunter.state === 'off') {
    const [gx] = toGrid(pc.position);
    W.camera.getWorldDirection(fwd);
    if (gx <= 12 && fwd.x > 0.75) {
      S.flags.scareHall = true;
      hunter.spawn([Math.min(19, gx + 4), 5], 'scare');
      hunter.model.rotation.y = -Math.PI / 2;
      scareT = 1.6;
      SFX.play('whisper'); SFX.play('heartbeat');
    }
  }
  if (hunter.state === 'scare') {
    scareT -= dt;
    if (scareT <= 0 || (ghostLit() && scareT < 1.2)) {
      hunter.despawn();
      SFX.play('glitch', { volume: 0.5 });
      HUD.subNow('Cái... cái gì vừa đứng ở cuối hành lang?');
    }
  }
  // tiếng động ngẫu nhiên
  if ((creakT -= dt) <= 0) { creakT = 18 + Math.random() * 25; if (hunter.state === 'off') randomCreak(); }
}

W.start((dt, t) => {
  if (mode === 'menu') return;
  const busy = HUD.open > 0 || mode !== 'play';
  if (!busy) S.time += dt;
  if (hiddenIn) updateHidden(t);
  else if (!busy) pc.update(dt);
  else { pc.look.take(); pc.updateCamera(dt); }
  if (!busy) world.step(1 / 60, dt, 3);
  L.update(dt);
  updateTweens(dt);
  updateRoom();
  updateLamps(dt);
  updateLightning(dt);
  if (!busy) {
    updateFlashlight(dt);
    updateInteract();
    updateHunt(dt);
    updateScares(dt);
    if (!hiddenIn && pc.speed01 > 0.1 && (stepT -= dt) <= 0) { SFX.playVaried('step'); stepT = pc.speed01 > 0.7 ? 0.32 : 0.5; }
  } else {
    input.pressed('action'); input.pressed('light');
    UI.prompt(null); HUD.cross(false);
  }
  if (hunter.model.visible && hunter.state !== 'hunt') hunter.update(dt, null, 0);
  // hồn bé Hạnh
  if (girl.visible) {
    const u = girl.userData;
    u.k = (u.k ?? 0) + (girlTarget - (u.k ?? 0)) * Math.min(1, dt * 1.5);
    u.mats.forEach((m, i) => (m.opacity = u.base[i] * u.k));
    girl.position.y = 0.05 + Math.sin(t * 1.3) * 0.04;
    if (girlTarget === 0 && u.k < 0.02) girl.visible = false;
  }
  for (const g of glints) {
    g.s.visible = g.on();
    if (g.s.visible) { const k = Math.sin(t * 3 + g.ph); g.s.scale.setScalar(0.16 + 0.06 * k); g.s.material.opacity = 0.55 + 0.45 * k; }
  }
  if (busy || hunter.state !== 'hunt') danger = Math.max(0, danger - dt);
  // hậu kỳ theo mức nguy hiểm
  fx.set({ vignette: 1.3 + danger * 1.4, chroma: 0.4 + danger * 2.2, saturation: 0.5 - danger * 0.3, grain: 0.35 + danger * 0.3 });
  if (mode === 'play') HUD.red(danger > 0.6 ? (danger - 0.6) * 2 : 0);
  dust.update(dt, pc.position);
  shake.update(dt);
  fx.render(dt);
});

// ---------- Menu ----------
function pauseMenu() {
  if (HUD.open || mode !== 'play') return;
  HUD.menu('Tạm dừng', [
    { label: '▶ Tiếp tục', gold: true },
    { label: () => 'Độ nhạy nhìn: ' + SENS_NAME[cfg.data.sens], close: false, action: () => { cfg.data.sens = (cfg.data.sens + 1) % 3; pc.sensitivity = SENS[cfg.data.sens]; cfg.write(); } },
    { label: '📖 Nhật ký', action: () => openJournal() },
    {
      label: '↺ Chơi lại từ đầu',
      action: async () => {
        const yes = await HUD.menu('Xóa tiến trình và chơi lại?', [{ label: 'Không', action: () => false }, { label: 'Có, chơi lại', action: () => true }]);
        if (yes) restart();
      },
    },
  ]);
}
function openJournal() {
  if (HUD.open > 1) return;
  return HUD.journal(S.notes.map((id) => NOTES[id]).filter(Boolean));
}
HUD.init({ onPause: pauseMenu, onJournal: () => { if (mode === 'play' && !HUD.open) openJournal(); } });
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') pauseMenu();
  if (e.code === 'KeyJ' && mode === 'play' && !HUD.open) openJournal();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { save.write(); if (mode === 'play') pauseMenu(); } });

async function begin(fresh) {
  if (mode !== 'menu') return; // chạm đúp nút bắt đầu
  mode = 'starting';
  const g = gen;
  unlockAudio();
  Ambience.start();
  Music.start('horror');
  goFullscreenLandscape();
  document.getElementById('start')?.remove();
  if (fresh) { save.reset(); S = save.data; S.started = true; }
  applyState();
  mode = 'play';
  W.timer.reset?.();
  if (!canSave) HUD.sub('⚠ Trình duyệt đang chặn lưu game — tiến trình sẽ mất nếu thoát giữa chừng.', 5000);
  if (!fresh) { HUD.fade(1, 0); HUD.fade(0, 1200); HUD.sub('Tiếp tục...'); checkpoint(); return; }
  // mở đầu: đứng trước cửa chính đang mở, cửa đóng sập
  pc.enabled = false;
  DOORS.front.locked = false; DOORS.front.open(); DOORS.front.angle = DOORS.front.target;
  HUD.fade(1, 0); HUD.fade(0, 1800);
  HUD.sub(INTRO[0][1], 4200);
  await wait(2600);
  if (g !== gen) return;
  DOORS.front.close(); DOORS.front.locked = true;
  SFX.play('slam'); shake.add(0.7); boltFlash = 0.5;
  setTimeout(() => SFX.play('thunder', { volume: 0.8 }), 400);
  pc.enabled = true;
  HUD.subNow(INTRO_SLAM[0][1], 3800);
  HUD.sub(INTRO[1][1], 4200);
  HUD.sub(W.mobile ? '👆 Vuốt nửa phải màn hình để nhìn · 🕹️ kéo nửa trái để đi · ✋ tương tác' : 'WASD đi · chuột nhìn · E tương tác · F đèn pin', 5000);
  checkpoint();
}
const playBtn = document.getElementById('play');
const cont = document.getElementById('continue');
const hasProgress = S.started && !S.flags.won;
let confirmNew = -Infinity;
playBtn.addEventListener('click', () => {
  // đang có tiến trình: chạm lần 1 chỉ hỏi lại, chạm lần 2 (trong 4 giây) mới xóa và chơi mới
  if (hasProgress && performance.now() - confirmNew > 4000) {
    confirmNew = performance.now();
    playBtn.textContent = 'CHẠM LẦN NỮA ĐỂ CHƠI MỚI (xóa tiến trình)';
    setTimeout(() => { if (performance.now() - confirmNew >= 4000) playBtn.textContent = 'CHƠI MỚI'; }, 4100);
    return;
  }
  begin(true);
});
if (hasProgress) { cont.hidden = false; playBtn.textContent = 'CHƠI MỚI'; cont.addEventListener('click', () => begin(false)); }
if (!canSave) {
  const w = document.createElement('div');
  w.textContent = '⚠ Trình duyệt/khung xem đang chặn lưu game: tiến trình sẽ mất nếu thoát giữa chừng.';
  w.style.cssText = 'color:#ffcf6a;font-size:12px;max-width:520px';
  document.getElementById('start')?.appendChild(w);
}

// cho công cụ kiểm tra / thử nhanh
window.__game = {
  get S() { return S; }, pc, L, things, hunter, props, DOORS, toWorld, toGrid, give, finale, win, startHunt, placePlayer,
  hunt: (cell) => { startHunt(); if (cell) hunter.spawn(cell); }, unhide: () => hiddenIn && unhide(), caught, restart, softRestart, input,
  get mode() { return mode; },
  stats: () => ({
    mode, room: curRoom, battery: +S.battery.toFixed(2), inv: S.inv.join(','), flags: Object.keys(S.flags).join(','),
    hunter: hunter.state, deaths: S.deaths, fxLevel: fx.level, pos: pc.position.toArray().map((v) => +v.toFixed(1)),
    calls: W.renderer.info.render.calls, tris: W.renderer.info.render.triangles,
  }),
};
