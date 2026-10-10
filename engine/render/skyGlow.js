// AUD-40: sun glow + horizon haze added to the flat sky gradient. ONE params object; the WGSL snippet (shade.wgsl.js) is generated
// from it and `applySkyGlow` is its literal JS twin (D-039), used by sky.js fillSky. Colours are 0..255, added before the cell
// is written, so the sky still goes through the usual byte quantisation; the glow is also posterised (steps) for the ASCII look.
export const SKY_GLOW = Object.freeze({
  haloK: 6, haloGain: 0.30,        // wide halo: pow(cosA, haloK)
  coreK: 220, coreGain: 0.55,      // small bright core: pow(cosA, coreK)
  tint: Object.freeze([255, 205, 130]), // warm glow colour (0..255)
  steps: 14,                       // posterise the glow strength
  sunFadeLo: -0.05, sunFadeHi: 0.12, // smoothstep on sunDir.z: glow vanishes with the sun below the horizon
  hazeTopDeg: 9,                   // haze fades out above this elevation
  hazeLift: 0.22,                  // multiplicative lighten of the gradient colour at the horizon
  hazeWarm: Object.freeze([34, 22, 8]), // warm add at the horizon, scaled by the sun strength
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Sun strength 0..1 from the time-of-day sun intensity and sun height (sunDir.z). */
export function skyGlowStrength(sunZ, sunI) {
  return clamp01(sunI) * smooth(SKY_GLOW.sunFadeLo, SKY_GLOW.sunFadeHi, sunZ);
}

/**
 * JS twin of the WGSL `skyGlow`. rgb = [r,g,b] 0..255 (mutated). cosA = dot(rayDir, sunDir), elevDeg = ray elevation.
 * No allocation.
 */
export function applySkyGlow(rgb, cosA, elevDeg, sunZ, sunI) {
  const P = SKY_GLOW, s = skyGlowStrength(sunZ, sunI);
  const c = cosA > 0 ? cosA : 0;
  let g = (Math.pow(c, P.haloK) * P.haloGain + Math.pow(c, P.coreK) * P.coreGain) * s;
  g = Math.floor(g * P.steps + 0.5) / P.steps;
  const w = 1 - smooth(0, P.hazeTopDeg, elevDeg > 0 ? elevDeg : 0);
  const lift = 1 + w * P.hazeLift, warm = w * s;
  for (let i = 0; i < 3; i++) {
    const v = rgb[i] * lift + P.hazeWarm[i] * warm + P.tint[i] * g;
    rgb[i] = v > 255 ? 255 : v;
  }
  return rgb;
}

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const v3 = (a) => `vec3f(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;

/** WGSL twin source (constants from SKY_GLOW). Returns the new 0..255 colour. */
export const SKY_GLOW_WGSL = `
fn skyGlowSm(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn skyGlow(col: vec3f, rayDir: vec3f, elevDeg: f32, sunDir: vec3f, sunI: f32) -> vec3f {
  let s = clamp(sunI, 0.0, 1.0) * skyGlowSm(${f(SKY_GLOW.sunFadeLo)}, ${f(SKY_GLOW.sunFadeHi)}, sunDir.z);
  let c = max(dot(rayDir, sunDir), 0.0);
  var g = (pow(c, ${f(SKY_GLOW.haloK)}) * ${f(SKY_GLOW.haloGain)} + pow(c, ${f(SKY_GLOW.coreK)}) * ${f(SKY_GLOW.coreGain)}) * s;
  g = floor(g * ${f(SKY_GLOW.steps)} + 0.5) / ${f(SKY_GLOW.steps)};
  let w = 1.0 - skyGlowSm(0.0, ${f(SKY_GLOW.hazeTopDeg)}, max(elevDeg, 0.0));
  let v = col * (1.0 + w * ${f(SKY_GLOW.hazeLift)}) + ${v3(SKY_GLOW.hazeWarm)} * (w * s) + ${v3(SKY_GLOW.tint)} * g;
  return min(v, vec3f(255.0));
}
`;
