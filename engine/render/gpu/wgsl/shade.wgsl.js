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
import { GROUND_LOOK_WGSL, LOOK_BLOCK_FIELDS, LOOK_GA_HI_SHIFT, LOOK_GA_W_SHIFT } from '../../groundLook.js'; // ENV-02d
import { TLOOK_WIDTH, MAX_FEATURES_PER_TYPE } from '../TerrainTextures.js';
import { KIND_TERRAIN, KIND_MODEL, KIND_MESH, KIND_GRASS, FACE_PACKED } from '../../GBuffer.js';
import { WET_DARK, WET_SPEC } from '../../detailShade.js';
import { VEG_TINT_WGSL } from '../../../mesh/vegTint.js'; // AUD-47
import { SUN_N_SHIFT, SUN_N_MASK, CLOUD_Q_SHIFT } from '../../shadowSun.js'; // CLOUD_Q_SHIFT: S8-B2-12c (38.13)
import { SKY_GLOW_WGSL } from '../../skyGlow.js';
import { SHADE_SHAFT_WGSL, SHAFT_SHIFT, SHAFT_Q } from '../../lightShaft.js'; // CANOPY-SHAFT-01b (38.76)
import { SKY_NIGHT_WGSL } from '../../skyNight.js'; // NIGHT-SKY-01
import { SKY_CLOUD_WGSL } from '../../skyCloud.js'; // CLOUD-FLUFF-01b
import { FOG_SHAPE_WGSL } from '../../fogShape.js';
import { SKYLINE_FOG_WGSL } from '../../skyline.js'; // MAP-06b (38.42)
import { UNDER_WGSL } from '../../underwater.js'; // SWIM-04c (38.54)
import { GI_SAMPLE_WGSL, giBindingWgsl } from '../../giGpu.js';
import { CAO_SUN_W } from '../../contactAO.js'; // 38.78 rev
import { CLIFF_NZ, FOREST_FACE_NZ, FOREST_FACE_K, FOREST_TRUNK_CHANCE, FOREST_TRUNK_SALT, FOREST_TRUNK_CODE, FAR_GLYPH_CELL, FAR_BLEND_FP0, FAR_BLEND_FP1, NOISE_CELLS, NOISE_W, NOISE_SALT, PATCH_K, FP_DEFAULT_K, FP_ANISO_T, FP_ANISO_MAX, GRASS_AO_LO, GRASS_TIP_H, GRASS_BASE_H, GRASS_LEAN_G, GRASS_LEVELS, GRASS_ROWS, GRASS_TINT_AMP, GRASS_GX_HAS, GRASS_BACKLIGHT_K, FG_SLOPE, FG_GUST, FG_MOD, FG_CODES, FG_TYPES } from '../../terrainShade.js';



const SHADE_FIELDS = [
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
  { name: 'skyCam', type: 'vec4' }, // AUD-40, APPENDED: shear-mode sky ray = (dirX + planeX*cx, dirY + planeY*cx): dirX, dirY, planeX, planeY
  { name: 'fogView', type: 'vec4' }, // AUD-45, APPENDED: x = eye height (m), y = 1 when height fog + sun in-scatter are on (terrain worlds), z = 1 outdoor mesh fog (OB-089), w unused
  { name: 'skyGlowOn', type: 'vec4' }, // AUD-40 fix, APPENDED: x = 1 when sky glow + horizon haze apply (compositor gate: terrain world + timeOfDay palette), written every frame; DN-02 y = night glyph-luminance floor (liveLook.floorEff, 0 = off)
  { name: 'skyline', type: 'vec4' }, // MAP-06b (38.42), APPENDED: far-terrain fog cap x fogMax (0 = off), y fromZ, z seaFogMax, w seaLevel
  { name: 'grass', type: 'vec4', count: 80 }, // OB-073 D2e, APPENDED: carpet variant table, 16 variants x GRASS_ROWS vec4 (terrainShade.js packGrassTable); all 0 = no carpet
  // SWIM-04c (38.54), APPENDED after grass: underwater look (underwater.js UNDER_WGSL). under.x = 0 skips the whole block.
  { name: 'under', type: 'vec4' }, // on, waterZ, fogM, causticK
  { name: 'underTint', type: 'vec4' }, // tint rgb 0..255, swapAt
  { name: 'underCam', type: 'vec4' }, // camera x, y, z (cell position = cam + ray * depth), lightK
  { name: 'underCeil', type: 'vec4' }, // ceil rgb
  { name: 'underCaus', type: 'vec4' }, // causticCol rgb
  { name: 'underRampB', type: 'vec4' }, // bubble ramp glyph indices (ascii - 32)
  { name: 'underRampC', type: 'vec4' }, // ceiling ramp glyph indices
  { name: 'cliff', type: 'vec4' }, // OB-104b2 (38.55), APPENDED after grass: x = rock type id (recipe.terrain.rock.id), y = 1 when the cliff look is on (0 = off; twin: ctx.cliffType >= 0)
  { name: 'fgP', type: 'vec4' }, // G2 + P3 (D-075 step 4), APPENDED: far grass tier. x = on, y = startM (carpet radius), z = fadeM, w = colour mix (terrainShade.js farGrassFill)
  { name: 'fgW', type: 'vec4' }, // far grass gust phase: dirX, dirY, cycles per second, 1 / travel (m/s)
  { name: 'fgT', type: 'vec4', count: FG_TYPES }, // far grass per ground type id: rgb bytes (carpet ramp middle), w = strength (0 = type has no far grass)
  { name: 'shaftA', type: 'vec4' }, // CANOPY-SHAFT-01b (38.76 item 4), APPENDED: (k, iso, pw, maxM); k = 0 skips the whole lift (byte-identical)
  // CLOUD-FLUFF-01b, APPENDED: GPU sky cloud deck (skyCloud.js). cloudA = on, seed, scale, bias | B = cover, puffK, wispCover, wispK | C = litK, litDy, bodyK, - | D = driftX, driftY, cloudBand0, cloudBand1 | E = cloudBand2 | lit/shade rgb 0..255. All 0 = no clouds.
  { name: 'cloudA', type: 'vec4' }, { name: 'cloudB', type: 'vec4' }, { name: 'cloudC', type: 'vec4' }, { name: 'cloudD', type: 'vec4' }, { name: 'cloudE', type: 'vec4' },
  { name: 'cloudLit', type: 'vec4' }, { name: 'cloudShade', type: 'vec4' },
];
export const SHADE_BLOCK = defineUniformBlock('ShadeU', SHADE_FIELDS);
/** ENV-02d: ShadeU + look table (appended: earlier word offsets unchanged); look pipelines only. */
export const SHADE_LOOK_BLOCK = defineUniformBlock('ShadeU', [...SHADE_FIELDS, ...LOOK_BLOCK_FIELDS]);

