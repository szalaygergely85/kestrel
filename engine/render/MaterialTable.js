// US-028 rework (docs/backlog.md, architect review 1, programmer item 1):
// flattens the v2 shading data (`design/detail-pass.js`'s `sets`/`materials`)
// into typed arrays ONCE at bind time, so the per-cell hot path
// (`detailShade.js`'s `shadeDetailFast`) never does a string key lookup,
// `materials[key]`, `Map.get` or `Math.pow` (tech notes item 4/14).
//
// Two kinds of ids this module hands out:
//   - a small dense `Uint16` MATERIAL id per legend material key (unchanged
//     from before: `records[id]` also keeps the v1 key for `?detail=0`/the
//     reference-shader fallback and, when the key has a v2 counterpart, the
//     new `v2` field below);
//   - a small dense SET id (index into `table.sets`) for every glyph set
//     `design/detail-pass.js` defines - materials reference sets by this
//     numeric id (`face.near/mid/far`, `grid.gapSetId`, `overlay.setId`,
//     `speckle.setId`, `band.setId`), never by name, once bound.
//
// `v2` (`DetailMaterialRec`) holds only numbers/typed arrays - see the
// per-field comments below. Everything it needs from `DP.util`/`P.rgb` is
// resolved here, once; `detailShade.js` never calls into `design/` code.

import { buildPowLUT } from './fastShade.js';

const FACE_STR = [null, 'N', 'E', 'S', 'W', 'U', 'D']; // index = face code (GBuffer.js)
export const GAIN_LUT_SIZE = 256;

// --- glyph-set flattening --------------------------------------------------
// Reference shape (design/detail-pass.js section 4):
//   flat set:     ["<alts level1>", "<alts level2>", ...]
//   oriented set: { orient: 'u'|'v', dark: [...levels], fam: { h, v, d1, d2 } }
// Flattened SetRec (tech notes item 4): codes/altCount arrays hold ASCII-32
// char codes directly (so `out.glyphIdx` never needs a `<32||>126` check),
// `thresholds` is the level-index cut-point table baked at bind time (no
// `Math.pow`/cache lookup per cell - see `levelFast` in detailShade.js).
function stringsToCodes(strs, maxAlt) {
  const n = strs.length;
  const codes = new Uint8Array(n * maxAlt);
  const altCount = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = strs[i];
    altCount[i] = s.length;
    for (let j = 0; j < s.length; j++) codes[i * maxAlt + j] = s.charCodeAt(j) - 32;
  }
  return { codes, altCount };
}

function buildThresholds(levels, gamma) {
  const t = new Float64Array(levels);
  for (let k = 1; k < levels; k++) t[k] = Math.pow(k / levels, 1 / gamma);
  return t;
}

function buildSetRec(def, gamma) {
  if (def.orient) {
    const dark = def.dark, famH = def.fam.h, famV = def.fam.v, famD1 = def.fam.d1, famD2 = def.fam.d2;
    const nDark = dark.length, nFam = famH.length;
    let maxAlt = 1;
    for (const s of [...dark, ...famH, ...famV, ...famD1, ...famD2]) if (s.length > maxAlt) maxAlt = s.length;
    const darkFlat = stringsToCodes(dark, maxAlt);
    return {
      oriented: true,
      orientAxis: def.orient === 'u' ? 0 : 1,
      levels: nDark + nFam,
      nDark,
      maxAlt,
      thresholds: buildThresholds(nDark + nFam, gamma),
      darkCodes: darkFlat.codes, darkAltCount: darkFlat.altCount,
      fam: [stringsToCodes(famH, maxAlt), stringsToCodes(famV, maxAlt), stringsToCodes(famD1, maxAlt), stringsToCodes(famD2, maxAlt)],
    };
  }
  let maxAlt = 1;
  for (const s of def) if (s.length > maxAlt) maxAlt = s.length;
  const flat = stringsToCodes(def, maxAlt);
  return {
    oriented: false,
    orientAxis: 0,
    levels: def.length,
    nDark: def.length, // unused when !oriented
    maxAlt,
    thresholds: buildThresholds(def.length, gamma),
    codes: flat.codes, altCount: flat.altCount,
  };
}

const LINE_CODES = { '_': '_'.charCodeAt(0) - 32, '-': '-'.charCodeAt(0) - 32, '|': '|'.charCodeAt(0) - 32, '/': '/'.charCodeAt(0) - 32, '\\': '\\'.charCodeAt(0) - 32 };

function resolveColor(P, key) { return P.rgb[key]; }

