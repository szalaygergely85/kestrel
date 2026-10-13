// engine/render/gpu/glsl/terrain.vert.js - ME-06 (docs/backlog.md, docs/
// architecture.md 27.1 item 1, 27.4, 27.11 ME-06 row). The GPU raster pass'
// kind-7 (terrain) vertex+fragment pair: mesh-local (`engine/mesh/
// terrainMesh.js`'s near-chunk/far-tile/stitch `MeshData`, layout 'terrain')
// -> world (`uModel`, the chunk's own translation-only origin, D-028) ->
// clip (`uViewProj`, the SAME `shearProjection` matrix `mesh.vert.js`/
// `rasterJS.js`/the CPU DDA agree on, 27.5). Renders into the SAME
// sub-sample G-buffer socket `terrain.frag.js`'s march pass already fills
// for kind 7 (`fboRasterSub`'s `texSGI`/`texSGA`/`texSDepth` - shared with
// `mesh.vert/frag.js`'s DRAW_STATIC items, 27.4's "raster pass writes
// exactly what the DDA wrote for grid content").
//
// Vertex layout (`engine/mesh/terrainMesh.js`'s terrain-layout `MeshData`:
// `pos` + `nrm` only, no `uv`/`flat`/`aux` - 27.3 "terrain layout has no
// uv"): stride 16 B = pos(12) + nrm(4), matching
// `MeshBuffers.js`'s `TERRAIN_VERTEX_LAYOUT`/`buildTerrainVertexData`
// exactly (same one-file-drifts-the-other rule `mesh.vert.js`'s own header
// comment states for the static layout).
//
// Normal: `aNrmBits` (oct-packed, per vertex - terrain vertices carry a
// SMOOTH analytic normal, 27.15.5's `terrainNormalNear`/`farNormalAt`,
// unlike level quads' flat per-face normal) is unpacked HERE, in the vertex
// stage, and interpolated as a plain `vec3` varying - GLSL never
// interpolates the packed bits meaningfully across a triangle. The
// fragment stage re-normalises and re-packs it into `GI.z` (27.1 item 5:
// "GI becomes RGBA32UI, z = octahedral-packed normal" - the kind-7 normal
// moves OFF `GA.w`/`aoD` for both the march pass, terrain.frag.js, and this
// raster pass, so `shade.frag.js`'s kind==7 branch has exactly one read
// site regardless of which pass produced the hit).
//
// Mat (type): terrain-layout `MeshData` carries NO per-vertex mat (27.15.5:
// `TerrainMeshSet.typeAt` is a runtime lookup, not baked geometry) - the
// fragment stage samples the SAME near/far type textures the march pass
// already binds (`uNearType`/`uFarType`, via terrain.frag.js's shared
// `NEAR_TYPE_NEAREST_GLSL`/`FAR_TYPE_NEAREST_GLSL` snippets), with the same
// "near nearest texel inside the band else far nearest" rule
// `TerrainMeshSet.typeAt`/`rasterJS.js`'s `kind7Mat` use.
//
// Winding: cull NONE, matching `mesh.vert.js`/`rasterJS.js` (27.15.2 "Phase
// 1 draws with cull none in both twins" - terrain triangles are always
// consistently wound upward by `terrainMesh.js`'s own quad-split rule, but
// staying cull-none keeps every raster draw call uniform and matches the
// JS twin bit for bit).
//
// Polygon offset: OFF by default (27.5/27.13's "if z-fighting shows up in
// phase 1 between a placed mesh and terrain, use polygon offset on terrain
// only... never per-object hacks"). `GpuCellPipeline.js` leaves
// `gl.POLYGON_OFFSET_FILL` disabled for this pass; flip it on (1, 4 units,
// matching the shadow-pass bias already planned for phase 3, 27.9) only if
// the owner's real-GPU `?gpucompare=1&renderer=mesh` pass shows a seam at
// the tower foot - never enabled speculatively.
//
// Structure footprints (architect fix, ME-06): the DDA never draws terrain
// inside a placed structure's 2D bbox ("cells in a structure bbox belong to
// the structure", terrainCaster.js `buildSkips` / terrain.frag.js's skip
// slabs). The mesh path has no ray to skip, so the fragment stage DISCARDS
// terrain fragments whose world xy falls inside any `uStructFoot` box -
// the literal per-fragment twin of that rule (rasterJS.js: `ctx.structFoot`).
// Without it the 2 m band under the tower pokes through the tower floor
// (the hill crown is above the level's floor z in places).
import { GLSL_VERSION, PRECISION, OCT_NORMAL } from './glslref.common.js';
import { KIND_TERRAIN, FACE_PACKED } from '../../GBuffer.js';
import { MAX_STRUCTS } from '../WorldTextures.js';
import { NEAR_TYPE_NEAREST_GLSL, FAR_TYPE_NEAREST_GLSL } from './glslref.extra.js';