export const SHADE_TEXTURES = Object.freeze([
  'uint', 'uint', 'uint', 'uint', 'uint', 'uint', 'float', 'float', 'float', 'float', 'sint', 'sint', 'float', 'float', 'uint', 'float',
]);
export const SHADE_TARGETS = Object.freeze(['rgba8', 'rgba8']);

// MASK-c: band-limited patch noise (octave fade / value noise / patch field), shared with carpet.wgsl.js (needs hashFast from HASH_FAST_WGSL).
export const TS_PATCH_NOISE_WGSL = `fn tsOctFade(cell: f32, fp: f32) -> f32 {
  let s = clamp((cell / max(fp, 0.000001) - 1.5) / 1.5, 0.0, 1.0);
  return s * s * (3.0 - 2.0 * s);
}
fn tsValueNoise(x: f32, y: f32, salt: i32) -> f32 {
  let x0 = floor(x); let y0 = floor(y);
  let ix = i32(x0); let iy = i32(y0);
  var fx = x - x0; var fy = y - y0;
  fx = fx * fx * (3.0 - 2.0 * fx); fy = fy * fy * (3.0 - 2.0 * fy);
  let a = hashFast(ix, iy, salt); let b = hashFast(ix + 1, iy, salt); let c = hashFast(ix, iy + 1, salt); let d = hashFast(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
fn tsPatchNoise(u: f32, v: f32, fp: f32, v8: f32) -> f32 {
  let f0 = tsOctFade(${NOISE_CELLS[0].toFixed(4)}, fp);
  var ws = ${NOISE_W[0].toFixed(4)} * f0; var n = ws * (v8 * 2.0 - 1.0);
  let f1 = tsOctFade(${NOISE_CELLS[1].toFixed(4)}, fp);
  if (f1 > 0.0) { let w1 = ${NOISE_W[1].toFixed(4)} * f1; n += w1 * (tsValueNoise(u * ${(1 / NOISE_CELLS[1]).toFixed(4)}, v * ${(1 / NOISE_CELLS[1]).toFixed(4)}, ${NOISE_SALT + 1}) * 2.0 - 1.0); ws += w1; }
  let f2 = tsOctFade(${NOISE_CELLS[2].toFixed(4)}, fp);
  if (f2 > 0.0) { let w2 = ${NOISE_W[2].toFixed(4)} * f2; n += w2 * (tsValueNoise(u * ${(1 / NOISE_CELLS[2]).toFixed(4)}, v * ${(1 / NOISE_CELLS[2]).toFixed(4)}, ${NOISE_SALT + 2}) * 2.0 - 1.0); ws += w2; }
  return n / max(ws, 0.55);
}
`;

