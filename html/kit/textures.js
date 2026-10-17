// textures.js — texture tự vẽ bằng canvas (không cần file ảnh), lặp được, nhẹ.
//   const mat = new THREE.MeshStandardMaterial({ map: Tex.wood({ repeat: [2, 2] }) });
//   Có: grass, dirt, wood, brick, tiles, wallpaper (kinh dị), concrete, noise, stains (vết bẩn/máu)
import * as THREE from 'three';

function make(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  draw(g, size, rnd);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const speckle = (g, n, rnd, colors, size, min = 1, max = 3) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const r = min + rnd() * (max - min);
    g.fillRect(rnd() * size, rnd() * size, r, r);
  }
};

export const Tex = {
  noise: (o = {}) => make(128, (g, S, rnd) => {
    const img = g.createImageData(S, S);
    for (let i = 0; i < img.data.length; i += 4) { const v = 100 + rnd() * 155; img.data.set([v, v, v, 255], i); }
    g.putImageData(img, 0, 0);
  }, { srgb: false, ...o }),

  grass: (o = {}) => make(256, (g, S, rnd) => {
    g.fillStyle = o.base || '#6aa84f'; g.fillRect(0, 0, S, S);
    speckle(g, 1800, rnd, ['#5b9a43', '#7cbc5c', '#4e8a38', '#89c76a'], S, 1, 4);
  }, o),

  dirt: (o = {}) => make(256, (g, S, rnd) => {
    g.fillStyle = o.base || '#7a5534'; g.fillRect(0, 0, S, S);
    speckle(g, 1500, rnd, ['#6b4a2d', '#8a6440', '#5c3f26', '#9a7350'], S, 1, 5);
  }, o),

  wood: (o = {}) => make(256, (g, S, rnd) => {
    const planks = o.planks || 4, h = S / planks;
    for (let p = 0; p < planks; p++) {
      const l = 30 + rnd() * 10;
      g.fillStyle = `hsl(28,${45 + rnd() * 10}%,${l}%)`; g.fillRect(0, p * h, S, h);
      for (let k = 0; k < 14; k++) {
        g.strokeStyle = `hsla(25,40%,${l - 8}%,.5)`; g.lineWidth = 1 + rnd();
        const y = p * h + rnd() * h;
        g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S / 3, y + (rnd() - .5) * 8, S * 2 / 3, y + (rnd() - .5) * 8, S, y); g.stroke();
      }
      g.fillStyle = '#00000055'; g.fillRect(0, p * h, S, 2);
    }
  }, o),

  brick: (o = {}) => make(256, (g, S, rnd) => {
    g.fillStyle = o.mortar || '#bdb5a6'; g.fillRect(0, 0, S, S);
    const rows = 8, bh = S / rows, bw = S / 4;
    for (let r = 0; r < rows; r++) for (let c = -1; c < 5; c++) {
      const x = c * bw + (r % 2 ? bw / 2 : 0);
      g.fillStyle = `hsl(${8 + rnd() * 8},${45 + rnd() * 15}%,${32 + rnd() * 10}%)`;
      g.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
    }
    speckle(g, 600, rnd, ['#00000022', '#ffffff15'], S);
  }, o),

  tiles: (o = {}) => make(256, (g, S, rnd) => {
    const n = o.count || 4, w = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? (o.a || '#e8e4dc') : (o.b || '#cfc9bd'); g.fillRect(i * w, j * w, w, w);
      g.strokeStyle = '#00000030'; g.strokeRect(i * w + .5, j * w + .5, w - 1, w - 1);
    }
    speckle(g, 400, rnd, ['#00000018'], S);
  }, o),

  // Giấy dán tường cũ, ố vàng — hợp game kinh dị
  wallpaper: (o = {}) => make(256, (g, S, rnd) => {
    g.fillStyle = o.base || '#7d6b52'; g.fillRect(0, 0, S, S);
    g.strokeStyle = o.line || '#5e503d'; g.lineWidth = 6;
    for (let x = 0; x < S; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
    g.fillStyle = '#5e503d';
    for (let y = 16; y < S; y += 32) for (let x = 16; x < S; x += 32) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
    // vết ố tròn mềm, vẽ lặp ở 4 phía để texture liền mạch khi lặp
    for (let i = 0; i < 25; i++) {
      const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 60;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, '#3a2f2066'); gr.addColorStop(1, '#3a2f2000');
        g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
      }
    }
  }, o),

  concrete: (o = {}) => make(256, (g, S, rnd) => {
    g.fillStyle = o.base || '#8f8f8a'; g.fillRect(0, 0, S, S);
    speckle(g, 3000, rnd, ['#7f7f7a', '#a0a09b', '#868681', '#999994'], S, 1, 3);
    g.strokeStyle = '#00000040';
    for (let i = 0; i < 4; i++) { g.beginPath(); let x = rnd() * S, y = rnd() * S; g.moveTo(x, y); for (let k = 0; k < 6; k++) g.lineTo(x += (rnd() - .5) * 40, y += (rnd() - .5) * 40); g.stroke(); }
  }, o),

  // Vết bẩn/máu trong suốt — dùng làm decal (đặt plane mỏng sát tường/sàn, transparent: true)
  stains: (o = {}) => make(256, (g, S, rnd) => {
    g.clearRect(0, 0, S, S);
    const col = o.color || '110,0,0';
    for (let i = 0; i < (o.count || 6); i++) {
      const x = S / 2 + (rnd() - .5) * S * .5, y = S / 2 + (rnd() - .5) * S * .5, r = 10 + rnd() * 50;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${col},.9)`); gr.addColorStop(.7, `rgba(${col},.6)`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  }, o),
};
