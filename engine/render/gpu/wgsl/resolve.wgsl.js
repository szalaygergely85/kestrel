// WG-3a (docs/architecture.md 38.5/38.8): WGSL port of glsl/resolve.frag.js (US-030b pass B), line by line.
// Resolves the n*n sub-sample G-buffer (SGI/SGA/SDEPTH, (cols*n) x (rows*n)) to the per-cell GI/GA/DEPTH (cols x rows).
// Vote rule (normative 14.2 item 3): group by (kind, planeId, mat), winner = largest group, ties -> smaller min depth;
// GA/DEPTH come from the winner group's sub-sample nearest the cell centre (ties: smallest sub-index).
// Cell coordinates come from @builtin(position).xy (memory rows, no flip). Integer textures: textureLoad only.
// Bindings: @group(0) 0 = SGI (rgba32uint), 1 = SGA (rgba32uint), 2 = SDEPTH (r32uint), 3 = MASK (r8uint);
// @group(1) @binding(0) = ResolveU. Targets: 0 = GI rgba32uint, 1 = GA rgba32uint, 2 = DEPTH r32uint (x only is stored).
import { defineUniformBlock } from './uniformBlock.js';
import { GBUF_UNPACK_WGSL, FULLSCREEN_VS_WGSL } from './common.wgsl.js';
import { MAX_SUB } from '../glsl/resolve.frag.js';

/** Uniform block: n = rays per axis (1..4). */
export const RESOLVE_BLOCK = defineUniformBlock('ResolveU', [
  { name: 'n', type: 'i32' },
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
struct FO {
  @location(0) gi: vec4u,
  @location(1) ga: vec4u,
  @location(2) depth: vec4u,
};

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> FO {
  let cell = vec2i(floor(frag.xy));
  let uN = u.n;
  let n2 = uN * uN;

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

  let kind = kk[nearest];
  let mask = textureLoad(uMask, cell, 0).x & 1u;
  var cov = i32(f32(bestCount) * 8.0 / f32(n2) - 1.0);
  cov = clamp(cov, 0, 7);

  let sc = vec2i(cell.x * uN + (nearest - (nearest / uN) * uN), cell.y * uN + (nearest / uN));
  var o: FO;
  if (kind == 0u) {
    o.gi = vec4u(0u, mask << 12u, 0u, 0u);
    o.ga = vec4u(0u);
    o.depth = vec4u(0x7f800000u, 0u, 0u, 0u);
  } else {
    // ME-06 (27.4): GI.z/GI.w (normal/objectId) ride through unchanged from the SAME winning sub-sample as GA/DEPTH.
    let sgiWin = textureLoad(uSGI, sc, 0);
    let faceBits = (sgiWin.y >> 8u) & 0xfu;
    o.gi = vec4u(u32(pk[nearest]), kind | (faceBits << 8u) | (mask << 12u) | (u32(cov) << 13u) | (mk[nearest] << 16u), sgiWin.z, sgiWin.w);
    o.ga = textureLoad(uSGA, sc, 0);
    o.depth = vec4u(textureLoad(uSDepth, sc, 0).x, 0u, 0u, 0u);
  }
  return o;
}
`;
