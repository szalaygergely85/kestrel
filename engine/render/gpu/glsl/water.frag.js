// engine/render/gpu/glsl/water.frag.js - US-055a2a (docs/architecture.md 35.3): the water layer's fragment stage.
// GLSL twin of `rasterWaterTri` (engine/mesh/rasterJS.js): region shape test (discard outside), occluder (discard when the
// resolved scene DEPTH at this cell is nearer or equal: `vD >= DEPTH`), then WATER = RGBA32UI:
//   x = floatBits(vD)   (vD = 1 / gl_FragCoord.w, the perpendicular camera distance = the DEPTH unit)
//   y = oct normal      (always the up-facing one)
//   z = floatBits(h)    (0 while the water is flat; sheets: arc metres)
//   w = slot | back << 4 | sheet << 5   (back = seen from below: !gl_FrontFacing, the clipmap is CCW from above)
// Rect is half-open [x0,x1) x [y0,y1) like `waterAt`; the circle is inclusive. Coordinates are local to O (f32-safe).
import { GLSL_VERSION, PRECISION, OCT_NORMAL } from './common.js';

export const WATER_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
${OCT_NORMAL}
layout(location = 0) out uvec4 outWater;

uniform usampler2D uSceneDepth;    // R32UI, floatBitsToUint(d) of the resolved scene (Infinity = sky)
uniform int uKind;                 // 0 rect, 1 circle
uniform vec4 uShape;               // rect: x0, y0, x1, y1 | circle: cx, cy, r^2, -
uniform uint uSlot;
in vec2 vL;
in float vArc;

void main() {
  bool inside;
  if (uKind == 2) inside = true;
  else if (uKind == 0) {
    inside = vL.x >= uShape.x && vL.x < uShape.z && vL.y >= uShape.y && vL.y < uShape.w;
  } else {
    vec2 d = vL - uShape.xy;
    inside = dot(d, d) <= uShape.z;
  }
  if (!inside) discard;
  float vD = 1.0 / gl_FragCoord.w;
  float sceneD = uintBitsToFloat(texelFetch(uSceneDepth, ivec2(gl_FragCoord.xy), 0).x);
  if (!(vD < sceneD)) discard;
  uint back = gl_FrontFacing ? 0u : 1u;
  outWater = uvec4(floatBitsToUint(vD), packNormalOct(vec3(0.0, 0.0, 1.0)), floatBitsToUint(vArc), uSlot | (back << 4u) | (uKind == 2 ? 32u : 0u));
}
`;
