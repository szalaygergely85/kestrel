// game/js/quest/gustView.js (SPELL-07b): Gust presentation. 'gust:cast' -> a short cone of wind streaks (`~ - '`) in front of the
// caster (0.3-0.4 s, start offsets spread over the tier's range, 30 deg half angle like the sim); 'combat:hit' with cause 'wind' -> a
// small grass/leaf puff on the hit beast. Existing particle system only; sim side (`stepFx` right after gustSim.step), hashed.
// Colours: palette key 'gust' (passed as `rgb` map, [r,g,b] 0..255); the raw blues below are only the fallback when no palette is given.
// 0 allocation per cast/step: pending queues are typed arrays; the listener copies numbers (the sim reuses its payload objects).
const MAX_PEND = 4;
const STREAK_DEFAULT = [[235, 245, 255], [190, 220, 240], [150, 190, 220]];
const PUFF_COLORS = [[150, 190, 80], [110, 160, 70], [190, 170, 80]];
const SEG_AT = [0.08, 0.22, 0.38]; // streak group start, as a fraction of the cast range (the group then flies <= ~4 m)
const SEG_N = 6;                   // streaks per group (18 per cast)
const PUFF_N = 7;

/** Defines the two emitter defs. Idempotent. */
export function defineGustFx(particles, rgb) {
  const g = rgb && rgb.gust, mix = (t) => [Math.round(g[0] + (255 - g[0]) * t), Math.round(g[1] + (255 - g[1]) * t), Math.round(g[2] + (255 - g[2]) * t)];
  const STREAK_COLORS = g ? [mix(0.5), g, [Math.round(g[0] * 0.8), Math.round(g[1] * 0.86), Math.round(g[2] * 0.92)]] : STREAK_DEFAULT;
  particles.defineEmitter('gustStreak', { life: [0.3, 0.4], speed: [9, 13], dir: [1, 0, 0], spreadDeg: 26, accelZ: 0, drag: 1.2,
    maxLive: 24, glyphs: "~-'", colors: STREAK_COLORS, sizeM: 0.16, bgMix: 0 });
  particles.defineEmitter('gustPuff', { life: [0.5, 0.8], speed: [1.2, 2.6], dir: [0, 0, 1], spreadDeg: 60, accelZ: -3, drag: 1.5,
    maxLive: 12, glyphs: "`,.", colors: PUFF_COLORS, sizeM: 0.1, bgMix: 0 });
}

/** @param {{particles:any, events:any}} o  events = engine.events */
export function createGustView({ particles, events }) {
  const defStreak = particles.defIdOf('gustStreak'), defPuff = particles.defIdOf('gustPuff');
  const cast = { n: 0, x: new Float64Array(MAX_PEND), y: new Float64Array(MAX_PEND), z: new Float64Array(MAX_PEND), fx: new Float64Array(MAX_PEND), fy: new Float64Array(MAX_PEND), range: new Float64Array(MAX_PEND) };
  const puff = { n: 0, x: new Float64Array(MAX_PEND * 4), y: new Float64Array(MAX_PEND * 4), z: new Float64Array(MAX_PEND * 4), dx: new Float64Array(MAX_PEND * 4), dy: new Float64Array(MAX_PEND * 4) };
  const stats = { casts: 0, puffs: 0 };
  const offCast = events.on('gust:cast', (p) => {
    stats.casts++;
    if (cast.n >= MAX_PEND) return;
    const k = cast.n++;
    cast.x[k] = p.x; cast.y[k] = p.y; cast.z[k] = p.z; cast.fx[k] = p.fx; cast.fy[k] = p.fy; cast.range[k] = p.range;
  });
  const offHit = events.on('combat:hit', (p) => {
    if (p.cause !== 'wind' || puff.n >= puff.x.length) return;
    stats.puffs++;
    const k = puff.n++;
    puff.x[k] = p.px; puff.y[k] = p.py; puff.z[k] = p.pz; puff.dx[k] = p.dirX; puff.dy[k] = p.dirY;
  });
  return {
    stats,
    /** SIM side, right after gustSim.step. */
    stepFx() {
      for (let k = 0; k < cast.n; k++) {
        const fx = cast.fx[k], fy = cast.fy[k];
        for (let s = 0; s < SEG_AT.length; s++) {
          const d = 0.4 + SEG_AT[s] * cast.range[k];
          particles.burstAt(defStreak, cast.x[k] + fx * d, cast.y[k] + fy * d, cast.z[k] - 0.25, SEG_N, fx, fy, 0);
        }
      }
      cast.n = 0;
      for (let k = 0; k < puff.n; k++) particles.burstAt(defPuff, puff.x[k], puff.y[k], puff.z[k], PUFF_N, puff.dx[k] * 0.6, puff.dy[k] * 0.6, 1);
      puff.n = 0;
    },
    dispose() { offCast(); offHit(); },
  };
}
