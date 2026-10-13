// assets.js — nạp model .glb (có animation) và âm thanh từ html/assets/.
// Đường dẫn luôn tính từ html/assets/, vd 'models/kenney-arena/character-soldier.glb'.
// Khi đóng gói 1 file (build-single), mọi asset được nhúng sẵn vào window.__ASSETS.
//
//   const soldier = await Assets.model('models/kenney-arena/character-soldier.glb');
//   scene.add(soldier.object);  soldier.anim.play('walk');  // mỗi frame: soldier.anim.update(dt)
//   Assets.sound('sounds/kenney-platformer/coin.mp3').play();  // cần <script src=".../howler.min.js">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const ROOT = new URL('../assets/', import.meta.url).href;
export const assetUrl = (p) => (globalThis.__ASSETS && globalThis.__ASSETS[p]) || ROOT + p;

const loader = new GLTFLoader();
const gltfCache = new Map();
const soundCache = new Map();

// Điều khiển animation: chuyển mượt giữa các động tác
export class Animator {
  constructor(object, clips) {
    this.mixer = new THREE.AnimationMixer(object);
    this.clips = new Map(clips.map((c) => [c.name, c]));
    this.current = null;
    this.currentName = '';
  }
  get names() { return [...this.clips.keys()]; }
  play(name, { fade = 0.2, loop = true, speed = 1, onEnd } = {}) {
    if (this.currentName === name && loop) return this.current;
    const clip = this.clips.get(name);
    if (!clip) { console.warn('Không có animation', name, '— có:', this.names.join(', ')); return null; }
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.timeScale = speed;
    if (this.current && this.current !== action) this.current.crossFadeTo(action, fade, false);
    action.play();
    if (onEnd) {
      const h = (e) => { if (e.action === action) { this.mixer.removeEventListener('finished', h); onEnd(); } };
      this.mixer.addEventListener('finished', h);
    }
    this.current = action;
    this.currentName = name;
    return action;
  }
  update(dt) { this.mixer.update(dt); }
}

export const Assets = {
  // Nạp và trả về bản sao riêng (mỗi lần gọi là một con mới, dùng chung dữ liệu hình học)
  async model(path, { shadows = true, scale = 1 } = {}) {
    if (!gltfCache.has(path)) gltfCache.set(path, loader.loadAsync(assetUrl(path)));
    const gltf = await gltfCache.get(path);
    const object = SkeletonUtils.clone(gltf.scene);
    object.scale.setScalar(scale);
    object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = shadows;
        o.receiveShadow = shadows;
        if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
      }
    });
    const anim = gltf.animations.length ? new Animator(object, gltf.animations) : null;
    return { object, anim, animations: gltf.animations };
  },
  // Nạp trước nhiều model (màn hình loading)
  async preload(paths, onProgress) {
    let done = 0;
    await Promise.all(paths.map(async (p) => {
      if (!gltfCache.has(p)) gltfCache.set(p, loader.loadAsync(assetUrl(p)));
      await gltfCache.get(p);
      onProgress?.(++done / paths.length, p);
    }));
  },
  sound(path, { volume = 1, loop = false } = {}) {
    if (!globalThis.Howl) throw new Error('Thiếu howler.min.js');
    const key = path + loop;
    if (!soundCache.has(key)) {
      soundCache.set(key, new globalThis.Howl({ src: [assetUrl(path)], volume, loop, format: ['mp3'] }));
    }
    return soundCache.get(key);
  },
};

// Đặt vật thể đứng trên mặt đất theo bounding box (model mỗi gói có gốc khác nhau)
export function sitOnGround(object, y = 0) {
  const box = new THREE.Box3().setFromObject(object);
  object.position.y += y - box.min.y;
  return object;
}

// Kích thước thật của model (để đặt collider)
export function sizeOf(object) {
  return new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
}
