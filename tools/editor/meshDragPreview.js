// ED-MESH-01f: preview through the public mesh setter. Commit/undo rebuild
// mesh colliders once; preview never edits content or rebuilds physics.

export function beginMeshDragPreview(world, id) {
  const placement = world.structures.find((s) => s.kind === 'mesh' && s.id === id);
  if (!placement) return null;
  return { placement, origin: { ...placement.origin }, pose: { ...placement.origin, yawDeg: placement.frame.yawDeg ?? 0, scale: placement.scale ?? 1 } };
}

/** Translation keeps the snapshot yaw/scale; the engine recomputes its own bounds. */
export function updateMeshDragPreview(world, preview, origin) {
  if (!preview || !origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) return false;
  const s = preview.placement;
  if (!world.structures.includes(s)) return false; // a load/undo replaced the runtime during the gesture
  if (s.origin.x === origin.x && s.origin.y === origin.y && s.origin.z === origin.z) return true;
  const p = preview.pose;
  p.x = origin.x; p.y = origin.y; p.z = origin.z;
  return world.setMeshPlacement(s.id, p);
}

export function cancelMeshDragPreview(world, preview) {
  return preview ? updateMeshDragPreview(world, preview, preview.origin) : false;
}
