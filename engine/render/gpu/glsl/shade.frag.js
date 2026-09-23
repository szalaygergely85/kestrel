// US-029/US-030b tech notes: 'shadeDetailFast' (engine/render/detailShade.js)
// ported to GLSL, then (US-030b, docs/architecture.md 14.2 item 3) split into
// 'shadeCore' (everything that depends on a single sub-sample's own u/v/z/
// aoD - runs once per sub-sample of the resolved winner group) and the tail
// in main() (level pick, glyph pick, byte quantisation - runs once per cell,
// on the GROUP AVERAGE of shadeCore's continuous outputs: brightness b/gb,
// tone rgb, bgK - see the architect review note below for hA/hB and the
// structural picks, which are NOT averaged). This is the anti-shimmer fix:
// with n=1 there is exactly one matching sub-sample and the average is the
// value itself - bit-identical to the pre-030b combined shader (parity-safe).
//
// Architect review 1 items 3/4 (superseding the original deviation note
// below): the STRUCTURAL picks are not averaged, but they are no longer all
// "nearest-centre, unconditionally" either.
//   - `hA`/`hB` (item 3): these are discrete per-brick/per-cell dice
//     (`hashFast`), used to pick the glyph alternate and the fog-stipple.
//     Averaging them across sub-samples re-rolled the dice on every sub-
//     sample that crossed a brick boundary (n^2 events per crossing instead
//     of 1) - a flicker source n=2 added over n=1. They now come from the
//     single sub-sample nearest the cell centre, exactly like `setId`.
//   - Joint/band lines (item 4): `onJoint` is now a MAJORITY vote
//     (`2*jointN >= count`) over the resolved winner's own sub-sample group,
//     not a nearest-centre pick - a single off-centre sub-sample can no
//     longer flip a whole cell's line on or off by itself. When the vote
//     says "line", `lineCode` comes from the nearest-centre ON-JOINT member
//     and the final colour is dimmed by agreement (`jointN/count`, item 4)
//     to fade a barely-there line instead of hard-cutting it. When the vote
//     says "no line", the glyph pick uses `setId` from the nearest-centre
//     NON-joint member (a joint member's `setId` may have been overridden,
//     e.g. `gridGap`, and doesn't apply once the line itself doesn't fire).
//     `cov` (`GI.y`, resolve pass) measures SURFACE agreement, not joint
//     agreement, and is deliberately not the lever here (item 4) - it stays
//     written and unconsumed, for the edge pass/US-016.
// Only the CONTINUOUS outputs (`b`/`gb`/tone rgb/`bgK`) are still averaged.
import {
  GLSL_VERSION, PRECISION, GBUF_UNPACK, HASH_FAST, SAMPLE_POW_LUT, BYTE_OUT,
  SMOOTHSTEP_FAST, QFLOOR, ORIENT_AND_LINES, LEVEL_FROM_THRESHOLDS, SKY_LUT_N,
} from './common.js';
import { MAT_F_WIDTH, MAT_I_WIDTH, SET_I_WIDTH } from '../ShadeTextures.js';

export const MAX_SUB = 16; // 4x4, matches resolve.frag.js's cap

