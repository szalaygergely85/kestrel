// engine/render/gpu/glsl/mesh.frag.js - ME-04 (docs/backlog.md, docs/
// architecture.md 27.4, 27.7 item 1, 27.11 ME-04 row, 27.15.2). Fragment
// stage of the GPU raster pass: writes the SAME 3 sub-sample outputs
// `dda.frag.js` does (`outGI` RG32UI, `outGA` RGBA32UI, `outDepth` R32UI,
// via MRT into `fboCastSub`'s own textures - `texSGI`/`texSGA`/`texSDepth`)
// PLUS a real hardware DEPTH_COMPONENT24 attachment (this pass' own 4th
// target - a triangle rasteriser needs a genuine per-fragment z-test
// between overlapping triangles, unlike the DDA's analytic "first hit
// wins"; `dFdx`/`gl_FragDepth` are never used - GL's own depth test from
// `gl_Position.z/w` is the whole mechanism, per 27.13's "do not" list).
// `resolve.frag.js`/`deriv.frag.js`/`light.frag.js`/`shade.frag.js` read
// these exact textures already (whichever pass wrote them last -
// `_subSetCur`, GpuCellPipeline.js) and need NO changes: this pass is just
// an alternative way to fill pass A's output, byte-for-byte the same shape
// `dda.frag.js` produces for grid content (27.4's own rule: "the raster
// pass writes exactly what the DDA wrote for grid content").
//
// Scope decision (27.15.0 "if unclear, pick rasterJS.js's behaviour, note
// it, continue"): 27.4/27.2 describe a FUTURE `GI` widened to RGBA32UI
// (z = oct normal, w = objectId) for kind 9 (glTF, phase 3) and later
// kind 7/8 migrations (ME-06/08). Kinds 1-6 (level quads, this story's
// entire scope - the tower) need neither: `face` (1-6) alone already fully
// determines the shading normal (`faceNormal()`, unchanged), and objectId
// has no reader yet (editor picking lands in ME-18). Widening the shared
// `texSGI`/`texGI` format now, before anything reads the new channels,
// would touch a texture every existing pass binds and is pure unproven
// surface area for zero behaviour change today - deferred to whichever
// story (ME-06+) first needs to READ `GI.z`/`GI.w`, exactly as
// `rasterJS.js`'s own `copyToGBuffer` already treats kind 1-6 (no GI.zw
// aliasing there either).
//
// Fragment rules (27.15.2, literal - identical to `rasterJS.js`'s
// `computeAoD`/`rasterFanTri`): AO_NONE(0) -> aoD = Infinity; AO_WALL(1)
// `d = max(0, h-zRef); zc = ceilZ-h; if (zc<d) d=max(0,zc); fr=u-u0;
// if (h<nbrALo) d=min(d,fr); if (h<nbrBLo) d=min(d,1-fr)`; AO_PLANE(2)
// `fx=u-cellX0, fy=v-cellY0; W/E/N/S bits narrow a=min(a,...)`.
import { GLSL_VERSION, PRECISION, OCT_NORMAL } from './common.js';
import { KIND_MODEL, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D, FACE_PACKED } from '../../GBuffer.js';

const AO_NONE = 0, AO_WALL = 1, AO_PLANE = 2;

