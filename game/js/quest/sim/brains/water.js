// game/js/quest/sim/brains/water.js (BEAST-08a, architecture.md 38.64 item 5). Swim movement for water-medium beasts over the
// water-mask grids from beastNav.buildWaterNav: swimmers (eel, turtle, ...) walk only mask 1, crocodiles mask 1 or 2 (bank band).
// A slot wanders: pick a hashed target cell, A* on its grid, follow the cell-centre path at `speed`. SUBMERGED z = surface - 0.4
// (the view shows the eyes only). Attacks / GRAB / lunge are BEAST-08b and plug into this pool. Rule 15: no Math.random, no trig,
// no clock; per-step picks use hashU(seed, slot, tick); 0 allocation in step (all buffers made in create).
import { findPath } from '../../../../../engine/index.js';
import { hashU } from '../../../life/schedule.js';

export const SWIM_SUBMERGE_M = 0.4;
export const KIND_SWIMMER = 0, KIND_CROC = 1;
export const SW_SUBMERGED = 20; // = beastSim STATE_SUBMERGED
const PATH_MAX = 160, PICKS = 6;

/**
 * @param {{mask:Uint8Array, surf:Float32Array, grid:any, swim:{grid:any,astar:any}, croc:{grid:any,astar:any}}} nav buildWaterNav result
 * @param {{max?:number, seed?:number, speed?:number}} [o] speed in m/s
 */
export function createSwimmers(nav, o = {}) {
  const max = o.max ?? 16, dt = 1 / 60;
  return {
    nav, max, n: 0, seed: o.seed ?? 1, tick: 0, step1: (o.speed ?? 1.2) * dt, guard: 0,
    x: new Float32Array(max), y: new Float32Array(max), z: new Float32Array(max),
    sp: new Float64Array(max).fill((o.speed ?? 1.2) * dt), kind: new Uint8Array(max), state: new Uint8Array(max), wait: new Int32Array(max),
    pathLen: new Int32Array(max), pathPos: new Int32Array(max), path: new Int32Array(max * PATH_MAX),
    tmp: new Int32Array(PATH_MAX),
  };
}

const gridOf = (s, k) => (k === KIND_CROC ? s.nav.croc : s.nav.swim);

/** Spawn at (x,y); returns the slot, or -1 when the cell is not walkable for that kind or the pool is full. */
export function spawnSwimmer(s, kind, x, y) {
  if (s.n >= s.max) return -1;
  const g = gridOf(s, kind).grid, cx = g.cellX(x), cy = g.cellY(y);
  if (!g.inBounds(cx, cy) || g.cost[cy * g.w + cx] === 0) return -1;
  const i = s.n++;
  s.kind[i] = kind; s.state[i] = SW_SUBMERGED; s.x[i] = x; s.y[i] = y; s.z[i] = s.nav.surf[cy * g.w + cx] - SWIM_SUBMERGE_M;
  s.wait[i] = 0; s.pathLen[i] = 0; s.pathPos[i] = 0;
  return i;
}

function pickPath(s, i) {
  const { grid, astar } = gridOf(s, s.kind[i]), w = grid.w, h = grid.h;
  const sx = grid.cellX(s.x[i]), sy = grid.cellY(s.y[i]);
  let hv = hashU(s.seed + i, s.tick, 1); // ONE hash per pick (an unoptimised call boxes its uint32 result); candidates come from its bits
  for (let k = 0; k < PICKS; k++) {
    const gx = sx - 12 + (hv & 0xff) % 25, gy = sy - 12 + ((hv >>> 8) & 0xff) % 25;
    hv = (Math.imul(hv, 1103515245) + 12345) | 0;
    if (gx < 0 || gy < 0 || gx >= w || gy >= h || grid.cost[gy * w + gx] === 0 || (gx === sx && gy === sy)) continue;
    const len = findPath(astar, sx, sy, gx, gy, s.tmp);
    if (len < 2 || astar.partial) continue;
    const m = len < PATH_MAX ? len : PATH_MAX, base = i * PATH_MAX;
    for (let p = 0; p < m; p++) s.path[base + p] = s.tmp[p];
    s.pathLen[i] = m; s.pathPos[i] = 1;
    return;
  }
  s.wait[i] = 30 + ((s.tick + i * 37) & 63); // nothing reachable this pick: idle a little, retry
}

/** One 60 Hz step for every swimmer. */
export function stepSwimmers(s) {
  s.tick++;
  for (let i = 0; i < s.n; i++) stepSwimmer(s, i);
}

/** BEAST-08b: init slot i directly (beastSim owns the slot numbers). false = cell not walkable for that kind. */
export function initSwimmer(s, i, kind, x, y) {
  const g = gridOf(s, kind).grid, cx = g.cellX(x), cy = g.cellY(y);
  if (!g.inBounds(cx, cy) || g.cost[cy * g.w + cx] === 0) return false;
  s.kind[i] = kind; s.state[i] = SW_SUBMERGED; s.x[i] = x; s.y[i] = y; s.z[i] = s.nav.surf[cy * g.w + cx] - SWIM_SUBMERGE_M;
  s.wait[i] = 0; s.pathLen[i] = 0; s.pathPos[i] = 0;
  if (s.n <= i) s.n = i + 1;
  return true;
}

/** One wander step for slot i (the body of stepSwimmers; `s.tick` is advanced by the caller). */
export function stepSwimmer(s, i) {
  {
    if (s.wait[i] > 0) { s.wait[i]--; return; }
    if (s.pathPos[i] >= s.pathLen[i]) { pickPath(s, i); return; }
    const grid = gridOf(s, s.kind[i]).grid, c = s.path[i * PATH_MAX + s.pathPos[i]];
    const tx = grid.cellCenterX(c % grid.w), ty = grid.cellCenterY((c / grid.w) | 0);
    const dx = tx - s.x[i], dy = ty - s.y[i], d2 = dx * dx + dy * dy, st = s.sp[i];
    let nx, ny, arrived = false;
    if (d2 <= st * st) { nx = tx; ny = ty; arrived = true; } else { const inv = st / Math.sqrt(d2); nx = s.x[i] + dx * inv; ny = s.y[i] + dy * inv; }
    const cx = grid.cellX(nx), cy = grid.cellY(ny);
    if (!grid.inBounds(cx, cy) || grid.cost[cy * grid.w + cx] === 0) { // a diagonal clipped a blocked corner: snap onto the path cell
      nx = tx; ny = ty; arrived = true; s.guard++;
    }
    s.x[i] = nx; s.y[i] = ny;
    if (arrived) {
      s.pathPos[i]++;
      if (s.pathPos[i] >= s.pathLen[i]) s.wait[i] = 20 + ((Math.imul(s.tick, 2654435761 | 0) >>> 24) % 100);
    }
    s.z[i] = s.nav.surf[grid.cellY(ny) * grid.w + grid.cellX(nx)] - SWIM_SUBMERGE_M;
  }
}

/** Mask value (0/1/2) under slot i. */
export function swimmerMask(s, i) {
  const g = s.nav.grid;
  return s.nav.mask[g.cellY(s.y[i]) * g.w + g.cellX(s.x[i])];
}
