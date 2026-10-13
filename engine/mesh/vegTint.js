// engine/mesh/vegTint.js - AUD-47: deterministic per-instance vegetation colour variation.
// The tint rides in the instance objectId (no spare INST_FLAGS bits: 0 aligned, 1 sway, 8-15 team, 16-26 LOD dither):
//   bit 26 = marker, bits 20-22 = value level (0..7), bits 23-25 = hue level (0..7); bits 0-19 = placement index (unchanged).
// The G-buffer already carries objectId to the shade stage on both twins, so no new channel. Only species flagged `sway`
// (plants / bushes / tree leaves; rocks and buildings are not) get the marker. Gain per pixel (f32 op order, WGSL twin
// VEG_TINT_WGSL in shade.wgsl.js): u,h in [-1,1]; v = 1 + 0.06u; rgb *= (v*(1+0.04h), v, v*(1-0.06h)) -> +-6 % value, warm(yellow)<->cool(green).
const f = Math.fround;
export const VEG_MARK = 0x4000000;
export const VEG_VAL_SHIFT = 20, VEG_HUE_SHIFT = 23;
export const VEG_ID_LIMIT = 0x100000; // placement indices must fit the low 20 bits

/** Feed-time (once per instance): objectId with the tint bits OR'd in. Deterministic in (index, x, y). Zero alloc. */
export function vegTintObjectId(baseId, index, x, y) {
  if (index >= VEG_ID_LIMIT) return baseId >>> 0;
  let h = Math.imul(index | 0, 0x9E3779B1) ^ Math.imul(Math.round(x * 16) | 0, 0x85EBCA6B) ^ Math.imul(Math.round(y * 16) | 0, 0xC2B2AE35);
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15;
  const val = h & 7, hue = (h >>> 8) & 7;
  return ((baseId | VEG_MARK | (val << VEG_VAL_SHIFT) | (hue << VEG_HUE_SHIFT)) >>> 0);
}

/** JS twin of the shade-stage gain. Writes [r,g,b] multipliers into out3; returns false (and 1,1,1) when objectId has no marker. */
export function vegTintGain(objectId, out3) {
  const id = objectId >>> 0;
  if ((id & VEG_MARK) === 0) { out3[0] = out3[1] = out3[2] = 1; return false; }
  const u = f(f(f((id >>> VEG_VAL_SHIFT) & 7) - 3.5) / 3.5), h = f(f(f((id >>> VEG_HUE_SHIFT) & 7) - 3.5) / 3.5);
  const v = f(1 + f(0.06 * u));
  out3[0] = f(v * f(1 + f(0.04 * h))); out3[1] = v; out3[2] = f(v * f(1 - f(0.06 * h)));
  return true;
}

/** WGSL twin (embedded in the shade module next to tintCh). */
export const VEG_TINT_WGSL = `
// AUD-47: vegetation gain from the objectId tint bits (twin of vegTint.js vegTintGain; id without the marker -> 1,1,1).
fn vegGain(id: u32) -> vec3f {
  if ((id & ${VEG_MARK}u) == 0u) { return vec3f(1.0); }
  let u = (f32((id >> ${VEG_VAL_SHIFT}u) & 7u) - 3.5) / 3.5;
  let h = (f32((id >> ${VEG_HUE_SHIFT}u) & 7u) - 3.5) / 3.5;
  let v = 1.0 + 0.06 * u;
  return vec3f(v * (1.0 + 0.04 * h), v, v * (1.0 - 0.06 * h));
}
`;