// glsl/terrain.frag.js TERRAIN_SHADE_GLSL (shadeTerrain), literal twin of terrainShade.js shadeTerrain.
const terrainShadeWgsl = (LK) => `
const MAX_FEATURES_PER_TYPE: i32 = ${MAX_FEATURES_PER_TYPE};
// ME-06b: literal twin of terrainShade.js's faceMode (0 surface, 1 canopy face, 2 foot row).
const FOREST_FACE_NZ: f32 = ${FOREST_FACE_NZ.toFixed(4)};

fn pickCodeFromPacked(x: i32, count: i32, idx: i32) -> i32 {
  let i = select(idx, count - 1, idx >= count);
  return (x >> u32(8 * i)) & 0xff;
}

// OB-073: literal twins of terrainShade.js groundFootprint / octaveFade / valueNoise / patchNoise (power-of-two cells: u * inv exact in f32).
fn tsFootprint(t: f32) -> f32 {
  if (su.hashCell > 0.0) { return su.hashCell; }
  let k = select(${FP_DEFAULT_K.toFixed(4)}, -su.hashCell, su.hashCell < 0.0);
  return k * t * clamp(t / ${FP_ANISO_T.toFixed(4)}, 1.0, ${FP_ANISO_MAX.toFixed(4)});
}
${TS_PATCH_NOISE_WGSL}

struct TerrainOut { fr: f32, fg: f32, fb: f32, br: f32, bg: f32, bb: f32, glyph: i32, fgw: f32 };

${SKYLINE_FOG_WGSL}
fn shadeTerrain(t: f32, typeIdIn: i32, b: f32, uIn: f32, vIn: f32, timeSec: f32, faceMode: i32, z: f32, nrm: vec3f${LK ? ', lookLo: i32, lookHi: i32, lookW: f32' : ''}) -> TerrainOut {
  // OB-104b (38.55) cliff: steep cell (N.z < CLIFF_NZ) of a type without forest-face glyphs -> rock type, (u, v) = (horizontal axis along the wall, z). Twin: terrainShade.js shadeTerrain, same 4 lines.
  var typeId = typeIdIn; var u = uIn; var v = vIn;
  if (su.cliff.y > 0.5 && nrm.z < ${CLIFF_NZ.toFixed(4)} && !(textureLoad(uTlook, vec2i(3, typeIdIn), 0).w > 0.0)) {
    typeId = i32(su.cliff.x);
    v = z;
    u = select(uIn, vIn, abs(nrm.x) > abs(nrm.y));
  }
  // OB-073: band-limited smooth value noise for the patch tier + 0.25 m glyph cell with one per-point switch (twin: terrainShade.js).
  let fp = tsFootprint(t);
  ${LK ? `var lk: LookOut;
  let lookOn = (lookLo | lookHi) != 0;
  var nP = 0.0;
  if (lookOn) { lk = lkShade(u, v, fp, t, timeSec, lookLo, lookHi, lookW); nP = 2.0 * lk.tone - 1.0; } // ENV-02d: look tone replaces the patch noise (twin: shadeTerrain lookOn)
  else { nP = tsPatchNoise(u, v, fp, tsValueNoise(u * ${(1 / NOISE_CELLS[0]).toFixed(4)}, v * ${(1 / NOISE_CELLS[0]).toFixed(4)}, ${NOISE_SALT})); }` : `let v8 = tsValueNoise(u * ${(1 / NOISE_CELLS[0]).toFixed(4)}, v * ${(1 / NOISE_CELLS[0]).toFixed(4)}, ${NOISE_SALT});
  let nP = tsPatchNoise(u, v, fp, v8);`}
  // OB-073 calm ground: colour tier only from the smooth noise (no per-cell dither dice); ONE glyph per type (no hash, no band/close/glint).
  let pk = nP * ${PATCH_K.toFixed(4)}; let pkF = floor(pk); // OB-208 soft patch edge (twin: terrainShade.js)
  let pw = clamp(${PATCH_K.toFixed(4)} * fp * ${(1 / NOISE_CELLS[0]).toFixed(10)}, 0.08, 0.5);
  let pq = clamp((pk - pkF - (0.5 - pw)) / (2.0 * pw), 0.0, 1.0);
  let off = clamp(pkF + pq * pq * (3.0 - 2.0 * pq), -1.0, 1.0);

  // S8-B2-14b wetness: darkens the lit term entering the tier/gain pick, same WET_DARK as detailShade.js/shadeCore
  // (terrain has no emissive term to keep separate - the whole incoming b is the "lit term" here).
  var bWet = b * (1.0 - ${WET_DARK.toFixed(4)} * su.wetness);
  if (su.skyGlowOn.y > 0.0 && bWet < su.skyGlowOn.y) { bWet = su.skyGlowOn.y; } // DN-02 night floor (twin: terrainShade.js)

  // 23.4 near-detail: close (< closeBand) gets a +-0.08 brightness jitter (own hash salt 10, per-cell).
  let close = su.nearDetailOn != 0 && t < su.closeBand;
  var bEff = bWet;
  if (close) { // OB-054: jitter fades smoothstep to 0 over closeBand/2..closeBand (twin: terrainShade.js)
    let q = clamp((t - su.closeBand * 0.5) / (su.closeBand * 0.5), 0.0, 1.0);
    bEff = bWet + nP * 0.05 * (1.0 - q * q * (3.0 - 2.0 * q));
  }

  var tier = 2;
  if (bEff < 0.45) { tier = 0; } else if (bEff < 0.8) { tier = 1; }
  var ii = clamp(f32(tier) + off, 0.0, 2.0);
  // OB-081: far ground blends the tier colours continuously (twin: terrainShade.js FAR_BLEND_FP0/FP1); fw 0 = hard tiers.
  let sc = clamp(0.5 + (bEff - 0.45) * ${(1 / 0.35).toFixed(10)} + off, 0.0, 2.0);
  var fw = clamp((fp - ${FAR_BLEND_FP0.toFixed(4)}) * ${(1 / (FAR_BLEND_FP1 - FAR_BLEND_FP0)).toFixed(10)}, 0.0, 1.0);
  fw = fw * fw * (3.0 - 2.0 * fw);
  let xf = ii + (sc - ii) * fw;
  let i0 = i32(floor(xf)); let i1 = min(i0 + 1, 2); let fxb = xf - f32(i0);

  let base = typeId; // TLOOK row = type id (texel x = 0..6, see TerrainTextures.js)
  let t0a = textureLoad(uTlook, vec2i(i0, base), 0);
  let t0b = textureLoad(uTlook, vec2i(i1, base), 0);
  // TLOOK colours are linear 0..1 (GPU texel layout); bytes are 0..255 (BUG-OWN-004).
  var fr = (t0a.r + (t0b.r - t0a.r) * fxb) * 255.0; var fgc = (t0a.g + (t0b.g - t0a.g) * fxb) * 255.0; var fbc = (t0a.b + (t0b.b - t0a.b) * fxb) * 255.0;
  // gainOf(bEff, shading) port - same gain formula shadeCore uses.
  let bcc = max(bEff, 0.0);
  var gain = su.fgMin + (1.0 - su.fgMin) * samplePowLUT(min(bcc, 1.0));
  if (bcc > 1.0) { gain = min(su.fgMaxGain, gain + (bcc - 1.0) * 0.5); }
  gain = wetGain(gain, bEff);
  fr *= gain; fgc *= gain; fbc *= gain;
  var br = fr * 0.3; var bgc = fgc * 0.3; var bbc = fbc * 0.3;

  // OB-073: the calm glyph = middle entry of the NEAR glyph set (TLOOK texel 4), same at every distance/time/point.
  let gT = textureLoad(uTlook, vec2i(4, base), 0);
  let packedX = i32(gT.x); let packedCount = i32(gT.y);
  var code = pickCodeFromPacked(packedX, packedCount, packedCount >> 1u);
${LK ? `  if (lookOn) { fr = lk.fr * 255.0 * gain; fgc = lk.fg * 255.0 * gain; fbc = lk.fb * 255.0 * gain; br = lk.br * 255.0 * gain; bgc = lk.bg * 255.0 * gain; bbc = lk.bb * 255.0 * gain; code = lk.code; }
` : ''}
  // G2 + P3 far grass tier (twin: terrainShade.js shadeTerrain, same lines). fgw = weight, > 0 = stable level 254.
  var fgw = 0.0; var fgAnimW = 0.0;
  if (su.fgP.x > 0.5 && (!close || su.fgP.x > 1.0)) { // OB-121b: fgP.x = on * (1 + underlay)
    let fst = su.fgT[typeId].w;
    if (fst > 0.0) {
      let fw0 = clamp((t - su.fgP.y) / su.fgP.z, 0.0, 1.0);
      let fwr = fw0 * fw0 * (3.0 - 2.0 * fw0);
      let fstat = (su.fgP.x - 1.0) > fwr; // OB-154: underlay-won cell = static (no gust phase)
      fgw = max(su.fgP.x - 1.0, fwr) * fst; fgAnimW = select(fgw, 0.0, fstat);
      if (fgw > 0.0) {
        var tri = 0.5;
        if (!fstat) {
          var ph = (timeSec - (u * su.fgW.x + v * su.fgW.y) * su.fgW.w) * su.fgW.z; ph = ph - floor(ph);
          tri = 1.0 - abs(2.0 * ph - 1.0); tri = tri * tri * (3.0 - 2.0 * tri);
        }
        let sg = clamp(nP * ${FG_SLOPE.toFixed(4)} + (tri - 0.5) * ${FG_GUST.toFixed(4)}, -1.0, 1.0);
${LK ? `        if (fgw > 0.5 - 0.4 * sg) { code = select(select(${FG_CODES[1]}, ${FG_CODES[2]}, sg > 0.33), ${FG_CODES[0]}, sg < -0.33); if (lookOn) { code = select(select(lk.g1, lk.g2, sg > 0.33), lk.g0, sg < -0.33); } }
        let km = fgw * su.fgP.w * (1.0 + ${FG_MOD.toFixed(4)} * sg);
        if (lookOn) { fr += (lk.tr * 255.0 * gain - fr) * km; fgc += (lk.tg * 255.0 * gain - fgc) * km; fbc += (lk.tb * 255.0 * gain - fbc) * km; }
        else {
          fr += (su.fgT[typeId].x * gain - fr) * km; fgc += (su.fgT[typeId].y * gain - fgc) * km; fbc += (su.fgT[typeId].z * gain - fbc) * km;
          br = fr * 0.3; bgc = fgc * 0.3; bbc = fbc * 0.3;
        }
