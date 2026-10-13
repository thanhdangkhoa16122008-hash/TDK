// props.js — đồ đạc trong nhà dựng bằng khối hình (không cần file model) + texture vẽ bằng canvas.
// Mỗi builder trả về { g, stat, depth, collide, ... } — g là Group, mặt trước hướng +Z, gốc ở sàn.
// Phần tĩnh nằm trong `stat` để bakeStatic() gộp lại (ít draw call); phần động (cửa két, nắp rương…) để riêng.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Tex } from '../../kit/textures.js';

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let M = null;
export function materials() {
  if (M) return M;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  M = {
    wood: std({ map: Tex.wood({ planks: 3 }), color: 0xa08060, roughness: 0.75 }),
    dark: std({ map: Tex.wood({ planks: 5 }), color: 0x5a4030, roughness: 0.7 }),
    metal: std({ color: 0x5d6266, metalness: 0.7, roughness: 0.45 }),
    rust: std({ color: 0x6a5545, metalness: 0.4, roughness: 0.8 }),
    white: std({ color: 0xb8b0a0, roughness: 0.55 }),
    top: std({ color: 0x3a3a3a, roughness: 0.4 }),
    fabric: std({ color: 0x5c2b2b, roughness: 1 }),
    sheet: std({ color: 0x9a948a, roughness: 1 }),
    pink: std({ color: 0xb07a8a, roughness: 1 }),
    black: std({ color: 0x111111, roughness: 0.5 }),
    red: std({ color: 0x7a1414, roughness: 0.9 }),
    cardboard: std({ color: 0x8a6a42, roughness: 1 }),
    gold: std({ color: 0xc9a54a, metalness: 0.85, roughness: 0.3, emissive: 0x221100 }),
    glass: std({ color: 0x223040, metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.6 }),
    water: std({ color: 0x0a0d08, roughness: 0.05, metalness: 0.6 }),
    paper: std({ map: paperTex(), roughness: 1 }),
    books: [0x5a1f1f, 0x1f3a5a, 0x2f4a26, 0x6a5a2a, 0x3a2a4a].map((c) => std({ color: c, roughness: 0.9 })),
    toys: [0xd84343, 0x3f7fd8, 0xe0c040, 0x48a858].map((c) => std({ color: c, roughness: 0.6 })),
  };
  return M;
}

function paperTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#d9cfb4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a3a5a'; g.lineWidth = 2;
    for (let y = 18; y < h - 10; y += 11) { g.beginPath(); g.moveTo(12, y); for (let x = 12; x < w - 14 - (y % 3) * 12; x += 6) g.lineTo(x, y + Math.sin(x * 0.7 + y) * 1.5); g.stroke(); }
    g.fillStyle = '#6b4a2a33'; g.beginPath(); g.arc(90, 95, 22, 0, 7); g.fill();
  });
}

// ---------- hình khối ----------
const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
function B(w, h, d, mat, x, y, z, parent) { const m = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); parent?.add(m); return m; }
function C(rt, rb, h, seg, mat, x, y, z, parent) { const m = sh(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)); m.position.set(x, y, z); parent?.add(m); return m; }
function Sp(r, mat, x, y, z, parent, seg = 10) { const m = sh(new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)), mat)); m.position.set(x, y, z); parent?.add(m); return m; }
function wallPlane(w, h, map, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, roughness: 0.9 }));
  m.position.set(x, y, z); m.receiveShadow = true; parent?.add(m); return m;
}
function base(depth, collide = true) {
  const g = new THREE.Group(), stat = new THREE.Group();
  g.add(stat);
  return { g, stat, depth, collide };
}

// ---------- hình vẽ cho câu đố ổ khóa hình ----------
export const SHAPES = ['star', 'fish', 'moon', 'heart', 'sun'];
export const SHAPE_COLOR = { star: '#ffd54f', fish: '#4fc3f7', moon: '#b39ddb', heart: '#ef5350', sun: '#ff9800' };
export const SHAPE_NAME = { star: 'Ngôi sao', fish: 'Con cá', moon: 'Mặt trăng', heart: 'Trái tim', sun: 'Mặt trời' };
export function drawShape(g, kind, cx, cy, r, color = SHAPE_COLOR[kind]) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = color; g.strokeStyle = '#222'; g.lineWidth = Math.max(2, r * 0.08); g.lineJoin = 'round';
  g.beginPath();
  if (kind === 'star') {
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath();
  } else if (kind === 'moon') {
    const a = Math.atan2(0.792, 0.61), b = Math.atan2(0.792, 0.11);
    g.arc(0, 0, r, a, Math.PI * 2 - a, false);
    g.arc(r * 0.5, 0, r * 0.8, Math.PI * 2 - b, b, true);
    g.closePath();
  } else if (kind === 'heart') {
    g.moveTo(0, r * 0.85);
    g.bezierCurveTo(-r * 1.35, -r * 0.1, -r * 0.6, -r * 1.15, 0, -r * 0.45);
    g.bezierCurveTo(r * 0.6, -r * 1.15, r * 1.35, -r * 0.1, 0, r * 0.85);
  } else if (kind === 'sun') {
    g.save(); g.strokeStyle = color; g.lineWidth = r * 0.14; g.lineCap = 'round';
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.moveTo(Math.cos(a) * r * 0.68, Math.sin(a) * r * 0.68); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.stroke(); g.restore(); g.beginPath();
    g.arc(0, 0, r * 0.52, 0, Math.PI * 2);
  } else if (kind === 'fish') {
    g.ellipse(-r * 0.15, 0, r * 0.68, r * 0.45, 0, 0, Math.PI * 2);
    g.moveTo(r * 0.4, 0); g.lineTo(r, -r * 0.45); g.lineTo(r, r * 0.45); g.closePath();
  }
  g.fill(); g.stroke();
  if (kind === 'fish') { g.fillStyle = '#111'; g.beginPath(); g.arc(-r * 0.5, -r * 0.08, r * 0.09, 0, 7); g.fill(); }
  g.restore();
}

