// US-016 (docs/architecture.md 14.4 item 3): pure packing for the far-LOD
// terrain textures - no `gl` calls here (Node-testable), `GpuCellPipeline.js`
// owns the actual `texImage2D` calls (upload once when `farReady` flips,
// again only when `terrain.farVersion` changes - never per frame, item 3
// "do not" list item "upload FARH/FARTYPE per frame").
//
// FARH   R32F  mapW x mapH = terrain.farHDraw (farH + canopy on forest
//        texels). Sampled with MANUAL bilinear (4 texelFetch) on the GPU -
//        R32F is not filterable without OES_texture_float_linear, and manual
//        bilinear is what matches `util.gridHeight` exactly (item 3 "do not
//        use hardware filtering on the height texture").
// FARTYPE R8UI mapW x mapH = terrain.farType, nearest.
// TLOOK  RGBA32F width 9, row = type id:
//   texel 0 = dark colour rgb (linear 0..1, un-gained)
//   texel 1 = mid colour rgb
//   texel 2 = light colour rgb
//   texel 3 = (albedo, glintFlag 0/1, 0, 0)
//   texel 4 = near-band glyph codes packed 8 bits each little-endian in x (<= 3 codes), count in y
//   texel 5 = mid-band glyph codes, same packing
//   texel 6 = far-band glyph codes, same packing
//   texel 7 = close-band glyph codes (US-026a 23.4 near-detail), same packing - < 40 m, wins over 4-6

export const TLOOK_WIDTH = 9;

function packGlyphCodes(str) {
  let x = 0;
  const n = Math.min(3, str.length);
  for (let i = 0; i < n; i++) x |= (str.charCodeAt(i) - 32) << (8 * i);
  return { x, count: str.length };
}

/**
 * @param {import('../../world/Terrain.js').Terrain} terrain - `farReady` must be true.
 * @param {Object} palette - `assets.palette` (`.rgb`, colours 0..255).
 * @returns {{width:number, height:number, farH:Float32Array, farType:Uint8Array,
 *   tlookWidth:number, tlookHeight:number, tlook:Float32Array, typeIds:string[]}}
 */
export function packTerrainTextures(terrain, palette) {
  if (!terrain || !terrain.farReady) throw new Error('packTerrainTextures: terrain.farReady must be true');
  const recipe = terrain.recipe;
  const terrainLook = recipe.terrain;
  if (!terrainLook) throw new Error('packTerrainTextures: recipe.terrain (look table) is required');
  const typeIds = Object.keys(terrainLook).sort((a, b) => terrainLook[a].id - terrainLook[b].id);
  const rows = typeIds.length;
  const tlook = new Float32Array(4 * TLOOK_WIDTH * rows);

  for (const key of typeIds) {
    const t = terrainLook[key];
    const row = t.id;
    const base = row * TLOOK_WIDTH * 4;
    const cols = t.colors; // [dark, mid, light] palette keys
    for (let c = 0; c < 3; c++) {
      const rgb = palette.rgb[cols[c]];
      if (!rgb) throw new Error(`packTerrainTextures: unknown palette colour "${cols[c]}" (type "${key}")`);
      const o = base + c * 4;
      tlook[o] = rgb[0] / 255; tlook[o + 1] = rgb[1] / 255; tlook[o + 2] = rgb[2] / 255; tlook[o + 3] = 0;
    }
    const o3 = base + 3 * 4;
    tlook[o3] = t.albedo != null ? t.albedo : 1;
    tlook[o3 + 1] = t.glint ? 1 : 0;
    tlook[o3 + 2] = 0; tlook[o3 + 3] = 0;

    const bandNames = ['near', 'mid', 'far'];
    for (let b = 0; b < 3; b++) {
      const g = packGlyphCodes((t.glyphs && t.glyphs[bandNames[b]]) || ' ');
      const o = base + (4 + b) * 4;
      tlook[o] = g.x; tlook[o + 1] = g.count; tlook[o + 2] = 0; tlook[o + 3] = 0;
    }
    // US-026a (23.4): texel 7 (fixed, per architecture.md 23.4 - the width
    // bump 8 -> 9 is what makes this slot addressable) - the close (< 40 m) glyph set.
    {
      const g = packGlyphCodes((t.glyphs && t.glyphs.close) || ' ');
      const o = base + 7 * 4;
      tlook[o] = g.x; tlook[o + 1] = g.count; tlook[o + 2] = 0; tlook[o + 3] = 0;
    }
  }

  return {
    width: terrain.mapW, height: terrain.mapH,
    farH: terrain.farHDraw, farType: terrain.farType,
    tlookWidth: TLOOK_WIDTH, tlookHeight: rows, tlook, typeIds,
  };
}
