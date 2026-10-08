// WG-4b (docs/architecture.md 38.3/38.8): GPU shadow-caster cull for the sun shadow pass. Same buffer layout, dispatch and indirect-args
// scheme as cull.wgsl.js (WG-4a), but the per-instance test is the CPU twin instances.js `fillShadowBands` (ME-15f), NOT the camera cull:
//   1. horizontal distance d = |t.xy - eye.xy| from the camera eye and the persistent band per game slot (hysteresis +-h; `band[i]`, 0 = LOD0 band,
//      1 = LOD1 band, 2 = none; initial 0 like `g.shadowBand`): band 2 -> no shadow.
//   2. sun-box planes: world AABB t +- R against the 6 `shadowSunMatrix().planes` (same aabbOutside as cull.wgsl.js).
//   3. compaction by band into dst0 (band 0) / dst1 (band 1) with atomicAdd on the batch's indirect-args slot (word +1 = instanceCount).
// Band 2 never mutates anything but `band[i]`. The mesh shadow budget (shadows.meshCastM / meshCastCap, opt-in) is not part of this kernel: it only
// applies to placed kind-9 props (MeshGroupSet), never to instanced groups, and is off by default. Order of the drawn rows is not stable (atomics).
// Bindings: @group(0) 0 src (read), 1 band (rw, u32 per instance), 2 dst0, 3 dst1, 4 args (rw atomic); @group(1) @binding(0) CullShadowU. Workgroup 64.
import { defineUniformBlock } from './uniformBlock.js';
import { INSTANCE_STRIDE } from '../../../mesh/instances.js';
import { CULL_AABB_FN, CULL_WORKGROUP } from './cull.wgsl.js';

export const CULL_SHADOW_BLOCK = defineUniformBlock('CullShadowU', [
  { name: 'planes', type: 'vec4', count: 6 }, // shadow ortho frustum planes (a, b, c, d; inside iff a x + b y + c z + d >= 0)
  { name: 'eye', type: 'vec4' },              // x, y = camera eye xy; z = lod0M (band 0 radius); w = castM (band 1 radius)
  { name: 'params', type: 'vec4' },           // x = R (group radius), y = band hysteresis (SHADOW_BAND_HYST_M)
  { name: 'count', type: 'u32' },
  { name: 'slot0', type: 'u32' },             // first word of the band-0 args slot
  { name: 'slot1', type: 'u32' },             // first word of the band-1 args slot
  { name: 'pad', type: 'u32' },
  { name: 'swayPad', type: 'f32' },           // S8-B2-06: metres added to R in the sun-box plane test (SWAY_MAX while sway is on, else 0)
]);

export const CULL_SHADOW_BUFFERS = Object.freeze(['read', 'rw', 'rw', 'rw', 'rw']);

export const CULL_SHADOW_WGSL = `${CULL_SHADOW_BLOCK.wgsl}
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> band: array<u32>;
@group(0) @binding(2) var<storage, read_write> dst0: array<u32>;
@group(0) @binding(3) var<storage, read_write> dst1: array<u32>;
@group(0) @binding(4) var<storage, read_write> args: array<atomic<u32>>;
@group(1) @binding(0) var<uniform> u: CullShadowU;
const STRIDE: u32 = ${INSTANCE_STRIDE}u;

${CULL_AABB_FN}// instances.js fillShadowBands band update (hysteresis +-h around lod0M / castM)
fn bandUpdate(d: f32, prev: u32) -> u32 {
  let h = u.params.y;
  let lod0M = u.eye.z;
  let castM = u.eye.w;
  var b = prev;
  if (b == 2u && d < castM - h) { b = 1u; }
  if (b == 1u && d < lod0M - h) { b = 0u; }
  if (b == 0u && d > lod0M + h) { b = 1u; }
  if (b == 1u && d > castM + h) { b = 2u; }
  return b;
}

@compute @workgroup_size(${CULL_WORKGROUP})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.count) { return; }
  let o = i * STRIDE;
  let tx = bitcast<f32>(src[o + 3u]);
  let ty = bitcast<f32>(src[o + 7u]);
  let dx = tx - u.eye.x;
  let dy = ty - u.eye.y;
  let b = bandUpdate(sqrt(dx * dx + dy * dy), band[i]);
  band[i] = b;
  if (b == 2u) { return; }
  let tz = bitcast<f32>(src[o + 11u]);
  if (aabbOutside(tx, ty, tz)) { return; }
  if (b == 1u) {
    let w1 = atomicAdd(&args[u.slot1 + 1u], 1u) * STRIDE;
    for (var c = 0u; c < STRIDE; c++) { dst1[w1 + c] = src[o + c]; }
  } else {
    let w0 = atomicAdd(&args[u.slot0 + 1u], 1u) * STRIDE;
    for (var c = 0u; c < STRIDE; c++) { dst0[w0 + c] = src[o + c]; }
  }
}
`;
