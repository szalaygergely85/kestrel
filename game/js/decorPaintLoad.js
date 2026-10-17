// ED-FOLIAGE-04 (B1-MAIN): content/terrain/<key>.decorPaint.json -> World opt `decorPaint` ({layer: GrassMaskLayer}).
// Pure helpers (no fetch of their own); a missing / bad file gives null = byte-identical world.
export const decorPaintUrl = (key) => `../content/terrain/${key}.decorPaint.json`;

/** json: {version:1, layers:{name: grassMaskJSON}} -> {name: layer} or null (no layers / bad shape). */
export function decorPaintFromJSON(json, grassMaskFromJSON) {
  if (!json || typeof json !== 'object' || !json.layers || typeof json.layers !== 'object') return null;
  const out = {}; let n = 0;
  for (const k of Object.keys(json.layers)) {
    try { out[k] = grassMaskFromJSON(json.layers[k]); n++; } catch (e) { console.warn('[decorPaint] layer skipped:', k, e && e.message); }
  }
  return n ? out : null;
}

/** Quiet loader: 404 / network / parse error -> null. */
export async function loadDecorPaint(key, grassMaskFromJSON, fetchFn = fetch) {
  try { const r = await fetchFn(decorPaintUrl(key)); if (!r.ok) return null; return decorPaintFromJSON(await r.json(), grassMaskFromJSON); } catch (e) { return null; }
}
