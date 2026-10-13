// DECAL-01 (architecture.md 37.6): wall scrawls share the depth-tested overlay.
import { lightAt } from '../render/lighting.js';

export const DECAL_MUL_FLOOR = 0.95, DECAL_DARK_LM = 0.05, DECAL_LIT_LM = 0.25;

/** Load-only: resolve style keys and text ids; all frame scratch belongs to the binding. */
export function bindDecals(overlay, decals) {
  const styles = Int32Array.from(decals, d => overlay.styleId(d.style));
  const texts = overlay.setTexts(decals.map(d => d.glyphs));
  return { decals, styles, texts, light: new Float64Array(3) };
}

/** One light sample and text op per visible decal. No strings/objects built per frame. */
export function drawDecals(binding, overlay, cam, lights, world, drawM = 20) {
  if (!binding || binding.decals.length === 0) return 0;
  const decals = binding.decals, out = binding.light, S = world.assets.palette.shading;
  let drawn = 0;
  for (let i = 0; i < decals.length; i++) {
    const d = decals[i], x = (d.ax + d.bx) * 0.5, y = (d.ay + d.by) * 0.5, z = (d.z0 + d.z1) * 0.5;
    const dx = cam.x - x, dy = cam.y - y, dz = cam.z - z;
    if (dx * d.nx + dy * d.ny <= 0.05 || dx * dx + dy * dy + dz * dz > drawM * drawM) continue;
    let mul = 1;
    if (lights && lights.ambient) {
      lightAt(lights, world, x + 0.1 * d.nx, y + 0.1 * d.ny, z, d.nx, d.ny, 0, out);
      // Same shadeSprite gain and tint order as particleLayer; one scalar luminance.
      const Lm = Math.max(out[0], out[1], out[2]);
      const hr = Lm > 1e-6 ? out[0] / Lm : 1, hg = Lm > 1e-6 ? out[1] / Lm : 1, hb = Lm > 1e-6 ? out[2] / Lm : 1;
      const bc = Lm < 0 ? 0 : Lm;
      let gain = S.fgMin + (1 - S.fgMin) * Math.pow(bc > 1 ? 1 : bc, S.fgGamma);
      if (bc > 1) gain = Math.min(S.fgMaxGain, gain + (bc - 1) * 0.5);
      const r = (1 + (hr - 1) * S.tint) * gain, g = (1 + (hg - 1) * S.tint) * gain, b = (1 + (hb - 1) * S.tint) * gain;
      mul = Math.max(0, Math.min(1.5, 0.2126 * r + 0.7152 * g + 0.0722 * b));
      // DECAL-VIS-01: chalk is emissive-ish. Floor ramps in between truly dark (Lm <= 0.05: stays dark,
      // the lantern reveals it) and ambient (Lm >= 0.25), so the scrawl stays well above the lit wall.
      const f = DECAL_MUL_FLOOR * Math.min(1, Math.max(0, (Lm - DECAL_DARK_LM) / (DECAL_LIT_LM - DECAL_DARK_LM)));
      if (mul < f) mul = f;
    }
    overlay.text(binding.texts[i], d.ax + 0.02 * d.nx, d.ay + 0.02 * d.ny,
      d.bx + 0.02 * d.nx, d.by + 0.02 * d.ny, z, mul, binding.styles[i]);
    drawn++;
  }
  return drawn;
}
