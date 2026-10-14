// OB-155h / OB-164: quest marker height from the target's model top (not a per-id table).
// base z of the glyph = entity z + top(model) x scale + MARK_MARGIN; MARK_OVERRIDE only for special cases (wall note, end marker).
export const MARK_MARGIN = 0.1;
export const MARK_DEFAULT_TOP = 1.55; // bare anchor with no model/mesh underneath
const STRIDE = 16; // PART_STRIDE of engine/voxel/VoxelModel.js (box x0..z1 at 0..5, atlas offset 10, box size 11..13)

/** Height (m, above the entity's z, unscaled) of the highest filled voxel of a packed model (voxelPack.js). Null for a model with no cells. */
export function packedTop(pm) {
  if (!pm || !(pm.cellM > 0)) return null;
  const az = pm.anchor ? pm.anchor[2] : 0;
  if (!pm.vox || pm.vox.length === 0) return pm.sz ? Math.max(0, pm.sz - az) * pm.cellM : null; // rigged: whole box
  let topZ = -1;
  for (let p = 0; p < pm.partCount; p++) {
    const b = p * STRIDE, z0 = pm.parts[b + 2], bx = pm.parts[b + 11], by = pm.parts[b + 12], bz = pm.parts[b + 13], off = pm.parts[b + 10];
    for (let z = bz - 1; z >= 0 && z0 + z > topZ - 1; z--) {
      let hit = false; const base = off + z * bx * by;
      for (let i = 0, n = bx * by; i < n; i++) if (pm.vox[base + i]) { hit = true; break; }
      if (hit) { if (z0 + z + 1 > topZ) topZ = z0 + z + 1; break; }
    }
  }
  return topZ < 0 ? null : Math.max(0, topZ - az) * pm.cellM;
}

/** Highest top (m above the entity base z) under a quest entity: its own voxel model x scale, and any placed mesh whose footprint
 *  covers the entity (an anchor standing on a board/door mesh). `packedFor(modelKey)` -> packed model. Returns MARK_DEFAULT_TOP if nothing. */
export function entityTop(world, data, packedFor) {
  const t = data.transform, v = data.components && data.components.voxel;
  let top = null;
  const s = t.scale > 0 ? t.scale : 1;
  if (v && v.model) { const h = packedTop(packedFor(v.model)); if (h != null) top = h * s; }
  if (top == null && world && world.structures) for (const st of world.structures) {
    const b = st.bbox; if (st.kind !== 'mesh' || !b) continue;
    if (t.x >= b.x0 - 0.5 && t.x <= b.x1 + 0.5 && t.y >= b.y0 - 0.5 && t.y <= b.y1 + 0.5 && b.z1 > t.z) top = Math.max(top == null ? 0 : top, b.z1 - t.z);
  }
  return top == null ? MARK_DEFAULT_TOP : top;
}

/** Marker base z: model top + margin, unless `overrideTop` (the MARK_TOP table entry) is given. */
export const markZ = (t, top, overrideTop) => t.z + (overrideTop !== undefined ? overrideTop : top + MARK_MARGIN);
