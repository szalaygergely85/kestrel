// R6c (docs/architecture.md 38.60, D-075 step 5): WGSL twin of the tree card impostors. The oracle is engine/mesh/impostorCard.js (rules
// 1-9, header comment) + rasterJS.js rasterCards / compactGroup; this file TRANSLATES them (same op order), it does not improve them.
// Two modules, both opt-in (nothing runs unless the host dispatches them for a group that has `imp`; off = existing frame byte-identical):
//   IMP_CULL_WGSL  compute `cs_card`: one invocation per instance row of the game's rows (src, 16 words). frustum (CULL_AABB_FN), distance
//                  cut (eye.w = maxDistM^2, <= 0 off), then d = |t - eye| (3D). d < impM -> mesh only (nothing here). d >= impM -> the row is
//                  appended to the CARD bucket (dst) with flags |= impBandBits(d, impM, 1) (card copy, INVERT; 0 beyond the band).
//                  args slot = {vertexCount 6 (host), instanceCount (atomic word +1), 0, 0}; the card draw is a non-indexed drawIndirect.
//                  The MESH-side half of the rule (mesh copy dropped at d >= impM + 8, band bits on the mesh copy) is cull.wgsl.js's job
//                  (host change, NOT in this module: it would move cull's WGSL pin).
//   IMP_CARD_WGSL  render: vs_main (6 verts per card row, mip pick from corners 0 -> 1, camera-relative like the instanced raster) +
//                  fs_main (atlas texel -> KIND_MESH G-buffer cell, same three targets as raster.wgsl.js). The fragment writes
//                  @builtin(frag_depth) = 0.5 * (zn + 1) - tier * DEPTH_TIER of the SHIFTED point (rule 6), the only module that does:
//                  ARCH DECISION (see lane note): index.test.js exempts this module from the frag_depth ban.
// Atlas = ONE read-only u32 storage buffer holding impostorBake.js `bytes` (little-endian words), `u.atlasBase` = word offset of the species.
import { defineUniformBlock } from './uniformBlock.js';
import { INSTANCE_STRIDE } from '../../../mesh/instances.js';
import { CULL_AABB_FN } from './cull.wgsl.js';
import { OCT_NORMAL, LOD_DITHER_WGSL, RASTER_Z_LINE, RASTER_FLAG_VAO } from './raster.wgsl.js';
import { IMP_ELEV_DEG, IMP_VIEWS } from '../../../mesh/impostorBake.js';
import { IMP_BAND_M } from '../../../mesh/impostorCard.js';
import { KIND_MESH, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D, FACE_PACKED } from '../../GBuffer.js';
import { PROJ_NEAR, DEPTH_TIER } from '../../projection.js';

export const IMP_CARD_WORKGROUP = 64;

export const IMP_BLOCK = defineUniformBlock('ImpU', [
  { name: 'planes', type: 'vec4', count: 6 }, // frustumPlanes(), as CullU
  { name: 'eye', type: 'vec4' },              // xyz = eye (ABSOLUTE world), w = maxDistM^2 (<= 0: no cut)
  { name: 'params', type: 'vec4' },           // x = R (cull sphere radius, as CullU.params.x)
  { name: 'imp', type: 'vec4' },              // x = impM, y = card radius, z = vMin, w = vMax (impostorBake result)
  { name: 'vp', type: 'mat4' },               // viewProj of the (camera-relative) raster, column-major
  { name: 'view', type: 'vec4' },             // x = raster W (cols * n samples), y = H, zw = render origin O (xy) like RasterU.origin
  { name: 'count', type: 'u32' },             // rows in src
  { name: 'slot', type: 'u32' },              // first word of this species' card args record in `args`
  { name: 'swayPad', type: 'f32' },           // 0 (cards do not sway); kept so CULL_AABB_FN is shared verbatim
  { name: 'atlasBase', type: 'u32' },         // word offset of this species' bytes in `atlas`
  { name: 'flags', type: 'u32' },             // bit 1 (RASTER_FLAG_VAO) = write vao 1.0 into GA.w (passRaster sets it iff lights.ao.strength > 0)
  { name: 'depthTier', type: 'u32' },         // 1 (same tier as instanced meshes)
]);

