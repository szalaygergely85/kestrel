// CLOUD-FLUFF-01b: WGSL twin of sky.js `cloudAt` + `cloudSunTerms` (GPU sky had no clouds). The JS twin is the oracle;
// same noise (hashFast value noise, period 256), dome profile, glyph ramp, night/moon/rim terms. Reads the ShadeU cloud*
// words (shade.wgsl.js SHADE_FIELDS, written per frame by passShade.js from look.clouds + cloudDriftOffset).
// Spliced into shade.wgsl.js next to SKY_NIGHT_WGSL. Needs hashFast (HASH_FAST_WGSL) and `su`.
import { CLOUD_RAMP, CLOUD_DOME_LIT, CLOUD_NIGHT_DIM, CLOUD_MOON_MIX, CLOUD_RIM } from './sky.js';

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const MOON = [159, 180, 224]; // = sky.js CLOUD_MOON
// glyph atlas index (ascii - 32) per ramp slot
const RAMP_GI = Array.from(CLOUD_RAMP, (c) => c.charCodeAt(0) - 32);

export const SKY_CLOUD_WGSL = `
struct CloudOut { bg: vec3f, fg: vec3f, g: i32 };
fn cloudSm(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn cloudNoise(x: f32, y: f32, seed: i32) -> f32 {
  let x0 = floor(x); let y0 = floor(y);
  let ix = i32(x0); let iy = i32(y0);
  let fx = x - x0; let fy = y - y0;
  let v00 = hashFast(ix & 255, iy & 255, seed);
  let v10 = hashFast((ix + 1) & 255, iy & 255, seed);
  let v01 = hashFast(ix & 255, (iy + 1) & 255, seed);
  let v11 = hashFast((ix + 1) & 255, (iy + 1) & 255, seed);
  let sx = fx * fx * (3.0 - 2.0 * fx); let sy = fy * fy * (3.0 - 2.0 * fy);
  return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v11 - v10 - v01 + v00) * sx * sy;
}
// base = gradient colour (0..255), dir = unit view dir, sunI = su.sunI (day/rim weights as cloudSunTerms)
fn skyCloud(base: vec3f, dir: vec3f, elevDeg: f32, sunI: f32) -> CloudOut {
  var o: CloudOut; o.bg = base; o.fg = base; o.g = 0;
  let seed = i32(su.cloudA.y); let scale = su.cloudA.z; let bias = su.cloudA.w;
  let cover = su.cloudB.x; let puffK = su.cloudB.y; let wispCover = su.cloudB.z; let wispK = su.cloudB.w;
  let litK = su.cloudC.x; let litDy = su.cloudC.y; let bodyK = su.cloudC.z;
  let off = su.cloudD.xy;
  let band = cloudSm(0.0, su.cloudD.z, elevDeg) * (1.0 - cloudSm(su.cloudD.w, su.cloudE.x, elevDeg));
  if (!(band > 0.0)) { return o; }
  let bx = (dir.x / (dir.z + bias)) * scale; let by = (dir.y / (dir.z + bias)) * scale;
  let qx = bx + off.x; let qy = by + off.y;
  let puff = cloudNoise(qx, qy, seed) * 0.65 + cloudNoise(qx * 2.0 + 17.0, qy * 2.0 + 17.0, seed) * 0.35;
  let wisp = cloudNoise((qx - off.x) * 0.33 * 1.7 + off.x + 41.0, (qy - off.y) * 1.7 + off.y * 2.0 + 41.0, seed);
  let h = clamp((puff - cover) * puffK, 0.0, 1.0);
  let r = sqrt(1.0 - (1.0 - h) * (1.0 - h));
  let dn = clamp(max(r, (wisp - wispCover) * wispK * 0.55) * band, 0.0, 1.0);
  if (!(dn > 0.04)) { return o; }
  let lit0 = clamp(0.5 + (cloudNoise(bx * (1.0 + litDy) + off.x, by * (1.0 + litDy) + off.y, seed)
    - cloudNoise(bx * (1.0 - litDy) + off.x, by * (1.0 - litDy) + off.y, seed)) * litK, 0.0, 1.0);
  let lit = clamp(lit0 + (r - 0.5) * ${f(CLOUD_DOME_LIT)}, 0.0, 1.0);
  let dayK = cloudSm(0.3, 0.7, sunI);
  let rimK = cloudSm(0.3, 0.55, sunI) * (1.0 - cloudSm(0.65, 0.95, sunI));
  let nm = 1.0 - dayK; let dim = 1.0 - nm * ${f(CLOUD_NIGHT_DIM)}; let mk = nm * ${f(CLOUD_MOON_MIX)};
  let moon = vec3f(${MOON.map(f).join(', ')});
  let litC0 = su.cloudLit.xyz * dim; let shC0 = su.cloudShade.xyz * dim;
  let litC = litC0 + (moon - litC0) * mk;
  let shC = shC0 + (moon * 0.5 - shC0) * mk;
  let cc = shC + (litC - shC) * lit;
  let body = min(dn * bodyK, 1.0);
  o.bg = base + (cc - base) * body;
  let fgh = cc + (vec3f(255.0) - cc) * (0.1 * lit);
  let rim = rimK * (1.0 - r) * ${f(CLOUD_RIM)};
  o.fg = fgh + (litC * 1.12 - fgh) * rim;
  var ramp = array<i32, ${RAMP_GI.length}>(${RAMP_GI.join(', ')});
  let idx = min(1 + i32(floor(dn * ${f(CLOUD_RAMP.length - 1.01)})), ${CLOUD_RAMP.length - 1});
  o.g = ramp[idx];
  return o;
}
`;
