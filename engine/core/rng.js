// engine/core/rng.js (RE-14, docs/architecture.md 28.5).
//
// Deterministic sim RNG: xoshiro128** over a Uint32Array(4) state, seeded by
// splitmix32 from a single u32. Integer ops only (Math.imul, >>>, |, ^) so
// the stream is bit-identical across platforms/JS engines - a requirement
// for replay and (later) lockstep networking. One sim stream is owned by the
// game sim and drawn only inside fixed steps, in slot/cell order;
// presentation code (particles, idle anims) must use its own separate
// stream, never this one (28.5 "Do not").

/** @param {number} x @returns {number} rotl32(x, k) */
function rotl(x, k) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** splitmix32: one step, advances `state.s` and returns the output word.
 * Used only to seed the four xoshiro128** words from a single u32 seed. */
function splitmix32Next(state) {
  state.s = (state.s + 0x9e3779b9) >>> 0;
  let z = state.s;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  z = (z ^ (z >>> 15)) >>> 0;
  return z >>> 0;
}

/**
 * Creates a deterministic RNG stream. `seed` is coerced to a u32.
 * @param {number} seed
 */
export function createRng(seed) {
  const sm = { s: seed >>> 0 };
  const s = new Uint32Array(4);
  s[0] = splitmix32Next(sm);
  s[1] = splitmix32Next(sm);
  s[2] = splitmix32Next(sm);
  s[3] = splitmix32Next(sm);

  const rng = { s };

  /** xoshiro128** next u32. */
  rng.nextU32 = function nextU32() {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;

    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;

    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);

    return result >>> 0;
  };

  /** Exact float in [0,1), 24 bits of precision (matches Number's mantissa
   * granularity for values in [0,1) without ever rounding up to 1). */
  rng.nextFloat = function nextFloat() {
    return (rng.nextU32() >>> 8) / 16777216;
  };

  /** Uniform integer in [0, n). Throws if n > 2^24 (nextFloat's precision
   * ceiling) or n <= 0. */
  rng.int = function int(n) {
    if (!(n > 0)) throw new Error(`rng.int: n must be > 0, got ${n}`);
    if (n > 16777216) throw new Error(`rng.int: n (${n}) exceeds 2^24 precision limit`);
    return Math.floor(rng.nextFloat() * n);
  };

  /** @returns {number[]} a plain 4-element array snapshot of the state. */
  rng.save = function save() {
    return [s[0], s[1], s[2], s[3]];
  };

  /** Restores state from a `save()`-shaped array. */
  rng.load = function load(a) {
    s[0] = a[0] >>> 0;
    s[1] = a[1] >>> 0;
    s[2] = a[2] >>> 0;
    s[3] = a[3] >>> 0;
  };

  /** Folds the current state into hasher `h` (engine/core/hash.js), in fixed
   * word order. Zero allocation. */
  rng.hashInto = function hashInto(h) {
    h.u32(s[0]);
    h.u32(s[1]);
    h.u32(s[2]);
    h.u32(s[3]);
  };

  return rng;
}