export const TERRAIN_VERT_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) in vec3 aPos;
layout(location = 1) in uint aNrmBits;

uniform mat4 uModel;     // mesh-local -> world (chunk/tile origin translation, D-028)
uniform mat4 uViewProj;  // world -> clip (engine/render/projection.js shearProjection)

${OCT_NORMAL}

out vec3 vWorldPos;
out vec3 vNormal;

void main() {
  vec4 worldPos = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * worldPos;
  vWorldPos = worldPos.xyz;
  // Unpacked here (vertex stage): GLSL interpolates the resulting vec3
  // smoothly across the triangle, exactly like a conventional vertex
  // normal - packed uint bits would not interpolate meaningfully.
  vNormal = unpackNormalOct(aNrmBits);
}
`;

export const TERRAIN_RASTER_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out uvec4 outGI;
layout(location = 1) out uvec4 outGA;
layout(location = 2) out uint outDepth;

in vec3 vWorldPos;
in vec3 vNormal;

uniform int uObjectId;      // 0x7000|chunkIndex (27.4) - DrawItem.objectId
uniform usampler2D uNearType; // R8UI, near.w x near.h, nearest
uniform vec4 uNearMap;        // x0, y0, cell (2), size (near.w == near.h)
uniform int uNearReady;       // activeNearLOD(terrain) != null (23.4/terrainCaster.js)
uniform usampler2D uFarType;  // R8UI, mapW x mapH, nearest
uniform vec4 uFarMap;         // x0, y0, cell, size (mapW == mapH)
uniform vec4 uStructFoot[${MAX_STRUCTS}]; // x0, y0, x1, y1 (world m) per placed structure - terrain is never drawn inside
uniform int uStructCount;

${OCT_NORMAL}
${NEAR_TYPE_NEAREST_GLSL}
${FAR_TYPE_NEAREST_GLSL}

const int KIND_TERRAIN = ${KIND_TERRAIN};
const int FACE_PACKED = ${FACE_PACKED};
const int PLANEID_TERRAIN = -1;

// Literal twin of engine/mesh/terrainMesh.js's TerrainMeshSet.typeAt
// ("near nearest texel inside the band else far nearest") and rasterJS.js's
// ctx.kind7Mat - the mat/type lookup this raster pass' geometry has no
// baked field for (27.15.5: terrain-layout MeshData carries no per-vertex
// mat).
int terrainTypeAt(float x, float y) {
  if (uNearReady != 0) {
    int ix = int(floor((x - uNearMap.x) / uNearMap.z));
    int iy = int(floor((y - uNearMap.y) / uNearMap.z));
    int W = int(uNearMap.w);
    if (ix >= 0 && iy >= 0 && ix < W && iy < W) return int(texelFetch(uNearType, ivec2(ix, iy), 0).r);
  }
  return farTypeNearest(x, y);
}

void main() {
  // Structure footprint carve (see the header): [x0, x1) x [y0, y1), the
  // same half-open rule rasterJS.js's twin uses.
  for (int i = 0; i < ${MAX_STRUCTS}; i++) {
    if (i >= uStructCount) break;
    vec4 b = uStructFoot[i];
    if (vWorldPos.x >= b.x && vWorldPos.x < b.z && vWorldPos.y >= b.y && vWorldPos.y < b.w) discard;
  }
  vec3 N = normalize(vNormal);
  int type = terrainTypeAt(vWorldPos.x, vWorldPos.y);
  float dist = 1.0 / gl_FragCoord.w; // perpendicular camera-forward distance d (27.5 w_clip = d), same convention mesh.frag.js uses
  outGI = uvec4(uint(PLANEID_TERRAIN), uint(KIND_TERRAIN) | (uint(FACE_PACKED) << 8u) | (uint(type) << 16u), packNormalOct(N), uint(uObjectId));
  // aoD (GA.w) is +Inf (kind 7 has no seam AO, 27.4's table); u,v = world
  // x,y (the shade pass' TLOOK hash key), z = world z (zBase 0/zRef 0 for
  // terrain items, 27.15.5's "DRAW_TERRAIN items, zBase 0").
  outGA = uvec4(floatBitsToUint(vWorldPos.x), floatBitsToUint(vWorldPos.y), floatBitsToUint(vWorldPos.z), floatBitsToUint(1.0e30));
  outDepth = floatBitsToUint(dist);
}
`;
