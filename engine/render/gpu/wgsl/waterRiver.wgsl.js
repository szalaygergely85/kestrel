// RIVER-03 (docs/architecture.md 38.45 (2); lane OB-019): WGSL port of the river ribbon draw. JS twin = rasterRiverSlot / rasterRiverTri
// (engine/mesh/rasterJS.js), same expression order. Shares the WaterU block (water.wgsl.js, + clipK0/clipK1/clip0/clip1) and the WATER
// target; a separate module only because the vertex layout differs (2 attributes, 32 B) - the clipmap/sheet shader is untouched.
// Vertex buffer = buildRiverMesh verts: @location(0) aL = (lx, ly, z, tau) local to the river origin (uniform shape.xy = origin - O),
// @location(1) aB = (e edge distance, nx, ny, rapid). Interpolation is perspective-correct like the JS weights a0..a2.
// Fragment: discard inside a `clip` region (the lake / sea draws there), the occluder test, then the ribbon texel:
//   x = floatBits(vD), y = oct(nx, ny, 1), z = floatBits(tau), w = slot | back << 4 | 1 << 6 | rapidQ << 8 | min(65535, round(e * 1000)) << 16.
import { WATER_BLOCK } from './water.wgsl.js';
import { OCT_NORMAL_WGSL, ORTHO_NEAR_WGSL, ORTHO_FAR_WGSL } from './common.wgsl.js';

export const WATER_RIVER_VERTEX_STRIDE_BYTES = 32;
export const WATER_RIVER_VERTEX_LAYOUT = Object.freeze([
  { name: 'aL', location: 0, components: 4, type: 'float', offsetBytes: 0 },
  { name: 'aB', location: 1, components: 4, type: 'float', offsetBytes: 16 },
]);

export const WATER_RIVER_WGSL = `${WATER_BLOCK.wgsl}
@group(0) @binding(0) var uSceneDepth: texture_2d<u32>;    // R32UI, bitcast<u32>(d) of the resolved scene (Infinity = sky)
@group(1) @binding(0) var<uniform> wu: WaterU;
${OCT_NORMAL_WGSL}
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) vL: vec2f,   // local xy (O-relative), for the clip test
  @location(1) vT: vec3f,   // tau, e, rapid
  @location(2) vN: vec2f,   // nx, ny
};
@vertex fn vs_main(@location(0) aL: vec4f, @location(1) aB: vec4f) -> VertexOut {
  var o: VertexOut;
  o.vL = aL.xy + wu.shape.xy;
  o.vT = vec3f(aL.w, aB.x, aB.w);
  o.vN = aB.yz;
  o.pos = wu.mvp * vec4f(o.vL, aL.z, 1.0);
  o.pos.y = -o.pos.y; o.pos.z = 0.5 * (o.pos.z + o.pos.w);
  return o;
}

// twin of rasterJS.js inClipRegion: rect half-open [x0,x1) x [y0,y1); circle inclusive; k < 0 = none
fn riverClipped(k: i32, shape: vec4f, p: vec2f) -> bool {
  var inside = false;
  if (k == 0) { inside = p.x >= shape.x && p.x < shape.z && p.y >= shape.y && p.y < shape.w; }
  else if (k == 1) { let d = p - shape.xy; inside = dot(d, d) <= shape.z; }
  return inside;
}

@fragment fn fs_main(@builtin(front_facing) front: bool, v: VertexOut) -> @location(0) vec4u {
  var outWater = vec4u(0u);
  if (riverClipped(wu.clipK0, wu.clip0, v.vL) || riverClipped(wu.clipK1, wu.clip1, v.vL)) { discard; return outWater; }
  let vD = select(1.0 / v.pos.w, ${ORTHO_NEAR_WGSL} + v.pos.z * (${ORTHO_FAR_WGSL} - ${ORTHO_NEAR_WGSL}), wu.projMode == 2u);
  let sceneD = bitcast<f32>(textureLoad(uSceneDepth, vec2i(v.pos.xy), 0).x);
  if (!(vD < sceneD)) { discard; return outWater; }
  let back = select(1u, 0u, front);
  let rq = u32(clamp(floor(v.vT.z * 255.0 + 0.5), 0.0, 255.0));
  let eq = u32(clamp(floor(v.vT.y * 1000.0 + 0.5), 0.0, 65535.0));
  outWater = vec4u(bitcast<u32>(vD), packNormalOct(vec3f(v.vN, 1.0)), bitcast<u32>(v.vT.x), (wu.slot & 15u) | (back << 4u) | 64u | (rq << 8u) | (eq << 16u));
  return outWater;
}
`;
