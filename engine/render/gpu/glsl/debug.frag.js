// US-029 tech notes item 6/9: `?gpudebug=kind|plane|rule` - renders the
// chosen G-buffer field as colours into fgTex/bgTex IN PLACE OF pass 2 (the
// edge pass), for GLSL debugging (no shader stepping otherwise). Never used
// in the timed/budgeted frame path.
import { GLSL_VERSION, PRECISION, GBUF_UNPACK } from './common.js';

export const DEBUG_MODE_KIND = 0;
export const DEBUG_MODE_PLANE = 1;
export const DEBUG_MODE_RULE = 2;

export const DEBUG_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out vec4 outFg;
layout(location = 1) out vec4 outBg;

uniform usampler2D uGI;
uniform sampler2D uShadeFg;
uniform int uMode; // 0 kind, 1 planeId, 2 rule (recomputed cheaply: 0/non-0 only, full rule needs edge.frag)

${GBUF_UNPACK}

vec3 hueRamp(float t) {
  t = fract(t);
  vec3 c = clamp(abs(mod(t * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  uvec2 gi = texelFetch(uGI, cell, 0).xy;
  uint kind = giKind(gi.y);
  vec3 col;
  if (uMode == 0) {
    col = kind == 0u ? vec3(0.0) : hueRamp(float(kind) / 6.0);
  } else if (uMode == 1) {
    int p = int(gi.x);
    col = hueRamp(float(p % 97) / 97.0);
  } else {
    // Cheap "is this a passthrough cell" indicator only - the full rule
    // value is computed in edge.frag; this mode is for spotting where pass 1
    // did/didn't shade, not the exact rule code.
    vec4 sfg = texelFetch(uShadeFg, cell, 0);
    col = kind == 0u ? vec3(0.0) : vec3(sfg.a, sfg.a, sfg.a);
  }
  outFg = vec4(col, 0.0);
  outBg = vec4(0.0, 0.0, 0.0, 1.0);
}
`;