// ---------- texture vẽ tay ----------
const childFont = (px) => `bold ${px}px "Comic Sans MS", "Chalkboard SE", "Marker Felt", sans-serif`;

// Đồng hồ dừng lúc 11:45
export function clockFaceTex() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#d8ccb0'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 6; g.stroke();
    g.fillStyle = '#2a1a10'; g.font = 'bold 30px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const roman = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    roman.forEach((t, i) => { const a = i * Math.PI / 6 - Math.PI / 2; g.font = `bold ${t.length > 2 ? 20 : 26}px Georgia, serif`; g.fillText(t, 128 + Math.cos(a) * 95, 128 + Math.sin(a) * 95); });
    for (let i = 0; i < 60; i++) { const a = i * Math.PI / 30; g.lineWidth = i % 5 ? 1 : 3; g.beginPath(); g.moveTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); g.lineTo(128 + Math.cos(a) * 120, 128 + Math.sin(a) * 120); g.stroke(); }
    const hand = (frac, len, w) => { const a = frac * Math.PI * 2 - Math.PI / 2; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * len, 128 + Math.sin(a) * len); g.stroke(); };
    g.strokeStyle = '#111';
    hand(11.75 / 12, 58, 9);   // kim giờ
    hand(45 / 60, 88, 5);      // kim phút
    g.fillStyle = '#111'; g.beginPath(); g.arc(128, 128, 8, 0, 7); g.fill();
    // vết nứt mặt kính
    g.strokeStyle = '#ffffff55'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(40, 60); g.lineTo(90, 110); g.lineTo(84, 160); g.moveTo(90, 110); g.lineTo(140, 96); g.stroke();
  });
}

// Tranh vẽ của Hạnh: 3 "bạn" có đánh số — đáp án ổ khóa: sao(1) → cá(2) → trăng(3)
export const CHEST_ANSWER = ['star', 'fish', 'moon'];
export function drawingCanvas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e1cc'; g.fillRect(0, 0, 512, 384);
  g.fillStyle = '#00000010'; for (let i = 0; i < 300; i++) g.fillRect(Math.random() * 512, Math.random() * 384, 2, 2);
  g.fillStyle = '#c0392b'; g.font = childFont(34); g.textAlign = 'center';
  g.fillText('BẠN CỦA HẠNH', 256, 46);
  // ba người bạn, thứ tự trái → phải KHÔNG phải thứ tự đúng; số ghi bên dưới mới là thứ tự
  const friends = [['moon', 3], ['star', 1], ['fish', 2]];
  friends.forEach(([k, n], i) => {
    const x = 92 + i * 150;
    drawShape(g, k, x, 140, 46);
    g.fillStyle = '#1a1a6a'; g.font = childFont(46); g.fillText(String(n), x, 238);
  });
  // bé Hạnh (người que) + bóng đen cao ở góc
  g.strokeStyle = '#d81b60'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.arc(150, 300, 16, 0, 7); g.moveTo(150, 316); g.lineTo(150, 356); g.moveTo(130, 332); g.lineTo(170, 332); g.moveTo(150, 356); g.lineTo(136, 380); g.moveTo(150, 356); g.lineTo(164, 380); g.stroke();
  g.fillStyle = '#d81b60'; g.font = childFont(20); g.fillText('Hạnh', 210, 312);
  g.fillStyle = '#111';
  g.beginPath(); g.ellipse(462, 220, 22, 30, 0, 0, 7); g.fill();
  g.fillRect(446, 240, 32, 140);
  g.fillRect(432, 250, 8, 110); g.fillRect(484, 250, 8, 110);
  g.fillStyle = '#fff'; g.fillRect(452, 214, 7, 5); g.fillRect(466, 214, 7, 5);
  g.fillStyle = '#111'; g.font = childFont(16); g.fillText('chú cao cao', 400, 370);
  g.strokeStyle = '#11111166'; g.lineWidth = 3;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(420 + Math.random() * 80, 190 + Math.random() * 30); g.lineTo(420 + Math.random() * 80, 300 + Math.random() * 80); g.stroke(); }
  return c;
}