` : `        if (fgw > 0.5 - 0.4 * sg) { code = select(select(${FG_CODES[1]}, ${FG_CODES[2]}, sg > 0.33), ${FG_CODES[0]}, sg < -0.33); }
        let km = fgw * su.fgP.w * (1.0 + ${FG_MOD.toFixed(4)} * sg);
        fr += (su.fgT[typeId].x * gain - fr) * km; fgc += (su.fgT[typeId].y * gain - fgc) * km; fbc += (su.fgT[typeId].z * gain - fbc) * km;
        br = fr * 0.3; bgc = fgc * 0.3; bbc = fbc * 0.3;
`}      }
    }
  }

  let t3 = textureLoad(uTlook, vec2i(3, base), 0);

  // ME-06b: background canopy FACE look: TLOOK texel 3 .z/.w = face glyphs + count (forest only), texel 16 = trunk colour.
  if (faceMode != 0 && t3.w > 0.5 && !close && t >= su.bandNear) {
    let faceCount = i32(t3.w);
    let fx4 = i32(floor(u / ${FAR_GLYPH_CELL.toFixed(4)})); let fy4 = i32(floor(v / ${FAR_GLYPH_CELL.toFixed(4)}));
    let fpH = select(select(${FP_DEFAULT_K.toFixed(4)}, -su.hashCell, su.hashCell < 0.0) * t, su.hashCell, su.hashCell > 0.0); // faces stand upright: cell WIDTH
    let calm = fpH > ${(FAR_GLYPH_CELL * 0.5).toFixed(4)}; // OB-081: fixed face glyph + no trunks once a cell covers half a face cell
    let trunk = !calm && faceMode == 2 && hashFast(fx4, fy4, ${FOREST_TRUNK_SALT}) < ${FOREST_TRUNK_CHANCE.toFixed(10)};
    if (trunk) { code = ${FOREST_TRUNK_CODE}; }
    else { code = pickCodeFromPacked(i32(t3.z), faceCount, select(select(i32(hashFast(fx4, fy4, 7) * f32(faceCount)), faceCount >> 1u, calm), faceCount - 1, faceMode == 2)); }
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
  f = skylineFogF(f, t, typeId, z, su.skyline); // MAP-06b (38.42): far peaks / sea line fog cap (x = 0: unchanged)
  let fcr = su.terrainFogNearRGB.x + (su.terrainFogFarRGB.x - su.terrainFogNearRGB.x) * f;
  let fcg = su.terrainFogNearRGB.y + (su.terrainFogFarRGB.y - su.terrainFogNearRGB.y) * f;
  let fcb = su.terrainFogNearRGB.z + (su.terrainFogFarRGB.z - su.terrainFogNearRGB.z) * f;
  fr += (fcr - fr) * f; fgc += (fcg - fgc) * f; fbc += (fcb - fbc) * f;
  let fBg = min(1.0, 1.1 * f);
  br += (fcr - br) * fBg; bgc += (fcg - bgc) * fBg; bbc += (fcb - bbc) * fBg;
  if (f > 0.85) { code = 0; }

  var o: TerrainOut;
  o.fr = fr; o.fg = fgc; o.fb = fbc; o.br = br; o.bg = bgc; o.bb = bbc; o.glyph = code; o.fgw = ${LK ? 'select(fgAnimW, 1.0, lookOn && lk.anim > 0.0)' : 'fgAnimW'};
  return o;
}
// OB-073 D2e: kind-10 carpet blade (twin: terrainShade.js shadeGrass). No skyline cap, glyph by h01 / lean, colour = ramp(h01 + tint).
fn shadeGrass(t: f32, variant: i32, h01: f32, lean: f32, tint: f32, b: f32, gx: u32, sunI: f32) -> TerrainOut {
  var bE = b * (1.0 - ${WET_DARK.toFixed(4)} * su.wetness);
  if (su.skyGlowOn.y > 0.0 && bE < su.skyGlowOn.y) { bE = su.skyGlowOn.y; }
  let bcc = max(bE, 0.0);
  var gain = su.fgMin + (1.0 - su.fgMin) * samplePowLUT(min(bcc, 1.0));
  if (bcc > 1.0) { gain = min(su.fgMaxGain, gain + (bcc - 1.0) * 0.5); }
  gain = wetGain(gain, bE);
  let x = clamp(h01 + tint, 0.0, 1.0);
  let gb = variant * ${GRASS_ROWS};
  let n = max(i32(su.grass[gb].w), 2);
  let xf = x * f32(n - 1);
  let i0 = min(i32(floor(xf)), n - 2);
  let fx = xf - f32(i0);
  let c0 = su.grass[gb + i0].xyz; let c1 = su.grass[gb + i0 + 1].xyz;
  var cr = c0.x + (c1.x - c0.x) * fx; var cg = c0.y + (c1.y - c0.y) * fx; var cb = c0.z + (c1.z - c0.z) * fx;
  // MASK-c: base = calm ground under the root (TLOOK tier colour), tip = the variant ramp; w = h01 / groundTint (twin: terrainShade.js shadeGrass)
  if ((gx & ${GRASS_GX_HAS}u) != 0u) {
    let gt = textureLoad(uTlook, vec2i(i32((gx >> 24u) & 3u), i32((gx >> 16u) & 255u)), 0);
    let w = clamp(h01 / su.grass[gb + 4].z, 0.0, 1.0);
    cr = gt.r * 255.0 + (cr - gt.r * 255.0) * w; cg = gt.g * 255.0 + (cg - gt.g * 255.0) * w; cb = gt.b * 255.0 + (cb - gt.b * 255.0) * w;
  }
  var fr = cr * gain; var fgc = cg * gain; var fbc = cb * gain;
  let bl = f32((gx >> 8u) & 255u) * (1.0 / 255.0);
  if (bl > 0.0) { // MASK-c back-light: sun behind the blade warm-brightens the upper part, capped
    let gl = ${GRASS_BACKLIGHT_K.toFixed(4)} * bl * h01 * h01 * min(sunI, 1.0);
    fr *= 1.0 + gl; fgc *= 1.0 + gl * 0.75; fbc *= 1.0 + gl * 0.25;
  }
  var br = fr * 0.3; var bgc = fgc * 0.3; var bbc = fbc * 0.3;
  var code = i32(select(select(su.grass[gb + 2].w, su.grass[gb + 1].w, h01 < ${GRASS_BASE_H.toFixed(4)}), su.grass[gb + 3].w, h01 > ${GRASS_TIP_H.toFixed(4)}));
  if (lean < -${GRASS_LEAN_G.toFixed(4)}) { code = i32(su.grass[gb + 4].x); } else if (lean > ${GRASS_LEAN_G.toFixed(4)}) { code = i32(su.grass[gb + 4].y); }
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
export const TERRAIN_SHADE_WGSL = terrainShadeWgsl(false);
/** ENV-02d: shadeTerrain with the look splice (+ GROUND_LOOK_WGSL); only used by the look pipelines. */
export const TERRAIN_SHADE_LOOK_WGSL = GROUND_LOOK_WGSL + terrainShadeWgsl(true);

// US-073b (38.25): the stable-glyph variant adds one r8uint target `lvl` (@location(2)) = the ramp level of the picked glyph (255 = none /
// passthrough / terrain / line / fog stipple). `L` holds the four text splices; with withLevel=false every splice is '' and the
// string is byte-identical to the pre-073b shader (asserted by sha in shade.wgsl.test.js).
function buildShadeWgsl(withLevel, look = false) {
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
      // OB-073 calm ground: no shimmer branch any more (glint removed), terrain is always level 255 (twin: terrainShade.js LEVEL_NONE)
      terr: ' o.lvl = select(255u, 254u, to.fgw > 0.0);', // G2 + P3: far-grass cells animate (twin: terrainShade.js out.level)
      grass: ' o.lvl = gLv;', // OB-073 D2e: kind-10 stable level = ramp position bucket (twin: shadeGrass out.level)
    }
    : { field: '', init: '', vars: '', set: '', stip: '', out: '', terr: '', grass: '' };
  return `
