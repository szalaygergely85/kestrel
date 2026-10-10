// EMIS-03/04 (architecture.md 38.12 (2)+(3)): WGSL port of engine/render/glow.js `glowFrame` (the JS oracle), D-044 (WGSL only, no GLSL).
// ONE fullscreen fragment pass over the final cells (after edge / stable, before sprites): emissive BLEED (additive spill into solid
// neighbours, depth-gated) and HALO (sky / space-glyph cells: bg tint + glyph from the halo ramp). Constants come from glow.js.
// Bindings (@group(0), textures at binding = slot): 0 GI (rgba32uint), 1 DEPTH (r32uint bitcast f32), 2 FG (rgba8, a = glyph byte / 255),
// 3 BG (rgba8, a = 0 passthrough), 4 MATF (rgba32float, texel 1 .x = emissive); @group(1) @binding(0) = GlowU. Targets: 0 fg, 1 bg.
import { defineUniformBlock } from './uniformBlock.js';
import { GBUF_UNPACK_WGSL, FULLSCREEN_VS_WGSL } from './common.wgsl.js';
import { KIND_TERRAIN } from '../../GBuffer.js';
import { GLOW_DEPTH_K, GLOW_DEPTH_EPS, GLOW_FG_K, GLOW_EMIS_MIN, HALO_GLYPHS } from '../../glow.js';

export const GLOW_BLOCK = defineUniformBlock('GlowU', [
  { name: 'gridCols', type: 'i32' }, { name: 'gridRows', type: 'i32' }, { name: 'radius', type: 'i32' }, { name: 'rampN', type: 'i32' },
  { name: 'gain', type: 'f32' }, { name: 'haloBg', type: 'f32' }, { name: 'haloMin', type: 'f32' }, { name: 'pad0', type: 'f32' },
  { name: 'ramp', type: 'vec4', count: 2 }, // float[8] halo glyph bytes (code - 32), index 0 = space
]);
export const GLOW_TEXTURES = Object.freeze(['uint', 'uint', 'float', 'float', 'float']);
export const GLOW_TARGETS = Object.freeze(['rgba8', 'rgba8']);
export const GLOW_RAMP_MAX = 8;

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

export const GLOW_WGSL = `
${GLOW_BLOCK.wgsl}
@group(0) @binding(0) var uGI: texture_2d<u32>;
@group(0) @binding(1) var uDepth: texture_2d<u32>;
@group(0) @binding(2) var uFg: texture_2d<f32>;
@group(0) @binding(3) var uBg: texture_2d<f32>;
@group(0) @binding(4) var uMatF: texture_2d<f32>;
@group(1) @binding(0) var<uniform> u: GlowU;

${GBUF_UNPACK_WGSL}
${FULLSCREEN_VS_WGSL}

fn depthAt(c: vec2i) -> f32 { return bitcast<f32>(textureLoad(uDepth, c, 0).x); }
fn emisAt(kind: u32, y: u32) -> f32 {
  if (kind == 0u || kind == ${KIND_TERRAIN}u) { return 0.0; } // terrain carries a terrain type in mat, not a material id
  return textureLoad(uMatF, vec2i(1, i32(giMat(y))), 0).x;
}
fn rampAt(k: i32) -> f32 { return u.ramp[k >> 2u][k & 3]; }
fn clampByte(v: f32) -> f32 { return clamp(floor(v + 0.5), 0.0, 255.0); }

struct FO {
  @location(0) fg: vec4f,
  @location(1) bg: vec4f,
};

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> FO {
  let cell = vec2i(floor(frag.xy));
  let fg = textureLoad(uFg, cell, 0);
  let bg = textureLoad(uBg, cell, 0);
  var o: FO;
  o.fg = fg; o.bg = bg;
  if (bg.a < 0.5) { return o; } // passthrough cell
  let gi = textureLoad(uGI, cell, 0).xy;
  let kd = giKind(gi.y);
  if (emisAt(kd, gi.y) >= ${f(GLOW_EMIS_MIN)}) { return o; } // an emissive cell keeps its own colour
  let solid = kd != 0u;
  let dc = depthAt(cell);
  let R = u.radius;
  var sumW = 0.0;
  var acc = vec3f(0.0);
  for (var dy = -R; dy <= R; dy++) {
    for (var dx = -R; dx <= R; dx++) {
      let c = cell + vec2i(dx, dy);
      if ((dx == 0 && dy == 0) || c.x < 0 || c.y < 0 || c.x >= u.gridCols || c.y >= u.gridRows) { continue; }
      let gs = textureLoad(uGI, c, 0).xy;
      let ks = giKind(gs.y);
      let e = emisAt(ks, gs.y);
      if (!(e >= ${f(GLOW_EMIS_MIN)})) { continue; }
      let Rp = f32(R + 1);
      let t = 1.0 - f32(dx * dx + dy * dy) / (Rp * Rp);
      var w = select(0.0, t * t, t > 0.0);
      if (w == 0.0) { continue; }
      if (solid) { w = w * exp(-abs(depthAt(c) - dc) / (${f(GLOW_DEPTH_K)} * dc + ${f(GLOW_DEPTH_EPS)})); }
      w = w * min(e, 1.0);
      sumW = sumW + w;
      let sf = textureLoad(uFg, c, 0).rgb * 255.0;
      acc = acc + w * sf / max(max(sf.r, sf.g), max(sf.b, 1.0));
    }
  }
  if (sumW <= 0.0) { return o; }
  let a = min(sumW, 1.0);
  let glow = (acc / sumW) * 255.0;
  let bgB = bg.rgb * 255.0;
  let fgB = fg.rgb * 255.0;
  let glyph = floor(fg.a * 255.0 + 0.5);
  if (kd == 0u || glyph == 0.0) { // halo
    let tH = a * u.haloBg;
    var nb = bgB + (glow - bgB) * tH;
    o.bg = vec4f(vec3f(clampByte(nb.r), clampByte(nb.g), clampByte(nb.b)) / 255.0, bg.a);
    if (glyph == 0.0 && a >= u.haloMin) {
      let fk = 0.5 + 0.5 * a;
      let gi2 = i32(floor(a * f32(u.rampN - 1) + 0.5));
      o.fg = vec4f(vec3f(clampByte(glow.r * fk), clampByte(glow.g * fk), clampByte(glow.b * fk)) / 255.0, rampAt(gi2) / 255.0);
    }
  } else { // bleed
    let tB = a * u.gain;
    let nb = bgB + glow * tB;
    o.bg = vec4f(vec3f(clampByte(nb.r), clampByte(nb.g), clampByte(nb.b)) / 255.0, bg.a);
    let nf = fgB + glow * (tB * ${f(GLOW_FG_K)});
    o.fg = vec4f(vec3f(clampByte(nf.r), clampByte(nf.g), clampByte(nf.b)) / 255.0, fg.a);
  }
  return o;
}
`;
export const GLOW_RAMP_DEFAULT = HALO_GLYPHS;
