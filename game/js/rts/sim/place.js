// game/js/rts/sim/place.js - RTS-01a seeded unit placement (28.8): rejection sampling with the sim RNG (never
// Math.random), walkable cells only (NavGrid cost > 0), a minimum spacing, teams alternate by id (50/50).
import { createRng } from '../../../../engine/index.js';
import { addUnit, TEAM_OWN, TEAM_ENEMY } from './units.js';

/**
 * @param {ReturnType<import('./units.js').createUnits>} u
 * @param {number} n units to add
 * @param {number} seed
 * @param {any} nav NavGrid
 * @param {{cx:number, cy:number, radius:number, minDist?:number}} area placement disc
 * @returns {number} units placed (== n unless the disc is too crowded)
 */
export function placeUnits(u, n, seed, nav, area) {
  const rng = createRng(seed);
  const minD2 = (area.minDist ?? 1.1) * (area.minDist ?? 1.1);
  const r2 = area.radius * area.radius;
  let placed = 0;
  for (let tries = 0; placed < n && tries < n * 400; tries++) {
    const x = area.cx + (rng.nextFloat() * 2 - 1) * area.radius;
    const y = area.cy + (rng.nextFloat() * 2 - 1) * area.radius;
    const dx = x - area.cx, dy = y - area.cy;
    if (dx * dx + dy * dy > r2) continue;
    const cx = nav.cellX(x), cy = nav.cellY(y);
    if (!nav.inBounds(cx, cy) || nav.cost[nav.index(cx, cy)] === 0) continue;
    let crowded = false;
    for (let j = 0; j < u.count; j++) {
      const ex = u.x[j] - x, ey = u.y[j] - y;
      if (ex * ex + ey * ey < minD2) { crowded = true; break; }
    }
    if (crowded) continue;
    addUnit(u, x, y, (u.count & 1) === 0 ? TEAM_OWN : TEAM_ENEMY);
    placed++;
  }
  return placed;
}
