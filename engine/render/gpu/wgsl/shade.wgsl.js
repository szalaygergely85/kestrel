// WG-3c (docs/architecture.md 38.5/38.8, A6): WGSL port of glsl/shade.frag.js (US-029/US-030b shade pass: shadeCore per sub-sample,
// group average, glyph pick, gain/hue/overbright/fog, byte quantise) INCLUDING the terrain look (glsl/terrain.frag.js
// TERRAIN_SHADE_GLSL = shadeTerrain, kind 7), line by line; JS twins = detailShade.js (shadeCore/shadeTail/shadeDetailFast) and
// terrainShade.js (shadeTerrain). A6/A7 kind 9: the GLSL treats KIND_MESH like KIND_MODEL for the face-7 aoD force (+Inf) - ported as is.
// Deviations from the GLSL text (all mechanical, same ops in the same order):
//  - shadeTerrain param `type` is `typeId` (reserved word in WGSL).
//  - the uniform instance is `su` (GLSL param names u/v collide with a WGSL `u`); one block ShadeU (uniformBlock.js layout);
//    `uFaceK[7]` = two contiguous vec4 rows (index = face 1..6); ivec2 uFogSparseCodes/uFogHazeCodes are 4 i32 fields.
//  - shadeCore keeps colour triplets as scalar (r,g,b) triples (cr/cg/cb, tint) - componentwise-identical, and Node-probeable.
//  - `a ? b : c` is select(c, b, a) only where both arms are pure; texture reads / divisions stay in if/else.
//  - GLSL `mod(x, 2.0)` -> fmodGlsl, int `%` -> imod (common.wgsl.js); `int(float)` -> i32(f32) (truncation, same as GLSL).
// Bindings (@group(0), textures at binding = slot, ALL read by textureLoad; 16 sampled textures = the WebGPU default limit):
//  0 GI rgba32uint | 1 GA rgba32uint | 2 GD rgba32uint | 3 DEPTH r32uint | 4 SGI rgba32uint (sub-grid) | 5 SGA rgba32uint (sub-grid)
//  6 FGTEX rgba8 (JS layer) | 7 BGTEX rgba8 | 8 SKY rgba32float (SKY_LUT_N x 1, 0..255 range) | 9 MATF rgba32float (MAT_F_WIDTH)
//  10 MATI rgba32sint (MAT_I_WIDTH) | 11 SETI rgba32sint (SET_I_WIDTH) | 12 SETF r32float (SET_F_WIDTH) | 13 GAIN r32float (256x1)
//  14 LIGHT rgba32uint (light pass out) | 15 TLOOK rgba32float (TLOOK_WIDTH).  @group(1) @binding(0) = ShadeU.
// Targets: 0 = shadeFg rgba8, 1 = shadeBg rgba8 (bg.a = 1 shaded, 0 passthrough). Cell = @builtin(position).xy (no flip).
import { defineUniformBlock } from './uniformBlock.js';
import {
  GBUF_UNPACK_WGSL, FULLSCREEN_VS_WGSL, CELL_RAY_PITCHED_WGSL, OCT_NORMAL_WGSL, FMOD_WGSL, HASH_FAST_WGSL, BYTE_OUT_WGSL,
  SMOOTHSTEP_FAST_WGSL, QFLOOR_WGSL, ORIENT_AND_LINES_WGSL,
} from './common.wgsl.js';
export const MAX_SUB = 16; // 4x4, matches resolve.wgsl.js's cap
import { SKY_LUT_N } from './skyLut.js';
import { MAX_LEVELS } from '../ShadeTextures.js';
import { TLOOK_WIDTH, MAX_FEATURES_PER_TYPE } from '../TerrainTextures.js';
import { KIND_TERRAIN, KIND_MODEL, KIND_MESH, FACE_PACKED } from '../../GBuffer.js';
import { WET_DARK, WET_SPEC } from '../../detailShade.js';
import { VEG_TINT_WGSL } from '../../../mesh/vegTint.js'; // AUD-47
import { SUN_N_SHIFT, SUN_N_MASK, CLOUD_Q_SHIFT } from '../../shadowSun.js'; // CLOUD_Q_SHIFT: S8-B2-12c (38.13)
import { FOREST_FACE_NZ, FOREST_FACE_K, FOREST_TRUNK_CHANCE, FOREST_TRUNK_SALT, FOREST_TRUNK_CODE } from '../../terrainShade.js';



export const SHADE_BLOCK = defineUniformBlock('ShadeU', [
  { name: 'fogFg', type: 'vec3' }, { name: 'fogStart', type: 'f32' },
  { name: 'fogBg', type: 'vec3' }, { name: 'fogFull', type: 'f32' },
  { name: 'sunDir', type: 'vec3' }, { name: 'ambientI', type: 'f32' },
  { name: 'terrainFogNearRGB', type: 'vec3' }, { name: 'terrainFogStart', type: 'f32' },
  { name: 'terrainFogFarRGB', type: 'vec3' }, { name: 'terrainFogFull', type: 'f32' },
  { name: 'sunI', type: 'f32' }, { name: 'terrainFogCurve', type: 'f32' }, { name: 'bandNear', type: 'f32' }, { name: 'bandMid', type: 'f32' },
  { name: 'skyElevTop', type: 'f32' }, { name: 'horizonRow', type: 'f32' }, { name: 'planeDistY', type: 'f32' }, { name: 'timeSec', type: 'f32' },
  { name: 'cellAspect', type: 'f32' }, { name: 'cutoff', type: 'f32' }, { name: 'lift', type: 'f32' }, { name: 'fgMin', type: 'f32' },
  { name: 'fgMaxGain', type: 'f32' }, { name: 'tintK', type: 'f32' }, { name: 'overbright', type: 'f32' }, { name: 'overbrightMax', type: 'f32' },
  { name: 'aoR', type: 'f32' }, { name: 'aoK', type: 'f32' }, { name: 'fogStipple0', type: 'f32' }, { name: 'fogStipple1', type: 'f32' },
  { name: 'fogSparse', type: 'f32' }, { name: 'hashCell', type: 'f32' }, { name: 'closeBand', type: 'f32' }, { name: 'wetness', type: 'f32' }, // S8-B2-14 (was pad0, layout unchanged)
  { name: 'handover', type: 'vec2' }, // recipe.nearLOD.handover [h0, h1]
  { name: 'n', type: 'i32' }, { name: 'gpuSky', type: 'i32' },
  { name: 'projMode', type: 'i32' }, { name: 'sunMapOn', type: 'i32' }, { name: 'nearDetailOn', type: 'i32' },
  { name: 'fogSparseAlt', type: 'i32' }, { name: 'fogHazeAlt', type: 'i32' },
  { name: 'fogSparseCode0', type: 'i32' }, { name: 'fogSparseCode1', type: 'i32' }, { name: 'fogHazeCode0', type: 'i32' }, { name: 'fogHazeCode1', type: 'i32' },
  { name: 'pad1', type: 'i32' }, { name: 'pad2', type: 'i32' },
  { name: 'pitchA', type: 'vec4' }, // fX, fY, fZ, tanHalfX
  { name: 'pitchB', type: 'vec4' }, // rX, rY, uX, uY
  { name: 'pitchC', type: 'vec4' }, // uZ, tanHalfY, cosP, sinP
  { name: 'faceK', type: 'vec4', count: 2 }, // float[7] (index = face 1..6), contiguous
  // 38.23 entity tint table, APPENDED (no earlier word moves): etA.x = count (0 = branch skipped), etId = 8 u32 ids (written through a Uint32Array view), etC = rgb 0..1 + k
  { name: 'etA', type: 'vec4' }, { name: 'etId', type: 'vec4', count: 2 }, { name: 'etC', type: 'vec4', count: 8 },
]);

