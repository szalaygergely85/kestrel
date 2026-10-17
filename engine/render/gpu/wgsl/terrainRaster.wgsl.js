// WG-2c: literal port of glsl/terrain.vert.js (kind-7 terrain raster: vertex + fragment). Same op order; the GL uniforms
// become one uniform block, uNearType/uFarType are r8ui textures read with textureLoad (texelFetch twin).
import { defineUniformBlock } from './uniformBlock.js';
import { OCT_NORMAL } from './raster.wgsl.js';
import { ORTHO_NEAR_WGSL, ORTHO_FAR_WGSL } from './common.wgsl.js';
import { KIND_TERRAIN, FACE_PACKED } from '../../GBuffer.js';
import { MAX_STRUCTS } from '../WorldTextures.js';
import { structMaskDecl, IN_STRUCT_FOOT_WGSL } from './structMask.wgsl.js';
import { SKYLINE_SEA_TYPE } from '../../skyline.js';
import { LOOK_GA_HI_SHIFT, LOOK_GA_W_SHIFT } from '../../groundLook.js'; // ENV-02d

/** MAP-06b: max sea horizon skirts (one per grid side, terrainMesh.js buildSeaSkirts). */
export const SKIRT_MAX = 4;

export const TERRAIN_BLOCK = defineUniformBlock('TerrainU', [
  { name: 'model', type: 'mat4' }, { name: 'viewProj', type: 'mat4' }, { name: 'modelRel', type: 'mat4' }, // PREC-01a: chunk translation - O, clip only
  { name: 'nearMap', type: 'vec4' }, { name: 'farMap', type: 'vec4' },
  { name: 'structFoot', type: 'vec4', count: MAX_STRUCTS },
  { name: 'objectId', type: 'u32' }, { name: 'nearReady', type: 'u32' }, { name: 'structCount', type: 'u32' },
  { name: 'projMode', type: 'u32' }, // US-068b1 (38.19): 2 = ortho (appended; earlier offsets unchanged)
  { name: 'structMask', type: 'vec4', count: MAX_STRUCTS }, // GS-01b: (row offset in uStructMask, hasMask, 0, 0) per structure (appended)
  { name: 'worldO', type: 'vec4' }, // OB-041: xy = render origin O (multiple of 16 m, exact in f32); vWorldRel = world - O is interpolated, O added back per fragment (appended; 0 = old absolute path)
  { name: 'skirt', type: 'vec4', count: SKIRT_MAX }, // MAP-06b (38.42): sea horizon skirt rects (x0, y0, x1, y1), appended
  { name: 'skirtCount', type: 'u32' },
]);
/** Slot order of PipelineDesc.bindings.textures: 0 = uNearType, 1 = uFarType, 2 = uStructMask (GS-01b carve mask atlas; all r8ui). */
export const TERRAIN_TEXTURES = Object.freeze(['uint', 'uint', 'uint']);

