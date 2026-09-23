// US-029 tech notes item 5: `shadeDetailFast` (engine/render/detailShade.js)
// ported line for line to GLSL. Pass 1 of the present hook (architecture.md
// 14.1 section 4): reads fgTex/bgTex (JS layer) + G-buffer + data textures,
// writes MRT shadeFg/shadeBg. `kind==0 || mask` -> passthrough (JS cell wins,
// shadeBg.a = 0); else shaded cell (shadeBg.a = 1.0).
import {
  GLSL_VERSION, PRECISION, GBUF_UNPACK, HASH_FAST, SAMPLE_POW_LUT, BYTE_OUT,
  SMOOTHSTEP_FAST, ORIENT_AND_LINES, LEVEL_FROM_THRESHOLDS,
} from './common.js';
import { MAT_F_WIDTH, MAT_I_WIDTH, SET_I_WIDTH } from '../ShadeTextures.js';

export const SHADE_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out vec4 shadeFg;
layout(location = 1) out vec4 shadeBg;

uniform usampler2D uGI;   // RG32UI
uniform sampler2D uGA;    // RGBA32F: u, v, z, aoD
uniform sampler2D uGD;    // RGBA32F: dudx, dvdx, dudy, dvdy
uniform sampler2D uDepth; // R32F
uniform sampler2D uFgTex; // RGBA8 JS layer in (rt.cells.fg)
uniform sampler2D uBgTex; // RGBA8 JS layer in (rt.cells.bg)

uniform sampler2D uMatF;  // RGBA32F, width ${MAT_F_WIDTH}
uniform isampler2D uMatI; // RGBA32I, width ${MAT_I_WIDTH}
uniform isampler2D uSetI; // RGBA32I, width ${SET_I_WIDTH}

uniform vec3 uLight;
uniform float uTimeSec; // declared, unused (US-028 shading has no time term)
uniform float uCellAspect;
uniform float uCutoff, uLift, uFgMin, uFgMaxGain, uTintK, uOverbright, uOverbrightMax;
uniform float uAoR, uAoK;
uniform float uFaceK[7];
uniform vec3 uFogFg, uFogBg;
uniform float uFogStart, uFogFull, uFogStipple0, uFogStipple1, uFogSparse;
uniform ivec2 uFogSparseCodes, uFogHazeCodes; // .x=alt0 code .y=alt1 code (alt count is fixed 2, see fog.sparseAlt/hazeAlt)
uniform int uFogSparseAlt, uFogHazeAlt;

${GBUF_UNPACK}
${HASH_FAST}
${SAMPLE_POW_LUT}
${BYTE_OUT}
${SMOOTHSTEP_FAST}
${ORIENT_AND_LINES}
${LEVEL_FROM_THRESHOLDS}

const float POW2[6] = float[6](0.125, 0.25, 0.5, 1.0, 2.0, 4.0);

int pickCode(int setId, int entryIdx, float hA, bool useAlt) {
  ivec4 t = texelFetch(uSetI, ivec2(2 + entryIdx, setId), 0);
  int cnt = t.x;
  int idx = useAlt ? min(cnt - 1, int(hA * float(cnt))) : 0;
  uint lo = uint(t.y), hi = uint(t.z);
  uint word = idx < 4 ? lo : hi;
  int shift = (idx < 4 ? idx : idx - 4) * 8;
  return int((word >> uint(shift)) & 0xffu);
}