/** The pure rule helpers (all JS-probeable by wgslProbe, impostor.wgsl.test.js). Names mirror impostorCard.js / impostorBake.js. */
export const IMP_RULES_WGSL = `
const PI4: f32 = ${Math.PI / 4};
const IMP_BAND_M: f32 = ${IMP_BAND_M}.0;
const IMP_CE: f32 = ${Math.cos(IMP_ELEV_DEG * Math.PI / 180)};
const IMP_SE: f32 = ${Math.sin(IMP_ELEV_DEG * Math.PI / 180)};
const IMP_PER_VIEW: u32 = ${(1024 + 256 + 64) * 8}u;

// rule 2: view index 0..7 (v & 7 = non-negative mod 8 for two's complement)
fn impViewPick(ex: f32, ey: f32, tx: f32, ty: f32, yaw: f32) -> u32 {
  let beta = atan2(-(tx - ex), ty - ey);
  let v = i32(floor((beta - yaw) / PI4 + 0.5));
  return u32(v & 7);
}
// rule 1: flags-word bits of the mesh copy (lod 0) / card copy (lod 1) at distance d, 0 outside the band (lodDither.js lodBandFrac + lodDitherBits)
fn impBandBits(d: f32, impM: f32, lod: u32) -> u32 {
  if (d < impM || d >= impM + IMP_BAND_M) { return 0u; }
  let fr = clamp((d - impM) / ((impM + IMP_BAND_M) - impM), 0.0, 1.0);
  let cov = min(u32(floor((1.0 - fr) * 256.0)), 256u);
  return 0x4000000u | (cov << 16u) | select(0u, 0x2000000u, lod == 1u);
}
// rule 4
fn impMipPick(cardPx: f32) -> u32 {
  if (cardPx >= 32.0) { return 0u; }
  if (cardPx >= 16.0) { return 1u; }
  return 2u;
}
// impostorBake.js impMipOffset (bytes)
fn impMipOffset(view: u32, mip: u32) -> u32 {
  return view * IMP_PER_VIEW + select(select(1280u * 8u, 1024u * 8u, mip == 1u), 0u, mip == 0u);
}
// rule 5: byte offset of the texel for card coords (cu, cv)
fn impTexelOffset(view: u32, mip: u32, cu: f32, cv: f32, R: f32, vMin: f32, vMax: f32) -> u32 {
  let N = 32u >> mip;
  let nf = f32(N);
  let tx = u32(clamp(floor((cu + R) / (2.0 * R) * nf), 0.0, nf - 1.0));
  let ty = u32(clamp(floor((vMax - cv) / (vMax - vMin) * nf), 0.0, nf - 1.0));
  return impMipOffset(view, mip) + (ty * N + tx) * 8u;
}
struct ImpTexel { covered: u32, mat: u32, face: u32, q: i32, nbits: u32, };
// rules 5-6 texel decode from the atlas words (b0..b3 = word 0, b4..b7 = word 1, little-endian)
fn impFetch(view: u32, mip: u32, cu: f32, cv: f32, R: f32, vMin: f32, vMax: f32, base: u32) -> ImpTexel {
  var t: ImpTexel;
  let o = impTexelOffset(view, mip, cu, cv, R, vMin, vMax);
  let w0 = atlas[base + (o >> 2u)];
  let w1 = atlas[base + (o >> 2u) + 1u];
  t.covered = select(0u, 1u, ((w1 >> 8u) & 255u) != 0u);
  t.mat = w0 & 255u;
  t.face = (w0 >> 8u) & 255u;
  let b4 = w1 & 255u;
  t.q = select(i32(b4), i32(b4) - 256, b4 > 127u);
  let nx = (((w0 >> 16u) & 255u) << 8u) | ((w1 >> 16u) & 255u); // impostorBake.js decodeImpNormal: 2/3 high, 6/7 low
  let ny = (((w0 >> 24u) & 255u) << 8u) | ((w1 >> 24u) & 255u);
  t.nbits = nx | (ny << 16u);
  return t;
}
// rule 6: depth offset in metres (unscaled)
fn impDepthOffset(q: i32, R: f32) -> f32 { return f32(q) / 127.0 * R; }
// rule 7: octahedral decode (unpackNormalOct with an explicit sqrt, = JS), then rotate by view*pi/4 + yaw about z
fn impOctDecode(bits: u32) -> vec3f {
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
  let len = sqrt(x * x + y * y + z * z);
  return vec3f(x / len, y / len, z / len);
}
fn impNormalWorld(bits: u32, view: u32, yaw: f32) -> vec3f {
  let n = impOctDecode(bits);
  let th = f32(view) * PI4 + yaw;
  let c = cos(th); let s = sin(th);
  return vec3f(n.x * c - n.y * s, n.x * s + n.y * c, n.z);
}
`;