/** ENV-02d: slots 3 = uNearLook, 4 = uFarLook (rg8uint: r = lo | hi << 4, g = round(w_hi * 255), ENV-02c bake); look pipelines only. */
export const TERRAIN_LOOK_TEXTURES = Object.freeze([...TERRAIN_TEXTURES, 'uint', 'uint']);
const terrainRasterWgsl = (LK) => `${TERRAIN_BLOCK.wgsl}
@group(0) @binding(0) var uNearType: texture_2d<u32>;
@group(0) @binding(1) var uFarType: texture_2d<u32>;
${structMaskDecl(2)}
${LK ? `@group(0) @binding(3) var uNearLook: texture_2d<u32>;
@group(0) @binding(4) var uFarLook: texture_2d<u32>;
` : ''}@group(1) @binding(0) var<uniform> u: TerrainU;
${OCT_NORMAL}
struct VertexIn {
  @location(0) aPos: vec3f,
  @location(1) aNrmBits: u32,
};
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) vWorldRel: vec3f, // OB-041: world - (O.x, O.y, 0); small magnitudes near the eye -> ~1e-6 m interpolation error instead of ~3e-4 m at |x| ~ 1500
  @location(1) vNormal: vec3f,
};
@vertex fn vs_main(a: VertexIn) -> VertexOut {
  var o: VertexOut;
  let worldPos = u.model * vec4f(a.aPos, 1.0);
  o.pos = u.viewProj * (u.modelRel * vec4f(a.aPos, 1.0)); // PREC-01a: camera-relative clip; GA.xy below stays absolute world metres (OB-041: rebuilt per fragment from vWorldRel + O)
  o.pos.y = -o.pos.y; o.pos.z = 0.5 * (o.pos.z + o.pos.w);
  o.vWorldRel = vec3f(worldPos.x - u.worldO.x, worldPos.y - u.worldO.y, worldPos.z); // exact: both terms on the vertex grid / multiples of 16
  o.vNormal = unpackNormalOct(a.aNrmBits);
  return o;
}
const KIND_TERRAIN: u32 = ${KIND_TERRAIN}u;
const FACE_PACKED: u32 = ${FACE_PACKED}u;
const PLANEID_TERRAIN: u32 = 0xFFFFFFFFu;
fn farTypeNearest(x: f32, y: f32) -> i32 {
  let ix = i32(floor((x - u.farMap.x) / u.farMap.z)); let iy = i32(floor((y - u.farMap.y) / u.farMap.z));  // MAP-01b: far grid offset
  let W = i32(u.farMap.w);
  if (ix < 0 || iy < 0 || ix >= W || iy >= W) { // MAP-06b: off-grid inside a sea skirt = sea (TerrainMeshSet.typeAt twin)
    for (var s = 0; s < i32(u.skirtCount); s++) { let r = u.skirt[s]; if (x >= r.x && x < r.z && y >= r.y && y < r.w) { return ${SKYLINE_SEA_TYPE}; } }
    return 0;
  }
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
${LK ? `// ENV-02d: look byte pair of the same texel the type comes from (twin: Terrain near.look / farLook), packed into GA.w for the shade pass.
fn terrainLookAt(x: f32, y: f32) -> u32 {
  if (u.nearReady != 0u) {
    let ix = i32(floor((x - u.nearMap.x) / u.nearMap.z));
    let iy = i32(floor((y - u.nearMap.y) / u.nearMap.z));
    let W = i32(u.nearMap.w); let H = i32(textureDimensions(uNearLook).y);
    if (ix >= 0 && iy >= 0 && ix < W && iy < H) { let l = textureLoad(uNearLook, vec2i(ix, iy), 0); return (l.r & 255u) | (l.g << ${LOOK_GA_W_SHIFT}u); }
  }
  let fx = i32(floor((x - u.farMap.x) / u.farMap.z)); let fy = i32(floor((y - u.farMap.y) / u.farMap.z));
  let FW = i32(u.farMap.w);
  if (fx < 0 || fy < 0 || fx >= FW || fy >= FW) { return 0u; }
  let l = textureLoad(uFarLook, vec2i(fx, fy), 0);
  return (l.r & 255u) | (l.g << ${LOOK_GA_W_SHIFT}u);
}
` : ''}struct FragmentOut { @location(0) GI: vec4u, @location(1) GA: vec4u, @location(2) Depth: u32, };
@fragment fn fs_main(v: VertexOut) -> FragmentOut {
  var out: FragmentOut;
  let wp = vec3f(v.vWorldRel.x + u.worldO.x, v.vWorldRel.y + u.worldO.y, v.vWorldRel.z); // OB-041: one rounding to absolute f32 (JS twin: f64 hit -> Float32 gbuf.u/v)
  if (inStructFoot(wp)) { discard; } // bbox, then the GS-01b mask lookup
  let N = normalize(v.vNormal);
  let terrType = terrainTypeAt(wp.x, wp.y);
  let dist = select(1.0 / v.pos.w, ${ORTHO_NEAR_WGSL} + v.pos.z * (${ORTHO_FAR_WGSL} - ${ORTHO_NEAR_WGSL}), u.projMode == 2u); // 38.19 ortho: w = 1, depth = linear z
  out.GI = vec4u(PLANEID_TERRAIN, KIND_TERRAIN | (FACE_PACKED << 8u) | (u32(terrType) << 16u), packNormalOct(N), u.objectId);
  out.GA = vec4u(bitcast<u32>(wp.x), bitcast<u32>(wp.y), bitcast<u32>(wp.z), ${LK ? 'terrainLookAt(wp.x, wp.y)' : 'bitcast<u32>(1.0e30f)'});
  out.Depth = bitcast<u32>(dist);
  return out;
}
`;
export const TERRAIN_RASTER_WGSL = terrainRasterWgsl(false);
/** ENV-02d: GA.w carries the look word (lo | hi << 4 | w8 << 8) instead of the aoD constant; look pipelines only (+2 r8ui->rg8uint textures). */
export const TERRAIN_RASTER_LOOK_WGSL = terrainRasterWgsl(true);
