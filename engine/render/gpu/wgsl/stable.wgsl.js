// US-073b (docs/architecture.md 38.25): WGSL pass `stable` - temporal glyph stability. Literal twin of temporalStable.js `stabilize()`
// (US-073a): per cell reproject the current surface point into the PREVIOUS camera, take history cell floor(x + 0.5) (never round():
// WGSL round is half-to-even), then integer-only snap/blend/glyph-hold. Only the reprojection is float (f32 here vs the f64 twin): the
// twin's tie mask marks the half-cell / half-texel cases where the two may disagree; every other cell must be byte-identical.
// Reprojection is eye-relative: P - eyePrev = dEye + vd * dirCur (dEye = eyeCur - eyePrev, subtracted on the host in f64), so both
// term sets are written with eye = 0 and only the basis vectors are in the uniform block.
// Deviations from the text of the twin: the per-cell decision lives in `stableCell` (scalar math + packed 0xRRGGBB results so Node can
// probe it through wgslProbe); it rejects in the twin's order (invalid, sky/model/level 255, edge, water, vd, reproject, kind/plane, level, UV).
// Inputs (@group(0), textureLoad only): 0 GI (rgba32uint: x planeId, y kind|..), 1 GA (rgba32uint: x u bits, y v bits), 2 DEPTH (r32uint f32 bits
// of vd), 3 SHADE_FG / 4 SHADE_BG (rgba8: the edge pass INPUT - the water composite output when water is on), 5 FINAL_FG / 6 FINAL_BG (rgba8:
// the edge output; fg.a = glyph/255), 7 LEVEL (r8uint, shade's 3rd target, 255 = none), 8 WATER (rgba32uint layer: x = f32 bits of vD,
// +Inf = none), 9 HIST_FG / 10 HIST_BG (rgba8: last frame's output, the ping-pong partner), 11 HIST (rgba32uint: planeId, u bits, v bits,
// level | kind << 8 (4 bits) | vmTag << 12 | mat << 16). @group(1) @binding(0) = StableU. Targets (32 B, the attachment limit): 0 OUT_FG, 1 OUT_BG (rgba8; bg.a copied from final),
// 2 OUT_HIST (rgba32uint, same layout as HIST).
// Edge cells are detected without touching the edge pass: final != shade (any rgb byte or the glyph) -> pass final through (38.25 item 3).
import { defineUniformBlock } from './uniformBlock.js';
import { GBUF_UNPACK_WGSL, FULLSCREEN_VS_WGSL, REPROJECT_WGSL } from './common.wgsl.js';
import { KIND_NONE, KIND_MODEL, KIND_MESH, KIND_TERRAIN } from '../../GBuffer.js';
import { F_SOFT_EDGE } from '../ShadeTextures.js'; // AA-26
import { LEVEL_NONE, LEVEL_ANIM, UV_LIM_TEXELS, STABLE_FOOT_K, GRAZE_K, GRAZE_CAP } from '../../temporalStable.js';

export const STABLE_BLOCK = defineUniformBlock('StableU', [
  { name: 'curA', type: 'vec4' },   // current terms: fX, fY, fZ, tanHalfX (halfW when ortho)
  { name: 'curB', type: 'vec4' },   // rX, rY, uX, uY
  { name: 'curC', type: 'vec4' },   // uZ, tanHalfY (halfH when ortho), 0, 0
  { name: 'prevA', type: 'vec4' },  // previous terms, same packing
  { name: 'prevB', type: 'vec4' },
  { name: 'prevC', type: 'vec4' },
  { name: 'dEye', type: 'vec4' },   // eyeCur - eyePrev (f64 on the host), w unused
  { name: 'gridCols', type: 'i32' }, { name: 'gridRows', type: 'i32' }, { name: 'histValid', type: 'i32' }, { name: 'ortho', type: 'i32' },
  { name: 'snap', type: 'i32' }, { name: 'detailDefault', type: 'f32' }, { name: 'waterOn', type: 'i32' }, { name: 'aaFlags', type: 'i32' },
]);

export const STABLE_TEXTURES = Object.freeze(['uint', 'uint', 'uint', 'float', 'float', 'float', 'float', 'uint', 'uint', 'float', 'float', 'uint', 'sint']); // slot 12 = shade MAT_I (AA-26)
export const STABLE_TARGETS = Object.freeze(['rgba8', 'rgba8', 'rgba32ui']);

