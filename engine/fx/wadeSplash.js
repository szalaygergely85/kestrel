// engine/fx/wadeSplash.js (US-055a, architecture.md 38.47). Wade-entry / arrow-splash droplets on the pooled
// particle system (engine/fx/particles.js): no second pool, no new GPU code (particleLayer reads the pool for both
// twins). Same pattern as hitSparks.js. Rings are engine/fx/ripples.js, fed by the game hook (wadeFx.js).
// Z is up. Deterministic (the particles' own seeded stream), zero alloc per call.

export const WADE_SPLASH = Object.freeze({
  maxLive: 64, entryMin: 6, entryMax: 10, arrowN: 4,
  entrySpeed: 1.0, // m/s horizontal speed needed to splash on entering water
  ringPeriodSteps: 24, // 0.4 s at 60 Hz
  ringAmp: 0.4,
});
const KEY = 'wadeSplash';
const DEFAULT_FOAM = [[245, 250, 255], [214, 234, 248], [170, 206, 230], [110, 150, 190]];

/**
 * Defines the droplet emitter def. Idempotent. Returns the defId.
 * @param {object} particles createParticles() instance
 * @param {{foam?: number[][]}} [look] foam colour ramp ([r,g,b] bright -> dim); default a light blue-white ramp
 */
export function defineWadeSplash(particles, look = {}) {
  const colors = Array.isArray(look.foam) && look.foam.length ? look.foam : DEFAULT_FOAM;
  return particles.defineEmitter(KEY, {
    life: [0.5, 0.7], speed: [1.2, 2.4], dir: [0, 0, 1], spreadDeg: 50, accelZ: -9.8,
    maxLive: WADE_SPLASH.maxLive, glyphs: ".',", colors, sizeM: 0.12,
  });
}

function defId(particles) {
  const id = particles.defIdOf(KEY);
  if (id < 0) throw new Error('wadeSplash: call defineWadeSplash(particles) first');
  return id;
}

/** Entry splash at (x, y, z = water surface). speed01 0..1 scales the droplet count entryMin..entryMax. */
export function wadeSplashAt(particles, x, y, z, speed01) {
  const s = speed01 < 0 ? 0 : speed01 > 1 ? 1 : speed01;
  const n = WADE_SPLASH.entryMin + Math.round(s * (WADE_SPLASH.entryMax - WADE_SPLASH.entryMin));
  particles.burstAt(defId(particles), x, y, z, n, 0, 0, 1);
}

/** Arrow-into-water splash: arrowN droplets. */
export function arrowSplashAt(particles, x, y, z) {
  particles.burstAt(defId(particles), x, y, z, WADE_SPLASH.arrowN, 0, 0, 1);
}