export const SHADE_TEXTURES = Object.freeze([
  'uint', 'uint', 'uint', 'uint', 'uint', 'uint', 'float', 'float', 'float', 'float', 'sint', 'sint', 'float', 'float', 'uint', 'float',
]);
export const SHADE_TARGETS = Object.freeze(['rgba8', 'rgba8']);

// glsl/terrain.frag.js TERRAIN_SHADE_GLSL (shadeTerrain), literal twin of terrainShade.js shadeTerrain.
export const TERRAIN_SHADE_WGSL = `
const MAX_FEATURES_PER_TYPE: i32 = ${MAX_FEATURES_PER_TYPE};
// ME-06b: literal twin of terrainShade.js's faceMode (0 surface, 1 canopy face, 2 foot row).
const FOREST_FACE_NZ: f32 = ${FOREST_FACE_NZ.toFixed(4)};

fn pickCodeFromPacked(x: i32, count: i32, idx: i32) -> i32 {
  let i = select(idx, count - 1, idx >= count);
  return (x >> u32(8 * i)) & 0xff;
}

struct TerrainOut { fr: f32, fg: f32, fb: f32, br: f32, bg: f32, bb: f32, glyph: i32 };

fn shadeTerrain(t: f32, typeId: i32, b: f32, u: f32, v: f32, timeSec: f32, faceMode: i32) -> TerrainOut {
  // 23.4 near-detail: hash cell 2 m inside the near-handover band, else 8 m. BUG-FP-002: hashCell < 0 = per-cell mode.
  var cellSz: f32;
  if (su.hashCell < 0.0) {
    if (su.nearDetailOn != 0 && !(t < su.handover.y)) { cellSz = 8.0; }
    else { cellSz = clamp(exp2(ceil(log2(max(t * -su.hashCell, 1e-6)))), 0.125, 2.0); }
  } else {
    if (su.hashCell > 0.0) { cellSz = su.hashCell; }
    else { cellSz = select(8.0, 2.0, su.nearDetailOn != 0 && t < su.handover.y); }
  }
  let cx = i32(floor(u / cellSz)); let cy = i32(floor(v / cellSz));
  let hA = hashFast(cx, cy, typeId);
  let hB = hashFast(cx, cy, 7);

  // S8-B2-14b wetness: darkens the lit term entering the tier/gain pick, same WET_DARK as detailShade.js/shadeCore
  // (terrain has no emissive term to keep separate - the whole incoming b is the "lit term" here).
  let bWet = b * (1.0 - ${WET_DARK.toFixed(4)} * su.wetness);

  // 23.4 near-detail: close (< closeBand) gets a +-0.08 brightness jitter (own hash salt 10, per-cell).
  let close = su.nearDetailOn != 0 && t < su.closeBand;
  var bEff = bWet;
  if (close) { bEff = bWet + (hashFast(cx, cy, 10) * 2.0 - 1.0) * 0.08; }

  var tier = 2;
  if (bEff < 0.45) { tier = 0; } else if (bEff < 0.8) { tier = 1; }
  var ii = tier + (i32(floor(hA * 3.0)) - 1);
  ii = clamp(ii, 0, 2);

  let base = typeId; // TLOOK row = type id (texel x = 0..6, see TerrainTextures.js)
  let t0 = textureLoad(uTlook, vec2i(ii, base), 0);
  // TLOOK colours are linear 0..1 (GPU texel layout); bytes are 0..255 (BUG-OWN-004).
  var fr = t0.r * 255.0; var fgc = t0.g * 255.0; var fbc = t0.b * 255.0;
  // gainOf(bEff, shading) port - same gain formula shadeCore uses.
  let bcc = max(bEff, 0.0);
  var gain = su.fgMin + (1.0 - su.fgMin) * samplePowLUT(min(bcc, 1.0));
  if (bcc > 1.0) { gain = min(su.fgMaxGain, gain + (bcc - 1.0) * 0.5); }
  gain = wetGain(gain, bEff);
  fr *= gain; fgc *= gain; fbc *= gain;
  var br = fr * 0.3; var bgc = fgc * 0.3; var bbc = fbc * 0.3;

  var bandIdx = 2;
  if (t < su.bandNear) { bandIdx = 0; } else if (t < su.bandMid) { bandIdx = 1; }
  // 23.4 near-detail: close wins over the near/mid/far tier (TLOOK texel 7, fixed).
  var gT: vec4f;
  if (close) { gT = textureLoad(uTlook, vec2i(7, base), 0); } else { gT = textureLoad(uTlook, vec2i(4 + bandIdx, base), 0); }
  let packedX = i32(gT.x); let packedCount = i32(gT.y);
  var code = pickCodeFromPacked(packedX, packedCount, i32(hB * f32(packedCount)));

  let t3 = textureLoad(uTlook, vec2i(3, base), 0);
  if (t3.y > 0.5) {
    let g = hashFast(cx, cy, i32(floor(timeSec * 1.5)));
    if (g > 0.5) {
      let alt = pickCodeFromPacked(packedX, packedCount, imod(i32(hB * f32(packedCount)) + 1, max(1, packedCount)));
      code = alt;
      let lightC = textureLoad(uTlook, vec2i(2, base), 0);
      let lr = lightC.r * 255.0 * gain; let lg = lightC.g * 255.0 * gain; let lb = lightC.b * 255.0 * gain;
      fr += (lr - fr) * 0.35; fgc += (lg - fgc) * 0.35; fbc += (lb - fbc) * 0.35;
    }
  }

  // 23.4 close-band features (wildflower/pebble): up to MAX_FEATURES_PER_TYPE slots packed into TLOOK texels 8-15; fi (texel .w
  // of the "A" slot) is the feature's index in the FLAT list the JS oracle hashes with the SAME salt (20+fi).
  if (close) {
    for (var slot = 0; slot < MAX_FEATURES_PER_TYPE; slot++) {
      let fa = textureLoad(uTlook, vec2i(8 + slot * 2, base), 0);
      let fchance = fa.x;
      if (fchance <= 0.0) { continue; }
      let fi = i32(fa.w);
      let fh = hashFast(cx, cy, 20 + fi);
      if (fh >= fchance) { continue; }
      code = select(i32(fa.z), i32(fa.y), fh < fchance * 0.5);
      let fbCol = textureLoad(uTlook, vec2i(9 + slot * 2, base), 0);
      fr = fbCol.x * 255.0; fgc = fbCol.y * 255.0; fbc = fbCol.z * 255.0;
      br = fr * 0.3; bgc = fgc * 0.3; bbc = fbc * 0.3;
      break;
    }
  }

  // ME-06b: background canopy FACE look: TLOOK texel 3 .z/.w = face glyphs + count (forest only), texel 16 = trunk colour.
  if (faceMode != 0 && t3.w > 0.5 && !close && t >= su.bandNear) {
    let faceCount = i32(t3.w);
    let trunk = faceMode == 2 && hashFast(cx, cy, ${FOREST_TRUNK_SALT}) < ${FOREST_TRUNK_CHANCE.toFixed(10)};
    if (trunk) { code = ${FOREST_TRUNK_CODE}; }
    else { code = pickCodeFromPacked(i32(t3.z), faceCount, select(i32(hB * f32(faceCount)), faceCount - 1, faceMode == 2)); }
    if (trunk) {
      let tc = textureLoad(uTlook, vec2i(16, base), 0);
      fr = tc.r * 255.0 * gain; fgc = tc.g * 255.0 * gain; fbc = tc.b * 255.0 * gain;
    }
    let dk = textureLoad(uTlook, vec2i(0, base), 0);
    br = dk.r * 255.0 * gain * 0.3; bgc = dk.g * 255.0 * gain * 0.3; bbc = dk.b * 255.0 * gain * 0.3;
    fr *= ${FOREST_FACE_K.toFixed(4)}; fgc *= ${FOREST_FACE_K.toFixed(4)}; fbc *= ${FOREST_FACE_K.toFixed(4)};
    br *= ${FOREST_FACE_K.toFixed(4)}; bgc *= ${FOREST_FACE_K.toFixed(4)}; bbc *= ${FOREST_FACE_K.toFixed(4)};
  }

  var f = (t - su.terrainFogStart) / (su.terrainFogFull - su.terrainFogStart);
  f = clamp(f, 0.0, 1.0);
  f = pow(f, su.terrainFogCurve);
  let fcr = su.terrainFogNearRGB.x + (su.terrainFogFarRGB.x - su.terrainFogNearRGB.x) * f;
  let fcg = su.terrainFogNearRGB.y + (su.terrainFogFarRGB.y - su.terrainFogNearRGB.y) * f;
  let fcb = su.terrainFogNearRGB.z + (su.terrainFogFarRGB.z - su.terrainFogNearRGB.z) * f;
  fr += (fcr - fr) * f; fgc += (fcg - fgc) * f; fbc += (fcb - fbc) * f;
  let fBg = min(1.0, 1.1 * f);
  br += (fcr - br) * fBg; bgc += (fcg - bgc) * fBg; bbc += (fcb - bbc) * fBg;
  if (f > 0.85) { code = 0; }

  var o: TerrainOut;
  o.fr = fr; o.fg = fgc; o.fb = fbc; o.br = br; o.bg = bgc; o.bb = bbc; o.glyph = code;
  return o;
}
`;

