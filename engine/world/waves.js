// engine/world/waves.js (US-143a, docs/architecture.md 35.1/35.2): the wave
// height field (4-wave spectrum, parabolic-sine "fake sine") + its clock.
//
// Rule 15 scope (RE-14, docs/architecture.md 28.5, tools/check-deps.mjs):
// this exact file is deterministic-sim code. No Math.sin/cos/tan/atan2/exp/
// pow/hypot, no Math.random, no Date.now/performance.now, anywhere below the
// "per-region compile" section - those are load-time only (35.1 explicitly
// allows trig + allocation there; `forwardOf` is the one place compass trig
// lives, same convention as wind.js). The per-step clock and the per-query
// samplers (`waveSampleInto`/`waveHeight`) use only +,-,*,/,Math.floor/abs/
// imul/sqrt and the integer tick - sqrt is fine (not in the banned list) and
// only runs at compile time anyway.
import { createRng } from '../core/rng.js';
import { forwardOf } from '../core/transform.js';
import { STEP } from '../core/loop.js';

/** One 4-wave spectrum, shared by every region (architecture.md 35.1, frozen verbatim). */
export const WAVE_SPECTRUM = Object.freeze([
  Object.freeze({ offDeg: 0, lambda: 24 }),
  Object.freeze({ offDeg: 25, lambda: 13 }),
  Object.freeze({ offDeg: -40, lambda: 6 }),
  Object.freeze({ offDeg: 70, lambda: 3 }),
]);

/** Named amplitude vectors (m) - a "state" is only an amplitude vector over the one shared spectrum (frozen verbatim). */
export const WAVE_STATES = Object.freeze({
  calm: Object.freeze([0.012, 0.009, 0.006, 0.003]),
  breezy: Object.freeze([0.05, 0.035, 0.022, 0.013]),
  storm: Object.freeze([0.24, 0.12, 0.06, 0.03]),
});

const N = WAVE_SPECTRUM.length; // 4
const ZERO_AMP = Object.freeze([0, 0, 0, 0]);

/** Amplitude vector for a named state. `"none"` is the implicit all-zero state (not in WAVE_STATES - 35.1 lists only calm/breezy/storm). */
export function ampsFor(state) {
  if (state === 'none') return ZERO_AMP;
  const a = WAVE_STATES[state];
  if (!a) throw new Error(`waves: unknown wave state "${state}" (none | calm | breezy | storm)`);
  return a;
}

/** 32-bit FNV-1a hash of a string (US-143a region phase seeding: `seed ^ fnv1a(id)`). Deterministic, no allocation beyond the call stack. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const _fwd = [0, 0];

/**
 * Compiles one region's wave row at LOAD time (35.1 "may use trig and allocate").
 * @param {{id:string, waveDirDeg?:number, seed?:number, waves?:string}} def
 * @param {string} seaState world sea state, used only when `def.waves === 'sea'`
 * @returns {{wk:Float64Array, wa:Float64Array, isSea:boolean}} wk = 16 doubles (4 waves x [kx,ky,om,phi]), wa = 4 doubles (amplitudes)
 */
export function compileRegion(def, seaState) {
  const dirDeg = typeof def.waveDirDeg === 'number' ? def.waveDirDeg : 0;
  const seed = typeof def.seed === 'number' ? def.seed : 1;
  const waves = def.waves || 'calm';
  const isSea = waves === 'sea';
  const amp = ampsFor(isSea ? (seaState || 'calm') : waves);

  const rngSeed = (seed ^ fnv1a(def.id)) >>> 0;
  const rng = createRng(rngSeed);
  const wk = new Float64Array(N * 4);
  for (let i = 0; i < N; i++) {
    const spec = WAVE_SPECTRUM[i];
    forwardOf(dirDeg + spec.offDeg, _fwd);
    const speed = Math.sqrt(9.81 * spec.lambda / (2 * Math.PI));
    const kx = _fwd[0] / spec.lambda;
    const ky = _fwd[1] / spec.lambda;
    const om = speed / spec.lambda;
    const phi = rng.nextFloat(); // 4 draws, spectrum order
    wk[i * 4 + 0] = kx;
    wk[i * 4 + 1] = ky;
    wk[i * 4 + 2] = om;
    wk[i * 4 + 3] = phi;
  }
  const wa = new Float64Array(N);
  for (let i = 0; i < N; i++) wa[i] = amp[i];
  return { wk, wa, isSea };
}