function portraitTex() {
  return canvasTex(200, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a1d14'); gr.addColorStop(1, '#120c08');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const fig = (x, y, s, face) => {
      g.fillStyle = '#0b0705'; g.beginPath(); g.ellipse(x, y + 70 * s, 34 * s, 60 * s, 0, Math.PI, 0); g.fill(); g.fillRect(x - 34 * s, y + 70 * s, 68 * s, 120);
      g.fillStyle = face; g.beginPath(); g.ellipse(x, y, 17 * s, 21 * s, 0, 0, 7); g.fill();
      g.fillStyle = '#00000088'; g.fillRect(x - 9 * s, y - 4 * s, 5 * s, 3 * s); g.fillRect(x + 4 * s, y - 4 * s, 5 * s, 3 * s);
    };
    fig(60, 80, 1.1, '#b8a48a'); fig(140, 84, 1.05, '#b8a48a'); fig(52, 160, 0.75, '#b0a088');
    fig(138, 168, 0.62, '#b0a088');
    g.strokeStyle = '#8a0f0f'; g.lineWidth = 3;
    for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(124 + Math.random() * 10, 150 + Math.random() * 6); g.lineTo(146 + Math.random() * 10, 180 + Math.random() * 8); g.stroke(); }
  });
}

export function photoCanvas() {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 240;
  const g = c.getContext('2d');
  g.fillStyle = '#f2ead8'; g.fillRect(0, 0, 320, 240);
  const gr = g.createLinearGradient(0, 0, 0, 200); gr.addColorStop(0, '#c9a77a'); gr.addColorStop(1, '#7a5a3a');
  g.fillStyle = gr; g.fillRect(14, 14, 292, 180);
  const fig = (x, y, s, shirt) => {
    g.fillStyle = shirt; g.beginPath(); g.ellipse(x, y + 55 * s, 26 * s, 40 * s, 0, Math.PI, 0); g.fill(); g.fillRect(x - 26 * s, y + 55 * s, 52 * s, 90);
    g.fillStyle = '#e0c39a'; g.beginPath(); g.arc(x, y, 15 * s, 0, 7); g.fill();
    g.fillStyle = '#2a1a10'; g.beginPath(); g.arc(x, y - 5 * s, 15 * s, Math.PI, 0); g.fill();
    g.strokeStyle = '#5a2a1a'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y + 3 * s, 6 * s, 0.2, Math.PI - 0.2); g.stroke();
  };
  g.save(); g.beginPath(); g.rect(14, 14, 292, 180); g.clip();
  fig(80, 70, 1.2, '#4a5a7a'); fig(240, 74, 1.1, '#8a3a4a'); fig(135, 110, 0.85, '#3a6a3a'); fig(190, 122, 0.7, '#d07a9a');
  g.restore();
  g.fillStyle = '#3a2a1a'; g.font = 'italic 20px Georgia, serif'; g.textAlign = 'center';
  g.fillText('Hè 1997 — cả nhà mình', 160, 222);
  return c;
}

function ghostFaceTex() {
  return canvasTex(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#050505'; g.beginPath(); g.ellipse(128, 120, 92, 120, 0, 0, 7); g.fill();
    g.fillStyle = '#c8cfd0'; g.beginPath(); g.ellipse(128, 140, 52, 70, 0, 0, 7); g.fill();
    g.fillStyle = '#050505';
    for (let i = 0; i < 14; i++) g.fillRect(78 + i * 7, 60, 6, 40 + Math.random() * 70);
    g.beginPath(); g.ellipse(108, 140, 11, 15, 0, 0, 7); g.ellipse(148, 140, 11, 15, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(128, 185, 12, 20, 0, 0, 7); g.fill();
  });
}

