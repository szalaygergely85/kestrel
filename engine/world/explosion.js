// engine/world/explosion.js - US-136 (architecture.md 32.4). Pure explosion
// query, next to meleeArc.js: no events, no damage, no allocation. The game
// (US-137) turns hits into `explosion:hit` events and calls `applyImpulse`.

/**
 * @param {{raySegment:Function}} world  World (mesh or grid)
 * @param {number} ex @param {number} ey @param {number} ez  blast centre
 * @param {number} radius
 * @param {{count:number,x:ArrayLike<number>,y:ArrayLike<number>,z:ArrayLike<number>,r:ArrayLike<number>,h:ArrayLike<number>}} cand
 *   SoA candidates (z = feet); the game's shared targetables list (30.1) or any list
 * @param {Int32Array|number[]} outIdx candidate index per hit
 * @param {Float64Array|number[]} outF falloff 0..1 per hit (1 at the surface-touching centre, 0 at the radius)
 * @param {Float64Array|number[]} outDir unit direction centre -> target centre, 3 per hit
 * @param {{t:number,x:number,y:number,z:number}} ray scratch for raySegment
 * @returns {number} number of hits (capped by outIdx.length)
 *
 * Per candidate (index order): cz = clamp(ez, z, z+h); dS = max(0, |(x,y,cz)-e| - r);
 * skip if dS >= radius; f = 1 - dS/radius. LOS: raySegment(e -> (x,y,z+h/2)) is
 * blocked iff it hit and ray.t*L < L - r - 0.05 (L = |centre - e|). Limits of
 * raySegment: the t=0 start is not sampled, a zero-length segment is a miss
 * (so a blast exactly at the centre is never occluded). The exploding prop
 * must be removed by the caller before the query.
 */
export function explosionHits(world, ex, ey, ez, radius, cand, outIdx, outF, outDir, ray) {
  const { x, y, z, r, h } = cand;
  const cap = Math.min(outIdx.length, outF.length, Math.floor(outDir.length / 3));
  const count = cand.count;
  let n = 0;
  for (let i = 0; i < count && n < cap; i++) {
    const zi = z[i], hi = h[i], ri = r[i];
    const cz = ez < zi ? zi : (ez > zi + hi ? zi + hi : ez);
    const dx0 = x[i] - ex, dy0 = y[i] - ey, dz0 = cz - ez;
    const dS = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0) - ri;
    const ds = dS > 0 ? dS : 0;
    if (ds >= radius) continue;
    const mz = zi + hi * 0.5;
    const dx = dx0, dy = dy0, dz = mz - ez;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L > 1e-6 && world.raySegment(ex, ey, ez, x[i], y[i], mz, ray) && ray.t * L < L - ri - 0.05) continue;
    const o = n * 3;
    if (L < 1e-6) { outDir[o] = 0; outDir[o + 1] = 0; outDir[o + 2] = 1; }
    else { const k = 1 / L; outDir[o] = dx * k; outDir[o + 1] = dy * k; outDir[o + 2] = dz * k; }
    outIdx[n] = i;
    outF[n] = 1 - ds / radius;
    n++;
  }
  return n;
}