${look ? SHADE_LOOK_BLOCK.wgsl : SHADE_BLOCK.wgsl}
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

${look ? TERRAIN_SHADE_LOOK_WGSL : TERRAIN_SHADE_WGSL}

${SKY_GLOW_WGSL}
${SKY_NIGHT_WGSL}
${SKY_CLOUD_WGSL}
${FOG_SHAPE_WGSL}
${SHADE_SHAFT_WGSL}
// CANOPY-SHAFT-01b: lift colour toward FOG_SUN_TINT * sunI by weight w (oracle lightShaft.js shaftLift: bg w, fg w * 0.5).
fn shaftLiftC(c: vec3f, w: f32, sunI: f32) -> vec3f { return c + (FOG_SUN_TINT * sunI - c) * w; }
fn shaftQ(cell: vec2i) -> i32 { return i32((textureLoad(uLightTex, cell, 0).w >> ${SHAFT_SHIFT}u) & ${SHAFT_Q}u); }
${UNDER_WGSL}
// AUD-45: unit view direction of a cell for the standard fog (same rays as the sky: shear basis / pitched / ortho F).
fn fogCellDir(cell: vec2i, gridSize: vec2i) -> vec3f {
  if (su.projMode == 0) {
    let cx = (2.0 * (f32(cell.x) + 0.5)) / f32(gridSize.x) - 1.0;
    let hx = su.skyCam.x + su.skyCam.z * cx; let hy = su.skyCam.y + su.skyCam.w * cx;
    let tanE = (su.horizonRow - f32(cell.y)) / su.planeDistY;
    let ce = inverseSqrt(1.0 + tanE * tanE);
    return vec3f(vec2f(hx, hy) * (inverseSqrt(max(hx * hx + hy * hy, 1e-12)) * ce), tanE * ce);
  }
  return normalize(select(pitchedCellDir(vec2f(cell), gridSize), su.pitchA.xyz, su.projMode == 2));
}
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
// OB-197: footprint-aware bevel (twin of detailShade.js bevelShadeK): box-filter of the top/bottom bevel bands over the cell's v-footprint.
fn bevelShadeK(yv: f32, cov: f32, gv: f32, top: f32, topShade: f32, bottom: f32, bottomShade: f32) -> f32 {
  let mean = (top * (topShade - 1.0) + bottom * (bottomShade - 1.0)) / gv;
  if (cov >= gv) { return 1.0 + mean; }
  let h = max(cov, 1.0e-6) * 0.5; let lo = yv - h; let hi = yv + h; let w = h * 2.0;
  var tf = min(hi, gv) - max(lo, gv - top); tf = select(0.0, tf / w, tf > 0.0);
  var bf = min(hi, bottom) - max(lo, 0.0); bf = select(0.0, bf / w, bf > 0.0);
  if (lo < 0.0) { let t2 = gv - max(lo + gv, gv - top); if (t2 > 0.0) { tf += t2 / w; } }
  else if (hi > gv) { let b2 = min(hi - gv, bottom); if (b2 > 0.0) { bf += b2 / w; } }
  tf = min(tf, 1.0); bf = min(bf, 1.0);
  return 1.0 + tf * (topShade - 1.0) + bf * (bottomShade - 1.0);
}

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
    shadeK *= bevelShadeK(yv, abs(dvdx) + abs(dvdy), gv, top, topShade, bottom, bottomShade);
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
  var b = Lm * albedo * shadeK * fk * aok * jit * (1.0 - ${WET_DARK.toFixed(4)} * su.wetness) + mf1.x;
  if (su.skyGlowOn.y > 0.0 && b < su.skyGlowOn.y) { b = su.skyGlowOn.y; } // DN-02 night floor (twin: detailShade.js shadeCore)
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

