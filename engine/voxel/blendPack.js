// engine/voxel/blendPack.js - ANIM-BLEND-01a (architecture.md 38.68 section 2): `def.blend` validator + load-time packer.
// Cold path (read by validateVoxelModel / packVoxelModel); the per-frame layer maths lives in voxelPose.js.
// Imports nothing. Same code for voxel and RIG-00 rigged defs (needs only def.parts / def.animations / def.legRig).
//
// def.blend = { sets?: {name: {param:'speed', clips:[{clip, at}]}},
//               fades?: {default?, into?: {clip: ms}, pairs?: {'a>b': ms}},
//               additive?: {name: {clip, parts:[part], inMs, outMs, gain?}} }

export const BLEND_FADE_DEFAULT_MS = 150;
export const BLEND_FADE_MAX_MS = 400;
export const BLEND_NONE = 0xFFFF;
const TOP_KEYS = ['sets', 'fades', 'additive'];
const SET_KEYS = ['param', 'clips'];
const FADE_KEYS = ['default', 'into', 'pairs'];
const ADD_KEYS = ['clip', 'parts', 'inMs', 'outMs', 'gain'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function checkKeys(o, allowed, path, errors) {
  for (const k of Object.keys(o)) if (allowed.indexOf(k) < 0) errors.push(`${path}: unknown key '${k}'`);
}
function checkMs(v, path, errors) {
  if (!isNum(v) || v < 0 || v > BLEND_FADE_MAX_MS) errors.push(`${path}: expected ms in [0, ${BLEND_FADE_MAX_MS}]`);
}

/** Pushes one string per problem of `def.blend` into `errors` (never throws). */
export function validateBlend(def, partNames, errors) {
  const P = 'voxel.blend';
  const b = def.blend;
  if (!isObj(b)) { errors.push(`${P}: expected an object`); return; }
  checkKeys(b, TOP_KEYS, P, errors);
  const anims = isObj(def.animations) ? def.animations : {};
  const hasClip = (n) => typeof n === 'string' && Object.prototype.hasOwnProperty.call(anims, n);
  const legParts = new Set();
  if (isObj(def.legRig) && Array.isArray(def.legRig.legs)) for (const l of def.legRig.legs) { if (l) { legParts.add(l.upper); legParts.add(l.lower); } }

  if (b.sets !== undefined) {
    if (!isObj(b.sets)) errors.push(`${P}.sets: expected an object`);
    else {
      const used = new Set();
      for (const name of Object.keys(b.sets)) {
        const s = b.sets[name], sp = `${P}.sets['${name}']`;
        if (!isObj(s)) { errors.push(`${sp}: expected an object`); continue; }
        checkKeys(s, SET_KEYS, sp, errors);
        if (s.param !== 'speed') errors.push(`${sp}.param: expected 'speed'`);
        if (!Array.isArray(s.clips) || s.clips.length < 2 || s.clips.length > 4) { errors.push(`${sp}.clips: expected 2..4 entries`); continue; }
        let prev = -Infinity;
        s.clips.forEach((c, i) => {
          const cp = `${sp}.clips[${i}]`;
          if (!isObj(c)) { errors.push(`${cp}: expected {clip, at}`); return; }
          checkKeys(c, ['clip', 'at'], cp, errors);
          if (!hasClip(c.clip)) errors.push(`${cp}.clip: unknown clip '${c.clip}'`);
          else {
            if (!anims[c.clip].loop) errors.push(`${cp}.clip: '${c.clip}' must loop`);
            if (used.has(c.clip)) errors.push(`${cp}.clip: '${c.clip}' is already in a set`);
            used.add(c.clip);
          }
          if (!isNum(c.at) || c.at < 0) errors.push(`${cp}.at: expected a number >= 0`);
          else { if (c.at <= prev) errors.push(`${cp}.at: must be strictly increasing`); prev = c.at; }
        });
      }
    }
  }

  if (b.fades !== undefined) {
    const f = b.fades, fp = `${P}.fades`;
    if (!isObj(f)) errors.push(`${fp}: expected an object`);
    else {
      checkKeys(f, FADE_KEYS, fp, errors);
      if (f.default !== undefined) checkMs(f.default, `${fp}.default`, errors);
      if (f.into !== undefined) {
        if (!isObj(f.into)) errors.push(`${fp}.into: expected an object`);
        else for (const c of Object.keys(f.into)) {
          if (!hasClip(c)) errors.push(`${fp}.into: unknown clip '${c}'`);
          checkMs(f.into[c], `${fp}.into['${c}']`, errors);
        }
      }
      if (f.pairs !== undefined) {
        if (!isObj(f.pairs)) errors.push(`${fp}.pairs: expected an object`);
        else for (const k of Object.keys(f.pairs)) {
          const parts = k.split('>');
          if (parts.length !== 2 || !hasClip(parts[0]) || !hasClip(parts[1])) errors.push(`${fp}.pairs: bad key '${k}' (want 'from>to' with known clips)`);
          checkMs(f.pairs[k], `${fp}.pairs['${k}']`, errors);
        }
      }
    }
  }

  if (b.additive !== undefined) {
    if (!isObj(b.additive)) errors.push(`${P}.additive: expected an object`);
    else for (const name of Object.keys(b.additive)) {
      const a = b.additive[name], ap = `${P}.additive['${name}']`;
      if (!isObj(a)) { errors.push(`${ap}: expected an object`); continue; }
      checkKeys(a, ADD_KEYS, ap, errors);
      if (!hasClip(a.clip)) errors.push(`${ap}.clip: unknown clip '${a.clip}'`);
      else if (anims[a.clip].loop) errors.push(`${ap}.clip: '${a.clip}' must not loop`);
      if (!Array.isArray(a.parts) || a.parts.length < 1) errors.push(`${ap}.parts: expected a non-empty part list`);
      else a.parts.forEach((pn) => {
        if (partNames.indexOf(pn) < 0) errors.push(`${ap}.parts: unknown part '${pn}'`);
        else if (legParts.has(pn)) errors.push(`${ap}.parts: '${pn}' is a legRig upper/lower part (the leg solve owns it)`);
      });
      checkMs(a.inMs, `${ap}.inMs`, errors);
      checkMs(a.outMs, `${ap}.outMs`, errors);
      if (a.gain !== undefined && !isNum(a.gain)) errors.push(`${ap}.gain: expected a number`);
    }
  }
}

/**
 * Packs `def.blend` (already valid) against the packed model `pm` (needs pm.clips / pm.clipIndex / pm.partCount; names via `partNames`).
 * Returns null without `def.blend`.
 */
export function packBlend(def, pm, partNames) {
  const b = def.blend;
  if (!b) return null;
  const nClips = pm.clips.length, ci = pm.clipIndex;
  // sets: flat tables, setStart[s]..setStart[s+1] indexes setClip/setAt; setOf[clip] = set index (-1 none)
  const sets = b.sets || {}, setNames = Object.keys(sets);
  let total = 0;
  for (const n of setNames) total += sets[n].clips.length;
  const setStart = new Uint8Array(setNames.length + 1), setClip = new Int16Array(total), setAt = new Float64Array(total);
  const setOf = new Int8Array(nClips).fill(-1);
  let k = 0;
  setNames.forEach((n, si) => {
    setStart[si] = k;
    for (const c of sets[n].clips) { setClip[k] = ci[c.clip]; setAt[k] = c.at; setOf[ci[c.clip]] = si; k++; }
  });
  setStart[setNames.length] = k;
  // fades
  const f = b.fades || {};
  const fadeInto = new Uint16Array(nClips).fill(BLEND_NONE), fadePair = new Uint16Array(nClips * nClips).fill(BLEND_NONE);
  if (f.into) for (const c of Object.keys(f.into)) fadeInto[ci[c]] = Math.round(f.into[c]);
  if (f.pairs) for (const key of Object.keys(f.pairs)) { const [a, c] = key.split('>'); fadePair[ci[a] * nClips + ci[c]] = Math.round(f.pairs[key]); }
  // additive: delta clips (keys minus frame 0) shaped like pm.clips entries so the pose sampler reuses the clip sampler
  const adds = b.additive || {}, addNames = Object.keys(adds), pc = pm.partCount;
  const addClips = [], addMask = new Uint16Array(addNames.length), addIn = new Float64Array(addNames.length);
  const addOut = new Float64Array(addNames.length), addGain = new Float64Array(addNames.length);
  addNames.forEach((n, i) => {
    const a = adds[n], src = pm.clips[ci[a.clip]], stride = pc * 6;
    const keys = new Float64Array(src.keys.length);
    for (let fr = 0; fr < src.n; fr++) for (let j = 0; j < stride; j++) keys[fr * stride + j] = src.keys[fr * stride + j] - src.keys[j];
    let totMs = 0; for (let i = 0; i < src.n; i++) totMs += src.durMs[i];
    addClips.push({ name: src.name, n: src.n, loop: false, step: src.step, durMs: src.durMs, totMs, keys, tagCodes: src.tagCodes });
    let m = 0;
    for (const pn of a.parts) m |= 1 << partNames.indexOf(pn);
    addMask[i] = m; addIn[i] = a.inMs; addOut[i] = a.outMs; addGain[i] = a.gain === undefined ? 1 : a.gain;
  });
  return {
    setNames, setStart, setClip, setAt, setOf,
    fadeDefault: f.default === undefined ? BLEND_FADE_DEFAULT_MS : f.default, fadeInto, fadePair,
    addNames, addClips, addMask, addIn, addOut, addGain,
  };
}
