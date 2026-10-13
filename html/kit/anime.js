// anime.js — nhân vật phong cách anime dựng hoàn toàn bằng code: tô bóng hoạt hình (toon) + viền nét,
// mặt vẽ bằng canvas (mắt to, chớp mắt, đổi biểu cảm), tóc nhiều kiểu, có khung xương và animation.
//
//   const girl = createAnimeGirl({ hair: 'long' | 'twintail' | 'short' | 'ponytail', hairColor: 0x6b4bd8, eyeColor: 0x3fa7ff });
//   scene.add(girl.object);
//   girl.anim.play('idle' | 'walk' | 'run' | 'wave' | 'jump');  mỗi frame: girl.anim.update(dt)
//   girl.setExpression('smile' | 'neutral' | 'surprised' | 'sad' | 'angry');
// girl.anim có cùng cách dùng với Animator trong assets.js → cắm thẳng vào PlayerController:
//   new PlayerController({ ..., model: girl.object, anim: girl.anim, animNames: { idle: 'idle', walk: 'walk', run: 'run', jump: 'jump', fall: 'jump' } })
// Hướng mặt: +Z. Gốc tọa độ ở chân. Cao ~1.6.
import * as THREE from 'three';

// ---------- vật liệu hoạt hình ----------
let GRADIENT;
function toonGradient() {
  if (GRADIENT) return GRADIENT;
  const d = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  GRADIENT = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  GRADIENT.minFilter = GRADIENT.magFilter = THREE.NearestFilter;
  GRADIENT.needsUpdate = true;
  return GRADIENT;
}
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
// Da dùng thang bóng nhẹ hơn để mặt không bị vệt tối cắt ngang
let SKIN_GRADIENT;
const skinToon = (color) => {
  if (!SKIN_GRADIENT) {
    SKIN_GRADIENT = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255, 255, 255, 255, 255]), 2, 1, THREE.RGBAFormat);
    SKIN_GRADIENT.minFilter = SKIN_GRADIENT.magFilter = THREE.NearestFilter;
    SKIN_GRADIENT.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: SKIN_GRADIENT });
};

// Viền kiểu anime: vỏ phồng ra theo pháp tuyến, chỉ vẽ mặt sau
const outlineMats = new Map();
function outlineMat(thickness, color) {
  const key = thickness + ':' + color;
  if (!outlineMats.has(key)) {
    outlineMats.set(key, new THREE.ShaderMaterial({
      uniforms: { t: { value: thickness }, c: { value: new THREE.Color(color) } },
      vertexShader: 'uniform float t; void main(){ vec3 p = position + normal * t; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
      fragmentShader: 'uniform vec3 c; void main(){ gl_FragColor = vec4(c, 1.0); }',
      side: THREE.BackSide,
    }));
  }
  return outlineMats.get(key);
}

// ---------- tiện ích hình học ----------
function taperTube(points, r0, r1, { seg = 18, radial = 7, flat = 1 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.attributes.position;
  const frames = curve.computeFrenetFrames(seg, false);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = curve.getPointAt(t);
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 1.3));
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const v = new THREE.Vector3().fromBufferAttribute(pos, k).sub(c);
      // làm dẹt sợi tóc theo trục binormal
      const b = frames.binormals[i];
      const along = v.dot(b);
      v.addScaledVector(b, along * (flat - 1));
      v.multiplyScalar(r);
      pos.setXYZ(k, c.x + v.x, c.y + v.y, c.z + v.z);
    }
  }
  // nắp đầu ống
  g.computeVertexNormals();
  return g;
}

function lathe(profile, seg = 24, sz = 1) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.scale(1, 1, sz);
  g.computeVertexNormals();
  return g;
}