function buildDetailMaterialRec(m, setIdByName, P, lodGates) {
  const rgb = P.rgb;
  const tones = m.tones;
  const toneRGB = new Float32Array(tones.length * 3);
  const toneW = new Float32Array(tones.length);
  let toneTotal = 0;
  for (let i = 0; i < tones.length; i++) {
    const c = resolveColor(P, tones[i][0]);
    toneRGB[i * 3] = c[0]; toneRGB[i * 3 + 1] = c[1]; toneRGB[i * 3 + 2] = c[2];
    toneW[i] = tones[i][1];
    toneTotal += tones[i][1];
  }

  let grid = null;
  if (m.grid) {
    const g = m.grid;
    grid = {
      u: g.u, v: g.v, stagger: g.stagger == null ? 0.5 : g.stagger,
      shade: g.shade == null ? 1 : g.shade,
      hasTint: !!g.tint, tintRGB: g.tint ? resolveColor(P, g.tint) : null,
      amount: g.amount == null ? 0.5 : g.amount,
      hasBgK: g.bgK != null, bgK: g.bgK == null ? 0 : g.bgK,
      hasCross: !!g.cross, crossCode: g.cross ? (g.cross.charCodeAt(0) - 32) : 0,
      maxCover: g.maxCover == null ? 0.5 : g.maxCover,
      tie: !!g.tie,
      lines: g.lines !== false,
      isGap: g.kind === 'gap',
      gapSetId: g.kind === 'gap' ? setIdByName(g.set) : -1,
    };
  }

  const near = setIdByName(m.face.set);
  const mid = m.face.mid ? setIdByName(m.face.mid) : near;
  const far = m.face.far ? setIdByName(m.face.far) : near;
  const bevel = m.face.bevel
    ? { top: m.face.bevel.top, topShade: m.face.bevel.topShade, bottom: m.face.bevel.bottom, bottomShade: m.face.bevel.bottomShade }
    : null;
  const gates = lodGates; // { bevel, band, overlay, speckle } max tier (inclusive), owner data

  let band = null;
  if (m.band) {
    const b = m.band;
    band = {
      isU: b.axis === 'u',
      period: b.period, width: b.width,
      setId: setIdByName(b.set),
      hasTone: !!b.tone, toneRGB: b.tone ? resolveColor(P, b.tone) : null,
      shade: b.shade,
      hasBgK: b.bgK != null, bgK: b.bgK == null ? 0 : b.bgK,
      edgeShade: b.edgeShade == null ? 0.5 : b.edgeShade,
    };
  }

  let overlay = null;
  if (m.overlay) {
    const o = m.overlay;
    const tintRGB = new Float32Array(o.tints.length * 3);
    for (let i = 0; i < o.tints.length; i++) {
      const c = resolveColor(P, o.tints[i]);
      tintRGB[i * 3] = c[0]; tintRGB[i * 3 + 1] = c[1]; tintRGB[i * 3 + 2] = c[2];
    }
    overlay = {
      setId: setIdByName(o.set),
      tintRGB, k: o.tints.length,
      amount: o.amount, shade: o.shade,
      hasBand: !!o.band, bandFull: o.band ? o.band.full : 0, bandZero: o.band ? o.band.zero : 0,
      joint: o.joint, face: o.face,
    };
  }

  const speckle = m.speckle ? { setId: setIdByName(m.speckle.set), chance: m.speckle.chance, shade: m.speckle.shade } : null;
  const lod = m.lod ? { mid: m.lod.mid, far: m.lod.far, dither: m.lod.dither || 0 } : null;

  return {
    albedo: m.albedo, bgK: m.bgK, seed: m.seed | 0, detail: m.detail || 16, jitter: m.jitter || 0, emissive: m.emissive || 0,
    toneRGB, toneW, toneTotal,
    grid, face: { near, mid, far }, bevel, band, overlay, speckle, lod,
    // Owner data (design/detail-pass.js `lodGates`), baked in at bind time
    // (US-028 D3): max LOD tier (inclusive) each feature still applies at.
    bevelGate: gates.bevel, bandGate: gates.band, overlayGate: gates.overlay, speckleGate: gates.speckle,
  };
}

/**
 * Builds the id table + flattened v2 shading data. Called from
 * `createEngine`, on resize (cellAspect) and when `?detail=0` toggles.
 * @param {object} P - `ASSETS.palette` (v1 materials, required)
 * @param {object|null} DP - `ASSETS.detailPass` (v2 materials), or null to
 *   force the v1-only path.
 * @param {number} cellAspect - `pxCellH/pxCellW`, for `orientClassFast`.
 */
