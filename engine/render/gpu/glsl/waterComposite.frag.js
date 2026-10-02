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
import { WL_STRIDE, WL_SLOTS, WATER_HASH_SALT } from '../../waterLook.js';

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
  float opaqueAt = r0.w, seeThrough = r1.w, waveHz = r2.w, bgK = r3.y;
  int nGlyph = int(r3.x);
  float a = isSky ? 1.0 : clamp((raw - dW) / opaqueAt, 0.0, 1.0);

  vec3 P;
  if (uProjMode == 0) P = cellRayP(vec2(cell), uGrid, uPosX, uPosY, uEyeH, uDirX, uDirY, uPlaneX, uPlaneY, uHorizonRow, uPlaneDistY, dW);
  else P = cellRayPitched(vec2(cell), uGrid, vec3(uPosX, uPosY, uEyeH), uPitchA.xyz, uPitchB.xy, vec3(uPitchB.zw, uPitchC.x), vec2(uPitchA.w, uPitchC.y), dW);

  // sun on an up normal, the terrain 'b' formula (the cell's own sun-map bits when the map ran)
  uvec4 lightT = texelFetch(uLightTex, cell, 0);
  float sunF = uSunMapOn != 0 ? float((lightT.w >> ${SUN_N_SHIFT}u) & ${SUN_N_MASK}u) * 0.25 : 1.0;
  float k = uAmbientI + uSunI * max(uSunDir.z, 0.0) * sunF;
  vec3 wc = clamp((r0.rgb + (r1.rgb - r0.rgb) * a) * k, 0.0, 255.0);

  bool opaque = a >= seeThrough;
  float glyph = floor(sfg.a * 255.0 + 0.5);
  if (opaque) {
    int tick = int(floor(uTimeSec * waveHz));
    uint h = hashFastU(int(floor(P.x / 0.5)), int(floor(P.y / 0.5)), ${WATER_HASH_SALT} + 31 * tick);
    int gi = int(h % uint(nGlyph));
    vec4 gv = uWL[lb + 4 + (gi >> 2)];
    int gc = gi & 3;
    glyph = gc == 0 ? gv.x : (gc == 1 ? gv.y : (gc == 2 ? gv.z : gv.w));
    if (float(h >> 8u) * (1.0 / 16777216.0) > 0.9) wc += (r2.rgb - wc) * 0.5;
  }

  // own fog (distance dW x the pitched fog scale)
  float fd = uProjMode == 0 ? dW : dW * fogScaleCell(cell.y, uGrid.y);
  float f = clamp((fd - uWFog[0].x) / (uWFog[0].y - uWFog[0].x), 0.0, 1.0);
  if (f > 0.0 && uWFog[0].z != 1.0) f = pow(f, uWFog[0].z);
  float fBg = min(uWFog[0].w * f, 1.0);
  vec3 fgc = wc + (uWFog[1].rgb + (uWFog[2].rgb - uWFog[1].rgb) * f - wc) * f;
  vec3 wb = wc * bgK;
  vec3 bgc = wb + (uWFog[3].rgb + (uWFog[4].rgb - uWFog[3].rgb) * f - wb) * fBg;
  if (!opaque) { // see-through: tint the shaded floor cell by the opacity
    vec3 fgOld = floor(sfg.rgb * 255.0 + 0.5), bgOld = floor(sbg.rgb * 255.0 + 0.5);
    fgc = fgOld + (fgc - fgOld) * a;
    bgc = bgOld + (bgc - bgOld) * a;
  }
  outFg = vec4(toByte01(fgc.r), toByte01(fgc.g), toByte01(fgc.b), toByte01(glyph));
  outBg = vec4(toByte01(bgc.r), toByte01(bgc.g), toByte01(bgc.b), 1.0);
}
`;