// ---------- đồ đạc ----------
export const BUILDERS = {
  // đồng hồ quả lắc (manh mối giờ)
  c() {
    const M = materials(), p = base(0.42), s = p.stat;
    B(0.62, 0.12, 0.42, M.dark, 0, 0.06, 0, s);
    B(0.5, 1.3, 0.36, M.dark, 0, 0.77, 0, s);
    B(0.62, 0.55, 0.42, M.dark, 0, 1.69, 0, s);
    B(0.68, 0.08, 0.46, M.dark, 0, 2.0, 0, s);
    B(0.3, 0.8, 0.02, M.glass, 0, 0.86, 0.185, s);
    B(0.02, 0.55, 0.01, M.gold, 0, 0.95, 0.17, s);
    C(0.07, 0.07, 0.02, 12, M.gold, 0, 0.68, 0.17, s).rotation.x = Math.PI / 2;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.22, 28), new THREE.MeshStandardMaterial({ map: clockFaceTex(), roughness: 0.6 }));
    face.position.set(0, 1.69, 0.215); s.add(face);
    p.focus = new THREE.Vector3(0, 1.6, 0.3);
    p.faceTex = face.material.map;
    return p;
  },
  // ghế sofa
  f() {
    const M = materials(), p = base(0.9), s = p.stat;
    B(2.0, 0.42, 0.9, M.fabric, 0, 0.25, 0, s);
    B(2.0, 0.55, 0.22, M.fabric, 0, 0.72, -0.34, s);
    B(0.2, 0.3, 0.9, M.fabric, -0.9, 0.6, 0, s); B(0.2, 0.3, 0.9, M.fabric, 0.9, 0.6, 0, s);
    for (const x of [-0.9, 0.9]) for (const z of [-0.38, 0.38]) B(0.08, 0.06, 0.08, M.dark, x, 0.03, z, s);
    B(0.5, 0.15, 0.45, M.sheet, 0.4, 0.5, 0.05, s).rotation.set(0.2, 0.4, 0.1);
    return p;
  },
  // bàn giữa phòng khách có mảnh giấy
  n() {
    const M = materials(), p = base(0.9), s = p.stat;
    B(1.4, 0.06, 0.9, M.dark, 0, 0.72, 0, s);
    for (const x of [-0.62, 0.62]) for (const z of [-0.38, 0.38]) B(0.07, 0.69, 0.07, M.dark, x, 0.345, z, s);
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.36), M.paper);
    note.rotation.set(-Math.PI / 2, 0, 0.3); note.position.set(-0.15, 0.755, 0.05); s.add(note);
    C(0.03, 0.03, 0.12, 8, M.white, 0.4, 0.81, -0.2, s);
    C(0.05, 0.04, 0.09, 10, M.white, 0.25, 0.77, 0.2, s).rotation.z = Math.PI / 2;
    p.focus = new THREE.Vector3(-0.15, 0.8, 0.05);
    return p;
  },
  // bàn bếp
  T() {
    const M = materials(), p = base(1.0), s = p.stat;
    B(1.2, 0.05, 0.8, M.wood, 0, 0.74, 0, s);
    for (const x of [-0.52, 0.52]) for (const z of [-0.32, 0.32]) B(0.06, 0.72, 0.06, M.wood, x, 0.36, z, s);
    for (const [x, z, r] of [[-0.3, 0.6, 0.3], [0.35, -0.62, 3.0]]) {
      const ch = new THREE.Group(); ch.position.set(x, 0, z); ch.rotation.y = r; s.add(ch);
      B(0.42, 0.04, 0.42, M.wood, 0, 0.45, 0, ch); B(0.42, 0.45, 0.04, M.wood, 0, 0.7, -0.2, ch);
      for (const a of [-0.18, 0.18]) for (const b of [-0.18, 0.18]) B(0.04, 0.45, 0.04, M.wood, a, 0.225, b, ch);
    }
    B(0.3, 0.03, 0.3, M.white, 0.1, 0.78, 0, s);
    return p;
  },
  // quầy bếp có hũ bánh
  j() { return counter('jar'); },
  // quầy bếp có bồn rửa
  k() { return counter('sink'); },
  // tủ nhỏ có pin bên trên
  b() {
    const M = materials(), p = base(0.45), s = p.stat;
    B(0.7, 0.75, 0.45, M.dark, 0, 0.375, 0, s);
    B(0.6, 0.02, 0.01, M.black, 0, 0.5, 0.226, s);
    B(0.12, 0.03, 0.03, M.gold, 0, 0.6, 0.235, s);
    p.itemPos = new THREE.Vector3(0.05, 0.8, 0.05);
    return p;
  },
  // tủ quần áo / tủ đứng — trốn được
  h() {
    const M = materials(), p = base(0.65), s = p.stat;
    B(1.3, 2.2, 0.65, M.dark, 0, 1.1, 0, s);
    B(1.36, 0.08, 0.7, M.dark, 0, 2.24, 0, s);
    for (const x of [-0.32, 0.32]) {
      B(0.62, 2.0, 0.03, M.wood, x, 1.1, 0.33, s);
      for (let i = 0; i < 6; i++) B(0.5, 0.03, 0.02, M.black, x, 1.45 + i * 0.1, 0.35, s);
      B(0.03, 0.14, 0.04, M.gold, x > 0 ? x - 0.25 : x + 0.25, 1.1, 0.36, s);
    }
    p.focus = new THREE.Vector3(0, 1.2, 0.4);
    p.camLocal = new THREE.Vector3(0, 1.55, 0.4); // ngay trước cánh tủ, nhìn qua khe
    p.exitLocal = new THREE.Vector3(0, 0, 0.95);
    p.hide = true;
    return p;
  },
  // tủ lạnh cũ
  r() {
    const M = materials(), p = base(0.7), s = p.stat;
    B(0.8, 1.8, 0.7, M.white, 0, 0.9, 0, s);
    B(0.78, 0.02, 0.01, M.black, 0, 1.25, 0.351, s);
    B(0.04, 0.35, 0.05, M.metal, 0.32, 1.5, 0.37, s);
    B(0.04, 0.3, 0.05, M.metal, 0.32, 0.9, 0.37, s);
    const st = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.6), new THREE.MeshBasicMaterial({ map: Tex.stains({ color: '60,10,5' }), transparent: true, depthWrite: false }));
    st.position.set(0.05, 0.3, 0.352); s.add(st);
    p.focus = new THREE.Vector3(0, 1.2, 0.4);
    return p;
  },
  // hộp điện tổng (treo tường)
  x() {
    const M = materials(), p = base(0.16, false), s = p.stat;
    B(0.55, 0.75, 0.16, M.metal, 0, 1.55, 0, s);
    C(0.025, 0.025, 1.1, 6, M.black, -0.15, 2.45, -0.03, s);
    C(0.025, 0.025, 1.1, 6, M.black, 0.15, 2.45, -0.03, s);
    const door = new THREE.Group(); door.position.set(-0.275, 1.55, 0.09); door.rotation.y = -1.9; p.g.add(door);
    B(0.55, 0.75, 0.02, M.metal, 0.275, 0, 0, door);
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.26), M.paper); note.position.set(0.28, 0.05, 0.012); door.add(note);
    for (let i = 0; i < 4; i++) B(0.08, 0.14, 0.04, i === 2 ? M.black : M.white, -0.18 + i * 0.12, 1.62, 0.09, s);
    p.slot = B(0.08, 0.14, 0.04, M.white, 0.06, 1.62, 0.09, p.g); p.slot.visible = false;
    p.led = Sp(0.025, new THREE.MeshBasicMaterial({ color: 0x661111 }), 0.18, 1.38, 0.09, p.g, 6);
    p.focus = new THREE.Vector3(0, 1.55, 0.2);
    return p;
  },
  // kệ sắt đầy thùng
  l() {
    const M = materials(), p = base(0.5), s = p.stat;
    for (const x of [-0.88, 0.88]) for (const z of [-0.22, 0.22]) B(0.04, 2.0, 0.04, M.rust, x, 1.0, z, s);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 4; i++) {
      const y = 0.1 + i * 0.6;
      B(1.8, 0.03, 0.48, M.rust, 0, y, 0, s);
      for (let k = 0; k < 3; k++) if (rnd() < 0.8) { const bw = 0.3 + rnd() * 0.25, bh = 0.2 + rnd() * 0.25; B(bw, bh, 0.38, M.cardboard, -0.6 + k * 0.6 + (rnd() - 0.5) * 0.1, y + bh / 2 + 0.015, 0, s).rotation.y = (rnd() - 0.5) * 0.3; }
    }
    return p;
  },
  // bồn rửa + gương + tủ dưới gương (có cầu chì)
  m() {
    const M = materials(), p = base(0.5), s = p.stat;
    B(0.62, 0.62, 0.42, M.white, 0, 0.31, 0, s);
    B(0.56, 0.5, 0.01, M.black, 0, 0.32, 0.215, s);
    B(0.66, 0.14, 0.48, M.white, 0, 0.7, 0.02, s);
    C(0.015, 0.015, 0.18, 6, M.metal, 0, 0.84, -0.15, s);
    B(0.72, 0.92, 0.06, M.white, 0, 1.68, -0.2, s);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.82), new THREE.MeshStandardMaterial({ color: 0x8090a0, metalness: 1, roughness: 0.15 }));
    mirror.position.set(0, 1.68, -0.165); s.add(mirror);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: ghostFaceTex(), transparent: true, depthWrite: false, fog: false }));
    face.position.set(0.08, 1.75, -0.16); face.visible = false; p.g.add(face);
    p.ghostFace = face;
    p.focus = new THREE.Vector3(0, 0.6, 0.3);
    return p;
  },
  // bồn tắm nước đen
  U() {
    const M = materials(), p = base(0.8), s = p.stat;
    B(1.7, 0.6, 0.8, M.white, 0, 0.3, 0, s);
    B(1.5, 0.04, 0.6, M.water, 0, 0.5, 0, s);
    C(0.02, 0.02, 0.25, 6, M.metal, -0.75, 0.75, -0.3, s);
    p.focus = new THREE.Vector3(0, 0.6, 0);
    return p;
  },
  // bàn làm việc + nhật ký
  d() {
    const M = materials(), p = base(0.7), s = p.stat;
    B(1.5, 0.05, 0.7, M.dark, 0, 0.76, 0, s);
    B(0.05, 0.74, 0.68, M.dark, -0.72, 0.37, 0, s);
    B(0.45, 0.74, 0.66, M.dark, 0.5, 0.37, 0, s);
    for (let i = 0; i < 3; i++) B(0.4, 0.015, 0.01, M.black, 0.5, 0.25 + i * 0.22, 0.335, s);
    C(0.08, 0.1, 0.03, 10, M.metal, -0.5, 0.8, -0.15, s);
    C(0.012, 0.012, 0.35, 6, M.metal, -0.5, 0.97, -0.15, s);
    const shade = C(0.06, 0.14, 0.12, 10, M.gold, -0.5, 1.15, -0.15, s); shade.rotation.x = 0.3;
    B(0.24, 0.04, 0.32, M.red, 0.05, 0.8, 0.05, s).rotation.y = 0.2;
    B(0.3, 0.01, 0.4, M.paper, -0.25, 0.79, 0.12, s).rotation.y = -0.4;
    const ch = new THREE.Group(); ch.position.set(0, 0, 0.62); ch.rotation.y = 2.7; s.add(ch);
    B(0.45, 0.05, 0.45, M.dark, 0, 0.46, 0, ch); B(0.45, 0.5, 0.05, M.dark, 0, 0.73, -0.2, ch);
    for (const a of [-0.19, 0.19]) for (const b of [-0.19, 0.19]) B(0.04, 0.46, 0.04, M.dark, a, 0.23, b, ch);
    p.focus = new THREE.Vector3(0.05, 0.85, 0.05);
    return p;
  },
  // két sắt điện tử
  s() {
    const M = materials(), p = base(0.65), s = p.stat;
    B(0.7, 0.8, 0.6, M.metal, 0, 0.4, -0.02, s);
    B(0.6, 0.7, 0.02, M.black, 0, 0.4, 0.27, s);
    const door = new THREE.Group(); door.position.set(-0.32, 0.4, 0.3); p.g.add(door);
    B(0.64, 0.74, 0.06, M.metal, 0.32, 0, 0, door);
    B(0.04, 0.2, 0.06, M.gold, 0.56, 0, 0.05, door);
    p.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.07), new THREE.MeshBasicMaterial({ color: 0x050805 }));
    p.screen.position.set(0.3, 0.2, 0.031); door.add(p.screen);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) B(0.045, 0.045, 0.01, M.black, 0.24 + c * 0.06, 0.08 - r * 0.06, 0.035, door);
    p.door = door;
    p.focus = new THREE.Vector3(0, 0.55, 0.4);
    return p;
  },
  // kệ sách
  K() {
    const M = materials(), p = base(0.4), s = p.stat;
    B(1.8, 2.2, 0.04, M.dark, 0, 1.1, -0.18, s);
    for (const x of [-0.88, 0.88]) B(0.04, 2.2, 0.4, M.dark, x, 1.1, 0, s);
    let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 5; i++) {
      const y = 0.05 + i * 0.52;
      B(1.76, 0.03, 0.38, M.dark, 0, y, 0, s);
      let x = -0.82;
      while (x < 0.78) {
        const bw = 0.04 + rnd() * 0.05, bh = 0.25 + rnd() * 0.15;
        if (rnd() < 0.85) B(bw, bh, 0.26, M.books[Math.floor(rnd() * 5)], x + bw / 2, y + bh / 2 + 0.015, 0.02, s);
        x += bw + 0.005 + (rnd() < 0.08 ? 0.2 : 0);
      }
    }
    p.focus = new THREE.Vector3(0, 1.2, 0.3);
    return p;
  },
  // tủ đầu giường + thư của mẹ
  q() {
    const M = materials(), p = base(0.45), s = p.stat;
    B(0.5, 0.6, 0.45, M.dark, 0, 0.3, 0, s);
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.28), M.paper); note.rotation.set(-Math.PI / 2, 0, -0.2); note.position.set(0, 0.605, 0.05); s.add(note);
    C(0.025, 0.025, 0.1, 8, M.white, 0.15, 0.65, -0.12, s);
    p.focus = new THREE.Vector3(0, 0.65, 0.05);
    return p;
  },
  // giường ngủ + búp bê
  o() {
    const M = materials(), p = base(1.4), s = p.stat;
    B(2.0, 0.35, 1.4, M.dark, 0, 0.175, 0, s);
    B(1.92, 0.2, 1.32, M.sheet, 0, 0.45, 0, s);
    B(0.08, 1.0, 1.4, M.dark, -0.98, 0.5, 0, s);
    B(0.35, 0.12, 0.9, M.white, -0.7, 0.61, 0, s);
    B(1.2, 0.06, 1.36, M.fabric, 0.3, 0.58, 0, s);
    p.itemPos = new THREE.Vector3(-0.45, 0.62, 0.15);
    return p;
  },
  // tranh vẽ của Hạnh trên tường
  v() {
    const p = base(0.02, false);
    p.canvas = drawingCanvas();
    const t = new THREE.CanvasTexture(p.canvas); t.colorSpace = THREE.SRGBColorSpace;
    wallPlane(1.1, 0.82, t, 0, 1.45, 0.01, p.stat);
    p.focus = new THREE.Vector3(0, 1.45, 0.1);
    return p;
  },
  // giường nhỏ của bé + đồ chơi
  y() {
    const M = materials(), p = base(0.9), s = p.stat;
    B(1.6, 0.3, 0.9, M.wood, 0, 0.15, 0, s);
    B(1.52, 0.16, 0.82, M.white, 0, 0.38, 0, s);
    B(1.0, 0.05, 0.86, M.pink, 0.25, 0.48, 0, s);
    B(0.06, 0.7, 0.9, M.wood, -0.78, 0.35, 0, s);
    B(0.3, 0.1, 0.5, M.white, -0.55, 0.5, 0, s);
    for (let i = 0; i < 5; i++) B(0.12, 0.12, 0.12, M.toys[i % 4], -0.4 + i * 0.22, 0.06, 0.75 + (i % 2) * 0.12, s).rotation.y = i * 0.7;
    return p;
  },
  // rương bí mật (ổ khóa 3 hình)
  t() {
    const M = materials(), p = base(0.55), s = p.stat;
    B(0.9, 0.45, 0.55, M.wood, 0, 0.225, 0, s);
    for (const x of [-0.3, 0.3]) B(0.05, 0.46, 0.56, M.rust, x, 0.225, 0, s);
    const lid = new THREE.Group(); lid.position.set(0, 0.45, -0.275); p.g.add(lid);
    B(0.92, 0.1, 0.57, M.wood, 0, 0.05, 0.285, lid);
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.16), M.paper); note.position.set(0.2, 0.05, 0.572); lid.add(note);
    p.lock = new THREE.Group(); p.g.add(p.lock);
    B(0.26, 0.12, 0.04, M.metal, -0.15, 0.36, 0.29, p.lock);
    for (let i = 0; i < 3; i++) C(0.03, 0.03, 0.03, 8, M.toys[i], -0.23 + i * 0.08, 0.36, 0.315, p.lock).rotation.x = Math.PI / 2;
    p.lid = lid;
    p.focus = new THREE.Vector3(0, 0.5, 0.3);
    return p;
  },
  // bàn thờ có 3 chỗ trống
  a() {
    const M = materials(), p = base(0.6), s = p.stat;
    B(1.6, 0.85, 0.6, M.dark, 0, 0.425, 0, s);
    B(1.62, 0.55, 0.02, M.red, 0, 0.55, 0.31, s);
    B(1.2, 0.35, 0.3, M.dark, 0, 1.025, -0.13, s);
    C(0.1, 0.08, 0.1, 12, M.gold, 0, 0.9, 0.12, s);
    const ember = new THREE.MeshBasicMaterial({ color: 0xff3010, fog: false });
    for (let i = -1; i <= 1; i++) { C(0.004, 0.004, 0.28, 4, M.cardboard, i * 0.03, 1.05, 0.12, s); Sp(0.008, ember, i * 0.03, 1.19, 0.12, s, 4); }
    p.flames = [];
    p.candles = [];
    for (const x of [-0.65, 0.65]) {
      C(0.035, 0.035, 0.2, 8, M.white, x, 0.95, 0.15, s);
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 6), new THREE.MeshBasicMaterial({ color: 0xffa040, fog: false }));
      fl.position.set(x, 1.08, 0.15); p.g.add(fl); p.flames.push(fl);
      p.candles.push(new THREE.Vector3(x, 1.12, 0.15));
    }
    // vết bụi chỗ trống
    const dust = new THREE.MeshBasicMaterial({ color: 0x0a0806, transparent: true, opacity: 0.6 });
    for (const [x, y, z, w, d] of [[0, 1.202, -0.13, 0.3, 0.12], [-0.38, 0.852, 0.1, 0.22, 0.16], [0.38, 0.852, 0.1, 0.24, 0.2]]) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(w, d), dust); q.rotation.x = -Math.PI / 2; q.position.set(x, y, z); s.add(q);
    }
    p.slots = {
      photo: { pos: new THREE.Vector3(0, 1.2, -0.13), rot: 0 },
      doll: { pos: new THREE.Vector3(-0.38, 0.85, 0.1), rot: 0 },
      musicbox: { pos: new THREE.Vector3(0.38, 0.85, 0.1), rot: 0 },
    };
    p.focus = new THREE.Vector3(0, 1.0, 0.35);
    return p;
  },
  // chân dung gia đình bị cào mặt
  i() {
    const M = materials(), p = base(0.06, false), s = p.stat;
    B(0.8, 1.0, 0.05, M.gold, 0, 1.6, 0, s);
    wallPlane(0.66, 0.86, portraitTex(), 0, 1.6, 0.027, s);
    p.focus = new THREE.Vector3(0, 1.6, 0.1);
    return p;
  },
};

