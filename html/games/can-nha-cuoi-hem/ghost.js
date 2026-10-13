// ghost.js — "chú cao cao" (bóng đen săn người chơi theo lưới bản đồ) và hồn bé Hạnh.
import * as THREE from 'three';

// ---------- tìm đường trên lưới ô (BFS, bản đồ nhỏ nên rất nhẹ) ----------
export class Nav {
  constructor({ w, h, walkable, toWorld, toGrid }) {
    Object.assign(this, { w, h, walkable, toWorld, toGrid });
  }
  key(x, z) { return z * this.w + x; }
  // trả về mảng ô [[x,z],...] từ ô kế tiếp tới đích (không gồm ô xuất phát)
  path(from, to) {
    const [fx, fz] = from, [tx, tz] = to;
    if (fx === tx && fz === tz) return [];
    const prev = new Int32Array(this.w * this.h).fill(-2);
    const q = [this.key(fx, fz)];
    prev[q[0]] = -1;
    for (let qi = 0; qi < q.length; qi++) {
      const k = q[qi], x = k % this.w, z = (k / this.w) | 0;
      if (x === tx && z === tz) break;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h || !this.walkable(nx, nz)) continue;
        const nk = this.key(nx, nz);
        if (prev[nk] !== -2) continue;
        prev[nk] = k; q.push(nk);
      }
    }
    const end = this.key(tx, tz);
    if (prev[end] === -2) return null;
    const out = [];
    for (let k = end; prev[k] !== -1; k = prev[k]) out.push([k % this.w, (k / this.w) | 0]);
    return out.reverse();
  }
  // khoảng cách (số ô) từ một ô tới mọi ô
  distances(from) {
    const d = new Int32Array(this.w * this.h).fill(-1);
    const q = [this.key(...from)];
    d[q[0]] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const k = q[qi], x = k % this.w, z = (k / this.w) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h || !this.walkable(nx, nz)) continue;
        const nk = this.key(nx, nz);
        if (d[nk] !== -1) continue;
        d[nk] = d[k] + 1; q.push(nk);
      }
    }
    return d;
  }
}

// ---------- model ----------
function jag(geo, amount, bottomOnly = true) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (bottomOnly && y > -0.3) continue;
    p.setXYZ(i, p.getX(i) * (1 + (Math.random() - 0.5) * amount), y - Math.random() * amount * 0.6, p.getZ(i) * (1 + (Math.random() - 0.5) * amount));
  }
  geo.computeVertexNormals();
  return geo;
}

// Bóng đen cao 2.3m, tay dài quá gối, mắt trắng phát sáng trong bóng tối
export function makeStalker() {
  const g = new THREE.Group();
  const black = new THREE.MeshBasicMaterial({ color: 0x030303, transparent: true, opacity: 0.97 });
  const robe = new THREE.Mesh(jag(new THREE.CylinderGeometry(0.17, 0.44, 1.75, 12, 3, true), 0.5), black);
  robe.position.y = 0.95;
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.17, 0.45, 10), black);
  chest.position.y = 1.95;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.18, 6), black);
  neck.position.y = 2.22;
  const head = new THREE.Group();
  head.position.y = 2.36;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), black);
  skull.scale.set(1, 1.35, 1);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xf2f2ff, fog: false });
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), eyeM);
  e1.position.set(-0.05, 0.03, 0.112);
  const e2 = e1.clone(); e2.position.x = 0.05;
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0x3a0505 }));
  mouth.scale.set(0.9, 2.2, 0.4);
  mouth.position.set(0, -0.09, 0.105);
  head.add(skull, e1, e2, mouth);
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.26 * s, 2.1, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.35, 6), black);
    arm.position.y = -0.67;
    shoulder.add(arm);
    for (let f = 0; f < 4; f++) {
      const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.28, 4), black);
      fin.position.set((f - 1.5) * 0.022, -1.45, 0.01 * f);
      fin.rotation.z = (f - 1.5) * 0.08;
      shoulder.add(fin);
    }
    shoulder.rotation.z = 0.12 * s;
    g.add(shoulder);
    arms.push(shoulder);
  }
  g.add(robe, chest, neck, head);
  g.userData = { head, arms, mat: black, eyeM };
  return g;
}

