// level.js — dựng màn chơi trong nhà (biệt thự, hành lang, phòng) từ bản đồ chữ.
//   const L = buildGridLevel(scene, world, CANNON, MAP, { cell: 3, wallHeight: 3.2, materials });
//   Ký hiệu: '#' tường  '.' sàn  ' ' trống (ngoài nhà)  'D' cửa (ngang theo hướng hành lang)  'W' cửa sổ
//   Chữ khác (P, K, E, G, a-z…) = sàn + điểm đánh dấu → L.markers.P = [Vector3, ...]
//   L.doors: mỗi cửa có .open() .close() .toggle() .locked ; L.walls: mesh để camera không xuyên
//   L.update(dt) mỗi frame (chạy animation cửa)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildGridLevel(scene, world, CANNON, map, {
  cell = 3, wallHeight = 3.2, ceiling = true,
  materials = {},
  doorColor = 0x4a3020,
} = {}) {
  const rows = map.trim().split('\n').map((r) => r.replace(/\r/g, ''));
  const H = rows.length, Wd = Math.max(...rows.map((r) => r.length));
  const at = (x, z) => (rows[z] && rows[z][x]) || ' ';
  const isWall = (c) => c === '#' || c === 'W';
  const isFloor = (c) => c !== '#' && c !== ' ' && c !== 'W';
  const ox = -(Wd * cell) / 2, oz = -(H * cell) / 2;
  const center = (x, z) => new THREE.Vector3(ox + x * cell + cell / 2, 0, oz + z * cell + cell / 2);

  const M = {
    wall: materials.wall || new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.95 }),
    floor: materials.floor || new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 }),
    ceiling: materials.ceiling || new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 1 }),
  };
  // UV theo mét để texture lặp đều
  const uvBox = (w, h, d) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      const sx = ax > 0.5 ? d : w, sy = ay > 0.5 ? d : h;
      uv.setXY(i, uv.getX(i) * sx / 2, uv.getY(i) * sy / 2);
    }
    return g;
  };

  const wallGeos = [], floorGeos = [], ceilGeos = [];
  const markers = {}, doors = [];
  const staticBody = new CANNON.Body({ mass: 0 });

  for (let z = 0; z < H; z++) for (let x = 0; x < Wd; x++) {
    const c = at(x, z), p = center(x, z);
    if (c === ' ') continue;
    if (isWall(c)) {
      if (c === 'W') {
        // cửa sổ: tường thấp + mép trên, khoảng giữa để trống (dùng cho tia sét/bóng ma ngoài cửa)
        for (const [y0, y1] of [[0, 1], [2.2, wallHeight]]) {
          const g = uvBox(cell, y1 - y0, cell); g.translate(p.x, (y0 + y1) / 2, p.z); wallGeos.push(g);
        }
      } else {
        const g = uvBox(cell, wallHeight, cell); g.translate(p.x, wallHeight / 2, p.z); wallGeos.push(g);
      }
      staticBody.addShape(new CANNON.Box(new CANNON.Vec3(cell / 2, wallHeight / 2, cell / 2)), new CANNON.Vec3(p.x, wallHeight / 2, p.z));
      continue;
    }
    const f = uvBox(cell, 0.2, cell); f.translate(p.x, -0.1, p.z); floorGeos.push(f);
    if (ceiling) { const cg = uvBox(cell, 0.2, cell); cg.translate(p.x, wallHeight + 0.1, p.z); ceilGeos.push(cg); }
    if (c === 'D') {
      // hướng cửa: nếu tường ở trái/phải → cửa chắn hướng Z
      const alongX = isWall(at(x - 1, z)) && isWall(at(x + 1, z));
      doors.push(makeDoor(p, alongX));
    } else if (c !== '.') {
      (markers[c] ||= []).push(p.clone());
    }
  }
  const addMerged = (geos, mat, cast) => {
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = cast; m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const wallMesh = addMerged(wallGeos, M.wall, true);
  const floorMesh = addMerged(floorGeos, M.floor, false);
  const ceilMesh = addMerged(ceilGeos, M.ceiling, false);
  staticBody.addShape(new CANNON.Box(new CANNON.Vec3(Wd * cell / 2, 0.1, H * cell / 2)), new CANNON.Vec3(0, -0.1, 0));
  world.addBody(staticBody);

  function makeDoor(p, alongX) {
    const w = cell * 0.9, h = Math.min(2.3, wallHeight - 0.2);
    // khung cửa: phần tường phía trên
    const top = uvBox(alongX ? cell : 0.3, wallHeight - h, alongX ? 0.3 : cell);
    top.translate(p.x, h + (wallHeight - h) / 2, p.z); wallGeos.push(top);
    const hinge = new THREE.Group();
    hinge.position.set(p.x - (alongX ? w / 2 : 0), 0, p.z - (alongX ? 0 : w / 2));
    if (!alongX) hinge.rotation.y = -Math.PI / 2;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), new THREE.MeshStandardMaterial({ color: doorColor, roughness: 0.7 }));
    panel.position.set(w / 2, h / 2, 0);
    panel.castShadow = true;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.8, roughness: 0.3 }));
    knob.position.set(w - 0.15, h * 0.45, 0.07);
    panel.add(knob, knob.clone().translateZ(-0.14));
    hinge.add(panel);
    scene.add(hinge);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(alongX ? w / 2 : 0.05, h / 2, alongX ? 0.05 : w / 2)) });
    body.position.set(p.x, h / 2, p.z);
    world.addBody(body);
    const door = {
      position: p.clone(), hinge, panel, body, locked: false, isOpen: false, angle: 0, target: 0,
      open() { if (this.locked) return false; this.isOpen = true; this.target = -Math.PI / 2 * 0.9; body.collisionResponse = false; return true; },
      close() { this.isOpen = false; this.target = 0; body.collisionResponse = true; },
      toggle() { return this.isOpen ? (this.close(), true) : this.open(); },
    };
    return door;
  }

  return {
    markers, doors, walls: [wallMesh, ceilMesh].filter(Boolean), floor: floorMesh, body: staticBody,
    center, cell, size: { w: Wd * cell, h: H * cell },
    nearestDoor(pos, maxDist = 2.2) {
      let best = null, bd = maxDist;
      for (const d of doors) { const dd = d.position.distanceTo(new THREE.Vector3(pos.x, 0, pos.z)); if (dd < bd) { bd = dd; best = d; } }
      return best;
    },
    update(dt) {
      for (const d of doors) {
        d.angle += (d.target - d.angle) * Math.min(1, dt * 6);
        d.hinge.children[0].rotation.y = d.angle;
        d.hinge.children[0].position.set((Math.cos(-d.angle) * cell * 0.9) / 2, d.hinge.children[0].position.y, (Math.sin(-d.angle) * cell * 0.9) / 2);
      }
    },
  };
}