// CLOTH-1b2 (docs/architecture.md 33.5): `meshFragSrc(true)` is the cloth variant - the SAME source except the shading normal:
// the smooth interpolated `vNrmS`, normalised, negated on back faces (`!gl_FrontFacing`, the twin of rasterJS' `A2 < 0` rule:
// the vertex normals follow the triangle winding, so a fragment seen from behind gets N = -N). vAxisAligned is 0 for cloth,
// so kind 8 always takes the face-7 + packed-normal branch (GI.z and GA.w carry the packed N).
export function meshFragSrc(cloth = false) {
  const N = cloth ? 'nrmW' : 'vNrmW'; // the shading normal's name: the static variant's source stays byte-identical to pre-1b2
  return `${GLSL_VERSION}${PRECISION}
${OCT_NORMAL}
layout(location = 0) out uvec4 outGI;
layout(location = 1) out uvec4 outGA;
layout(location = 2) out uint outDepth;

const int AO_NONE = ${AO_NONE}, AO_WALL = ${AO_WALL}, AO_PLANE = ${AO_PLANE};
const uint KIND_MODEL = ${KIND_MODEL}u;
const int FACE_N = ${FACE_N}, FACE_E = ${FACE_E}, FACE_S = ${FACE_S}, FACE_W = ${FACE_W}, FACE_U = ${FACE_U}, FACE_D = ${FACE_D};
const int FACE_PACKED = ${FACE_PACKED};

flat in int vPlaneId;
flat in uint vKind, vFace, vMat;
flat in float vAoMode, vZRef, vAux2, vAux3, vAux4, vAux5;
flat in float vZBase;
${cloth ? 'in vec3 vNrmS;' : 'flat in vec3 vNrmW;'}
flat in uint vObjectId, vAxisAligned; // RE-06: were uniforms; the vertex stage supplies them per draw / per instance
in vec2 vUV;
in float vWorldZ;

// AO_WALL/AO_PLANE literal port of engine/mesh/rasterJS.js's computeAoD
// (27.15.2) - u = along-wall/local-x, v = mesh-local z/local-y.
float computeAoD(float mode, float u, float v, float zRef, float a2, float a3, float a4, float a5) {
  if (mode == float(AO_WALL)) {
    float h = v;
    float d = max(0.0, h - zRef);
    float zc = a2 - h;
    if (zc < d) d = max(0.0, zc);
    float fr = u - a5;
    if (h < a3) d = min(d, fr);
    if (h < a4) d = min(d, 1.0 - fr);
    return d;
  }
  if (mode == float(AO_PLANE)) {
    float fx = u - a3, fy = v - a4;
    float a = 1.0e30;
    int bits = int(a2 + 0.5);
    if ((bits & 1) != 0) a = min(a, fx);
    if ((bits & 2) != 0) a = min(a, 1.0 - fx);
    if ((bits & 4) != 0) a = min(a, fy);
    if ((bits & 8) != 0) a = min(a, 1.0 - fy);
    return a;
  }
  return 1.0e30;
}

// ME-08a (27.16 item 2): literal twin of voxelMarch.js roundedFace (>=
// comparisons, E/W first, then S/N, then U/D) - the body is copied from
// voxel.frag.js and glsl.test.js asserts the two are string-equal.
uint roundedFace(vec3 nWorld) {
  int hitFace;
  float anx = abs(nWorld.x), any = abs(nWorld.y), anz = abs(nWorld.z);
  if (anx >= any && anx >= anz) hitFace = nWorld.x >= 0.0 ? FACE_E : FACE_W;
  else if (any >= anx && any >= anz) hitFace = nWorld.y >= 0.0 ? FACE_S : FACE_N;
  else hitFace = nWorld.z >= 0.0 ? FACE_U : FACE_D;
  return uint(hitFace);
}

void main() {
  float aoD = computeAoD(vAoMode, vUV.x, vUV.y, vZRef, vAux2, vAux3, vAux4, vAux5);
  float z = vWorldZ - vZBase - vZRef;
  // dist (SDEPTH): the perpendicular camera-forward distance d - exactly
  // w_clip in engine/render/projection.js's convention (27.5: w_clip = d),
  // so its perspective-correct reciprocal is provided by the hardware below
  // (no varying needed - the same quantity rasterJS.js computes as invq
  // from its own barycentric 1/w sum).
  float dist = 1.0 / gl_FragCoord.w;

  // ME-08a (27.16 item 3): kind 8 (voxel part) takes castModels' face rule -
  // axis-aligned pose -> roundedFace(N), else face 7 + packed normal (GA.w on
  // both twins; GI.z carries it too for the future 27.4 reader, nothing reads
  // it for kind 8 in phase 1). Kinds 1-6: face alone decides, GI.z = 0.
  uint face = vFace;
${cloth ? `  vec3 nrmW = normalize(vNrmS);
  if (!gl_FrontFacing) nrmW = -nrmW;
` : ''}  uint nrmBits = 0u;
  uint gaW = floatBitsToUint(aoD);
  if (vKind == KIND_MODEL) {
    if (vAxisAligned != 0u) {
      face = roundedFace(${N});
    } else {
      face = uint(FACE_PACKED);
      nrmBits = packNormalOct(${N});
      gaW = nrmBits;
    }
  }
  // GI.w = uObjectId (structSeq for levels = the old planeId top-3-bit
  // decode; 0x8000|slot for voxels).
  outGI = uvec4(uint(vPlaneId), vKind | (face << 8u) | (vMat << 16u), nrmBits, vObjectId);
  outGA = uvec4(floatBitsToUint(vUV.x), floatBitsToUint(vUV.y), floatBitsToUint(z), gaW);
  outDepth = floatBitsToUint(dist);
}
`;
}

export const MESH_FRAG_SRC = meshFragSrc(false);
export const MESH_CLOTH_FRAG_SRC = meshFragSrc(true);