// Hồn bé Hạnh: váy trắng mờ, tóc đen dài
export function makeGirl() {
  const g = new THREE.Group();
  const pale = new THREE.MeshBasicMaterial({ color: 0xe4f0ff, transparent: true, opacity: 0.8, depthWrite: false, fog: false });
  const hair = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const dress = new THREE.Mesh(jag(new THREE.CylinderGeometry(0.1, 0.3, 0.7, 12, 2, true), 0.3), pale);
  dress.position.y = 0.45;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.25, 10), pale);
  torso.position.y = 0.88;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), pale);
  head.position.y = 1.1;
  const hairBack = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.5, 10, 1, true, Math.PI * 0.15, Math.PI * 1.7), hair);
  hairBack.position.set(0, 0.95, -0.01);
  hairBack.rotation.y = Math.PI;
  const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), hair);
  bangs.position.y = 1.11;
  // tóc dài rủ hai bên mặt
  for (const s of [-1, 1]) {
    const strand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), hair);
    strand.position.set(0.095 * s, 0.93, 0.05);
    g.add(strand);
  }
  // mắt đen sâu hoắm
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x0a0a12, transparent: true, opacity: 0.92, depthWrite: false, fog: false });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), eyeM);
    e.scale.set(1, 1.3, 0.5);
    e.position.set(0.04 * s, 1.09, 0.106);
    g.add(e);
  }
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.4, 6), pale);
    arm.position.set(0.14 * s, 0.78, 0.02);
    arm.rotation.z = 0.15 * s;
    g.add(arm);
  }
  g.add(dress, torso, head, hairBack, bangs);
  g.userData = { mats: [pale, hair, eyeM], base: [0.8, 0.92, 0.92] };
  return g;
}

// ---------- AI săn đuổi ----------
export class Hunter {
  constructor(scene, nav) {
    this.nav = nav;
    this.model = makeStalker();
    this.model.visible = false;
    scene.add(this.model);
    this.state = 'off';      // off | hunt | scare | jumpscare
    this.path = [];
    this.repath = 0;
    this.t = 0;
    this.lit = false;
    this.fade = 1;
    this.pos = this.model.position;
    this.baseY = 0;
    this._v = new THREE.Vector3();
  }
  spawn(cell, state = 'hunt') {
    this.pos.copy(this.nav.toWorld(...cell));
    this.model.visible = true;
    this.model.scale.setScalar(1);
    this.state = state;
    this.baseY = 0;
    this.path = [];
    this.repath = 0;
    this.setOpacity(1);
  }
  despawn() { this.state = 'off'; this.model.visible = false; }
  setOpacity(o) { this.fade = o; this.model.userData.mat.opacity = 0.97 * o; this.model.userData.eyeM.opacity = o; this.model.userData.eyeM.transparent = o < 1; }
  get cell() { return this.nav.toGrid(this.pos); }

  // target: Vector3 vị trí người chơi (null = mất dấu → đi lang thang)
  update(dt, target, speed) {
    this.t += dt;
    const u = this.model.userData;
    // dáng đi giật cục, đầu nghiêng
    u.head.rotation.z = Math.sin(this.t * 1.7) * 0.25 + (this.lit ? (Math.random() - 0.5) * 0.6 : 0);
    u.head.rotation.x = 0.2;
    u.arms.forEach((a, i) => { a.rotation.x = Math.sin(this.t * 3 + i * Math.PI) * 0.25 * Math.min(1, speed / 2); });
    this.model.position.y = this.baseY + Math.abs(Math.sin(this.t * 4)) * 0.04;
    if (this.state !== 'hunt') return;

    this.repath -= dt;
    const here = this.cell;
    if (this.repath <= 0 || !this.path.length) {
      this.repath = 0.4;
      let goal = target ? this.nav.toGrid(target) : null;
      if (!goal) {
        if (this.path.length) goal = null;
        else {
          // lang thang tới một ô ngẫu nhiên gần đó
          for (let k = 0; k < 20 && !goal; k++) {
            const c = [here[0] + Math.round((Math.random() - 0.5) * 12), here[1] + Math.round((Math.random() - 0.5) * 8)];
            if (this.nav.walkable(...c)) goal = c;
          }
        }
      }
      if (goal) this.path = this.nav.path(here, goal) || [];
    }
    let dest;
    if (target && this.path.length <= 1) dest = this._v.set(target.x, 0, target.z);
    else if (this.path.length) {
      dest = this.nav.toWorld(...this.path[0]);
      if (Math.hypot(dest.x - this.pos.x, dest.z - this.pos.z) < 0.25) { this.path.shift(); }
    }
    if (!dest) return;
    const dx = dest.x - this.pos.x, dz = dest.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.01) {
      const step = Math.min(d, speed * dt);
      this.pos.x += (dx / d) * step;
      this.pos.z += (dz / d) * step;
      const want = Math.atan2(dx, dz);
      let r = want - this.model.rotation.y;
      r = Math.atan2(Math.sin(r), Math.cos(r));
      this.model.rotation.y += r * Math.min(1, dt * 8);
    }
  }

  // Hù: đặt ngay trước mặt camera
  jumpscare(camera) {
    this.state = 'jumpscare';
    this.model.visible = true;
    this.setOpacity(1);
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    f.y = 0; f.normalize();
    this.baseY = camera.position.y - 2.36;
    this.pos.set(camera.position.x + f.x * 0.55, this.baseY, camera.position.z + f.z * 0.55);
    this.model.rotation.y = Math.atan2(-f.x, -f.z);
  }
}
