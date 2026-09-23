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
//   - it has head clearance for the capsule's CURRENT head height (US-009
//     AC5, architecture.md 7.1 item 3): `max(footZ, floorH) + height <=
//     ceilH + SKIN`, numeric ceilings only (`'sky'` skips the check). Using
//     the mover's own head height (not just the cell's own headroom) is
//     what makes a lintel a wall when approached from above/mid-jump and a
//     doorway when approached at floor level, and
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

// PO REJECT #1 (US-008) bugfix, still in force under the rework #3
// algorithm below: a tiny "skin" tolerance on the overlap test so a capsule
// resting EXACTLY on a cell boundary (radius away, e.g. after a previous
// push-out) is never re-flagged as overlapping due to float rounding (e.g.
// `2.3 - 2` is 0.2999999999999998 in IEEE 754, not exactly 0.3, so `dx*dx`
// can land fractionally under `radius*radius` even though the true
// geometric distance is exactly `radius`).
const SKIN = 1e-6;

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
    // US-009 AC5: gated on the mover's CURRENT head height, not just the
    // cell's own headroom - subsumes the old `ceilH - floorH < height`
    // check (that's this same test with footZ === floorH). The `+ SKIN` is
    // load-bearing: after a ceiling clamp (`z = ceilH - height`), `z +
    // height` can differ from `ceilH` by a float ulp and this cell (the
    // mover's own) would otherwise turn impassable every step - frozen
    // under a low ceiling (see architecture.md 7.1 item 3).
    const headTop = Math.max(footZ, sector.floorH) + opts.height;
    if (headTop > sector.ceilH + SKIN) return false;
  }

  const floorDiff = sector.floorH - footZ; // positive = floor is higher than our feet
  if (floorDiff <= 0) return true; // level or lower floor: always fine, may start a fall
  if (grounded && floorDiff <= opts.stepUpMax) return true; // small step, walked smoothly
  return false; // too high a step, or any rise at all while airborne
}

/**
 * Move a circle (capsule footprint, radius `radius`) by (dx, dy) against the
 * world's solid/impassable cells: an ITERATIVE MINIMUM-TRANSLATION PUSH-OUT
 * (US-008 ARCH CHANGES, rework #3), resolving the single deepest contact
 * each pass (face or corner) until nothing overlaps or 4 iterations are
 * spent. Replaces the old axis-separated sweep (rework #2), which pushed a
 * corner contact out along a single axis and could freeze the capsule dead
 * on a convex corner (AC3 "never stuck on corners" - see docs/backlog.md
 * US-008 ARCH CHANGES for the failure mode and worked probes).
 *
 * Why "deepest first": at a shared corner of two solid cells, the FACE of
 * one of them is always at least as deep as the corner point (a face
 * penetration is a straight-line distance to an edge, which is <= the
 * distance to that edge's endpoint). Resolving the face first removes the
 * corner overlap in the same pass; scanning cells in plain grid order
 * instead can hit the corner first and produce a spurious diagonal nudge
 * along what is really just a flat wall.
 *
 * No per-step allocations (architecture.md section 9): no closure over
 * `world`/`footZ`/`grounded`/`opts` (the passability test is inlined in the
 * scan loop), no object literals, and the result is written into the
 * caller-owned `out` scratch object rather than returned fresh each call.
 *
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
 * @param {{x:number, y:number, blockedX:boolean, blockedY:boolean, nx:number, ny:number}} out
 *   caller-owned scratch, overwritten and returned (rule 9.3: no per-step
 *   object returns). `blockedX`/`blockedY` = a FACE contact resolved on
 *   that axis this call; `nx`/`ny` = unit normal of the last CORNER contact
 *   resolved this call (0,0 if none - do not stack across calls, the caller
 *   reads them fresh every step).
 * @returns {typeof out}
 */
