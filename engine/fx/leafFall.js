// engine/fx/leafFall.js (WIND-GUST-01b): leaves shaken loose from nearby trees while a gust band passes over them.
// Rides the pooled particle system (like wadeSplash.js): no new GPU code, no new uniforms. Deterministic (pure function of
// the tick, tree set and wind field; no Math.random), zero alloc per step. Nothing spawns while the wind is calm (speed 0) or
// no band exceeds LEAF_FALL.gustK, so scenes without wind (and t = 0 of a still world) are unchanged.
import { STEP } from '../core/loop.js';

export const LEAF_FALL = Object.freeze({
  maxLive: 24,        // cap on live leaf particles (def maxLive)
  gustK: 0.72,        // gustBand (0..1) above which a tree sheds
  radiusM: 22,        // only trees this close to the player shed (they are the visible ones)
  everySteps: 12,     // spawn check cadence (5 Hz at 60 Hz)
  scanPerCheck: 768,  // trees examined per check (round-robin cursor, so cost is bounded for any forest size)
  crownM: 5,          // leaf release height above the trunk base
  perBurst: 2,
});
const KEY = 'leafFall';
const DEFAULT_LEAVES = [[150, 170, 70], [120, 150, 60], [190, 150, 60], [140, 100, 50]];

/** Defines the leaf emitter def. Idempotent. Returns the defId. look.colors: [r,g,b] ramp. */
export function defineLeafFall(particles, look = {}) {
  const colors = Array.isArray(look.colors) && look.colors.length ? look.colors : DEFAULT_LEAVES;
  return particles.defineEmitter(KEY, {
    life: [3.5, 5.5], speed: [0.8, 1.8], dir: [1, 0, -0.15], spreadDeg: 35, accelZ: -0.9, drag: 0.9,
    maxLive: LEAF_FALL.maxLive, glyphs: '`,.', colors, sizeM: 0.1, bgMix: 0,
  });
}

/**
 * Per-game leaf shedder. step() is called once per sim step.
 * @param {object} particles createParticles() instance
 * @param {(x:number,y:number,t:number,dirX:number,dirY:number,speed:number)=>number} gustBand wind.js gustBand (injected: fx/** may not import world/**, rule 16)
 * @returns {{step(trees:{count:number,x:Float64Array,y:Float64Array,z:Float64Array}|null, wind:any, px:number, py:number, tick:number):number, cursor:number}}
 */
export function createLeafFall(particles, gustBand) {
  const defId = particles.defIdOf(KEY);
  if (defId < 0) throw new Error('leafFall: call defineLeafFall(particles) first');
  const R2 = LEAF_FALL.radiusM * LEAF_FALL.radiusM;
  // The def's maxLive is per EMITTER (each burst is its own transient emitter), so the 24-leaf cap is kept here: a ring of the
  // spawn ticks of the bursts that can still be alive (life max 5.5 s).
  const cap = Math.floor(LEAF_FALL.maxLive / LEAF_FALL.perBurst), ring = new Int32Array(cap).fill(-1e9);
  const lifeSteps = Math.ceil(5.5 / STEP) + 2;
  let head = 0;
  const self = {
    cursor: 0,
    /** @returns {number} bursts spawned this call */
    step(trees, wind, px, py, tick) {
      if (!trees || !trees.count || !wind || !wind.params || !(wind.params.speed > 0)) return 0;
      if (tick % LEAF_FALL.everySteps !== 0) return 0;
      if (tick - ring[head] < lifeSteps) return 0; // oldest burst still alive -> pool of 24 full
      const { dirX, dirY, speed } = wind.params, n = trees.count, t = tick * STEP;
      const scan = n < LEAF_FALL.scanPerCheck ? n : LEAF_FALL.scanPerCheck;
      let i = self.cursor % n, spawned = 0;
      for (let k = 0; k < scan; k++, i = i + 1 === n ? 0 : i + 1) {
        const dx = trees.x[i] - px, dy = trees.y[i] - py;
        if (dx * dx + dy * dy > R2) continue;
        if (gustBand(trees.x[i], trees.y[i], t, dirX, dirY, speed) <= LEAF_FALL.gustK) continue;
        particles.burstAt(defId, trees.x[i], trees.y[i], trees.z[i] + LEAF_FALL.crownM, LEAF_FALL.perBurst, dirX, dirY, -0.15);
        ring[head] = tick; head = head + 1 === cap ? 0 : head + 1;
        spawned++;
        break; // one tree per check: the cap (24 live) is never a burst-sized spike
      }
      self.cursor = i;
      return spawned;
    },
  };
  return self;
}
