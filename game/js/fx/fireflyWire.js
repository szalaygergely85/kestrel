// FIREFLY-NIGHT-01 (D-107 beauty, lane B1): night fireflies on the existing pooled particle system (engine/fx/particles.js),
// same shape as quest/ambient.js (one preset + ONE emitter). The emitter hops to a grass/forest/water-edge spot near the player
// (re-picked every RECHECK frames with a counter hash, no RNG) and is ON only while the night weight is > 0, outdoors.
// Day: emitter never on -> no spawns -> the particle RNG is never drawn -> day frames byte-identical. 0 alloc per step.
// Fade: spawns stop at dusk (weight < ON_W) and each firefly's own ramp fades in/out; life 4-7 s so the field thins in seconds.
// NEEDS B1-main: `fireflies = createFireflies(fireflyProbes(world, palette), engine.particles, {enabled: ...})` per 'world:loaded'
// (like ambientMotes, off on Low / ?ambient=0 / capture), `fireflies.step(px, py)` once per fixed step before particles.step(), dispose on reload.
import { sunFromWorld } from '../../../engine/index.js';

export const FIREFLY_PRESET = 'fireflies';
export const FIREFLY_COUNT = 40;     // emitter maxLive = the cap
export const RECHECK = 30;           // frames between spot re-picks
const ON_W = 0.2, SUN_LO = 0.3, SUN_HI = 0.7; // night weight = 1 - smoothstep(sunI), the NIGHT-SKY-01 window (skyNight.js)
const TRIES = 4, R_MIN = 4, R_MAX = 16, HOVER = 1.0;

const Y = [255, 226, 96], Yd = [150, 120, 40], D = [0, 0, 0];
/** Blinking ramp (stepped by age): dark, warm flash, dark, flash, ... */
export function fireflyEmitterDef() {
  return {
    rate: 9, maxLive: FIREFLY_COUNT, burst: 0, life: [4, 7], speed: [0.05, 0.25], dir: [0, 0, 1], spreadDeg: 85,
    box: [6, 6, 0.7], accelZ: 0, drag: 0.8, wind: 0.02, sizeM: 0.07, emissive: true, emissiveFog: 0, bgMix: 0.3,
    glyphs: '.', colors: [D, Yd, Y, Y, Yd, D, D, Yd, Y, Yd, D, D],
  };
}

const sm = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
export const nightWeightOf = (sunI) => 1 - sm(SUN_LO, SUN_HI, sunI);
function mix(a, b, c) { let h = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

/** Real-world probes (allocate once at load): sunI(), indoor(x,y), spot(x,y) -> ground z of a firefly-worthy spot or NaN. */
export function fireflyProbes(world, palette) {
  const sun = { dirX: 0, dirY: 0, dirZ: 0, ambientI: 0, sunI: 1 }, wtmp = {};
  const water = (x, y) => world.waterAt(x, y, wtmp);
  return {
    sunI: () => { sunFromWorld(world, palette, sun); return sun.sunI; },
    indoor: (x, y) => !!(world.structureAt && world.structureAt(x, y)) || !world.terrain,
    spot(x, y) {
      const t = world.terrain, nm = t.typeName(t.groundTypeAt(x, y));
      const wet = water(x, y) || water(x + 3, y) || water(x - 3, y) || water(x, y + 3) || water(x, y - 3);
      if (nm !== 'grass' && nm !== 'forest' && !wet) return NaN;
      return t.groundAt(x, y);
    },
  };
}

/** @param {{sunI():number, indoor(x,y):boolean, spot(x,y):number}} probes  @param {{enabled?:boolean}} [opts] */
export function createFireflies(probes, particles, opts = {}) {
  if (opts.enabled === false || !particles || !probes) return { step() {}, dispose() {}, handle: -1 };
  if (particles.defIdOf(FIREFLY_PRESET) < 0) particles.defineEmitter(FIREFLY_PRESET, fireflyEmitterDef());
  const handle = particles.createEmitter(particles.defIdOf(FIREFLY_PRESET), 0, 0, 0);
  let frame = 0, cnt = 0, on = false, disposed = false;
  return {
    handle,
    get on() { return on; },
    step(px, py) {
      if (disposed || handle < 0 || !Number.isFinite(px) || !Number.isFinite(py)) return;
      if ((frame++ % RECHECK) !== 0) return;
      let want = false;
      if (nightWeightOf(probes.sunI()) > ON_W && !probes.indoor(px, py)) {
        for (let k = 0; k < TRIES && !want; k++) {
          const c = cnt++;
          const a = mix(c, 1, 7) * 6.2831853, r = R_MIN + mix(c, 2, 7) * (R_MAX - R_MIN);
          const x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
          if (probes.indoor(x, y)) continue;
          const z = probes.spot(x, y);
          if (z === z) { particles.setEmitterPos(handle, x, y, z + HOVER); want = true; }
        }
      }
      if (want !== on) { particles.setOn(handle, want); on = want; }
    },
    dispose() { if (disposed) return; disposed = true; if (handle >= 0) particles.release(handle); },
  };
}
