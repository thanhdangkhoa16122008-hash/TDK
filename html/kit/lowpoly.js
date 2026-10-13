// lowpoly.js — bộ model 3D low-poly dựng bằng code (không cần file model).
// Dùng: import * as LP from '../../kit/lowpoly.js'; scene.add(LP.tree());
// Mọi hàm trả về THREE.Group, gốc tọa độ ở chân vật thể (y = 0).
import * as THREE from 'three';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...opts }));
  }
  return matCache.get(key);
}

function mesh(geo, color, opts) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Làm méo nhẹ đỉnh để trông tự nhiên hơn
function jitter(geo, amount = 0.08, seed = 1) {
  const p = geo.attributes.position;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + rnd() * amount, p.getY(i) + rnd() * amount, p.getZ(i) + rnd() * amount);
  }
  geo.computeVertexNormals();
  return geo;
}

export function tree({ height = 2.2, leaf = 0x4caf50, trunk = 0x7a4a2a, seed = 1 } = {}) {
  const g = new THREE.Group();
  const t = mesh(new THREE.CylinderGeometry(0.12, 0.18, height * 0.45, 6), trunk);
  t.position.y = height * 0.225;
  g.add(t);
  for (let i = 0; i < 3; i++) {
    const r = 0.8 - i * 0.2;
    const c = mesh(jitter(new THREE.ConeGeometry(r, height * 0.4, 7), 0.05, seed + i), leaf);
    c.position.y = height * (0.5 + i * 0.18);
    g.add(c);
  }
  return g;
}

export function roundTree({ size = 1, leaf = 0x66bb6a, trunk = 0x7a4a2a, seed = 2 } = {}) {
  const g = new THREE.Group();
  const t = mesh(new THREE.CylinderGeometry(0.1 * size, 0.15 * size, 1 * size, 6), trunk);
  t.position.y = 0.5 * size;
  const c = mesh(jitter(new THREE.IcosahedronGeometry(0.75 * size, 0), 0.12 * size, seed), leaf);
  c.position.y = 1.35 * size;
  g.add(t, c);
  return g;
}

export function rock({ size = 0.6, color = 0x8d8d8d, seed = 3 } = {}) {
  const g = new THREE.Group();
  const r = mesh(jitter(new THREE.DodecahedronGeometry(size, 0), size * 0.25, seed), color);
  r.scale.y = 0.6;
  r.position.y = size * 0.4;
  g.add(r);
  return g;
}

export function bush({ size = 0.5, color = 0x388e3c, seed = 4 } = {}) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = mesh(jitter(new THREE.IcosahedronGeometry(size * (0.7 + i * 0.15), 0), size * 0.15, seed + i), color);
    b.position.set((i - 1) * size * 0.6, size * 0.5, (i % 2) * size * 0.3);
    g.add(b);
  }
  return g;
}

export function house({ w = 3, d = 3, h = 2, wall = 0xf2e3c6, roof = 0xb5482e, door = 0x5d3a1a } = {}) {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(w, h, d), wall);
  body.position.y = h / 2;
  const r = mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 0.2, h * 0.8, 4), roof);
  r.position.y = h + h * 0.4;
  r.rotation.y = Math.PI / 4;
  const dr = mesh(new THREE.BoxGeometry(w * 0.25, h * 0.55, 0.05), door);
  dr.position.set(0, h * 0.275, d / 2 + 0.02);
  g.add(body, r, dr);
  return g;
}

export function fence({ length = 4, color = 0xa47148 } = {}) {
  const g = new THREE.Group();
  const posts = Math.max(2, Math.round(length / 1) + 1);
  for (let i = 0; i < posts; i++) {
    const p = mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), color);
    p.position.set(-length / 2 + (i * length) / (posts - 1), 0.4, 0);
    g.add(p);
  }
  for (const y of [0.3, 0.6]) {
    const rail = mesh(new THREE.BoxGeometry(length, 0.08, 0.06), color);
    rail.position.y = y;
    g.add(rail);
  }
  return g;
}

