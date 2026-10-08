// S8-B2-09: hierarchical-Z depth pyramid downsample (max-depth chain), standalone compute module. JS twin/oracle: engine/mesh/hzb.js.
// ONE kernel (`cs_main`) per level: dst texel (x, y) = MAX of the source texels it covers. Depth convention: LARGER = FARTHER (the
// conservative occluder depth of a region is its farthest surface; a box is occluded only when its NEAREST depth is beyond the HZB
// value). Sizes: dstW = max(1, srcW >> 1) (same for H). Each dst texel covers src [2x, 2x+1], and the last column/row also takes
// the odd leftover src column/row (so non-power-of-two sizes lose no texel and the result stays conservative; a 1-wide source maps 1:1).
// Level 0 is the full-resolution depth as an f32 storage buffer (row-major, srcW * srcH): a depth-texture -> buffer copy or a
// resolve pass writes it (B1 wiring, NEEDS B1); level n+1 is produced from level n by one dispatch of ceil(dstW/8) x ceil(dstH/8).
// Bindings (pipeline desc `HZB_BUFFERS`): @group(0) 0 src (read f32), 1 dst (rw f32); @group(1) @binding(0) HzbU (dynamic offset).
import { defineUniformBlock } from './uniformBlock.js';

export const HZB_WORKGROUP = 8;

export const HZB_BLOCK = defineUniformBlock('HzbU', [
  { name: 'srcW', type: 'u32' },
  { name: 'srcH', type: 'u32' },
  { name: 'dstW', type: 'u32' },
  { name: 'dstH', type: 'u32' },
]);

/** Buffer access per slot of the compute pipeline (GpuDevice ComputePipelineDesc.bindings.buffers). */
export const HZB_BUFFERS = Object.freeze(['read', 'rw']);

export const HZB_WGSL = `${HZB_BLOCK.wgsl}
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(1) @binding(0) var<uniform> u: HzbU;

// max depth over the source texels covered by dst texel (x, y); twin: hzb.js hzbTexel
fn hzbTexel(x: u32, y: u32) -> f32 {
  let x0 = 2u * x;
  let y0 = 2u * y;
  let x1 = select(x0 + 1u, u.srcW - 1u, x + 1u == u.dstW);
  let y1 = select(y0 + 1u, u.srcH - 1u, y + 1u == u.dstH);
  var m = src[y0 * u.srcW + x0];
  for (var yy = y0; yy <= y1; yy++) {
    for (var xx = x0; xx <= x1; xx++) {
      m = max(m, src[yy * u.srcW + xx]);
    }
  }
  return m;
}

@compute @workgroup_size(${HZB_WORKGROUP}, ${HZB_WORKGROUP})
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.dstW || gid.y >= u.dstH) { return; }
  dst[gid.y * u.dstW + gid.x] = hzbTexel(gid.x, gid.y);
}
`;
