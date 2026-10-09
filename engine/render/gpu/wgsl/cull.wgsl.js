// WG-4a (docs/architecture.md 38.3/38.8): GPU instance cull for the MESH-INST-01 batches. ONE compute kernel (`cs_main`) per batch:
// one invocation per instance row of the game's instance buffer (16 words = INSTANCE_STRIDE: [A_r0 tx | A_r1 ty | A_r2 tz | objectId flags 0 0]),
// in this order (so the persistent LOD state matches the CPU twin exactly):
//   1. frustum: world AABB t +- R against the 6 planes (CPU twin: culling.js classifyAABB CULL_OUT, p-vertex test, via instances.js compactGroup)
//   2. LOD pick: cells = lodK / clip.w (lodK = R * |y_clip row| * rows, folded on the CPU), LOD1 when cells < lodLo, LOD0 when cells > lodHi, else the
//      previous choice (`lodPrev[i]`, written for every frustum survivor when lodOn; clip.w <= 1e-6 -> LOD0). Twin: compactGroup's LOD block.
//   3. distance cull: |t - eye|^2 > eye.w (eye.w <= 0 = off). The nearest-N prop selection of MESH-INST-01 (meshGroups `chosen`) stays CPU
//      side and supplies this radius; the twin applies the same test after compactGroup.
//   4. compaction: survivors append to dst0 (LOD0) / dst1 (LOD1) with `atomicAdd` on the batch's indirect-args slot (word +1 = instanceCount).
//      ORDER is not stable (atomics): only the SET of drawn rows equals the CPU compaction (a stable order would need a prefix sum).
// Indirect args per (batch, lod) slot = 5 u32 {indexCount, instanceCount, firstIndex, baseVertex, firstInstance} (ARGS_WORDS, = passCull.js's
// ARGS_WORDS); the CPU writes all five every frame with instanceCount = 0 before the dispatch (no reset kernel); for non-indexed draws the
// same words read as {vertexCount, instanceCount, firstVertex, firstInstance}.
// ALPHA-01f (d): a batch whose mesh has >1 range drawn with DIFFERENT pipelines (masked trees: opaque trunk + masked leaves) needs one args
// record PER RANGE, not one per LOD - the kernel still compacts ONE shared instance buffer per LOD (the ranges draw the SAME survivors with
// different vertex/index spans + pipeline), so it just bumps instanceCount on every range's args word+1 for each survivor. `u.rangeCount0` /
// `u.rangeCount1` (CullU, host-written) say how many contiguous ARGS_WORDS-apart records follow `slot0` / `slot1`; 0 or 1 = today's single
// record per LOD (the extra bump loop runs 0 times, bit-identical). The host (passCull.js, NOT this module) owns slot allocation (one
// contiguous block of `rangeCount * ARGS_WORDS` words per LOD) and writing each range's static indexCount/firstIndex/baseVertex words.
// S8-B2-10b (architecture.md 38.20): two-phase HZB occlusion. `u.hzbOn == 0` = the kernel above bit-identical, NO extra reads/writes.
// hzbOn 1, phase 0/1: after frustum/LOD/distance the instance is tested against the PREVIOUS frame's HZB (binding 5, ONE f32 buffer: level 0 with row
// pitch `hzbPitch`, levels >= 1 dense and following at off(L+1) = off(L) + pitch_L * h_L); occluded -> not drawn, `occl[i] = 1 | lod << 1` (pending);
// every other row gets `occl[i] = 0` (binding 6, one u32 per instance). Phase 2 (`u.phase == 2`, fresh HZB): early-out unless `occl[i] & 1`, re-test,
// survivors append with the STORED lod (dither band recomputed from t, never lodPrev) into slots `slot2/slot3` (own args records, same
// rangeCount0/1); the HOST binds the dst2/dst3 buffers at bindings 2/3 for that dispatch. Shadows (cullShadow) never use the camera HZB.
// Bindings (pipeline desc `CULL_BUFFERS`): @group(0) 0 src (read, game instance rows, u32 view), 1 lodPrev (rw, u32 per instance), 2 dst0 (rw), 3 dst1 (rw),
// 4 args (rw, atomic u32), 5 hzb (read, f32), 6 occl (rw, u32 per instance); @group(1) @binding(0) CullU (dynamic offset). Workgroup size 64; dispatch ceil(count / 64).
// The helpers `aabbOutside`, `distOut`, `pickLod`, `occProject/occNear/occTest/instOccluded`, `emit` and `cs_main` are JS-probeable (wgslProbe) against the CPU twins (cull.wgsl.test.js).
import { defineUniformBlock } from './uniformBlock.js';
import { INSTANCE_STRIDE } from '../../../mesh/instances.js';

