// WG-3a (docs/architecture.md 38.5/38.8): WGSL port of glsl/resolve.frag.js (US-030b pass B), line by line.
// Resolves the n*n sub-sample G-buffer (SGI/SGA/SDEPTH, (cols*n) x (rows*n)) to the per-cell GI/GA/DEPTH (cols x rows).
// Vote rule (normative 14.2 item 3): group by (kind, planeId, mat), winner = largest group, ties -> smaller min depth;
// GA/DEPTH come from the winner group's sub-sample nearest the cell centre (ties: smallest sub-index).
// Cell coordinates come from @builtin(position).xy (memory rows, no flip). Integer textures: textureLoad only.
// Bindings: @group(0) 0 = SGI (rgba32uint), 1 = SGA (rgba32uint), 2 = SDEPTH (r32uint), 3 = MASK (r8uint);
// @group(1) @binding(0) = ResolveU. Targets: 0 = GI rgba32uint, 1 = GA rgba32uint, 2 = DEPTH r32uint (x only is stored).
import { defineUniformBlock } from './uniformBlock.js';
import { GBUF_UNPACK_WGSL, FULLSCREEN_VS_WGSL } from './common.wgsl.js';
import { RESOLVE_BAND_WGSL } from '../../resolveBand.js'; // RTX-RAYS-BAND-01 (38.79): RG4 / Bayer / threshold helpers, one source with the JS twin
export const MAX_SUB = 16; // 4x4, the architecture's hard cap (n <= 4)

/** Uniform block: n = rays per axis (1..4); bandM = far-band metres (38.79; 0 = off, only read when n == 4). */
export const RESOLVE_BLOCK = defineUniformBlock('ResolveU', [
  { name: 'n', type: 'i32' },
  { name: 'bandM', type: 'f32' },
]);

/** Texture slot kinds for PipelineDesc.bindings.textures. */
export const RESOLVE_TEXTURES = Object.freeze(['uint', 'uint', 'uint', 'uint']);
/** Colour target formats, in @location order. */
export const RESOLVE_TARGETS = Object.freeze(['rgba32uint', 'rgba32uint', 'r32uint']);