// ------------------------------------------------------------------------------------------------ cull kernel
export const IMP_CULL_BUFFERS = Object.freeze(['read', 'rw', 'rw']); // 0 src, 1 card dst, 2 args

export const IMP_CULL_WGSL = `${IMP_BLOCK.wgsl}
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<storage, read_write> args: array<atomic<u32>>;
@group(1) @binding(0) var<uniform> u: ImpU;
const STRIDE: u32 = ${INSTANCE_STRIDE}u;
${CULL_AABB_FN}
${IMP_RULES_WGSL.replace(/fn impFetch[\s\S]*?\n}\n/, '')}
@compute @workgroup_size(${IMP_CARD_WORKGROUP})
fn cs_card(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.count) { return; }
  let o = i * STRIDE;
  let tx = bitcast<f32>(src[o + 3u]);
  let ty = bitcast<f32>(src[o + 7u]);
  let tz = bitcast<f32>(src[o + 11u]);
  if (aabbOutside(tx, ty, tz)) { return; }
  let dx = tx - u.eye.x;
  let dy = ty - u.eye.y;
  let dz = tz - u.eye.z;
  if (u.eye.w > 0.0 && dx * dx + dy * dy + dz * dz > u.eye.w) { return; }
  let d = sqrt(dx * dx + dy * dy + dz * dz);
  if (d < u.imp.x) { return; } // mesh only
  let w = atomicAdd(&args[u.slot + 1u], 1u) * STRIDE;
  for (var c = 0u; c < STRIDE; c++) { dst[w + c] = src[o + c]; }
  dst[w + 13u] = src[o + 13u] | impBandBits(d, u.imp.x, 1u);
}
`;

