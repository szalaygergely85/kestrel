// WG-3f (docs/architecture.md 38.5/38.8, 14.2 item 4 pass F): WGSL port of glsl/sprites.frag.js (spritesFragSrc({depthUint:true})),
// line by line; JS twin = drawSprites (engine/render/sprites.js) + applySceneFade (engine/ui/fade.js) + applySceneDim (engine/ui/sceneDim.js).
// Only the all-uint G-buffer variant is ported (WebGPU DEPTH is r32uint; the GLSL `depthUint:false` R32F variant has no WebGPU use).
// Deviations (mechanical): GL uniforms live in one block SpritesU (instance `su`); `uDimMul[4]` is one vec4 `dimMul`; `uDimRect[4]` = 4 vec4 rows;
// WGSL has no multi-component swizzle store, so `outFg.rgb *= k` is `o.fg = vec4f(o.fg.rgb * k, o.fg.a)`; `a ? b : c` is select or if/else (texture reads
// stay in if/else); the fade step is the helper `fadeJ` (floor(a*i+0.5) clamped to 0..last, JS-probeable).
// Bindings (@group(0), textures at binding = slot, all textureLoad): 0 GI rgba32uint, 1 DEPTH r32uint, 2 EDGE_FG rgba8, 3 EDGE_BG rgba8,
// 4 SPR rgba32float (5 x MAX_SPRITES), 5 ATLAS rgba8uint, 6 PAL rgba32float (n x 1), 7 FADE_LUT r8uint (128x1), 8 FADE_RAMP r8uint,
// 9 PART rgba8 (particle colour, a = glyph index/255), 10 PART_Z r32float.  @group(1) @binding(0) = SpritesU. Targets rgba8, rgba8 (fg, bg; bg.a = 1).
import { defineUniformBlock } from './uniformBlock.js';
import { GBUF_UNPACK_WGSL, FULLSCREEN_VS_WGSL, BYTE_OUT_WGSL } from './common.wgsl.js';
import { MAX_SPRITES, SPRITE_NEAR_DEPTH } from '../../sprites.js';

export const SPRITES_BLOCK = defineUniformBlock('SpritesU', [
  { name: 'count', type: 'i32' },        // uCount
  { name: 'sceneFade', type: 'f32' },    // 1 = off/identity
  { name: 'fadeMinGain', type: 'f32' },  // lut.minGain
  { name: 'fadeRampLen', type: 'i32' },  // lut.ramp.length
  { name: 'dimAll', type: 'f32' },
  { name: 'dimCount', type: 'i32' },     // 0..4 live rects
  { name: 'pad0', type: 'f32' }, { name: 'pad1', type: 'f32' },
  { name: 'dimMul', type: 'vec4' },      // float uDimMul[4]
  { name: 'dimRect', type: 'vec4', count: 4 }, // x0, y0, x1, y1 (scene cells, half-open)
]);
export const SPRITES_TEXTURES = Object.freeze(['uint', 'uint', 'float', 'float', 'float', 'uint', 'float', 'uint', 'uint', 'float', 'float']);
export const SPRITES_TARGETS = Object.freeze(['rgba8', 'rgba8']);