function counter(kind) {
  const M = materials(), p = base(0.65), s = p.stat;
  B(2.3, 0.86, 0.6, M.white, 0, 0.43, 0, s);
  B(2.36, 0.05, 0.66, M.top, 0, 0.885, 0.01, s);
  for (const x of [-0.58, 0.58]) B(0.01, 0.7, 0.01, M.black, x, 0.45, 0.301, s);
  B(2.3, 0.7, 0.35, M.white, 0, 2.15, -0.12, s);
  if (kind === 'jar') {
    C(0.13, 0.12, 0.26, 12, new THREE.MeshStandardMaterial({ color: 0x8aa0a8, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.75 }), 0.3, 1.04, 0.05, s);
    C(0.14, 0.14, 0.04, 12, M.red, 0.3, 1.19, 0.05, s);
    B(0.3, 0.02, 0.3, M.white, -0.5, 0.92, 0, s);
    p.focus = new THREE.Vector3(0.3, 1.05, 0.1);
  } else {
    B(0.62, 0.05, 0.42, M.water, -0.2, 0.89, 0.02, s);
    C(0.02, 0.02, 0.3, 6, M.metal, -0.2, 1.05, -0.2, s);
    B(0.02, 0.02, 0.18, M.metal, -0.2, 1.2, -0.12, s);
    p.focus = new THREE.Vector3(-0.2, 0.95, 0.1);
  }
  return p;
}

