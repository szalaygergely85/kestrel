// WG-3c (docs/architecture.md 38.5/38.8, A7): WGSL port of glsl/edge.frag.js (US-029 pass 2 of the present hook), line by line;
// JS twin = edgePass.js (edgeRules decision block + the byte-gain tail). Reads shadeFg/shadeBg (pass 1) + GI + depth of the
// 4 neighbours (and i+2) and writes the FINAL fg/bg. Passthrough cells (shadeBg.a == 0) are copied unchanged.
// A7: kind 9 (KIND_MESH) is in isVert/isUp exactly like the shipped GLSL (KIND_MODEL || KIND_MESH).
// ALPHA-01d (37.17 step d, WebGPU only, D-044: no GLSL): soft-edge materials (flag F_SOFT_EDGE = bit 16 of MAT_I row 0 .y, read from the
// shade MAT_I texture bound here at slot 5). A soft cell takes only cap / lip / side and never against another soft cell; its rule gain is
// u.softGain (glyph kept). Twin: edgePass.js edgeRules (`si`) + the gain line of edgePass().
// Deviations from the GLSL text: the rule decision block lives in `decideRule` (same ops, same order) so Node can probe it;
// neighbour coords are built component-wise; uniforms are one block (EdgeU, uniformBlock.js layout): float[8] arrays are two
// contiguous vec4 rows (== Float32Array(8) copied as-is), `uWOS[12]` (vec2 x 12) is six contiguous vec4 rows (slot s = row s>>1,
// .xy / .zw); only pitchC of the PITCH uniforms is needed (fogScaleCell).
// Bindings (@group(0), textures at binding = slot): 0 GI (rgba32uint), 1 DEPTH (r32uint), 2 SHADE_FG (rgba8), 3 SHADE_BG (rgba8),
// 4 WATER (rgba32uint); @group(1) @binding(0) = EdgeU. Targets: 0 = final fg rgba8, 1 = final bg rgba8. Cell = @builtin(position).xy.
import { defineUniformBlock } from './uniformBlock.js';
import { GBUF_UNPACK_WGSL, FULLSCREEN_VS_WGSL, CELL_RAY_PITCHED_WGSL } from './common.wgsl.js';
import { F_SOFT_EDGE } from '../ShadeTextures.js';
import { KIND_MODEL, KIND_MESH, KIND_TERRAIN, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_PACKED } from '../../GBuffer.js';

export const EDGE_BLOCK = defineUniformBlock('EdgeU', [
  { name: 'gridCols', type: 'i32' }, { name: 'gridRows', type: 'i32' }, { name: 'fogMax', type: 'f32' }, { name: 'modelRim', type: 'f32' },
  { name: 'waterOn', type: 'i32' }, { name: 'projMode', type: 'i32' }, { name: 'fogStart', type: 'f32' }, { name: 'fogFull', type: 'f32' },
  { name: 'terrainFogStart', type: 'f32' }, { name: 'terrainFogFull', type: 'f32' }, { name: 'terrainFogCurve', type: 'f32' }, { name: 'softGain', type: 'f32' },
  { name: 'pitchC', type: 'vec4' },                // uZ, tanHalfY, cosP, sinP (only .y .z .w read)
  { name: 'edgeGlyph', type: 'vec4', count: 2 },   // float[8], rule glyph codes (ASCII-32), index 0 = cap .. 7 = nosing
  { name: 'edgeGain', type: 'vec4', count: 2 },    // float[8]
  { name: 'wos', type: 'vec4', count: 6 },         // vec2[12]: per slot opaqueAt, seeThrough (waterLook.js rows 3 / 7)
]);

export const EDGE_TEXTURES = Object.freeze(['uint', 'uint', 'float', 'float', 'uint', 'sint']);
export const EDGE_TARGETS = Object.freeze(['rgba8', 'rgba8']);