fn shadeCell(frag: vec4f) -> FO {
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
      var skyDir: vec3f;
      if (su.projMode == 0) {
        // AUD-40: shear mode has no per-cell 3D ray; rebuild it from the camera basis (same cameraX as the CPU fillSky).
        let cx = (2.0 * (f32(cell.x) + 0.5)) / f32(gridSize.x) - 1.0;
        let hx = su.skyCam.x + su.skyCam.z * cx; let hy = su.skyCam.y + su.skyCam.w * cx;
        let er = radians(elevDeg);
        skyDir = vec3f(hx, hy, 0.0) * (cos(er) * inverseSqrt(max(hx * hx + hy * hy, 1e-12)));
        skyDir.z = sin(er);
      } else {
        skyDir = normalize(select(pitchedCellDir(vec2f(cell), gridSize), su.pitchA.xyz, su.projMode == 2));
      }
      var col255 = textureLoad(uSky, vec2i(idx, 0), 0).rgb;
      var fg255 = col255; var starG = 0;
      var cloudG = 0;
      if (su.cloudA.x > 0.5) { // CLOUD-FLUFF-01b (twin: sky.js cloudAt); off = branch skipped = byte-identical
        let cl = skyCloud(col255, skyDir, elevDeg, select(1.0, su.sunI, su.skyGlowOn.x > 0.5));
        col255 = cl.bg; fg255 = cl.fg; cloudG = cl.g;
      }
      if (su.skyGlowOn.x > 0.5) { // gated like compositor.js (sun === null skips glow+haze)
        col255 = skyGlow(col255, skyDir, elevDeg, su.sunDir, su.sunI, u32(cell.x), u32(cell.y));
        if (cloudG != 0) { fg255 = skyGlow(fg255, skyDir, elevDeg, su.sunDir, su.sunI, u32(cell.x), u32(cell.y)); }
        let sn = skyNight(col255, skyDir, elevDeg, su.sunDir, su.sunI, su.timeSec); // NIGHT-SKY-01 (twin: skyNight.js applySkyNight; day = untouched)
        if (cloudG == 0) { fg255 = sn.fg; starG = sn.g; }
        else if (any(sn.bg != col255)) { fg255 = sn.bg; } // moon disc covers cloud fg too; stars never replace a cloud glyph
        col255 = sn.bg;
      } else if (cloudG == 0) { fg255 = col255; }
      if (cloudG != 0) { starG = cloudG; }
      if (su.shaftA.x > 0.0) { // CANOPY-SHAFT-01b: sky cells get the same lift (len = maxM, f = 0); glyph untouched
        let sq = shaftQ(cell);
        if (sq > 0) { let sw = shaftW(sq, su.shaftA.w, dot(skyDir, su.sunDir), su.sunI, su.shaftA.x, su.shaftA.y, su.shaftA.z, su.shaftA.w, 0.0); col255 = shaftLiftC(col255, sw, su.sunI); fg255 = shaftLiftC(fg255, sw * 0.5, su.sunI); }
      }
      o.fg = vec4f(toByte01(fg255.r), toByte01(fg255.g), toByte01(fg255.b), f32(starG) / 255.0);
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
    // CONTACT-AO-01b (38.78): contact-AO byte (LIGHT.w bits 1..7) scales the analytic ambient; q 0 -> exactly 1.0 (bit-identical).
    let caoQT = (lightT.w >> 1u) & 127u;
    let caoFt = select(1.0, f32(127u - caoQT) * (1.0 / 127.0), caoQT != 0u);
    let caoSt = select(1.0, 1.0 - ${CAO_SUN_W.toFixed(4)} * f32(caoQT) * (1.0 / 127.0), caoQT != 0u); // 38.78 rev: sun part too
    let bSunT = su.ambientI * caoFt + su.sunI * max(0.0, ndotlT) * sunFT * cFt * caoSt;
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
${look ? `    let to = shadeTerrain(distT, typeId, bT, uT, vT, su.timeSec, faceModeT, bitcast<f32>(gaT.z), Nt, i32(gaT.w & 15u), i32((gaT.w >> ${LOOK_GA_HI_SHIFT}u) & 15u), f32((gaT.w >> ${LOOK_GA_W_SHIFT}u) & 255u) * (1.0 / 255.0));` : `    let to = shadeTerrain(distT, typeId, bT, uT, vT, su.timeSec, faceModeT, bitcast<f32>(gaT.z), Nt);`}
    let frQ = floor(clamp(to.fr, 0.0, 255.0) + 0.5);
    let fgQ = floor(clamp(to.fg, 0.0, 255.0) + 0.5);
    let fbQ = floor(clamp(to.fb, 0.0, 255.0) + 0.5);
    o.fg = vec4f(toByte01(frQ + LcT.x * 0.5 * 255.0), toByte01(fgQ + LcT.y * 0.5 * 255.0), toByte01(fbQ + LcT.z * 0.5 * 255.0), toByte01(f32(to.glyph)));
    o.bg = vec4f(toByte01(to.br), toByte01(to.bg), toByte01(to.bb), 1.0);${L.terr}
    return o;
  }

  // OB-073 D2e: kind 10 (carpet blade): lit like terrain (GI.z = lean-tilted normal, GA.w = colour shift), AO mix(0.55, 1, h01) on the ambient.
  if (kindU == ${KIND_GRASS}u) {
    let gaG = textureLoad(uGA, cell, 0);
    let hG = bitcast<f32>(gaG.x); let lnG = bitcast<f32>(gaG.y); let tnG = (f32(gaG.w & 255u) * (1.0 / 255.0) * 2.0 - 1.0) * ${GRASS_TINT_AMP.toFixed(4)}; // MASK-c: tint byte of the packed GA.w word
    let NG = unpackNormalOct(textureLoad(uGI, cell, 0).z);
    let ndotlG = NG.x * su.sunDir.x + NG.y * su.sunDir.y + NG.z * su.sunDir.z;
    let lightG = textureLoad(uLightTex, cell, 0);
    var sunFG = 1.0;
    if (su.sunMapOn != 0) { sunFG = f32((lightG.w >> ${SUN_N_SHIFT}u) & ${SUN_N_MASK}u) * 0.25; }
    let cFg = 1.0 - f32((lightG.w >> ${CLOUD_Q_SHIFT}u) & 255u) * (1.0 / 255.0);
    let caoQG = (lightG.w >> 1u) & 127u;
    let caoFg = select(1.0, f32(127u - caoQG) * (1.0 / 127.0), caoQG != 0u);
    let caoSg = select(1.0, 1.0 - ${CAO_SUN_W.toFixed(4)} * f32(caoQG) * (1.0 / 127.0), caoQG != 0u);
    let bG = su.ambientI * (${GRASS_AO_LO.toFixed(4)} + ${(1 - GRASS_AO_LO).toFixed(4)} * hG) * caoFg + su.sunI * max(0.0, ndotlG) * sunFG * cFg * caoSg;
    let LcG = bitcast<vec3f>(lightG.xyz);
    var distG = bitcast<f32>(textureLoad(uDepth, cell, 0).x);
    if (su.projMode != 0) { distG *= fogScaleCell(cell.y, gridSize.y); }
    let go = shadeGrass(distG, i32(giMat(gi.y)), hG, lnG, tnG, bG + max(LcG.x, max(LcG.y, LcG.z)), gaG.w, su.sunI);
    let gLv = u32(floor(clamp(hG + tnG, 0.0, 1.0) * ${GRASS_LEVELS}));
    let grQ = floor(clamp(go.fr, 0.0, 255.0) + 0.5);
    let ggQ = floor(clamp(go.fg, 0.0, 255.0) + 0.5);
    let gbQ = floor(clamp(go.fb, 0.0, 255.0) + 0.5);
    o.fg = vec4f(toByte01(grQ + LcG.x * 0.5 * 255.0), toByte01(ggQ + LcG.y * 0.5 * 255.0), toByte01(gbQ + LcG.z * 0.5 * 255.0), toByte01(f32(go.glyph)));
    o.bg = vec4f(toByte01(go.br), toByte01(go.bg), toByte01(go.bb), 1.0);${L.grass}
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

  var f = select(select((dist - su.fogStart) / (su.fogFull - su.fogStart), 1.0, dist >= su.fogFull), 0.0, dist <= su.fogStart);
  var fogFgC = su.fogFg; var fogBgC = su.fogBg;
  if (su.fogView.z > 0.5) { // OB-089: outdoor mesh fog = the terrain's far fog (twin: detailShade.js shadeTail, fogShapeCtx.outdoor); fg == bg
    f = clamp((dist - su.terrainFogStart) / (su.terrainFogFull - su.terrainFogStart), 0.0, 1.0);
    f = select(pow(f, su.terrainFogCurve), f, su.terrainFogCurve == 1.0);
    let oc = su.terrainFogNearRGB + (su.terrainFogFarRGB - su.terrainFogNearRGB) * f;
    fogFgC = oc; fogBgC = oc;
  }
  if (su.fogView.y > 0.5 && su.fogView.z < 0.5 && f > 0.0) { // AUD-45: height fog + sun in-scatter (only where f > 0); OB-204: not for outdoor meshes (terrain has none, so far meshes came out paler than the hills)
    let fd = fogCellDir(cell, gridSize);
    f = fogShapeF(f, dist, su.fogView.x, fd.z * inverseSqrt(max(fd.x * fd.x + fd.y * fd.y, 1e-12)));
    let sw = fogScatterW(dot(fd, su.sunDir), su.sunDir.z, su.sunI);
    fogFgC += (FOG_SUN_TINT - fogFgC) * sw; fogBgC += (FOG_SUN_TINT - fogBgC) * sw;
  }

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
    rgbF += (fogFgC - rgbF) * f;
    rgbBg += (fogBgC - rgbBg) * f;
  }
  if (su.shaftA.x > 0.0) { // CANOPY-SHAFT-01b: colour lift after fog, before the output pack; glyph never changes
    let sq = shaftQ(cell);
    if (sq > 0) {
      let sfd = fogCellDir(cell, gridSize);
      let sw = shaftW(sq, dist, dot(sfd, su.sunDir), su.sunI, su.shaftA.x, su.shaftA.y, su.shaftA.z, su.shaftA.w, f);
      rgbBg = shaftLiftC(rgbBg, sw, su.sunI); rgbF = shaftLiftC(rgbF, sw * 0.5, su.sunI);
    }
  }

  o.fg = vec4f(toByte01(rgbF.x), toByte01(rgbF.y), toByte01(rgbF.z), toByte01(f32(glyphCode)));
  o.bg = vec4f(toByte01(rgbBg.x), toByte01(rgbBg.y), toByte01(rgbBg.z), 1.0);${L.out}
  return o;
}

