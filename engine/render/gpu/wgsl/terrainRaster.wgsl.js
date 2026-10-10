// WG-2c: literal port of glsl/terrain.vert.js (kind-7 terrain raster: vertex + fragment). Same op order; the GL uniforms
// become one uniform block, uNearType/uFarType are r8ui textures read with textureLoad (texelFetch twin).
import { defineUniformBlock } from './uniformBlock.js';
import { OCT_NORMAL } from './raster.wgsl.js';
import { ORTHO_NEAR_WGSL, ORTHO_FAR_WGSL } from './common.wgsl.js';
import { KIND_TERRAIN, FACE_PACKED } from '../../GBuffer.js';
import { MAX_STRUCTS } from '../WorldTextures.js';
import { structMaskDecl, IN_STRUCT_FOOT_WGSL } from './structMask.wgsl.js';

export const TERRAIN_BLOCK = defineUniformBlock('TerrainU', [
  { name: 'model', type: 'mat4' }, { name: 'viewProj', type: 'mat4' }, { name: 'modelRel', type: 'mat4' }, // PREC-01a: chunk translation - O, clip only
  { name: 'nearMap', type: 'vec4' }, { name: 'farMap', type: 'vec4' },
  { name: 'structFoot', type: 'vec4', count: MAX_STRUCTS },
  { name: 'objectId', type: 'u32' }, { name: 'nearReady', type: 'u32' }, { name: 'structCount', type: 'u32' },
  { name: 'projMode', type: 'u32' }, // US-068b1 (38.19): 2 = ortho (appended; earlier offsets unchanged)
  { name: 'structMask', type: 'vec4', count: MAX_STRUCTS }, // GS-01b: (row offset in uStructMask, hasMask, 0, 0) per structure (appended)
]);
/** Slot order of PipelineDesc.bindings.textures: 0 = uNearType, 1 = uFarType, 2 = uStructMask (GS-01b carve mask atlas; all r8ui). */
export const TERRAIN_TEXTURES = Object.freeze(['uint', 'uint', 'uint']);

export const TERRAIN_RASTER_WGSL = `${TERRAIN_BLOCK.wgsl}
@group(0) @binding(0) var uNearType: texture_2d<u32>;
@group(0) @binding(1) var uFarType: texture_2d<u32>;
${structMaskDecl(2)}
@group(1) @binding(0) var<uniform> u: TerrainU;
${OCT_NORMAL}
struct VertexIn {
  @location(0) aPos: vec3f,
  @location(1) aNrmBits: u32,
};
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) vWorldPos: vec3f,
  @location(1) vNormal: vec3f,
};
@vertex fn vs_main(a: VertexIn) -> VertexOut {
  var o: VertexOut;
  let worldPos = u.model * vec4f(a.aPos, 1.0);
  o.pos = u.viewProj * (u.modelRel * vec4f(a.aPos, 1.0)); // PREC-01a: camera-relative clip; vWorldPos below stays absolute (kind 7 GA.xy = world metres)
  o.pos.y = -o.pos.y; o.pos.z = 0.5 * (o.pos.z + o.pos.w);
  o.vWorldPos = worldPos.xyz;
  o.vNormal = unpackNormalOct(a.aNrmBits);
  return o;
}
const KIND_TERRAIN: u32 = ${KIND_TERRAIN}u;
const FACE_PACKED: u32 = ${FACE_PACKED}u;
const PLANEID_TERRAIN: u32 = 0xFFFFFFFFu;
fn farTypeNearest(x: f32, y: f32) -> i32 {
  let ix = i32(floor(x / u.farMap.z)); let iy = i32(floor(y / u.farMap.z));
  let W = i32(u.farMap.w);
  if (ix < 0 || iy < 0 || ix >= W || iy >= W) { return 0; }
  return i32(textureLoad(uFarType, vec2i(ix, iy), 0).r);
}
fn terrainTypeAt(x: f32, y: f32) -> i32 {
  if (u.nearReady != 0u) {
    let ix = i32(floor((x - u.nearMap.x) / u.nearMap.z));
    let iy = i32(floor((y - u.nearMap.y) / u.nearMap.z));
    let W = i32(u.nearMap.w); let H = i32(textureDimensions(uNearType).y); // WS1-03: band may be non-square (W from the uniform, H from the texture)
    if (ix >= 0 && iy >= 0 && ix < W && iy < H) { return i32(textureLoad(uNearType, vec2i(ix, iy), 0).r); }
  }
  return farTypeNearest(x, y);
}
${IN_STRUCT_FOOT_WGSL}
struct FragmentOut { @location(0) GI: vec4u, @location(1) GA: vec4u, @location(2) Depth: u32, };
@fragment fn fs_main(v: VertexOut) -> FragmentOut {
  var out: FragmentOut;
  if (inStructFoot(v.vWorldPos)) { discard; } // bbox, then the GS-01b mask lookup
  let N = normalize(v.vNormal);
  let terrType = terrainTypeAt(v.vWorldPos.x, v.vWorldPos.y);
  let dist = select(1.0 / v.pos.w, ${ORTHO_NEAR_WGSL} + v.pos.z * (${ORTHO_FAR_WGSL} - ${ORTHO_NEAR_WGSL}), u.projMode == 2u); // 38.19 ortho: w = 1, depth = linear z
  out.GI = vec4u(PLANEID_TERRAIN, KIND_TERRAIN | (FACE_PACKED << 8u) | (u32(terrType) << 16u), packNormalOct(N), u.objectId);
  out.GA = vec4u(bitcast<u32>(v.vWorldPos.x), bitcast<u32>(v.vWorldPos.y), bitcast<u32>(v.vWorldPos.z), bitcast<u32>(1.0e30f));
  out.Depth = bitcast<u32>(dist);
  return out;
}
`;
