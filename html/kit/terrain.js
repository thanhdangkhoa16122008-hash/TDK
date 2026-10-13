// terrain.js — địa hình đồi núi tự sinh bằng noise, tô màu theo độ cao, có collider vật lý.
//   const T = createTerrain({ size: 120, height: 6, flat: 15 });
//   scene.add(T.mesh);  T.heightAt(x, z) → độ cao tại điểm;  T.addPhysics(world, CANNON)
import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

export function createTerrain({
  size = 120, segments = 96, height = 6, scale = 0.025, seed = 1,
  flat = 12,               // bán kính vùng bằng phẳng ở giữa (xây nhà, trồng cây)
  water = -0.6,            // dưới mức này là nước (null = không có nước)
  colors = { sand: 0xd9c38a, grass: 0x7cb342, grass2: 0x5d9634, rock: 0x8a8378, snow: 0xf2f2f2 },
} = {}) {
  // noise có seed → địa hình luôn giống nhau với cùng seed
  let s = seed * 9301 + 49297;
  const noise = new SimplexNoise({ random: () => ((s = (s * 9301 + 49297) % 233280) / 233280) });

  const raw = (x, z) => {
    let h = 0, amp = 1, f = scale;
    for (let o = 0; o < 4; o++) { h += noise.noise(x * f, z * f) * amp; amp *= 0.5; f *= 2; }
    return h;
  };
  const heightAt = (x, z) => {
    const d = Math.hypot(x, z);
    const k = THREE.MathUtils.smoothstep(d, flat, flat * 2);
    return raw(x, z) * height * k;
  };

  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), cs = new THREE.Color(colors.sand), cg = new THREE.Color(colors.grass),
    cg2 = new THREE.Color(colors.grass2), cr = new THREE.Color(colors.rock), cw = new THREE.Color(colors.snow);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const t = h / height;
    if (water !== null && h < water + 0.4) c.copy(cs);
    else if (t > 0.75) c.copy(cw);
    else if (t > 0.45) c.copy(cr);
    else c.copy(cg).lerp(cg2, (noise.noise(x * 0.15, z * 0.15) + 1) / 2);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  mesh.receiveShadow = true;

  let waterMesh = null;
  if (water !== null) {
    waterMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: 0x3a8fd6, transparent: true, opacity: 0.75, roughness: 0.15, metalness: 0.1 }),
    );
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.y = water;
    mesh.add(waterMesh);
  }

  // Collider: Heightfield của cannon-es (lưới đều, trục khác với three nên cần xoay)
  const addPhysics = (world, CANNON, res = 64) => {
    const data = [];
    const step = size / res;
    for (let i = 0; i <= res; i++) {
      data.push([]);
      for (let j = 0; j <= res; j++) data[i].push(heightAt(-size / 2 + i * step, size / 2 - j * step));
    }
    const shape = new CANNON.Heightfield(data, { elementSize: step });
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(shape);
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    body.position.set(-size / 2, 0, size / 2);
    world.addBody(body);
    return body;
  };

  // Rải vật thể theo địa hình (bỏ qua chỗ nước / dốc đá)
  const scatter = (scene, factory, { count = 30, avoid = flat, maxH = height * 0.45, seed: sd = 3, area = size * 0.9 } = {}) => {
    let r = sd * 16807;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    const out = [];
    let tries = 0;
    while (out.length < count && tries++ < count * 20) {
      const x = (rnd() - 0.5) * area, z = (rnd() - 0.5) * area;
      if (Math.hypot(x, z) < avoid) continue;
      const h = heightAt(x, z);
      if ((water !== null && h < water + 0.3) || h > maxH) continue;
      const o = factory(out.length, rnd);
      if (!o) continue;
      o.position.set(x, h, z);
      o.rotation.y = rnd() * Math.PI * 2;
      scene.add(o);
      out.push(o);
    }
    return out;
  };

  return { mesh, water: waterMesh, heightAt, addPhysics, scatter, size };
}
