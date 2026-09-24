// US-030c (docs/architecture.md 14.2 item 4, pass F "sprite"): composites
// billboard sprites over the edge-pass output into rt.fgTex/bgTex. One
// fragment per cell; loops over the sprite list texture (SPR, 4 RGBA32F
// texels per sprite, layout in engine/render/sprites.js), depth-tests each
// candidate against the cell's DEPTH texel, samples the RGBA8UI atlas
// (engine/render/gpu/spritesAtlas.js) and keeps the nearest opaque texel.
// Mirrors `drawSprites` (sprites.js) decision for decision: strict `<` on
// depth (first-listed sprite wins a tie), `floor(float(i) * invScale)` with
// the same f32 multiply, emissive = palette colour untouched by light/fog,
// non-emissive = colour * per-sprite multiplier then fog-blended, bg = the
// edge pass bg (the wall shows through), glyph = atlas code. `mask` cells
// (JS-written UI) always win. No sprite -> copy edgeFg/edgeBg.
//
// `depthUint`: true = DEPTH is R32UI holding floatBitsToUint (US-030a's
// all-uint G-buffer, 14.2 item 3); false = the US-029 R32F texture.
//
// US-017 ARCH CHANGES #1 item 1: this pass is the single point every
// non-mask cell (plain surface copy AND sprite-covered) passes through
// before `present()`'s draw, so the GPU scene fade lands here - exactly
// `fadeGlyph`/`applySceneFade`'s math (engine/ui/fade.js), ported: `uGI`'s
// glyph byte (outFg.a, already the ASCII-32 code used everywhere else in
// this pass) is looked up in `uFadeLut` (R8UI 128x1, `lut.idx`, indexed by
// the FULL ascii code = byte + 32) to get its ramp position `i`, stepped
// toward 0 by `j = floor(uSceneFade * i + 0.5)` (never GLSL `round(` - 14.1
// section 5 lexical rule, `glsl.test.js`/`sprites.test.js` enforce it) and
// looked back up in `uFadeRamp` (R8UI, `lut.ramp`, ramp length x 1) for the
// new ascii code. Colour: `fg *= minGain + (1-minGain)*a`, `bg *= a`,
// mirroring `applySceneFade` exactly. `uSceneFade >= 1.0` is skipped
// entirely (identity, matches `fadeGlyph`'s `a >= 1` fast path).
import { GLSL_VERSION, PRECISION, GBUF_UNPACK, BYTE_OUT } from './common.js';
import { MAX_SPRITES } from '../../sprites.js';

