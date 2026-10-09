// WG-3b (docs/architecture.md 38.5/38.8): WGSL port of glsl/light.frag.js (US-006/US-007 light pass), line by line; JS twin =
// lighting.js (lightAt, sampleVis, sunVisible, sunCellBlocked, falloff) + shadowSun.js (sunShadowTaps).
// Per-cell pass: L = ambient + sum_i col_i * falloff * max(0,N.L) * vis_i + sun term; output LIGHT rgba32uint =
// (bitcast L.rgb, sunlit | litCount << 8 | sunN << SUN_N_SHIFT).
// Deviations from the GLSL text (WGSL has no `out` params / ternary): findStruct returns the struct index or -1;
// `a ? b : c` is `select(c, b, a)`; GLSL uniform scalars live in one uniform block (LightU, uniformBlock.js layout).
// Bindings (@group(0), textures at binding = slot): 0 GI, 1 GA, 2 DEPTH (r32uint), 3 LVIS (r8uint), 4 WORLD_GEOM
// (rgba32float, textureLoad only), 5 WORLD_FLAGS (rg8uint), 6 SUN_SHADOW (depth32float, textureLoad = NEAREST, no compare);
// @group(1) @binding(0) = LightU. Target 0 = LIGHT rgba32uint. Cell coords from @builtin(position).xy (no flip).
import { defineUniformBlock } from './uniformBlock.js';
import { GBUF_UNPACK_WGSL, FULLSCREEN_VS_WGSL, CELL_RAY_WGSL, CELL_RAY_PITCHED_WGSL, FALLOFF_FAST_WGSL, OCT_NORMAL_WGSL, HASH_FAST_WGSL, CLOUD_SHADOW_WGSL, HORIZON_AO_WGSL } from './common.wgsl.js';
import { MAX_LIGHTS, MAX_VIS_DIM, MAX_SUN_STEPS } from '../../lighting.js';
import { MAX_STRUCTS } from '../WorldTextures.js';
import { FACE_PACKED, KIND_TERRAIN, KIND_MESH } from '../../GBuffer.js';
import { SUN_N_SHIFT, CLOUD_Q_SHIFT } from '../../shadowSun.js';
import { AO_MAX } from '../../horizonAo.js';
import { PSH_NEAR } from '../../shadowPoint.js';

export const PSH_MAX_SLOTS = 6;

const FACE_N = 1, FACE_E = 2, FACE_S = 3, FACE_W = 4, FACE_U = 5, FACE_D = 6;

