// WG-2b: literal port of mesh.vert/frag.js. Static, compact voxel, instanced and cloth input layouts.
import { defineUniformBlock } from './uniformBlock.js';
import { KIND_MODEL, KIND_MESH, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D, FACE_PACKED } from '../../GBuffer.js';

const RASTER_FIELDS = [
  { name: 'model', type: 'mat4' }, { name: 'viewProj', type: 'mat4' },
  { name: 'planeIdOr', type: 'u32' }, { name: 'zBase', type: 'f32' },
  { name: 'objectId', type: 'u32' }, { name: 'axisAligned', type: 'u32' },
  { name: 'flat', type: 'vec2' },
];
export const RASTER_BASE_BLOCK = defineUniformBlock('RasterU', RASTER_FIELDS);
// ALPHA-01c: static mesh with a mask range (one draw per masked range): the base block + the atlas rect (x0,y0,w,h) and the cutoff byte
export const RASTER_MASK_BLOCK = defineUniformBlock('RasterU', [...RASTER_FIELDS,
  { name: 'maskX0', type: 'u32' }, { name: 'maskY0', type: 'u32' }, { name: 'maskW', type: 'u32' }, { name: 'maskH', type: 'u32' }, { name: 'maskCut', type: 'u32' },
]);
export const RASTER_BLOCK = defineUniformBlock('RasterU', [...RASTER_FIELDS,
  { name: 'teamSlot', type: 'vec4' }, { name: 'teamMat', type: 'vec4', count: 8 },
]);

export const OCT_NORMAL = `
fn packNormalOct(n: vec3f) -> u32 {
  let s = abs(n.x) + abs(n.y) + abs(n.z);
  var x = n.x / s; var y = n.y / s; let z = n.z / s;
  if (z < 0.0) {
    let ax = abs(x); let ay = abs(y);
    let sx = select(-1.0, 1.0, x >= 0.0); let sy = select(-1.0, 1.0, y >= 0.0);
    let nxp = (1.0 - ay) * sx; let nyp = (1.0 - ax) * sy;
    x = nxp; y = nyp;
  }
  let qx = u32(clamp(floor((x * 0.5 + 0.5) * 65535.0 + 0.5), 0.0, 65535.0));
  let qy = u32(clamp(floor((y * 0.5 + 0.5) * 65535.0 + 0.5), 0.0, 65535.0));
  return qx | (qy << 16u);
}
fn unpackNormalOct(bits: u32) -> vec3f {
  let qx = bits & 0xFFFFu; let qy = (bits >> 16u) & 0xFFFFu;
  var x = (f32(qx) / 65535.0) * 2.0 - 1.0;
  var y = (f32(qy) / 65535.0) * 2.0 - 1.0;
  let z = 1.0 - abs(x) - abs(y);
  if (z < 0.0) {
    let ax = abs(x); let ay = abs(y);
    let sx = select(-1.0, 1.0, x >= 0.0); let sy = select(-1.0, 1.0, y >= 0.0);
    let ox = (1.0 - ay) * sx; let oy = (1.0 - ax) * sy;
    x = ox; y = oy;
  }
  return normalize(vec3f(x, y, z));
}
`;

/**
 * ALPHA-01c (37.17 items 2-3): the texel rule of MaskAtlas.texel / MaskAtlas.sample, literally: repeat wrap in f32 (u - floor(u) is exact in
 * f32), f32 product, floor, clamp to w-1; discard iff the R8UI texel < the cutoff byte. textureLoad only (no filter, no mips).
 */
export const MASK_TEXEL_WGSL = `
fn maskTexel(c: f32, w: u32) -> u32 {
  let tc = c - floor(c);
  let t = u32(floor(tc * f32(w)));
  return min(t, w - 1u);
}
fn maskDiscard(uvm: vec2f, x0: u32, y0: u32, w: u32, h: u32, cut: u32) -> bool {
  let a = textureLoad(texMask, vec2u(x0 + maskTexel(uvm.x, w), y0 + maskTexel(uvm.y, h)), 0).x;
  return a < cut;
}
`;

