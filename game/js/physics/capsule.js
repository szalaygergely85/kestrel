// game/js/physics/capsule.js
//
// Generic circle-vs-sector-grid collision for a vertical capsule (the
// player, US-008; reusable as-is for the boulder, US-013, which D-002 notes
// uses "the same [2.5D] model"). Pure functions, no entity state - Player.js
// (game/js/entities/) owns the actual capsule state and calls into these.
//
// The collision rule (US-008 AC3, US-009 AC7 "step-up only while grounded"):
// a cell is passable for a capsule whose feet are at `footZ` if:
//   - it is not `solid` (solid blocks at ANY height - MAP_FORMAT v2
//     section 2.4), and
//   - it has headroom for the capsule (`ceilH - floorH >= height`, or
//     ceilH === 'sky'), and
//   - the floor height difference from `footZ` is within `stepUpMax`
//     EITHER WAY while grounded (small stairs are walked smoothly), or
//     the floor is at or below `footZ` (any drop is always fine - you fall,
//     US-008 AC4) while airborne. A floor MORE than `stepUpMax` above
//     `footZ` is never passable while airborne: step-up never happens
//     mid-air, which is exactly the rule that makes a running jumpless
//     player fall into a gap instead of "bridging" it.
//
// (D-008) There is no hard-coded "outside the grid = wall" branch anywhere
// in here. `world.sectorAt(col, row)` returning `null` (outside the grid)
// is resolved by calling `world.outsideSector(x, y)` - a query on the
// world object, not a constant baked into physics - before the result ever
// reaches `isSectorPassable`. `Level` answers that with a solid wall by
// default (see world/Level.js); a future open-world `World` (D-007) can
// substitute a real terrain sector instead, and this file needs no change.

/**
 * Is this sector enterable by a capsule whose feet are at `footZ`? `sector`
 * must already be resolved (never a raw `null` from `sectorAt` - see the
 * module note above); a `null` here is defensive-only and treated as
 * impassable.
 * @param {import('../world/Level.js').Sector|null} sector
 * @param {number} footZ - capsule's current feet height (world meters).
 * @param {boolean} grounded
 * @param {{height:number, stepUpMax:number}} opts
 */
export function isSectorPassable(sector, footZ, grounded, opts) {
  if (!sector) return false; // defensive only - world.outsideSector() should never itself return null
  if (sector.solid) return false; // v2: solid blocks at any height

  if (sector.ceilH !== 'sky') {
    const headroom = sector.ceilH - sector.floorH;
    if (headroom < opts.height) return false; // too low to ever fit (e.g. a closed grate)
  }

  const floorDiff = sector.floorH - footZ; // positive = floor is higher than our feet
  if (floorDiff <= 0) return true; // level or lower floor: always fine, may start a fall
  if (grounded && floorDiff <= opts.stepUpMax) return true; // small step, walked smoothly
  return false; // too high a step, or any rise at all while airborne
}

/**
 * Move a circle (capsule footprint, radius `radius`) by (dx, dy) against the
 * world's solid/impassable cells, sliding along walls (axis-separated
 * sweep + push-out, resolved X then Y).
 * @param {{sectorAt:Function, outsideSector?:Function}} world - a `Level`
 *   today; any object with the same `sectorAt`/`outsideSector` shape works
 *   (D-008 - physics never assumes it's specifically a `Level`).
 * @param {number} x
 * @param {number} y
 * @param {number} dx
 * @param {number} dy
 * @param {number} radius
 * @param {number} footZ
 * @param {boolean} grounded
 * @param {{height:number, stepUpMax:number}} opts
 * @returns {{x:number, y:number, blockedX:boolean, blockedY:boolean}}
 */
export function moveCapsule(world, x, y, dx, dy, radius, footZ, grounded, opts) {
  const passable = (col, row) => isSectorPassable(sectorOrOutside(world, col, row), footZ, grounded, opts);

  const targetX = x + dx;
  const newX = resolveAxis(targetX, y, x, 'x', radius, passable);
  const targetY = y + dy;
  const newY = resolveAxis(newX, targetY, y, 'y', radius, passable);

  return {
    x: newX,
    y: newY,
    blockedX: dx !== 0 && newX !== targetX,
    blockedY: dy !== 0 && newY !== targetY,
  };
}

/**
 * (D-008) `world.sectorAt(x, y)`, falling back to `world.outsideSector(x, y)`
 * - never a hard-coded constant - when the position is outside the grid.
 * The one place physics resolves "no sector here" into an actual sector to
 * test against; every other function in this module and in Player.js goes
 * through this instead of hand-rolling the null check.
 * @param {{sectorAt:Function, outsideSector?:Function}} world
 */
export function sectorOrOutside(world, x, y) {
  const sector = world.sectorAt(x, y);
  if (sector) return sector;
  return world.outsideSector ? world.outsideSector(x, y) : null;
}

// Resolve a circle centered at (cx, cy), radius `radius`, against every
// impassable grid cell it overlaps, correcting only the `movingAxis`
// coordinate (the other one is fixed by the caller - this is what gives
// axis-separated sliding). `prevCoord` is the pre-move value of the moving
// axis, used as a safe fallback in the (practically unreachable at these
// per-step speeds) case where the circle's center already lies exactly
// within the cell's span on the fixed axis.
function resolveAxis(cx, cy, prevCoord, movingAxis, radius, passable) {
  let resolved = movingAxis === 'x' ? cx : cy;
  const colMin = Math.floor(cx - radius), colMax = Math.floor(cx + radius);
  const rowMin = Math.floor(cy - radius), rowMax = Math.floor(cy + radius);

  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      if (passable(col, row)) continue;

      const clampedX = Math.min(Math.max(cx, col), col + 1);
      const clampedY = Math.min(Math.max(cy, row), row + 1);
      const dx = cx - clampedX;
      const dy = cy - clampedY;
      const distSq = dx * dx + dy * dy;
      if (distSq >= radius * radius) continue; // no overlap with this cell

      if (movingAxis === 'x') {
        resolved = dx !== 0 ? (dx > 0 ? col + 1 + radius : col - radius) : prevCoord;
        cx = resolved;
      } else {
        resolved = dy !== 0 ? (dy > 0 ? row + 1 + radius : row - radius) : prevCoord;
        cy = resolved;
      }
    }
  }
  return resolved;
}
