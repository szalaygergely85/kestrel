// engine/voxel/emissiveLight.js - EMIS-01a (architecture.md 38.12 (1)).
// Pure: derives ONE point-light record from a voxel model's emissive voxels at
// pack time. No design/ or game/ imports: the caller passes material and
// preset lookups as callbacks. Runs once per model (may allocate).

export const EMISSIVE_LIGHT_MIN = 0.5; // a voxel counts only at emissive >= this
export const EMISSIVE_LIGHT_I_MIN = 0.15;
export const EMISSIVE_LIGHT_I_MAX = 0.9;
export const EMISSIVE_LIGHT_R_MIN = 2;
export const EMISSIVE_LIGHT_R_MAX = 6;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * @param {object} def   VoxelModelDef (validated).
 * @param {false|{preset:string}} [override]  (4th arg) `false` disables; `{preset}` overrides
 *                       intensity/radius/hue/flicker (centroid stays derived).
 * @param {(key:string)=>({emissive:number, rgb:number[], flicker?:object}|null)} matInfo
 *        material key -> emissive scalar, radiance colour (palette glowColor
 *        else base colour; any channel scale), optional flicker preset object,
 *        optional `light:false` to exclude a material (e.g. a transient hit-flash paint).
 * @param {(name:string)=>({hue:number[], intensity:number, radius:number, flicker?:object}|null)} [presetInfo]
 *        resolves `def.light.preset` (palette.lights + hue); unknown -> falls back to derived values.
 * @returns {{x:number,y:number,z:number,hue:number[],intensity:number,radius:number,flicker:object|null,count:number,n:number}|null}
 *   x,y,z = emissive-weighted centroid in voxel-grid units, rest pose (the SAME
 *   space as `mounts[].at` / part boxes; voxel centres at +0.5); `anchor` is
 *   not subtracted (consumers use the root part transform like voxelMountWorld).
 *   `count` = emissive voxels, `n` = sum of their emissive.
 */
export function deriveEmissiveLight(def, matInfo, presetInfo, override) {
  // override = content RECORD field `light` (false | {preset}; design/models/hand.js uses `light: false`),
  // falling back to the voxel def's own `light`.
  const lp = override !== undefined ? override : def && def.light;
  if (!def || lp === false) return null;
  const [sx, sy, sz] = def.size;
  const mats = def.mats;

  // per-char emissive info (only chars at/above the threshold)
  const charInfo = new Map();
  for (const ch of Object.keys(mats)) {
    const key = mats[ch];
    if (key === null) continue;
    const mi = matInfo(key);
    if (mi && mi.light !== false && mi.emissive >= EMISSIVE_LIGHT_MIN) charInfo.set(ch, mi);
  }
  if (charInfo.size === 0) return null;

  // voxels outside every part box are never drawn; overlaps count once
  const partNames = Object.keys(def.parts);
  const inPart = new Uint8Array(sx * sy * sz);
  for (const pn of partNames) {
    const b = def.parts[pn].box;
    for (let z = b[2]; z < b[5]; z++) for (let y = b[1]; y < b[4]; y++) {
      for (let x = b[0]; x < b[3]; x++) inPart[x + sx * (y + sy * z)] = 1;
    }
  }

  let n = 0, count = 0, cx = 0, cy = 0, cz = 0, hr = 0, hg = 0, hb = 0;
  const flickerW = new Map(); // flicker object -> summed emissive weight
  for (let z = 0; z < sz; z++) {
    const layer = def.layers[z];
    for (let y = 0; y < sy; y++) {
      const row = layer[y];
      for (let x = 0; x < sx; x++) {
        if (!inPart[x + sx * (y + sy * z)]) continue;
        const mi = charInfo.get(row[x]);
        if (!mi) continue;
        const w = mi.emissive;
        n += w; count++;
        cx += (x + 0.5) * w; cy += (y + 0.5) * w; cz += (z + 0.5) * w;
        const rgb = mi.rgb;
        hr += rgb[0] * w; hg += rgb[1] * w; hb += rgb[2] * w;
        if (mi.flicker) flickerW.set(mi.flicker, (flickerW.get(mi.flicker) || 0) + w);
      }
    }
  }
  if (count === 0) return null;

  const m = Math.max(hr, hg, hb) || 1;
  let hue = [hr / m, hg / m, hb / m];
  let intensity = clamp(0.12 * Math.sqrt(n), EMISSIVE_LIGHT_I_MIN, EMISSIVE_LIGHT_I_MAX);
  let radius = clamp(1.5 + 0.35 * Math.sqrt(n), EMISSIVE_LIGHT_R_MIN, EMISSIVE_LIGHT_R_MAX);
  let flicker = null;
  let best = 0;
  for (const [f, w] of flickerW) if (w > best) { best = w; flicker = f; }

  if (lp && typeof lp === 'object' && lp.preset && presetInfo) {
    const p = presetInfo(lp.preset);
    if (p) {
      hue = p.hue.slice(); intensity = p.intensity; radius = p.radius; flicker = p.flicker || null;
    }
  }
  return { x: cx / n, y: cy / n, z: cz / n, hue, intensity, radius, flicker, count, n };
}
