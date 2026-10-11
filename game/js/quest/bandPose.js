// MAP-13 (arch 38.43): band + pose helpers for load / travel / respawn at ANY pose, and the `?grid=1` world variant. Pure, Node-testable.

export const GRID_DEF = { cx0: 0, cy0: 0, cx1: 32, cy1: 32, cw: 5, ch: 3, stepX: 2, stepY: 1, ox: 0, oy: 0 }; // 38.43: the 4096 m world rect

/** `?grid=1` switch (default OFF). */
export const gridEnabled = (params) => !!params && params.get('grid') === '1';

/** World def variant: terrainBands -> terrainGrid over the map rect, capsule bounds -> the polygon outline. Never mutates `def`. */
export function gridVariant(def, geo) {
  const v = { ...def, terrainGrid: { ...GRID_DEF } };
  delete v.terrainBand; delete v.terrainBands;
  if (geo && geo.bounds && geo.bounds.shape === 'polygon') v.bounds = { shape: 'polygon', pts: geo.bounds.pts.map((p) => [p[0], p[1]]) };
  return v;
}

/** Fade-in gate: true when no band swap is pending. (ensureBandFor is synchronous, so true at once after it; also true without bands.) */
export const bandReady = (world) => !(world && world.terrainBands && world._bandPend >= 0);

/** Synchronously wakes the band for (x, y) behind the fade. No-op for worlds without bands. Returns the pose. */
export function ensureBand(world, pose) {
  if (pose && world && world.ensureBandFor) world.ensureBandFor(pose.x, pose.y);
  return pose;
}

/** True when (x, y) is outside a polygon walk bound (old save, edited map). Other bound shapes: false (unchanged behaviour). */
export function outsidePolygon(world, x, y) {
  const b = world && world.bounds;
  if (!b || b.shape !== 'polygon') return false;
  const q = b.pts; let inside = false; // even-odd ray cast (load-time only, not the physics clamp)
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) if ((q[i][1] > y) !== (q[j][1] > y) && x < (q[j][0] - q[i][0]) * (y - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) inside = !inside;
  return !inside;
}

/**
 * Load path: a saved pose outside the polygon moves to the last woken relay (`relayPose()` -> {x,y,z,yawDeg} | null), then the band is
 * ensured for the final pose. Mutates `t` (the player transform). Returns true when the pose was moved.
 */
export function placeLoaded(world, t, relayPose) {
  let moved = false;
  if (outsidePolygon(world, t.x, t.y)) {
    const rp = relayPose && relayPose();
    if (rp && Number.isFinite(rp.x) && Number.isFinite(rp.y)) { t.x = rp.x; t.y = rp.y; if (Number.isFinite(rp.z)) t.z = rp.z; if (Number.isFinite(rp.yawDeg)) t.yawDeg = rp.yawDeg; moved = true; }
  }
  ensureBand(world, t);
  return moved;
}