// Returns glyph code (already ASCII-32) or -1 (caller substitutes space).
int pickGlyphCodeFast(int setId, float gb, float hA, int classIdx, float cutoff) {
  ivec4 t0 = texelFetch(uSetI, ivec2(0, setId), 0);
  ivec4 t1 = texelFetch(uSetI, ivec2(1, setId), 0);
  int oriented = t0.x, levels = t0.z, nDark = t0.w, nFam = t1.y;
  int lv = levelFromThresholds(setId, levels, gb, cutoff);
  if (lv == 0) return -1;
  int entryIdx;
  if (oriented == 0) {
    entryIdx = lv - 1;
  } else if (lv <= nDark) {
    entryIdx = lv - 1;
  } else {
    entryIdx = nDark + classIdx * nFam + (lv - nDark - 1);
  }
  return pickCode(setId, entryIdx, hA, true);
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  uvec2 gi = texelFetch(uGI, cell, 0).xy;
  uint kindU = giKind(gi.y);
  uint maskU = giMask(gi.y);
  vec4 jsFg = texelFetch(uFgTex, cell, 0);
  vec4 jsBg = texelFetch(uBgTex, cell, 0);

  if (kindU == 0u || maskU != 0u) {
    shadeFg = jsFg;
    shadeBg = vec4(jsBg.rgb, 0.0);
    return;
  }

  int matId = int(giMat(gi.y));
  int face = int(giFace(gi.y));
  vec4 ga = texelFetch(uGA, cell, 0);
  vec4 gd = texelFetch(uGD, cell, 0);
  float u = ga.x, v = ga.y, z = ga.z, aoD = ga.w;
  float dudx = gd.x, dvdx = gd.y, dudy = gd.z, dvdy = gd.w;
  float dist = texelFetch(uDepth, cell, 0).r;

  vec4 mf0 = texelFetch(uMatF, ivec2(0, matId), 0);
  vec4 mf1 = texelFetch(uMatF, ivec2(1, matId), 0);
  vec4 mf2 = texelFetch(uMatF, ivec2(2, matId), 0);
  vec4 mf3 = texelFetch(uMatF, ivec2(3, matId), 0);
  vec4 mf4 = texelFetch(uMatF, ivec2(4, matId), 0);
  vec4 mf5 = texelFetch(uMatF, ivec2(5, matId), 0);
  vec4 mf6 = texelFetch(uMatF, ivec2(6, matId), 0);
  vec4 mf7 = texelFetch(uMatF, ivec2(7, matId), 0);
  vec4 mf8 = texelFetch(uMatF, ivec2(8, matId), 0);
  vec4 mf9 = texelFetch(uMatF, ivec2(9, matId), 0);

  ivec4 mi0 = texelFetch(uMatI, ivec2(0, matId), 0);
  ivec4 mi1 = texelFetch(uMatI, ivec2(1, matId), 0);
  ivec4 mi2 = texelFetch(uMatI, ivec2(2, matId), 0);
  ivec4 mi3 = texelFetch(uMatI, ivec2(3, matId), 0);

  int seed = mi0.x, flags = mi0.y;
  bool hasGrid = (flags & 1) != 0, gridTint = (flags & 2) != 0, gridBgK = (flags & 4) != 0;
  bool gridCross = (flags & 8) != 0, gridTie = (flags & 16) != 0, gridLines = (flags & 32) != 0, gridGap = (flags & 64) != 0;
  bool hasBevel = (flags & 128) != 0, hasBand = (flags & 256) != 0, bandIsU = (flags & 512) != 0;
  bool bandTone = (flags & 1024) != 0, bandBgK = (flags & 2048) != 0;
  bool hasOverlay = (flags & 4096) != 0, ovBand = (flags & 8192) != 0, hasSpeckle = (flags & 16384) != 0, hasLod = (flags & 32768) != 0;

  float detail = mf0.z, jitter = mf0.w;
  float albedo = mf0.x, bgK = mf0.y;
  float gu = mf2.y, gv = mf2.z, gstagger = mf2.w;

  float course = 0.0, uo = u, fv = 0.5;
  int bix = 0, courseI = 0;
  if (hasGrid) {
    courseI = int(floor(v / gv));
    course = float(courseI);
    uo = u - ((mod(course, 2.0) != 0.0) ? gstagger * gu : 0.0);
    bix = int(floor(uo / gu));
    fv = v / gv - course;
  }

  float tpcU = abs(dudx) + abs(dudy), tpcV = abs(dvdx) + abs(dvdy);
  float tpc = (tpcU > tpcV ? tpcU : tpcV) * detail;
  int oct = tpc >= 4.0 ? -3 : tpc >= 2.0 ? -2 : tpc >= 1.0 ? -1 : tpc >= 0.5 ? 0 : tpc >= 0.25 ? 1 : 2;
  float ds = detail * POW2[oct + 3];

  int btx = int(floor(u * detail)), bty = int(floor(v * detail));
  float hA, hC;
  if (hasGrid) {
    hA = hashFast(bix, courseI, seed);
    hC = hashFast(bix, courseI, seed + 13);
  } else {
    int cx = int(floor(u * ds * 0.5)), cy = int(floor(v * ds * 0.5));
    hA = hashFast(cx, cy, seed);
    hC = hashFast(cx, cy, seed + 13);
  }
  float hB = hashFast(btx, bty, seed + 7);
  float hBlock = hashFast(bix, courseI, seed + 3);

  // --- tone (per block) ---
  float toneTotal = mf1.y;
  float x = hBlock * toneTotal;
  int nTones = mi0.z;
  int toneIdx = nTones - 1;
  vec3 tone = vec3(0.0);
  for (int t = 0; t < 4; t++) {
    if (t >= nTones) break;
    vec4 mt = texelFetch(uMatF, ivec2(10 + t, matId), 0);
    x -= mt.w;
    if (x < 0.0) { toneIdx = t; tone = mt.rgb; break; }
    tone = mt.rgb; // last one wins if loop exhausts
  }
  vec3 cr = tone;

  int tier = 0;
  if (hasLod) {
    float lodMid = mf1.z, lodFar = mf1.w, lodDither = mf2.x;
    float dd = dist + (hB - 0.5) * lodDither;
    tier = dd < lodMid ? 0 : (dd < lodFar ? 1 : 2);
  }
  int setNear = mi1.x, setMid = mi1.y, setFar = mi1.z;
  int setId = tier == 0 ? setNear : (tier == 1 ? setMid : setFar);

  float shadeK = 1.0, tintAmt = 0.0;
  vec3 tintRGB = vec3(0.0);
  int lineCode = -1;
  bool onJoint = false, inBand = false;

  int bevelGate = mi3.x, bandGate = mi3.y, overlayGate = mi3.z, speckleGate = mi3.w;

  if (hasGrid && hasBevel && tier <= bevelGate) {
    float top = mf5.x, topShade = mf5.y, bottom = mf5.z, bottomShade = mf5.w;
    float yv = fv * gv;
    if (gv - yv < top) shadeK *= topShade;
    else if (yv < bottom) shadeK *= bottomShade;
  }

  if (hasBand) {
    float period = mf6.x, width = mf6.y, bshade = mf6.z, bbgK = mf6.w, edgeShade = mf7.w;
    int bandSetId = mi2.y;
    float bcoord = bandIsU ? u : v;
    float bcx = bandIsU ? dudx : dvdx, bcy = bandIsU ? dudy : dvdy;
    float pos = bcoord - floor(bcoord / period) * period;
    if (pos < width) {
      inBand = true;
      if (tier <= bandGate) setId = bandSetId;
      shadeK = bshade;
      if (bandTone) { cr = mf7.rgb; }
      if (bandBgK) bgK = bbgK;
    }
    float bcov = coverFast(bcx, bcy);
    float bandMult = 1.0;
    bool ok = true;
    if (!(bcov < 0.5 * width)) {
      bandMult = 2.0;
      if (!(bcov < bandMult * 0.5 * width)) {
        bandMult = 4.0;
        if (!(bcov < bandMult * 0.5 * width)) ok = false;
      }
    }
    if (ok) {
      float e0 = crossLineFast(bcoord, bcx, bcy, period, 0.0);
      float e1 = crossLineFast(bcoord, bcx, bcy, period, width);
      float ef = e0 >= 0.0 ? e0 : e1;
      if (ef >= 0.0) { lineCode = lineGlyphCodeFast(bcx, bcy, ef, uCellAspect); shadeK = edgeShade; onJoint = true; }
    }
  }

  if (hasGrid && gridLines && !inBand && !onJoint) {
    float maxCover = mf3.w;
    float coverV = coverFast(dvdx, dvdy);
    float periodH = gv;
    bool okH = true;
    if (!(coverV < maxCover * periodH)) {
      periodH = gv * 2.0;
      if (!(coverV < maxCover * periodH)) {
        periodH = gv * 4.0;
        if (!(coverV < maxCover * periodH)) okH = false;
      }
    }
    float coverU = coverFast(dudx, dudy);
    float periodV = gu;
    bool okV0 = true;
    if (!(coverU < maxCover * periodV)) {
      periodV = gu * 2.0;
      if (!(coverU < maxCover * periodV)) {
        periodV = gu * 4.0;
        if (!(coverU < maxCover * periodV)) okV0 = false;
      }
    }
    bool okV = okV0 && (!gridTie || okH);
    float fh = okH ? crossLineFast(v, dvdx, dvdy, periodH, 0.0) : -1.0;
    float fu = okV ? crossLineFast(uo, dudx, dudy, periodV, 0.0) : -1.0;
    if (fh >= 0.0 || fu >= 0.0) {
      onJoint = true;
      if (gridGap) { setId = mi1.w; lineCode = -1; }
      else if (fh >= 0.0 && fu >= 0.0 && gridCross) lineCode = mi2.x;
      else if (fu >= 0.0) lineCode = lineGlyphCodeFast(dudx, dudy, fu, uCellAspect);
      else lineCode = lineGlyphCodeFast(dvdx, dvdy, fh, uCellAspect);
      shadeK = mf3.x;
      if (gridTint) { tintRGB = mf4.rgb; tintAmt = mf3.y; }
      if (gridBgK) bgK = mf3.z;
    }
  }

  if (hasOverlay && tier <= overlayGate) {
    int ovSetId = mi2.z;
    float ovAmount = mf8.x, ovShade = mf8.y, ovJoint = mf9.x, ovFace = mf9.y;
    float bf = 1.0;
    if (ovBand) {
      float full = mf8.z, zero = mf8.w;
      bf = (z <= full) ? 1.0 : (z >= zero ? 0.0 : 1.0 - (z - full) / (zero - full));
    }
    if (hC < (onJoint ? ovJoint : ovFace) * bf) {
      if (!onJoint) setId = ovSetId;
      int k = mi0.w;
      int tIdx = min(k - 1, int(hA * float(k)));
      vec4 tintTex = texelFetch(uMatF, ivec2(14 + tIdx, matId), 0);
      tintRGB = tintTex.rgb; tintAmt = ovAmount;
      shadeK *= ovShade;
    }
  }
  if (hasSpeckle && tier <= speckleGate && !onJoint && !inBand) {
    float chance = mf9.z, sshade = mf9.w;
    if (hC > 1.0 - chance) {
      setId = mi2.w;
      shadeK *= sshade;
    }
  }

  float Lm = max(uLight.r, max(uLight.g, uLight.b));
  float fk = (face >= 1 && face <= 6) ? uFaceK[face] : 1.0;
  float aok = 1.0;
  if (aoD < uAoR) aok = uAoK + (1.0 - uAoK) * smoothstepFast(0.0, uAoR, aoD);
  float jit = 1.0 + jitter * (hA * 2.0 - 1.0);
  float b = Lm * albedo * shadeK * fk * aok * jit + mf1.x;
  float gb = b < uCutoff ? 0.0 : uLift + (1.0 - uLift) * min(b, 1.0);

  float f = dist <= uFogStart ? 0.0 : (dist >= uFogFull ? 1.0 : (dist - uFogStart) / (uFogFull - uFogStart));

  int glyphCode;
  if (gb <= 0.0) glyphCode = 0;
  else if (lineCode >= 0) glyphCode = lineCode;
  else {
    ivec4 t0 = texelFetch(uSetI, ivec2(0, setId), 0);
    int oriented = t0.x, orientAxis = t0.y;
    int classIdx = oriented != 0 ? orientClassCode(orientAxis == 0 ? dudx : dvdx, orientAxis == 0 ? dudy : dvdy, uCellAspect) : 0;
    int code = pickGlyphCodeFast(setId, gb, hA, classIdx, uCutoff);
    glyphCode = code < 0 ? 0 : code;
  }
  if (f > uFogStipple0 && hB < smoothstepFast(uFogStipple0, uFogStipple1, f)) {
    bool sparse = f > uFogSparse;
    int cnt = sparse ? uFogSparseAlt : uFogHazeAlt;
    int idx = min(cnt - 1, int(hA * float(cnt)));
    ivec2 codes = sparse ? uFogSparseCodes : uFogHazeCodes;
    glyphCode = idx == 0 ? codes.x : codes.y;
  }

  if (tintAmt > 0.0) cr += (tintRGB - cr) * tintAmt;
  vec3 hcol = Lm > 1e-6 ? uLight / Lm : vec3(1.0);
  float bc = max(b, 0.0);
  float gain = uFgMin + (1.0 - uFgMin) * samplePowLUT(bc);
  if (bc > 1.0) gain = min(uFgMaxGain, gain + (bc - 1.0) * 0.5);
  vec3 rgbF = cr * (1.0 + (hcol - 1.0) * uTintK) * gain;
  if (bc > 1.0) {
    float hot = min(uOverbrightMax, (bc - 1.0) * uOverbright);
    rgbF += (255.0 * (0.5 + 0.5 * hcol) - rgbF) * hot;
  }
  rgbF = clamp(rgbF, 0.0, 255.0);
  vec3 rgbBg = rgbF * bgK;
  if (f > 0.0) {
    rgbF += (uFogFg - rgbF) * f;
    rgbBg += (uFogBg - rgbBg) * f;
  }

  shadeFg = vec4(toByte01(rgbF.r), toByte01(rgbF.g), toByte01(rgbF.b), toByte01(float(glyphCode)));
  shadeBg = vec4(toByte01(rgbBg.r), toByte01(rgbBg.g), toByte01(rgbBg.b), 1.0);
}
`;
