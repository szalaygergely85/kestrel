// US-029 tech notes item 5/11: GLSL source shared by shade.frag.js and
// edge.frag.js. Template strings only (no gl calls) - Node-testable by
// `glsl.test.js` as plain source-string checks (five hash constants present,
// '1.18'/'0.35' present, no `gl_FragCoord` outside the address line, no
// `round(`).
//
// Numeric rules (architecture.md 14.1 section 5): `uint` arithmetic only for
// hashes (GLSL `uint*uint` wraps exactly like `Math.imul` unsigned); byte
// output is `floor(v + 0.5) / 255.0`; LUT sampling is
// `int(clamp(x,0,1) * float(size-1) + 0.5)`.

export const GLSL_VERSION = '#version 300 es\n';

export const PRECISION = `
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp isampler2D;
`;

// GBuffer field layout (architecture.md 14.1 section 2): GI.y bit packing.
export const GBUF_UNPACK = `
// GI.x = planeId (uint bit-cast, compared for equality only).
// GI.y = kind | face<<8 | mask<<12 | mat<<16
uint giKind(uint y) { return y & 0xffu; }
uint giFace(uint y) { return (y >> 8u) & 0xfu; }
uint giMask(uint y) { return (y >> 12u) & 0xfu; }
uint giMat(uint y)  { return (y >> 16u) & 0xffffu; }
`;

// hashFast: bit-exact `uint` port of engine/render/detailShade.js's
// `hashFast` (tech notes item 5). `uint(int)` for signed inputs equals
// JS `x|0` reinterpreted as the uint bit pattern.
export const HASH_FAST = `
uint hashFastU(int x, int y, int s) {
  uint h = uint(x) * 0x27d4eb2du ^ uint(y) * 0x165667b1u ^ uint(s) * 0x9e3779b1u;
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  h ^= h >> 16u;
  return h;
}
// The uint->float conversion via >>8 is exact (24 significant bits fit a
// float32 mantissa) - no driver-dependent rounding (tech notes item 5).
float hashFast(int x, int y, int s) {
  return float(hashFastU(x, y, s) >> 8u) * (1.0 / 16777216.0);
}
`;

export const SAMPLE_POW_LUT = `
uniform sampler2D uGain; // R32F, 256x1 - table.gainLUT
float samplePowLUT(float x) {
  float xc = clamp(x, 0.0, 1.0);
  int idx = int(xc * 255.0 + 0.5);
  return texelFetch(uGain, ivec2(idx, 0), 0).r;
}
`;

export const BYTE_OUT = `
// Byte output: floor(v+0.5)/255 (matches Math.round for non-negatives);
// never rely on the GL unorm write path or GLSL round().
float toByte01(float v255) { return floor(clamp(v255, 0.0, 255.0) + 0.5) / 255.0; }
`;

export const SMOOTHSTEP_FAST = `
float smoothstepFast(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
float coverFast(float cx, float cy) { return abs(cx) + abs(cy); }
`;

// US-029 ARCH CHANGES item 5 (2026-09-23): f32 GLSL `floor(v/g.v)` disagrees
// with f64 JS `Math.floor` at a course boundary (e.g. v=2.8 on brick-wall
// tops: JS gives course 6, f32 GLSL gives 7), diverging the block hash/tone/
// tint. `qfloor` nudges by a tiny epsilon before flooring so both languages
// land on the same side of the boundary; used for course/fv, bix, band
// `pos` and `crossLine`'s `k` (JS: engine/render/detailShade.js, GLSL: here
// + shade.frag.js). Declared before ORIENT_AND_LINES, which calls it.
export const QFLOOR = `
float qfloor(float x) { return floor(x + (1.0 / 256.0)); }
`;

// orientClassFast / crossLineFast / lineGlyphCodeFast - engine copies
// (detailShade.js), same TAN22/TAN68 constants.
export const ORIENT_AND_LINES = `
const float TAN22 = 0.40403; // tan(22 deg)
const float TAN68 = 2.47509; // tan(68 deg)

int orientClassCode(float cx, float cy, float cellAspect) {
  float gy = cy / cellAspect;
  float dx = -gy, dy = cx;
  if (dx == 0.0 && dy == 0.0) return 0;
  float adx = abs(dx), ady = abs(dy);
  if (ady <= TAN22 * adx) return 0;
  if (ady >= TAN68 * adx) return 1;
  return (dx * dy > 0.0) ? 3 : 2;
}

// Returns fraction in [0,1] or -1.0 if no line crosses this cell's footprint.
float crossLineFast(float c, float cx, float cy, float period, float offset) {
  float hw = 0.5 * (abs(cx) + abs(cy));
  if (!(hw > 1e-7)) hw = 1e-7;
  float k = qfloor((c + hw - offset) / period);
  float line = offset + k * period;
  if (line < c - hw) return -1.0;
  float fr = (abs(cy) > 1e-9) ? (0.5 + (line - c) / cy) : 0.5;
  return clamp(fr, 0.0, 1.0);
}

const int LINE_DASH = 45 - 32, LINE_UNDERSCORE = 95 - 32, LINE_PIPE = 124 - 32, LINE_SLASH = 47 - 32, LINE_BACKSLASH = 92 - 32;
int lineGlyphCodeFast(float cx, float cy, float fr, float cellAspect) {
  int k = orientClassCode(cx, cy, cellAspect);
  if (k == 0) return fr >= 0.5 ? LINE_UNDERSCORE : LINE_DASH;
  return k == 1 ? LINE_PIPE : (k == 2 ? LINE_SLASH : LINE_BACKSLASH);
}
`;

import { MAX_LEVELS } from '../ShadeTextures.js';

export const LEVEL_FROM_THRESHOLDS = `
// SET_F: R32F, width 32, row = set id, texel k = thresholds[k].
uniform sampler2D uSetF;
int levelFromThresholds(int setId, int levels, float gb, float cutoff) {
  if (!(gb >= cutoff)) return 0;
  int i = 0;
  for (int k = 1; k < ${MAX_LEVELS}; k++) {
    if (k >= levels) break;
    float t = texelFetch(uSetF, ivec2(k, setId), 0).r;
    if (t <= gb) i = k; else break;
  }
  return 1 + i;
}
`;
