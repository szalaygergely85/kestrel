// game/js/rts/sim/tick.js - RTS-01a/b fixed-step sim (28.8). One simStep = one SIM_STEP (1/60 s); never reads a frame
// dt, the camera or the DOM. Order per step: latch prev = cur (render interpolation), execute the commands due this
// tick (MOVE -> orders), advance the flow fields being built (budgeted), waypoint/arrival bookkeeping, steer.step
// (RE-09 separation + slide), copy steer positions back. No trig / Math.random / Date in here (check-deps rule 15).
import { createSteer, createAStar, findPath, smoothPath, FlowCache, createCommandQueue, SIM_STEP } from '../../../../engine/index.js';
import { STATE_IDLE, STATE_MOVING, PATH_SLOTS } from './units.js';

export const CMD_MOVE = 1;          // ids = unit ids, a0/a1 = target x/y in 1/16 m (Int32)
export const POS_SCALE = 16;
export const PLAYER_1 = 1;
export const UNIT_SPEED = 3.5;      // m/s (b2: 3-4)
const UNIT_ACCEL = 14;              // m/s^2
const STEER_R = 0.42;               // m, separation radius (pick radius UNIT_RADIUS = 0.5 stays in units.js)
export const FLOW_MIN_GROUP = 12;   // groups larger than this share one flow field, smaller ones path per unit (28.8)
const FLOW_CELL_BUDGET = 3072;      // Dijkstra pops per tick per field being built (28.2 amendment)
const WP_ADVANCE = 1.2;             // m: pass an intermediate waypoint
const ARRIVE_R = 0.6;               // m: final waypoint reached
const SLOW_SPEED2 = 0.3 * 0.3;      // (m/s)^2 below which a moving unit counts as stalled
const STALL_NEAR = 90;              // ticks (0.75 s) stalled near the goal -> arrived (crowd at the target)
const STALL_GIVEUP = 600;           // ticks (10 s) stalled anywhere -> give up (blocked in a crowd)
const NEAR_INTEG = 25;              // flow integ units (10 per metre) that count as "near the goal"
const NEAR_DIST = 3;                // m, same for waypoint paths
const UNREACHED = 0xFFFFFFFF;
const MAX_GOALS = 256;
const SNAP_R = 12;                  // cells searched for a walkable cell around a click
const FORM_SPACING = 1.3;           // m between formation slots of small groups

// Formation slots of a small group: a square lattice sorted by distance from the centre (ties by row, col).
const FORM = (() => {
  const t = [];
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) t.push({ i, j, d: i * i + j * j, k: (j + 3) * 7 + i + 3 });
  t.sort((a, b) => a.d - b.d || a.k - b.k);
  const o = new Float64Array(t.length * 2);
  t.forEach((e, n) => { o[n * 2] = e.i * FORM_SPACING; o[n * 2 + 1] = e.j * FORM_SPACING; });
  return o;
})();

/**
 * Sim = units SoA + steer + nav tools + command queue + flow fields in flight. Load time allocates, steps do not.
 * @param {ReturnType<import('./units.js').createUnits>} units
 * @param {any} nav NavGrid
 * @param {{flowMin?:number}} [opts] flowMin overrides FLOW_MIN_GROUP (tests)
 */
export function createSim(units, nav, opts = {}) {
  const flowMin = opts.flowMin ?? FLOW_MIN_GROUP;
  const steer = createSteer({ maxAgents: units.max, hashCell: 2, maxNeighbours: 8, sepW: 3, idleSepW: 1,
    bounds: { x0: nav.x0, y0: nav.y0, w: nav.w * nav.cell, h: nav.h * nav.cell } });
  for (let i = 0; i < units.count; i++) steer.addAgent(units.x[i], units.y[i], STEER_R, UNIT_SPEED, UNIT_ACCEL);
  const astar = createAStar(nav);
  const sim = {
    units, nav, steer, astar,
    q: createCommandQueue({ inputDelay: 0, maxRecords: 256, maxIds: 8192 }),
    cache: new FlowCache(nav, 8, MAX_GOALS),
    flowRef: /** @type {any[]} */ (new Array(units.max).fill(null)),
    pending: /** @type {any[]} */ ([]),       // flow fields still integrating (<= cache slots)
    goalScratch: new Int32Array(MAX_GOALS),
    cellPath: new Int32Array(nav.w * nav.h),
    xyScratch: new Float64Array(nav.w * nav.h * 2),
    snap: { x: 0, y: 0 },
    flowMin,
    handler: null,
    moving: 0,
  };
  sim.handler = (q, rec) => { if (q.type(rec) === CMD_MOVE) applyMove(sim, q, rec); };
  return sim;
}