// ---------- mặt vẽ bằng canvas ----------
function hex(c) { return '#' + new THREE.Color(c).getHexString(); }
function drawFace(canvas, { eyeColor, expression = 'neutral', blink = 0, skin }) {
  const g = canvas.getContext('2d');
  const S = canvas.width;
  g.clearRect(0, 0, S, S);
  const eye = new THREE.Color(eyeColor);
  const dark = hex(eye.clone().multiplyScalar(0.35)), mid = hex(eye), light = hex(eye.clone().lerp(new THREE.Color(1, 1, 1), 0.55));
  const ex = { neutral: 0, smile: 1, surprised: 2, sad: 3, angry: 4 }[expression] ?? 0;
  const eyeY = S * 0.5, eyeW = S * 0.15, eyeH = S * 0.215;
  for (const side of [-1, 1]) {
    const cx = S * 0.5 + side * S * 0.185;
    // lông mày
    g.strokeStyle = '#3b2622'; g.lineWidth = S * 0.012; g.lineCap = 'round';
    g.beginPath();
    const by = S * (ex === 2 ? 0.27 : 0.31), tilt = ex === 4 ? 0.035 : ex === 3 ? -0.03 : 0;
    g.moveTo(cx - side * eyeW * 1.0, by + S * tilt);
    g.quadraticCurveTo(cx, by - S * 0.025, cx + side * eyeW * 1.05, by + S * 0.01 - S * tilt);
    g.stroke();

    const closed = ex === 1 ? 1 : blink;
    if (closed > 0.6) {
      // mắt nhắm / cười híp: đường cong
      g.lineWidth = S * 0.018; g.strokeStyle = '#2a1a18';
      g.beginPath();
      if (ex === 1) { g.moveTo(cx - eyeW, eyeY + S * 0.01); g.quadraticCurveTo(cx, eyeY - eyeH * 0.55, cx + eyeW, eyeY + S * 0.01); }
      else { g.moveTo(cx - eyeW, eyeY); g.quadraticCurveTo(cx, eyeY + eyeH * 0.3, cx + eyeW, eyeY); }
      g.stroke();
      continue;
    }
    const h = eyeH * (ex === 2 ? 1.12 : 1);
    const lid = eyeY - h * 0.62 + (h * 1.25) * blink;
    // chỉ vẽ phần mắt dưới mí trên (chớp mắt = mí hạ xuống)
    g.save(); g.beginPath(); g.rect(cx - eyeW * 1.3, lid, eyeW * 2.6, h * 2); g.clip();
    // lòng trắng
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(cx, eyeY + h * 0.05, eyeW * 0.95, h * 0.62, 0, 0, Math.PI * 2); g.fill();
    // tròng mắt: gradient tối ở trên, sáng ở dưới
    const ir = g.createLinearGradient(0, eyeY - h * 0.6, 0, eyeY + h * 0.6);
    ir.addColorStop(0, dark); ir.addColorStop(0.55, mid); ir.addColorStop(1, light);
    g.fillStyle = ir;
    const iw = eyeW * (ex === 2 ? 0.58 : 0.74), ih = h * (ex === 2 ? 0.5 : 0.6);
    g.beginPath(); g.ellipse(cx + side * eyeW * 0.05, eyeY + h * 0.08, iw, ih, 0, 0, Math.PI * 2); g.fill();
    // con ngươi
    g.fillStyle = dark;
    g.beginPath(); g.ellipse(cx + side * eyeW * 0.05, eyeY + h * 0.06, iw * 0.45, ih * 0.5, 0, 0, Math.PI * 2); g.fill();
    // điểm sáng
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(cx - side * iw * 0.25 + iw * 0.15, eyeY - ih * 0.25, iw * 0.3, ih * 0.22, -0.4, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 0.8;
    g.beginPath(); g.arc(cx + iw * 0.35, eyeY + ih * 0.45, iw * 0.12, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    g.restore();
    // mí trên đậm
    g.strokeStyle = '#1f1210'; g.lineWidth = S * 0.03;
    g.beginPath();
    g.moveTo(cx - side * eyeW * 1.05, lid + h * 0.12);
    g.quadraticCurveTo(cx - side * eyeW * 0.2, lid - h * 0.12, cx + side * eyeW * 1.12, lid + h * 0.02);
    g.lineTo(cx + side * eyeW * 1.25, lid - h * 0.06); // đuôi mắt
    g.stroke();
    // mí dưới mảnh
    g.lineWidth = S * 0.008; g.globalAlpha = 0.6;
    g.beginPath(); g.moveTo(cx - eyeW * 0.6, eyeY + h * 0.66); g.quadraticCurveTo(cx, eyeY + h * 0.72, cx + eyeW * 0.6, eyeY + h * 0.66); g.stroke();
    g.globalAlpha = 1;
  }
  // má hồng
  g.fillStyle = 'rgba(255,120,140,0.35)';
  for (const side of [-1, 1]) { g.beginPath(); g.ellipse(S * 0.5 + side * S * 0.22, S * 0.66, S * 0.07, S * 0.03, 0, 0, Math.PI * 2); g.fill(); }
  // mũi
  g.strokeStyle = 'rgba(150,80,70,0.6)'; g.lineWidth = S * 0.008;
  g.beginPath(); g.moveTo(S * 0.505, S * 0.64); g.lineTo(S * 0.495, S * 0.665); g.stroke();
  // miệng
  g.lineWidth = S * 0.011; g.strokeStyle = '#7a2e2e'; g.fillStyle = '#c4475a';
  const my = S * 0.76;
  g.beginPath();
  if (ex === 1) { g.moveTo(S * 0.44, my); g.quadraticCurveTo(S * 0.5, my + S * 0.06, S * 0.56, my); g.closePath(); g.fill(); g.stroke(); }
  else if (ex === 2) { g.ellipse(S * 0.5, my + S * 0.01, S * 0.025, S * 0.035, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
  else if (ex === 3) { g.moveTo(S * 0.465, my + S * 0.02); g.quadraticCurveTo(S * 0.5, my - S * 0.01, S * 0.535, my + S * 0.02); g.stroke(); }
  else if (ex === 4) { g.moveTo(S * 0.46, my + S * 0.01); g.lineTo(S * 0.54, my - S * 0.005); g.stroke(); }
  else { g.moveTo(S * 0.475, my); g.quadraticCurveTo(S * 0.5, my + S * 0.015, S * 0.525, my); g.stroke(); }
}

// ---------- dựng nhân vật ----------
export function createAnimeGirl({
  hair = 'long', hairColor = 0x5b3a8c, eyeColor = 0x3fa7ff, skin = 0xffe1d0,
  top = 0xf7f7fb, accent = 0x1f3a6b, skirt = 0x24345e, ribbon = 0xd63a4a, socks = 0x222233, shoes = 0x5a3424,
  outline = true, outlineColor = 0x2a1c22,
} = {}) {
  const parts = [];
  const add = (parent, geo, mat, { outline: ol = 0.006, cast = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = true;
    parent.add(m);
    if (outline && ol) {
      const o = new THREE.Mesh(geo, outlineMat(ol, outlineColor));
      o.castShadow = false;
      m.add(o);
    }
    parts.push(m);
    return m;
  };
  const J = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

  const M = {
    skin: skinToon(skin), top: toon(top), accent: toon(accent), skirt: toon(skirt), ribbon: toon(ribbon),
    socks: toon(socks), shoes: toon(shoes), hair: toon(hairColor), hairDark: toon(new THREE.Color(hairColor).multiplyScalar(0.7)),
  };

  const root = new THREE.Group();
  root.name = 'anime-girl';
  // ---- khung xương ----
  const hips = J(root, 0, 0.86, 0);
  const spine = J(hips, 0, 0.12, 0);
  const chest = J(spine, 0, 0.18, 0);
  const neck = J(chest, 0, 0.14, 0);
  const head = J(neck, 0, 0.06, 0);
  const shL = J(chest, 0.155, 0.1, 0), shR = J(chest, -0.155, 0.1, 0);
  const elL = J(shL, 0, -0.25, 0), elR = J(shR, 0, -0.25, 0);
  const thL = J(hips, 0.075, -0.02, 0), thR = J(hips, -0.075, -0.02, 0);
  const knL = J(thL, 0, -0.4, 0), knR = J(thR, 0, -0.4, 0);

  // ---- thân ----
  // hông + bụng (váy che phần dưới)
  add(hips, lathe([[0.0, -0.06], [0.11, -0.05], [0.125, 0.02], [0.11, 0.12], [0.0, 0.13]], 20, 0.72), M.top);
  // áo: eo → ngực → vai
  add(spine, lathe([[0.0, -0.01], [0.1, 0.0], [0.105, 0.08], [0.125, 0.17], [0.13, 0.25], [0.12, 0.3], [0.07, 0.335], [0.0, 0.34]], 22, 0.7), M.top);
  // cổ áo thủy thủ + nơ
  const collar = add(chest, new THREE.TorusGeometry(0.075, 0.018, 8, 20), M.accent, { outline: 0.004 });
  collar.rotation.x = Math.PI / 2; collar.position.set(0, 0.135, -0.005); collar.scale.set(1, 0.85, 1);
  const flap = add(chest, new THREE.BoxGeometry(0.2, 0.09, 0.015), M.accent, { outline: 0.004 });
  flap.position.set(0, 0.11, -0.085); flap.rotation.x = 0.35;
  for (const s of [-1, 1]) {
    const bow = add(chest, new THREE.ConeGeometry(0.035, 0.07, 4), M.ribbon, { outline: 0.004 });
    bow.position.set(s * 0.035, 0.07, 0.095); bow.rotation.z = s * Math.PI / 2; bow.scale.z = 0.4;
    const tail = add(chest, new THREE.BoxGeometry(0.025, 0.08, 0.008), M.ribbon, { outline: 0.003 });
    tail.position.set(s * 0.018, 0.025, 0.098); tail.rotation.z = s * 0.25;
  }
  add(chest, new THREE.SphereGeometry(0.016, 8, 6), M.ribbon, { outline: 0.003 }).position.set(0, 0.07, 0.1);

  // váy xếp ly
  const skirtG = new THREE.CylinderGeometry(0.115, 0.225, 0.27, 48, 4, true);
  {
    const p = skirtG.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x), depth = (0.135 - y) / 0.27;
      const pleat = 1 + Math.abs(Math.sin(a * 8)) * 0.07 * depth;
      p.setXYZ(i, x * pleat, y, z * pleat * 0.85);
    }
    skirtG.computeVertexNormals();
  }
  const skirtM = add(hips, skirtG, new THREE.MeshToonMaterial({ color: skirt, gradientMap: toonGradient(), side: THREE.DoubleSide }), { outline: 0.004 });
  skirtM.position.y = -0.04;
  const skirtBand = add(hips, new THREE.CylinderGeometry(0.118, 0.118, 0.03, 24, 1, true), M.skirt, { outline: 0.003 });
  skirtBand.position.y = 0.1; skirtBand.scale.z = 0.75;

  // ---- tay ----
  for (const [sh, el, s] of [[shL, elL, 1], [shR, elR, -1]]) {
    add(sh, new THREE.SphereGeometry(0.048, 12, 10), M.top).scale.set(1, 1, 0.9);
    const up = add(sh, new THREE.CylinderGeometry(0.042, 0.036, 0.25, 12), M.top);
    up.position.y = -0.125;
    const cuff = add(el, new THREE.CylinderGeometry(0.038, 0.038, 0.03, 12), M.accent, { outline: 0.003 });
    cuff.position.y = -0.0;
    const fore = add(el, new THREE.CylinderGeometry(0.03, 0.024, 0.22, 10), M.skin);
    fore.position.y = -0.12;
    const hand = add(el, new THREE.SphereGeometry(0.032, 10, 8), M.skin);
    hand.position.set(0, -0.255, 0.005); hand.scale.set(0.75, 1.15, 0.55);
    const thumb = add(el, new THREE.CapsuleGeometry(0.009, 0.025, 3, 6), M.skin, { outline: 0.002 });
    thumb.position.set(s * -0.004, -0.24, 0.022); thumb.rotation.x = 0.6;
  }

  // ---- chân ----
  for (const [th, kn] of [[thL, knL], [thR, knR]]) {
    const thigh = add(th, new THREE.CylinderGeometry(0.058, 0.042, 0.4, 14), M.skin);
    thigh.position.y = -0.2;
    add(kn, new THREE.SphereGeometry(0.041, 10, 8), M.skin, { outline: 0.004 });
    const shin = add(kn, lathe([[0.0, -0.37], [0.026, -0.36], [0.03, -0.25], [0.04, -0.12], [0.038, -0.02], [0.0, 0.0]], 14), M.skin);
    // tất cao
    const sock = add(kn, new THREE.CylinderGeometry(0.043, 0.031, 0.27, 14, 1, true), M.socks, { outline: 0.003 });
    sock.position.y = -0.22;
    const sockTop = add(kn, new THREE.TorusGeometry(0.043, 0.006, 6, 16), M.socks, { outline: 0 });
    sockTop.rotation.x = Math.PI / 2; sockTop.position.y = -0.085;
    const shoe = add(kn, new THREE.CapsuleGeometry(0.035, 0.07, 4, 10), M.shoes);
    shoe.rotation.x = Math.PI / 2; shoe.position.set(0, -0.398, 0.025); shoe.scale.set(1, 1, 0.8);
    shin.castShadow = true;
  }

  // ---- cổ + đầu ----
  add(neck, new THREE.CylinderGeometry(0.03, 0.034, 0.1, 10), M.skin, { outline: 0.003 }).position.y = 0.0;
  const R = 0.13;
  const headC = J(head, 0, R * 0.92, 0.005);
  // đầu: cằm nhọn kiểu anime
  const deform = (g) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const ny = y / R;
      if (ny < 0) {
        const k = 1 - 0.38 * Math.pow(-ny, 1.6);
        x *= k; z *= 0.92 + 0.08 * k;
        y *= 1.08;
      }
      x *= 0.93;
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  };
  add(headC, deform(new THREE.SphereGeometry(R, 36, 28)), M.skin, { outline: 0.004 });
  // tai
  for (const s of [-1, 1]) {
    const ear = add(headC, new THREE.SphereGeometry(0.022, 8, 6), M.skin, { outline: 0.002 });
    ear.position.set(s * R * 0.9, -0.01, -0.005); ear.scale.set(0.5, 1, 0.8);
  }

  // mặt: mảnh cầu phía trước, cùng biến dạng với đầu
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = faceCanvas.height = 512;
  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.anisotropy = 4;
  const faceG = deform(new THREE.SphereGeometry(R * 1.004, 32, 24, Math.PI / 2 - 0.62, 1.24, 1.12, 1.12));
  const face = new THREE.Mesh(faceG, new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false }));
  face.renderOrder = 2;
  headC.add(face);
  let expression = 'neutral', blink = 0;
  const skinCss = hex(new THREE.Color(skin));
  const redraw = () => { drawFace(faceCanvas, { eyeColor, expression, blink, skin: skinCss }); faceTex.needsUpdate = true; };
  redraw();

  // ---- tóc ----
  const HR = R * 1.075;
  // phần tóc trùm đầu (chừa mặt)
  const capTop = add(headC, new THREE.SphereGeometry(HR, 32, 16, 0, Math.PI * 2, 0, 1.05), M.hair, { outline: 0.004 });
  capTop.scale.set(0.95, 1, 1);
  capTop.position.y = 0.005;
  const capBack = add(headC, new THREE.SphereGeometry(HR, 32, 20, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, 2.25), M.hair, { outline: 0.004 });
  capBack.scale.set(0.95, 1.02, 1.02);
  capBack.material = new THREE.MeshToonMaterial({ color: hairColor, gradientMap: toonGradient(), side: THREE.DoubleSide });
  // điểm trên mặt cầu tóc theo góc
  const onHead = (phi, theta, r = HR) => new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta) * 0.95, r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
  const strand = (pts, r0, r1, mat = M.hair, flat = 0.45, parent = headC) => add(parent, taperTube(pts, r0, r1, { flat }), mat, { outline: 0.003 });

  // mái (bangs): các lọn rủ xuống trán
  const bangPhis = [-0.55, -0.36, -0.18, 0, 0.17, 0.35, 0.55];
  bangPhis.forEach((d, i) => {
    const phi = Math.PI / 2 + d;
    const len = 1.28 + (i % 2) * 0.1 - Math.abs(d) * 0.12;
    strand([onHead(phi, 0.15, HR), onHead(phi, 0.7, HR * 1.06), onHead(phi + d * 0.15, 1.05, HR * 1.05), onHead(phi + d * 0.25, len, HR * 0.985)], 0.034, 0.003);
  });
  // tóc mai hai bên má
  for (const s of [-1, 1]) {
    const phi = Math.PI / 2 + s * 0.85;
    strand([onHead(phi, 0.4), onHead(phi, 1.2, HR * 1.03), onHead(phi + s * 0.05, 1.75, HR * 1.0), new THREE.Vector3(s * R * 0.8, -R * 1.3, R * 0.3)], 0.03, 0.004);
  }
  // lọn tóc phủ trên đỉnh và sau đầu để tóc không trông như mũ bảo hiểm
  for (let i = 0; i < 16; i++) {
    const phi = Math.PI / 2 + 0.9 + (i / 15) * (Math.PI * 2 - 1.8);
    strand([onHead(phi, 0.05, HR * 1.0), onHead(phi, 0.8, HR * 1.04), onHead(phi, 1.5, HR * 1.03), onHead(phi, 2.0, HR * 0.98)], 0.045, 0.01, i % 2 ? M.hair : M.hairDark, 0.35);
  }
  // sợi "râu" trên đỉnh đầu (ahoge)
  strand([onHead(Math.PI / 2, 0.05), onHead(Math.PI / 2 - 0.1, 0.0, HR * 1.25), new THREE.Vector3(0.03, HR * 1.4, 0.02)], 0.012, 0.002, M.hair, 0.6);

  const sway = []; // các nhóm tóc đung đưa
  const backBundle = (parent, count, { from, spread, length, curl = 0.05, r0 = 0.04 }) => {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5;
      const x = t * spread;
      const pts = [
        new THREE.Vector3(from.x + x * 0.5, from.y, from.z),
        new THREE.Vector3(from.x + x * 0.9, from.y - length * 0.3, from.z - 0.04 - Math.abs(t) * 0.02),
        new THREE.Vector3(from.x + x * 1.1, from.y - length * 0.7, from.z - 0.06 + curl),
        new THREE.Vector3(from.x + x * 0.9 + Math.sin(i * 1.7) * 0.02, from.y - length, from.z - 0.03 + curl * 1.5),
      ];
      strand(pts, r0 * (1 - Math.abs(t) * 0.4), 0.003, i % 3 ? M.hair : M.hairDark, 0.55, parent);
    }
  };
  if (hair === 'long') {
    const g = J(headC, 0, 0.02, -0.05); sway.push(g);
    backBundle(g, 11, { from: new THREE.Vector3(0, 0.05, -0.05), spread: 0.26, length: 0.62 });
  } else if (hair === 'ponytail') {
    const g = J(headC, 0, 0.06, -HR * 0.95); sway.push(g);
    add(g, new THREE.TorusGeometry(0.022, 0.009, 6, 12), M.ribbon, { outline: 0.002 }).rotation.x = 0.3;
    backBundle(g, 7, { from: new THREE.Vector3(0, 0, -0.01), spread: 0.06, length: 0.45, curl: -0.04, r0: 0.03 });
  } else if (hair === 'twintail') {
    for (const s of [-1, 1]) {
      const g = J(headC, s * HR * 0.72, 0.07, -0.05); sway.push(g);
      add(g, new THREE.SphereGeometry(0.025, 8, 6), M.ribbon, { outline: 0.002 });
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const o = new THREE.Vector3(Math.cos(a) * 0.015, 0, Math.sin(a) * 0.015);
        strand([o, new THREE.Vector3(s * 0.09 + o.x, -0.12, -0.02 + o.z), new THREE.Vector3(s * 0.1 + o.x * 2, -0.38, -0.04 + o.z * 2), new THREE.Vector3(s * 0.06 + o.x, -0.6, -0.02)], 0.032, 0.003, i % 2 ? M.hair : M.hairDark, 0.6, g);
      }
    }
    const g = J(headC, 0, 0.02, -0.05);
    backBundle(g, 7, { from: new THREE.Vector3(0, 0.03, -0.06), spread: 0.2, length: 0.18 });
  } else {
    // tóc ngắn ngang vai
    const g = J(headC, 0, 0.02, -0.05); sway.push(g);
    backBundle(g, 11, { from: new THREE.Vector3(0, 0.05, -0.05), spread: 0.27, length: 0.24, curl: 0.06 });
  }

  // ---------- animation ----------
  const bones = { hips, spine, chest, neck, head, shL, shR, elL, elR, thL, thR, knL, knR };
  const rest = {};
  for (const [k, b] of Object.entries(bones)) rest[k] = { p: b.position.clone(), r: b.rotation.clone() };
  const L = (a, b, t) => a + (b - a) * t;
  const poses = {
    idle: (t) => ({
      chest: { x: Math.sin(t * 2) * 0.015 }, head: { x: Math.sin(t * 1.3) * 0.03, z: Math.sin(t * 0.7) * 0.03 },
      shL: { z: 0.12 + Math.sin(t * 2) * 0.02 }, shR: { z: -0.12 - Math.sin(t * 2) * 0.02 }, elL: { x: -0.15 }, elR: { x: -0.15 },
      hips: { y: Math.sin(t * 2) * 0.003, z: Math.sin(t * 0.7) * 0.02 }, thL: { z: -0.02 }, thR: { z: 0.06, x: -0.05 }, knR: { x: 0.1 },
    }),
    walk: (t) => { const s = Math.sin(t * 7), c = Math.cos(t * 7); return {
      thL: { x: s * 0.55 }, thR: { x: -s * 0.55 }, knL: { x: Math.max(0, -c) * 0.8 + 0.05 }, knR: { x: Math.max(0, c) * 0.8 + 0.05 },
      shL: { x: -s * 0.45, z: 0.1 }, shR: { x: s * 0.45, z: -0.1 }, elL: { x: -0.35 }, elR: { x: -0.35 },
      hips: { y: Math.abs(c) * 0.025, yr: s * 0.08 }, chest: { yr: -s * 0.1 }, head: { x: 0.03 },
    }; },
    run: (t) => { const s = Math.sin(t * 11), c = Math.cos(t * 11); return {
      thL: { x: s * 0.9 - 0.15 }, thR: { x: -s * 0.9 - 0.15 }, knL: { x: Math.max(0, -c) * 1.4 + 0.2 }, knR: { x: Math.max(0, c) * 1.4 + 0.2 },
      shL: { x: -s * 0.8, z: 0.2 }, shR: { x: s * 0.8, z: -0.2 }, elL: { x: -1.2 }, elR: { x: -1.2 },
      hips: { y: Math.abs(c) * 0.05, yr: s * 0.12 }, spine: { x: 0.18 }, chest: { yr: -s * 0.15 }, head: { x: -0.1 },
    }; },
    wave: (t) => ({
      shR: { z: -2.6, x: -0.2 }, elR: { z: -0.4 + Math.sin(t * 8) * 0.45 }, shL: { z: 0.1 }, elL: { x: -0.2 },
      head: { z: 0.12, x: 0.05 }, hips: { z: 0.03 }, chest: { z: -0.03 }, thR: { z: 0.05 },
    }),
    jump: () => ({
      thL: { x: -0.7 }, thR: { x: -0.25 }, knL: { x: 1.2 }, knR: { x: 0.5 },
      shL: { z: 1.2, x: -0.4 }, shR: { z: -1.2, x: -0.4 }, elL: { x: -0.4 }, elR: { x: -0.4 }, head: { x: -0.1 },
    }),
  };
  const anim = {
    names: Object.keys(poses), currentName: 'idle', t: 0, blend: 1, prev: null, prevName: null,
    play(name) {
      if (!poses[name] || name === this.currentName) return;
      this.prevName = this.currentName; this.currentName = name; this.blend = 0;
      if (name === 'wave') expression === 'neutral' && setExpr('smile', 2.5);
    },
    update(dt) {
      this.t += dt;
      this.blend = Math.min(1, this.blend + dt * 6);
      const a = poses[this.currentName](this.t), b = this.prevName ? poses[this.prevName](this.t) : {};
      for (const [k, bone] of Object.entries(bones)) {
        const pa = a[k] || {}, pb = b[k] || {}, r = rest[k];
        const mix = (f, d = 0) => L(pb[f] ?? d, pa[f] ?? d, this.blend);
        bone.rotation.set(r.r.x + mix('x'), r.r.y + mix('yr'), r.r.z + mix('z'));
        if (k === 'hips') bone.position.y = r.p.y + mix('y');
      }
      // tóc và váy đung đưa theo chuyển động
      const move = { walk: 1, run: 2.2, jump: 1.5 }[this.currentName] || 0.3;
      sway.forEach((g, i) => { g.rotation.x = 0.06 * move + Math.sin(this.t * (3 + move * 3) + i) * 0.03 * (1 + move); g.rotation.z = Math.sin(this.t * 2.3 + i) * 0.02 * (1 + move); });
      skirtM.rotation.y = Math.sin(this.t * 7) * 0.04 * move;
      skirtM.scale.set(1 + 0.04 * move * Math.abs(Math.sin(this.t * 7)), 1, 1);
      // chớp mắt
      nextBlink -= dt;
      const nb = nextBlink < 0.12 && nextBlink > 0 ? 1 : 0;
      if (nextBlink <= 0) nextBlink = 2.5 + Math.random() * 3;
      if (nb !== blink) { blink = nb; redraw(); }
      if (exprTimer > 0 && (exprTimer -= dt) <= 0) { expression = baseExpr; redraw(); }
    },
  };
  let nextBlink = 2, exprTimer = 0, baseExpr = 'neutral';
  const setExpr = (e, seconds = 0) => {
    if (seconds) { exprTimer = seconds; } else { baseExpr = e; exprTimer = 0; }
    expression = e; redraw();
  };
  anim.update(0);

  return {
    object: root, anim, bones, parts,
    setExpression: setExpr,
    setColors(c = {}) {
      if (c.hair !== undefined) { M.hair.color.set(c.hair); M.hairDark.color.set(c.hair).multiplyScalar(0.7); capBack.material.color.set(c.hair); }
      if (c.eyes !== undefined) { eyeColor = c.eyes; redraw(); }
      if (c.skirt !== undefined) { M.skirt.color.set(c.skirt); skirtM.material.color.set(c.skirt); }
      if (c.accent !== undefined) M.accent.color.set(c.accent);
      if (c.ribbon !== undefined) M.ribbon.color.set(c.ribbon);
    },
  };
}