export const STABLE_WGSL = `
${STABLE_BLOCK.wgsl}
@group(0) @binding(0) var uGI: texture_2d<u32>;
@group(0) @binding(1) var uGA: texture_2d<u32>;
@group(0) @binding(2) var uDepth: texture_2d<u32>;
@group(0) @binding(3) var uShadeFg: texture_2d<f32>;
@group(0) @binding(4) var uShadeBg: texture_2d<f32>;
@group(0) @binding(5) var uFinalFg: texture_2d<f32>;
@group(0) @binding(6) var uFinalBg: texture_2d<f32>;
@group(0) @binding(7) var uLevel: texture_2d<u32>;
@group(0) @binding(8) var uWater: texture_2d<u32>;
@group(0) @binding(9) var uHistFg: texture_2d<f32>;
@group(0) @binding(10) var uHistBg: texture_2d<f32>;
@group(0) @binding(11) var uHist: texture_2d<u32>;
@group(0) @binding(12) var uMatI: texture_2d<i32>; // AA-26: shade MAT_I (row = material, texel 0 .y = flags; F_SOFT_EDGE); 1x1 stub = not soft
@group(1) @binding(0) var<uniform> u: StableU;

${GBUF_UNPACK_WGSL}
${FULLSCREEN_VS_WGSL}
${REPROJECT_WGSL}

const LEVEL_NONE: u32 = ${LEVEL_NONE}u;
const LEVEL_ANIM: u32 = ${LEVEL_ANIM}u;

// unorm8 -> byte, exactly like the shade/edge quantise (floor(v * 255 + 0.5)).
fn byteOf(v: f32) -> u32 { return u32(floor(v * 255.0 + 0.5)); }
fn packRgb(r: f32, g: f32, b: f32) -> u32 { return (byteOf(r) << 16u) | (byteOf(g) << 8u) | byteOf(b); }

// |c-p| > snap ? c : (p + c + 1) >> 1  (same as the twin blend: half-up average)
fn blendCh(p: u32, c: u32) -> u32 {
  let d = i32(c) - i32(p);
  return select((p + c + 1u) >> 1u, c, abs(d) > u.snap);
}
fn blendPacked(pk: u32, ck: u32) -> u32 {
  // AA-23 (aaFlags bit 256): any channel past the snap snaps the whole colour (twin: temporalStable.js blend, hue arg)
  if ((u.aaFlags & 256) != 0) {
    let dr = abs(i32((ck >> 16u) & 255u) - i32((pk >> 16u) & 255u));
    let dg = abs(i32((ck >> 8u) & 255u) - i32((pk >> 8u) & 255u));
    let db = abs(i32(ck & 255u) - i32(pk & 255u));
    if (max(dr, max(dg, db)) > u.snap) { return ck & 0xFFFFFFu; }
    let r = (((pk >> 16u) & 255u) + ((ck >> 16u) & 255u) + 1u) >> 1u;
    let g = (((pk >> 8u) & 255u) + ((ck >> 8u) & 255u) + 1u) >> 1u;
    return (r << 16u) | (g << 8u) | (((pk & 255u) + (ck & 255u) + 1u) >> 1u);
  }
  let r = blendCh((pk >> 16u) & 255u, (ck >> 16u) & 255u);
  let g = blendCh((pk >> 8u) & 255u, (ck >> 8u) & 255u);
  let b = blendCh(pk & 255u, ck & 255u);
  return (r << 16u) | (g << 8u) | b;
}

// temporalStable.js reprojection: current-camera cell ray (eye-relative) + dEye -> previous camera (eye 0). Returns (colF, rowF, vdPrev).
fn reproject(col: f32, row: f32, vd: f32) -> vec3f {
  return reprojectCell(col, row, vd, u.gridCols, u.gridRows, u.ortho, u.curA, u.curB, u.curC, u.prevA, u.prevB, u.prevC, u.dEye);
}

struct SCell {
  fg: u32,       // packed 0xRRGGBB
  bg: u32,
  glyph: u32,    // 0..255
  level: u32,    // level written to history (the held level when the glyph was held)
  kind: u32,
  mat: u32,      // gi mat id (16 bit) -> HIST.w bits 16-31 (AA-04a / OB-198 history key; read by resolve hysteresis)
  plane: u32,
  vm: u32,       // AA-07a: view-model tag (0 = none, else 1 + 0xFFFF - objectId)
  ub: u32,       // f32 bits of this frame's u / v (history always describes THIS frame)
  vb: u32,
  fresh: u32,    // 1 = no history taken
};

// AA-20: UV step to neighbour n when it is the same kind + material, else a huge value (twin: grazeUvLimit's step()).
fn grazeStep(nx: i32, ny: i32, kind: u32, mat: u32, u0: f32, v0: f32) -> f32 {
  if (nx < 0 || nx >= u.gridCols || ny < 0 || ny >= u.gridRows) { return 3.0e38; }
  let g = textureLoad(uGI, vec2i(nx, ny), 0);
  if (giKind(g.y) != kind || giMat(g.y) != mat) { return 3.0e38; }
  let a = textureLoad(uGA, vec2i(nx, ny), 0);
  let du = bitcast<f32>(a.x) - u0; let dv = bitcast<f32>(a.y) - v0;
  return sqrt(du * du + dv * dv);
}
// AA-26 (OB-208): soft-edge leaf material (twin: inp.soft); rows past the table = not soft
fn leafSoft(m: u32) -> bool {
  if (m >= u32(textureDimensions(uMatI).y)) { return false; }
  return (textureLoad(uMatI, vec2i(0, i32(m)), 0).y & ${F_SOFT_EDGE}) != 0;
}
fn grazeLimit(cx: i32, cy: i32, kind: u32, mat: u32, u0: f32, v0: f32, lim: f32) -> f32 {
  var gx = min(grazeStep(cx - 1, cy, kind, mat, u0, v0), grazeStep(cx + 1, cy, kind, mat, u0, v0));
  var gy = min(grazeStep(cx, cy - 1, kind, mat, u0, v0), grazeStep(cx, cy + 1, kind, mat, u0, v0));
  if (gx > 1.0e38) { gx = 0.0; }
  if (gy > 1.0e38) { gy = 0.0; }
  let g = min(${GRAZE_K.toFixed(4)} * max(gx, gy), ${GRAZE_CAP.toFixed(1)} * lim);
  return max(g, lim);
}

// One cell of temporalStable.js stabilize(). The reject order is the twin's.
fn stableCell(cell: vec2i) -> SCell {
  var o: SCell;
  let gi = textureLoad(uGI, cell, 0);
  let ga = textureLoad(uGA, cell, 0);
  let fgC = textureLoad(uFinalFg, cell, 0);
  let bgC = textureLoad(uFinalBg, cell, 0);
  let kind = giKind(gi.y);
  let lvRaw = textureLoad(uLevel, cell, 0).x;
  // AA-07b: shade's level byte carries the joint coverage (twin: temporalStable.js levelOfByte / covOfByte)
  var lvC = lvRaw; var cov = 0u;
  if (lvRaw < 254u) { lvC = select(lvRaw & 31u, 255u, (lvRaw & 128u) != 0u); cov = (lvRaw >> 5u) & 3u; }
  let vmTag = select(0u, 0xFFFFu - gi.w + 1u, kind == 8u && (u.aaFlags & 4) != 0 && gi.w >= 65528u && gi.w <= 65535u); // KIND_MODEL, VM_ID_MIN
  o.fg = packRgb(fgC.x, fgC.y, fgC.z);
  o.bg = packRgb(bgC.x, bgC.y, bgC.z);
  o.glyph = byteOf(fgC.w);
  o.level = lvC; o.kind = kind; o.plane = gi.x; o.mat = giMat(gi.y); o.vm = vmTag; o.ub = ga.x; o.vb = ga.y; o.fresh = 1u;
  if (u.histValid == 0) { return o; }
  if (kind == ${KIND_NONE}u || (kind == ${KIND_MODEL}u && (u.aaFlags & 4) == 0) || lvC == LEVEL_ANIM) { return o; }
  // edge cell: final != shade (rgb of fg and bg, glyph in fg.a) -> pass through
  let sf = textureLoad(uShadeFg, cell, 0);
  let sb = textureLoad(uShadeBg, cell, 0);
  // AA-18 (aaFlags bit 5): edge cells take history like any cell (twin: st.aaEdge)
  if ((u.aaFlags & 32) == 0 && (fgC.x != sf.x || fgC.y != sf.y || fgC.z != sf.z || fgC.w != sf.w || bgC.x != sb.x || bgC.y != sb.y || bgC.z != sb.z)) { return o; }
  // water-layer cell (ripples must not freeze): the layer word holds a finite vD
  let wl = textureLoad(uWater, cell, 0);
  if (u.waterOn != 0 && wl.x != 0x7f800000u) { return o; } // VISQA-26: sheets (w bit 5) too. waterOn: the 1x1 dummy reads 0 (= 'water') out of bounds
  let vd = bitcast<f32>(textureLoad(uDepth, cell, 0).x);
  if (!(vd > 0.0) || vd > 1.0e38) { return o; }

  var hcell = cell; // AA-07a: the view model's history is the same cell
  if (vmTag == 0u) {
    let pc = reproject(f32(cell.x), f32(cell.y), vd);
    if (u.ortho == 0 && pc.z <= 0.0) { return o; }
    // prefilter (keeps i32() of huge/NaN floats out); the exact cell test follows
    if (!(pc.x > -2.0 && pc.x < f32(u.gridCols) + 2.0 && pc.y > -2.0 && pc.y < f32(u.gridRows) + 2.0)) { return o; }
    let hc = i32(floor(pc.x + 0.5)); let hr = i32(floor(pc.y + 0.5));
    if (hc < 0 || hc >= u.gridCols || hr < 0 || hr >= u.gridRows) { return o; }
    hcell = vec2i(hc, hr);
  }

  let hh = textureLoad(uHist, hcell, 0);
  let hk = (hh.w >> 8u) & 15u;
  if (hk != kind) { return o; }
  if (((hh.w >> 12u) & 15u) != vmTag) { return o; } // view-model key = objectId + mat; a different object drops the history
  let matSame = (hh.w >> 16u) == giMat(gi.y);
  if (vmTag != 0u) {
    if (!matSame) { return o; }
  } else if (hh.x != gi.x) {
    // OB-198 (2): mesh planeIds flip almost every step; the material is the stable key (aaFlags bit 1); AA-07a: also world kind-8 props (bit 2)
    if (!(matSame && (((u.aaFlags & 2) != 0 && kind == ${KIND_MESH}u) || ((u.aaFlags & 4) != 0 && kind == ${KIND_MODEL}u)))) { return o; }
  }
  let lvP = hh.w & 255u;
  if (lvP == LEVEL_ANIM) { return o; }
  let c255 = lvC == LEVEL_NONE;
  // AA-07b: line<->ramp mismatch on a 1/4..3/4 joint-coverage cell = the 50 pct joint vote flipping: hold the history glyph (aaFlags bit 3)
  let jointHold = c255 != (lvP == LEVEL_NONE) && (u.aaFlags & 8) != 0 && cov >= 1u && cov <= 3u;
  if (c255 != (lvP == LEVEL_NONE) && !jointHold) { return o; } // mixed ramp/non-ramp: a real pattern edge, always fresh
  // AA-26 (aaFlags bit 512): a soft-edge leaf keeps history on kind + material + reprojection (world-keyed dice; twin: leafHold)
  let leafHold = (u.aaFlags & 512) != 0 && u.ortho == 0 && kind == ${KIND_MESH}u && matSame && leafSoft(giMat(gi.y));
  if (vmTag == 0u && !leafHold) {
    let du = bitcast<f32>(ga.x) - bitcast<f32>(hh.y);
    let dv = bitcast<f32>(ga.y) - bitcast<f32>(hh.z);
    let dUV = sqrt(du * du + dv * dv);
    // OB-193: limit = max(texel limit, cell footprint at this depth) - twin: temporalStable.js uvDriftLimit
    var uvLim = ${UV_LIM_TEXELS.toFixed(1)} / u.detailDefault;
    if (u.ortho == 0) { uvLim = max(uvLim, ${STABLE_FOOT_K.toFixed(4)} * vd * 2.0 * max(u.curA.w / f32(u.gridCols), u.curC.y / f32(u.gridRows))); }
    // AA-20 (aaFlags bit 128): grazing surface -> the limit follows the cell's own UV step to same kind+mat neighbours (twin: temporalStable.js grazeUvLimit)
    if (dUV >= uvLim && (u.aaFlags & 128) != 0 && u.ortho == 0) { uvLim = grazeLimit(cell.x, cell.y, kind, giMat(gi.y), bitcast<f32>(ga.x), bitcast<f32>(ga.y), uvLim); }
    if (dUV >= uvLim) { return o; }
  }

  o.fresh = 0u;
  let hf = textureLoad(uHistFg, hcell, 0);
  let hb = textureLoad(uHistBg, hcell, 0);
  let fgCur = o.fg;
  o.fg = blendPacked(packRgb(hf.x, hf.y, hf.z), o.fg);
  o.bg = blendPacked(packRgb(hb.x, hb.y, hb.z), o.bg);
  if (jointHold) { o.glyph = byteOf(hf.w); o.level = lvP; return o; }
  if (c255) {
    // both sides non-ramp (38.25 C.3): hold the texture glyph unless the fg snapped; a hold keeps the HISTORY's anchor u/v (C.4)
    let sa = packRgb(hf.x, hf.y, hf.z);
    let snapped = abs(i32((fgCur >> 16u) & 255u) - i32((sa >> 16u) & 255u)) > u.snap || abs(i32((fgCur >> 8u) & 255u) - i32((sa >> 8u) & 255u)) > u.snap
      || abs(i32(fgCur & 255u) - i32(sa & 255u)) > u.snap;
    // AA-28 (aaFlags bit 1024): a terrain glyph (same material) survives the snap - it never depends on light or colour tier (twin: st.aaTerrSnap)
    if (!snapped || ((u.aaFlags & 1024) != 0 && kind == ${KIND_TERRAIN}u && matSame)) {
      o.glyph = byteOf(hf.w);
      // AA-09 (aaFlags bit 4): static surface (same planeId, mesh also same material, not a model) re-anchors = keeps the current u/v; else the history anchor
      // AA-21 (aaFlags 64): a world voxel prop (kind 8, not the view model) re-anchors too when plane + material match
      let reAnchor = (u.aaFlags & 16) != 0 && vmTag == 0u && hh.x == gi.x
        && ((kind != ${KIND_MODEL}u && (kind != ${KIND_MESH}u || matSame)) || (kind == ${KIND_MODEL}u && (u.aaFlags & 64) != 0 && matSame));
      if (!reAnchor) { o.ub = hh.y; o.vb = hh.z; }
    }
    return o;
  }
  // OB-198 (1): glyph hysteresis (aaFlags bit 0); off = hold only at equal level
  let lvDiff = abs(i32(lvC) - i32(lvP));
  // AA-29 (aaFlags bit 2048): a held soft-edge leaf (leafHold) takes +-2 (twin: st.aaLeafLv)
  let lvTol = select(1, 2, leafHold && (u.aaFlags & 2048) != 0);
  if (((u.aaFlags & 1) != 0 && lvDiff <= lvTol) || lvDiff == 0) { o.glyph = byteOf(hf.w); o.level = lvP; }
  return o;
}

struct FO {
  @location(0) fg: vec4f,
  @location(1) bg: vec4f,
  @location(2) hist: vec4u,
};

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> FO {
  let cell = vec2i(floor(frag.xy));
  let r = stableCell(cell);
  let bgA = textureLoad(uFinalBg, cell, 0).w;
  var o: FO;
  o.fg = vec4f(f32((r.fg >> 16u) & 255u) / 255.0, f32((r.fg >> 8u) & 255u) / 255.0, f32(r.fg & 255u) / 255.0, f32(r.glyph) / 255.0);
  o.bg = vec4f(f32((r.bg >> 16u) & 255u) / 255.0, f32((r.bg >> 8u) & 255u) / 255.0, f32(r.bg & 255u) / 255.0, bgA);
  o.hist = vec4u(r.plane, r.ub, r.vb, r.level | (r.kind << 8u) | (r.vm << 12u) | (r.mat << 16u));
  return o;
}
`;
