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
  if (!found) return;

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
`;
}