export const SHADE_FRAG_SRC = `${GLSL_VERSION}${PRECISION}
layout(location = 0) out vec4 shadeFg;
layout(location = 1) out vec4 shadeBg;

uniform usampler2D uGI;   // RG32UI - resolved, per-cell
uniform usampler2D uGA;    // RGBA32UI: floatBitsToUint(u, v, z, aoD) - resolved (nearest-centre winner sample)
uniform usampler2D uGD;    // RGBA32UI: floatBitsToUint(dudx, dvdx, dudy, dvdy) - resolved, shared over a cell's sub-samples
uniform usampler2D uDepth; // R32UI: floatBitsToUint(dist) - resolved
// US-030b: the SUB-sample G-buffer (14.2 item 3), read here to average
// shadeCore's continuous outputs over the resolved winner's own group.
uniform usampler2D uSGI;
uniform usampler2D uSGA;
uniform int uN; // rays per axis (1..4) - 1 on the legacy 'upload' test source
uniform sampler2D uFgTex; // RGBA8 JS layer in (rt.cells.fg)
uniform sampler2D uBgTex; // RGBA8 JS layer in (rt.cells.bg)
// US-030a GPU sky (14.2 item 3, documented simplification - see
// GpuCellPipeline.js's '_bakeSkyLUT'): flat gradient LUT, no clouds.
uniform sampler2D uSky; // RGBA32F, SKY_LUT_N x 1 - baked bg gradient (0..255 range), by elevation
uniform float uSkyElevTop;
uniform int uGpuSky; // 1 = DDA path (shade kind==0 here); 0 = legacy passthrough (JS fillSky already ran)
uniform float uHorizonRow, uPlaneDistY;

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
${QFLOOR}
${ORIENT_AND_LINES}
${LEVEL_FROM_THRESHOLDS}

const int MAX_SUB = ${MAX_SUB};
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

// --- shadeCore (14.2 item 3): everything that depends on THIS sub-sample's
// own u/v/z/aoD, up to (but excluding) the discrete glyph pick and the
// gain/hue/overbright/fog/byte-quantise tail - those run once per CELL in
// main(), on the group average of this function's continuous outputs.
struct Core {
  float b, gb, cr, cg, cb, bgK, hA, hB;
  bool onJoint;
  int lineCode, setId;
};

Core shadeCore(float u, float v, float z, float aoD,
    float dudx, float dvdx, float dudy, float dvdy, float dist, int face, int matId) {
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
    courseI = int(qfloor(v / gv));
    course = float(courseI);
    uo = u - ((mod(course, 2.0) != 0.0) ? gstagger * gu : 0.0);
    bix = int(qfloor(uo / gu));
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
    float pos = bcoord - qfloor(bcoord / period) * period;
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

  if (tintAmt > 0.0) cr += (tintRGB - cr) * tintAmt;

  Core c;
  c.b = b; c.gb = gb; c.cr = cr.r; c.cg = cr.g; c.cb = cr.b; c.bgK = bgK;
  c.hA = hA; c.hB = hB; c.onJoint = onJoint; c.lineCode = lineCode; c.setId = setId;
  return c;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  uvec2 gi = texelFetch(uGI, cell, 0).xy;
  uint kindU = giKind(gi.y);
  uint maskU = giMask(gi.y);
  vec4 jsFg = texelFetch(uFgTex, cell, 0);
  vec4 jsBg = texelFetch(uBgTex, cell, 0);

  if (kindU == 0u) {
    // US-030a: on the DDA path ('uGpuSky'), 'fillSky' never runs (14.2 item
    // 3) - a masked-over-sky cell (HUD over open sky) still passes through
    // to the JS layer; an un-masked one gets the baked flat-gradient sky.
    if (uGpuSky != 0 && maskU == 0u) {
      float elevDeg = degrees(atan(uHorizonRow - float(cell.y), uPlaneDistY));
      float t = clamp(elevDeg / uSkyElevTop, 0.0, 1.0);
      int idx = int(t * ${SKY_LUT_N - 1}.0 + 0.5);
      vec3 col255 = texelFetch(uSky, ivec2(idx, 0), 0).rgb;
      shadeFg = vec4(toByte01(col255.r), toByte01(col255.g), toByte01(col255.b), 0.0);
      shadeBg = vec4(toByte01(col255.r), toByte01(col255.g), toByte01(col255.b), 1.0);
    } else {
      shadeFg = jsFg;
      shadeBg = vec4(jsBg.rgb, 0.0);
    }
    return;
  }
  if (maskU != 0u) {
    shadeFg = jsFg;
    shadeBg = vec4(jsBg.rgb, 0.0);
    return;
  }

  int matId = int(giMat(gi.y));
  int face = int(giFace(gi.y));
  int pidResolved = int(gi.x);
  uvec4 gdU = texelFetch(uGD, cell, 0);
  vec4 gd = vec4(uintBitsToFloat(gdU.x), uintBitsToFloat(gdU.y), uintBitsToFloat(gdU.z), uintBitsToFloat(gdU.w));
  float dudx = gd.x, dvdx = gd.y, dudy = gd.z, dvdy = gd.w;
  float dist = uintBitsToFloat(texelFetch(uDepth, cell, 0).r);

  // US-030b (14.2 item 3, pass D): average shadeCore's continuous outputs
  // over the resolved winner's own sub-sample group (matched by the same
  // (kind, planeId, mat) key the resolve pass voted on); the structural
  // picks (setId/onJoint/lineCode) come from the group member nearest the
  // cell centre (same tie rule as resolve.frag.js).
  float bSum = 0.0, gbSum = 0.0, crSum = 0.0, cgSum = 0.0, cbSum = 0.0, bgKSum = 0.0;
  int count = 0, jointN = 0;
  // Item 3: hA/hB are discrete dice, taken from the single sub-sample
  // nearest the cell centre (any member - matches the original "nearest
  // overall" tie rule), never averaged.
  float bestMag = 1.0e30, hAW = 0.0, hBW = 0.0;
  // Item 4: setId/lineCode split by joint membership - the nearest ON-JOINT
  // member (used if the majority vote below says "line") and the nearest
  // NON-joint member (the glyph-pick fallback if it doesn't).
  float bestJointMag = 1.0e30, bestNonJointMag = 1.0e30;
  int onJointSetW = 0, onJointLineW = -1, nonJointSetW = 0;

  for (int j = 0; j < 4; j++) {
    if (j >= uN) break;
    for (int i = 0; i < 4; i++) {
      if (i >= uN) break;
      ivec2 sc = ivec2(cell.x * uN + i, cell.y * uN + j);
      uvec2 sgiFull = texelFetch(uSGI, sc, 0).xy;
      if (giKind(sgiFull.y) != kindU) continue;
      if (int(sgiFull.x) != pidResolved) continue;
      if (giMat(sgiFull.y) != uint(matId)) continue;

      uvec4 sgaU = texelFetch(uSGA, sc, 0);
      float uA = uintBitsToFloat(sgaU.x), vA = uintBitsToFloat(sgaU.y);
      float zA = uintBitsToFloat(sgaU.z), aoDA = uintBitsToFloat(sgaU.w);

      Core c = shadeCore(uA, vA, zA, aoDA, dudx, dvdx, dudy, dvdy, dist, face, matId);
      bSum += c.b; gbSum += c.gb; crSum += c.cr; cgSum += c.cg; cbSum += c.cb; bgKSum += c.bgK;
      count++;
      if (c.onJoint) jointN++;

      float ox = (float(i) + 0.5) / float(uN) - 0.5;
      float oy = (float(j) + 0.5) / float(uN) - 0.5;
      float mag = ox * ox + oy * oy;
      if (mag < bestMag) { bestMag = mag; hAW = c.hA; hBW = c.hB; }
      if (c.onJoint) {
        if (mag < bestJointMag) { bestJointMag = mag; onJointSetW = c.setId; onJointLineW = c.lineCode; }
      } else {
        if (mag < bestNonJointMag) { bestNonJointMag = mag; nonJointSetW = c.setId; }
      }
    }
  }
  if (count == 0) {
    // Safety net only: resolve's winner key is derived from these same
    // textures, so at least one sub-sample must match by construction.
    shadeFg = jsFg;
    shadeBg = vec4(jsBg.rgb, 0.0);
    return;
  }

  // Item 4: majority vote - a line only fires when at least half the
  // matching sub-samples call it a joint (ties at 2x2 -> line, the
  // pre-existing nearest-centre behaviour). nonJointSetW is guaranteed
  // populated whenever the vote loses (jointN < count implies count-jointN
  // > 0 in that branch).
  bool lineWins = 2 * jointN >= count;

  float invCount = 1.0 / float(count);
  float bAvg = bSum * invCount, gbAvg = gbSum * invCount;
  float crAvg = crSum * invCount, cgAvg = cgSum * invCount, cbAvg = cbSum * invCount;
  float bgKAvg = bgKSum * invCount;
  float hAAvg = hAW, hBAvg = hBW;

  float f = dist <= uFogStart ? 0.0 : (dist >= uFogFull ? 1.0 : (dist - uFogStart) / (uFogFull - uFogStart));

  int glyphCode;
  if (gbAvg <= 0.0) glyphCode = 0;
  else if (lineWins && onJointLineW >= 0) glyphCode = onJointLineW;
  else {
    // Either the vote said "no line", or it said "line" but the winning
    // on-joint member itself draws no line glyph (e.g. gridGap, whose
    // setId it already redirected) - either way fall through to the
    // ordinary glyph pick, with the appropriate member's setId.
    int setIdPick = lineWins ? onJointSetW : nonJointSetW;
    ivec4 t0 = texelFetch(uSetI, ivec2(0, setIdPick), 0);
    int oriented = t0.x, orientAxis = t0.y;
    int classIdx = oriented != 0 ? orientClassCode(orientAxis == 0 ? dudx : dvdx, orientAxis == 0 ? dudy : dvdy, uCellAspect) : 0;
    int code = pickGlyphCodeFast(setIdPick, gbAvg, hAAvg, classIdx, uCutoff);
    glyphCode = code < 0 ? 0 : code;
  }
  if (f > uFogStipple0 && hBAvg < smoothstepFast(uFogStipple0, uFogStipple1, f)) {
    bool sparse = f > uFogSparse;
    int cnt = sparse ? uFogSparseAlt : uFogHazeAlt;
    int idx = min(cnt - 1, int(hAAvg * float(cnt)));
    ivec2 codes = sparse ? uFogSparseCodes : uFogHazeCodes;
    glyphCode = idx == 0 ? codes.x : codes.y;
  }

  float Lm = max(uLight.r, max(uLight.g, uLight.b));
  vec3 hcol = Lm > 1e-6 ? uLight / Lm : vec3(1.0);
  float bc = max(bAvg, 0.0);
  float gain = uFgMin + (1.0 - uFgMin) * samplePowLUT(bc);
  if (bc > 1.0) gain = min(uFgMaxGain, gain + (bc - 1.0) * 0.5);
  vec3 rgbF = vec3(crAvg, cgAvg, cbAvg) * (1.0 + (hcol - 1.0) * uTintK) * gain;
  if (bc > 1.0) {
    float hot = min(uOverbrightMax, (bc - 1.0) * uOverbright);
    rgbF += (255.0 * (0.5 + 0.5 * hcol) - rgbF) * hot;
  }
  rgbF = clamp(rgbF, 0.0, 255.0);
  // Item 4: dim a firing line by sub-sample agreement (a bare 2-of-4 tie
  // fades to half strength, 4-of-4 stays full) instead of a hard on/off cut
  // at the vote threshold - cov is deliberately not used here (it measures
  // surface, not joint, agreement).
  if (lineWins) rgbF *= 0.5 + 0.5 * float(jointN) / float(count);
  vec3 rgbBg = rgbF * bgKAvg;
  if (f > 0.0) {
    rgbF += (uFogFg - rgbF) * f;
    rgbBg += (uFogBg - rgbBg) * f;
  }

  shadeFg = vec4(toByte01(rgbF.r), toByte01(rgbF.g), toByte01(rgbF.b), toByte01(float(glyphCode)));
  shadeBg = vec4(toByte01(rgbBg.r), toByte01(rgbBg.g), toByte01(rgbBg.b), 1.0);
}
`;