export const RESOLVE_WGSL = `
${RESOLVE_BLOCK.wgsl}
@group(0) @binding(0) var uSGI: texture_2d<u32>;    // x=planeId, y=kind|face|mask|cov|mat, z=normal, w=objectId, sub-grid
@group(0) @binding(1) var uSGA: texture_2d<u32>;    // bitcast u,v,z,aoD, sub-grid
@group(0) @binding(2) var uSDepth: texture_2d<u32>; // x = bitcast dist, sub-grid
@group(0) @binding(3) var uMask: texture_2d<u32>;   // r8uint, cols x rows (per-cell UI overlay bit)
@group(1) @binding(0) var<uniform> u: ResolveU;
${GBUF_UNPACK_WGSL}
const MAX_SUB: i32 = ${MAX_SUB};
${FULLSCREEN_VS_WGSL}
${RESOLVE_BAND_WGSL}
struct FO {
  @location(0) gi: vec4u,
  @location(1) ga: vec4u,
  @location(2) depth: vec4u,
};

// 38.79 far path (n == 4, bandM > 0): returns vec4i(sub i, sub j, cov, 1) when the cell's nearest RG4 sample is beyond the
// dithered threshold and the vote ran over the 4 RG4 samples; (0,0,0,0) = use the full 16-sample path.
fn farPick(cell: vec2i, bandM: f32) -> vec4i {
  var kk: array<u32, 4>;
  var pk: array<i32, 4>;
  var mk: array<u32, 4>;
  var dk: array<f32, 4>;
  var dMin = 1.0e30;
  for (var r = 0; r < 4; r++) {
    let sc = vec2i(cell.x * 4 + rg4i(r), cell.y * 4 + rg4j(r));
    let sgi = textureLoad(uSGI, sc, 0).xy;
    kk[r] = giKind(sgi.y); pk[r] = i32(sgi.x); mk[r] = giMat(sgi.y);
    dk[r] = bitcast<f32>(textureLoad(uSDepth, sc, 0).x);
    if (kk[r] != 0u && dk[r] < dMin) { dMin = dk[r]; }
  }
  if (!(dMin > bandThreshold(bandM, cell))) { return vec4i(0, 0, 0, 0); }
  var bestCount = -1; var bestMinDepth = 1.0e30; var winner = 0;
  for (var a = 0; a < 4; a++) {
    var count = 0; var minD = 1.0e30;
    for (var b = 0; b < 4; b++) {
      if (kk[b] == kk[a] && pk[b] == pk[a] && mk[b] == mk[a]) { count++; if (dk[b] < minD) { minD = dk[b]; } }
    }
    if (count > bestCount || (count == bestCount && minD < bestMinDepth)) {
      bestCount = count; bestMinDepth = minD; winner = a;
    }
  }
  var nearest = -1; var nearestMag = 1.0e30;
  for (var a = 0; a < 4; a++) {
    if (kk[a] != kk[winner] || pk[a] != pk[winner] || mk[a] != mk[winner]) { continue; }
    let ox = (f32(rg4i(a)) + 0.5) / 4.0 - 0.5;
    let oy = (f32(rg4j(a)) + 0.5) / 4.0 - 0.5;
    let mag = ox * ox + oy * oy;
    if (mag < nearestMag) { nearestMag = mag; nearest = a; }
  }
  var cov = i32(f32(bestCount) * 8.0 / 4.0 - 1.0);
  cov = clamp(cov, 0, 7);
  return vec4i(rg4i(nearest), rg4j(nearest), cov, 1);
}

// Shared output tail (near and far paths): sc = winning sub-sample coords, kind/pkw/mkw its key parts.
fn finish(cell: vec2i, sc: vec2i, kind: u32, pkw: i32, mkw: u32, cov: i32) -> FO {
  let mask = textureLoad(uMask, cell, 0).x & 1u;
  var o: FO;
  if (kind == 0u) {
    o.gi = vec4u(0u, mask << 12u, 0u, 0u);
    o.ga = vec4u(0u);
    o.depth = vec4u(0x7f800000u, 0u, 0u, 0u);
  } else {
    // ME-06 (27.4): GI.z/GI.w (normal/objectId) ride through unchanged from the SAME winning sub-sample as GA/DEPTH.
    let sgiWin = textureLoad(uSGI, sc, 0);
    let faceBits = (sgiWin.y >> 8u) & 0xfu;
    o.gi = vec4u(u32(pkw), kind | (faceBits << 8u) | (mask << 12u) | (u32(cov) << 13u) | (mkw << 16u), sgiWin.z, sgiWin.w);
    o.ga = textureLoad(uSGA, sc, 0);
    o.depth = vec4u(textureLoad(uSDepth, sc, 0).x, 0u, 0u, 0u);
  }
  return o;
}

@fragment

fn fs_main(@builtin(position) frag: vec4f) -> FO {
  let cell = vec2i(floor(frag.xy));
  let uN = u.n;
  let n2 = uN * uN;

  if (uN == 4 && u.bandM > 0.0) {
    let fp = farPick(cell, u.bandM);
    if (fp.w == 1) {
      let fsc = vec2i(cell.x * 4 + fp.x, cell.y * 4 + fp.y);
      let fy = textureLoad(uSGI, fsc, 0);
      return finish(cell, fsc, giKind(fy.y), i32(fy.x), giMat(fy.y), fp.z);
    }
  }

  var kk: array<u32, ${MAX_SUB}>;
  var pk: array<i32, ${MAX_SUB}>;
  var mk: array<u32, ${MAX_SUB}>;
  var dk: array<f32, ${MAX_SUB}>;
  var k = 0;
  for (var j = 0; j < 4; j++) {
    if (j >= uN) { break; }
    for (var i = 0; i < 4; i++) {
      if (i >= uN) { break; }
      let sc = vec2i(cell.x * uN + i, cell.y * uN + j);
      let sgi = textureLoad(uSGI, sc, 0).xy;
      kk[k] = giKind(sgi.y); pk[k] = i32(sgi.x); mk[k] = giMat(sgi.y);
      dk[k] = bitcast<f32>(textureLoad(uSDepth, sc, 0).x);
      k++;
    }
  }

  // Winning key: largest group, ties -> smaller min depth. Scan order + STRICT improvement keeps the pick deterministic.
  var bestCount = -1; var bestMinDepth = 1.0e30; var winner = 0;
  for (var a = 0; a < MAX_SUB; a++) {
    if (a >= n2) { break; }
    var count = 0; var minD = 1.0e30;
    for (var b = 0; b < MAX_SUB; b++) {
      if (b >= n2) { break; }
      if (kk[b] == kk[a] && pk[b] == pk[a] && mk[b] == mk[a]) { count++; if (dk[b] < minD) { minD = dk[b]; } }
    }
    if (count > bestCount || (count == bestCount && minD < bestMinDepth)) {
      bestCount = count; bestMinDepth = minD; winner = a;
    }
  }

  // Among the winning group's members, the one nearest the fixed cell centre supplies GA/DEPTH (same tie rule).
  var nearest = -1; var nearestMag = 1.0e30;
  for (var a = 0; a < MAX_SUB; a++) {
    if (a >= n2) { break; }
    if (kk[a] != kk[winner] || pk[a] != pk[winner] || mk[a] != mk[winner]) { continue; }
    let ii = a - (a / uN) * uN;
    let jj = a / uN;
    let ox = (f32(ii) + 0.5) / f32(uN) - 0.5;
    let oy = (f32(jj) + 0.5) / f32(uN) - 0.5;
    let mag = ox * ox + oy * oy;
    if (mag < nearestMag) { nearestMag = mag; nearest = a; }
  }

  var cov = i32(f32(bestCount) * 8.0 / f32(n2) - 1.0);
  cov = clamp(cov, 0, 7);
  let sc = vec2i(cell.x * uN + (nearest - (nearest / uN) * uN), cell.y * uN + (nearest / uN));
  return finish(cell, sc, kk[nearest], pk[nearest], mk[nearest], cov);
}
`;
