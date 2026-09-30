// engine/core/hash.js (RE-14, docs/architecture.md 28.5).
//
// Stateful, zero-allocation 32-bit FNV-1a hasher over little-endian bytes.
// Used to build the sim state hash (rng + every registered part's
// hashInto, in registration order) for replay checkpoints and, later,
// lockstep desync detection.

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193; // 16777619

// Module-level scratch for h.f64: one Float64Array(1) and a Uint32Array(2)
// view over the same buffer, so hashing a float never allocates. Shared
// across all hasher instances - safe because JS is single-threaded and
// h.f64 finishes writing/reading the scratch before returning.
const F64_SCRATCH = new Float64Array(1);
const U32_SCRATCH = new Uint32Array(F64_SCRATCH.buffer);

/** Creates a new stateful FNV-1a hasher. */
export function createHasher() {
  const h = { _h: FNV_OFFSET_BASIS >>> 0 };

  /** Resets the running hash to the FNV-1a offset basis. */
  h.reset = function reset() {
    h._h = FNV_OFFSET_BASIS >>> 0;
    return h;
  };

  /** Mixes one byte in (FNV-1a step). */
  h._byte = function _byte(b) {
    h._h = (h._h ^ (b & 0xff)) >>> 0;
    h._h = Math.imul(h._h, FNV_PRIME) >>> 0;
  };

  /** Mixes a u32, little-endian byte order. */
  h.u32 = function u32(x) {
    const v = x >>> 0;
    h._byte(v & 0xff);
    h._byte((v >>> 8) & 0xff);
    h._byte((v >>> 16) & 0xff);
    h._byte((v >>> 24) & 0xff);
    return h;
  };

  /** Mixes an i32 (same bit pattern as u32, reinterpreted). */
  h.i32 = function i32(x) {
    return h.u32(x | 0);
  };

  /** Mixes the IEEE-754 bit pattern of a double: lo word, then hi word. */
  h.f64 = function f64(x) {
    F64_SCRATCH[0] = x;
    h.u32(U32_SCRATCH[0]);
    h.u32(U32_SCRATCH[1]);
    return h;
  };

  /** Mixes a Uint8Array (or Int8Array) range [start, end). */
  h.u8Array = function u8Array(a, start = 0, end = a.length) {
    for (let i = start; i < end; i++) h._byte(a[i]);
    return h;
  };

  /** Mixes a Uint32Array (or Int32Array) range [start, end), each word
   * little-endian. */
  h.u32Array = function u32Array(a, start = 0, end = a.length) {
    for (let i = start; i < end; i++) h.u32(a[i]);
    return h;
  };

  /** @returns {number} the current hash as a u32. */
  h.value = function value() {
    return h._h >>> 0;
  };

  return h;
}