/** Uniform block (vec3 + trailing f32 pairs pack into 16 B rows). Arrays are vec4 rows exactly like the GLSL uniforms. */
export const LIGHT_BLOCK = defineUniformBlock('LightU', [
  { name: 'ambient', type: 'vec3' }, { name: 'posX', type: 'f32' },
  { name: 'sunDir', type: 'vec3' }, { name: 'sunShadowRes', type: 'f32' },       // unit, TOWARD the sun
  { name: 'sunCol', type: 'vec3' }, { name: 'sunShadowTexelM', type: 'f32' },    // hue * intensity
  { name: 'gridCols', type: 'i32' }, { name: 'gridRows', type: 'i32' }, { name: 'lightCount', type: 'i32' }, { name: 'sunOn', type: 'i32' },
  { name: 'structCount', type: 'i32' }, { name: 'sunMode', type: 'i32' }, { name: 'projMode', type: 'i32' }, { name: 'worldMaxH', type: 'f32' },
  { name: 'posY', type: 'f32' }, { name: 'eyeH', type: 'f32' }, { name: 'dirX', type: 'f32' }, { name: 'dirY', type: 'f32' },
  { name: 'planeX', type: 'f32' }, { name: 'planeY', type: 'f32' }, { name: 'horizonRow', type: 'f32' }, { name: 'planeDistY', type: 'f32' },
  { name: 'sunShadowBiasM', type: 'f32' }, { name: 'sunShadowNormalOff', type: 'f32' },
  // word 30 = pad. S8-B2-20 (38.17): aoStrength takes the last pad word (31); pitchA stays at word 32.
  { name: 'pad30', type: 'f32' },
  { name: 'aoStrength', type: 'f32' },
  { name: 'pitchA', type: 'vec4' }, // fX, fY, fZ, tanHalfX
  { name: 'pitchB', type: 'vec4' }, // rX, rY, uX, uY
  { name: 'pitchC', type: 'vec4' }, // uZ, tanHalfY, cosP, sinP
  { name: 'sunShadowM', type: 'mat4' }, // world -> clip
  { name: 'lightPos', type: 'vec4', count: MAX_LIGHTS }, // x,y,z,radius
  { name: 'lightCol', type: 'vec4', count: MAX_LIGHTS }, // rgb, visSlot
  { name: 'visBox', type: 'vec4', count: MAX_LIGHTS },   // ox, oy, w, h (world cell units)
  { name: 'structA', type: 'vec4', count: MAX_STRUCTS }, // origin.xyz, w (width)
  { name: 'structB', type: 'vec4', count: MAX_STRUCTS }, // h, yOff, structSeq, maxH
  // S8-B2-12c (38.13): cloud-shadow uniforms appended at the END (packCloudUniforms): A = (offX, offY, scale, strength),
  // B = (cover, soft, deckH, seed).
  { name: 'cloudA', type: 'vec4' },
  { name: 'cloudB', type: 'vec4' },
  // S8-B2-20b (38.16): AO params appended at the very END: (radiusM, bias, maxCells, 0). aoStrength stays word 31.
  { name: 'aoP', type: 'vec4' },
  // ME-16d (38.22 item 3): point-light shadow maps, appended at the very END (no word moves). pshA = (count n, res, biasM,
  // normalOffTexels); count 0 = off (the old LVIS line runs). pshO[slot] = (origin xyz, far). pshSlot: light i -> slot + 1, 0 = unshadowed
  // (16 floats = 4 vec4, light i at pshSlot[i >> 2][i & 3]).
  { name: 'pshA', type: 'vec4' },
  { name: 'pshO', type: 'vec4', count: PSH_MAX_SLOTS },
  { name: 'pshSlot', type: 'vec4', count: MAX_LIGHTS / 4 },
]);

/** Texture slot kinds for PipelineDesc.bindings.textures. */
export const LIGHT_TEXTURES = Object.freeze(['uint', 'uint', 'uint', 'uint', 'float', 'uint', 'depth', 'depthArray']);
export const LIGHT_TARGETS = Object.freeze(['rgba32uint']);

