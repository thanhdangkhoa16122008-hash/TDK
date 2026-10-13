// fx.js — hạt hiệu ứng (bụi, lấp lánh, khói, mưa, đom đóm) dùng chung bộ đệm, và rung camera.
//   const P = new Particles(scene);  P.burst(pos, { color: 0xffd54f, count: 20 });  mỗi frame P.update(dt)
//   const rain = weather(scene, 'rain' | 'snow' | 'fireflies' | 'dust');  mỗi frame rain.update(dt, camera.position)
//   const shake = new Shake(camera); shake.add(0.4);  mỗi frame shake.update(dt) SAU khi đặt camera
import * as THREE from 'three';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, '#ffffffaa'); gr.addColorStop(1, '#fff0');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let DOT;

export class Particles {
  constructor(scene, max = 600) {
    DOT ||= dotTexture();
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.25, map: DOT, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pos.fill(-9999);
  }
  burst(p, { count = 16, color = 0xffffff, speed = 3, up = 2, life = 0.8, gravity = 6, spread = 1 } = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.next = (this.next + 1) % this.max;
      this.pos.set([p.x, p.y, p.z], i * 3);
      const a = Math.random() * Math.PI * 2, r = Math.random() * speed * spread;
      this.vel.set([Math.cos(a) * r, up + Math.random() * speed, Math.sin(a) * r], i * 3);
      this.col.set([c.r, c.g, c.b], i * 3);
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.8);
      this.grav[i] = gravity;
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= this.grav[i] * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.life[i] <= 0) this.pos[j + 1] = -9999;
      else { const f = this.life[i] / this.maxLife[i]; this.col[j] *= 0.98 + 0.02 * f; this.col[j + 1] *= 0.98 + 0.02 * f; this.col[j + 2] *= 0.98 + 0.02 * f; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// Thời tiết/không khí bao quanh người chơi
export function weather(scene, kind = 'rain', { count = 1500, area = 30 } = {}) {
  DOT ||= dotTexture();
  const cfg = {
    rain:      { color: 0xaaccff, size: 0.12, fall: 18, drift: 0.5, opacity: 0.6, add: false },
    snow:      { color: 0xffffff, size: 0.18, fall: 1.5, drift: 1, opacity: 0.9, add: false },
    fireflies: { color: 0xd4ff6a, size: 0.25, fall: 0, drift: 0.6, opacity: 1, add: true },
    dust:      { color: 0xd8c8a8, size: 0.06, fall: 0.05, drift: 0.2, opacity: 0.5, add: false },
  }[kind];
  if (kind === 'fireflies') count = Math.min(count, 120);
  if (kind === 'dust') count = Math.min(count, 400);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { pos.set([(Math.random() - .5) * area, Math.random() * 12, (Math.random() - .5) * area], i * 3); seed[i] = Math.random() * 100; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: cfg.color, size: cfg.size, map: DOT, transparent: true, opacity: cfg.opacity, depthWrite: false,
    blending: cfg.add ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  pts.frustumCulled = false;
  scene.add(pts);
  let t = 0;
  return {
    points: pts,
    update(dt, center) {
      t += dt;
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        pos[j + 1] -= cfg.fall * dt;
        pos[j] += Math.sin(t + seed[i]) * cfg.drift * dt;
        pos[j + 2] += Math.cos(t * 0.7 + seed[i]) * cfg.drift * dt;
        if (pos[j + 1] < 0) pos[j + 1] += 12;
      }
      if (kind === 'fireflies') pts.material.opacity = 0.6 + Math.sin(t * 3) * 0.4;
      if (center) pts.position.set(center.x, 0, center.z);
      geo.attributes.position.needsUpdate = true;
    },
    dispose() { scene.remove(pts); geo.dispose(); },
  };
}

export class Shake {
  constructor(camera) { this.camera = camera; this.trauma = 0; this.t = 0; }
  add(v) { this.trauma = Math.min(1, this.trauma + v); }
  update(dt) {
    if (this.trauma <= 0) return;
    this.t += dt * 40;
    const s = this.trauma * this.trauma * 0.3;
    this.camera.position.x += Math.sin(this.t * 1.1) * s;
    this.camera.position.y += Math.sin(this.t * 1.7 + 1) * s;
    this.camera.rotation.z += Math.sin(this.t * 0.9 + 2) * s * 0.1;
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
  }
}