export function moveCapsule(world, x, y, dx, dy, radius, footZ, grounded, opts, out) {
  let cx = x + dx;
  let cy = y + dy;
  let blockedX = false;
  let blockedY = false;
  let nx = 0;
  let ny = 0;

  const skinRadius = radius - SKIN;
  const skinRadiusSq = skinRadius * skinRadius;

  for (let iter = 0; iter < 4; iter++) {
    const colMin = Math.floor(cx - radius), colMax = Math.floor(cx + radius);
    const rowMin = Math.floor(cy - radius), rowMax = Math.floor(cy + radius);

    // Track the single deepest overlapping cell this pass - no array, just
    // scalars overwritten in place (rule 9.3).
    let found = false;
    let bestDepth = -Infinity;
    let bestQx = 0, bestQy = 0, bestDx = 0, bestDy = 0, bestDist = 0;

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        // Passability test inlined here (no `passable` closure - rule 9.3).
        if (isSectorPassable(sectorOrOutside(world, col + 0.5, row + 0.5), footZ, grounded, opts)) continue;

        const qx = Math.min(Math.max(cx, col), col + 1);
        const qy = Math.min(Math.max(cy, row), row + 1);
        const ddx = cx - qx;
        const ddy = cy - qy;
        const distSq = ddx * ddx + ddy * ddy;
        if (distSq >= skinRadiusSq) continue; // not really overlapping (within the skin) - see SKIN below

        const dist = Math.sqrt(distSq);
        const depth = radius - dist; // penetration depth; bigger = deeper contact
        if (depth > bestDepth) {
          found = true;
          bestDepth = depth;
          bestQx = qx; bestQy = qy;
          bestDx = ddx; bestDy = ddy; bestDist = dist;
        }
      }
    }

    if (!found) break; // nothing overlaps any more - done

    if (bestDx === 0 && bestDy === 0) {
      // Centre already inside the cell's footprint on both axes: defensive
      // only (unreachable at the 0.1 m/step this game moves - see the
      // non-blocking note in the US-008 ARCH CHANGES). Revert the whole
      // move rather than divide by a zero-length d.
      cx = x; cy = y;
      blockedX = true; blockedY = true;
      nx = 0; ny = 0;
      break;
    } else if (bestDy === 0) {
      // Face contact blocking X (the circle's y already sits inside the
      // cell's row span - this cell only obstructs the x axis).
      cx = bestDx > 0 ? bestQx + radius : bestQx - radius;
      blockedX = true;
    } else if (bestDx === 0) {
      // Face contact blocking Y.
      cy = bestDy > 0 ? bestQy + radius : bestQy - radius;
      blockedY = true;
    } else {
      // Corner contact: the nearest point is the cell's corner, a single
      // point, not a face. Push out exactly `radius` along the corner ->
      // centre direction (circle-vs-point), which lets both axes move and
      // is what makes a tangential slide around a convex corner possible.
      const invDist = 1 / bestDist;
      const unx = bestDx * invDist;
      const uny = bestDy * invDist;
      cx = bestQx + unx * radius;
      cy = bestQy + uny * radius;
      nx = unx; ny = uny;
    }
  }

  out.x = cx;
  out.y = cy;
  out.blockedX = blockedX;
  out.blockedY = blockedY;
  out.nx = nx;
  out.ny = ny;
  return out;
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

// History (rework #1/#2, superseded): this module used to resolve the two
// axes separately via a `resolveAxis(cx, cy, movingAxis, radius, passable)`
// helper (push the moving axis out to `col +/- radius` for a face contact,
// or - after the rework #2 fix - to the exact circle-vs-point distance for
// a corner contact). That fixed the west/north wall-stick bug (rework #1)
// and the backward corner overshoot (rework #2), but per-axis resolution
// cannot express a tangential slide around a genuinely convex corner: both
// passes independently pull the touching axis back to the contact point,
// zeroing both velocity components and freezing the capsule (US-008 ARCH
// CHANGES, rework #3 - see docs/backlog.md for the probes). The iterative
// minimum-translation push-out in `moveCapsule` above replaces it outright;
// there is no longer a separate per-axis pass or a `passable` closure.
