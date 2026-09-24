// US-030a (docs/architecture.md 14.2 item 3, pass C): GLSL port of
// `engine/render/detailShade.js`'s `computeDerivatives` - same-planeId
// 4-neighbour central/one-sided difference, analytic fallback at a silhouette
// edge. Needed because the CPU no longer runs on the `gl2` path (so nothing
// else computes `GD` any more) - output is `GD` (RGBA32UI, `floatBitsToUint`,
// per 14.2's "all uint formats from now on").
import { GLSL_VERSION, PRECISION, GBUF_UNPACK } from './common.js';
import { KIND_TERRAIN } from '../../GBuffer.js';

export const DERIV_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out uvec4 outGD;

uniform ivec2 uGrid; // cols, rows
uniform usampler2D uGI;   // RG32UI: x = planeId, y = kind|face<<8|mask<<12|mat<<16
uniform usampler2D uGA;   // RGBA32UI: floatBitsToUint(u, v, z, aoD)
uniform usampler2D uDepth; // R32UI: floatBitsToUint(dist)
uniform float uTanHalfHFov;
uniform float uPlaneDistY;

${GBUF_UNPACK}

struct Sample { uint kind; int planeId; float u, v; };

Sample fetchSample(ivec2 c) {
  uvec2 gi = texelFetch(uGI, c, 0).xy;
  uvec4 ga = texelFetch(uGA, c, 0);
  Sample s;
  s.kind = giKind(gi.y);
  s.planeId = int(gi.x);
  s.u = uintBitsToFloat(ga.x);
  s.v = uintBitsToFloat(ga.y);
  return s;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  uvec2 gi0 = texelFetch(uGI, cell, 0).xy;
  uint kind0 = giKind(gi0.y);
  // US-016 (14.4 architect ruling, 2026-09-24): terrain cells need no
  // derivatives (shadeTerrainFar has no texture-detail/mip term) - skip like
  // an empty cell, matching the accepted deviation note in terrainCaster.js.
  if (kind0 == 0u || kind0 == ${KIND_TERRAIN}u) { outGD = uvec4(0u); return; }
  int pid0 = int(gi0.x);
  uvec4 ga0 = texelFetch(uGA, cell, 0);
  float u0 = uintBitsToFloat(ga0.x), v0 = uintBitsToFloat(ga0.y);
  float depth0 = uintBitsToFloat(texelFetch(uDepth, cell, 0).x);

  float dudx, dvdx, dudy, dvdy;

  bool hasL = cell.x > 0, hasR = cell.x < uGrid.x - 1;
  Sample l, r;
  bool okL = false, okR = false;
  if (hasL) { l = fetchSample(cell + ivec2(-1, 0)); okL = l.kind != 0u && l.planeId == pid0; }
  if (hasR) { r = fetchSample(cell + ivec2(1, 0)); okR = r.kind != 0u && r.planeId == pid0; }
  if (okL && okR) { dudx = (r.u - l.u) * 0.5; dvdx = (r.v - l.v) * 0.5; }
  else if (okR) { dudx = r.u - u0; dvdx = r.v - v0; }
  else if (okL) { dudx = u0 - l.u; dvdx = v0 - l.v; }
  else { dudx = depth0 * 2.0 * uTanHalfHFov / float(uGrid.x); dvdx = 0.0; }

  bool hasT = cell.y > 0, hasB = cell.y < uGrid.y - 1;
  Sample t, b;
  bool okT = false, okB = false;
  if (hasT) { t = fetchSample(cell + ivec2(0, -1)); okT = t.kind != 0u && t.planeId == pid0; }
  if (hasB) { b = fetchSample(cell + ivec2(0, 1)); okB = b.kind != 0u && b.planeId == pid0; }
  if (okT && okB) { dudy = (b.u - t.u) * 0.5; dvdy = (b.v - t.v) * 0.5; }
  else if (okB) { dudy = b.u - u0; dvdy = b.v - v0; }
  else if (okT) { dudy = u0 - t.u; dvdy = v0 - t.v; }
  else {
    dudy = 0.0;
    bool isVertKind = kind0 == 1u || kind0 == 2u || kind0 == 3u;
    dvdy = (isVertKind ? -1.0 : 1.0) * depth0 / uPlaneDistY;
  }

  outGD = uvec4(floatBitsToUint(dudx), floatBitsToUint(dvdx), floatBitsToUint(dudy), floatBitsToUint(dvdy));
}
`;
