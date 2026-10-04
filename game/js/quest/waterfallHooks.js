// US-142a2: presentation-only waterfall spray and expanding rings, fixed 60 Hz.
// Construct after particles.clear(); step before particles.step(), afterStep after it.
import { DEG2RAD } from '../../../engine/index.js';
export function createWaterfallHooks(world, particles, cfg) {
  const falls = world && world.waterfalls || [];
  const handles = new Int32Array(falls.length * 4).fill(-1);
  const footX = new Float64Array(falls.length), footY = new Float64Array(falls.length);
  const footZ = new Float64Array(falls.length), ringFall = new Int16Array(64).fill(-1);
  const cos = new Float64Array(cfg.ripple.points), sin = new Float64Array(cfg.ripple.points);
  for (let i = 0; i < cos.length; i++) {
    const a = i * Math.PI * 2 / cos.length; cos[i] = Math.cos(a); sin[i] = Math.sin(a);
  }
  const keys = ['waterfallLip', 'waterfallSpray', 'waterfallMist', 'waterfallRipple'];
  const ringDef = particles.defIdOf(keys[3]);
  let tick = 0, disposed = false;
  for (let i = 0; i < falls.length; i++) {
    const f = falls[i], x = (f.lip[0] + f.lip[2]) / 2, y = (f.lip[1] + f.lip[3]) / 2;
    const tau = Math.sqrt(f.drop / 4.9), a = f.outDeg * DEG2RAD;
    footX[i] = x + Math.sin(a) * f.out * tau;
    footY[i] = y - Math.cos(a) * f.out * tau; footZ[i] = f.z - f.drop;
    for (let k = 0; k < 4; k++) {
      const h = particles.createEmitter(particles.defIdOf(keys[k]), k === 0 ? x : footX[i],
        k === 0 ? y : footY[i], k === 0 ? f.z : footZ[i] + (k === 3 ? cfg.ripple.height : 0.04));
      handles[i * 4 + k] = h;
      if (k < 3) particles.setOn(h, true);
      else if (h >= 0) ringFall[h & 63] = i;
    }
  }
  return {
    footX, footY, footZ, handles,
    step() {
      if (disposed || falls.length === 0) return;
      // Sweep the lip splash across its width with one persistent emitter.
      for (let i = 0; i < falls.length; i++) {
        const f = falls[i], u = (tick % 60) / 59;
        particles.setEmitterPos(handles[i * 4], f.lip[0] + (f.lip[2] - f.lip[0]) * u,
          f.lip[1] + (f.lip[3] - f.lip[1]) * u, f.z);
        if (tick % cfg.ripple.periodTicks === 0) particles.burst(handles[i * 4 + 3], cfg.ripple.points);
      }
      tick++;
    },
    afterStep() {
      if (disposed || falls.length === 0 || ringDef < 0) return;
      for (let p = 0; p < particles.cap; p++) {
        if (!particles.alive[p] || particles.def[p] !== ringDef) continue;
        const i = ringFall[particles.em[p]];
        if (i < 0) continue;
        const r = cfg.ripple.startRadius + particles.age[p] * cfg.ripple.speed / 60;
        const a = p % cos.length;
        particles.px[p] = footX[i] + cos[a] * r;
        particles.py[p] = footY[i] + sin[a] * r;
        particles.pz[p] = footZ[i] + cfg.ripple.height;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (let i = 0; i < handles.length; i++) particles.release(handles[i]);
    },
  };
}
