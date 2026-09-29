// engine/world/gridLocal.js (CO-2, docs/coordinates.md 6/11). The ONE
// world -> baked-grid conversion for a placed structure: translation only
// (the grid is baked, CO-4 rotates the grid itself, never the query).
// `out.z` is the grid's height base (`placed.origin.z`): level-local heights
// are `floorH/ceilH` + `out.z`. Caller-owned `out`, no allocation.
/**
 * @param {{origin:{x:number,y:number,z:number}}} placed
 * @param {number} x world x
 * @param {number} y world y
 * @param {{x:number,y:number,z:number}} out
 */
export function gridLocal(placed, x, y, out) {
  const o = placed.origin;
  out.x = x - o.x; // coord-ok
  out.y = y - o.y; // coord-ok
  out.z = o.z;
  return out;
}