export const CULL_WORKGROUP = 64;

export const CULL_BLOCK = defineUniformBlock('CullU', [
  { name: 'planes', type: 'vec4', count: 6 }, // frustumPlanes() a, b, c, d (inside iff a x + b y + c z + d >= 0): left, right, bottom, top, near, far
  { name: 'eye', type: 'vec4' },              // xyz = eye, w = max distance squared (<= 0: no distance cull)
  { name: 'lodRow', type: 'vec4' },           // clip-w row of viewProj: vp[3], vp[7], vp[11], vp[15] (column-major)
  { name: 'params', type: 'vec4' },           // x = R, y = lodK, z = lodLo (lodCells * 0.9), w = lodHi (lodCells * 1.1)
  { name: 'count', type: 'u32' },             // instances in src
  { name: 'lodOn', type: 'u32' },             // 1 = LOD pick active
  { name: 'slot0', type: 'u32' },             // first word of the LOD0 args slot in `args`
  { name: 'slot1', type: 'u32' },             // first word of the LOD1 args slot
  { name: 'lodDither', type: 'u32' },         // S8-B2-07: 1 = emit band instances to BOTH LOD lists with complementary dither bits (lodDither.js); 0 = off
  { name: 'swayPad', type: 'f32' },           // S8-B2-06: metres added to R in the frustum test (SWAY_MAX while foliage sway is on, else 0); the LOD cell estimate (params.y) is unchanged
  { name: 'rangeCount0', type: 'u32' },       // ALPHA-01f (d): mesh ranges sharing LOD0's compacted instances (masked batches: opaque + masked range, each its own
                                               // pipeline/args record, `slot0..slot0+(rangeCount0-1)*ARGS_WORDS` contiguous); 0 or 1 = single-range (today's shape, bit-identical)
  { name: 'rangeCount1', type: 'u32' },       // same for LOD1
  // ---- S8-B2-10b: HZB occlusion, appended AFTER rangeCount1 (words 0..43 unchanged; all-zero = occlusion off, today's kernel) ----
  { name: 'vp', type: 'vec4', count: 4 },     // full viewProj, column-major (vp[c] = column c; clip.w row = vp[0].w, vp[1].w, vp[2].w, vp[3].w); viewport = hzbW x hzbH
  { name: 'fwd', type: 'vec4' },              // xyz = unit view forward, w = depth margin m in metres (0.05)
  { name: 'hzbOn', type: 'u32' },             // 1 = occlusion test active (valid HZB); 0 = never test
  { name: 'hzbW', type: 'u32' },              // HZB level-0 width (= raster target cells x rays)
  { name: 'hzbH', type: 'u32' },              // HZB level-0 height
  { name: 'hzbLevels', type: 'u32' },         // pyramid level count (hzb.js hzbLevelSizes length)
  { name: 'hzbPitch', type: 'u32' },          // level-0 words per row incl. copy padding (0 = hzbW); levels >= 1 are dense
  { name: 'phase', type: 'u32' },             // 0/1 = main pass, 2 = re-test of the pending set against the fresh HZB
  { name: 'slot2', type: 'u32' },             // phase 2: args slot for LOD0 survivors (used instead of slot0)
  { name: 'slot3', type: 'u32' },             // phase 2: args slot for LOD1 survivors (used instead of slot1)
]);

/** Buffer access per slot of the compute pipeline (GpuDevice ComputePipelineDesc.bindings.buffers). 5 = hzb (f32), 6 = occl (u32 per instance);
 *  while occlusion is off the host binds a 16 B dummy for both (the kernel never touches them with hzbOn 0). */
