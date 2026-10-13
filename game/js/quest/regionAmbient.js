// game/js/quest/regionAmbient.js (WMP-03): per-region ambient life. Reads the player's world_geo region at ~1 Hz and cross-fades,
// over FADE_S seconds (linear, monotonic, no pops), (a) fauna density multipliers (scales each species' spawn `cap` in the
// compiled fauna def - wild.fauna def.species objects, same mutation style as wildEnv GROUND_START) and (b) ambient
// sound-cue volumes handed to `onCue(id, vol)`. Data: content/life/regionAmbient.json. A region with no entry targets mul 1 /
// vol 0, and species caps are written back to their exact base value at mul 1 -> identical to the behaviour without this module.
// Cue ids missing from `knownCues` are never sent to onCue; they are listed by needsAudioLines() (`NEEDS AUDIO:`). 0 alloc in step.
// NEEDS B1-main: wire `ra = createRegionAmbient({...}); ra.step(dt, px, py)` after wild.step, with an onCue that sets bed gains.
import { regionIdAt } from './regionBanner.js';

export const FADE_S = 1, CHECK_S = 1;

/** @param {{regions:Array, table:{regions:Object}, species:Array<{name:string,cap:number}>, knownCues?:string[], onCue?:Function}} o */
export function createRegionAmbient({ regions, table, species, knownCues = [], onCue = null }) {
  const entries = (table && table.regions) || {};
  const known = new Set(knownCues);
  const spN = species.length, base = new Int32Array(spN);
  const spIdx = new Map();
  for (let i = 0; i < spN; i++) { base[i] = species[i].cap; spIdx.set(species[i].name, i); }
  const cueIds = [], cueIdx = new Map(), missing = [], unknownKinds = [];
  for (const rid of Object.keys(entries)) {
    const e = entries[rid];
    for (const c of Object.keys(e.cues || {})) if (!cueIdx.has(c)) { cueIdx.set(c, cueIds.length); cueIds.push(c); if (!known.has(c)) missing.push(c); }
    for (const k of Object.keys(e.fauna || {})) if (!spIdx.has(k) && !unknownKinds.includes(k)) unknownKinds.push(k);
  }
  const cN = cueIds.length;
  const mul = new Float64Array(spN).fill(1), mulFrom = new Float64Array(spN).fill(1), mulTo = new Float64Array(spN).fill(1);
  const vol = new Float64Array(cN), volFrom = new Float64Array(cN), volTo = new Float64Array(cN);
  const cueKnown = new Uint8Array(cN);
  for (let i = 0; i < cN; i++) cueKnown[i] = known.has(cueIds[i]) ? 1 : 0;
  let curRegion = null, fadeT = FADE_S, checkT = CHECK_S; // checkT starts full: the first step resolves the region

  // precomputed per-region targets (retarget allocates nothing)
  const tg = new Map();
  for (const rid of Object.keys(entries)) {
    const e = entries[rid], m = new Float64Array(spN).fill(1), v = new Float64Array(cN);
    for (const k of Object.keys(e.fauna || {})) { const i = spIdx.get(k); if (i !== undefined) m[i] = e.fauna[k]; }
    for (const k of Object.keys(e.cues || {})) v[cueIdx.get(k)] = e.cues[k];
    tg.set(rid, { m, v });
  }
  const ONES = new Float64Array(spN).fill(1), ZEROS = new Float64Array(cN);

  function retarget(rid) {
    const t = tg.get(rid);
    const m = t ? t.m : ONES, v = t ? t.v : ZEROS;
    for (let i = 0; i < spN; i++) { mulFrom[i] = mul[i]; mulTo[i] = m[i]; }
    for (let i = 0; i < cN; i++) { volFrom[i] = vol[i]; volTo[i] = v[i]; }
    fadeT = 0;
  }

  function apply() {
    // mul === 1 -> exact base cap; otherwise rounded, min 0
    for (let i = 0; i < spN; i++) species[i].cap = mul[i] === 1 ? base[i] : Math.max(0, Math.round(base[i] * mul[i]));
    if (onCue) for (let i = 0; i < cN; i++) if (cueKnown[i]) onCue(cueIds[i], vol[i]);
  }

  return {
    step(dt, px, py) {
      checkT += dt;
      if (checkT >= CHECK_S) {
        checkT = 0;
        const rid = regionIdAt(regions, px, py);
        if (rid !== curRegion) { curRegion = rid; retarget(rid); }
      }
      if (fadeT >= FADE_S) return; // settled
      fadeT += dt;
      const k = fadeT >= FADE_S ? 1 : fadeT / FADE_S;
      for (let i = 0; i < spN; i++) mul[i] = k === 1 ? mulTo[i] : mulFrom[i] + (mulTo[i] - mulFrom[i]) * k;
      for (let i = 0; i < cN; i++) vol[i] = k === 1 ? volTo[i] : volFrom[i] + (volTo[i] - volFrom[i]) * k;
      apply();
    },
    region: () => curRegion,
    mul: (name) => { const i = spIdx.get(name); return i === undefined ? 1 : mul[i]; },
    vol: (id) => { const i = cueIdx.get(id); return i === undefined ? 0 : vol[i]; },
    missingCues: () => missing.slice(),
    unknownKinds: () => unknownKinds.slice(),
    needsAudioLines: () => missing.map((c) => 'NEEDS AUDIO: ' + c),
  };
}