// ------------------------------------------------------------------------------------------------ card raster
export const IMP_CARD_WGSL = `${IMP_BLOCK.wgsl}
@group(0) @binding(0) var<storage, read> cards: array<u32>;
@group(0) @binding(1) var<storage, read> atlas: array<u32>;
@group(1) @binding(0) var<uniform> u: ImpU;
const STRIDE: u32 = ${INSTANCE_STRIDE}u;
const PROJ_NEAR: f32 = ${PROJ_NEAR};
const DEPTH_TIER: f32 = ${DEPTH_TIER.toExponential()};
const KIND_MESH: u32 = ${KIND_MESH}u;
const RASTER_FLAG_VAO: u32 = ${RASTER_FLAG_VAO}u;
const FACE_N: u32 = ${FACE_N}u; const FACE_E: u32 = ${FACE_E}u;
const FACE_S: u32 = ${FACE_S}u; const FACE_W: u32 = ${FACE_W}u;
const FACE_U: u32 = ${FACE_U}u; const FACE_D: u32 = ${FACE_D}u;
const FACE_PACKED: u32 = ${FACE_PACKED}u;
${OCT_NORMAL}${LOD_DITHER_WGSL}${IMP_RULES_WGSL}
fn roundedFace(nWorld: vec3f) -> u32 {
  let anx = abs(nWorld.x); let any = abs(nWorld.y); let anz = abs(nWorld.z);
  if (anx >= any && anx >= anz) { return select(FACE_W, FACE_E, nWorld.x >= 0.0); }
  if (any >= anx && any >= anz) { return select(FACE_N, FACE_S, nWorld.y >= 0.0); }
  return select(FACE_D, FACE_U, nWorld.z >= 0.0);
}
// rule 3: card corner k (0..3: (-R,vMax) (R,vMax) (R,vMin) (-R,vMin)) in camera-relative world; s = instance scale, h = unit bearing eye -> tree
fn cardCorner(k: u32, t: vec3f, s: f32, h: vec2f) -> vec3f {
  let cu = select(-1.0, 1.0, k == 1u || k == 2u) * u.imp.y;
  let cv = select(u.imp.w, u.imp.z, k >= 2u);
  return vec3f(t.x + s * (cu * h.y + cv * h.x * IMP_SE), t.y + s * (cu * -h.x + cv * h.y * IMP_SE), t.z + s * (cv * IMP_CE));
}
fn clipOf(p: vec3f) -> vec4f { return u.vp * vec4f(p, 1.0); }

struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) inst: vec4u,    // x = objectId, y = flags word (dither bits 16..26), z = view | mip << 8, w = bitcast(yaw)
  @location(1) @interpolate(flat) geo: vec4f,     // x = scale, y = h.x, z = h.y, w = tz (absolute, = zBase)
  @location(2) cuv: vec2f,                        // card (u, v), metres
  @location(3) wpos: vec3f,                       // plane point, camera-relative xy / absolute z
};
@vertex fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VertexOut {
  var o: VertexOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0); // off-screen (skipped card)
  let b = ii * STRIDE;
  let m00 = bitcast<f32>(cards[b]);
  let m10 = bitcast<f32>(cards[b + 4u]);
  let tx = bitcast<f32>(cards[b + 3u]) - u.view.z;
  let ty = bitcast<f32>(cards[b + 7u]) - u.view.w;
  let tzv = bitcast<f32>(cards[b + 11u]);
  let hx0 = tx + u.view.z - u.eye.x;
  let hy0 = ty + u.view.w - u.eye.y;
  let hl = sqrt(hx0 * hx0 + hy0 * hy0);
  if (hl < 1e-6) { return o; }
  let h = vec2f(hx0 / hl, hy0 / hl);
  let yaw = atan2(m10, m00);
  let s = sqrt(m00 * m00 + m10 * m10);
  let view = impViewPick(u.eye.x, u.eye.y, tx + u.view.z, ty + u.view.w, yaw);
  let t = vec3f(tx, ty, tzv);
  let q0 = clipOf(cardCorner(0u, t, s, h));
  let q1 = clipOf(cardCorner(1u, t, s, h));
  if (q0.w < PROJ_NEAR || q1.w < PROJ_NEAR) { return o; } // card straddles the eye plane: skipped, as rasterCards
  let dxp = (q1.x / q1.w - q0.x / q0.w) * u.view.x / 2.0;
  let dyp = (q1.y / q1.w - q0.y / q0.w) * u.view.y / 2.0;
  let mip = impMipPick(sqrt(dxp * dxp + dyp * dyp));
  var ids = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
  let k = ids[vi];
  let p = cardCorner(k, t, s, h);
  o.pos = u.vp * vec4f(p, 1.0);
  o.pos.y = -o.pos.y; ${RASTER_Z_LINE}
  o.inst = vec4u(cards[b + 12u], cards[b + 13u], view | (mip << 8u), bitcast<u32>(yaw));
  o.geo = vec4f(s, h.x, h.y, tzv);
  o.cuv = vec2f(select(-1.0, 1.0, k == 1u || k == 2u) * u.imp.y, select(u.imp.w, u.imp.z, k >= 2u));
  o.wpos = p;
  return o;
}
struct FragmentOut { @location(0) GI: vec4u, @location(1) GA: vec4u, @location(2) Depth: u32, @builtin(frag_depth) fd: f32, };
@fragment fn fs_main(v: VertexOut) -> FragmentOut {
  var out: FragmentOut;
  if (!ditherKeep((v.inst.y >> 16u) & 0x7ffu, u32(v.pos.x), u32(v.pos.y))) { discard; }
  let view = v.inst.z & 255u;
  let mip = (v.inst.z >> 8u) & 255u;
  let yaw = bitcast<f32>(v.inst.w);
  let tx = impFetch(view, mip, v.cuv.x, v.cuv.y, u.imp.y, u.imp.z, u.imp.w, u.atlasBase);
  if (tx.covered == 0u) { discard; }
  let so = impDepthOffset(tx.q, u.imp.y) * v.geo.x; // metres * scale along the bake view dir
  let sp = vec3f(v.wpos.x + so * v.geo.y * IMP_CE, v.wpos.y + so * v.geo.z * IMP_CE, v.wpos.z - so * IMP_SE);
  let cp = u.vp * vec4f(sp, 1.0);
  let zn = cp.z / cp.w;
  out.fd = clamp(0.5 * (zn + 1.0) - f32(u.depthTier) * DEPTH_TIER, 0.0, 1.0);
  let nm = impNormalWorld(tx.nbits, view, yaw);
  let nrmBits = packNormalOct(nm);
  var face = FACE_PACKED;
  var gaW = bitcast<u32>(1.0e30); // aoD = Infinity (mesh kinds), as raster.wgsl.js computeAoD mode 0
  if (max(abs(nm.x), max(abs(nm.y), abs(nm.z))) >= 0.9) { face = roundedFace(nm); } else { gaW = nrmBits; }
  if ((u.flags & RASTER_FLAG_VAO) != 0u) { gaW = bitcast<u32>(1.0); }
  out.GI = vec4u(0u, KIND_MESH | (face << 8u) | (tx.mat << 16u), nrmBits, v.inst.x);
  out.GA = vec4u(bitcast<u32>(v.cuv.x), bitcast<u32>(v.cuv.y), bitcast<u32>(v.wpos.z - v.geo.w), gaW);
  out.Depth = bitcast<u32>(cp.w);
  return out;
}
`;
