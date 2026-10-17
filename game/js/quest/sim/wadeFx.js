// US-055a (architecture.md 38.47): wade splash + leg ripples. Presentation only (not saved, not hashed).
// main.js calls step(entity, timeSec) right after wading.after(...); arrows.js calls arrowHit on a water landing.
// Reads body.wadeImm (set by wading.before), body.vx/vy and the transform. Zero alloc per step.
import { WADE_SPLASH, wadeSplashAt, arrowSplashAt } from '../../../../engine/index.js';

export function createWadeFx(particles, ripples, cfg = WADE_SPLASH) {
  let prevImm = 0, tick = 0;
  return {
    step(entity, timeSec) {
      const body = entity.components.body, t = entity.transform;
      const imm = typeof body.wadeImm === 'number' ? body.wadeImm : 0;
      const vx = body.vx || 0, vy = body.vy || 0, sp = Math.sqrt(vx * vx + vy * vy);
      if (prevImm <= 0 && imm > 0 && sp > cfg.entrySpeed) {
        wadeSplashAt(particles, t.x, t.y, t.z + imm, Math.min(1, sp / 6));
        ripples.add(t.x, t.y, 0.8, timeSec);
        tick = 0;
      } else if (imm > 0 && sp > 0.3) {
        if (++tick >= cfg.ringPeriodSteps) { tick = 0; ripples.add(t.x, t.y, cfg.ringAmp, timeSec); }
      } else tick = 0;
      prevImm = imm;
    },
    arrowHit(x, y, z, timeSec) {
      arrowSplashAt(particles, x, y, z);
      ripples.add(x, y, 0.5, timeSec);
    },
  };
}
