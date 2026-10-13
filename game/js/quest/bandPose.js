// MAP-13 (arch 38.43): band + pose helpers for load / travel / respawn at ANY pose, and the `?grid=1` world variant. Pure, Node-testable.

export const GRID_DEF = { cx0: 0, cy0: 0, cx1: 32, cy1: 32, cw: 5, ch: 3, stepX: 2, stepY: 1, ox: 0, oy: 0, pin: [[4, 7], [3, 7], [4, 9], [4, 11], [4, 13]] }; // 38.43; WM-05 pin = the 5 authored zones (east, west, south1-3)

/** WM-05: the grid + polygon map is the DEFAULT; `?grid=0` = the old terrainBands + capsule bounds for one sprint (`?grid=WxH` is the resolution knob, not this). */
export const gridEnabled = (params) => !(params && params.get('grid') === '0');

// WM-05 legacy (`?grid=0`): the pre-switch 5 authored bands + capsule-union walk bounds, exactly as world_m1 shipped them.
export const LEGACY_BANDS = [{ id: 'east', ch: 3, cw: 5, cx0: 8, cy0: 7 }, { id: 'west', ch: 3, cw: 5, cx0: 6, cy0: 7 }, { id: 'south1', ch: 3, cw: 5, cx0: 8, cy0: 9 },
  { id: 'south2', ch: 3, cw: 5, cx0: 8, cy0: 11 }, { id: 'south3', ch: 3, cw: 5, cx0: 8, cy0: 13 }];
export const LEGACY_BOUNDS = { shape: 'union', parts: [
  {r: 96, shape: 'circle', x: 1496.5, y: 1024.5},
  {ax: 1440, ay: 1034, bx: 1350, by: 1048, r: 40, shape: 'capsule'},
  {ax: 1350, ay: 1048, bx: 1240, by: 1047, r: 40, shape: 'capsule'},
  {ax: 1240, ay: 1047, bx: 1180, by: 1062, r: 40, shape: 'capsule'},
  {ax: 1180, ay: 1062, bx: 1090, by: 1070, r: 40, shape: 'capsule'},
  {ax: 1090, ay: 1070, bx: 1000, by: 1070, r: 40, shape: 'capsule'},
  {ax: 1000, ay: 1070, bx: 950, by: 960, r: 30, shape: 'capsule'},
  {r: 100, shape: 'circle', x: 915, y: 950},
  {ax: 1480, ay: 1100, bx: 1520, by: 1180, r: 30, shape: 'capsule'},
  {ax: 1520, ay: 1180, bx: 1590, by: 1300, r: 30, shape: 'capsule'},
  {ax: 1590, ay: 1300, bx: 1590, by: 1500, r: 30, shape: 'capsule'},
  {ax: 1590, ay: 1500, bx: 1520, by: 1700, r: 30, shape: 'capsule'},
  {ax: 1520, ay: 1700, bx: 1500, by: 1740, r: 30, shape: 'capsule'},
  {ax: 1500, ay: 1735, bx: 1380, by: 1790, r: 45, shape: 'capsule'},
  {r: 45, shape: 'circle', x: 1500, y: 1790}] };

/** `?grid=0` world: terrainGrid -> LEGACY_BANDS, polygon -> LEGACY_BOUNDS. Never mutates `def`. */
export function legacyVariant(def) {
  const v = { ...def, terrainBands: LEGACY_BANDS.map((z) => ({ ...z })), bounds: JSON.parse(JSON.stringify(LEGACY_BOUNDS)) };
  delete v.terrainGrid;
  return v;
}

/** World def variant: terrainBands -> terrainGrid over the map rect, capsule bounds -> the polygon outline. Never mutates `def`. */
export function gridVariant(def, geo) {
  const v = { ...def, terrainGrid: { ...GRID_DEF } };
  delete v.terrainBand; delete v.terrainBands;
  if (geo && geo.bounds && geo.bounds.shape === 'polygon') v.bounds = { shape: 'polygon', pts: geo.bounds.pts.map((p) => [p[0], p[1]]) };
  return v;
}

/** Fade-in gate: true when no band swap is pending. (ensureBandFor is synchronous, so true at once after it; also true without bands.) */
export const bandReady = (world) => !(world && world.terrainBands && world.bandPending >= 0);

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
