// Editor-only translation preview. The existing commit path reloads the World
// once on release, rebuilding colliders; preview never edits content or physics.

export function beginMeshDragPreview(world, id) {
  const placement = world.structures.find((s) => s.kind === 'mesh' && s.id === id);
  if (!placement) return null;
  return { placement, origin: { ...placement.origin }, bbox: { ...placement.bbox } };
}

/** Translation keeps the authored yaw/mesh unchanged; bounds shift from the snapshot. */
export function updateMeshDragPreview(world, preview, origin) {
  if (!preview || !origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) return false;
  const s = preview.placement;
  if (!world.structures.includes(s)) return false; // a load/undo replaced the runtime during the gesture
  if (s.origin.x === origin.x && s.origin.y === origin.y && s.origin.z === origin.z) return true;
  const dx = origin.x - preview.origin.x, dy = origin.y - preview.origin.y, dz = origin.z - preview.origin.z;
  s.frame.x = s.origin.x = origin.x;
  s.frame.y = s.origin.y = origin.y;
  s.frame.z = s.origin.z = origin.z;
  s.bbox.x0 = preview.bbox.x0 + dx; s.bbox.x1 = preview.bbox.x1 + dx;
  s.bbox.y0 = preview.bbox.y0 + dy; s.bbox.y1 = preview.bbox.y1 + dy;
  s.bbox.z0 = preview.bbox.z0 + dz; s.bbox.z1 = preview.bbox.z1 + dz;
  world.renderVersion++;
  return true;
}

export function cancelMeshDragPreview(world, preview) {
  return preview ? updateMeshDragPreview(world, preview, preview.origin) : false;
}
