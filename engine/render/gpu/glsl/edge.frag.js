// US-029 tech notes item 6: `edgePass` (engine/render/edgePass.js) decision
// block ported verbatim to GLSL. Pass 2 of the present hook: reads
// shadeFg/shadeBg (pass 1 output) + GI + depth of the 4 neighbours (and
// i+2), writes MRT rt.fgTex/rt.bgTex (final). Passthrough cells (shadeBg.a
// == 0) are copied unchanged; others get the edge rule, same `farther()`
// (1.18 / 0.35) as the JS pass. Gain applies to the pass-1 BYTE values
// (quantisation happens at the same point as JS): `floor(min(255,
// byte*gain)+0.5)`, min 1.
import { GLSL_VERSION, PRECISION, GBUF_UNPACK } from './common.js';

export const EDGE_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out vec4 outFg;
layout(location = 1) out vec4 outBg;

uniform usampler2D uGI;
uniform usampler2D uDepth; // US-030a: R32UI, floatBitsToUint (14.2 item 3)
uniform sampler2D uShadeFg;
uniform sampler2D uShadeBg;
uniform ivec2 uGrid; // cols, rows
uniform float uFogMax;
uniform float uEdgeGlyph[8]; // rule glyph codes (already ASCII-32), index 0 = cap .. 7 = nosing
uniform float uEdgeGain[8];

${GBUF_UNPACK}

bool isVert(uint kind) { return kind == 1u || kind == 2u || kind == 3u; }
bool isUp(uint kind) { return kind == 4u || kind == 5u; }

// fogF is not stored in a G-buffer texture (stage 1 recomputes fog from
// depth in this pass, tech notes item 5 - "no float aux target"); the fog
// factor formula matches shade.frag.js's (start/full uniforms).
uniform float uFogStart, uFogFull;
float fogF(float dist) {
  return dist <= uFogStart ? 0.0 : (dist >= uFogFull ? 1.0 : (dist - uFogStart) / (uFogFull - uFogStart));
}

uint kindAt(ivec2 c) {
  if (c.x < 0 || c.x >= uGrid.x || c.y < 0 || c.y >= uGrid.y) return 0u;
  return giKind(texelFetch(uGI, c, 0).y);
}
int planeAt(ivec2 c) { return int(texelFetch(uGI, c, 0).x); }
float depthAt(ivec2 c) { return uintBitsToFloat(texelFetch(uDepth, c, 0).r); }

bool farther(ivec2 ic, ivec2 nc, bool validN) {
  if (!validN) return false;
  uint nk = kindAt(nc);
  if (nk == 0u) return true;
  if (planeAt(nc) == planeAt(ic)) return false;
  return depthAt(nc) > depthAt(ic) * 1.18 + 0.35;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 sfg = texelFetch(uShadeFg, cell, 0);
  vec4 sbg = texelFetch(uShadeBg, cell, 0);

  if (sbg.a < 0.5) { outFg = sfg; outBg = vec4(sbg.rgb, 1.0); return; }

  uvec2 gi = texelFetch(uGI, cell, 0).xy;
  uint kind = giKind(gi.y);
  float dist = depthAt(cell);
  float ff = fogF(dist);

  int rule = 0;
  if (kind != 0u && ff <= uFogMax) {
    ivec2 up = cell + ivec2(0, -1), dn = cell + ivec2(0, 1), lf = cell + ivec2(-1, 0), rt2 = cell + ivec2(1, 0);
    bool okUp = up.y >= 0, okDn = dn.y < uGrid.y, okLf = lf.x >= 0, okRt = rt2.x < uGrid.x;

    if (farther(cell, up, okUp)) rule = 1;
    else if (farther(cell, dn, okDn)) rule = 2;
    else if (isVert(kind) && (farther(cell, lf, okLf) || farther(cell, rt2, okRt))) rule = 3;
    else if (isVert(kind) && okRt && isVert(kindAt(rt2)) && planeAt(rt2) != planeAt(cell)) {
      ivec2 l2 = lf, r2 = cell + ivec2(2, 0);
      bool okL2 = okLf, okR2 = r2.x < uGrid.x;
      float dl = (okL2 && kindAt(l2) != 0u) ? depthAt(l2) : dist;
      float dr = (okR2 && kindAt(r2) != 0u) ? depthAt(r2) : depthAt(rt2);
      float di = dist, dRt = depthAt(rt2);
      if (di <= dl && dRt <= dr) rule = 4;
      else if (di >= dl && dRt >= dr) rule = 5;
    }
    if (rule == 0 && isVert(kind) && kind != 2u && okDn && isUp(kindAt(dn)) && depthAt(dn) <= dist * 1.08) rule = 6;
    if (rule == 0 && isVert(kind) && okUp && kindAt(up) == 6u && depthAt(up) <= dist * 1.08) rule = 7;
    if (rule == 0 && kind == 2u && okUp && isUp(kindAt(up))) rule = 8;
  }

  if (rule == 0) { outFg = sfg; outBg = vec4(sbg.rgb, 1.0); return; }

  float gain = uEdgeGain[rule - 1];
  float glyph = uEdgeGlyph[rule - 1];
  // Architect review 1 minor item 4b: re-quantise to the pass-1 BYTE value
  // first (floor(t*255+0.5), matching how JS reads bytes back), THEN apply
  // gain and quantise again - gain multiplies an already-quantised byte, not
  // the raw float, removing the 127.49999-style half-step cases 14.1
  // section 5 warns about (today inside tolerance, but US-030 should not
  // inherit the gap).
  vec3 fgByte0 = floor(sfg.rgb * 255.0 + 0.5);
  vec3 fgByte = floor(min(vec3(255.0), fgByte0 * gain) + 0.5);
  fgByte = max(fgByte, vec3(1.0));
  outFg = vec4(fgByte / 255.0, glyph / 255.0);
  outBg = vec4(sbg.rgb, 1.0);
}
`;