// ---------- vật phẩm hiển thị (pin, búp bê, hộp nhạc, ảnh) ----------
export function itemMesh(kind) {
  const M = materials(), g = new THREE.Group();
  if (kind === 'battery') {
    C(0.035, 0.035, 0.14, 10, new THREE.MeshStandardMaterial({ color: 0x1565c0, metalness: 0.4, roughness: 0.4, emissive: 0x08204a }), 0, 0.07, 0, g).rotation.z = Math.PI / 2;
    C(0.036, 0.036, 0.04, 10, M.gold, 0.06, 0.07, 0, g).rotation.z = Math.PI / 2;
  } else if (kind === 'doll') {
    const dress = new THREE.MeshStandardMaterial({ color: 0x9a5a7a, roughness: 1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8c8b8, roughness: 0.6 });
    C(0.05, 0.1, 0.16, 8, dress, 0, 0.08, 0, g);
    Sp(0.065, skin, 0, 0.22, 0, g);
    Sp(0.07, new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 1 }), 0, 0.24, -0.015, g);
    Sp(0.012, M.black, -0.025, 0.225, 0.058, g, 6);
    for (const x of [-0.07, 0.07]) C(0.015, 0.015, 0.1, 6, skin, x, 0.1, 0, g).rotation.z = x > 0 ? -0.5 : 0.5;
  } else if (kind === 'musicbox') {
    B(0.2, 0.1, 0.14, M.wood, 0, 0.05, 0, g);
    B(0.21, 0.025, 0.15, M.dark, 0, 0.11, 0, g);
    C(0.01, 0.01, 0.06, 6, M.gold, 0.12, 0.06, 0, g).rotation.z = Math.PI / 2;
    B(0.012, 0.04, 0.012, M.gold, 0.15, 0.08, 0, g);
  } else if (kind === 'photo') {
    const t = new THREE.CanvasTexture(photoCanvas()); t.colorSpace = THREE.SRGBColorSpace;
    B(0.3, 0.24, 0.02, M.gold, 0, 0.12, 0, g).rotation.x = -0.15;
    const ph = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
    ph.position.set(0, 0.12, 0.012); ph.rotation.x = -0.15; g.add(ph);
  }
  return g;
}

// Đốm sáng lấp lánh đánh dấu vật nhặt được
let glintTex;
export function glint() {
  glintTex ||= canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, '#ffffffff'); gr.addColorStop(0.25, '#fff2c0aa'); gr.addColorStop(1, '#fff2c000');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffffffcc'; g.fillRect(31, 4, 2, 56); g.fillRect(4, 31, 56, 2);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.scale.setScalar(0.25);
  return s;
}

// Gộp mọi phần tĩnh của đồ đạc thành vài mesh theo vật liệu (giảm draw call cho điện thoại)
export function bakeStatic(scene, statGroups) {
  const byMat = new Map();
  for (const sg of statGroups) {
    sg.updateMatrixWorld(true);
    const list = [];
    sg.traverse((o) => { if (o.isMesh) list.push(o); });
    for (const o of list) {
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(geo);
      o.parent.remove(o);
    }
  }
  const meshes = [];
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos);
    if (!merged) { console.warn('[bake] không gộp được', mat); continue; }
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    meshes.push(m);
  }
  return meshes;
}