/** @param {'static'|'voxel'|'instanced'|'cloth'|'mask'} variant 'mask' = the static layout + per-vertex mask uv (location 10) + texMask discard */
export function rasterWgsl(variant = 'static') {
  const cloth = variant === 'cloth', instanced = variant === 'instanced', compact = variant === 'voxel' || instanced, mask = variant === 'mask';
  return `${(instanced ? RASTER_BLOCK : mask ? RASTER_MASK_BLOCK : RASTER_BASE_BLOCK).wgsl}
@group(1) @binding(0) var<uniform> u: RasterU;
${mask ? '@group(0) @binding(0) var texMask: texture_2d<u32>;' : ''}
${OCT_NORMAL}${mask ? MASK_TEXEL_WGSL : ''}
struct VertexIn {
  @location(0) aPos: vec3f,
  @location(1) aUV: vec2f,
  @location(2) aNrmBits: u32,
${cloth ? '' : '  @location(3) aFlat: vec2u,'}
${cloth || compact ? '' : '  @location(4) aAux0123: vec4f,\n  @location(5) aAux4567: vec4f,'}
${mask ? '  @location(10) aUVMask: vec2f,' : ''}
${instanced ? '  @location(6) iRow0: vec4f,\n  @location(7) iRow1: vec4f,\n  @location(8) iRow2: vec4f,\n  @location(9) iMeta: vec2u,' : ''}
};
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) packed: vec4u,
  @location(1) @interpolate(flat) aux0123: vec4f,
  @location(2) @interpolate(flat) aux4567: vec4f,
  @location(3) @interpolate(flat) vNrmW: vec3f,
  @location(4) vNrmS: vec3f,
  @location(5) vUV: vec2f,
  @location(6) vWorldZ: f32,
${mask ? '  @location(7) vUVMask: vec2f,' : ''}
};
@vertex fn vs_main(a: VertexIn) -> VertexOut {
  var o: VertexOut;
  let modelN = mat3x3f(u.model[0].xyz, u.model[1].xyz, u.model[2].xyz);
${instanced ? `  let lp = (u.model * vec4f(a.aPos, 1.0)).xyz;
  let wp = vec3f(dot(a.iRow0.xyz, lp) + a.iRow0.w, dot(a.iRow1.xyz, lp) + a.iRow1.w, dot(a.iRow2.xyz, lp) + a.iRow2.w);
  let worldPos = vec4f(wp, 1.0);
  let planeId = a.aFlat.x | u.planeIdOr | ((a.iMeta.x & 0xFu) << 24u);
  var mat = (a.aFlat.y >> 16u) & 0xffffu;
  let team = (a.iMeta.y >> 8u) & 0xffu;
  if (team != 0u) {
    for (var s = 0u; s < 4u; s++) {
      if (u.teamSlot[s] != 0.0 && i32(mat) == i32(u.teamSlot[s])) { mat = u32(u.teamMat[team][s]); break; }
    }
  }
  o.packed = vec4u(planeId, (a.aFlat.y & 0xffffu) | (mat << 16u), a.iMeta.x, u.axisAligned & (a.iMeta.y & 1u));
  o.aux4567.z = a.iRow2.w;
  let ln = normalize(modelN * unpackNormalOct(a.aNrmBits));
  let nw = normalize(vec3f(dot(a.iRow0.xyz, ln), dot(a.iRow1.xyz, ln), dot(a.iRow2.xyz, ln)));
  o.vNrmW = nw; o.vNrmS = nw;
` : `  let worldPos = u.model * vec4f(a.aPos, 1.0);
  o.packed = vec4u(${cloth ? 'bitcast<u32>(u.flat.x)' : 'a.aFlat.x'} | u.planeIdOr, ${cloth ? 'bitcast<u32>(u.flat.y)' : 'a.aFlat.y'}, u.objectId, ${cloth ? '0u' : 'u.axisAligned'});
  o.aux4567.z = u.zBase;
  o.vNrmW = normalize(modelN * unpackNormalOct(a.aNrmBits));
  o.vNrmS = ${cloth ? 'modelN * unpackNormalOct(a.aNrmBits)' : 'normalize(modelN * unpackNormalOct(a.aNrmBits))'};
`}
${cloth || compact ? '' : '  o.aux0123 = a.aAux0123; o.aux4567 = vec4f(a.aAux4567.xy, o.aux4567.z, 0.0);'}
  o.vUV = a.aUV; o.vWorldZ = worldPos.z;
${mask ? '  o.vUVMask = a.aUVMask;' : ''}
  o.pos = u.viewProj * worldPos;
  o.pos.y = -o.pos.y; o.pos.z = 0.5 * (o.pos.z + o.pos.w);
  return o;
}
const KIND_MODEL: u32 = ${KIND_MODEL}u;
const KIND_MESH: u32 = ${KIND_MESH}u;
const FACE_N: u32 = ${FACE_N}u; const FACE_E: u32 = ${FACE_E}u;
const FACE_S: u32 = ${FACE_S}u; const FACE_W: u32 = ${FACE_W}u;
const FACE_U: u32 = ${FACE_U}u; const FACE_D: u32 = ${FACE_D}u;
const FACE_PACKED: u32 = ${FACE_PACKED}u;
fn computeAoD(mode: f32, uv: f32, v: f32, zRef: f32, a2: f32, a3: f32, a4: f32, a5: f32) -> f32 {
  if (mode == 1.0) {
    let h = v;
    var d = max(0.0, h - zRef);
    let zc = a2 - h;
    if (zc < d) { d = max(0.0, zc); }
    let fr = uv - a5;
    if (h < a3) { d = min(d, fr); }
    if (h < a4) { d = min(d, 1.0 - fr); }
    return d;
  }
  if (mode == 2.0) {
    let fx = uv - a3; let fy = v - a4;
    var ao = 1.0e30; let bits = i32(a2 + 0.5);
    if ((bits & 1) != 0) { ao = min(ao, fx); }
    if ((bits & 2) != 0) { ao = min(ao, 1.0 - fx); }
    if ((bits & 4) != 0) { ao = min(ao, fy); }
    if ((bits & 8) != 0) { ao = min(ao, 1.0 - fy); }
    return ao;
  }
  return 1.0e30;
}
fn roundedFace(nWorld: vec3f) -> u32 {
  let anx = abs(nWorld.x); let any = abs(nWorld.y); let anz = abs(nWorld.z);
  if (anx >= any && anx >= anz) { return select(FACE_W, FACE_E, nWorld.x >= 0.0); }
  if (any >= anx && any >= anz) { return select(FACE_N, FACE_S, nWorld.y >= 0.0); }
  return select(FACE_D, FACE_U, nWorld.z >= 0.0);
}
struct FragmentOut { @location(0) GI: vec4u, @location(1) GA: vec4u, @location(2) Depth: u32, };
@fragment fn fs_main(v: VertexOut, @builtin(front_facing) front: bool) -> FragmentOut {
  var out: FragmentOut;
${mask ? '  if (maskDiscard(v.vUVMask, u.maskX0, u.maskY0, u.maskW, u.maskH, u.maskCut)) { discard; }' : ''}
  let vKind = v.packed.y & 0xffu; let vFace = (v.packed.y >> 8u) & 0xfu; let vMat = (v.packed.y >> 16u) & 0xffffu;
  let aoD = computeAoD(v.aux0123.y, v.vUV.x, v.vUV.y, v.aux0123.x, v.aux0123.z, v.aux0123.w, v.aux4567.x, v.aux4567.y);
  let z = v.vWorldZ - v.aux4567.z - v.aux0123.x;
  let dist = 1.0 / v.pos.w;
  var face = vFace; var nrmBits = 0u; var gaW = bitcast<u32>(aoD);
${cloth ? '  var nrmW = normalize(v.vNrmS); if (!front) { nrmW = -nrmW; }' : '  let nrmW = v.vNrmW;'}
  if (vKind == KIND_MODEL) {
    if (v.packed.w != 0u) { face = roundedFace(nrmW); }
    else { face = FACE_PACKED; nrmBits = packNormalOct(nrmW); gaW = nrmBits; }
  }
${cloth ? '' : `  if (vKind == KIND_MESH) {
    ${mask ? 'var nm = normalize(v.vNrmS); if (!front) { nm = -nm; }' : 'let nm = normalize(v.vNrmS);'} nrmBits = packNormalOct(nm);
    if (max(abs(nm.x), max(abs(nm.y), abs(nm.z))) >= 0.9) { face = roundedFace(nm); }
    else { face = FACE_PACKED; gaW = nrmBits; }
  }`}
  out.GI = vec4u(v.packed.x, vKind | (face << 8u) | (vMat << 16u), nrmBits, v.packed.z);
  out.GA = vec4u(bitcast<u32>(v.vUV.x), bitcast<u32>(v.vUV.y), bitcast<u32>(z), gaW);
  out.Depth = bitcast<u32>(dist);
  return out;
}
${mask ? `@fragment fn fs_mask_shadow(v: VertexOut) {
  if (maskDiscard(v.vUVMask, u.maskX0, u.maskY0, u.maskW, u.maskH, u.maskCut)) { discard; }
}
` : ''}`;
}

