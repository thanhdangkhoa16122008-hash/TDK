// audio.js — âm thanh riêng của game: mưa, sấm, tiếng ù khi bị săn, hộp nhạc. Không cần file.
import { ZZFX } from '../../libs/audio/zzfx.js';
import { PRESETS, SFX } from '../../kit/sfx.js';

Object.assign(PRESETS, {
  thunder: [2, .3, 40, .05, .8, 2.2, 4, .4, , , , , , 3.5, , .4, .15, .6, .4],
  slam:    [2, .1, 60, , .05, .5, 4, 2, , , , , , 2.5, , .3, , .5],
  whisper: [.5, .3, 1800, .3, .6, .7, 4, 0, , , , , .07, 6, , , , .3, .2, .1],
  lock:    [.8, , 400, , .02, .08, 4, 2, , , 300, .04, , , , , , .5],
  unlock:  [1, , 600, , .03, .12, 1, 2, , , 400, .05, , , , , .05],
  glitch:  [1.2, .5, 300, , .1, .3, 4, 4, , , , , .02, 8, 50, .5],
  knock:   [1.4, .1, 120, , .01, .12, 4, 3, , , , , .18, 1.5, , .2],
  hum:     [.6, , 120, .1, .4, .3, 1, 1, , , , , , , , , , .8],
  battery: [.8, , 700, .01, .1, .2, 1, 1.5, , , 500, .06],
});

const ctx = ZZFX.audioContext;
let master = null;
const out = () => {
  if (!master) { master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination); }
  return master;
};

function noiseBuffer(sec = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// Mưa ngoài trời: tiếng ồn trắng lọc + gió trầm
export const Ambience = {
  nodes: null,
  start() {
    if (this.nodes) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(3); src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(bp).connect(g).connect(out());
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(4); wind.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const wg = ctx.createGain(); wg.gain.value = 0.12;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.08;
    lfo.connect(lg).connect(wg.gain);
    wind.connect(lp).connect(wg).connect(out());
    src.start(); wind.start(); lfo.start();
    this.nodes = { src, wind, lfo, g };
  },
  // trong nhà kín (kho) mưa nhỏ hơn
  setRain(v) { if (this.nodes) this.nodes.g.gain.setTargetAtTime(v, ctx.currentTime, 0.5); },
};

// Tiếng ù trầm khi bóng đen đi săn — to dần theo mức nguy hiểm 0..1
export const Drone = {
  nodes: null,
  set(level) {
    if (!this.nodes) {
      const g = ctx.createGain(); g.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280;
      const oscs = [41, 41.7, 61.5].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
      lp.connect(g).connect(out());
      this.nodes = { g, lp, oscs };
    }
    const t = ctx.currentTime;
    this.nodes.g.gain.setTargetAtTime(level * 0.22, t, 0.4);
    this.nodes.lp.frequency.setTargetAtTime(200 + level * 500, t, 0.4);
  },
};

// Hộp nhạc: bài ru buồn, phát một lần. vol 0..1, pan -1..1
const MELODY = [
  [76, 1], [79, 1], [81, 2], [79, 1], [76, 1], [74, 2], [76, 3], [0, 1],
  [76, 1], [79, 1], [83, 2], [81, 1], [79, 1], [76, 2], [74, 3], [0, 1],
  [72, 1], [74, 1], [76, 2], [74, 1], [71, 1], [69, 4],
];
export function musicBox({ vol = 0.5, speed = 1 } = {}) {
  const beat = 0.32 / speed;
  // mỗi lần phát có bus riêng để dừng được (tránh nhiều bản chồng lên nhau)
  const bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(out());
  const oscs = [];
  let t = ctx.currentTime + 0.05;
  for (const [n, len] of MELODY) {
    if (n) {
      const f = 440 * Math.pow(2, (n - 69) / 12);
      for (const [mul, gmul] of [[1, 1], [2.01, 0.25], [3.98, 0.08]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul * (1 + (Math.random() - 0.5) * 0.004);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09 * vol * gmul, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        o.connect(g).connect(bus);
        o.start(t); o.stop(t + 1.7);
        oscs.push(o);
      }
    }
    t += beat * len;
  }
  const end = t + 1.8;
  return {
    duration: (end - ctx.currentTime) * 1000,
    stop() {
      if (ctx.currentTime >= end) return;
      bus.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      setTimeout(() => { oscs.forEach((o) => { try { o.stop(); } catch (e) {} }); bus.disconnect(); }, 600);
    },
  };
}

// Tiếng động ngẫu nhiên trong nhà: gõ cửa, thì thầm, bước chân xa
export function randomCreak() {
  const r = Math.random(), pan = (Math.random() - 0.5) * 1.6;
  if (r < 0.35) SFX.play('knock', { volume: 0.5, pan });
  else if (r < 0.6) SFX.play('whisper', { volume: 0.6, pan });
  else if (r < 0.8) SFX.play('door', { volume: 0.35, pan, rate: 0.7 });
  else SFX.play('step', { volume: 0.6, pan, rate: 0.6 });
}
