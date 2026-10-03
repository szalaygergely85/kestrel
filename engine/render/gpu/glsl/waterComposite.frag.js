// engine/render/gpu/glsl/waterComposite.frag.js - US-055a2b (docs/architecture.md 32.2 + 35.3): the water composite as its own
// fullscreen pass between SHADE and EDGE (mesh renderer only; skipped when no region is on screen).
//
// Why a pass of its own and not a helper inside shade.frag.js (35.3 says "called at all three output sites"): the shade program already
// binds 16 samplers = the WebGL2 guaranteed minimum (MAX_TEXTURE_IMAGE_UNITS); a 17th (WATER) is not portable. Reading the shade OUTPUT
// is equivalent: shade already applied the site's own fog (sky, terrain, material), and the composite only needs fg/bg, the WATER
// texel, kind (sky or surface), raw depth and the cell's sun-map bits. Cost when no water: zero (the pass does not run).
//
// Literal twin of engine/render/waterComposite.js (same expression order; see its header for the rules). Reads shadeFg/shadeBg (bytes),
// writes the composited bytes to the composite target; cells that are not water, or passthrough cells (shadeBg.a == 0), are copied.
import { GLSL_VERSION, PRECISION, GBUF_UNPACK, HASH_FAST, BYTE_OUT, PITCH_UNIFORMS, CELL_RAY, CELL_RAY_PITCHED } from './common.js';
import { SUN_N_SHIFT, SUN_N_MASK } from '../../shadowSun.js';
import { WL_STRIDE, WL_SLOTS, WATER_HASH_SALT, WATER_FLOW_SALT } from '../../waterLook.js';

export const WATER_COMPOSITE_VECS_PER_SLOT = WL_STRIDE / 4;

export const WATER_COMPOSITE_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out vec4 outFg;
layout(location = 1) out vec4 outBg;

uniform sampler2D uShadeFg;
uniform sampler2D uShadeBg;
uniform usampler2D uGI;
uniform usampler2D uDepth;   // R32UI floatBitsToUint(d), raw view depth
uniform usampler2D uWater;   // RGBA32UI: x = floatBits(vD) (+Inf = no water), w = slot | back << 4 | sheet << 5
uniform usampler2D uLightTex;
uniform ivec2 uGrid;
uniform float uTimeSec;
uniform int uSunMapOn;
uniform vec3 uSunDir;
uniform float uAmbientI, uSunI;
uniform float uPosX, uPosY, uEyeH, uDirX, uDirY, uPlaneX, uPlaneY, uHorizonRow, uPlaneDistY;
uniform vec4 uWL[${WL_SLOTS * (WL_STRIDE / 4)}]; // packed look rows, ${WL_STRIDE / 4} vec4 per slot (waterLook.js)
uniform vec4 uWFog[5];                            // start/full/curve/bgScale, fgNear, fgFar, bgNear, bgFar

${GBUF_UNPACK}
${HASH_FAST}
${BYTE_OUT}
${PITCH_UNIFORMS}
${CELL_RAY}
${CELL_RAY_PITCHED}

