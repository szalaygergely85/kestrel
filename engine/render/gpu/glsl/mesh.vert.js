// engine/render/gpu/glsl/mesh.vert.js - ME-04 (docs/backlog.md, docs/
// architecture.md 27.2 "GpuDevice shape", 27.4, 27.5, 27.11 ME-04 row). The
// GPU raster pass' vertex stage: mesh-local -> world (`uModel`, the
// DrawItem's own matrix, D-028) -> clip (`uViewProj`, `engine/render/
// projection.js`'s `shearProjection` - the SAME matrix `rasterJS.js` and the
// CPU DDA/caster agree on, 27.5). Renders directly into the SAME
// sub-sample G-buffer socket the DDA pass (`dda.frag.js`) already fills
// (`fboCastSub`'s `texSGI`/`texSGA`/`texSDepth`, RG32UI/RGBA32UI/R32UI,
// unchanged formats) - `resolve`/`deriv`/`light`/`shade`/`edge` need NO
// changes at all: the raster pass just becomes an alternative way to fill
// pass A's sub-sample output, same shape, exactly like `?renderer=dda`
// today, so `_passResolve()` onward runs byte-for-byte unchanged (27.11 AC
// "'dda' output unchanged").
//
// Scope (this story): DRAW_STATIC items only (engine/mesh/levelMesh.js's
// level meshes, i.e. the tower) - one draw call per item, `uModel` built
// from the DrawItem's `matrix` (translation-only for grid levels, 27.15.2).
// Voxel per-part instancing (`uPart[8]`) and terrain (indexed layout) are a
// later story's addition to this same shader family (ME-06/08), not
// implemented here (27.12: "Deletion happens only after phase gates" - this
// grows incrementally, never all at once).
//
// Winding: cull NONE (engine/mesh/MeshData.js's `StaticMeshBuilder`
// docstring + 27.15.2 "Phase 1 draws with cull none in both twins" - a
// negative-area triangle in screen space is still drawn, exactly like
// `rasterJS.js`'s own `A2 < 0` swap-and-continue).
//
// Attribute layout matches engine/render/gpu/MeshBuffers.js's
// `STATIC_VERTEX_LAYOUT`/`buildStaticVertexData` exactly (stride 64 B,
// 27.15.0 amendment 2) - a change to one without the other is the one bug
// this file and that one must never independently drift into; MeshBuffers.
// test.js's parity check guards the encoder side, this file's own
// `glsl.test.js` string checks guard the decoder side (attribute count/
// locations).
import { GLSL_VERSION, PRECISION, OCT_NORMAL } from './common.js';

export const MESH_VERT_SRC = `${GLSL_VERSION}${PRECISION}
${OCT_NORMAL}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in uint aNrmBits;    // oct-packed normal - ME-08a: read for vNrmW (kind-8 voxel face rule); the vertex stride still matches MeshBuffers.js exactly
layout(location = 3) in uvec2 aFlat;      // x = planeIdBase, y = kind | face<<8 | mat<<16
layout(location = 4) in vec4 aAux0123;    // zRef, aoMode, aux2, aux3
layout(location = 5) in vec4 aAux4567;    // aux4, aux5, unused, unused

uniform mat4 uModel;     // mesh-local -> world (DrawItem.matrix, D-028)
uniform mat4 uViewProj;  // world -> clip (engine/render/projection.js shearProjection - the ONE camera matrix)
uniform int uPlaneIdOr;  // DrawItem.planeIdOr (27.15.4): (structSeq&7)<<28 for level structures
uniform float uZBase;    // DrawItem.zBase (G-buffer z = worldZ - zBase - aux.zRef)
uniform int uObjectId;   // ME-08a: DrawItem.objectId -> GI.w (structSeq for levels, 0x8000|slot for voxels)
uniform int uAxisAligned; // ME-08a: voxel part pose axis-aligned (partFlags[p] & 1); 0 for static draws

flat out int vPlaneId;
flat out uint vKind, vFace, vMat;
flat out float vAoMode, vZRef, vAux2, vAux3, vAux4, vAux5;
flat out float vZBase;
flat out vec3 vNrmW;     // ME-08a: world-space face normal (one per greedy quad)
out vec2 vUV;
out float vWorldZ;

void main() {
  vec4 worldPos = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * worldPos;

  vPlaneId = int(aFlat.x) | uPlaneIdOr;
  vKind = aFlat.y & 0xffu;
  vFace = (aFlat.y >> 8u) & 0xfu;
  vMat = (aFlat.y >> 16u) & 0xffffu;
  vAoMode = aAux0123.y;
  vZRef = aAux0123.x;
  vAux2 = aAux0123.z;
  vAux3 = aAux0123.w;
  vAux4 = aAux4567.x;
  vAux5 = aAux4567.y;
  vZBase = uZBase;

  // mat3(uModel) = rotation x uniform cellM, so normalising is exact.
  vNrmW = normalize(mat3(uModel) * unpackNormalOct(aNrmBits));

  vUV = aUV;
  vWorldZ = worldPos.z;
}
`;
