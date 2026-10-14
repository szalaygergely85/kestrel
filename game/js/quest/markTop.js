// OB-155h / OB-164: quest marker height comes from the anchor's model, not a per-id table (a fixed 1.55 m sat inside the 2.6 m waystone).
// Pure (Node-testable): `assets` = {voxelModels, models, meshes}. Returns metres above the entity origin (transform.z) to the model top.
export const MARK_MARGIN = 0.05; // the glyph's base floats this far above the model top (the glyph model itself starts 0.35 m above its origin)
export const MARK_FALLBACK = 1.55;

/** Model top of an entity data record (voxel: (size z - anchor z) * cellM * scale; mesh component: bbox top * scale). null = unknown. */
export function modelTop(data, assets) {
  const c = data && data.components; if (!c) return null;
  const k = (data.transform && data.transform.scale) || 1;
  if (c.voxel && c.voxel.model) {
    const m = (assets.voxelModels && assets.voxelModels[c.voxel.model]) || (assets.models && assets.models[c.voxel.model]);
    const v = m && m.voxel; if (!v || !v.size) return null;
    return (v.size[2] - (v.anchor ? v.anchor[2] : 0)) * (v.cellM || 0.125) * k;
  }
  const id = c.mesh && (typeof c.mesh === 'string' ? c.mesh : c.mesh.mesh);
  const mesh = id && assets.meshes && assets.meshes[id];
  if (mesh && mesh.bbox) return mesh.bbox[5] * k;
  return null;
}

/** Marker origin height above the entity origin: model top + margin; `override` (table) wins when given; fallback when the model is unknown. */
export function markHeight(data, assets, override) {
  if (override !== undefined) return override;
  const t = modelTop(data, assets);
  return t === null ? MARK_FALLBACK : t + MARK_MARGIN;
}

/** Anchor props with no model (owBoard, owForge, pierStone, ...) sit at a mesh placement: the top of the small structures (< 6 m wide) whose
 *  bbox covers the anchor x,y (0.5 m slack) and starts near its base. Returns metres above `z`, or null. */
export function structureTop(structures, x, y, z) {
  let top = null;
  for (const s of structures || []) {
    const b = s.bbox; if (!b || b.x1 - b.x0 > 6 || b.y1 - b.y0 > 6) continue;
    if (x < b.x0 - 0.5 || x > b.x1 + 0.5 || y < b.y0 - 0.5 || y > b.y1 + 0.5 || b.z0 > z + 1.5 || b.z1 - z > 6) continue;
    if (top === null || b.z1 - z > top) top = b.z1 - z;
  }
  return top;
}
