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
