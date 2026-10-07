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

// RE-06 (docs/architecture.md 28.6): `meshVertSrc(true)` is the instanced variant
// (progMeshInst) - per-instance rows/meta attributes 6-9 (divisor 1), team
// material remap, world = instance rows applied to uModel*aPos. The static
// variant is byte-for-byte the pre-RE-06 source plus the two new varyings
// vObjectId/vAxisAligned (the fragment stage reads them instead of uniforms).

// CLOTH-1b2 (docs/architecture.md 33.5): `meshVertSrc(false, true)` is the cloth variant (progMeshCloth, also the shadow
// pass' vertex stage): aPos(0) + aNrmBits(2) from the dynamic 16 B buffer, aUV(1) from the static uv buffer, no flat/aux
// attributes - the flat data (planeId base, kind | face<<8 | mat<<16) comes from the `uFlat` uvec2 uniform, one value per
// draw. The normal leaves as the smooth `vNrmS` (interpolated, the fragment stage normalises and flips it on back faces).
export function meshVertSrc(instanced, cloth = false) {
  return `${GLSL_VERSION}${PRECISION}
${OCT_NORMAL}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in uint aNrmBits;    // oct-packed normal - ME-08a: read for vNrmW (kind-8 voxel face rule); the vertex stride still matches MeshBuffers.js exactly
${cloth ? '' : `layout(location = 3) in uvec2 aFlat;      // x = planeIdBase, y = kind | face<<8 | mat<<16
layout(location = 4) in vec4 aAux0123;    // zRef, aoMode, aux2, aux3
layout(location = 5) in vec4 aAux4567;    // aux4, aux5, unused, unused
`}${instanced ? `layout(location = 6) in vec4 iRow0;       // RE-06: instance rigid transform rows [A_r0 A_r1 A_r2 t_r] (divisor 1)
layout(location = 7) in vec4 iRow1;
layout(location = 8) in vec4 iRow2;       // .w = zBase (G-buffer z = worldZ - inst z)
layout(location = 9) in uvec2 iMeta;      // x = objectId, y = flags (bit0 yawAligned, bits 8-15 team)
` : ''}
uniform mat4 uModel;     // mesh-local -> world (DrawItem.matrix, D-028)${instanced ? '; instanced: the part matrix P_p (world = instance rows * uModel * aPos)' : ''}
uniform mat4 uViewProj;  // world -> clip (engine/render/projection.js shearProjection - the ONE camera matrix)
uniform int uPlaneIdOr;  // DrawItem.planeIdOr (27.15.4): (structSeq&7)<<28 for level structures
uniform float uZBase;    // DrawItem.zBase (G-buffer z = worldZ - zBase - aux.zRef)
uniform int uObjectId;   // ME-08a: DrawItem.objectId -> GI.w (structSeq for levels, 0x8000|slot for voxels)
uniform int uAxisAligned; // ME-08a: voxel part pose axis-aligned (partFlags[p] & 1); 0 for static draws
${cloth ? `uniform uvec2 uFlat;    // CLOTH-1b2: x = planeIdBase (0), y = KIND_MODEL | FACE_PACKED<<8 | matId<<16
` : ''}${instanced ? `uniform int uTeamSlot[4];   // RE-06: table.team.slotIds (0 = unused slot)
uniform int uTeamMat[32];   // table.team.mat: team*4 + slot
` : ''}
flat out int vPlaneId;
flat out uint vKind, vFace, vMat;
flat out float vAoMode, vZRef, vAux2, vAux3, vAux4, vAux5;
flat out float vZBase;
${cloth ? 'out vec3 vNrmS;          // CLOTH-1b2: smooth world-space vertex normal (perspective-correct, normalised per fragment)' : `flat out vec3 vNrmW;     // ME-08a: world-space face normal (one per greedy quad)
out vec3 vNrmS;          // MESH-GPUCMP-01 (A6): smooth world-space vertex normal for kind 9 (perspective-correct, normalised per fragment)`}
flat out uint vObjectId, vAxisAligned; // RE-06: were fragment uniforms; per-instance now
out vec2 vUV;
out float vWorldZ;

void main() {
${cloth ? `  vec4 worldPos = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * worldPos;

  vPlaneId = int(uFlat.x) | uPlaneIdOr;
  vKind = uFlat.y & 0xffu;
  vFace = (uFlat.y >> 8u) & 0xfu;
  vMat = (uFlat.y >> 16u) & 0xffffu;
  vAoMode = 0.0;
  vZRef = 0.0;
  vAux2 = 0.0;
  vAux3 = 0.0;
  vAux4 = 0.0;
  vAux5 = 0.0;
  vZBase = uZBase;
  vObjectId = uint(uObjectId);
  vAxisAligned = 0u;
  vNrmS = mat3(uModel) * unpackNormalOct(aNrmBits);
` : instanced ? `  vec3 lp = (uModel * vec4(aPos, 1.0)).xyz;
  vec3 wp = vec3(dot(iRow0.xyz, lp) + iRow0.w, dot(iRow1.xyz, lp) + iRow1.w, dot(iRow2.xyz, lp) + iRow2.w);
  vec4 worldPos = vec4(wp, 1.0);
  gl_Position = uViewProj * worldPos;

  vPlaneId = int(aFlat.x) | uPlaneIdOr | int((iMeta.x & 0xFu) << 24);
  vKind = aFlat.y & 0xffu;
  vFace = (aFlat.y >> 8u) & 0xfu;
  uint mat = (aFlat.y >> 16u) & 0xffffu;
  uint team = (iMeta.y >> 8u) & 0xffu;
  if (team != 0u) {
    for (int s = 0; s < 4; s++) {
      if (uTeamSlot[s] != 0 && int(mat) == uTeamSlot[s]) { mat = uint(uTeamMat[int(team) * 4 + s]); break; }
    }
  }
  vMat = mat;
  vAoMode = aAux0123.y;
  vZRef = aAux0123.x;
  vAux2 = aAux0123.z;
  vAux3 = aAux0123.w;
  vAux4 = aAux4567.x;
  vAux5 = aAux4567.y;
  vZBase = iRow2.w;
  vObjectId = iMeta.x;
  vAxisAligned = uint(uAxisAligned) & (iMeta.y & 1u);
` : `  vec4 worldPos = uModel * vec4(aPos, 1.0);
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
  vObjectId = uint(uObjectId);
  vAxisAligned = uint(uAxisAligned);
`}
  // mat3(uModel) = rotation x uniform cellM, so normalising is exact.
${cloth ? '' : instanced ? `  vec3 ln = normalize(mat3(uModel) * unpackNormalOct(aNrmBits));
  vec3 nw = normalize(vec3(dot(iRow0.xyz, ln), dot(iRow1.xyz, ln), dot(iRow2.xyz, ln)));
  vNrmW = nw;
  vNrmS = nw;
` : `  vNrmW = normalize(mat3(uModel) * unpackNormalOct(aNrmBits));
  vNrmS = normalize(mat3(uModel) * unpackNormalOct(aNrmBits));
`}
  vUV = aUV;
  vWorldZ = worldPos.z;
}
`;
}

export const MESH_VERT_SRC = meshVertSrc(false);
export const MESH_INST_VERT_SRC = meshVertSrc(true);
export const MESH_CLOTH_VERT_SRC = meshVertSrc(false, true); // CLOTH-1b2
