// US-029 tech notes item 3 / architecture.md 14.1 section 3: packs the
// already-flattened `MaterialTable.js` output (records[i].v2, table.sets)
// into the exact typed-array slot layout the GLSL shade/edge shaders read
// with `texelFetch`. Pure JS - no `gl` - so this is Node-testable
// (ShadeTextures.test.js unpacks every slot and deep-equals it against the
// source record).
//
// Layout (normative, architecture.md 14.1 section 3):
//   MAT_F  RGBA32F, width 32, row = material id (0 unused)
//   MAT_I  RGBA32I, width 4,  row = material id
//   SET_I  RGBA32I, width 64, row = set id
//   SET_F  R32F,    width 32, row = set id (thresholds[k])
//   GAIN   R32F,    256x1 = table.gainLUT

export const MAT_F_WIDTH = 32;
export const MAT_I_WIDTH = 4;
export const SET_I_WIDTH = 64;
export const SET_F_WIDTH = 32;
export const GAIN_WIDTH = 256;

export const MAX_TONES = 4;
export const MAX_LEVELS = 32;
export const MAX_TINTS = 8;
export const MAX_ALT = 8; // maxAlt observed in the content pack never exceeds this; asserted below is generous

// flags bit order (architecture.md 14.1 section 3), LSB first.
export const F_HAS_GRID = 1 << 0;
export const F_GRID_TINT = 1 << 1;
export const F_GRID_BGK = 1 << 2;
export const F_GRID_CROSS = 1 << 3;
export const F_GRID_TIE = 1 << 4;
export const F_GRID_LINES = 1 << 5;
export const F_GRID_GAP = 1 << 6;
export const F_HAS_BEVEL = 1 << 7;
export const F_HAS_BAND = 1 << 8;
export const F_BAND_IS_U = 1 << 9;
export const F_BAND_TONE = 1 << 10;
export const F_BAND_BGK = 1 << 11;
export const F_HAS_OVERLAY = 1 << 12;
export const F_OV_BAND = 1 << 13;
export const F_HAS_SPECKLE = 1 << 14;
export const F_HAS_LOD = 1 << 15;

function assert(cond, msg) { if (!cond) throw new Error('ShadeTextures: ' + msg); }

// Packs 8-bit-per-char codes (already ASCII-32, from MaterialTable's
// `stringsToCodes`) into a little-endian 4-byte word: codes[0] in byte 0
// (LSB) .. codes[3] in byte 3. Two words (lo, hi) cover up to 8 codes.
function packCodes4(codes, offset, count) {
  let w = 0;
  for (let k = 0; k < 4; k++) {
    const c = k < count ? codes[offset + k] : 0;
    w |= (c & 0xff) << (k * 8);
  }
  return w >>> 0;
}

// --- SET_I / SET_F packing --------------------------------------------------
// Entry order (architecture.md 14.1 section 3): flat set -> `levels` entries;
// oriented set -> `nDark` dark entries, then `nFam` entries per fam class in
// order h, v, d1, d2 (fam class c, level li -> entry `nDark + c*nFam + li`).
function packSet(setRec, setIRow, setFRow) {
  const oriented = setRec.oriented ? 1 : 0;
  const orientAxis = setRec.orientAxis | 0;
  const levels = setRec.levels | 0;
  const nDark = setRec.oriented ? setRec.nDark | 0 : 0;
  const nFam = setRec.oriented ? setRec.fam[0].altCount.length : 0;
  assert(levels <= MAX_LEVELS, `set: levels ${levels} > ${MAX_LEVELS}`);
  const nEntries = setRec.oriented ? nDark + 4 * nFam : levels;
  assert(nEntries <= SET_I_WIDTH - 2, `set: ${nEntries} entries > ${SET_I_WIDTH - 2}`);

  setIRow[0] = oriented; setIRow[1] = orientAxis; setIRow[2] = levels; setIRow[3] = nDark;
  setIRow[4] = setRec.maxAlt; setIRow[5] = nFam; setIRow[6] = 0; setIRow[7] = 0;

  function writeEntry(entryIdx, codes, altCount, maxAlt, li) {
    const base = (2 + entryIdx) * 4;
    const cnt = altCount[li];
    setIRow[base + 0] = cnt;
    setIRow[base + 1] = packCodes4(codes, li * maxAlt, Math.min(4, cnt));
    setIRow[base + 2] = packCodes4(codes, li * maxAlt + 4, Math.max(0, Math.min(4, cnt - 4)));
    setIRow[base + 3] = 0;
  }

  if (!setRec.oriented) {
    for (let li = 0; li < levels; li++) writeEntry(li, setRec.codes, setRec.altCount, setRec.maxAlt, li);
  } else {
    for (let li = 0; li < nDark; li++) writeEntry(li, setRec.darkCodes, setRec.darkAltCount, setRec.maxAlt, li);
    for (let c = 0; c < 4; c++) {
      const fam = setRec.fam[c];
      for (let li = 0; li < nFam; li++) writeEntry(nDark + c * nFam + li, fam.codes, fam.altCount, setRec.maxAlt, li);
    }
  }

  for (let k = 0; k < levels && k < SET_F_WIDTH; k++) setFRow[k] = setRec.thresholds[k];
}