// US-073b (38.25): the stable-glyph variant adds one r8uint target `lvl` (@location(2)) = the ramp level of the picked glyph (255 = none /
// passthrough / terrain / line / fog stipple). `L` holds the four text splices; with withLevel=false every splice is '' and the
// string is byte-identical to the pre-073b shader (asserted by sha in shade.wgsl.test.js).
function buildShadeWgsl(withLevel) {
  const L = withLevel
    ? {
      field: `
  @location(2) lvl: u32,`,
      init: ' o.lvl = 255u;',
      vars: `
  var lvOut = 255u;`,
      set: `
    lvOut = u32(levelFromThresholds(setIdPick, t0.z, gbAvg, su.cutoff));`,
      stip: ' lvOut = 255u;',
      out: ' o.lvl = lvOut;',
      // 38.25 amendment C.1: terrain with the shimmer flag (TLOOK texel 3 .y, the branch that re-rolls the glyph on a timer) = level 254 'animated, never hold'
      terr: ' o.lvl = select(255u, 254u, textureLoad(uTlook, vec2i(3, typeId), 0).y > 0.5);',
    }
    : { field: '', init: '', vars: '', set: '', stip: '', out: '', terr: '' };
  return `
${SHADE_BLOCK.wgsl}
@group(0) @binding(0) var uGI: texture_2d<u32>;    // resolved: x = planeId, y = kind|face|mask|cov|mat, z = packed normal (terrain)
@group(0) @binding(1) var uGA: texture_2d<u32>;    // bitcast u, v, z, aoD - resolved (nearest-centre winner sample)
@group(0) @binding(2) var uGD: texture_2d<u32>;    // bitcast dudx, dvdx, dudy, dvdy - resolved, shared over a cell's sub-samples
@group(0) @binding(3) var uDepth: texture_2d<u32>; // bitcast dist - resolved
@group(0) @binding(4) var uSGI: texture_2d<u32>;   // US-030b sub-sample G-buffer (14.2 item 3)
@group(0) @binding(5) var uSGA: texture_2d<u32>;
@group(0) @binding(6) var uFgTex: texture_2d<f32>; // RGBA8 JS layer in (rt.cells.fg)
@group(0) @binding(7) var uBgTex: texture_2d<f32>; // RGBA8 JS layer in (rt.cells.bg)
@group(0) @binding(8) var uSky: texture_2d<f32>;   // RGBA32F, SKY_LUT_N x 1 - baked bg gradient (0..255 range), by elevation
@group(0) @binding(9) var uMatF: texture_2d<f32>;  // RGBA32F material floats
@group(0) @binding(10) var uMatI: texture_2d<i32>; // RGBA32I material ints
@group(0) @binding(11) var uSetI: texture_2d<i32>; // RGBA32I glyph sets
@group(0) @binding(12) var uSetF: texture_2d<f32>; // R32F, row = set id, texel k = thresholds[k]
@group(0) @binding(13) var uGain: texture_2d<f32>; // R32F, 256x1 - table.gainLUT
@group(0) @binding(14) var uLightTex: texture_2d<u32>; // light pass: xyz = bitcast L, w = sunlit | litCount << 8 | sunN << SUN_N_SHIFT
@group(0) @binding(15) var uTlook: texture_2d<f32>;    // RGBA32F, TLOOK_WIDTH, row = type id
@group(1) @binding(0) var<uniform> su: ShadeU;

${GBUF_UNPACK_WGSL}
${CELL_RAY_PITCHED_WGSL}
${FMOD_WGSL}
${HASH_FAST_WGSL}
${BYTE_OUT_WGSL}
${SMOOTHSTEP_FAST_WGSL}
${QFLOOR_WGSL}
${ORIENT_AND_LINES_WGSL}
${OCT_NORMAL_WGSL}
${FULLSCREEN_VS_WGSL}

const MAX_SUB: i32 = ${MAX_SUB};
const MAX_LEVELS: i32 = ${MAX_LEVELS};
var<private> POW2: array<f32, 6> = array<f32, 6>(0.125, 0.25, 0.5, 1.0, 2.0, 4.0);

// 38.23: one channel of the entity tint, literal twin of entityTint.js tintChannel (c on the 0..255 scale, t = rgb 0..1).
fn tintCh(c: f32, t: f32, k: f32) -> f32 { return c + (t * 255.0 - c) * k; }
${VEG_TINT_WGSL}// First table entry matching objectId, or -1 (twin: entityTintAt).
fn tintIndex(oid: u32, count: i32) -> i32 {
  for (var i = 0; i < 8; i++) {
    if (i >= count) { break; }
    if (bitcast<u32>(su.etId[i >> 2][i & 3]) == oid) { return i; }
  }
  return -1;
}

fn samplePowLUT(x: f32) -> f32 {
  let xc = clamp(x, 0.0, 1.0);
  let idx = i32(xc * 255.0 + 0.5);
  return textureLoad(uGain, vec2i(idx, 0), 0).r;
}

// S8-B2-14: literal twin of detailShade.js wetGain (wetness 0 returns gain untouched, so the default is bit-identical).
fn wetGain(gain: f32, bc: f32) -> f32 {
  return select(gain, min(su.fgMaxGain, gain + su.wetness * ${WET_SPEC.toFixed(4)} * smoothstepFast(0.5, 1.0, bc)), su.wetness > 0.0);
}

fn levelFromThresholds(setId: i32, levels: i32, gb: f32, cutoff: f32) -> i32 {
  if (!(gb >= cutoff)) { return 0; }
  var i = 0;
  for (var k = 1; k < MAX_LEVELS; k++) {
    if (k >= levels) { break; }
    let t = textureLoad(uSetF, vec2i(k, setId), 0).r;
    if (t <= gb) { i = k; } else { break; }
  }
  return 1 + i;
}

fn pitchedCellDir(cell: vec2f, grid: vec2i) -> vec3f {
  return cellDirPitched(cell, grid, su.pitchA.xyz, su.pitchB.xy, vec3f(su.pitchB.z, su.pitchB.w, su.pitchC.x), vec2f(su.pitchA.w, su.pitchC.y));
}
fn fogScaleCell(row: i32, rows: i32) -> f32 {
  return select(pitchFogScale(row, rows, su.pitchC.y, su.pitchC.z, su.pitchC.w, su.projMode == 2), 1.0, su.projMode == 0);
}
fn faceK(face: i32) -> f32 { return su.faceK[u32(face) >> 2u][u32(face) & 3u]; }

${TERRAIN_SHADE_WGSL}

fn pickCode(setId: i32, entryIdx: i32, hA: f32, useAlt: bool) -> i32 {
  let t = textureLoad(uSetI, vec2i(2 + entryIdx, setId), 0);
  let cnt = t.x;
  var idx = 0;
  if (useAlt) { idx = min(cnt - 1, i32(hA * f32(cnt))); }
  let lo = u32(t.y); let hi = u32(t.z);
  let word = select(hi, lo, idx < 4);
  let shift = select(idx - 4, idx, idx < 4) * 8;
  return i32((word >> u32(shift)) & 0xffu);
}

// Returns glyph code (already ASCII-32) or -1 (caller substitutes space).
fn pickGlyphCodeFast(setId: i32, gb: f32, hA: f32, classIdx: i32, cutoff: f32) -> i32 {
  let t0 = textureLoad(uSetI, vec2i(0, setId), 0);
  let t1 = textureLoad(uSetI, vec2i(1, setId), 0);
  let oriented = t0.x; let levels = t0.z; let nDark = t0.w; let nFam = t1.y;
  let lv = levelFromThresholds(setId, levels, gb, cutoff);
  if (lv == 0) { return -1; }
  var entryIdx: i32;
  if (oriented == 0) {
    entryIdx = lv - 1;
  } else if (lv <= nDark) {
    entryIdx = lv - 1;
  } else {
    entryIdx = nDark + classIdx * nFam + (lv - nDark - 1);
  }
  return pickCode(setId, entryIdx, hA, true);
}

// --- shadeCore (14.2 item 3): everything that depends on THIS sub-sample's own u/v/z/aoD, up to (but excluding) the discrete
// glyph pick and the gain/hue/overbright/fog/byte-quantise tail - those run once per CELL in fs_main on the group average.
struct Core {
  b: f32, gb: f32, cr: f32, cg: f32, cb: f32, bgK: f32, hA: f32, hB: f32,
  onJoint: bool,
  lineCode: i32, setId: i32,
};

fn shadeCore(u: f32, v: f32, z: f32, aoD: f32,
    dudx: f32, dvdx: f32, dudy: f32, dvdy: f32, dist: f32, face: i32, kind: u32, matId: i32, Lm: f32) -> Core {
  let mf0 = textureLoad(uMatF, vec2i(0, matId), 0);
  let mf1 = textureLoad(uMatF, vec2i(1, matId), 0);
  let mf2 = textureLoad(uMatF, vec2i(2, matId), 0);
  let mf3 = textureLoad(uMatF, vec2i(3, matId), 0);
  let mf4 = textureLoad(uMatF, vec2i(4, matId), 0);
  let mf5 = textureLoad(uMatF, vec2i(5, matId), 0);
  let mf6 = textureLoad(uMatF, vec2i(6, matId), 0);
  let mf7 = textureLoad(uMatF, vec2i(7, matId), 0);
  let mf8 = textureLoad(uMatF, vec2i(8, matId), 0);
  let mf9 = textureLoad(uMatF, vec2i(9, matId), 0);

  let mi0 = textureLoad(uMatI, vec2i(0, matId), 0);
  let mi1 = textureLoad(uMatI, vec2i(1, matId), 0);
  let mi2 = textureLoad(uMatI, vec2i(2, matId), 0);
  let mi3 = textureLoad(uMatI, vec2i(3, matId), 0);

  let seed = mi0.x; let flags = mi0.y;
  let hasGrid = (flags & 1) != 0; let gridTint = (flags & 2) != 0; let gridBgK = (flags & 4) != 0;
  let gridCross = (flags & 8) != 0; let gridTie = (flags & 16) != 0; let gridLines = (flags & 32) != 0; let gridGap = (flags & 64) != 0;
  let hasBevel = (flags & 128) != 0; let hasBand = (flags & 256) != 0; let bandIsU = (flags & 512) != 0;
  let bandTone = (flags & 1024) != 0; let bandBgK = (flags & 2048) != 0;
  let hasOverlay = (flags & 4096) != 0; let ovBand = (flags & 8192) != 0; let hasSpeckle = (flags & 16384) != 0; let hasLod = (flags & 32768) != 0;
  let gridTexel = (flags & 131072) != 0; // GRID-TEXEL-GLYPH-01 (F_GRID_TEXEL)

  let detail = mf0.z; let jitter = mf0.w;
  let albedo = mf0.x;
  var bgK = mf0.y;
  let gu = mf2.y; let gv = mf2.z; let gstagger = mf2.w;

  var course = 0.0; var uo = u; var fv = 0.5;
  var bix = 0; var courseI = 0;
  if (hasGrid) {
    courseI = i32(qfloor(v / gv));
    course = f32(courseI);
    uo = u - select(0.0, gstagger * gu, fmodGlsl(course, 2.0) != 0.0);
    bix = i32(qfloor(uo / gu));
    fv = v / gv - course;
  }

  let tpcU = abs(dudx) + abs(dudy); let tpcV = abs(dvdx) + abs(dvdy);
  let tpc = select(tpcV, tpcU, tpcU > tpcV) * detail;
  var oct = 2;
  if (tpc >= 4.0) { oct = -3; }
  else if (tpc >= 2.0) { oct = -2; }
  else if (tpc >= 1.0) { oct = -1; }
  else if (tpc >= 0.5) { oct = 0; }
  else if (tpc >= 0.25) { oct = 1; }
  let ds = detail * POW2[oct + 3];

  let btx = i32(floor(u * detail)); let bty = i32(floor(v * detail));
  var hA: f32; var hC: f32; var hJ: f32;
  if (hasGrid && !gridTexel) {
    hA = hashFast(bix, courseI, seed);
    hC = hashFast(bix, courseI, seed + 13);
    hJ = hA;
  } else {
    let cx = i32(floor(u * ds * 0.5)); let cy = i32(floor(v * ds * 0.5));
    hA = hashFast(cx, cy, seed);
    hC = hashFast(cx, cy, seed + 13);
    hJ = select(hA, hashFast(bix, courseI, seed), hasGrid);
  }
  let hB = hashFast(btx, bty, seed + 7);
  let hBlock = hashFast(bix, courseI, seed + 3);

  // --- tone (per block) ---
  let toneTotal = mf1.y;
  var x = hBlock * toneTotal;
  let nTones = mi0.z;
  var cr = 0.0; var cg = 0.0; var cb = 0.0;
  for (var t = 0; t < 4; t++) {
    if (t >= nTones) { break; }
    let mt = textureLoad(uMatF, vec2i(10 + t, matId), 0);
    x -= mt.w;
    cr = mt.x; cg = mt.y; cb = mt.z; // last one wins if the loop exhausts
    if (x < 0.0) { break; }
  }

  var tier = 0;
  if (hasLod) {
    let lodMid = mf1.z; let lodFar = mf1.w; let lodDither = mf2.x;
    let dd = dist + (hB - 0.5) * lodDither;
    if (dd < lodMid) { tier = 0; } else if (dd < lodFar) { tier = 1; } else { tier = 2; }
  }
  let setNear = mi1.x; let setMid = mi1.y; let setFar = mi1.z;
  var setId = setFar;
  if (tier == 0) { setId = setNear; } else if (tier == 1) { setId = setMid; }

  var shadeK = 1.0; var tintAmt = 0.0;
  var tintR = 0.0; var tintG = 0.0; var tintB = 0.0;
  var lineCode = -1;
  var onJoint = false; var inBand = false;

  let bevelGate = mi3.x; let bandGate = mi3.y; let overlayGate = mi3.z; let speckleGate = mi3.w;

  if (hasGrid && hasBevel && tier <= bevelGate) {
    let top = mf5.x; let topShade = mf5.y; let bottom = mf5.z; let bottomShade = mf5.w;
    let yv = fv * gv;
    if (gv - yv < top) { shadeK *= topShade; }
    else if (yv < bottom) { shadeK *= bottomShade; }
  }

  if (hasBand) {
    let period = mf6.x; let width = mf6.y; let bshade = mf6.z; let bbgK = mf6.w; let edgeShade = mf7.w;
    let bandSetId = mi2.y;
    let bcoord = select(v, u, bandIsU);
    let bcx = select(dvdx, dudx, bandIsU); let bcy = select(dvdy, dudy, bandIsU);
    let pos = bcoord - qfloor(bcoord / period) * period;
    if (pos < width) {
      inBand = true;
      if (tier <= bandGate) { setId = bandSetId; }
      shadeK = bshade;
      if (bandTone) { cr = mf7.x; cg = mf7.y; cb = mf7.z; }
      if (bandBgK) { bgK = bbgK; }
    }
    let bcov = coverFast(bcx, bcy);
    var bandMult = 1.0;
    var ok = true;
    if (!(bcov < 0.5 * width)) {
      bandMult = 2.0;
      if (!(bcov < bandMult * 0.5 * width)) {
        bandMult = 4.0;
        if (!(bcov < bandMult * 0.5 * width)) { ok = false; }
      }
    }
    if (ok) {
      let e0 = crossLineFast(bcoord, bcx, bcy, period, 0.0);
      let e1 = crossLineFast(bcoord, bcx, bcy, period, width);
      let ef = select(e1, e0, e0 >= 0.0);
      if (ef >= 0.0) { lineCode = lineGlyphCodeFast(bcx, bcy, ef, su.cellAspect); shadeK = edgeShade; onJoint = true; }
    }
  }

  if (hasGrid && gridLines && !inBand && !onJoint) {
    let maxCover = mf3.w;
    let coverV = coverFast(dvdx, dvdy);
    var periodH = gv;
    var okH = true;
    if (!(coverV < maxCover * periodH)) {
      periodH = gv * 2.0;
      if (!(coverV < maxCover * periodH)) {
        periodH = gv * 4.0;
        if (!(coverV < maxCover * periodH)) { okH = false; }
      }
    }
    let coverU = coverFast(dudx, dudy);
    var periodV = gu;
    var okV0 = true;
    if (!(coverU < maxCover * periodV)) {
      periodV = gu * 2.0;
      if (!(coverU < maxCover * periodV)) {
        periodV = gu * 4.0;
        if (!(coverU < maxCover * periodV)) { okV0 = false; }
      }
    }
    let okV = okV0 && (!gridTie || okH);
    var fh = -1.0;
    if (okH) { fh = crossLineFast(v, dvdx, dvdy, periodH, 0.0); }
    var fu = -1.0;
    if (okV) { fu = crossLineFast(uo, dudx, dudy, periodV, 0.0); }
    if (fh >= 0.0 || fu >= 0.0) {
      onJoint = true;
      if (gridGap) { setId = mi1.w; lineCode = -1; }
      else if (fh >= 0.0 && fu >= 0.0 && gridCross) { lineCode = mi2.x; }
      else if (fu >= 0.0) { lineCode = lineGlyphCodeFast(dudx, dudy, fu, su.cellAspect); }
      else { lineCode = lineGlyphCodeFast(dvdx, dvdy, fh, su.cellAspect); }
      shadeK = mf3.x;
      if (gridTint) { tintR = mf4.x; tintG = mf4.y; tintB = mf4.z; tintAmt = mf3.y; }
      if (gridBgK) { bgK = mf3.z; }
    }
  }

  if (hasOverlay && tier <= overlayGate) {
    let ovSetId = mi2.z;
    let ovAmount = mf8.x; let ovShade = mf8.y; let ovJoint = mf9.x; let ovFace = mf9.y;
    var bf = 1.0;
    if (ovBand) {
      let full = mf8.z; let zero = mf8.w;
      if (z <= full) { bf = 1.0; } else if (z >= zero) { bf = 0.0; } else { bf = 1.0 - (z - full) / (zero - full); }
    }
    if (hC < select(ovFace, ovJoint, onJoint) * bf) {
      if (!onJoint) { setId = ovSetId; }
      let k = mi0.w;
      let tIdx = min(k - 1, i32(hA * f32(k)));
      let tintTex = textureLoad(uMatF, vec2i(14 + tIdx, matId), 0);
      tintR = tintTex.x; tintG = tintTex.y; tintB = tintTex.z; tintAmt = ovAmount;
      shadeK *= ovShade;
    }
  }
  if (hasSpeckle && tier <= speckleGate && !onJoint && !inBand) {
    let chance = mf9.z; let sshade = mf9.w;
    if (hC > 1.0 - chance) {
      setId = mi2.w;
      shadeK *= sshade;
    }
  }

  // US-040 step 4 (15.2 item 5): kind 8 (KIND_MODEL) forces fk = 1.0 on every face - literal twin of detailShade.js's shadeCore.
  var fk = 1.0;
  if (kind != ${KIND_MODEL}u && face >= 1 && face <= 6) { fk = faceK(face); }
  var aok = 1.0;
  if (aoD < su.aoR) { aok = su.aoK + (1.0 - su.aoK) * smoothstepFast(0.0, su.aoR, aoD); }
  let jit = 1.0 + jitter * (hJ * 2.0 - 1.0);
  let b = Lm * albedo * shadeK * fk * aok * jit * (1.0 - ${WET_DARK.toFixed(4)} * su.wetness) + mf1.x;
  var gb = 0.0;
  if (!(b < su.cutoff)) { gb = su.lift + (1.0 - su.lift) * min(b, 1.0); }

  if (tintAmt > 0.0) { cr += (tintR - cr) * tintAmt; cg += (tintG - cg) * tintAmt; cb += (tintB - cb) * tintAmt; }

  var c: Core;
  c.b = b; c.gb = gb; c.cr = cr; c.cg = cg; c.cb = cb; c.bgK = bgK;
  c.hA = hA; c.hB = hB; c.onJoint = onJoint; c.lineCode = lineCode; c.setId = setId;
  return c;
}

struct FO {
  @location(0) fg: vec4f,
  @location(1) bg: vec4f,${L.field}
};

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> FO {
  let cell = vec2i(floor(frag.xy));
  let gi = textureLoad(uGI, cell, 0).xy;
  let kindU = giKind(gi.y);
  let maskU = giMask(gi.y);
  let jsFg = textureLoad(uFgTex, cell, 0);
  let jsBg = textureLoad(uBgTex, cell, 0);
  let gridSize = vec2i(textureDimensions(uGI));
  var o: FO;${L.init}

  if (kindU == 0u) {
    // US-030a: on the DDA path (gpuSky), fillSky never runs - a masked-over-sky cell (HUD over open sky) still passes through to
    // the JS layer; an un-masked one gets the baked flat-gradient sky.
    if (su.gpuSky != 0 && maskU == 0u) {
      var elevDeg: f32;
      if (su.projMode == 0) {
        elevDeg = degrees(atan2(su.horizonRow - f32(cell.y), su.planeDistY));
      } else {
        // RE-02a (28.1 A2 item 2): per-cell elevation of the screenRay direction.
        let sd = select(pitchedCellDir(vec2f(cell), gridSize), su.pitchA.xyz, su.projMode == 2); // 38.19: ortho dir = F
        elevDeg = degrees(atan2(sd.z, length(sd.xy)));
      }
      let t = clamp(elevDeg / su.skyElevTop, 0.0, 1.0);
      let idx = i32(t * ${SKY_LUT_N - 1}.0 + 0.5);
      let col255 = textureLoad(uSky, vec2i(idx, 0), 0).rgb;
      o.fg = vec4f(toByte01(col255.r), toByte01(col255.g), toByte01(col255.b), 0.0);
      o.bg = vec4f(toByte01(col255.r), toByte01(col255.g), toByte01(col255.b), 1.0);
    } else {
      o.fg = jsFg;
      o.bg = vec4f(jsBg.rgb, 0.0);
    }
    return o;
  }
  if (maskU != 0u) {
    o.fg = jsFg;
    o.bg = vec4f(jsBg.rgb, 0.0);
    return o;
  }

  // US-016 (14.4 items 4/5), US-026a S5 (23.4): terrain cells use TLOOK, not the MaterialTable - deterministic per cell, no
  // sub-sample averaging; GI.z (ME-06) carries the PACKED NORMAL; b = ambientI + sunI * max(0, N.L) [* sunN/4] + the cell's
  // own point-light term, the lamp then tints fg after shadeTerrain's byte-quantised output (same double quantisation as JS).
  if (kindU == ${KIND_TERRAIN}u) {
    let typeId = i32(giMat(gi.y));
    let gaT = textureLoad(uGA, cell, 0);
    let uT = bitcast<f32>(gaT.x); let vT = bitcast<f32>(gaT.y);
    let Nt = unpackNormalOct(textureLoad(uGI, cell, 0).z);
    let ndotlT = Nt.x * su.sunDir.x + Nt.y * su.sunDir.y + Nt.z * su.sunDir.z;
    let lightT = textureLoad(uLightTex, cell, 0);
    var sunFT = 1.0;
    if (su.sunMapOn != 0) { sunFT = f32((lightT.w >> ${SUN_N_SHIFT}u) & ${SUN_N_MASK}u) * 0.25; } // ME-15c (US-070b)
    // S8-B2-12b (38.13): cloud-darkening byte (bits 24..31 of LIGHT.w, written by the light pass regardless of
    // strength - q is 0 unless strength > 0) scales the whole analytic sun term; q 0 -> cFt 1.0 -> bit-identical.
    let cFt = 1.0 - f32((lightT.w >> ${CLOUD_Q_SHIFT}u) & 255u) * (1.0 / 255.0);
    let bSunT = su.ambientI + su.sunI * max(0.0, ndotlT) * sunFT * cFt;
    let LcT = bitcast<vec3f>(lightT.xyz);
    let bT = bSunT + max(LcT.x, max(LcT.y, LcT.z));
    // RE-02a (28.1 A2 item 3): the horizontal forward distance (mode 0: unchanged).
    var distT = bitcast<f32>(textureLoad(uDepth, cell, 0).x);
    if (su.projMode != 0) { distT *= fogScaleCell(cell.y, gridSize.y); }
    // ME-06b: canopy face mode (twin of terrainCaster.js forestFaceMode): steep forest cell beyond the near band = 1;
    // 2 when the cell below (row + 1) is not a steep cell of the same type.
    var faceModeT = 0;
    if (textureLoad(uTlook, vec2i(3, typeId), 0).w > 0.5 && distT >= su.bandNear && Nt.z < FOREST_FACE_NZ) {
      faceModeT = 2;
      let dnC = vec2i(cell.x, cell.y + 1);
      if (dnC.y < gridSize.y) {
        let giDn = textureLoad(uGI, dnC, 0);
        if (giKind(giDn.y) == ${KIND_TERRAIN}u && i32(giMat(giDn.y)) == typeId && unpackNormalOct(giDn.z).z < FOREST_FACE_NZ) { faceModeT = 1; }
      }
    }
    let to = shadeTerrain(distT, typeId, bT, uT, vT, su.timeSec, faceModeT);
    let frQ = floor(clamp(to.fr, 0.0, 255.0) + 0.5);
    let fgQ = floor(clamp(to.fg, 0.0, 255.0) + 0.5);
    let fbQ = floor(clamp(to.fb, 0.0, 255.0) + 0.5);
    o.fg = vec4f(toByte01(frQ + LcT.x * 0.5 * 255.0), toByte01(fgQ + LcT.y * 0.5 * 255.0), toByte01(fbQ + LcT.z * 0.5 * 255.0), toByte01(f32(to.glyph)));
    o.bg = vec4f(toByte01(to.br), toByte01(to.bg), toByte01(to.bb), 1.0);${L.terr}
    return o;
  }

  let matId = i32(giMat(gi.y));
  let face = i32(giFace(gi.y));
  let pidResolved = i32(gi.x);
  let gdU = textureLoad(uGD, cell, 0);
  let gd = bitcast<vec4f>(gdU);
  let dudx = gd.x; let dvdx = gd.y; let dudy = gd.z; let dvdy = gd.w;
  var dist = bitcast<f32>(textureLoad(uDepth, cell, 0).x);
  if (su.projMode != 0) { dist *= fogScaleCell(cell.y, gridSize.y); } // RE-02a: horizontal forward distance
  // US-006: sampled once per fragment (constant over every sub-sample of this cell).
  let Lc = bitcast<vec3f>(textureLoad(uLightTex, cell, 0).xyz);
  let Lm = max(Lc.x, max(Lc.y, Lc.z));

  // US-030b (14.2 item 3, pass D): average shadeCore's continuous outputs over the resolved winner's own sub-sample group
  // (matched by the same (kind, planeId, mat) key the resolve pass voted on); the structural picks (setId/onJoint/lineCode)
  // come from the group member nearest the cell centre (same tie rule as resolve).
  var bSum = 0.0; var gbSum = 0.0; var crSum = 0.0; var cgSum = 0.0; var cbSum = 0.0; var bgKSum = 0.0;
  var count = 0; var jointN = 0;
  // Item 3: hA/hB are discrete dice, taken from the single sub-sample nearest the cell centre, never averaged.
  var bestMag = 1.0e30; var hAW = 0.0; var hBW = 0.0;
  // Item 4: setId/lineCode split by joint membership (nearest ON-JOINT member / nearest NON-joint member).
  var bestJointMag = 1.0e30; var bestNonJointMag = 1.0e30;
  var onJointSetW = 0; var onJointLineW = -1; var nonJointSetW = 0;

  for (var j = 0; j < 4; j++) {
    if (j >= su.n) { break; }
    for (var i = 0; i < 4; i++) {
      if (i >= su.n) { break; }
      let sc = vec2i(cell.x * su.n + i, cell.y * su.n + j);
      let sgiFull = textureLoad(uSGI, sc, 0).xy;
      if (giKind(sgiFull.y) != kindU) { continue; }
      if (i32(sgiFull.x) != pidResolved) { continue; }
      if (giMat(sgiFull.y) != u32(matId)) { continue; }

      let sgaU = textureLoad(uSGA, sc, 0);
      let uA = bitcast<f32>(sgaU.x); let vA = bitcast<f32>(sgaU.y);
      let zA = bitcast<f32>(sgaU.z);
      // US-041a (15.3 item 3): face 7 (FACE_PACKED) has the octahedral-packed normal in this slot, not a real AO distance -
      // force +Inf (kind 8 and kind 9), literal twin of detailShade.js's shadeDetailFast fix.
      var aoDA = bitcast<f32>(sgaU.w);
      if ((kindU == ${KIND_MODEL}u && face == ${FACE_PACKED}) || kindU == ${KIND_MESH}u) { aoDA = 1.0e30; } // ME-20c: kind-9 GA.w may carry vertex AO, never an aoD

      let c = shadeCore(uA, vA, zA, aoDA, dudx, dvdx, dudy, dvdy, dist, face, kindU, matId, Lm);
      bSum += c.b; gbSum += c.gb; crSum += c.cr; cgSum += c.cg; cbSum += c.cb; bgKSum += c.bgK;
      count++;
      if (c.onJoint) { jointN++; }

      let ox = (f32(i) + 0.5) / f32(su.n) - 0.5;
      let oy = (f32(j) + 0.5) / f32(su.n) - 0.5;
      let mag = ox * ox + oy * oy;
      if (mag < bestMag) { bestMag = mag; hAW = c.hA; hBW = c.hB; }
      if (c.onJoint) {
        if (mag < bestJointMag) { bestJointMag = mag; onJointSetW = c.setId; onJointLineW = c.lineCode; }
      } else {
        if (mag < bestNonJointMag) { bestNonJointMag = mag; nonJointSetW = c.setId; }
      }
    }
  }
  if (count == 0) {
    // Safety net only: resolve's winner key is derived from these same textures, so at least one sub-sample matches by construction.
    o.fg = jsFg;
    o.bg = vec4f(jsBg.rgb, 0.0);
    return o;
  }

  // Item 4: majority vote - a line only fires when at least half the matching sub-samples call it a joint.
  let lineWins = 2 * jointN >= count;

  let invCount = 1.0 / f32(count);
  let bAvg = bSum * invCount; let gbAvg = gbSum * invCount;
  let crAvg = crSum * invCount; let cgAvg = cgSum * invCount; let cbAvg = cbSum * invCount;
  let bgKAvg = bgKSum * invCount;
  let hAAvg = hAW; let hBAvg = hBW;

  let f = select(select((dist - su.fogStart) / (su.fogFull - su.fogStart), 1.0, dist >= su.fogFull), 0.0, dist <= su.fogStart);

  var glyphCode: i32;${L.vars}
  if (gbAvg <= 0.0) { glyphCode = 0; }
  else if (lineWins && onJointLineW >= 0) { glyphCode = onJointLineW; }
  else {
    // Either the vote said "no line", or it said "line" but the winning on-joint member itself draws no line glyph (e.g. gridGap,
    // whose setId it already redirected) - either way fall through to the ordinary glyph pick, with the appropriate member's setId.
    let setIdPick = select(nonJointSetW, onJointSetW, lineWins);
    let t0 = textureLoad(uSetI, vec2i(0, setIdPick), 0);
    let oriented = t0.x; let orientAxis = t0.y;
    var classIdx = 0;
    if (oriented != 0) { classIdx = orientClassCode(select(dvdx, dudx, orientAxis == 0), select(dvdy, dudy, orientAxis == 0), su.cellAspect); }
    let code = pickGlyphCodeFast(setIdPick, gbAvg, hAAvg, classIdx, su.cutoff);
    glyphCode = select(code, 0, code < 0);${L.set}
  }
  if (f > su.fogStipple0 && hBAvg < smoothstepFast(su.fogStipple0, su.fogStipple1, f)) {
    let sparse = f > su.fogSparse;
    let cnt = select(su.fogHazeAlt, su.fogSparseAlt, sparse);
    let idx = min(cnt - 1, i32(hAAvg * f32(cnt)));
    let code0 = select(su.fogHazeCode0, su.fogSparseCode0, sparse);
    let code1 = select(su.fogHazeCode1, su.fogSparseCode1, sparse);
    glyphCode = select(code1, code0, idx == 0);${L.stip}
  }

  let hcol = select(vec3f(1.0), Lc / Lm, Lm > 1e-6);
  let bc = max(bAvg, 0.0);
  var gain = su.fgMin + (1.0 - su.fgMin) * samplePowLUT(bc);
  if (bc > 1.0) { gain = min(su.fgMaxGain, gain + (bc - 1.0) * 0.5); }
  gain = wetGain(gain, bc);
  var rgbF = vec3f(crAvg, cgAvg, cbAvg) * (1.0 + (hcol - 1.0) * su.tintK) * gain;
  if (bc > 1.0) {
    let hot = min(su.overbrightMax, (bc - 1.0) * su.overbright);
    rgbF += (255.0 * (0.5 + 0.5 * hcol) - rgbF) * hot;
  }
  rgbF = clamp(rgbF, vec3f(0.0), vec3f(255.0));
  // Item 4: dim a firing line by sub-sample agreement (2-of-4 tie fades to half strength, 4-of-4 stays full).
  if (lineWins) { rgbF *= 0.5 + 0.5 * f32(jointN) / f32(count); }
  var rgbBg = rgbF * bgKAvg;
  { // AUD-47 vegetation colour variation (objectId tint bits; marker-less ids multiply by 1.0 -> bit-identical)
    let vg = vegGain(textureLoad(uGI, cell, 0).w);
    rgbF *= vg; rgbBg *= vg;
  }
  // 38.23 entity tint: display override after lighting, before fog; count 0 skips the whole branch (bit-identical).
  if (su.etA.x > 0.0) {
    let ti = tintIndex(textureLoad(uGI, cell, 0).w, i32(su.etA.x));
    if (ti >= 0) {
      let tc = su.etC[ti];
      rgbF = vec3f(tintCh(rgbF.x, tc.x, tc.w), tintCh(rgbF.y, tc.y, tc.w), tintCh(rgbF.z, tc.z, tc.w));
      rgbBg = vec3f(tintCh(rgbBg.x, tc.x, tc.w), tintCh(rgbBg.y, tc.y, tc.w), tintCh(rgbBg.z, tc.z, tc.w));
    }
  }
  if (f > 0.0) {
    rgbF += (su.fogFg - rgbF) * f;
    rgbBg += (su.fogBg - rgbBg) * f;
  }

  o.fg = vec4f(toByte01(rgbF.x), toByte01(rgbF.y), toByte01(rgbF.z), toByte01(f32(glyphCode)));
  o.bg = vec4f(toByte01(rgbBg.x), toByte01(rgbBg.y), toByte01(rgbBg.z), 1.0);${L.out}
  return o;
}
`;
}

export const SHADE_WGSL = buildShadeWgsl(false);
export const SHADE_LEVEL_WGSL = buildShadeWgsl(true);
export const SHADE_LEVEL_TARGETS = Object.freeze(['rgba8', 'rgba8', 'r8ui']);

