// WM-06 (arch 38.59): the whole-map loop waypoint list + polygon check. Pure, Node-testable (tools/map-loop-waypoints.test.mjs).
// Coordinates are world metres taken from world_geo sites/regions; `n` = the stop's name (summary + 6 save/load poses use `pose: true`).
export const MAP_LOOP = [
  { n: 'tower', x: 1470, y: 1029 },
  { n: 'bend relay', x: 1270, y: 1042 },
  { n: 'ford relay', x: 1000, y: 1069, ford: true }, // crosses the stepping stones (route-walk leg 9 / verify-grid-walk list)
  { n: 'Glasswater (north bank ruins)', x: 1150, y: 800, pose: true },
  { n: 'Northwood (logging camp)', x: 1600, y: 700, pose: true },
  { n: 'Ash Mile (relay stump)', x: 1760, y: 1012 },
  { n: 'Downs (shepherd hut)', x: 1620, y: 1310, pose: true },
  { n: 'Strand (Gullhaven)', x: 1500, y: 1715, pose: true },
  { n: 'Reedmire (peat cutters)', x: 1250, y: 1440 },
  { n: 'Signal Head (cove)', x: 760, y: 1405 },
  { n: 'Heath (crofter farm)', x: 560, y: 1300, pose: true },
  { n: 'Thornwood (woodcutters)', x: 820, y: 1150 },
  { n: 'High Pastures (goatherd hut)', x: 520, y: 420 },
  { n: 'Gate garrison ruin', x: 360, y: 880, pose: true, tol: 30 }, // fells slope: within 30 m counts
];
/** Back leg: the same list reversed (back to the tower), minus the turn-around stop. */
// High Pastures is a dead-end spur off the Thornwood side (the slope above the garrison traps the way back), so the return skips it.
export const mapLoopFull = () => MAP_LOOP.concat(MAP_LOOP.slice(0, -1).filter((w) => !w.n.startsWith('High Pastures')).reverse());
/** The 6 save/load poses (stops flagged `pose`). */
export const mapLoopPoses = () => MAP_LOOP.filter((w) => w.pose);
/** Even-odd point-in-polygon on [[x,y],...]. */
export function inPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i][1] > y) !== (pts[j][1] > y) && x < (pts[j][0] - pts[i][0]) * (y - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
  return inside;
}
/** Waypoints outside the polygon (WM-05 widens it: report, the tool flags them instead of failing). */
export const outsideBounds = (pts, wps = MAP_LOOP) => wps.filter((w) => !inPolygon(pts, w.x, w.y));
