// SWIM-06a: sea-edge trigger (pure, no engine). Swim too far from the Long Strand and a sea monster strikes (D-070).
// Distances come from ONE config; the shore line is derived from world_geo coast data (beach-kind segments).
export const SEA_EDGE_CONFIG = {
  warnM: 60,        // dark shape starts circling beyond this distance from the shore
  killM: 90,        // strike beyond this distance (owner distance still open)
  hysteresisM: 6,   // must come back this much inside a border before the level drops
  spawnOutM: 25,    // circling shape sits this far further out to sea than the player
};

export const SHORE_KINDS = ['beach', 'cliff'];

// Build the shore from coast = {pts, kinds}: every coast segment that meets open sea (beach AND cliff; WM-09, whole map) + the full
// sea polygon (for the land/sea test). 'open' = map-edge closing segments of the polygon, not a shore. Lakes/rivers are never in `poly`.
// `kinds` = which segment kinds count (default all but 'open'); pass ['beach'] for the old Long-Strand-only shore.
export function createShore(coast, kinds = SHORE_KINDS) {
  const P = coast.pts, n = P.length, segs = [];
  for (let k = 0; k < n; k++) {
    if (!kinds.includes(coast.kinds[k])) continue;
    const a = P[k], b = P[(k + 1) % n];
    segs.push(a[0], a[1], b[0], b[1]);
  }
  return { poly: P, segs: new Float64Array(segs) };
}

// Sea polygon contains (x,y) = the point is in the water.
export function inSea(shore, x, y) {
  const P = shore.poly; let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export function createSeaEdgeOut() {
  // state: 0 safe, 1 warn, 2 kill. dist: m to the shore line. spawn: circling shape (valid when state>=1). strike: state==2.
  return { state: 0, name: 'safe', dist: 0, spawnX: 0, spawnY: 0, strike: false };
}
const NAMES = ['safe', 'warn', 'kill'];

// pos {x,y}; out doubles as the hysteresis memory (pass the same object every call). Returns out. 0 alloc.
export function seaEdgeState(pos, shore, out, cfg = SEA_EDGE_CONFIG) {
  const S = shore.segs, x = pos.x, y = pos.y;
  let best = Infinity, nx = x, ny = y;
  for (let i = 0; i < S.length; i += 4) {
    const ax = S[i], ay = S[i + 1], dx = S[i + 2] - ax, dy = S[i + 3] - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(x - px, y - py);
    if (d < best) { best = d; nx = px; ny = py; }
  }
  const wet = inSea(shore, x, y);
  const d = wet ? best : 0;          // on land: distance 0 = safe
  const h = cfg.hysteresisM, prev = out.state;
  let s = 0;
  if (d >= cfg.killM - (prev === 2 ? h : 0)) s = 2;
  else if (d >= cfg.warnM - (prev >= 1 ? h : 0)) s = 1;
  out.state = s; out.name = NAMES[s]; out.dist = d; out.strike = s === 2;
  if (s > 0) {  // outward = from nearest shore point through the player; shape lies between player and open sea
    const len = best > 1e-6 ? best : 1;
    out.spawnX = x + (x - nx) / len * cfg.spawnOutM;
    out.spawnY = y + (y - ny) / len * cfg.spawnOutM;
  }
  return out;
}
