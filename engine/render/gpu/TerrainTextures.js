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
// TLOOK  RGBA32F width 16, row = type id:
//   texel 0 = dark colour rgb (linear 0..1, un-gained)
//   texel 1 = mid colour rgb
//   texel 2 = light colour rgb
//   texel 3 = (albedo, glintFlag 0/1, 0, 0)
//   texel 4 = near-band glyph codes packed 8 bits each little-endian in x (<= 3 codes), count in y
//   texel 5 = mid-band glyph codes, same packing
//   texel 6 = far-band glyph codes, same packing
//   texel 7 = close-band glyph codes (US-026a 23.4 near-detail), same packing - < 40 m, wins over 4-6
//   texel 8, 10, 12, 14 = feature slots 0-3: (chance, code0, code1, fi) - US-026a
//              S5 (23.4 close-band features). `fi` is this feature's index
//              into the FLAT `buildFeatures()` list (terrainShade.js), NOT a
//              per-type index - `shadeTerrain`'s GLSL twin hashes with salt
//              `20+fi`, the same salt the JS oracle's `shadeTerrain` uses for
//              the SAME feature, so the two never roll different dice for it.
//              `chance <= 0` means "no feature in this slot" (never fires).
//   texel 9, 11, 13, 15 = feature slot 0-3 colour rgb (linear 0..1, un-gained), 0
// `MAX_FEATURES_PER_TYPE` = 4 (the recipe's own max: `grass` has 4 features
// whose `bands` include `'close'` - wildflower/pebble/tallGrass/reed, per
// `design/levels/overworld_far.js`'s `nearLOD.features`; `water` has 1,
// foam). A type with MORE than that would silently drop the extras from the
// GPU path only (deviation flagged for architect review - the JS oracle has
// no such cap, it reads `recipe.nearLOD.features` directly) - not reachable
// by the current content.
import { buildFeatures } from '../terrainShade.js';

export const TLOOK_WIDTH = 16;
export const MAX_FEATURES_PER_TYPE = 4;
const FEAT_BASE_TEXEL = 8; // first feature-slot texel (see TLOOK layout above)

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

  // US-026a S5: group the SAME flat feature list `makeTerrainShadeCtx` builds
  // (terrainShade.js's `buildFeatures`) by `typeId`, keeping each entry's
  // original flat-list index (`fi`) - the GLSL hash salt (`20+fi`, see the
  // TLOOK layout comment above) - so a feature's dice roll never drifts
  // between the JS oracle (which indexes the same flat list directly) and
  // this per-type-row GPU packing.
  const featuresByType = new Map();
  const featureList = buildFeatures(recipe, palette) || [];
  featureList.forEach((f, fi) => {
    let arr = featuresByType.get(f.typeId);
    if (!arr) featuresByType.set(f.typeId, arr = []);
    arr.push({ ...f, fi });
  });

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
    // US-026a S5: texels 8-11, up to MAX_FEATURES_PER_TYPE close-band
    // features for this type, in the flat list's own order (first entry ==
    // first tried by the shader, same as the JS oracle's `for` loop).
    {
      const feats = featuresByType.get(t.id) || [];
      for (let slot = 0; slot < MAX_FEATURES_PER_TYPE; slot++) {
        const oA = base + (FEAT_BASE_TEXEL + slot * 2) * 4;
        const oB = base + (FEAT_BASE_TEXEL + slot * 2 + 1) * 4;
        const f = feats[slot];
        if (!f) { tlook[oA] = 0; tlook[oA + 1] = 0; tlook[oA + 2] = 0; tlook[oA + 3] = 0; continue; }
        tlook[oA] = f.chance; tlook[oA + 1] = f.code0; tlook[oA + 2] = f.code1; tlook[oA + 3] = f.fi;
        tlook[oB] = f.fg[0] / 255; tlook[oB + 1] = f.fg[1] / 255; tlook[oB + 2] = f.fg[2] / 255; tlook[oB + 3] = 0;
      }
    }
  }

  return {
    width: terrain.mapW, height: terrain.mapH,
    farH: terrain.farHDraw, farType: terrain.farType,
    tlookWidth: TLOOK_WIDTH, tlookHeight: rows, tlook, typeIds,
  };
}

/**
 * US-026a S5 (23.4): pure packing for the near-band textures - `NEARH`
 * (R32F, `terrain.near.hDraw`) and `NEARTYPE` (R8UI, `terrain.near.type`),
 * the near-LOD twins of `FARH`/`FARTYPE` above (same manual-bilinear-on-GPU
 * reasoning). `GpuCellPipeline.js` uploads these once when `terrain.near.
 * version` changes (never per frame - same rule as `FARH`/`FARTYPE`), and
 * only while `terrain.nearReady`.
 * @param {import('../../world/Terrain.js').Terrain} terrain - `nearReady` must be true.
 * @returns {{width:number, height:number, x0:number, y0:number, cell:number,
 *   nearH:Float32Array, nearType:Uint8Array}}
 */
export function packNearTextures(terrain) {
  if (!terrain || !terrain.nearReady) throw new Error('packNearTextures: terrain.nearReady must be true');
  const near = terrain.near;
  return {
    width: near.w, height: near.h, x0: near.x0, y0: near.y0, cell: near.cell,
    nearH: near.hDraw, nearType: near.type,
  };
}
