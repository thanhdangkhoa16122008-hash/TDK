// sfx.js — âm thanh game không cần file: hiệu ứng (ZzFX) + nhạc nền tự sinh (Web Audio).
// Dùng: import { SFX, Music, unlockAudio } from '../../kit/sfx.js';
//   unlockAudio() trong sự kiện chạm/bấm đầu tiên (bắt buộc trên điện thoại).
//   SFX.play('coin');  Music.start('calm' | 'horror');  Music.stop();
// Tạo preset mới: vào https://killedbyapixel.github.io/ZzFX/ , chỉnh tiếng, copy mảng tham số vào PRESETS.
import { ZZFX } from '../libs/audio/zzfx.js';

export const PRESETS = {
  coin:    [1.2, , 1675, , .06, .24, 1, 1.82, , , 837, .06],
  jump:    [1, , 300, .02, .05, .15, , 1.5, 12, , , , , , , , , .7],
  step:    [.4, .3, 90, , .01, .03, 4, 2, , , , , , 1.5, , .1],
  hit:     [1.5, , 200, , .02, .2, 4, 3, -5, , , , , 1.5, , .4, , .6],
  pickup:  [1, , 900, .01, .08, .15, , 2, 8, , 200, .05],
  click:   [.6, , 1200, , .005, .01, , 2],
  plant:   [.8, , 220, .02, .1, .2, 2, 1.5, , , -50, .05],
  harvest: [1, , 500, .02, .15, .3, 1, 1.6, , , 300, .08, .05],
  error:   [1, , 150, .02, .1, .2, 3, 1, , , -40, .1],
  door:    [1, .1, 70, .1, .4, .6, 4, .5, , , , , , 2, , .2, .1],
  scream:  [1.5, .5, 800, .05, .5, .8, 2, 3, , , -200, , .1, 3, , .5, , .5],
  heartbeat:[1.5, , 50, , .03, .1, , 3, , , , , , , , .1],
};

const cache = new Map();
let unlocked = false;

export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  const ctx = ZZFX.audioContext;
  if (ctx.state === 'suspended') ctx.resume();
}

export const SFX = {
  volume: 0.4,
  play(name, { volume = 1, rate = 1, pan = 0 } = {}) {
    const p = PRESETS[name];
    if (!p) return console.warn('Không có âm thanh:', name);
    if (!cache.has(name)) cache.set(name, ZZFX.buildSamples(...p));
    ZZFX.volume = this.volume;
    return ZZFX.playSamples([cache.get(name)], volume, rate, pan);
  },
  // Bước chân/tiếng lặp: đổi cao độ nhẹ cho đỡ nhàm
  playVaried(name, spread = 0.15) {
    return this.play(name, { rate: 1 + (Math.random() - 0.5) * spread * 2 });
  },
};

// Nhạc nền tự sinh: nền trầm + nốt ngũ cung ngẫu nhiên. Nhẹ máy, chạy vô hạn.
const MOODS = {
  calm:   { root: 220, scale: [0, 2, 4, 7, 9, 12, 14], tempo: 0.55, wave: 'triangle', pad: 'sine',     padGain: 0.05, noteGain: 0.07 },
  horror: { root: 110, scale: [0, 1, 6, 7, 13],         tempo: 1.6,  wave: 'sine',     pad: 'sawtooth', padGain: 0.025, noteGain: 0.05 },
  happy:  { root: 262, scale: [0, 4, 7, 9, 12, 16],     tempo: 0.3,  wave: 'square',   pad: 'triangle', padGain: 0.03, noteGain: 0.035 },
};

export const Music = {
  _nodes: null,
  _timer: null,
  start(mood = 'calm') {
    this.stop();
    const m = MOODS[mood] || MOODS.calm;
    const ctx = ZZFX.audioContext;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = mood === 'horror' ? 600 : 2500;
    filter.connect(master).connect(ctx.destination);
    // pad
    const pads = [0, 7].map((semi) => {
      const o = ctx.createOscillator();
      o.type = m.pad;
      o.frequency.value = m.root / 2 * Math.pow(2, semi / 12);
      const g = ctx.createGain();
      g.gain.value = m.padGain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.1 + Math.random() * 0.1;
      const lg = ctx.createGain();
      lg.gain.value = m.padGain * 0.5;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(filter);
      o.start();
      lfo.start();
      return [o, lfo];
    });
    this._nodes = { master, pads };
    const tick = () => {
      if (Math.random() < 0.75) {
        const semi = m.scale[Math.floor(Math.random() * m.scale.length)];
        const o = ctx.createOscillator();
        o.type = m.wave;
        o.frequency.value = m.root * Math.pow(2, semi / 12);
        const g = ctx.createGain();
        const t = ctx.currentTime;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(m.noteGain, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + m.tempo * 2.5);
        o.connect(g).connect(filter);
        o.start(t);
        o.stop(t + m.tempo * 2.6);
      }
      this._timer = setTimeout(tick, m.tempo * 1000 * (0.75 + Math.random() * 0.5));
    };
    tick();
  },
  stop() {
    clearTimeout(this._timer);
    if (this._nodes) {
      this._nodes.pads.flat().forEach((n) => { try { n.stop(); } catch (e) {} });
      this._nodes.master.disconnect();
      this._nodes = null;
    }
  },
};