/**
 * Compiles every region's wk/wa rows (35.1 SoA layout: `wk: Float64Array(n*16)`, `wa: Float64Array(n*4)`).
 * @param {Array<{id:string, waveDirDeg?:number, seed?:number, waves?:string}>} defs
 * @param {string} seaState
 */
export function buildWaveTables(defs, seaState) {
  const n = defs.length;
  const wk = new Float64Array(n * N * 4);
  const wa = new Float64Array(n * N);
  const seaRegions = [];
  for (let i = 0; i < n; i++) {
    const c = compileRegion(defs[i], seaState);
    wk.set(c.wk, i * N * 4);
    wa.set(c.wa, i * N);
    if (c.isSea) seaRegions.push(i);
  }
  return { wk, wa, seaRegions: Int32Array.from(seaRegions) };
}

// ---- per-step clock (no trig, no Math.random, no wall clock below here) ----

/** Recomputes `seaAmp` from the current blend progress and writes it into every "sea" region's `wa` row. */
function applySeaAmp(c) {
  const s = c.seaSteps > 0 ? c.seaStep / c.seaSteps : 1;
  const ss = s * s * (3 - 2 * s); // smoothstep
  for (let k = 0; k < N; k++) c.seaAmp[k] = c.seaFrom[k] + (c.seaTo[k] - c.seaFrom[k]) * ss;
  for (let j = 0; j < c.seaRegions.length; j++) {
    const r = c.seaRegions[j];
    for (let k = 0; k < N; k++) c.wa[r * N + k] = c.seaAmp[k];
  }
}

/**
 * Attaches the wave clock (`wk`/`wa`/`tick` + the sea-state blend) directly onto `t` (`world.water`, the water
 * SoA returned by `createWater` - water.js). Mutates `t` in place (does NOT return a separate object to merge):
 * every closure below must read/write `t`'s own fields, since `t` IS the `wt` that `waveSampleInto`/`waveHeight`
 * (and the game) read as `world.water`.
 * @param {Object} t @param {Float64Array} wk @param {Float64Array} wa @param {Int32Array} seaRegions @param {string} seaState initial state
 * @returns {Object} `t`
 */