/** The raster vertex stages' depth line (z -> [0,1], the GL2 convention after the y flip). */
export const RASTER_Z_LINE = 'o.pos.z = 0.5 * (o.pos.z + o.pos.w);';
/**
 * Sun shadow vertex line (38.5 item 6, depth32float): clip z lands in [0.5, 1] so one float ULP / depthBias unit is 2^-24 at every
 * depth (= the twin's 24-bit model). light.wgsl.js sunShadowTaps compares against 0.5 + 0.5 * sd; shadowParity converts back (d - 0.5) * 2.
 */
export const SHADOW_Z_LINE = 'o.pos.z = 0.25 * (o.pos.z + o.pos.w) + 0.5 * o.pos.w;';
/** Swaps the raster depth line of a vertex module for the shadow one; throws unless it matches exactly once. */
export function toShadowVertexWgsl(code) {
  const parts = code.split(RASTER_Z_LINE);
  if (parts.length !== 2) throw new Error(`toShadowVertexWgsl: expected exactly one raster z line, found ${parts.length - 1}`);
  return parts.join(SHADOW_Z_LINE);
}

export const RASTER_WGSL = rasterWgsl('static');
export const RASTER_VOXEL_WGSL = rasterWgsl('voxel');
export const RASTER_INSTANCED_WGSL = rasterWgsl('instanced');
export const RASTER_CLOTH_WGSL = rasterWgsl('cloth');
export const RASTER_MASK_WGSL = rasterWgsl('mask'); // ALPHA-01c

// Sun shadow VERTEX variants (WgShadowPass): same stages, depth mapped to [0.5, 1]. Terrain: SHADOW_TERRAIN_WGSL (shadow.wgsl.js) owns its vs_main.
export const RASTER_SHADOW_WGSL = toShadowVertexWgsl(RASTER_WGSL);
export const RASTER_VOXEL_SHADOW_WGSL = toShadowVertexWgsl(RASTER_VOXEL_WGSL);
export const RASTER_INSTANCED_SHADOW_WGSL = toShadowVertexWgsl(RASTER_INSTANCED_WGSL);
export const RASTER_CLOTH_SHADOW_WGSL = toShadowVertexWgsl(RASTER_CLOTH_WGSL);
export const RASTER_MASK_SHADOW_WGSL = toShadowVertexWgsl(RASTER_MASK_WGSL); // ALPHA-01c: fragment entry fs_mask_shadow (discard only)
