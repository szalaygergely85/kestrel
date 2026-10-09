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
// level | kind << 8). @group(1) @binding(0) = StableU. Targets (32 B, the attachment limit): 0 OUT_FG, 1 OUT_BG (rgba8; bg.a copied from final),
// 2 OUT_HIST (rgba32uint, same layout as HIST).
// Edge cells are detected without touching the edge pass: final != shade (any rgb byte or the glyph) -> pass final through (38.25 item 3).
import { defineUniformBlock } from './uniformBlock.js';
import { GBUF_UNPACK_WGSL, FULLSCREEN_VS_WGSL } from './common.wgsl.js';
import { KIND_NONE, KIND_MODEL } from '../../GBuffer.js';
import { LEVEL_NONE, LEVEL_ANIM, UV_LIM_TEXELS } from '../../temporalStable.js';

export const STABLE_BLOCK = defineUniformBlock('StableU', [
  { name: 'curA', type: 'vec4' },   // current terms: fX, fY, fZ, tanHalfX (halfW when ortho)
  { name: 'curB', type: 'vec4' },   // rX, rY, uX, uY
  { name: 'curC', type: 'vec4' },   // uZ, tanHalfY (halfH when ortho), 0, 0
  { name: 'prevA', type: 'vec4' },  // previous terms, same packing
  { name: 'prevB', type: 'vec4' },
  { name: 'prevC', type: 'vec4' },
  { name: 'dEye', type: 'vec4' },   // eyeCur - eyePrev (f64 on the host), w unused
  { name: 'gridCols', type: 'i32' }, { name: 'gridRows', type: 'i32' }, { name: 'histValid', type: 'i32' }, { name: 'ortho', type: 'i32' },
  { name: 'snap', type: 'i32' }, { name: 'detailDefault', type: 'f32' }, { name: 'pad0', type: 'i32' }, { name: 'pad1', type: 'i32' },
]);

export const STABLE_TEXTURES = Object.freeze(['uint', 'uint', 'uint', 'float', 'float', 'float', 'float', 'uint', 'uint', 'float', 'float', 'uint']);
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
@group(1) @binding(0) var<uniform> u: StableU;

${GBUF_UNPACK_WGSL}
${FULLSCREEN_VS_WGSL}

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
  let r = blendCh((pk >> 16u) & 255u, (ck >> 16u) & 255u);
  let g = blendCh((pk >> 8u) & 255u, (ck >> 8u) & 255u);
  let b = blendCh(pk & 255u, ck & 255u);
  return (r << 16u) | (g << 8u) | b;
}

// temporalStable.js reprojection: current-camera cell ray (eye-relative) + dEye -> previous camera (eye 0). Returns (colF, rowF, vdPrev).
fn reproject(col: f32, row: f32, vd: f32) -> vec3f {
  let colsF = f32(u.gridCols); let rowsF = f32(u.gridRows);
  let a = ((2.0 * (col + 0.5)) / colsF - 1.0) * u.curA.w;
  let b = (1.0 - (2.0 * row) / rowsF) * u.curC.y;
  var px: f32; var py: f32; var pz: f32;
  if (u.ortho == 1) {
    px = a * u.curB.x + b * u.curB.z + vd * u.curA.x;
    py = a * u.curB.y + b * u.curB.w + vd * u.curA.y;
    pz = b * u.curC.x + vd * u.curA.z;
  } else {
    px = (u.curA.x + a * u.curB.x + b * u.curB.z) * vd;
    py = (u.curA.y + a * u.curB.y + b * u.curB.w) * vd;
    pz = (u.curA.z + b * u.curC.x) * vd;
  }
  let wx = px + u.dEye.x; let wy = py + u.dEye.y; let wz = pz + u.dEye.z;
  let vdP = wx * u.prevA.x + wy * u.prevA.y + wz * u.prevA.z;
  let vx = wx * u.prevB.x + wy * u.prevB.y;
  let vy = wx * u.prevB.z + wy * u.prevB.w + wz * u.prevC.x;
  var cf = 0.0; var rf = 0.0;
  if (u.ortho == 1) {
    cf = (vx / u.prevA.w + 1.0) * (colsF * 0.5) - 0.5;
    rf = (1.0 - vy / u.prevC.y) * (rowsF * 0.5);
  } else if (vdP > 0.0) {
    cf = (vx / vdP / u.prevA.w + 1.0) * (colsF * 0.5) - 0.5;
    rf = (1.0 - vy / vdP / u.prevC.y) * (rowsF * 0.5);
  }
  return vec3f(cf, rf, vdP);
}

struct SCell {
  fg: u32,       // packed 0xRRGGBB
  bg: u32,
  glyph: u32,    // 0..255
  level: u32,    // level written to history (the held level when the glyph was held)
  kind: u32,
  plane: u32,
  ub: u32,       // f32 bits of this frame's u / v (history always describes THIS frame)
  vb: u32,
  fresh: u32,    // 1 = no history taken
};

