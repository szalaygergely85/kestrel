// WG-2a (docs/architecture.md 38.5/38.8): WGSL port of glsl/debug.frag.js ('?gpudebug'), extended with normal + depth.
// A fullscreen pass that reads the G-buffer (GI, GA, DEPTH: all textureLoad, never a sampler) and writes the colour view
// into the render target's fg/bg textures in place of the (not yet ported) shade/edge passes.
// Modes: 0 kind (hue per kind, GL parity), 1 planeId (GL parity), 2 normal (octahedral GI.z), 3 depth (f32 bits in DEPTH).
// Cell coordinates come straight from @builtin(position).xy (memory rows, no flip; 38.5 item 4); the target is the
// cols x rows rgba8 fg/bg pair of the render target, the G-buffer is (cols * rays) x (rows * rays): texel = cell * rays.
// Bindings: @group(0) 0 = GI (rgba32uint), 1 = GA (rgba32uint), 2 = DEPTH (r32uint); @group(1) @binding(0) = DebugU.

import { defineUniformBlock } from './uniformBlock.js';

export const DEBUG_MODE_KIND = 0;
export const DEBUG_MODE_PLANE = 1;
export const DEBUG_MODE_NORMAL = 2;
export const DEBUG_MODE_DEPTH = 3;

/** Uniform block: mode (0..3 as f32, compared via i32), rays (sub-sample factor), depthK (depth fade scale). */
export const DEBUG_BLOCK = defineUniformBlock('DebugU', [
  { name: 'mode', type: 'f32' },
  { name: 'rays', type: 'f32' },
  { name: 'depthK', type: 'f32' },
]);

/** Texture slot kinds for PipelineDesc.bindings.textures. */
export const DEBUG_TEXTURES = Object.freeze(['uint', 'uint', 'uint']);

export const DEBUG_WGSL = `
${DEBUG_BLOCK.wgsl}
@group(0) @binding(0) var uGI: texture_2d<u32>;    // x = planeId, y = kind | face | mat, z = octahedral normal, w = objectId
@group(0) @binding(1) var uGA: texture_2d<u32>;
@group(0) @binding(2) var uDepth: texture_2d<u32>; // x = f32 bits of the hit depth
@group(1) @binding(0) var<uniform> u: DebugU;

@vertex
fn vs_main(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
  let pos = vec2f(f32((id << 1u) & 2u), f32(id & 2u));
  return vec4f(pos * 2.0 - 1.0, 0.0, 1.0);
}

// twin of debug.frag.js hueRamp: the GLSL modulo of v by 6.0 = v - 6.0 * floor(v / 6.0) (floor-mod, not WGSL truncating)
fn hueRamp(t0: f32) -> vec3f {
  let t = fract(t0);
  let v = t * 6.0 + vec3f(0.0, 4.0, 2.0);
  let m = v - vec3f(6.0) * floor(v / vec3f(6.0));
  return clamp(abs(m - vec3f(3.0)) - vec3f(1.0), vec3f(0.0), vec3f(1.0));
}

// twin of common.js unpackNormalOct
fn unpackNormalOct(bits: u32) -> vec3f {
  let qx = bits & 0xFFFFu;
  let qy = (bits >> 16u) & 0xFFFFu;
  var x = (f32(qx) / 65535.0) * 2.0 - 1.0;
  var y = (f32(qy) / 65535.0) * 2.0 - 1.0;
  let z = 1.0 - abs(x) - abs(y);
  if (z < 0.0) {
    let ax = abs(x);
    let ay = abs(y);
    let sx = select(-1.0, 1.0, x >= 0.0);
    let sy = select(-1.0, 1.0, y >= 0.0);
    let ox = (1.0 - ay) * sx;
    let oy = (1.0 - ax) * sy;
    x = ox;
    y = oy;
  }
  return normalize(vec3f(x, y, z));
}

struct FO {
  @location(0) fg: vec4f,
  @location(1) bg: vec4f,
};

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> FO {
  let cell = vec2i(floor(frag.xy)) * i32(u.rays);
  let gi = textureLoad(uGI, cell, 0);
  let kind = gi.y & 0xffu;
  let mode = i32(u.mode);
  var col = vec3f(0.0);
  if (mode == 0) {
    if (kind != 0u) { col = hueRamp(f32(kind) / 6.0); }
  } else if (mode == 1) {
    let p = gi.x - (gi.x / 97u) * 97u;
    col = hueRamp(f32(p) / 97.0);
  } else if (mode == 2) {
    if (kind != 0u) { col = unpackNormalOct(gi.z) * 0.5 + vec3f(0.5); }
  } else {
    let d = bitcast<f32>(textureLoad(uDepth, cell, 0).x);
    // sky / void keeps the cleared depth (0 bits or non-finite): black
    if (kind != 0u && d > 0.0 && d < 1.0e30) { let g = 1.0 / (1.0 + d * u.depthK); col = vec3f(g); }
  }
  // glyph 0 is a space (no coverage), so '@' (idx 32 = (64 - 32) / 255 in fg.a) gives solid fg on non-empty cells (see debug.frag.js)
  let glyphA = select(0.0, 32.0 / 255.0, kind != 0u);
  var o: FO;
  o.fg = vec4f(col, glyphA);
  o.bg = vec4f(0.0, 0.0, 0.0, 1.0);
  return o;
}
`;
