// NIGHT-SKY-01: stars + moon disc on kind-0 (sky) cells. ONE params object; `applySkyNight` is the literal JS twin of the WGSL
// `skyNight` (SKY_NIGHT_WGSL, spliced into shade.wgsl.js next to skyGlow). Stars are hashed per SKY DIRECTION bucket (az/el), not per
// screen cell, so they do not swim when the camera turns. Colours: palette.rgb.moon (#9fb4e0) is the nearest existing key for both the
// moon disc and the stars (no star key exists; design/palette.js untouched).
import { h01 } from './lighting.js';

export const SKY_NIGHT = Object.freeze({
  sunILo: 0.3, sunIHi: 0.7,        // night weight = 1 - smoothstep(sunILo, sunIHi, sunI): night sunI 0.25 -> 1, dusk/day >= 0.8 -> exactly 0
  lumaLo: 50, lumaHi: 130,         // ... times 1 - smoothstep on the sky colour luma (stars fade with the sky LUT at dusk/dawn)
  bucketsPerDeg: 2.2,              // star lattice (~0.45 deg: about one screen cell)
  density: 0.03, zenithBoost: 0.6, // star probability = density * (1 - zenithBoost/2 + zenithBoost * sin(el))
  elevFadeDeg: 3,                  // no stars below the horizon, fade in over this many degrees
  glyphDot: 0.6, glyphPlus: 0.88,  // hash2 < glyphDot -> '.', < glyphPlus -> '+', else '*'
  twinkleHz: 1.5, twinkleSpread: 2, twinkleMin: 0.2, // brightness 0.35+0.65*tw; star hidden when it dips under twinkleMin
  moonRadiusDeg: 3.2, moonEdge: 0.0004, // disc: smoothstep(cosR - edge, cosR + edge, cosA)
  color: Object.freeze([159, 180, 224]),
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const GLYPH_DOT = 46 - 32, GLYPH_PLUS = 43 - 32, GLYPH_STAR = 42 - 32;
const COS_R = Math.cos(SKY_NIGHT.moonRadiusDeg * Math.PI / 180);

export function nightWeight(sunI, luma) {
  return (1 - sm(SKY_NIGHT.sunILo, SKY_NIGHT.sunIHi, sunI)) * (1 - sm(SKY_NIGHT.lumaLo, SKY_NIGHT.lumaHi, luma));
}

/**
 * JS twin of WGSL `skyNight`. bg/fg = [r,g,b] 0..255 (mutated), (dx,dy,dz) unit view dir, (sx,sy,sz) moon/sun dir (what sunFromWorld
 * returns at night = the moon), t seconds. Returns the glyph index (0 = leave the glyph). No allocation. Day: weight 0 -> untouched.
 */
export function applySkyNight(bg, fg, dx, dy, dz, elevDeg, sx, sy, sz, sunI, t) {
  const P = SKY_NIGHT;
  const w = nightWeight(sunI, 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]);
  if (!(w > 0)) return 0;
  const c = P.color;
  const ms = sz < 0 ? -1 : 1; // sun path below the horizon (no moon switch on this path) -> the moon is the mirrored dir
  const cosA = (dx * sx + dy * sy + dz * sz) * ms;
  const m = sm(COS_R - P.moonEdge, COS_R + P.moonEdge, cosA) * w;
  if (m > 0) {
    for (let i = 0; i < 3; i++) { const v = bg[i] + (c[i] - bg[i]) * m; bg[i] = v; fg[i] = v; }
    return 0;
  }
  if (elevDeg <= 0) return 0;
  let az = Math.atan2(dx, -dy) * 180 / Math.PI; if (az < 0) az += 360;
  const a = Math.floor(az * P.bucketsPerDeg), e = Math.floor(elevDeg * P.bucketsPerDeg);
  const thr = P.density * (1 - P.zenithBoost * 0.5 + P.zenithBoost * (dz > 0 ? dz : 0));
  if (!(h01(a, e, 0) < thr)) return 0;
  const h2 = h01(a, e, 1), h3 = h01(a, e, 2);
  const tw = 0.5 + 0.5 * Math.sin(t * (P.twinkleHz + P.twinkleSpread * h3) + 6.2831853 * h2);
  const k = w * sm(0, P.elevFadeDeg, elevDeg) * (0.35 + 0.65 * tw);
  if (k < P.twinkleMin) return 0;
  const kk = k > 0.83 ? 1 : k * 1.2;
  for (let i = 0; i < 3; i++) fg[i] = bg[i] + (c[i] - bg[i]) * kk;
  return h2 < P.glyphDot ? GLYPH_DOT : h2 < P.glyphPlus ? GLYPH_PLUS : GLYPH_STAR;
}

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
/** WGSL twin source (needs skyGlowSm from SKY_GLOW_WGSL above it). xyz = bg, fg returned through `nightFg`, glyph index in the w of the second vec4. */
export const SKY_NIGHT_WGSL = `
struct NightOut { bg: vec3f, fg: vec3f, g: i32 };
fn nightHash(a: u32, b: u32, c: u32) -> f32 {
  var h = (a * 0x27d4eb2du) ^ (b * 0x165667b1u) ^ (c * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}
fn skyNight(bg: vec3f, dir: vec3f, elevDeg: f32, sunDir: vec3f, sunI: f32, t: f32) -> NightOut {
  var o: NightOut; o.bg = bg; o.fg = bg; o.g = 0;
  let luma = 0.2126 * bg.x + 0.7152 * bg.y + 0.0722 * bg.z;
  let w = (1.0 - skyGlowSm(${f(SKY_NIGHT.sunILo)}, ${f(SKY_NIGHT.sunIHi)}, sunI)) * (1.0 - skyGlowSm(${f(SKY_NIGHT.lumaLo)}, ${f(SKY_NIGHT.lumaHi)}, luma));
  if (!(w > 0.0)) { return o; }
  let col = ${`vec3f(${SKY_NIGHT.color.map(f).join(', ')})`};
  let cosA = dot(dir, sunDir); if (sunDir.z < 0.0) { cosA = -cosA; }
  let cosR = cos(radians(${f(SKY_NIGHT.moonRadiusDeg)}));
  let m = skyGlowSm(cosR - ${f(SKY_NIGHT.moonEdge)}, cosR + ${f(SKY_NIGHT.moonEdge)}, cosA) * w;
  if (m > 0.0) { o.bg = bg + (col - bg) * m; o.fg = o.bg; return o; }
  if (elevDeg <= 0.0) { return o; }
  var az = degrees(atan2(dir.x, -dir.y)); if (az < 0.0) { az = az + 360.0; }
  let a = bitcast<u32>(i32(floor(az * ${f(SKY_NIGHT.bucketsPerDeg)})));
  let e = bitcast<u32>(i32(floor(elevDeg * ${f(SKY_NIGHT.bucketsPerDeg)})));
  let thr = ${f(SKY_NIGHT.density)} * (${f(1 - SKY_NIGHT.zenithBoost * 0.5)} + ${f(SKY_NIGHT.zenithBoost)} * max(dir.z, 0.0));
  if (!(nightHash(a, e, 0u) < thr)) { return o; }
  let h2 = nightHash(a, e, 1u); let h3 = nightHash(a, e, 2u);
  let tw = 0.5 + 0.5 * sin(t * (${f(SKY_NIGHT.twinkleHz)} + ${f(SKY_NIGHT.twinkleSpread)} * h3) + 6.2831853 * h2);
  let k = w * skyGlowSm(0.0, ${f(SKY_NIGHT.elevFadeDeg)}, elevDeg) * (0.35 + 0.65 * tw);
  if (k < ${f(SKY_NIGHT.twinkleMin)}) { return o; }
  let kk = select(k * 1.2, 1.0, k > 0.83);
  o.fg = bg + (col - bg) * kk;
  o.g = select(select(${GLYPH_STAR}, ${GLYPH_PLUS}, h2 < ${f(SKY_NIGHT.glyphPlus)}), ${GLYPH_DOT}, h2 < ${f(SKY_NIGHT.glyphDot)});
  return o;
}
`;