// --- MAT_F / MAT_I packing --------------------------------------------------
function packMaterial(rec, matFRow, matIRow, setIdOf) {
  assert(rec.toneRGB.length / 3 <= MAX_TONES, `material: tones ${rec.toneRGB.length / 3} > ${MAX_TONES}`);
  const g = rec.grid, bevel = rec.bevel, band = rec.band, overlay = rec.overlay, speckle = rec.speckle, lod = rec.lod;
  if (overlay) assert(overlay.k <= MAX_TINTS, `material: overlay tints ${overlay.k} > ${MAX_TINTS}`);

  let flags = 0;
  if (g) {
    flags |= F_HAS_GRID;
    if (g.hasTint) flags |= F_GRID_TINT;
    if (g.hasBgK) flags |= F_GRID_BGK;
    if (g.hasCross) flags |= F_GRID_CROSS;
    if (g.tie) flags |= F_GRID_TIE;
    if (g.lines) flags |= F_GRID_LINES;
    if (g.isGap) flags |= F_GRID_GAP;
  }
  if (bevel) flags |= F_HAS_BEVEL;
  if (band) {
    flags |= F_HAS_BAND;
    if (band.isU) flags |= F_BAND_IS_U;
    if (band.hasTone) flags |= F_BAND_TONE;
    if (band.hasBgK) flags |= F_BAND_BGK;
  }
  if (overlay) {
    flags |= F_HAS_OVERLAY;
    if (overlay.hasBand) flags |= F_OV_BAND;
  }
  if (speckle) flags |= F_HAS_SPECKLE;
  if (lod) flags |= F_HAS_LOD;

  // slot 0
  matFRow[0 * 4 + 0] = rec.albedo; matFRow[0 * 4 + 1] = rec.bgK; matFRow[0 * 4 + 2] = rec.detail; matFRow[0 * 4 + 3] = rec.jitter;
  // slot 1
  matFRow[1 * 4 + 0] = rec.emissive; matFRow[1 * 4 + 1] = rec.toneTotal;
  matFRow[1 * 4 + 2] = lod ? lod.mid : 0; matFRow[1 * 4 + 3] = lod ? lod.far : 0;
  // slot 2
  matFRow[2 * 4 + 0] = lod ? lod.dither : 0;
  matFRow[2 * 4 + 1] = g ? g.u : 0; matFRow[2 * 4 + 2] = g ? g.v : 0; matFRow[2 * 4 + 3] = g ? g.stagger : 0;
  // slot 3
  matFRow[3 * 4 + 0] = g ? g.shade : 1; matFRow[3 * 4 + 1] = g ? g.amount : 0;
  matFRow[3 * 4 + 2] = g ? g.bgK : 0; matFRow[3 * 4 + 3] = g ? g.maxCover : 0.5;
  // slot 4
  if (g && g.hasTint) { matFRow[4 * 4 + 0] = g.tintRGB[0]; matFRow[4 * 4 + 1] = g.tintRGB[1]; matFRow[4 * 4 + 2] = g.tintRGB[2]; }
  matFRow[4 * 4 + 3] = 0;
  // slot 5
  if (bevel) {
    matFRow[5 * 4 + 0] = bevel.top; matFRow[5 * 4 + 1] = bevel.topShade;
    matFRow[5 * 4 + 2] = bevel.bottom; matFRow[5 * 4 + 3] = bevel.bottomShade;
  }
  // slot 6
  if (band) {
    matFRow[6 * 4 + 0] = band.period; matFRow[6 * 4 + 1] = band.width;
    matFRow[6 * 4 + 2] = band.shade; matFRow[6 * 4 + 3] = band.hasBgK ? band.bgK : 0;
  }
  // slot 7
  if (band) {
    if (band.hasTone) { matFRow[7 * 4 + 0] = band.toneRGB[0]; matFRow[7 * 4 + 1] = band.toneRGB[1]; matFRow[7 * 4 + 2] = band.toneRGB[2]; }
    matFRow[7 * 4 + 3] = band.edgeShade;
  }
  // slot 8
  if (overlay) {
    matFRow[8 * 4 + 0] = overlay.amount; matFRow[8 * 4 + 1] = overlay.shade;
    matFRow[8 * 4 + 2] = overlay.hasBand ? overlay.bandFull : 0; matFRow[8 * 4 + 3] = overlay.hasBand ? overlay.bandZero : 0;
  }
  // slot 9
  if (overlay) { matFRow[9 * 4 + 0] = overlay.joint; matFRow[9 * 4 + 1] = overlay.face; }
  if (speckle) { matFRow[9 * 4 + 2] = speckle.chance; matFRow[9 * 4 + 3] = speckle.shade; }
  // slots 10-13: tone[t] rgb + toneW[t]
  const nTones = rec.toneRGB.length / 3;
  for (let t = 0; t < nTones; t++) {
    const s = 10 + t;
    matFRow[s * 4 + 0] = rec.toneRGB[t * 3]; matFRow[s * 4 + 1] = rec.toneRGB[t * 3 + 1];
    matFRow[s * 4 + 2] = rec.toneRGB[t * 3 + 2]; matFRow[s * 4 + 3] = rec.toneW[t];
  }
  // slots 14-21: overlay.tint[k] rgb
  if (overlay) {
    for (let k = 0; k < overlay.k; k++) {
      const s = 14 + k;
      matFRow[s * 4 + 0] = overlay.tintRGB[k * 3]; matFRow[s * 4 + 1] = overlay.tintRGB[k * 3 + 1];
      matFRow[s * 4 + 2] = overlay.tintRGB[k * 3 + 2]; matFRow[s * 4 + 3] = 0;
    }
  }

  // MAT_I
  matIRow[0 * 4 + 0] = rec.seed | 0; matIRow[0 * 4 + 1] = flags; matIRow[0 * 4 + 2] = nTones; matIRow[0 * 4 + 3] = overlay ? overlay.k : 0;
  matIRow[1 * 4 + 0] = setIdOf(rec.face.near); matIRow[1 * 4 + 1] = setIdOf(rec.face.mid);
  matIRow[1 * 4 + 2] = setIdOf(rec.face.far); matIRow[1 * 4 + 3] = g && g.isGap ? setIdOf(g.gapSetId) : (g ? g.gapSetId : -1);
  matIRow[2 * 4 + 0] = g && g.hasCross ? g.crossCode : 0;
  matIRow[2 * 4 + 1] = band ? setIdOf(band.setId) : -1;
  matIRow[2 * 4 + 2] = overlay ? setIdOf(overlay.setId) : -1;
  matIRow[2 * 4 + 3] = speckle ? setIdOf(speckle.setId) : -1;
  matIRow[3 * 4 + 0] = rec.bevelGate; matIRow[3 * 4 + 1] = rec.bandGate; matIRow[3 * 4 + 2] = rec.overlayGate; matIRow[3 * 4 + 3] = rec.speckleGate;
}