/** Nearest walkable cell centre to (x,y) within SNAP_R cells -> sim.snap. Returns false if none. */
function snapWalkable(sim, x, y) {
  const nav = sim.nav, cx0 = nav.cellX(x), cy0 = nav.cellY(y);
  let best = -1, bx = 0, by = 0, bd = 1e30;
  for (let cy = cy0 - SNAP_R; cy <= cy0 + SNAP_R; cy++) {
    for (let cx = cx0 - SNAP_R; cx <= cx0 + SNAP_R; cx++) {
      if (!nav.inBounds(cx, cy) || nav.cost[nav.index(cx, cy)] === 0) continue;
      const dx = nav.cellCenterX(cx) - x, dy = nav.cellCenterY(cy) - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = 1; bx = cx; by = cy; }
    }
  }
  if (best < 0) return false;
  // keep the exact click point when its own cell is walkable, else the cell centre
  if (bx === cx0 && by === cy0) { sim.snap.x = x; sim.snap.y = y; } else { sim.snap.x = nav.cellCenterX(bx); sim.snap.y = nav.cellCenterY(by); }
  return true;
}

function sendIdle(sim, id) {
  const u = sim.units;
  sim.steer.setIdle(id); u.state[id] = STATE_IDLE; sim.flowRef[id] = null; u.pathLen[id] = 0; u.stall[id] = 0;
}

function applyMove(sim, q, rec) {
  const u = sim.units, nav = sim.nav, steer = sim.steer;
  const n = q.nIds(rec);
  const tx = q.a0(rec) / POS_SCALE, ty = q.a1(rec) / POS_SCALE;
  if (!snapWalkable(sim, tx, ty)) return;
  const gx = sim.snap.x, gy = sim.snap.y;
  if (n > sim.flowMin) { // one shared flow field, goal = a disc of cells sized to the group
    const r = Math.sqrt(n * 0.7 * 0.3183) + 0.2;
    const gs = sim.goalScratch;
    let cnt = 0;
    const c0x = nav.cellX(gx), c0y = nav.cellY(gy), span = Math.ceil(r);
    for (let cy = c0y - span; cy <= c0y + span && cnt < MAX_GOALS; cy++) {
      for (let cx = c0x - span; cx <= c0x + span && cnt < MAX_GOALS; cx++) {
        if (!nav.inBounds(cx, cy) || nav.cost[nav.index(cx, cy)] === 0) continue;
        const dx = nav.cellCenterX(cx) - gx, dy = nav.cellCenterY(cy) - gy;
        if (dx * dx + dy * dy <= r * r) gs[cnt++] = nav.index(cx, cy);
      }
    }
    if (cnt === 0) gs[cnt++] = nav.index(c0x, c0y);
    const ff = sim.cache.get(gs, cnt, q.tick);
    if (sim.pending.indexOf(ff) < 0) sim.pending.push(ff);
    for (let k = 0; k < n; k++) {
      const id = q.idAt(rec, k);
      if (id >= u.count) continue;
      steer.setFlow(id, ff, 1.0);
      sim.flowRef[id] = ff; u.state[id] = STATE_MOVING; u.pathLen[id] = 0; u.stall[id] = 0; u.tx[id] = gx; u.ty[id] = gy;
    }
    return;
  }
  // small group: A* per unit to its own formation slot, string-pulled, final waypoint = the slot itself
  for (let k = 0; k < n; k++) {
    const id = q.idAt(rec, k);
    if (id >= u.count) continue;
    const slot = k < FORM.length / 2 ? k : FORM.length / 2 - 1;
    if (!snapWalkable(sim, gx + FORM[slot * 2], gy + FORM[slot * 2 + 1])) { sim.snap.x = gx; sim.snap.y = gy; }
    const ux = sim.snap.x, uy = sim.snap.y;
    const len = findPath(sim.astar, nav.cellX(u.x[id]), nav.cellY(u.y[id]), nav.cellX(ux), nav.cellY(uy), sim.cellPath, { maxNodes: 8000 });
    let wn = len > 0 ? smoothPath(nav, sim.cellPath, len, sim.xyScratch) : 0;
    const xy = sim.xyScratch, pool = u.pathPool, off = u.pathOff[id];
    let start = wn > 1 ? 1 : 0;                       // waypoint 0 is the start cell
    let m = wn - start;
    if (m > PATH_SLOTS) { // too long for the slots: keep the first PATH_SLOTS-1 and the goal
      for (let w = 0; w < PATH_SLOTS - 1; w++) { pool[off + w * 2] = xy[(start + w) * 2]; pool[off + w * 2 + 1] = xy[(start + w) * 2 + 1]; }
      m = PATH_SLOTS;
    } else {
      for (let w = 0; w < m; w++) { pool[off + w * 2] = xy[(start + w) * 2]; pool[off + w * 2 + 1] = xy[(start + w) * 2 + 1]; }
      if (m === 0) m = 1;
    }
    pool[off + (m - 1) * 2] = ux; pool[off + (m - 1) * 2 + 1] = uy; // the exact slot point
    u.pathLen[id] = m; u.pathPos[id] = 0; u.stall[id] = 0; u.state[id] = STATE_MOVING; sim.flowRef[id] = null;
    u.tx[id] = ux; u.ty[id] = uy;
    steer.setWaypoint(id, pool[off], pool[off + 1], m === 1 ? 1.5 : 0);
  }
}

