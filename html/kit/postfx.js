// postfx.js — hiệu ứng hậu kỳ theo phong cách + tự hạ chất lượng khi máy yếu.
//   const fx = createPostFX(W, 'bright' | 'horror' | 'retro' | 'none');
//   mỗi frame: fx.render(dt)   (thay cho renderer.render)
//   fx.set({ bloom: 0.8, vignette: 1.2, grain: 0.4, saturation: 0.6 })  // chỉnh trực tiếp lúc chạy
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';

// Gộp vignette + nhiễu hạt + bão hòa màu + rung màu (chromatic) vào 1 pass cho nhẹ máy
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 },
    vignette: { value: 0.0 }, grain: { value: 0.0 }, saturation: { value: 1.0 },
    tint: { value: new THREE.Color(1, 1, 1) }, chroma: { value: 0.0 }, flash: { value: 0.0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, vignette, grain, saturation, chroma, flash; uniform vec3 tint; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time*7.0) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      vec3 c;
      if (chroma > 0.0) {
        vec2 o = d * chroma * 0.02;
        c = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      } else c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(l), c, saturation) * tint;
      c *= 1.0 - vignette * dot(d, d) * 1.6;
      c += (rnd(vUv) - 0.5) * grain * 0.25;
      c = mix(c, vec3(1.0), flash);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// Lưu ý: bầu trời Sky có độ sáng HDR rất lớn → bloom sẽ làm trắng xóa cả cảnh. Chỉ bật bloom cho cảnh tối/không dùng Sky.
const PRESETS = {
  none:   { bloom: 0, vignette: 0, grain: 0, saturation: 1, chroma: 0, tint: 0xffffff },
  bright: { bloom: 0, bloomThreshold: 2.0, vignette: 0.35, grain: 0, saturation: 1.12, chroma: 0, tint: 0xffffff },
  horror: { bloom: 0.25, bloomThreshold: 0.6, vignette: 1.4, grain: 0.35, saturation: 0.45, chroma: 0.6, tint: 0xd8e4ff },
  retro:  { bloom: 0, vignette: 0.4, grain: 0.1, saturation: 1.1, chroma: 0, tint: 0xffffff, pixel: 4 },
};

export function createPostFX(W, style = 'bright', { adaptive = true } = {}) {
  const { renderer, scene, camera } = W;
  const qs = new URLSearchParams(location.search);
  if (qs.get('fx')) style = qs.get('fx'); // ?fx=none để tắt hậu kỳ khi kiểm tra
  const p = { ...PRESETS[style] || PRESETS.bright };
  const composer = new EffectComposer(renderer);
  const renderPass = p.pixel ? new RenderPixelatedPass(p.pixel, scene, camera) : new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), p.bloom, 0.4, p.bloomThreshold ?? 0.85);
  bloom.enabled = p.bloom > 0;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  const fxaa = new FXAAPass();
  fxaa.enabled = !p.pixel;
  composer.addPass(fxaa);

  // level: mức tự hạ chất lượng (khai báo trước set() vì set() đọc nó)
  let acc = 0, frames = 0, level = 0, enabled = style !== 'none';
  const set = (o) => {
    Object.assign(p, o);
    bloom.strength = p.bloom; bloom.enabled = p.bloom > 0 && level < 2; // không bật lại bloom sau khi đã tự tắt
    if (p.bloomThreshold !== undefined) bloom.threshold = p.bloomThreshold;
    const u = grade.uniforms;
    u.vignette.value = p.vignette; u.grain.value = p.grain; u.saturation.value = p.saturation;
    u.chroma.value = p.chroma; u.tint.value.set(p.tint);
  };
  set({});
  W.onResize((w, h) => { composer.setSize(w, h); bloom.resolution.set(w / 2, h / 2); });

  // Tự hạ chất lượng: nếu FPS < 40 kéo dài → giảm độ phân giải, rồi tắt bloom, rồi tắt hậu kỳ
  const degrade = () => {
    level++;
    if (level === 1) {
      renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() * 0.75));
      composer.setPixelRatio(renderer.getPixelRatio()); // composer giữ pixelRatio riêng, phải cập nhật cùng
    }
    else if (level === 2) { bloom.enabled = false; fxaa.enabled = false; }
    else if (level === 3) { renderer.shadowMap.enabled = false; scene.traverse((o) => o.material && (o.material.needsUpdate = true)); }
    else if (level === 4) enabled = false;
    composer.setSize(innerWidth, innerHeight);
    console.info('[postfx] hạ chất lượng xuống mức', level);
  };

  let flashT = 0;
  const api = {
    composer, bloom, grade, set, params: p,
    get level() { return level; },
    flash(strength = 0.8) { flashT = strength; },
    render(dt = 1 / 60) {
      grade.uniforms.time.value += dt;
      if (flashT > 0) { flashT = Math.max(0, flashT - dt * 2.5); }
      grade.uniforms.flash.value = flashT;
      if (adaptive) {
        acc += dt; frames++;
        if (acc > 3) { if (frames / acc < 40 && level < 4) degrade(); acc = 0; frames = 0; }
      }
      if (enabled) composer.render(dt); else renderer.render(scene, camera);
    },
  };
  globalThis.__fx = api; // để công cụ kiểm tra/bật tắt từng pass
  return api;
}