export const SPRITES_WGSL = `${SPRITES_BLOCK.wgsl}
@group(0) @binding(0) var uGI: texture_2d<u32>;
@group(0) @binding(1) var uDepth: texture_2d<u32>;       // R32UI bitcast<u32>(d)
@group(0) @binding(2) var uEdgeFg: texture_2d<f32>;
@group(0) @binding(3) var uEdgeBg: texture_2d<f32>;
@group(0) @binding(4) var uSpr: texture_2d<f32>;         // RGBA32F, 5 x MAX_SPRITES: T0 rect, T1 (invScale, depth, fogF, visible), T2 atlas rect, T3 colour mul, T4 fog colour
@group(0) @binding(5) var uAtlas: texture_2d<u32>;       // RGBA8UI: r glyph code, g palette index, b emissive|normal<<1, a = 0 transparent else 1 + rounded fogMax*254
@group(0) @binding(6) var uPal: texture_2d<f32>;         // RGBA32F, n x 1: palette rgb 0..255
@group(0) @binding(7) var uFadeLut: texture_2d<u32>;     // R8UI, 128x1: lut.idx, indexed by full ASCII code
@group(0) @binding(8) var uFadeRamp: texture_2d<u32>;    // R8UI, uFadeRampLen x 1: lut.ramp (ascii codes)
@group(0) @binding(9) var uPart: texture_2d<f32>;        // RGBA8: rgb colour, a = glyph index / 255
@group(0) @binding(10) var uPartZ: texture_2d<f32>;      // R32F: depth (0 = empty)
@group(1) @binding(0) var<uniform> su: SpritesU;

const MAX_SPRITES: i32 = ${MAX_SPRITES};
const SPRITE_NEAR_DEPTH: f32 = ${SPRITE_NEAR_DEPTH};

${GBUF_UNPACK_WGSL}
${BYTE_OUT_WGSL}
${FULLSCREEN_VS_WGSL}

fn depthAt(c: vec2i) -> f32 { return bitcast<f32>(textureLoad(uDepth, c, 0).r); }

// fadeGlyph's step: j = floor(a * i + 0.5) clamped to 0..last (never the round builtin).
fn fadeJ(a: f32, i: i32, last: i32) -> i32 {
  var j = i32(floor(a * f32(i) + 0.5));
  j = select(select(j, last, j > last), 0, j < 0);
  return j;
}

struct FO { @location(0) fg: vec4f, @location(1) bg: vec4f };

@fragment fn fs_main(@builtin(position) frag: vec4f) -> FO {
  let cell = vec2i(frag.xy);
  let efg = textureLoad(uEdgeFg, cell, 0);
  let ebg = textureLoad(uEdgeBg, cell, 0);
  var o: FO;
  o.fg = efg;
  o.bg = vec4f(ebg.rgb, 1.0);

  let gy = textureLoad(uGI, cell, 0).y;
  if (giMask(gy) != 0u) { return o; } // JS-written cell (UI) always wins

  let cellDepth = depthAt(cell);
  var best = 3.4e38;
  var found = false;
  var tx = vec4u(0u);
  var fogF = 0.0;
  var mul = vec3f(1.0);
  var fogRGB = vec3f(0.0); // resolved per hit sprite from its own T4

  for (var s = 0; s < MAX_SPRITES; s++) {
    if (s >= su.count) { break; }
    let r = textureLoad(uSpr, vec2i(0, s), 0);
    let x0 = i32(r.x); let y0 = i32(r.y);
    if (cell.x < x0 || cell.x >= x0 + i32(r.z) || cell.y < y0 || cell.y >= y0 + i32(r.w)) { continue; }
    let p = textureLoad(uSpr, vec2i(1, s), 0);
    if (p.y < SPRITE_NEAR_DEPTH && textureLoad(uSpr, vec2i(3, s), 0).w < 0.5) { continue; } // nearOk (T3.w) = view-model attached sprite // BUG-FIRE-001: same cutoff for lit and emissive sprites.
    if (!(p.y < cellDepth) || !(p.y < best)) { continue; }
    let a = textureLoad(uSpr, vec2i(2, s), 0);
    let sx = i32(floor(f32(cell.x - x0) * p.x));
    let sy = i32(floor(f32(cell.y - y0) * p.x));
    if (sx >= i32(a.z) || sy >= i32(a.w)) { continue; }
    let t = textureLoad(uAtlas, vec2i(i32(a.x) + sx, i32(a.y) + sy), 0);
    if (t.a == 0u) { continue; } // transparent texel
    let emissive = (t.b & 1u) != 0u;
    if (!emissive && p.w < 0.5) { continue; } // shadeSprite: not visible at this light/fog
    best = p.y; tx = t; fogF = p.z; found = true;
    mul = textureLoad(uSpr, vec2i(3, s), 0).rgb;
    fogRGB = textureLoad(uSpr, vec2i(4, s), 0).rgb;
  }

  if (found) {
    let base = textureLoad(uPal, vec2i(i32(tx.g), 0), 0).rgb;
    var rgb: vec3f;
    if ((tx.b & 1u) != 0u) {
      rgb = base; // emissive: full palette colour, ignores light (never N.L)
      // per-key emissive fog cap from the atlas alpha (tx.a = 1 + rounded fogMax*254; 1 = no cap)
      let fe = min(fogF, (f32(tx.a) - 1.0) / 254.0);
      if (fe > 0.0) { rgb += (fogRGB - rgb) * fe; }
    } else {
      rgb = base * mul;
      if (fogF > 0.0) { rgb += (fogRGB - rgb) * fogF; }
    }
    o.fg = vec4f(toByte01(rgb.r), toByte01(rgb.g), toByte01(rgb.b), toByte01(f32(tx.r)));
    o.bg = vec4f(ebg.rgb, 1.0);
  }

  // particle layer, after every sprite: a sprite wins an EXACT tie (strict less-than against best)
  let pz = textureLoad(uPartZ, cell, 0).r;
  if (pz > 0.0 && pz < cellDepth && pz < best) {
    let pcol = textureLoad(uPart, cell, 0);
    o.fg = pcol;
    o.bg = vec4f(ebg.rgb, 1.0);
  }

  // GPU scene fade (fadeGlyph / applySceneFade ported exactly)
  if (su.sceneFade < 1.0) {
    let a = clamp(su.sceneFade, 0.0, 1.0);
    let byteA = i32(floor(o.fg.a * 255.0 + 0.5));
    let code = byteA + 32;
    var i: i32;
    if (code >= 0 && code < 128) { i = i32(textureLoad(uFadeLut, vec2i(code, 0), 0).r); }
    else { i = i32(textureLoad(uFadeLut, vec2i(0, 0), 0).r); } // lut.idx[0] fallback, matches fadeGlyph
    let last = su.fadeRampLen - 1;
    let j = fadeJ(a, i, last);
    let newCode = i32(textureLoad(uFadeRamp, vec2i(j, 0), 0).r);
    let newIdx = select(newCode - 32, 0, newCode < 32);
    let fgGain = su.fadeMinGain + (1.0 - su.fadeMinGain) * a;
    o.fg = vec4f(o.fg.rgb * fgGain, toByte01(f32(newIdx)));
    o.bg = vec4f(o.bg.rgb * a, o.bg.a);
  }

  // scene dim: k = min(dimAll, mul of every rect containing this cell); glyph unchanged
  if (su.dimAll < 1.0 || su.dimCount > 0) {
    var k = su.dimAll;
    for (var i = 0; i < 4; i++) {
      if (i >= su.dimCount) { break; }
      let r = su.dimRect[i];
      if (f32(cell.x) >= r.x && f32(cell.x) < r.z && f32(cell.y) >= r.y && f32(cell.y) < r.w) {
        k = min(k, su.dimMul[i]);
      }
    }
    if (k < 1.0) {
      o.fg = vec4f(o.fg.rgb * k, o.fg.a);
      o.bg = vec4f(o.bg.rgb * k, o.bg.a);
    }
  }
  return o;
}
`;
