// controls.js — điều khiển nhân vật dùng lại được: góc nhìn thứ ba và thứ nhất, có vật lý cannon-es.
//   const pc = new PlayerController({ world, CANNON, input, camera, mode: 'third' | 'first', model, anim });
//   mỗi frame: pc.update(dt)  (gọi TRƯỚC world.step)  → pc.position, pc.grounded, pc.speed01
// Xoay camera: kéo nửa phải màn hình (điện thoại) / chuột (PC, bấm vào màn hình để khóa chuột ở chế độ first).
import * as THREE from 'three';

export function touchLook(target = document.body) {
  const look = { dx: 0, dy: 0 };
  let id = null, lx = 0, ly = 0;
  target.addEventListener('pointerdown', (e) => {
    if (e.clientX < innerWidth / 2 || id !== null) return;
    if (e.target.closest && e.target.closest('button,.tdk-ui')) return;
    id = e.pointerId; lx = e.clientX; ly = e.clientY;
  });
  addEventListener('pointermove', (e) => {
    if (document.pointerLockElement) { look.dx += e.movementX; look.dy += e.movementY; return; }
    if (e.pointerId !== id) return;
    look.dx += e.clientX - lx; look.dy += e.clientY - ly; lx = e.clientX; ly = e.clientY;
  });
  const end = (e) => { if (e.pointerId === id) id = null; };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  look.take = () => { const r = [look.dx, look.dy]; look.dx = look.dy = 0; return r; };
  return look;
}

export class PlayerController {
  constructor({
    world, CANNON, input, camera, mode = 'third', model = null, anim = null,
    start = new THREE.Vector3(0, 2, 0), radius = 0.35, height = 1.7,
    walk = 4.5, run = 7.5, jump = 7, sensitivity = 0.005,
    camDistance = 6, camHeight = 2.2, eyeHeight = 1.6,
    animNames = { idle: 'idle', walk: 'walk', run: 'sprint', jump: 'jump', fall: 'fall' },
  }) {
    Object.assign(this, { world, CANNON, input, camera, mode, model, anim, radius, height, walk, run, jump, sensitivity, camDistance, camHeight, eyeHeight, animNames });
    this.yaw = 0;
    this.pitch = mode === 'first' ? 0 : -0.25;
    this.look = touchLook();
    this.grounded = false;
    this.speed01 = 0;
    this.enabled = true;
    this.body = new CANNON.Body({ mass: 70, fixedRotation: true, linearDamping: 0 });
    // không ma sát để nhân vật không dính vào tường khi nhảy (tốc độ đã do controller tự điều khiển)
    world.defaultContactMaterial.friction = 0;
    // thân hình con nhộng = 2 cầu xếp chồng
    const sph = new CANNON.Sphere(radius);
    this.body.addShape(sph, new CANNON.Vec3(0, radius, 0));
    this.body.addShape(sph, new CANNON.Vec3(0, height - radius, 0));
    this.body.position.set(start.x, start.y, start.z);
    world.addBody(this.body);
    this.position = new THREE.Vector3();
    this._ray = new CANNON.Ray();
    this._ray.mode = CANNON.Ray.CLOSEST;
    this._rr = new CANNON.RaycastResult();
    this._camPos = new THREE.Vector3();
    this.camCollide = [];   // thêm mesh (tường) vào đây để camera không xuyên tường
    this._rc = new THREE.Raycaster();
    if (mode === 'first') {
      camera.rotation.order = 'YXZ';
      document.addEventListener('click', (e) => {
        if (!matchMedia('(pointer: coarse)').matches && !e.target.closest('button,.tdk-ui')) document.body.requestPointerLock?.();
      });
    }
  }

  checkGround() {
    const p = this.body.position;
    const from = new this.CANNON.Vec3(p.x, p.y + 0.3, p.z);
    const to = new this.CANNON.Vec3(p.x, p.y - 0.15, p.z);
    this._rr.reset();
    this._ray.from.copy(from); this._ray.to.copy(to);
    this._ray.intersectWorld(this.world, { skipBackfaces: true, result: this._rr, collisionFilterMask: -1 });
    return this._rr.hasHit && this._rr.body !== this.body;
  }

  update(dt) {
    const [dx, dy] = this.look.take();
    this.yaw -= dx * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * this.sensitivity, -1.3, this.mode === 'first' ? 1.3 : 0.4);
    this.grounded = this.checkGround();

    const mv = this.enabled ? this.input.move : { x: 0, y: 0 };
    const mag = Math.min(1, Math.hypot(mv.x, mv.y));
    const running = this.input.held('run') || mag > 0.92;
    const speed = (running ? this.run : this.walk) * mag;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // tiến = -Z theo hướng yaw
    const vx = (mv.x * cos - mv.y * sin), vz = (-mv.x * sin - mv.y * cos);
    const l = Math.hypot(vx, vz) || 1;
    const v = this.body.velocity;
    const k = this.grounded ? 1 : 0.35; // trên không vẫn lái được một chút
    v.x += ((vx / l) * speed - v.x) * Math.min(1, dt * 12 * k);
    v.z += ((vz / l) * speed - v.z) * Math.min(1, dt * 12 * k);
    if (this.enabled && this.grounded && this.input.pressed('jump')) { v.y = this.jump; this.grounded = false; this.onJump?.(); }
    if (this.body.position.y < -30) { this.body.position.set(0, 5, 0); v.set(0, 0, 0); }

    this.speed01 = Math.min(1, Math.hypot(v.x, v.z) / this.run);
    const p = this.body.position;
    this.position.set(p.x, p.y, p.z);

    if (this.model) {
      this.model.position.copy(this.position);
      if (mag > 0.1) {
        const target = Math.atan2(vx, vz);
        let d = target - this.model.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.model.rotation.y += d * Math.min(1, dt * 12);
      }
      this.model.visible = this.mode !== 'first';
    }
    if (this.anim) {
      const n = this.animNames;
      if (!this.grounded) this.anim.play(v.y > 0 ? n.jump : (n.fall || n.jump), { fade: 0.15 });
      else if (this.speed01 > 0.6 && n.run) this.anim.play(n.run);
      else if (this.speed01 > 0.08) this.anim.play(n.walk);
      else this.anim.play(n.idle);
      this.anim.update(dt);
    }
    this.updateCamera(dt);
  }

  updateCamera(dt) {
    const c = this.camera;
    if (this.mode === 'first') {
      // nhún nhẹ khi đi cho cảm giác thật
      this._bob = (this._bob || 0) + dt * 9 * this.speed01;
      const bob = this.grounded ? Math.sin(this._bob) * 0.05 * this.speed01 : 0;
      c.position.set(this.position.x, this.position.y + this.eyeHeight + bob, this.position.z);
      c.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      return;
    }
    const head = this.position.clone(); head.y += this.camHeight * 0.6;
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    let dist = this.camDistance;
    if (this.camCollide.length) {
      this._rc.set(head, dir); this._rc.far = dist;
      const hit = this._rc.intersectObjects(this.camCollide, true)[0];
      if (hit) dist = Math.max(0.8, hit.distance - 0.3);
    }
    this._camPos.copy(head).addScaledVector(dir, dist);
    c.position.lerp(this._camPos, Math.min(1, dt * 10));
    c.lookAt(head);
  }
}
