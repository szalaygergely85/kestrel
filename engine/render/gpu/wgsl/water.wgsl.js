// WG-3e (docs/architecture.md 38.5/38.8, 35.3): WGSL port of glsl/water.vert.js + glsl/water.frag.js (the water clipmap layer),
// line by line; JS twin = rasterWaterTri (engine/mesh/rasterJS.js) + waterVertexJS (engine/mesh/waterMesh.js). ONE module holds
// both stages (`vs_main`, `fs_main`) because they share the uniform block (GL: uKind/uShape/uZ in both programs).
// Deviations from the GLSL text (mechanical): GL uniforms live in one block WaterU (uniformBlock.js layout, instance `wu`; visible
// to VERTEX | FRAGMENT); `a ? b : c` is select(c, b, a); the region test is the helper `waterInside` (JS-probeable, same ops).
// Raster rules: vertex ends `pos.y = -pos.y; pos.z = 0.5 * (pos.z + pos.w)`; `gl_FragCoord` = `v.pos` (the VertexOut @builtin(position); both .w = 1/clip.w, only one position input allowed);
// `gl_FrontFacing` = `@builtin(front_facing)` with the pipeline frontFace 'cw' (the y flip turns the CCW-from-above clipmap CW).
// Bindings: @group(0) @binding(0) uSceneDepth r32uint (textureLoad); @group(1) @binding(0) WaterU (dynamic offset).
// Vertex buffer: 1 attribute @location(0) vec4f aL = WATER_VERTEX_LAYOUT. Target 0 = WATER rgba32uint.
import { defineUniformBlock } from './uniformBlock.js';
import { OCT_NORMAL_WGSL, ORTHO_NEAR_WGSL, ORTHO_FAR_WGSL } from './common.wgsl.js';

export const WATER_BLOCK = defineUniformBlock('WaterU', [
  { name: 'mvp', type: 'mat4' },   // world -> clip, origin O folded in (f64 on the CPU)
  { name: 'aabb', type: 'vec4' },  // local region AABB x0, y0, x1, y1 (grown by 0.5 m)
  { name: 'shape', type: 'vec4' }, // rect: x0, y0, x1, y1 | circle: cx, cy, r^2, -
  { name: 'z', type: 'f32' },      // region z (world)
  { name: 'kind', type: 'i32' },   // 0 rect, 1 circle, 2 sheet
  { name: 'slot', type: 'u32' },
  { name: 'projMode', type: 'u32' }, // US-068b1 (38.19): 2 = ortho (appended)
]);
/** Slot kinds of PipelineDesc.bindings.textures: 0 = uSceneDepth (r32uint). */
export const WATER_TEXTURES = Object.freeze(['uint']);
export const WATER_TARGETS = Object.freeze(['rgba32uint']);

export const WATER_WGSL = `${WATER_BLOCK.wgsl}
@group(0) @binding(0) var uSceneDepth: texture_2d<u32>;    // R32UI, bitcast<u32>(d) of the resolved scene (Infinity = sky)
@group(1) @binding(0) var<uniform> wu: WaterU;
${OCT_NORMAL_WGSL}
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) vL: vec2f,
  @location(1) vArc: f32,   // l' (local, clamped)
};
@vertex fn vs_main(@location(0) aL: vec4f) -> VertexOut {
  var o: VertexOut;
  if (wu.kind == 2) {
    o.vL = aL.xy + wu.shape.xy; o.vArc = aL.w;
    o.pos = wu.mvp * vec4f(o.vL, aL.z, 1.0);
    o.pos.y = -o.pos.y; o.pos.z = 0.5 * (o.pos.z + o.pos.w);
    return o;
  }
  o.vArc = 0.0;
  let l = clamp(aL.xy, wu.aabb.xy, wu.aabb.zw);
  o.vL = l;
  o.pos = wu.mvp * vec4f(l, wu.z, 1.0);
  o.pos.y = -o.pos.y; o.pos.z = 0.5 * (o.pos.z + o.pos.w);
  return o;
}

// Region shape test: sheets always inside; rect half-open [x0,x1) x [y0,y1); circle inclusive.
fn waterInside(kind: i32, shape: vec4f, vL: vec2f) -> bool {
  var inside: bool;
  if (kind == 2) { inside = true; }
  else if (kind == 0) {
    inside = vL.x >= shape.x && vL.x < shape.z && vL.y >= shape.y && vL.y < shape.w;
  } else {
    let d = vL - shape.xy;
    inside = dot(d, d) <= shape.z;
  }
  return inside;
}

@fragment fn fs_main(@builtin(front_facing) front: bool, v: VertexOut) -> @location(0) vec4u {
  var outWater = vec4u(0u);
  let inside = waterInside(wu.kind, wu.shape, v.vL);
  if (!inside) { discard; return outWater; }
  let vD = select(1.0 / v.pos.w, ${ORTHO_NEAR_WGSL} + v.pos.z * (${ORTHO_FAR_WGSL} - ${ORTHO_NEAR_WGSL}), wu.projMode == 2u); // 38.19 ortho: w = 1
  let sceneD = bitcast<f32>(textureLoad(uSceneDepth, vec2i(v.pos.xy), 0).x);
  if (!(vD < sceneD)) { discard; return outWater; }
  let back = select(1u, 0u, front);
  outWater = vec4u(bitcast<u32>(vD), packNormalOct(vec3f(0.0, 0.0, 1.0)), bitcast<u32>(v.vArc), wu.slot | (back << 4u) | select(0u, 32u, wu.kind == 2));
  return outWater;
}
`;
