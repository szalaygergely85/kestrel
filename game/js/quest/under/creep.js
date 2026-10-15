// UNDER-LIGHT-CREEP-01 (OB-191): creepy underground feel from EXISTING systems only. Pure logic, no engine edits.
//  - a per-ambience table (keys = level meta `ambience`: crypt, cave = bear den / goblin tunnel / strand cave, cellar = Ford cellar)
//  - weight w (0..1) eases in/out over FADE_STEPS sim steps (<= 1 s at 60 Hz); outdoors w stays 0 and `out` is neutral.
//  - outputs (reused object, 0 alloc per step): ambientScale (<=1, multiply the lightSet ambient), flickerMul (>=1, multiply torch
//    flicker.amount), mist (0..1, multiply/lerp the post mist alpha toward the site mist), motes (emitter on/off, cap 12, existing particles).
//  - quality 'low': no motes, mist halved, flicker/ambient kept (cheap); `enabled:false` (?creep=0) = always neutral.
// NEEDS B1-main: see docs/lanes/pc-b1.md (UNDER-LIGHT-CREEP-01).
export const MOTES_CAP = 12, FADE_STEPS = 45; // 0.75 s at 60 Hz
export const CREEP_MOTES_PRESET = 'creepMotes';
/** Data per level ambience. flickerMul scales the palette torch flicker (0.15 -> ~0.27 in the crypt); ambient 1 = unchanged. */
export const CREEP_SITES = Object.freeze({
  crypt:  Object.freeze({ ambient: 0.62, flickerMul: 1.8, mist: 1.0, motes: 1.0 }),
  cave:   Object.freeze({ ambient: 0.74, flickerMul: 1.5, mist: 0.35, motes: 0.8 }),
  cellar: Object.freeze({ ambient: 0.8,  flickerMul: 1.4, mist: 0.2, motes: 0.6 }),
});
const NEUTRAL = Object.freeze({ ambient: 1, flickerMul: 1, mist: 0, motes: 0 });

/** Slow warm dust: dim, drifting, long life, box around the player; maxLive = MOTES_CAP. */
export function creepMotesDef(rgb) {
  const col = Array.isArray(rgb) && Array.isArray(rgb[0]) ? rgb[0] : [214, 180, 130];
  return {
    rate: 1.2, maxLive: MOTES_CAP, burst: 0, life: [10, 16], speed: [0.02, 0.07], dir: [0, 0, 1], spreadDeg: 85,
    box: [2.5, 2.5, 1.4], accelZ: 0, drag: 0.2, wind: 0.02, sizeM: 0.012, emissive: false, emissiveFog: 0,
    glyphs: '.', colors: [col],
  };
}
/** Flicker def for a level light: the palette torch flicker with amount scaled by `flickerMul` (use when registering level lights). */
export function creepFlicker(base, mul) {
  return base ? { hzMin: base.hzMin, hzMax: base.hzMax, jitter: base.jitter, amount: base.amount * mul } : base;
}

/** @param {object} particles createParticles() instance (may be null) @param {{enabled?:boolean, quality?:string, rgb?:Array}} [opts] */
export function createUnderCreep(particles, opts = {}) {
  const enabled = opts.enabled !== false, low = opts.quality === 'low';
  const out = { w: 0, ambientScale: 1, flickerMul: 1, mist: 0, motesOn: false };
  let w = 0, handle = -1, site = NEUTRAL, motesOn = false;
  if (enabled && !low && particles) {
    if (particles.defIdOf(CREEP_MOTES_PRESET) < 0) particles.defineEmitter(CREEP_MOTES_PRESET, creepMotesDef(opts.rgb));
    const id = particles.defIdOf(CREEP_MOTES_PRESET);
    if (id >= 0) { handle = particles.createEmitter(id, 0, 0, 0); if (handle >= 0) particles.setOn(handle, false); }
  }
  return {
    out, handle,
    /** Once per sim step. `ambience` = world.structureAt(p)?.level?.ambience (or null outdoors). */
    step(ambience, px, py, pz) {
      const s = (enabled && ambience && CREEP_SITES[ambience]) || null;
      if (s) site = s;
      const target = s ? 1 : 0, d = 1 / FADE_STEPS;
      w = w < target ? Math.min(target, w + d) : Math.max(target, w - d);
      if (w === 0) { site = NEUTRAL; out.w = 0; out.ambientScale = 1; out.flickerMul = 1; out.mist = 0; out.motesOn = false; }
      else {
        out.w = w; out.ambientScale = 1 - w * (1 - site.ambient); out.flickerMul = 1 + w * (site.flickerMul - 1);
        out.mist = w * site.mist * (low ? 0.5 : 1); out.motesOn = handle >= 0 && site.motes > 0;
      }
      if (handle >= 0) {
        if (out.motesOn) particles.setEmitterPos(handle, px, py, pz);
        if (out.motesOn !== motesOn) { motesOn = out.motesOn; particles.setOn(handle, motesOn); }
      }
    },
    dispose() { if (handle >= 0 && particles) particles.release(handle); handle = -1; },
  };
}

/** Main wiring helper (R6-FIX B: absolute, not ratio). `st` = {amb:1, fl:1}: the scales currently applied (1 = lightSet holds the BASE values).
 *  When a scale leaves 1 the base ambient / flicker values are captured; every frame writes base * scale, and when the scale is 1 again the
 *  captured base bytes are written back EXACTLY (no A*s*(1/s) drift). Call `st.amb = 1` right after anything rewrites lightSet.ambient (hour step):
 *  the next frame then re-captures the new base. Lights added while inside (index >= captured count) are never touched. No-op when lightSet is null. */
export function applyCreepLights(lightSet, out, st) {
  if (!lightSet) return;
  const sa = out.ambientScale;
  if (sa !== st.amb) {
    const A = lightSet.ambient, B = st.ba || (st.ba = new Float32Array(3));
    if (st.amb === 1) { B[0] = A[0]; B[1] = A[1]; B[2] = A[2]; } // leaving 1: capture the base
    if (sa === 1) { A[0] = B[0]; A[1] = B[1]; A[2] = B[2]; } else { A[0] = B[0] * sa; A[1] = B[1] * sa; A[2] = B[2] * sa; }
    st.amb = sa;
  }
  const sf = out.flickerMul;
  if (sf !== st.fl) {
    const F = lightSet.flickerAmount;
    if (st.fl === 1) { // leaving 1: capture the base amounts of the lights that exist now
      if (!st.bf || st.bf.length < F.length) st.bf = new Float32Array(F.length);
      st.bn = Math.min(lightSet.count, F.length);
      for (let i = 0; i < st.bn; i++) st.bf[i] = F[i];
    }
    const n = Math.min(st.bn, lightSet.count, F.length), B = st.bf;
    if (sf === 1) for (let i = 0; i < n; i++) F[i] = B[i]; else for (let i = 0; i < n; i++) F[i] = B[i] * sf;
    st.fl = sf;
  }
}
/** Post mist density for this frame: base * (1 + 1.5*creep), capped 0.2; base 0 (no mist preset) stays 0. */
export const creepMistDensity = (base, creepMist) => (base > 0 ? Math.min(0.2, base * (1 + 1.5 * creepMist)) : base);

/** (c) once-per-site-per-session chill cue: first(key) is true the first time a non-null key is seen (key = structure id/name, else ambience). */
export function createFirstEntry() { const seen = new Set(); return { first(key) { if (key == null || seen.has(key)) return false; seen.add(key); return true; } }; }
