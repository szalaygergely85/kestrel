// engine/fx/ripples.js (S8-B2-13b, docs/architecture.md 38.14 - the note of record; supersedes the dropped
// PC-B note's `world.water` ring buffer, see architecture.md 38.16a). Pure, presentation-only splash ripples:
// cosmetic fx, same family as engine/fx/particles.js. Not world DATA (engine/world/water.js stays immutable
// region content) and not render state (render never holds gameplay-fed state, it reads a packed snapshot per
// frame via `packInto`). Not saved, not hashed, no effect on the sim. engine/fx stays a leaf: no imports here
// beyond this module itself.
export const RIPPLE_LIFE = 2.0; // seconds, a ring's total lifetime
export const RIPPLE_SPEED = 1.2; // m/s, ring expansion speed
export const RIPPLE_W = 0.35; // m, the ring band width

/**
 * @param {{cap?: number}} [opts]
 * @returns {{
 *   cap: number,
 *   add(x: number, y: number, amp: number, timeSec: number): boolean,
 *   packInto(timeSec: number, out: Float32Array): number,
 *   clear(): void,
 * }}
 */
export function createRipples({ cap = 8 } = {}) {
  if (!(Number.isInteger(cap) && cap >= 1)) throw new Error(`createRipples: cap must be a positive integer, got ${cap}`);
  // Ring buffer (SoA). t0 (f64, seconds) is the sentinel: a never-used slot has t0 = -Infinity, so
  // `timeSec - t0` is +Infinity (always >= RIPPLE_LIFE) and packInto skips it without a separate liveness flag.
  const x = new Float64Array(cap), y = new Float64Array(cap);
  const t0 = new Float64Array(cap).fill(-Infinity);
  const amp = new Float32Array(cap);
  let head = 0; // next slot to write; the (cap+1)th add overwrites slot 0 again

  return {
    cap,
    /**
     * Adds a splash ripple at ground point (x east, y south, world metres), amp clamped to [0,1], timed off
     * `timeSec` (the clock the renderer gets, `fb.timeSec`). Non-finite x/y/amp/timeSec: returns false and
     * writes nothing. Zero allocation.
     * @param {number} px @param {number} py @param {number} a @param {number} timeSec @returns {boolean}
     */
    add(px, py, a, timeSec) {
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(a) || !Number.isFinite(timeSec)) return false;
      const i = head;
      x[i] = px; y[i] = py; t0[i] = timeSec;
      amp[i] = a < 0 ? 0 : a > 1 ? 1 : a;
      head = (i + 1) % cap;
      return true;
    },
    /**
     * Packs the live rings (0 <= age < RIPPLE_LIFE) densely into `out` (Float32Array, >= cap*4 long): per ring,
     * x, y, age (= timeSec - t0, computed in f64 before the f32 store, so precision holds over hours of play),
     * amp. Zero allocation.
     * @param {number} timeSec @param {Float32Array} out @returns {number} live ring count
     */
    packInto(timeSec, out) {
      let n = 0;
      for (let i = 0; i < cap; i++) {
        const age = timeSec - t0[i];
        if (!(age >= 0) || age >= RIPPLE_LIFE) continue;
        const b = n * 4;
        out[b] = x[i]; out[b + 1] = y[i]; out[b + 2] = age; out[b + 3] = amp[i];
        n++;
      }
      return n;
    },
    /** Drops every live ring (not a reset of `cap`/the arrays' contents, just liveness). Zero allocation. */
    clear() {
      t0.fill(-Infinity);
      head = 0;
    },
  };
}