/**
 * @param {ReturnType<import('../MaterialTable.js').bindShading>} table
 * @returns {{matF:Float32Array, matI:Int32Array, setI:Int32Array, setF:Float32Array,
 *   gain:Float32Array, dims:object, uniforms:object}}
 */
export function packMaterialTable(table) {
  const records = table.records;
  const nMat = records.length; // id 0 = unresolved, row unused
  const sets = table.sets;
  const nSet = sets.length;

  const matF = new Float32Array(MAT_F_WIDTH * nMat * 4);
  const matI = new Int32Array(MAT_I_WIDTH * nMat * 4);
  const setI = new Int32Array(SET_I_WIDTH * nSet * 4);
  const setF = new Float32Array(SET_F_WIDTH * nSet);
  for (let i = 0; i < matI.length; i++) matI[i] = -1; // absent ids default to -1, not 0 (0 is a valid set id)

  const setIdOf = (id) => (id == null ? -1 : id);

  for (let s = 0; s < nSet; s++) {
    packSet(sets[s], setI.subarray(s * SET_I_WIDTH * 4, (s + 1) * SET_I_WIDTH * 4), setF.subarray(s * SET_F_WIDTH, (s + 1) * SET_F_WIDTH));
  }
  for (let id = 1; id < nMat; id++) {
    const rec = records[id];
    if (!rec || !rec.v2) continue;
    packMaterial(rec.v2, matF.subarray(id * MAT_F_WIDTH * 4, (id + 1) * MAT_F_WIDTH * 4), matI.subarray(id * MAT_I_WIDTH * 4, (id + 1) * MAT_I_WIDTH * 4), setIdOf);
  }

  const gain = new Float32Array(GAIN_WIDTH);
  for (let i = 0; i < GAIN_WIDTH; i++) gain[i] = table.gainLUT[i];

  const shading = table.shading, fog = table.fog, ao = table.ao;
  const edges = table.DP ? table.DP.edges : null;
  const uniforms = {
    shading, fog, ao, faceK: table.faceK,
    edges: edges ? {
      fogMax: edges.fogMax,
      ruleGlyph: ['cap', 'lip', 'side', 'convex', 'concave', 'seamFloor', 'seamCeil', 'nosing']
        .map((n) => edges.rules[n].glyph.charCodeAt(0) - 32),
      ruleGain: ['cap', 'lip', 'side', 'convex', 'concave', 'seamFloor', 'seamCeil', 'nosing']
        .map((n) => edges.rules[n].gain),
    } : null,
    cellAspect: table.cellAspect,
  };

  return {
    matF, matI, setI, setF, gain,
    dims: { matFWidth: MAT_F_WIDTH, matIWidth: MAT_I_WIDTH, setIWidth: SET_I_WIDTH, setFWidth: SET_F_WIDTH, gainWidth: GAIN_WIDTH, nMat, nSet },
    uniforms,
  };
}

// --- unpack helpers (test-only: verify a packed slot round-trips) ---------
export function unpackSetEntry(setI, setFWidth /* unused */, row, entryIdx, width = SET_I_WIDTH) {
  const base = row * width * 4 + (2 + entryIdx) * 4;
  const altCount = setI[base + 0];
  const lo = setI[base + 1] >>> 0, hi = setI[base + 2] >>> 0;
  const codes = new Uint8Array(8);
  for (let k = 0; k < 4; k++) codes[k] = (lo >>> (k * 8)) & 0xff;
  for (let k = 0; k < 4; k++) codes[4 + k] = (hi >>> (k * 8)) & 0xff;
  return { altCount, codes: codes.subarray(0, altCount) };
}

export function unpackMatF(matF, row, slot, width = MAT_F_WIDTH) {
  const base = row * width * 4 + slot * 4;
  return [matF[base], matF[base + 1], matF[base + 2], matF[base + 3]];
}

export function unpackMatI(matI, row, slot, width = MAT_I_WIDTH) {
  const base = row * width * 4 + slot * 4;
  return [matI[base], matI[base + 1], matI[base + 2], matI[base + 3]];
}