export function bindShading(P, DP, cellAspect) {
  const idsByKey = new Map(); // bind-time only: never consulted per cell/sample
  const records = [null]; // id 0 = unresolved

  function idFor(key) {
    let id = idsByKey.get(key);
    if (id !== undefined) return id;
    let v1Key = key, v2Key = null;
    if (DP) {
      if (DP.materials[key]) { v2Key = key; v1Key = DP.materials[key].v1 || key; }
      else if (DP.remap[key]) { v2Key = DP.remap[key]; v1Key = key; }
    }
    id = records.length;
    records.push({ key, v1Key, v2Key, v2: null });
    idsByKey.set(key, id);
    return id;
  }

  for (const k of Object.keys(P.materials)) {
    if (P.materials[k].kind === 'sky') continue;
    idFor(k);
  }
  if (DP) for (const k of Object.keys(DP.materials)) idFor(k);

  // --- v2 flattening (tech notes item 4): sets, then materials -----------
  let sets = [];
  let faceK = new Float32Array(7);
  let gainLUT = null;
  let fog = null;
  let ao = { r: 0, k: 0 };
  let shading = null;

  if (DP) {
    const setIdByName = (() => {
      const m = new Map();
      return (name) => {
        let id = m.get(name);
        if (id !== undefined) return id;
        id = sets.length;
        sets.push(buildSetRec(DP.sets[name], DP.shading.gamma));
        m.set(name, id);
        return id;
      };
    })();

    for (const rec of records) {
      if (rec && rec.v2Key) rec.v2 = buildDetailMaterialRec(DP.materials[rec.v2Key], setIdByName, P, DP.lodGates);
    }

    for (let c = 1; c <= 6; c++) faceK[c] = DP.faceShade[FACE_STR[c]] != null ? DP.faceShade[FACE_STR[c]] : 1;

    gainLUT = buildPowLUT(GAIN_LUT_SIZE, DP.shading.fgGamma);

    if (DP.fog.curve !== 1) throw new Error('MaterialTable: DP.fog.curve must be 1 (linear) - see tech notes item 6');
    const fogSparse = stringsToCodes([DP.sets[DP.fog.set][0]], 2);
    const fogHaze = stringsToCodes([DP.sets[DP.fog.set][1]], 2);
    fog = {
      bgRGB: resolveColor(P, DP.fog.color), fgRGB: resolveColor(P, DP.fog.glyph),
      start: DP.fog.start, full: DP.fog.full,
      stipple0: DP.fog.stipple[0], stipple1: DP.fog.stipple[1],
      sparse: DP.fog.sparse == null ? 0.8 : DP.fog.sparse,
      sparseCodes: fogSparse.codes, sparseAlt: fogSparse.altCount[0],
      hazeCodes: fogHaze.codes, hazeAlt: fogHaze.altCount[0],
    };
    ao = { r: DP.ao.r, k: DP.ao.k };
    shading = {
      cutoff: DP.shading.cutoff, lift: DP.shading.lift, gamma: DP.shading.gamma,
      fgMin: DP.shading.fgMin, fgMaxGain: DP.shading.fgMaxGain, tint: DP.shading.tint,
      overbright: DP.shading.overbright, overbrightMax: DP.shading.overbrightMax,
      cellAspect,
    };
  }

  // US-029 tech notes item 1: `allV2` = every resolved material id has a v2
  // record - i.e. the GPU shade shader (which only implements the v2 path)
  // can cover every material this level uses. `?detail=0` sets `DP` to null
  // upstream (main.js), so `allV2` is false there too - the two switches
  // agree by construction, no separate check needed at the call site.
  let allV2 = !!DP;
  if (DP) for (let id = 1; id < records.length; id++) { if (records[id] && !records[id].v2) { allV2 = false; break; } }

  return { idFor, records, sets, faceK, gainLUT, fog, ao, shading, lineCodes: LINE_CODES, cellAspect, DP, P, allV2 };
}

/**
 * Bakes the numeric material id for every legend character's wall/floor/
 * ceil/upper material directly onto the (shared, legend-keyed) sector
 * objects (tech notes item 2) - `emitSample`'s callers then pass an id they
 * already have, no `idFor`/`Map.get` per emitted sample. Safe to call more
 * than once (idempotent) and safe to mutate: `Level.sectorAt` always
 * returns the SAME legend object for a given character, so this is a bind-
 * time cost, not a per-frame one.
 */
export function bindLevel(table, level) {
  for (const ch of Object.keys(level.legend)) {
    const s = level.legend[ch];
    s.wallMatId = table.idFor(s.wallMat);
    s.floorMatId = table.idFor(s.floorMat);
    s.ceilMatId = s.ceilMat !== 'sky' ? table.idFor(s.ceilMat) : 0;
    s.upperMatId = table.idFor(s.upperMat || s.wallMat);
  }
}
