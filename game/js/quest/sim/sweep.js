// game/js/quest/sim/sweep.js (EQ-08, docs/architecture.md 38.41): the swept segment test shared by the fireball and the arrows.
// Segment p0 -> p1 vs World.raySegment + the vertical cylinders of the targetables (radius + pad, height +- pad). Ties go to the target.
// Rule 15 (sim/**): no alloc, no Math.random. Moved verbatim from fireball.js (behaviour unchanged).
export const NO_HIT = 0, WORLD_HIT = 1, TARGET_HIT = 2;
const _ray = { t: 0, x: 0, y: 0, z: 0 };

/**
 * Fills `hit` {kind, t (fraction 0..1), idx (target index or -1), x, y, z}.
 * @param {any} world @param {any} targets createTargetables() list @param {number} pad metres
 */
export function sweepSegment(world, targets, pad, x0, y0, z0, x1, y1, z1, hit) {

  hit.kind = NO_HIT; hit.idx = -1; hit.t = 1;
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  let tw = 2;
  if (dx * dx + dy * dy + dz * dz > 1e-12 && world.raySegment(x0, y0, z0, x1, y1, z1, _ray)) tw = _ray.t;
  let tt = 2, ti = -1;
  const a = dx * dx + dy * dy;
  for (let i = 0; i < targets.count; i++) {
    const R = targets.r[i];
    if (R < 0) continue;
    const Rp = R + pad, fx = x0 - targets.x[i], fy = y0 - targets.y[i];
    let lo, hi;
    if (a < 1e-12) {
      if (fx * fx + fy * fy > Rp * Rp) continue;
      lo = 0; hi = 1;
    } else {
      const b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - Rp * Rp;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      lo = (-b - sq) / (2 * a); hi = (-b + sq) / (2 * a);
      if (lo < 0) lo = 0;
      if (hi > 1) hi = 1;
      if (lo > hi) continue;
    }
    const zl = targets.z[i] - pad, zh = targets.z[i] + targets.h[i] + pad;
    if (dz > -1e-12 && dz < 1e-12) {
      if (z0 < zl || z0 > zh) continue;
    } else {
      let s1 = (zl - z0) / dz, s2 = (zh - z0) / dz;
      if (s1 > s2) { const s = s1; s1 = s2; s2 = s; }
      if (s1 > lo) lo = s1;
      if (s2 < hi) hi = s2;
      if (lo > hi) continue;
    }
    if (lo < tt) { tt = lo; ti = i; }
  }
  if (ti >= 0 && tt <= tw) {
    hit.kind = TARGET_HIT; hit.t = tt; hit.idx = ti;
  } else if (tw <= 1) {
    hit.kind = WORLD_HIT; hit.t = tw;
  } else return;
  hit.x = x0 + dx * hit.t; hit.y = y0 + dy * hit.t; hit.z = z0 + dz * hit.t;
}