// One cell of temporalStable.js stabilize(). The reject order is the twin's.
fn stableCell(cell: vec2i) -> SCell {
  var o: SCell;
  let gi = textureLoad(uGI, cell, 0);
  let ga = textureLoad(uGA, cell, 0);
  let fgC = textureLoad(uFinalFg, cell, 0);
  let bgC = textureLoad(uFinalBg, cell, 0);
  let kind = giKind(gi.y);
  let lvC = textureLoad(uLevel, cell, 0).x;
  o.fg = packRgb(fgC.x, fgC.y, fgC.z);
  o.bg = packRgb(bgC.x, bgC.y, bgC.z);
  o.glyph = byteOf(fgC.w);
  o.level = lvC; o.kind = kind; o.plane = gi.x; o.ub = ga.x; o.vb = ga.y; o.fresh = 1u;
  if (u.histValid == 0) { return o; }
  if (kind == ${KIND_NONE}u || kind == ${KIND_MODEL}u || lvC == LEVEL_ANIM) { return o; }
  // edge cell: final != shade (rgb of fg and bg, glyph in fg.a) -> pass through
  let sf = textureLoad(uShadeFg, cell, 0);
  let sb = textureLoad(uShadeBg, cell, 0);
  if (fgC.x != sf.x || fgC.y != sf.y || fgC.z != sf.z || fgC.w != sf.w || bgC.x != sb.x || bgC.y != sb.y || bgC.z != sb.z) { return o; }
  // water-layer cell (ripples must not freeze): the layer word holds a finite vD
  let wl = textureLoad(uWater, cell, 0);
  if (u.pad0 != 0 && wl.x != 0x7f800000u && (wl.w & 32u) == 0u) { return o; } // pad0 = waterOn: the 1x1 dummy reads 0 (= 'water') out of bounds
  let vd = bitcast<f32>(textureLoad(uDepth, cell, 0).x);
  if (!(vd > 0.0) || vd > 1.0e38) { return o; }

  let pc = reproject(f32(cell.x), f32(cell.y), vd);
  if (u.ortho == 0 && pc.z <= 0.0) { return o; }
  // prefilter (keeps i32() of huge/NaN floats out); the exact cell test follows
  if (!(pc.x > -2.0 && pc.x < f32(u.gridCols) + 2.0 && pc.y > -2.0 && pc.y < f32(u.gridRows) + 2.0)) { return o; }
  let hc = i32(floor(pc.x + 0.5)); let hr = i32(floor(pc.y + 0.5));
  if (hc < 0 || hc >= u.gridCols || hr < 0 || hr >= u.gridRows) { return o; }
  let hcell = vec2i(hc, hr);

  let hh = textureLoad(uHist, hcell, 0);
  let hk = (hh.w >> 8u) & 255u;
  if (hk != kind || hh.x != gi.x) { return o; }
  let lvP = hh.w & 255u;
  if (lvP == LEVEL_ANIM) { return o; }
  let c255 = lvC == LEVEL_NONE;
  if (c255 != (lvP == LEVEL_NONE)) { return o; } // mixed ramp/non-ramp: a real pattern edge, always fresh
  let du = bitcast<f32>(ga.x) - bitcast<f32>(hh.y);
  let dv = bitcast<f32>(ga.y) - bitcast<f32>(hh.z);
  let dUV = sqrt(du * du + dv * dv);
  if (dUV >= ${UV_LIM_TEXELS.toFixed(1)} / u.detailDefault) { return o; }

  o.fresh = 0u;
  let hf = textureLoad(uHistFg, hcell, 0);
  let hb = textureLoad(uHistBg, hcell, 0);
  let fgCur = o.fg;
  o.fg = blendPacked(packRgb(hf.x, hf.y, hf.z), o.fg);
  o.bg = blendPacked(packRgb(hb.x, hb.y, hb.z), o.bg);
  if (c255) {
    // both sides non-ramp (38.25 C.3): hold the texture glyph unless the fg snapped; a hold keeps the HISTORY's anchor u/v (C.4)
    let sa = packRgb(hf.x, hf.y, hf.z);
    let snapped = abs(i32((fgCur >> 16u) & 255u) - i32((sa >> 16u) & 255u)) > u.snap || abs(i32((fgCur >> 8u) & 255u) - i32((sa >> 8u) & 255u)) > u.snap
      || abs(i32(fgCur & 255u) - i32(sa & 255u)) > u.snap;
    if (!snapped) { o.glyph = byteOf(hf.w); o.ub = hh.y; o.vb = hh.z; }
    return o;
  }
  if (abs(i32(lvC) - i32(lvP)) <= 1) { o.glyph = byteOf(hf.w); o.level = lvP; }
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
  o.hist = vec4u(r.plane, r.ub, r.vb, r.level | (r.kind << 8u));
  return o;
}
`;