export const CULL_BUFFERS = Object.freeze(['read', 'rw', 'rw', 'rw', 'rw', 'read', 'rw']);

/** Indirect-args record size in u32 words (passCull.js ARGS_WORDS); shared with cullShadow.wgsl.js so a batch's per-range
 *  args records ({indexCount,instanceCount,firstIndex,baseVertex,firstInstance}) sit `ARGS_WORDS` apart, contiguous per LOD. */
export const CULL_ARGS_WORDS = 5;

/** Shared with cullShadow.wgsl.js: needs `u.planes`, `u.params.x` (= R) and `u.swayPad` in the including module's uniform block. */
export const CULL_AABB_FN = `// culling.js classifyAABB(planes, t - R, t + R) === CULL_OUT: the AABB corner furthest along each plane normal is behind the plane
fn aabbOutside(tx: f32, ty: f32, tz: f32) -> bool {
  let R = u.params.x + u.swayPad;
  for (var i = 0; i < 6; i++) {
    let pl = u.planes[i];
    let px = select(tx - R, tx + R, pl.x >= 0.0);
    let py = select(ty - R, ty + R, pl.y >= 0.0);
    let pz = select(tz - R, tz + R, pl.z >= 0.0);
    if (pl.x * px + pl.y * py + pl.z * pz + pl.w < 0.0) { return true; }
  }
  return false;
}

`;