export function createWaveClock(t, wk, wa, seaRegions, seaState) {
  const amp0 = ampsFor(seaState || 'calm');
  const c = t; // local alias, same object as the parameter - kept short in the closures below
  c.wk = wk; c.wa = wa; c.seaRegions = seaRegions;
  c.tick = 0;
  c.seaAmp = Float64Array.from(amp0);
  c.seaFrom = Float64Array.from(amp0);
  c.seaTo = Float64Array.from(amp0);
  c.seaStep = 0;
  c.seaSteps = 0;

  /** Advances one fixed step (US-143a 35.2): increments `tick`, advances the sea blend. */
  c.step = function step() {
    c.tick++;
    if (c.seaSteps > 0 && c.seaStep < c.seaSteps) {
      c.seaStep++;
      applySeaAmp(c);
    }
  };

  /** Starts (or restarts) a smoothstep blend of the "sea" regions' amplitudes to `state`, over `blendSec`. No jump: `from` = the CURRENT live amp. */
  c.setSeaState = function setSeaState(state, blendSec) {
    const to = ampsFor(state);
    for (let k = 0; k < N; k++) { c.seaFrom[k] = c.seaAmp[k]; c.seaTo[k] = to[k]; }
    c.seaSteps = Math.max(1, Math.round((blendSec || 0) / STEP));
    c.seaStep = 0;
    applySeaAmp(c); // s=0 -> ss=0 -> amp stays at `from` (continuous)
  };

  /** Test-only hook (gpucompare, fixtures): pins `tick` without touching the sea blend. Never wall time. */
  c.setTickForTest = function setTickForTest(tick) { c.tick = tick | 0; };

  /** US-143a/35.8 save: `{tick, from[4], to[4], step, steps}`. */
  c.saveState = function saveState() {
    return { tick: c.tick, from: Array.from(c.seaFrom), to: Array.from(c.seaTo), step: c.seaStep, steps: c.seaSteps };
  };

  /** Restores a `saveState()` snapshot and re-applies the live amp (continuous bob across a load - no re-blend). */
  c.loadState = function loadState(s) {
    c.tick = s.tick | 0;
    c.seaFrom.set(s.from);
    c.seaTo.set(s.to);
    c.seaStep = s.step | 0;
    c.seaSteps = s.steps | 0;
    applySeaAmp(c);
  };

  /** Folds tick + the sea blend state into hasher `h` (RE-14 replay hash, 35.8). Zero allocation. */
  c.hashInto = function hashInto(h) {
    h.u32(c.tick >>> 0);
    for (let k = 0; k < N; k++) h.f64(c.seaFrom[k]);
    for (let k = 0; k < N; k++) h.f64(c.seaTo[k]);
    h.u32(c.seaStep >>> 0);
    h.u32(c.seaSteps >>> 0);
  };

  return c;
}

/**
 * Wave height + horizontal gradient at a world point, region `r` of `wt` (= `world.water`), at integer `tick`.
 * Normative formula (architecture.md 35.2, fract-based parabolic sine - no real sin/cos). Zero allocation.
 * @param {{wk:Float64Array, wa:Float64Array}} wt
 * @param {number} r region index
 * @param {number} x @param {number} y @param {number} tick
 * @param {{h:number, hx:number, hy:number}} out
 * @returns {{h:number, hx:number, hy:number}} `out`
 */
export function waveSampleInto(wt, r, x, y, tick, out) {
  const t = tick * STEP;
  const kbase = r * N * 4;
  const abase = r * N;
  let h = 0, hx = 0, hy = 0;
  for (let i = 0; i < N; i++) {
    const o = kbase + i * 4;
    const kx = wt.wk[o], ky = wt.wk[o + 1], om = wt.wk[o + 2], phi = wt.wk[o + 3];
    const A = wt.wa[abase + i];
    let u = kx * x + ky * y - om * t + phi;
    u = u - Math.floor(u); // fract
    const w = 2 * u - 1;
    const aw = w < 0 ? -w : w;
    const S = 4 * w * (1 - aw); // parabolic sine: C1, |S| <= 1
    const dS = 4 - 8 * aw;
    h += A * S;
    hx += A * dS * 2 * kx;
    hy += A * dS * 2 * ky;
  }
  out.h = h; out.hx = hx; out.hy = hy;
  return out;
}

/** Wave height only (no gradient) - the physics/`waterAt` fast path. Zero allocation. */
export function waveHeight(wt, r, x, y, tick) {
  const t = tick * STEP;
  const kbase = r * N * 4;
  const abase = r * N;
  let h = 0;
  for (let i = 0; i < N; i++) {
    const o = kbase + i * 4;
    const kx = wt.wk[o], ky = wt.wk[o + 1], om = wt.wk[o + 2], phi = wt.wk[o + 3];
    const A = wt.wa[abase + i];
    let u = kx * x + ky * y - om * t + phi;
    u = u - Math.floor(u);
    const w = 2 * u - 1;
    const aw = w < 0 ? -w : w;
    h += A * 4 * w * (1 - aw);
  }
  return h;
}