// Cây trồng theo giai đoạn 0..3 (hạt → mầm → lớn → chín)
export function crop({ stage = 3, fruit = 0xff7043 } = {}) {
  if (!Number.isInteger(stage) || stage < 0 || stage > 3) {
    throw new RangeError('crop: stage phải là số nguyên từ 0 đến 3');
  }
  const g = new THREE.Group();
  const soil = mesh(new THREE.BoxGeometry(0.9, 0.1, 0.9), 0x6d4c41);
  soil.position.y = 0.05;
  g.add(soil);
  if (stage >= 1) {
    const h = [0, 0.2, 0.45, 0.6][stage];
    const stem = mesh(new THREE.CylinderGeometry(0.03, 0.04, h, 5), 0x43a047);
    stem.position.y = 0.1 + h / 2;
    g.add(stem);
    for (let i = 0; i < stage + 1; i++) {
      const leafM = mesh(new THREE.ConeGeometry(0.08, 0.25, 4), 0x66bb6a);
      leafM.position.set(Math.cos(i * 2.1) * 0.1, 0.1 + h * (0.4 + i * 0.15), Math.sin(i * 2.1) * 0.1);
      leafM.rotation.z = Math.cos(i * 2.1) * 0.9;
      leafM.rotation.x = Math.sin(i * 2.1) * 0.9;
      g.add(leafM);
    }
    if (stage === 3) {
      const f = mesh(new THREE.IcosahedronGeometry(0.12, 0), fruit);
      f.position.y = 0.1 + h + 0.05;
      g.add(f);
    }
  }
  return g;
}

export function coin({ color = 0xffc107 } = {}) {
  const g = new THREE.Group();
  const c = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), color, { roughness: 0.4, emissive: 0x7a5200, emissiveIntensity: 0.6 });
  c.rotation.x = Math.PI / 2;
  c.position.y = 0.5;
  g.add(c);
  return g;
}

// Nhân vật đơn giản có sẵn chuyển động đi bộ: gọi character.userData.animate(dt, speed01)
export function character({ skin = 0xffcc99, shirt = 0x1e88e5, pants = 0x37474f, hair = 0x3e2723 } = {}) {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), shirt);
  body.position.y = 1.0;
  const head = mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), skin);
  head.position.y = 1.5;
  const hr = mesh(new THREE.BoxGeometry(0.4, 0.12, 0.4), hair);
  hr.position.y = 1.72;
  const limb = (w, h, color) => {
    const pivot = new THREE.Group();
    const m = mesh(new THREE.BoxGeometry(w, h, w), color);
    m.position.y = -h / 2;
    pivot.add(m);
    return pivot;
  };
  const armL = limb(0.15, 0.55, shirt), armR = limb(0.15, 0.55, shirt);
  armL.position.set(-0.33, 1.28, 0);
  armR.position.set(0.33, 1.28, 0);
  const legL = limb(0.18, 0.7, pants), legR = limb(0.18, 0.7, pants);
  legL.position.set(-0.13, 0.7, 0);
  legR.position.set(0.13, 0.7, 0);
  // mắt để biết hướng mặt (trục +Z)
  const eyeL = mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), 0x212121);
  eyeL.position.set(-0.08, 1.53, 0.2);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.08;
  g.add(body, head, hr, armL, armR, legL, legR, eyeL, eyeR);
  let t = 0;
  g.userData.animate = (dt, speed01) => {
    t += dt * (4 + 6 * speed01);
    const a = Math.sin(t) * 0.8 * speed01;
    legL.rotation.x = a;
    legR.rotation.x = -a;
    armL.rotation.x = -a;
    armR.rotation.x = a;
    body.position.y = 1.0 + Math.abs(Math.sin(t)) * 0.04 * speed01;
  };
  return g;
}

// Rải ngẫu nhiên vật thể trên vùng vuông, tránh bán kính trung tâm
export function scatter(scene, factory, { count = 20, area = 40, avoid = 4, seed = 7 } = {}) {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(area) || area <= 0 ||
      !Number.isFinite(avoid) || avoid < 0 || !Number.isSafeInteger(seed)) {
    throw new RangeError('scatter: count phải là số nguyên ≥ 0; area > 0; avoid ≥ 0; seed là số nguyên hữu hạn');
  }
  if (count > 0 && avoid >= (area / 2) * Math.SQRT2) {
    throw new RangeError('scatter: avoid phủ hết vùng rải; hãy tăng area hoặc giảm avoid');
  }
  let s = ((seed % 2147483647) + 2147483647) % 2147483647 || 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out = [];
  for (let i = 0; i < count; i++) {
    let x, z;
    let attempts = 0;
    do {
      if (++attempts > 10000) {
        throw new RangeError('scatter: không tìm được vị trí sau 10000 lần thử; hãy tăng area hoặc giảm avoid');
      }
      x = (rnd() - 0.5) * area;
      z = (rnd() - 0.5) * area;
    } while (Math.hypot(x, z) < avoid);
    const o = factory(i, rnd);
    o.position.set(x, 0, z);
    o.rotation.y = rnd() * Math.PI * 2;
    scene.add(o);
    out.push(o);
  }
  return out;
}