export function spritesFragSrc({ depthUint = true } = {}) {
  const depthDecl = depthUint
    ? 'uniform usampler2D uDepth;\nfloat depthAt(ivec2 c) { return uintBitsToFloat(texelFetch(uDepth, c, 0).r); }'
    : 'uniform sampler2D uDepth;\nfloat depthAt(ivec2 c) { return texelFetch(uDepth, c, 0).r; }';
  return `${GLSL_VERSION}${PRECISION}
layout(location = 0) out vec4 outFg;
layout(location = 1) out vec4 outBg;

uniform usampler2D uGI;
${depthDecl}
uniform sampler2D uEdgeFg;
uniform sampler2D uEdgeBg;
uniform sampler2D uSpr;     // RGBA32F, 4 x MAX_SPRITES: T0 rect, T1 (invScale, depth, fogF, visible), T2 atlas rect, T3 colour mul
uniform usampler2D uAtlas;  // RGBA8UI: r glyph code, g palette index, b emissive|normal<<1, a opaque
uniform sampler2D uPal;     // RGBA32F, n x 1: palette rgb 0..255
uniform int uCount;
uniform vec3 uFogColor;     // palette fog.interior colour, 0..255

// US-017: GPU scene fade (7.4 "Fade"), applied to every non-mask cell below.
uniform float uSceneFade;   // 1 = off/identity
uniform float uFadeMinGain; // lut.minGain, colour floor at a = 0
uniform int uFadeRampLen;   // lut.ramp.length (uFadeRamp texture width)
uniform usampler2D uFadeLut;  // R8UI, 128x1: lut.idx, indexed by full ASCII code
uniform usampler2D uFadeRamp; // R8UI, uFadeRampLen x 1: lut.ramp (ascii codes)

const int MAX_SPRITES = ${MAX_SPRITES};

${GBUF_UNPACK}
${BYTE_OUT}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 efg = texelFetch(uEdgeFg, cell, 0);
  vec4 ebg = texelFetch(uEdgeBg, cell, 0);
  outFg = efg;
  outBg = vec4(ebg.rgb, 1.0);

  uint gy = texelFetch(uGI, cell, 0).y;
  if (giMask(gy) != 0u) return; // JS-written cell (UI) always wins

  float cellDepth = depthAt(cell);
  float best = 3.4e38;
  bool found = false;
  uvec4 tx = uvec4(0u);
  float fogF = 0.0;
  vec3 mul = vec3(1.0);

  for (int s = 0; s < MAX_SPRITES; s++) {
    if (s >= uCount) break;
    vec4 r = texelFetch(uSpr, ivec2(0, s), 0);
    int x0 = int(r.x), y0 = int(r.y);
    if (cell.x < x0 || cell.x >= x0 + int(r.z) || cell.y < y0 || cell.y >= y0 + int(r.w)) continue;
    vec4 p = texelFetch(uSpr, ivec2(1, s), 0);
    if (!(p.y < cellDepth) || !(p.y < best)) continue;
    vec4 a = texelFetch(uSpr, ivec2(2, s), 0);
    int sx = int(floor(float(cell.x - x0) * p.x));
    int sy = int(floor(float(cell.y - y0) * p.x));
    if (sx >= int(a.z) || sy >= int(a.w)) continue;
    uvec4 t = texelFetch(uAtlas, ivec2(int(a.x) + sx, int(a.y) + sy), 0);
    if (t.a == 0u) continue; // transparent texel
    bool emissive = (t.b & 1u) != 0u;
    if (!emissive && p.w < 0.5) continue; // shadeSprite: not visible at this light/fog
    best = p.y; tx = t; fogF = p.z; found = true;
    mul = texelFetch(uSpr, ivec2(3, s), 0).rgb;
  }

  if (found) {
    vec3 base = texelFetch(uPal, ivec2(int(tx.g), 0), 0).rgb;
    vec3 rgb;
    if ((tx.b & 1u) != 0u) {
      rgb = base; // emissive: full palette colour, ignores light and fog
    } else {
      rgb = base * mul;
      if (fogF > 0.0) rgb += (uFogColor - rgb) * fogF;
    }
    outFg = vec4(toByte01(rgb.r), toByte01(rgb.g), toByte01(rgb.b), toByte01(float(tx.r)));
    outBg = vec4(ebg.rgb, 1.0);
  }

  // US-017: fade this non-mask cell (mask already returned above), plain
  // surface or sprite alike - fadeGlyph/applySceneFade ported exactly.
  if (uSceneFade < 1.0) {
    float a = clamp(uSceneFade, 0.0, 1.0);
    int byteA = int(floor(outFg.a * 255.0 + 0.5));
    int code = byteA + 32;
    int i = (code >= 0 && code < 128)
      ? int(texelFetch(uFadeLut, ivec2(code, 0), 0).r)
      : int(texelFetch(uFadeLut, ivec2(0, 0), 0).r); // lut.idx[0] fallback, matches fadeGlyph
    int last = uFadeRampLen - 1;
    int j = int(floor(a * float(i) + 0.5));
    j = j < 0 ? 0 : (j > last ? last : j);
    int newCode = int(texelFetch(uFadeRamp, ivec2(j, 0), 0).r);
    int newIdx = newCode < 32 ? 0 : newCode - 32;
    outFg.a = toByte01(float(newIdx));
    float fgGain = uFadeMinGain + (1.0 - uFadeMinGain) * a;
    outFg.rgb *= fgGain;
    outBg.rgb *= a;
  }
}
`;
}
