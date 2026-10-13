// ZzFXM dùng với ZzFX ES module hiện có, không cần zzfxR/zzfxG toàn cục.
// import { zzfxM } from '../../kit/zzfxm.js';
// ZZFX.playSamples(zzfxM(instruments, patterns, sequence, 125));
import { ZZFX } from '../libs/audio/zzfx.js';
import '../libs/audio/zzfxm.js';

const render = globalThis.zzfxM;
export function zzfxM(instruments, patterns, sequence, BPM = 125) {
  return render(instruments, patterns, sequence, BPM, ZZFX);
}