export const CULL_WGSL = `${CULL_BLOCK.wgsl}
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> lodPrev: array<u32>;
@group(0) @binding(2) var<storage, read_write> dst0: array<u32>;
@group(0) @binding(3) var<storage, read_write> dst1: array<u32>;
@group(0) @binding(4) var<storage, read_write> args: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read> hzb: array<f32>;
@group(0) @binding(6) var<storage, read_write> occl: array<u32>;
@group(1) @binding(0) var<uniform> u: CullU;
const STRIDE: u32 = ${INSTANCE_STRIDE}u;
const ARGS_WORDS: u32 = ${CULL_ARGS_WORDS}u;

${CULL_AABB_FN}
// instances.js compactGroup LOD block (hysteresis band lodLo..lodHi keeps the previous choice)
fn pickLod(tx: f32, ty: f32, tz: f32, prev: u32) -> u32 {
  if (u.lodOn == 0u) { return 0u; }
  let cw = u.lodRow.x * tx + u.lodRow.y * ty + u.lodRow.z * tz + u.lodRow.w;
  if (cw > 1e-6) {
    let cells = u.params.y / cw;
    if (cells < u.params.z) { return 1u; }
    if (cells > u.params.w) { return 0u; }
    return prev;
  }
  return 0u;
}

// S8-B2-07 (lodDither.js): LOD0 coverage 0..1 across the band, -1 = outside the band / dither off / behind the eye
fn bandFrac(cw: f32) -> f32 {
  if (u.lodOn == 0u || u.lodDither == 0u || cw <= 1e-6) { return -1.0; }
  let cells = u.params.y / cw;
  if (cells < u.params.z || cells > u.params.w) { return -1.0; }
  return (cells - u.params.z) / (u.params.w - u.params.z);
}
fn ditherBits(f: f32, lod: u32) -> u32 {
  let cov = min(u32(floor(f * 256.0)), 256u);
  return 0x4000000u | (cov << 16u) | select(0u, 0x2000000u, lod == 1u);
}

fn distOut(tx: f32, ty: f32, tz: f32) -> bool {
  let m = u.eye.w;
  if (m <= 0.0) { return false; }
  let dx = tx - u.eye.x;
  let dy = ty - u.eye.y;
  let dz = tz - u.eye.z;
  return dx * dx + dy * dy + dz * dz > m;
}

// ---- S8-B2-10b occlusion (twin: engine/mesh/occlusion.js projectAabbRect / nearDepth / aabbOccluded; the f32() wraps mirror the twin's Math.fround) ----
var<private> rect: vec4u; // level-0 texel rect xmin, ymin, xmax, ymax (inclusive), filled by occProject
// the 8 corners of t +- R through vp (y flipped), +-1 texel, clamped; false = a corner at/behind the eye or the rect is off-screen (caller treats as visible)
fn occProject(tx: f32, ty: f32, tz: f32, R: f32) -> bool {
  var minX = 3.4e38;
  var minY = 3.4e38;
  var maxX = -3.4e38;
  var maxY = -3.4e38;
  let W = f32(u.hzbW);
  let H = f32(u.hzbH);
  for (var c = 0u; c < 8u; c++) {
    let x = tx + select(-R, R, (c & 1u) != 0u);
    let y = ty + select(-R, R, (c & 2u) != 0u);
    let z = tz + select(-R, R, (c & 4u) != 0u);
    let cw = f32(u.vp[0].w * x + u.vp[1].w * y + u.vp[2].w * z + u.vp[3].w);
    if (!(cw > 1e-6)) { return false; }
    let cx = u.vp[0].x * x + u.vp[1].x * y + u.vp[2].x * z + u.vp[3].x;
    let cy = u.vp[0].y * x + u.vp[1].y * y + u.vp[2].y * z + u.vp[3].y;
    let sx = f32((cx / cw * 0.5 + 0.5) * W);
    let sy = f32((0.5 - cy / cw * 0.5) * H);
    minX = min(minX, sx);
    maxX = max(maxX, sx);
    minY = min(minY, sy);
    maxY = max(maxY, sy);
  }
  // clamp far outside the target before the i32 conversion (same outcome as +-inf)
  let x0 = max(0, i32(floor(clamp(minX, -1e6, 1e6))) - 1);
  let y0 = max(0, i32(floor(clamp(minY, -1e6, 1e6))) - 1);
  let x1 = min(i32(u.hzbW) - 1, i32(ceil(clamp(maxX, -1e6, 1e6))) + 1);
  let y1 = min(i32(u.hzbH) - 1, i32(ceil(clamp(maxY, -1e6, 1e6))) + 1);
  if (x0 > x1 || y0 > y1) { return false; }
  rect.x = u32(x0);
  rect.y = u32(y0);
  rect.z = u32(x1);
  rect.w = u32(y1);
  return true;
}
// conservative nearest view depth of the sphere t +- Rp (<= 0: no test)
fn occNear(tx: f32, ty: f32, tz: f32, Rp: f32) -> f32 {
  let d = (tx - u.eye.x) * u.fwd.x + (ty - u.eye.y) * u.fwd.y + (tz - u.eye.z) * u.fwd.z;
  return f32(f32((d - Rp) * 0.999) - u.fwd.w);
}
// occluded iff zN > hzb[L][texel] for ALL texels of the picked level covering \`rect\` (+Inf = sky never occludes); BOTH rect ends clamped to the level (10a edge fix)
fn occTest(zN: f32) -> bool {
  if (!(zN > 0.0)) { return false; }
  var L = 0u;
  while (L + 1u < u.hzbLevels && ((rect.z >> L) - (rect.x >> L) > 1u || (rect.w >> L) - (rect.y >> L) > 1u)) { L++; }
  let p0 = select(u.hzbPitch, u.hzbW, u.hzbPitch == 0u);
  var off = 0u;
  var lw = u.hzbW;
  var lh = u.hzbH;
  for (var k = 0u; k < L; k++) {
    off += select(lw, p0, k == 0u) * lh;
    lw = max(1u, lw >> 1u);
    lh = max(1u, lh >> 1u);
  }
  let pitch = select(lw, p0, L == 0u);
  let x0 = min(rect.x >> L, lw - 1u);
  let x1 = min(rect.z >> L, lw - 1u);
  let y0 = min(rect.y >> L, lh - 1u);
  let y1 = min(rect.w >> L, lh - 1u);
  for (var y = y0; y <= y1; y++) {
    for (var x = x0; x <= x1; x++) {
      if (!(zN > hzb[off + y * pitch + x])) { return false; }
    }
  }
  return true;
}
fn instOccluded(tx: f32, ty: f32, tz: f32) -> bool {
  let Rp = u.params.x + u.swayPad;
  if (!occProject(tx, ty, tz, Rp)) { return false; }
  return occTest(occNear(tx, ty, tz, Rp));
}

// append row \`o\` (band: both copies with complementary dither bits; else its LOD list) to the args slots s0/s1 (phase 1: slot0/slot1, phase 2: slot2/slot3)
fn emit(o: u32, lod: u32, bf: f32, s0: u32, s1: u32) {
  if (bf >= 0.0) { // crossfade band: both copies, flags word (+13) gets the complementary dither bits
    let wa = atomicAdd(&args[s0 + 1u], 1u) * STRIDE;
    for (var r = 1u; r < u.rangeCount0; r++) { atomicAdd(&args[s0 + r * ARGS_WORDS + 1u], 1u); } // ALPHA-01f (d): every range of this LOD shares instanceCount
    let wb = atomicAdd(&args[s1 + 1u], 1u) * STRIDE;
    for (var r = 1u; r < u.rangeCount1; r++) { atomicAdd(&args[s1 + r * ARGS_WORDS + 1u], 1u); }
    for (var c = 0u; c < STRIDE; c++) { dst0[wa + c] = src[o + c]; dst1[wb + c] = src[o + c]; }
    dst0[wa + 13u] = src[o + 13u] | ditherBits(bf, 0u);
    dst1[wb + 13u] = src[o + 13u] | ditherBits(bf, 1u);
    return;
  }
  if (lod == 1u) {
    let w1 = atomicAdd(&args[s1 + 1u], 1u) * STRIDE;
    for (var r = 1u; r < u.rangeCount1; r++) { atomicAdd(&args[s1 + r * ARGS_WORDS + 1u], 1u); } // ALPHA-01f (d): per-range args, rangeCount1 0/1 = today's single slot (no extra bump)
    for (var c = 0u; c < STRIDE; c++) { dst1[w1 + c] = src[o + c]; }
  } else {
    let w0 = atomicAdd(&args[s0 + 1u], 1u) * STRIDE;
    for (var r = 1u; r < u.rangeCount0; r++) { atomicAdd(&args[s0 + r * ARGS_WORDS + 1u], 1u); }
    for (var c = 0u; c < STRIDE; c++) { dst0[w0 + c] = src[o + c]; }
  }
}

@compute @workgroup_size(${CULL_WORKGROUP})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.count) { return; }
  let o = i * STRIDE;
  let tx = bitcast<f32>(src[o + 3u]);
  let ty = bitcast<f32>(src[o + 7u]);
  let tz = bitcast<f32>(src[o + 11u]);
  let occOn = u.hzbOn != 0u;
  if (u.phase == 2u) { // re-test the parked set against this frame's HZB (frustum/LOD/distance were decided in phase 1)
    if (!occOn) { return; }
    let ow = occl[i];
    if ((ow & 1u) == 0u) { return; }
    if (instOccluded(tx, ty, tz)) { return; }
    let cwp = u.lodRow.x * tx + u.lodRow.y * ty + u.lodRow.z * tz + u.lodRow.w;
    emit(o, (ow >> 1u) & 1u, bandFrac(cwp), u.slot2, u.slot3);
    return;
  }
  if (occOn) { occl[i] = 0u; }
  if (aabbOutside(tx, ty, tz)) { return; }
  let lod = pickLod(tx, ty, tz, lodPrev[i]);
  if (u.lodOn != 0u) { lodPrev[i] = lod; }
  if (distOut(tx, ty, tz)) { return; }
  let cwb = u.lodRow.x * tx + u.lodRow.y * ty + u.lodRow.z * tz + u.lodRow.w;
  let bf = bandFrac(cwb);
  if (bf >= 0.0) { lodPrev[i] = select(1u, 0u, bf >= 0.5); }
  if (occOn && instOccluded(tx, ty, tz)) { occl[i] = 1u | (lod << 1u); return; } // parked for phase 2
  emit(o, lod, bf, u.slot0, u.slot1);
}
`;
