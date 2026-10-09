// engine/fx/hitSparks.js (HIT-SPARK-01). Sword-hit sparks on top of the pooled
// particle system (engine/fx/particles.js): no second pool. burstAt already
// takes an axis (the hit normal), a speed range, a life range and a spread
// cone (disk rejection, max angle = spreadDeg), so this is just presets + a
// call. Z is up. Deterministic (particles' own seeded stream), zero alloc.
// NOT wired into the game yet.

export const HIT_SPARK_CONE_DEG = 60;
export const HIT_SPARK_MAX_LIVE = 32; // per burst (emitter) cap
const KEY = 'hitSparks';

// Hue ramps: bright core -> ember. None ends in (or contains) pure white.
const HUES = [
  [[255, 232, 150], [255, 196, 70], [226, 128, 32], [120, 52, 20]],  // 0 white-gold (steel on stone)
  [[255, 170, 130], [240, 90, 60], [170, 40, 34], [80, 20, 24]],     // 1 red (flesh hit)
  [[170, 250, 240], [90, 220, 210], [30, 150, 140], [16, 70, 74]],   // 2 aether cyan
];
export const HIT_SPARK_HUES = HUES.length;

/**
 * Defines one emitter def per hue ('hitSparks0'..). Idempotent. Returns the defIds.
 * @param {object} particles createParticles() instance
 * @param {{coneDeg?:number, maxLive?:number, gravity?:number}} [opts]
 */
export function defineHitSparks(particles, opts = {}) {
  const ids = [];
  for (let h = 0; h < HUES.length; h++) {
    ids.push(particles.defineEmitter(KEY + h, {
      life: [0.25, 0.45], speed: [2, 5], dir: [0, 0, 1],
      spreadDeg: opts.coneDeg === undefined ? HIT_SPARK_CONE_DEG : opts.coneDeg,
      accelZ: opts.gravity === undefined ? -9 : -Math.abs(opts.gravity),
      maxLive: opts.maxLive === undefined ? HIT_SPARK_MAX_LIVE : opts.maxLive,
      burst: 12, emissive: true, glyphs: '*+:.', colors: HUES[h],
    }));
  }
  return ids;
}

/** Spawns a spark burst at (x,y,z) around the hit normal (nx,ny,nz; need not be unit). No alloc. */
export function hitSparks(particles, x, y, z, nx, ny, nz, count, hueIndex = 0) {
  const id = particles.defIdOf(KEY + ((hueIndex | 0) % HUES.length + HUES.length) % HUES.length);
  if (id < 0) throw new Error('hitSparks: call defineHitSparks(particles) first');
  particles.burstAt(id, x, y, z, count, nx, ny, nz);
}