// SWIM-04c: the underwater look runs once per GPU-shaded cell (bg.a = 1; passthrough/masked cells keep the JS layer) at the end of the pass.
@fragment
fn fs_main(@builtin(position) frag: vec4f) -> FO {
  var o = shadeCell(frag);
  if (su.under.x < 0.5 || o.bg.a < 0.5) { return o; }
  let cell = vec2i(floor(frag.xy));
  let gridSize = vec2i(textureDimensions(uGI));
  let dRaw = bitcast<f32>(textureLoad(uDepth, cell, 0).x);
  let sky = giKind(textureLoad(uGI, cell, 0).y) == 0u || !(dRaw < 1e8);
  let fd = fogCellDir(cell, gridSize);
  var Px = su.underCam.x; var Py = su.underCam.y; var Pz = 1e30; var Lw = 1e9;
  if (sky) { Px = fd.x * 64.0; Py = fd.y * 64.0; }
  else { Lw = dRaw; Px += fd.x * Lw; Py += fd.y * Lw; Pz = su.underCam.z + fd.z * Lw; }
  let r = underShadeW(o.fg.xyz * 255.0, o.bg.xyz * 255.0, i32(o.fg.w * 255.0 + 0.5), Lw, Pz, Px, Py, su.timeSec);
  o.fg = vec4f(toByte01(r.fg.x), toByte01(r.fg.y), toByte01(r.fg.z), toByte01(f32(r.glyph)));
  o.bg = vec4f(toByte01(r.bg.x), toByte01(r.bg.y), toByte01(r.bg.z), 1.0);
  return o;
}
`;
}

export const SHADE_WGSL = buildShadeWgsl(false);
export const SHADE_LEVEL_WGSL = buildShadeWgsl(true);
/** ENV-02d: ShadeU + the look table (uniform), look pipelines only; the plain SHADE_WGSL / SHADE_LEVEL_WGSL stay byte-identical. */
export const SHADE_LOOK_WGSL = buildShadeWgsl(false, true);
export const SHADE_LEVEL_LOOK_WGSL = buildShadeWgsl(true, true);
export const SHADE_LEVEL_TARGETS = Object.freeze(['rgba8', 'rgba8', 'r8ui']);


// GI-PROBE-05 (arch 38.72): GI variants of the shade pipelines. The terrain / carpet analytic ambient `ambientI` is scaled by
// (GI ambient / flat sky colour) from the baked probe field (storage buffer binding 16, after the 16 textures: the texture limit is full).
// Exact text splices on the plain builders, so SHADE_WGSL & co (GI off) stay byte-identical. Twin: terrainShade.js giTerrainK.
function giSplice(src, from, to) { if (!src.includes(from)) throw new Error('shade.wgsl GI splice: anchor missing: ' + from); return src.replace(from, to); }
function shadeGi(src) {
  let s = giSplice(src, '@group(1) @binding(0) var<uniform> su: ShadeU;', '@group(1) @binding(0) var<uniform> su: ShadeU;\n' + giBindingWgsl(16) + '\n' + GI_SAMPLE_WGSL);
  s = giSplice(s, 'let bSunT = su.ambientI * caoFt + su.sunI', 'let bSunT = su.ambientI * giTerrK(uT, vT, bitcast<f32>(gaT.z), Nt) * caoFt + su.sunI');
  s = giSplice(s, 'let bG = su.ambientI * (', 'let bG = su.ambientI * giTerrK(hG, lnG, bitcast<f32>(gaG.z), NG) * (');
  return s;
}
export const SHADE_GI_WGSL = shadeGi(SHADE_WGSL);
export const SHADE_LEVEL_GI_WGSL = shadeGi(SHADE_LEVEL_WGSL);
export const SHADE_LOOK_GI_WGSL = shadeGi(SHADE_LOOK_WGSL);
export const SHADE_LEVEL_LOOK_GI_WGSL = shadeGi(SHADE_LEVEL_LOOK_WGSL);
export const SHADE_GI_BUFFERS = Object.freeze(['read']);
