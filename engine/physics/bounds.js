// engine/physics/bounds.js (WS1-01, architecture.md 38.36 item 1).
// Walk bound = one circle or a union (1..8) of convex parts (circle / capsule).
// Stand-alone: imports nothing. Zero allocation (caller-owned `out`).
//   bounds: {shape:'circle', x, y, r}
//         | {shape:'union', parts:[{shape:'circle',x,y,r} | {shape:'capsule',ax,ay,bx,by,r}, ...]}
const EPS = 1e-6;

// Distance from (x,y) to the part's core (point or segment); writes the core point to `core`.
const core = { x: 0, y: 0 };
function partDist(p, x, y) {
  if (p.shape === 'capsule') {
    const sx = p.bx - p.ax, sy = p.by - p.ay;
    const l2 = sx * sx + sy * sy;
    let t = l2 > 0 ? ((x - p.ax) * sx + (y - p.ay) * sy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    core.x = p.ax + sx * t; core.y = p.ay + sy * t;
  } else {
    core.x = p.x; core.y = p.y;
  }
  return Math.hypot(x - core.x, y - core.y);
}

/** Signed overshoot of a capsule body (radius) past the bound: <= 0 inside, > 0 outside. */
export function boundsOvershoot(bounds, x, y, radius) {
  if (bounds.shape !== 'union') return partDist(bounds, x, y) - (bounds.r - radius);
  const parts = bounds.parts;
  let best = Infinity;
  for (let i = 0; i < parts.length; i++) {
    const o = partDist(parts[i], x, y) - (parts[i].r - radius);
    if (o < best) best = o;
  }
  return best;
}

/**
 * If outside, writes the projected position and outward unit normal into out
 * {x, y, nx, ny} and returns true; inside (or degenerate) returns false.
 */
export function projectBounds(bounds, x, y, radius, out) {
  let part = bounds;
  if (bounds.shape === 'union') {
    const parts = bounds.parts;
    let best = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const o = partDist(parts[i], x, y) - (parts[i].r - radius);
      if (o <= 0) return false;
      if (o < best) { best = o; part = parts[i]; }
    }
  }
  const d = partDist(part, x, y);
  const lim = part.r - radius;
  if (!(d > lim && d > EPS)) return false;
  const nx = (x - core.x) / d, ny = (y - core.y) / d;
  out.x = core.x + nx * lim;
  out.y = core.y + ny * lim;
  out.nx = nx; out.ny = ny;
  return true;
}