export const EDGE_WGSL = `
${EDGE_BLOCK.wgsl}
@group(0) @binding(0) var uGI: texture_2d<u32>;      // x = planeId, y = kind|face|mask|cov|mat
@group(0) @binding(1) var uDepth: texture_2d<u32>;   // R32UI bitcast dist (US-030a)
@group(0) @binding(2) var uShadeFg: texture_2d<f32>; // pass-1 fg (rgba8, textureLoad)
@group(0) @binding(3) var uShadeBg: texture_2d<f32>; // pass-1 bg, .a = 0 passthrough
@group(0) @binding(4) var uWater: texture_2d<u32>;   // US-055a2b WATER layer (x = bitcast vD, +Inf = none, w = slot | ...)
@group(0) @binding(5) var uMatI: texture_2d<i32>;    // ALPHA-01d: shade MAT_I (row = material id, texel 0 .y = flags)
@group(1) @binding(0) var<uniform> u: EdgeU;

${GBUF_UNPACK_WGSL}
${CELL_RAY_PITCHED_WGSL}
${FULLSCREEN_VS_WGSL}

// US-040 step 4 (15.2 item 5) + A7: kind 8 (KIND_MODEL) and kind 9 (KIND_MESH) join the rule table via their world face.
fn isVert(kind: u32, face: u32) -> bool {
  return kind == 1u || kind == 2u || kind == 3u ||
    ((kind == ${KIND_MODEL}u || kind == ${KIND_MESH}u) && (face == ${FACE_N}u || face == ${FACE_E}u || face == ${FACE_S}u || face == ${FACE_W}u || face == ${FACE_PACKED}u));
}
fn isUp(kind: u32, face: u32) -> bool { return kind == 4u || kind == 5u || ((kind == ${KIND_MODEL}u || kind == ${KIND_MESH}u) && face == ${FACE_U}u); }

fn fogScaleCell(row: i32, rows: i32) -> f32 {
  return select(pitchFogScale(row, rows, u.pitchC.y, u.pitchC.z, u.pitchC.w), 1.0, u.projMode == 0);
}

// BUG-GPU-005: terrain cells (kind 7) gate on the TERRAIN fog (terrainShade.js terrainFogF), not the interior fog.
fn terrainFogF(dist: f32) -> f32 {
  let f = clamp((dist - u.terrainFogStart) / (u.terrainFogFull - u.terrainFogStart), 0.0, 1.0);
  return pow(f, u.terrainFogCurve);
}
fn fogF(dist: f32) -> f32 {
  return select(select((dist - u.fogStart) / (u.fogFull - u.fogStart), 1.0, dist >= u.fogFull), 0.0, dist <= u.fogStart);
}

fn kindAt(c: vec2i) -> u32 {
  if (c.x < 0 || c.x >= u.gridCols || c.y < 0 || c.y >= u.gridRows) { return 0u; }
  return giKind(textureLoad(uGI, c, 0).y);
}
fn faceAt(c: vec2i) -> u32 {
  if (c.x < 0 || c.x >= u.gridCols || c.y < 0 || c.y >= u.gridRows) { return 0u; }
  return giFace(textureLoad(uGI, c, 0).y);
}
fn matAt(c: vec2i) -> i32 { return i32(giMat(textureLoad(uGI, c, 0).y)); }
// ALPHA-01d: MaterialTable.soft[matId]; ids past the texture read 0 (WGSL out-of-bounds textureLoad), like the JS table.
// Terrain cells (kind 7) carry a terrain type in the mat field, not a material id: never soft.
fn softMat(k: u32, m: i32) -> bool { return k != ${KIND_TERRAIN}u && (textureLoad(uMatI, vec2i(0, m), 0).y & ${F_SOFT_EDGE}) != 0; }
fn planeAt(c: vec2i) -> i32 { return i32(textureLoad(uGI, c, 0).x); }
fn depthAt(c: vec2i) -> f32 { return bitcast<f32>(textureLoad(uDepth, c, 0).x); }

fn farther(ic: vec2i, nc: vec2i, validN: bool, si: bool) -> bool {
  if (!validN) { return false; }
  let nk = kindAt(nc);
  if (nk == 0u) { return true; }
  if (si && softMat(nk, matAt(nc))) { return false; }
  if (planeAt(nc) == planeAt(ic)) { return false; }
  return depthAt(nc) > depthAt(ic) * 1.18 + 0.35;
}

// US-055a2b (32.2 edge rule): a surface cell seen through OPAQUE water (alpha >= seeThrough) draws no outline - twin of waterMask.
fn waterOpaque(cell: vec2i, raw: f32) -> bool {
  if (u.waterOn == 0) { return false; }
  let w = textureLoad(uWater, cell, 0);
  if (w.x == 0x7f800000u || (w.w & 32u) != 0u) { return false; }
  let dW = bitcast<f32>(w.x);
  if (!(dW < raw)) { return false; }
  let slot = i32(w.w & 15u);
  let row = u.wos[slot >> 1u];
  let os = select(row.xy, row.zw, (slot & 1) == 1);
  return (raw - dW) / os.x >= os.y;
}

// edgePass.js edgeRules decision block (rule 0 = none, 1..8 = cap, lip, side, convex, concave, seamFloor, seamCeil, nosing).
fn decideRule(cell: vec2i, kind: u32, face: u32, distRaw: f32, si: bool) -> i32 {
  var rule = 0;
  let up = vec2i(cell.x, cell.y - 1); let dn = vec2i(cell.x, cell.y + 1);
  let lf = vec2i(cell.x - 1, cell.y); let rt2 = vec2i(cell.x + 1, cell.y);
  let okUp = up.y >= 0; let okDn = dn.y < u.gridRows; let okLf = lf.x >= 0; let okRt = rt2.x < u.gridCols;

  if (farther(cell, up, okUp, si)) { rule = 1; }
  else if (farther(cell, dn, okDn, si)) { rule = 2; }
  else if (isVert(kind, face) && (farther(cell, lf, okLf, si) || farther(cell, rt2, okRt, si))) { rule = 3; }
  else if (si) { }
  else if (isVert(kind, face) && okRt && isVert(kindAt(rt2), faceAt(rt2)) && planeAt(rt2) != planeAt(cell)) {
    let l2 = lf; let r2 = vec2i(cell.x + 2, cell.y);
    let okL2 = okLf; let okR2 = r2.x < u.gridCols;
    let dl = select(distRaw, depthAt(l2), okL2 && kindAt(l2) != 0u);
    let dr = select(depthAt(rt2), depthAt(r2), okR2 && kindAt(r2) != 0u);
    let di = distRaw; let dRt = depthAt(rt2);
    if (di <= dl && dRt <= dr) { rule = 4; }
    else if (di >= dl && dRt >= dr) { rule = 5; }
  }
  if (si) { return rule; }
  if (rule == 0 && isVert(kind, face) && kind != 2u && okDn && isUp(kindAt(dn), faceAt(dn)) && depthAt(dn) <= distRaw * 1.08) { rule = 6; }
  if (rule == 0 && isVert(kind, face) && okUp && kindAt(up) == 6u && depthAt(up) <= distRaw * 1.08) { rule = 7; }
  if (rule == 0 && kind == 2u && okUp && isUp(kindAt(up), faceAt(up))) { rule = 8; }
  return rule;
}

struct FO {
  @location(0) fg: vec4f,
  @location(1) bg: vec4f,
};

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> FO {
  let cell = vec2i(floor(frag.xy));
  let sfg = textureLoad(uShadeFg, cell, 0);
  let sbg = textureLoad(uShadeBg, cell, 0);
  var o: FO;

  if (sbg.a < 0.5) { o.fg = sfg; o.bg = vec4f(sbg.rgb, 1.0); return o; }

  let gi = textureLoad(uGI, cell, 0).xy;
  let kind = giKind(gi.y);
  let face = giFace(gi.y);
  let distRaw = depthAt(cell); // depth comparisons below use the raw view depth
  // RE-02a (28.1 A2 item 3): fog reads the horizontal forward distance (mode 0: distRaw, unchanged).
  let dist = select(distRaw * fogScaleCell(cell.y, u.gridRows), distRaw, u.projMode == 0);
  let ff = select(fogF(dist), terrainFogF(dist), kind == ${KIND_TERRAIN}u);

  var rule = 0;
  if (kind != 0u && ff <= u.fogMax && !waterOpaque(cell, distRaw)) {
    rule = decideRule(cell, kind, face, distRaw, softMat(kind, i32(giMat(gi.y))));
  }

  if (rule == 0) { o.fg = sfg; o.bg = vec4f(sbg.rgb, 1.0); return o; }

  let ri = u32(rule - 1);
  var gain = u.edgeGain[ri >> 2u][ri & 3u];
  if (softMat(kind, i32(giMat(gi.y)))) { gain = u.softGain; } // ALPHA-01d
  let glyph = u.edgeGlyph[ri >> 2u][ri & 3u];
  // Gain multiplies the already-quantised pass-1 BYTE (floor(t*255+0.5)), then quantises again (architect review 1, item 4b).
  // US-040 step 4: the dark model rim - kind-8 rule cells only, fg AND bg x uModelRim, after the rule own gain.
  let rim = select(1.0, u.modelRim, kind == ${KIND_MODEL}u);
  let fgByte0 = floor(sfg.rgb * 255.0 + 0.5);
  var fgByte = floor(min(vec3f(255.0), fgByte0 * gain * rim) + 0.5);
  fgByte = max(fgByte, vec3f(1.0));
  o.fg = vec4f(fgByte / 255.0, glyph / 255.0);
  if (rim != 1.0) {
    let bgByte0 = floor(sbg.rgb * 255.0 + 0.5);
    var bgByte = floor(min(vec3f(255.0), bgByte0 * rim) + 0.5);
    bgByte = max(bgByte, vec3f(1.0));
    o.bg = vec4f(bgByte / 255.0, 1.0);
  } else {
    o.bg = vec4f(sbg.rgb, 1.0);
  }
  return o;
}
`;
