// engine/entities/tintEnvelope.js - TELEGRAPH-TINT-01. Pure, zero-alloc tint
// envelopes (windup / hit / hurt). NOT wired: no render path takes a per-entity
// tint yet (see docs/lanes/pc-b2.md). `tMs` is ELAPSED ms since the envelope start.
export const TINT_NAMES = ['windup', 'hit', 'hurt'];
const WINDUP_RGB = [1, 0.55, 0.1], HIT_RGB = [1, 1, 1], HURT_RGB = [1, 0.1, 0.1];
const FLICKER_PERIOD_MS = 500; // 2 Hz
const FLICKER_LOW = 0.7;       // deterministic square flicker: 1 for the first half period, 0.7 for the second

function put(out, c, k) { out.r = c[0]; out.g = c[1]; out.b = c[2]; out.k = k; return out; }

/**
 * @param {{name:string, windupSec?:number}} env
 * @param {number} tMs elapsed ms since start
 * @param {{r:number,g:number,b:number,k:number}} [out] reused object (zero-alloc)
 */
export function tintAt(env, tMs, out) {
  out = out || { r: 0, g: 0, b: 0, k: 0 };
  const t = tMs > 0 ? tMs : 0;
  switch (env.name) {
    case 'windup': {
      const T = (env.windupSec > 0 ? env.windupSec : 1) * 1000;
      if (t < T) { const u = t / T; return put(out, WINDUP_RGB, u * u); } // accelerating
      const ph = (t - T) % FLICKER_PERIOD_MS;
      return put(out, WINDUP_RGB, ph < FLICKER_PERIOD_MS / 2 ? 1 : FLICKER_LOW);
    }
    case 'hit':
      return put(out, HIT_RGB, t < 80 ? 1 : t < 200 ? 1 - (t - 80) / 120 : 0);
    case 'hurt':
      return put(out, HURT_RGB, t < 300 ? 0.6 * (1 - t / 300) : 0);
    default:
      return put(out, HIT_RGB, 0);
  }
}

/** Per-entity component `tint`: starts envelope `name` at absolute `startMs`. */
export function setTint(entity, name, startMs, windupSec) {
  const c = entity.components || (entity.components = {});
  const t = c.tint || (c.tint = { name: '', startMs: 0, windupSec: 1 });
  t.name = name; t.startMs = startMs; if (windupSec > 0) t.windupSec = windupSec;
  return t;
}

/** Samples the entity's tint at absolute `nowMs`; k=0 when none. */
export function sampleTint(entity, nowMs, out) {
  const t = entity.components && entity.components.tint;
  if (!t || !t.name) return put(out || (out = { r: 0, g: 0, b: 0, k: 0 }), HIT_RGB, 0);
  return tintAt(t, nowMs - t.startMs, out);
}