// US-141a (35.4): diamond angle in [0, 4), no atan; twin of waterLook.js diamondAngle
float diamondAngle(float dx, float dy) {
  float d = abs(dx) + abs(dy);
  if (d < 1.0e-9) return 0.0;
  float p = dy / d;
  return dx < 0.0 ? 2.0 - p : (dy < 0.0 ? 4.0 + p : p);
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 sfg = texelFetch(uShadeFg, cell, 0);
  vec4 sbg = texelFetch(uShadeBg, cell, 0);
  outFg = sfg;
  outBg = sbg;
  if (sbg.a < 0.5) return; // JS-layer passthrough cell (HUD etc.)
  uvec4 w = texelFetch(uWater, cell, 0);
  if (w.x == 0x7f800000u) return; // cleared: no water here
  float dW = uintBitsToFloat(w.x);
  bool isSky = giKind(texelFetch(uGI, cell, 0).y) == 0u;
  float raw = isSky ? 1.0e30 : uintBitsToFloat(texelFetch(uDepth, cell, 0).r);
  if (!(dW < raw)) return;

  int lb = int(w.w & 15u) * ${WL_STRIDE / 4};
  vec4 r0 = uWL[lb], r1 = uWL[lb + 1], r2 = uWL[lb + 2], r3 = uWL[lb + 3];
  float opaqueAt = r0.w, seeThrough = r1.w, bgK = r3.y;
  int nGlyph = int(r3.x);
  float a = isSky ? 1.0 : clamp((raw - dW) / opaqueAt, 0.0, 1.0);

  vec3 P;
  if (uProjMode == 0) P = cellRayP(vec2(cell), uGrid, uPosX, uPosY, uEyeH, uDirX, uDirY, uPlaneX, uPlaneY, uHorizonRow, uPlaneDistY, dW);
  else P = cellRayPitched(vec2(cell), uGrid, vec3(uPosX, uPosY, uEyeH), uPitchA.xyz, uPitchB.xy, vec3(uPitchB.zw, uPitchC.x), vec2(uPitchA.w, uPitchC.y), dW);

  float column = 1.0e30;
  if (!isSky) {
    vec3 floorP;
    if (uProjMode == 0) floorP = cellRayP(vec2(cell), uGrid, uPosX, uPosY, uEyeH, uDirX, uDirY, uPlaneX, uPlaneY, uHorizonRow, uPlaneDistY, raw);
    else floorP = cellRayPitched(vec2(cell), uGrid, vec3(uPosX, uPosY, uEyeH), uPitchA.xyz, uPitchB.xy, vec3(uPitchB.zw, uPitchC.x), vec2(uPitchA.w, uPitchC.y), raw);
    column = max(0.0, P.z - floorP.z);
  }
  float tint = isSky ? a : min(column / uWL[lb + 9].z, 1.0);

  // sun on an up normal, the terrain 'b' formula (the cell's own sun-map bits when the map ran)
  uvec4 lightT = texelFetch(uLightTex, cell, 0);
  float sunF = uSunMapOn != 0 ? float((lightT.w >> ${SUN_N_SHIFT}u) & ${SUN_N_MASK}u) * 0.25 : 1.0;
  float k = uAmbientI + uSunI * max(uSunDir.z, 0.0) * sunF;
  vec3 wc = clamp((r0.rgb + (r1.rgb - r0.rgb) * tint) * k, 0.0, 255.0);

  vec3 wb = wc * bgK; // background never receives the glint (36.1b)
  bool opaque = a >= seeThrough;
  float glyph = floor(sfg.a * 255.0 + 0.5);
  if (opaque) {
    vec4 r9 = uWL[lb + 9];
    float u = (P.x * 0.8776 + P.y * 0.4794) / r3.z - r9.x;
    float v = (-P.x * 0.4794 + P.y * 0.8776) / r3.z;
    int iu = int(floor(u)), iv = int(floor(v + 0.5 * float(iu & 1)));
    uint h0 = hashFastU(iu & 1023, iv & 1023, ${WATER_HASH_SALT});
    int tick = int(floor(r9.y + float(h0 & 255u) / 256.0));
    uint h = hashFastU(iu & 1023, iv & 1023, ${WATER_HASH_SALT} + 31 * tick);
    int gi = int(h % uint(nGlyph));
    vec4 gv = uWL[lb + 4 + (gi >> 2)];
    int gc = gi & 3;
    glyph = gc == 0 ? gv.x : (gc == 1 ? gv.y : (gc == 2 ? gv.z : gv.w));
    // flow streaks (twin of waterLook.js flowStreakHit): r6 = (streak glyph, L, W, K), r7 = (fhat.xy, |f|, o), r8 = (mode, c.xy, nAng)
    vec4 r6 = uWL[lb + 6], r7 = uWL[lb + 7], r8 = uWL[lb + 8];
    if (r8.x > 0.5) {
      float fa, fib;
      if (r8.x < 1.5) {
        fa = P.x * r7.x + P.y * r7.y;
        fib = floor((-P.x * r7.y + P.y * r7.x) / r6.z);
      } else {
        float ddx = P.x - r8.y, ddy = P.y - r8.z;
        fa = sqrt(ddx * ddx + ddy * ddy);
        fib = min(floor(diamondAngle(ddx, ddy) * 0.25 * r8.w), r8.w - 1.0);
      }
      int ia = int(floor((fa - r7.w) / r6.y));
      uint fh = hashFastU(ia & 1023, int(fib) & 1023, ${WATER_FLOW_SALT});
      if (float(fh >> 8u) * (1.0 / 16777216.0) > r6.w) glyph = r6.x;
    }
    if (float(h >> 8u) * (1.0 / 16777216.0) > 1.0 - r3.w) wc += (r2.rgb - wc) * 0.5;
  }

  vec4 shape = uWL[lb + 10], foam = uWL[lb + 11], rim = uWL[lb + 12], shoreParams = uWL[lb + 13];
  float e;
  if (rim.w > 0.5) {
    float dx = P.x - shape.x, dy = P.y - shape.y;
    e = shape.z - sqrt(dx * dx + dy * dy);
  } else e = min(min(P.x - shape.x, P.y - shape.y), min(shape.z - P.x, shape.w - P.y));
  float shoreS = max(0.0, min(column / shoreParams.x, e / uWL[lb + 9].w));
  bool shore = !isSky && shoreS < 1.0 && dW < shoreParams.y;
  if (shore) {
    int fi = min(int(floor(shoreS * foam.w)), int(foam.w) - 1);
    glyph = fi == 0 ? foam.x : (fi == 1 ? foam.y : foam.z);
    wc = rim.rgb + (wc - rim.rgb) * shoreS;
  }

  // own fog (distance dW x the pitched fog scale)
  float fd = uProjMode == 0 ? dW : dW * fogScaleCell(cell.y, uGrid.y);
  float f = clamp((fd - uWFog[0].x) / (uWFog[0].y - uWFog[0].x), 0.0, 1.0);
  if (f > 0.0 && uWFog[0].z != 1.0) f = pow(f, uWFog[0].z);
  float fBg = min(uWFog[0].w * f, 1.0);
  vec3 fgc = wc + (uWFog[1].rgb + (uWFog[2].rgb - uWFog[1].rgb) * f - wc) * f;
  vec3 bgc = wb + (uWFog[3].rgb + (uWFog[4].rgb - uWFog[3].rgb) * f - wb) * fBg;
  if (!opaque) { // see-through: tint the shaded floor cell by the opacity
    vec3 fgOld = floor(sfg.rgb * 255.0 + 0.5), bgOld = floor(sbg.rgb * 255.0 + 0.5);
    if (!shore) fgc = fgOld + (fgc - fgOld) * a;
    bgc = bgOld + (bgc - bgOld) * a;
  }
  outFg = vec4(toByte01(fgc.r), toByte01(fgc.g), toByte01(fgc.b), toByte01(glyph));
  outBg = vec4(toByte01(bgc.r), toByte01(bgc.g), toByte01(bgc.b), 1.0);
}
`;
