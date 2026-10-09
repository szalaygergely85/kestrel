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
// Bindings (pipeline desc `CULL_BUFFERS`): @group(0) 0 src (read, game instance rows, u32 view), 1 lodPrev (rw, u32 per instance), 2 dst0 (rw), 3 dst1 (rw),
// 4 args (rw, atomic u32); @group(1) @binding(0) CullU (dynamic offset). Workgroup size 64; dispatch ceil(count / 64).
// The helpers `aabbOutside`, `distOut`, `pickLod` and `cs_main` are JS-probeable (wgslProbe) against the CPU twin (cull.wgsl.test.js).
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
]);

/** Buffer access per slot of the compute pipeline (GpuDevice ComputePipelineDesc.bindings.buffers). */
export const CULL_BUFFERS = Object.freeze(['read', 'rw', 'rw', 'rw', 'rw']);

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

@compute @workgroup_size(${CULL_WORKGROUP})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.count) { return; }
  let o = i * STRIDE;
  let tx = bitcast<f32>(src[o + 3u]);
  let ty = bitcast<f32>(src[o + 7u]);
  let tz = bitcast<f32>(src[o + 11u]);
  if (aabbOutside(tx, ty, tz)) { return; }
  let lod = pickLod(tx, ty, tz, lodPrev[i]);
  if (u.lodOn != 0u) { lodPrev[i] = lod; }
  if (distOut(tx, ty, tz)) { return; }
  let cwb = u.lodRow.x * tx + u.lodRow.y * ty + u.lodRow.z * tz + u.lodRow.w;
  let bf = bandFrac(cwb);
  if (bf >= 0.0) { // crossfade band: both copies, flags word (+13) gets the complementary dither bits
    let wa = atomicAdd(&args[u.slot0 + 1u], 1u) * STRIDE;
    for (var r = 1u; r < u.rangeCount0; r++) { atomicAdd(&args[u.slot0 + r * ARGS_WORDS + 1u], 1u); } // ALPHA-01f (d): every range of this LOD shares instanceCount
    let wb = atomicAdd(&args[u.slot1 + 1u], 1u) * STRIDE;
    for (var r = 1u; r < u.rangeCount1; r++) { atomicAdd(&args[u.slot1 + r * ARGS_WORDS + 1u], 1u); }
    for (var c = 0u; c < STRIDE; c++) { dst0[wa + c] = src[o + c]; dst1[wb + c] = src[o + c]; }
    dst0[wa + 13u] = src[o + 13u] | ditherBits(bf, 0u);
    dst1[wb + 13u] = src[o + 13u] | ditherBits(bf, 1u);
    lodPrev[i] = select(1u, 0u, bf >= 0.5);
    return;
  }
  if (lod == 1u) {
    let w1 = atomicAdd(&args[u.slot1 + 1u], 1u) * STRIDE;
    for (var r = 1u; r < u.rangeCount1; r++) { atomicAdd(&args[u.slot1 + r * ARGS_WORDS + 1u], 1u); } // ALPHA-01f (d): per-range args, rangeCount1 0/1 = today's single slot (no extra bump)
    for (var c = 0u; c < STRIDE; c++) { dst1[w1 + c] = src[o + c]; }
  } else {
    let w0 = atomicAdd(&args[u.slot0 + 1u], 1u) * STRIDE;
    for (var r = 1u; r < u.rangeCount0; r++) { atomicAdd(&args[u.slot0 + r * ARGS_WORDS + 1u], 1u); }
    for (var c = 0u; c < STRIDE; c++) { dst0[w0 + c] = src[o + c]; }
  }
}
`;
