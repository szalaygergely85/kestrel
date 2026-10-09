// Entity tint table (architecture.md 38.23, TELEGRAPH-TINT-01 / BOAR-SHADER-READ-01a).
// `objectId -> (rgb, k)`: a display override applied in the shade pass AFTER lighting.
// It emits no light and casts nothing. Fixed size (8), zero allocation per frame.
export const ENTITY_TINT_MAX = 8;
const f = Math.fround;

export function createEntityTintTable() {
  return { count: 0, ids: new Uint32Array(ENTITY_TINT_MAX), rgbk: new Float32Array(ENTITY_TINT_MAX * 4) };
}

export function clearEntityTints(t) { t.count = 0; }

/** rgb in 0..1. Ignored when k <= 0 (or NaN) or the table is full. Returns true if stored. */
export function pushEntityTint(t, objectId, r, g, b, k) {
  if (!(k > 0) || t.count >= ENTITY_TINT_MAX) return false;
  const n = t.count++, o = n * 4;
  t.ids[n] = objectId >>> 0;
  t.rgbk[o] = r; t.rgbk[o + 1] = g; t.rgbk[o + 2] = b; t.rgbk[o + 3] = k > 1 ? 1 : k;
  return true;
}

/** Twin lookup: first match, linear. Writes [r,g,b,k] (0..1) into out4; returns false (k=0) when none. */
export function entityTintAt(t, objectId, out4) {
  const id = objectId >>> 0;
  for (let i = 0; i < t.count; i++) {
    if (t.ids[i] === id) {
      const o = i * 4;
      out4[0] = t.rgbk[o]; out4[1] = t.rgbk[o + 1]; out4[2] = t.rgbk[o + 2]; out4[3] = t.rgbk[o + 3];
      return true;
    }
  }
  out4[0] = out4[1] = out4[2] = out4[3] = 0;
  return false;
}

/** WGSL op order (f32): c = c + (rgb*255 - c) * k, one channel (0..255 scale). */
export function tintChannel(c, rgb01, k) {
  const cf = f(c);
  return f(cf + f(f(f(rgb01) * 255) - cf) * f(k));
}

/** Feed the table from a tintEnvelope sample: push (rgb,k) for `objectId` (k<=0 ignored). */
export function pushEntityTintSample(t, objectId, sample) {
  return pushEntityTint(t, objectId, sample.r, sample.g, sample.b, sample.k);
}