/** Per-tick bookkeeping for one moving unit: waypoint advance, arrival, give-up. */
function follow(sim, i) {
  const u = sim.units, steer = sim.steer;
  const vx = steer.vx[i], vy = steer.vy[i];
  const slow = vx * vx + vy * vy < SLOW_SPEED2;
  const stall = slow ? (u.stall[i] < 65535 ? u.stall[i] + 1 : 65535) : 0;
  u.stall[i] = stall;
  const ff = sim.flowRef[i];
  if (ff) {
    const nav = sim.nav, cx = nav.cellX(steer.x[i]), cy = nav.cellY(steer.y[i]);
    const integ = nav.inBounds(cx, cy) ? ff.integ[nav.index(cx, cy)] : UNREACHED;
    if (integ === 0) { sendIdle(sim, i); return; }
    if (stall > STALL_GIVEUP || (stall > STALL_NEAR && integ < NEAR_INTEG)) sendIdle(sim, i);
    return;
  }
  const pos = u.pathPos[i], len = u.pathLen[i], off = u.pathOff[i] + pos * 2;
  const dx = u.pathPool[off] - steer.x[i], dy = u.pathPool[off + 1] - steer.y[i];
  const d2 = dx * dx + dy * dy;
  if (pos < len - 1) {
    if (d2 < WP_ADVANCE * WP_ADVANCE) {
      u.pathPos[i] = pos + 1;
      const o2 = off + 2;
      steer.setWaypoint(i, u.pathPool[o2], u.pathPool[o2 + 1], pos + 1 === len - 1 ? 1.5 : 0);
    }
    return;
  }
  if (d2 <= ARRIVE_R * ARRIVE_R || stall > STALL_GIVEUP || (stall > STALL_NEAR && d2 < NEAR_DIST * NEAR_DIST)) sendIdle(sim, i);
}

/** @param {ReturnType<typeof createSim>} sim */
export function simStep(sim) {
  const u = sim.units, n = u.count, x = u.x, y = u.y, px = u.prevX, py = u.prevY;
  for (let i = 0; i < n; i++) { px[i] = x[i]; py[i] = y[i]; }
  sim.q.execute(sim.handler);
  const pend = sim.pending;
  for (let k = pend.length - 1; k >= 0; k--) if (pend[k].step(FLOW_CELL_BUDGET)) { pend[k] = pend[pend.length - 1]; pend.pop(); }
  let moving = 0;
  for (let i = 0; i < n; i++) if (u.state[i] === STATE_MOVING) { follow(sim, i); if (u.state[i] === STATE_MOVING) moving++; }
  sim.moving = moving;
  sim.steer.step(SIM_STEP, sim.nav);
  const sx = sim.steer.x, sy = sim.steer.y;
  for (let i = 0; i < n; i++) { x[i] = sx[i]; y[i] = sy[i]; }
  u.tick++;
}
