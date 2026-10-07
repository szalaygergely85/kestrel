// WG-3a (docs/architecture.md 38.5/38.8): WGSL port of glsl/deriv.frag.js (US-030a pass C), line by line; JS twin =
// detailShade.js computeDerivatives. Same-planeId 4-neighbour central/one-sided difference, analytic fallback at a
// silhouette edge. Terrain cells (US-016) and empty cells output zeros.
// Bindings: @group(0) 0 = GI (rgba32uint), 1 = GA (rgba32uint), 2 = DEPTH (r32uint); @group(1) @binding(0) = DerivU.
// Target 0 = GD rgba32uint (bitcast u32 of dudx, dvdx, dudy, dvdy).
import { defineUniformBlock } from './uniformBlock.js';
import { GBUF_UNPACK_WGSL, FULLSCREEN_VS_WGSL } from './common.wgsl.js';
import { KIND_TERRAIN } from '../../GBuffer.js';

/** Uniform block: grid size (cols, rows as i32), tanHalfHFov, planeDistY. */
export const DERIV_BLOCK = defineUniformBlock('DerivU', [
  { name: 'cols', type: 'i32' },
  { name: 'rows', type: 'i32' },
  { name: 'tanHalfHFov', type: 'f32' },
  { name: 'planeDistY', type: 'f32' },
]);

export const DERIV_TEXTURES = Object.freeze(['uint', 'uint', 'uint']);
export const DERIV_TARGETS = Object.freeze(['rgba32uint']);

export const DERIV_WGSL = `
${DERIV_BLOCK.wgsl}
@group(0) @binding(0) var uGI: texture_2d<u32>;    // x = planeId, y = kind|face<<8|mask<<12|mat<<16
@group(0) @binding(1) var uGA: texture_2d<u32>;    // bitcast u, v, z, aoD
@group(0) @binding(2) var uDepth: texture_2d<u32>; // bitcast dist
@group(1) @binding(0) var<uniform> u: DerivU;
${GBUF_UNPACK_WGSL}
${FULLSCREEN_VS_WGSL}
struct Sample { kind: u32, planeId: i32, u: f32, v: f32 };

fn fetchSample(c: vec2i) -> Sample {
  let gi = textureLoad(uGI, c, 0).xy;
  let ga = textureLoad(uGA, c, 0);
  var s: Sample;
  s.kind = giKind(gi.y);
  s.planeId = i32(gi.x);
  s.u = bitcast<f32>(ga.x);
  s.v = bitcast<f32>(ga.y);
  return s;
}

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> @location(0) vec4u {
  let cell = vec2i(floor(frag.xy));
  let gi0 = textureLoad(uGI, cell, 0).xy;
  let kind0 = giKind(gi0.y);
  // US-016 (14.4): terrain cells need no derivatives - skip like an empty cell.
  if (kind0 == 0u || kind0 == ${KIND_TERRAIN}u) { return vec4u(0u); }
  let pid0 = i32(gi0.x);
  let ga0 = textureLoad(uGA, cell, 0);
  let u0 = bitcast<f32>(ga0.x);
  let v0 = bitcast<f32>(ga0.y);
  let depth0 = bitcast<f32>(textureLoad(uDepth, cell, 0).x);

  var dudx: f32; var dvdx: f32; var dudy: f32; var dvdy: f32;

  let hasL = cell.x > 0;
  let hasR = cell.x < u.cols - 1;
  var l: Sample; var r: Sample;
  var okL = false; var okR = false;
  if (hasL) { l = fetchSample(vec2i(cell.x - 1, cell.y)); okL = l.kind != 0u && l.planeId == pid0; }
  if (hasR) { r = fetchSample(vec2i(cell.x + 1, cell.y)); okR = r.kind != 0u && r.planeId == pid0; }
  if (okL && okR) { dudx = (r.u - l.u) * 0.5; dvdx = (r.v - l.v) * 0.5; }
  else if (okR) { dudx = r.u - u0; dvdx = r.v - v0; }
  else if (okL) { dudx = u0 - l.u; dvdx = v0 - l.v; }
  else { dudx = depth0 * 2.0 * u.tanHalfHFov / f32(u.cols); dvdx = 0.0; }

  let hasT = cell.y > 0;
  let hasB = cell.y < u.rows - 1;
  var t: Sample; var b: Sample;
  var okT = false; var okB = false;
  if (hasT) { t = fetchSample(vec2i(cell.x, cell.y - 1)); okT = t.kind != 0u && t.planeId == pid0; }
  if (hasB) { b = fetchSample(vec2i(cell.x, cell.y + 1)); okB = b.kind != 0u && b.planeId == pid0; }
  if (okT && okB) { dudy = (b.u - t.u) * 0.5; dvdy = (b.v - t.v) * 0.5; }
  else if (okB) { dudy = b.u - u0; dvdy = b.v - v0; }
  else if (okT) { dudy = u0 - t.u; dvdy = v0 - t.v; }
  else {
    dudy = 0.0;
    let isVertKind = kind0 == 1u || kind0 == 2u || kind0 == 3u;
    dvdy = select(1.0, -1.0, isVertKind) * depth0 / u.planeDistY;
  }

  return vec4u(bitcast<u32>(dudx), bitcast<u32>(dvdx), bitcast<u32>(dudy), bitcast<u32>(dvdy));
}
`;