export const LIGHT_WGSL = `
${LIGHT_BLOCK.wgsl}
@group(0) @binding(0) var uGI: texture_2d<u32>;          // resolved per-cell: x=planeId, y=kind|face|mask|cov|mat, z=normal
@group(0) @binding(1) var uGA: texture_2d<u32>;          // bitcast u, v, z, aoD - only .w (face 7's packed normal) read here
@group(0) @binding(2) var uDepth: texture_2d<u32>;       // bitcast dist
@group(0) @binding(3) var uLVis: texture_2d<u32>;        // r8uint: MAX_VIS_DIM x (MAX_LIGHTS*MAX_VIS_DIM) occlusion atlas
@group(0) @binding(4) var uWorldGeom: texture_2d<f32>;   // rgba32float: floorH, ceilH, topH, ceilOpenH (unused)
@group(0) @binding(5) var uWorldFlags: texture_2d<u32>;  // rg8uint: r = solid|ceilSky<<1|topSky<<2|dynamic<<3
@group(0) @binding(6) var uSunShadow: texture_depth_2d;  // depth32float, textureLoad (NEAREST, no hardware compare)
@group(0) @binding(7) var uPointShadow: texture_depth_2d_array; // ME-16d: layer = slot*6 + face, depth in [0,1] (off: 1x1x6 dummy, never sampled)
@group(1) @binding(0) var<uniform> u: LightU;

const MAX_VIS_DIM: i32 = ${MAX_VIS_DIM};
const MAX_STRUCTS: i32 = ${MAX_STRUCTS};
const MAX_SUN_STEPS: i32 = ${MAX_SUN_STEPS};
const FACE_N: i32 = ${FACE_N}; const FACE_E: i32 = ${FACE_E}; const FACE_S: i32 = ${FACE_S};
const FACE_W: i32 = ${FACE_W}; const FACE_U: i32 = ${FACE_U}; const FACE_D: i32 = ${FACE_D};
const FACE_PACKED: i32 = ${FACE_PACKED};
const PSH_NEAR: f32 = ${PSH_NEAR};
const SUN_N_SHIFT: u32 = ${SUN_N_SHIFT}u;
// US-026a S5: kind 7 (terrain) is lit by the sun analytically in the terrain shade pass (D-007).
const KIND_TERRAIN: i32 = ${KIND_TERRAIN};
const KIND_MESH: i32 = ${KIND_MESH}; // ME-20c
// BUG-LIGHT-002: same epsilon as lighting.js VIS_FLOOR_EPS (float32 noise at exact vis-grid boundaries).
const VIS_FLOOR_EPS: f32 = 1e-3;
// S8-B2-12c (38.13): cloud-shadow darkening byte shift, bits 24..31 of LIGHT.w (free - gpucompare's decode only
// reads bits 0, 8..15, 16..18).
const CLOUD_Q_SHIFT: u32 = ${CLOUD_Q_SHIFT}u;
// S8-B2-20b (38.16): horizon AO radius/bias/maxCells come from u.aoP = (radiusM, bias, maxCells, 0).
const AO_MAX: f32 = ${AO_MAX};

${GBUF_UNPACK_WGSL}
${CELL_RAY_WGSL}
${CELL_RAY_PITCHED_WGSL}
${FALLOFF_FAST_WGSL}
${OCT_NORMAL_WGSL}
${FULLSCREEN_VS_WGSL}
${HASH_FAST_WGSL}
${CLOUD_SHADOW_WGSL}
fn cloudShadeQ(P: vec3f, sd: vec3f) -> u32 { return cloudShadeQ4(P, sd, u.cloudA, u.cloudB); }
${HORIZON_AO_WGSL}

// S8-B2-20 (38.17): tap point Pt, same projection as P - the existing P code above is NOT refactored to call this
// (default output stays bit-identical byte for byte). Used ONLY by the AO tap block below.
fn cellPoint(cell: vec2f, dist: f32) -> vec3f {
  if (u.projMode == 0) {
    return cellRayP(cell, vec2i(u.gridCols, u.gridRows), u.posX, u.posY, u.eyeH, u.dirX, u.dirY, u.planeX, u.planeY, u.horizonRow, u.planeDistY, dist);
  }
  return cellRayPitched(cell, vec2i(u.gridCols, u.gridRows), vec3f(u.posX, u.posY, u.eyeH), u.pitchA.xyz, u.pitchB.xy, vec3f(u.pitchB.zw, u.pitchC.x), vec2f(u.pitchA.w, u.pitchC.y), dist, u.projMode == 2);
}

// One AO tap at grid cell (tx, ty): open (0) if outside the grid or kind 0 (no finite-depth check here - unlike
// the JS twin, resolve guarantees a valid depth at every kind != 0 cell on the GPU).
fn aoTapCell(tx: i32, ty: i32, P: vec3f, N: vec3f) -> f32 {
  if (tx < 0 || ty < 0 || tx >= u.gridCols || ty >= u.gridRows) { return 0.0; }
  let t = vec2i(tx, ty);
  if (giKind(textureLoad(uGI, t, 0).y) == 0u) { return 0.0; }
  let tDist = bitcast<f32>(textureLoad(uDepth, t, 0).x);
  let Pt = cellPoint(vec2f(f32(tx), f32(ty)), tDist);
  return aoTapOcc(N, Pt - P, u.aoP.x, u.aoP.y);
}

// --- US-007 sun shadow DDA (JS twin: lighting.js sunVisible/sunCellBlocked) ---

// Point query: index of the placed structure covering world point (wx, wy), or -1 (GLSL: bool + out int).
fn findStruct(wx: f32, wy: f32) -> i32 {
  for (var s = 0; s < MAX_STRUCTS; s++) {
    if (s >= u.structCount) { break; }
    let A = u.structA[s]; let B = u.structB[s];
    let lx = wx - A.x; let ly = wy - A.y;
    if (lx >= 0.0 && lx < A.w && ly >= 0.0 && ly < B.x) { return s; }
  }
  return -1;
}

struct SunCell { floorH: f32, ceilH: f32, topH: f32, ceilSky: bool };

fn fetchSunCell(yOff: i32, lcx: i32, lcy: i32) -> SunCell {
  let t = vec2i(lcx, yOff + lcy);
  let g = textureLoad(uWorldGeom, t, 0);
  let flags = textureLoad(uWorldFlags, t, 0).x;
  var c: SunCell;
  c.floorH = g.x;
  c.ceilH = g.y;
  c.ceilSky = (flags & 2u) != 0u;
  c.topH = select(g.z, 1.0e30, (flags & 4u) != 0u);
  return c;
}

// Crossing test - literal twin of lighting.js sunCellBlocked.
fn sunCellBlocked(c: SunCell, h0: f32, h1: f32) -> bool {
  if (h0 < c.floorH) { return true; }
  if (c.ceilSky) { return false; }
  return h0 <= c.topH && h1 >= c.ceilH;
}

// Literal twin of lighting.js sunVisible.
fn sunVisible(S: vec3f, dir: vec3f) -> bool {
  let horiz = length(dir.xy);
  var h0 = S.z + 1.0e-3;
  if (horiz < 1.0e-9) {
    let idx0 = findStruct(S.x, S.y);
    if (idx0 < 0) { return true; }
    let A0 = u.structA[idx0]; let B0 = u.structB[idx0];
    let c0 = fetchSunCell(i32(B0.y + 0.5), i32(floor(S.x - A0.x)), i32(floor(S.y - A0.y)));
    // cell heights are level-local - subtract the owning structure's origin.z (A0.z)
    return !sunCellBlocked(c0, h0 - A0.z, 1.0e30);
  }

  let ndx = dir.x / horiz; let ndy = dir.y / horiz;
  let tanElev = dir.z / horiz;
  var mapX = i32(floor(S.x)); var mapY = i32(floor(S.y));
  let stepX = select(select(0, -1, ndx < 0.0), 1, ndx > 0.0);
  let stepY = select(select(0, -1, ndy < 0.0), 1, ndy > 0.0);
  let deltaDistX = select(abs(1.0 / ndx), 1.0e30, ndx == 0.0);
  let deltaDistY = select(abs(1.0 / ndy), 1.0e30, ndy == 0.0);
  var sideDistX = select(select(S.x - f32(mapX), f32(mapX) + 1.0 - S.x, ndx > 0.0) * deltaDistX, 1.0e30, ndx == 0.0);
  var sideDistY = select(select(S.y - f32(mapY), f32(mapY) + 1.0 - S.y, ndy > 0.0) * deltaDistY, 1.0e30, ndy == 0.0);

  var tPrev = 0.0;
  for (var step = 0; step < MAX_SUN_STEPS; step++) {
    // structure owning the cell about to be crossed (pre-step); none between footprints - never blocks, walk continues
    let cx = mapX; let cy = mapY;
    let idx = findStruct(f32(cx) + 0.5, f32(cy) + 0.5);
    let haveOwner = idx >= 0;

    var t1: f32;
    if (sideDistX < sideDistY) { t1 = sideDistX; sideDistX += deltaDistX; mapX += stepX; }
    else { t1 = sideDistY; sideDistY += deltaDistY; mapY += stepY; }
    let h1 = h0 + tanElev * (t1 - tPrev);

    if (haveOwner) {
      let A = u.structA[idx]; let B = u.structB[idx];
      let lcx = cx - i32(A.x + 0.5); let lcy = cy - i32(A.y + 0.5);
      let c = fetchSunCell(i32(B.y + 0.5), lcx, lcy);
      // level-local heights - subtract origin.z
      let oz = A.z;
      if (sunCellBlocked(c, h0 - oz, h1 - oz)) { return false; }
    }
    h0 = h1; tPrev = t1;

    // structure just entered (post-step): once h0 clears its own maxH it can no longer block
    let idx2 = findStruct(f32(mapX) + 0.5, f32(mapY) + 0.5);
    if (idx2 >= 0) {
      let A2 = u.structA[idx2]; let B2 = u.structB[idx2];
      if (h0 - A2.z > B2.w) { return true; } // B2.w = maxH of the entered structure
    }
    // global escape once h0 clears the tallest structure anywhere
    if (h0 > u.worldMaxH) { return true; }
  }
  return true; // step cap - bias to lit
}

// Quantised 4-tap PCF (JS twin: shadowSun.js sunShadowTaps): n in 0..4. Receivers outside the box and taps outside the
// map are sunlit. P' = P + N * normalOff * texelM + sunDir * biasM. EXPLICIT bounds check on every tap.
fn sunShadowTaps(P: vec3f, N: vec3f) -> i32 {
  let Pp = P + N * (u.sunShadowNormalOff * u.sunShadowTexelM) + u.sunDir * u.sunShadowBiasM;
  let c = u.sunShadowM * vec4f(Pp, 1.0);
  let su = (c.x + 1.0) * 0.5; let sv = (c.y + 1.0) * 0.5; let sd = (c.z + 1.0) * 0.5;
  if (su < 0.0 || su >= 1.0 || sv < 0.0 || sv >= 1.0 || sd < 0.0 || sd > 1.0) { return 4; }
  let sdm = 0.5 + 0.5 * sd; // shadow vertex stages store depth in [0.5, 1] (38.5 item 6); the box test above stays on sd
  let t0 = vec2i(floor(vec2f(su, sv) * u.sunShadowRes - 0.5));
  let res = i32(u.sunShadowRes);
  var n = 0;
  for (var j = 0; j < 2; j++) {
    for (var i = 0; i < 2; i++) {
      let t = t0 + vec2i(i, j);
      if (t.x < 0 || t.y < 0 || t.x >= res || t.y >= res) { n++; continue; }
      if (sdm <= textureLoad(uSunShadow, t, 0)) { n++; }
    }
  }
  return n;
}

// ME-16d (38.22 item 3): point-light shadow taps, scalar form (JS twin: shadowPoint.js pointShadowTaps, same op order).
// (dx,dy,dz) = P - O (O = unjittered map origin), n = N. Face = largest |axis| (ties X, Y, Z; zero counts positive), (a, b, c) = (right, up,
// forward) components per FACE_TABLE. 2x2 taps at floor(uv*res - 0.5) clamped to the face (no cross-face taps). Beyond far / inside near -> 4.
fn pointShadowTapsS(slot: i32, dx: f32, dy: f32, dz: f32, nx: f32, ny: f32, nz: f32, far: f32) -> i32 {
  let res = u.pshA.y;
  let ma = max(max(abs(dx), abs(dy)), abs(dz));
  let len = sqrt(dx * dx + dy * dy + dz * dz);
  let no = u.pshA.w * (2.0 * ma / res);
  let il = select(0.0, 1.0 / len, len > 0.0);
  let vx = dx + (nx * no - dx * il * u.pshA.z);
  let vy = dy + (ny * no - dy * il * u.pshA.z);
  let vz = dz + (nz * no - dz * il * u.pshA.z);
  let ax = abs(vx); let ay = abs(vy); let az = abs(vz);
  var face: i32 = 4; var a: f32 = vx; var b: f32 = vy; var c: f32 = vz;
  if (ax >= ay && ax >= az) {
    if (vx >= 0.0) { face = 0; a = vy; b = vz; c = vx; } else { face = 1; a = vz; b = vy; c = -vx; }
  } else if (ay >= az) {
    if (vy >= 0.0) { face = 2; a = vz; b = vx; c = vy; } else { face = 3; a = vx; b = vz; c = -vy; }
  } else if (vz < 0.0) { face = 5; a = vy; b = vx; c = -vz; }
  if (c >= far || c <= PSH_NEAR) { return 4; }
  let rd = 0.75 + 0.25 * ((far + PSH_NEAR) / (far - PSH_NEAR) - 2.0 * far * PSH_NEAR / ((far - PSH_NEAR) * c)); // sun convention (SHADOW_Z_LINE): stored = 0.75 + 0.25 * ndc
  let fu = (a / c * 0.5 + 0.5) * res - 0.5;
  let fv = (b / c * 0.5 + 0.5) * res - 0.5;
  let x0 = i32(floor(fu)); let y0 = i32(floor(fv));
  let last = i32(res) - 1;
  let layer = slot * 6 + face;
  var n = 0;
  for (var k = 0; k < 4; k++) {
    let x = clamp(x0 + (k & 1), 0, last);
    let y = clamp(y0 + (k >> 1u), 0, last);
    if (rd <= textureLoad(uPointShadow, vec2i(x, y), layer, 0)) { n++; }
  }
  return n;
}
fn pointShadowTaps(slot: i32, P: vec3f, N: vec3f) -> i32 {
  let o = u.pshO[slot];
  return pointShadowTapsS(slot, P.x - o.x, P.y - o.y, P.z - o.z, N.x, N.y, N.z, o.w);
}

fn faceNormal(face: u32) -> vec3f {
  if (face == u32(FACE_N)) { return vec3f(0.0, -1.0, 0.0); }
  if (face == u32(FACE_E)) { return vec3f(1.0, 0.0, 0.0); }
  if (face == u32(FACE_S)) { return vec3f(0.0, 1.0, 0.0); }
  if (face == u32(FACE_W)) { return vec3f(-1.0, 0.0, 0.0); }
  if (face == u32(FACE_U)) { return vec3f(0.0, 0.0, 1.0); }
  if (face == u32(FACE_D)) { return vec3f(0.0, 0.0, -1.0); }
  return vec3f(0.0);
}

fn sampleVis(i: i32, px: f32, py: f32) -> f32 {
  let box = u.visBox[i];
  let w = box.z; let h = box.w;
  if (w <= 0.0 || h <= 0.0) { return 1.0; }
  let lx = floor(px - box.x + VIS_FLOOR_EPS); let ly = floor(py - box.y + VIS_FLOOR_EPS);
  if (lx < 0.0 || ly < 0.0 || lx >= w || ly >= h) { return 1.0; }
  return f32(textureLoad(uLVis, vec2i(i32(lx), i * MAX_VIS_DIM + i32(ly)), 0).x) / 255.0;
}

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> @location(0) vec4u {
  let cell = vec2i(floor(frag.xy));
  let gi = textureLoad(uGI, cell, 0).xy;
  let kindU = giKind(gi.y);
  var L = u.ambient;
  if (kindU == 0u) {
    return vec4u(bitcast<vec3u>(L), 0u);
  }
  let dist = bitcast<f32>(textureLoad(uDepth, cell, 0).x);
  var P: vec3f;
  if (u.projMode == 0) {
    P = cellRayP(vec2f(cell), vec2i(u.gridCols, u.gridRows), u.posX, u.posY, u.eyeH, u.dirX, u.dirY, u.planeX, u.planeY, u.horizonRow, u.planeDistY, dist);
  } else {
    // RE-02a: pitched camera (28.1 A2); dist is the view depth vd.
    P = cellRayPitched(vec2f(cell), vec2i(u.gridCols, u.gridRows), vec3f(u.posX, u.posY, u.eyeH), u.pitchA.xyz, u.pitchB.xy, vec3f(u.pitchB.zw, u.pitchC.x), vec2f(u.pitchA.w, u.pitchC.y), dist, u.projMode == 2);
  }
  let faceU = giFace(gi.y);
  // US-041a: face 7 (rotated voxel-model part) decodes its normal from GA.w's octahedral bits
  var N: vec3f;
  if (kindU == u32(KIND_TERRAIN)) { N = unpackNormalOct(textureLoad(uGI, cell, 0).z); } // ME-06: terrain's packed normal lives in GI.z
  else if (faceU == u32(FACE_PACKED)) { N = unpackNormalOct(select(textureLoad(uGA, cell, 0).w, textureLoad(uGI, cell, 0).z, kindU == u32(KIND_MESH))); } // ME-20c: kind 9 GA.w may carry vertex AO; its packed normal is the same bits in GI.z
  else { N = faceNormal(faceU); }

  var litCount = 0;
  for (var i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= u.lightCount) { break; }
    let lp = u.lightPos[i];
    let d3 = lp.xyz - P;
    let r = lp.w;
    let d2 = dot(d3, d3);
    if (d2 >= r * r) { continue; }
    let d = sqrt(d2);
    let fo = falloffFast(d, r);
    if (fo <= 0.0) { continue; }
    let ndotl = select(0.0, dot(N, d3) / d, d > 1e-6);
    if (ndotl <= 0.0) { continue; }
    // BUG-LIGHT-001: sample at S = P + (L-P)/|L-P| * 0.02, toward the LIGHT (not along N)
    let toLight = d3 / d;
    var vis: f32;
    var psl = 0;
    if (u.pshA.x > 0.0) { let iu = u32(i); psl = i32(u.pshSlot[iu >> 2u][iu & 3u]); } // ME-16d: 0 = unshadowed / off
    if (psl > 0) { vis = f32(pointShadowTaps(psl - 1, P, N)) * 0.25; }
    else { vis = sampleVis(i, P.x + toLight.x * 0.02, P.y + toLight.y * 0.02); }
    if (vis <= 0.0) { continue; }
    L += u.lightCol[i].rgb * (fo * ndotl * vis);
    litCount++;
  }

  // US-007: skip when sunOn == 0 or N.sunDir <= 0; terrain (kind 7) gets its sun term analytically in the shade pass.
  var sunlit = 0;
  var sunN = 0;
  // S8-B2-12a (38.13): cloud-darkening byte, bits 24..31 of LIGHT.w. Stays 0 (bit-identical) unless strength > 0
  // (u.cloud.x) AND sunOn - a uniform branch, so strength 0 runs today's code literally.
  var cloudBits: u32 = 0u;
  if (u.sunMode == 2) {
    // ME-15c: shadow-map sun. Terrain only gets n (shade scales its analytic sun term by n/4); sun off -> terrain n = 4.
    let isT = kindU == u32(KIND_TERRAIN);
    if (u.sunOn != 0) {
      // cov is computed once per cell here (before the ndotsun test below) - terrain is included, 12b's shade
      // consumer reads the same byte for its analytic sun term.
      var cloudQ: u32 = 0u;
      if (u.cloudA.w > 0.0) { cloudQ = cloudShadeQ(P, u.sunDir); }
      let ndotsun = dot(N, u.sunDir);
      if (isT || ndotsun > 0.0) {
        sunN = sunShadowTaps(P, N);
        sunlit = select(0, 1, sunN >= 2);
        if (!isT && ndotsun > 0.0) {
          let cloudF = 1.0 - f32(cloudQ) * (1.0 / 255.0);
          L += u.sunCol * (ndotsun * f32(sunN) * 0.25 * cloudF);
        }
      }
      cloudBits = cloudQ << CLOUD_Q_SHIFT;
    } else if (isT) {
      sunN = 4;
    }
  } else if (u.sunOn != 0 && kindU != u32(KIND_TERRAIN)) {
    var cloudQ2: u32 = 0u;
    if (u.cloudA.w > 0.0) { cloudQ2 = cloudShadeQ(P, u.sunDir); }
    let ndotsun = dot(N, u.sunDir);
    if (ndotsun > 0.0) {
      // BUG-LIGHT-001: nudge toward the sun direction, not along N
      let S = P + u.sunDir * 0.02;
      if (sunVisible(S, u.sunDir)) {
        sunlit = 1;
        let cloudF = 1.0 - f32(cloudQ2) * (1.0 / 255.0);
        L += u.sunCol * (ndotsun * cloudF);
      }
    }
    cloudBits = cloudQ2 << CLOUD_Q_SHIFT;
  }

  // S8-B2-20 (38.17): horizon AO, LAST operation on L, after points/sun/cloud. Uniform branch - strength 0 runs
  // none of this (bit-identical), and terrain (kind 7) is excluded (D-007, analytic ambient in shade).
  if (u.aoStrength > 0.0 && kindU != u32(KIND_TERRAIN)) {
    let rc = aoRc(u.aoP.x, u.planeDistY, dist, u.aoP.z);
    var occSum: f32 = 0.0;
    occSum += aoTapCell(cell.x - rc, cell.y, P, N);
    occSum += aoTapCell(cell.x + rc, cell.y, P, N);
    occSum += aoTapCell(cell.x, cell.y - rc, P, N);
    occSum += aoTapCell(cell.x, cell.y + rc, P, N);
    let occ = occSum * 0.25;
    var aoF = 1.0 - u.aoStrength * AO_MAX * occ;
    // ME-20c (38.18): baked vertex AO of kind-9 cells (GA.w, written by raster when RASTER_FLAG_VAO). min, not product: both estimate the same ambient visibility.
    if (kindU == u32(KIND_MESH)) { aoF = min(aoF, 1.0 - u.aoStrength * AO_MAX * (1.0 - clamp(bitcast<f32>(textureLoad(uGA, cell, 0).w), 0.0, 1.0))); }
    L -= u.ambient * (1.0 - aoF);
  }

  return vec4u(bitcast<vec3u>(L), u32(sunlit) | (u32(litCount) << 8u) | (u32(sunN) << SUN_N_SHIFT) | cloudBits);
}
`;
