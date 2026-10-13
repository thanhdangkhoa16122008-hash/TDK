// world.js — khởi tạo renderer/camera/ánh sáng chuẩn cho điện thoại + bầu trời và chu kỳ ngày/đêm.
//   const W = createWorld({ quality: 'auto' });   // W.renderer, W.scene, W.camera, W.sun, W.hemi
//   const sky = new DayNight(W, { dayLength: 240 }); // mỗi frame: sky.update(dt, playerPos)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export function createWorld({ fov = 60, background = 0x87ceeb, shadows = true, quality = 'auto', fog = [30, 90] } = {}) {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const qp = new URLSearchParams(location.search).get('q'); // ?q=low|medium|high
  if (qp) quality = qp;
  const q = quality === 'auto' ? (mobile ? 'medium' : 'high') : quality;
  const renderer = new THREE.WebGLRenderer({ antialias: q !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, { low: 1, medium: 1.5, high: 2 }[q]));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = shadows && q !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  if (fog) scene.fog = new THREE.Fog(background, fog[0], fog[1]);
  const camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.1, 500);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 1.0);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(10, 20, 8);
  sun.castShadow = renderer.shadowMap.enabled;
  const sm = { low: 512, medium: 1024, high: 2048 }[q];
  sun.shadow.mapSize.set(sm, sm);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 80 });
  scene.add(hemi, sun, sun.target);

  const resizers = [];
  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    resizers.forEach((f) => f(innerWidth, innerHeight));
  };
  addEventListener('resize', onResize);

  // Bóng đổ đi theo người chơi để luôn sắc nét quanh họ
  const followShadow = (pos) => {
    sun.target.position.copy(pos);
    sun.position.copy(pos).add(sunOffset);
  };
  const sunOffset = new THREE.Vector3(10, 20, 8);

  // Vòng lặp game: fn(dt, elapsed). Tự dừng khi chuyển tab, dt giới hạn 0.05s để vật lý không "nhảy cóc".
  const timer = new THREE.Timer();
  timer.connect(document);
  const start = (fn) => {
    renderer.setAnimationLoop((t) => {
      timer.update(t);
      fn(Math.min(timer.getDelta(), 0.05), timer.getElapsed());
    });
  };
  const stop = () => renderer.setAnimationLoop(null);

  return { renderer, scene, camera, sun, hemi, quality: q, mobile, onResize: (f) => resizers.push(f), followShadow, sunOffset, start, stop, timer };
}

// Bầu trời vật lý + mặt trời di chuyển, màu ánh sáng/sương thay đổi theo giờ.
export class DayNight {
  constructor(W, { dayLength = 300, startHour = 9, paused = false } = {}) {
    this.W = W;
    this.dayLength = dayLength;
    const qh = new URLSearchParams(location.search).get('hour'); // ?hour=21 để xem ban đêm khi kiểm tra
    this.time = (qh !== null ? Number(qh) : startHour) / 24;
    this.paused = paused;
    this.sky = new Sky();
    this.sky.scale.setScalar(400);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.5;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    W.scene.add(this.sky);
    W.scene.background = null;
    this.sunDir = new THREE.Vector3();
    this._c = new THREE.Color();
    this.update(0);
  }
  get hour() { return (this.time * 24) % 24; }
  set hour(h) { this.time = h / 24; }
  get isNight() { const h = this.hour; return h < 5.5 || h > 19; }
  update(dt, followPos) {
    if (!this.paused) this.time = (this.time + dt / this.dayLength) % 1;
    const ang = (this.time - 0.25) * Math.PI * 2; // 6h mọc, 18h lặn
    const elev = Math.sin(ang) + 0.12; // +0.12: ngày dài hơn, hoàng hôn ~18h30
    this.sunDir.set(Math.cos(ang) * 0.8, elev, 0.4).normalize();
    const day = THREE.MathUtils.smoothstep(elev, -0.25, 0.2);
    // Sky tối đen khi mặt trời sát chân trời → giữ mặt trời của bầu trời hơi cao để có hoàng hôn cam,
    // và khi trời tối hẳn thì ẩn Sky, dùng nền xanh đêm cùng màu sương.
    const skySun = this.sunDir.clone();
    skySun.y = Math.max(skySun.y, 0.04);
    this.sky.material.uniforms.sunPosition.value.copy(skySun.normalize());
    this.sky.visible = day > 0.25;
    const dusk = Math.max(0, 1 - Math.abs(elev) / 0.3);
    const { sun, hemi, scene, renderer } = this.W;
    // ban ngày: nắng vàng → trắng; ban đêm: "ánh trăng" xanh nhạt đủ để nhìn thấy đường
    const moon = 1 - day;
    sun.intensity = 2.4 * day + 0.55 * moon;
    if (day > 0.02) sun.color.setHSL(0.09 + 0.05 * day, 0.7 * dusk, 0.95 - 0.2 * dusk);
    else sun.color.set(0x9db4ff);
    hemi.intensity = 0.35 + 0.75 * day;
    hemi.color.setHSL(0.6, 0.45, 0.35 + 0.55 * day);
    hemi.groundColor.setHSL(0.25, 0.3, 0.12 + 0.2 * day);
    this.W.sunOffset.copy(this.sunDir).multiplyScalar(30);
    if (elev < 0.05) this.W.sunOffset.set(-12, 25, 10); // ánh trăng từ trên cao
    renderer.toneMappingExposure = 0.8 + 0.2 * day;
    if (scene.fog) {
      this._c.setHSL(0.6, 0.45, 0.1 + 0.6 * day);
      if (dusk > 0) this._c.lerp(new THREE.Color(0xff9a5a), dusk * 0.4 * day);
      scene.fog.color.copy(this._c);
    }
    if (!this.sky.visible) { (scene.background ||= new THREE.Color()).copy(this._c); } else scene.background = null;
    if (followPos) this.W.followShadow(followPos);
  }
}
