// @ts-check
// engine/nav/steer.js (RE-09, docs/architecture.md 28.2). Deterministic local
// avoidance + steering over a NavGrid: agents live in a flat SoA, a spatial
// hash is rebuilt every step for neighbour queries, and the velocity update
// is Jacobi-style (every agent reads last step's positions/velocities, so
// the result never depends on slot processing order beyond the fixed
// ascending scan). `createSteer` preallocates everything; `step` and every
// query allocate nothing afterwards (28.2 zero-allocation rule). Agent id
// is its slot index; `addAgent` hands out the lowest free slot first.
//
// API design notes (per the RE-09 task):
// - Flow-field reference storage: `setFlow(id, flowField, arriveR)` stores
//   the `FlowField` object itself in a plain JS array (`_flowRef`,
//   assignment-only - never read or written inside a loop that must stay
//   allocation-free in the sense of "no new objects", just a property
//   lookup). This needs no separate flow-field registry/index and keeps the
//   call site simple (`steer.setFlow(id, cache.get(...), 0.5)`). It doesn't
//   affect numeric determinism: `ff.dirAt(x, y, out)` is a pure, seeded
//   integer-table lookup with no hidden state, so calling it through a
//   stored reference is exactly as deterministic as calling it directly.
// - No-tunnelling assertion: the architecture note's "asserted at create"
//   can't be literal, since `dt` is a `step()` argument, not a constructor
//   option - only the caller's fixed-step loop knows `dt` ahead of time.
//   This implementation checks `maxSpeed*dt < cell/2` at the top of every
//   `step(dt, grid)` call, over every currently active agent's `maxSpeed`.
//   That is a cheap, allocation-free linear scan and stays correct even if
//   `dt` (shouldn't vary in this engine's fixed-step sim, but the function
//   doesn't assume it) or an agent's `maxSpeed` changes between steps. It
//   throws rather than `console.assert`s, matching how NavGrid.block/
//   unblock throw on invariant violations elsewhere in engine/nav.
// - Separation weighting: an agent is classified "stopped" this step if its
//   own desired velocity (seek) is zero - idle mode, a waypoint within its
//   own radius of the target, or a flow-field cell with no direction (goal
//   or unreached). That classification only changes how much *force it
//   exerts on neighbours* (`idleSepW` vs `sepW`); a stopped/idle agent still
//   *receives* full-strength separation from moving neighbours and can be
//   nudged out of the way, which is what avoids permanent gap deadlock.

const MODE_IDLE = 0;
const MODE_WAYPOINT = 1;
const MODE_FLOW = 2;

// Fixed 3x3 hash-cell scan order (row-major, matches the fixed-order
// convention used elsewhere in engine/nav).
const HASH_DY = [-1, -1, -1, 0, 0, 0, 1, 1, 1];
const HASH_DX = [-1, 0, 1, -1, 0, 1, -1, 0, 1];

const ARRIVE_EPS = 1e-9;
const FNV_OFFSET = 0x811c9dc5 | 0;
const FNV_PRIME = 16777619;

/** cx/cy of the hash cell containing (x,y), clamped into [0,hw)/[0,hh). */
function hashCellOf(steer, x, y) {
  let cx = Math.floor((x - steer.bounds.x0) / steer.hashCell);
  let cy = Math.floor((y - steer.bounds.y0) / steer.hashCell);
  if (cx < 0) cx = 0; else if (cx >= steer._hw) cx = steer._hw - 1;
  if (cy < 0) cy = 0; else if (cy >= steer._hh) cy = steer._hh - 1;
  return cy * steer._hw + cx;
}

/** True if world position (x,y) lands in a walkable NavGrid cell. */
function cellWalkable(grid, x, y) {
  const cx = grid.cellX(x);
  const cy = grid.cellY(y);
  return grid.inBounds(cx, cy) && grid.cost[grid.index(cx, cy)] !== 0;
}

// Same straight-step integer cost flowField.js uses, so a flow-follow
// agent's arrive slowdown (below) can compare a world-metre `arriveR`
// against the flow field's own `integ` units without ever calling
// Math.sin/cos or anything outside the allowed float op list.
const FLOW_STRAIGHT_COST = 10;

/**
 * Writes agent `slot`'s desired (seek) velocity and "stopped" classification
 * into `out` ({vx, vy, stopped}, caller-owned scratch). Zero allocation.
 * `grid` is needed only for flow-follow's arrive slowdown (looking up the
 * agent's current cell in the flow field's `integ` array).
 */
function computeDesired(steer, slot, grid, out) {
  const mode = steer.mode[slot];
  if (mode === MODE_WAYPOINT) {
    const dx = steer.tx[slot] - steer.x[slot];
    const dy = steer.ty[slot] - steer.y[slot];
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < ARRIVE_EPS || dist <= steer.radius[slot]) {
      out.vx = 0; out.vy = 0; out.stopped = true;
      return;
    }
    const arriveR = steer.arriveR[slot];
    const slow = arriveR > 0 ? Math.min(1, dist / arriveR) : 1;
    const speed = steer.maxSpeed[slot] * slow;
    out.vx = (dx / dist) * speed;
    out.vy = (dy / dist) * speed;
    out.stopped = false;
    return;
  }
  if (mode === MODE_FLOW) {
    const ff = steer._flowRef[slot];
    if (!ff) { out.vx = 0; out.vy = 0; out.stopped = true; return; }
    const x = steer.x[slot], y = steer.y[slot];
    const fo = steer._flowOut;
    ff.dirAt(x, y, fo);
    if (fo.x === 0 && fo.y === 0) { out.vx = 0; out.vy = 0; out.stopped = true; return; }

    // Arrive slowdown (28.2 doesn't pin this down for flow-follow; without
    // it, an agent moves at full speed right up to the instant it enters a
    // goal cell, where desired velocity snaps to (0,0) - a moving agent
    // right behind it then has no time to react and rear-ends it. Scaling
    // speed down over the last `arriveR` metres, the same way waypoint mode
    // does, gives following agents room to brake). `arriveR = 0` keeps the
    // old abrupt-stop behaviour. Uses the flow field's own integer `integ`
    // field (already computed, no extra float ops) compared against
    // `arriveR` converted to the same units via the straight-step cost.
    const arriveR = steer.arriveR[slot];
    let speedScale = 1;
    if (arriveR > 0) {
      const cx = grid.cellX(x), cy = grid.cellY(y);
      if (grid.inBounds(cx, cy)) {
        const integ = ff.integ[grid.index(cx, cy)];
        const thresh = (arriveR / grid.cell) * FLOW_STRAIGHT_COST;
        if (integ < thresh) speedScale = integ / thresh;
        if (speedScale < 0) speedScale = 0;
      }
    }
    const speed = steer.maxSpeed[slot] * speedScale;
    out.vx = fo.x * speed;
    out.vy = fo.y * speed;
    out.stopped = speedScale <= 0.05;
    return;
  }
  // MODE_IDLE
  out.vx = 0; out.vy = 0; out.stopped = true;
}

/**
 * Fills `steer._nbSlot`/`steer._nbDist2` (first `maxNeighbours` slots) with
 * the K nearest other active agents to `slot`, sorted ascending by
 * (dist2, slot). Uses the spatial hash already rebuilt this step. Returns
 * the count found (<= maxNeighbours). Zero allocation.
 */
function gatherNeighbours(steer, slot) {
  const x = steer.x[slot], y = steer.y[slot];
  let cx = Math.floor((x - steer.bounds.x0) / steer.hashCell);
  let cy = Math.floor((y - steer.bounds.y0) / steer.hashCell);
  if (cx < 0) cx = 0; else if (cx >= steer._hw) cx = steer._hw - 1;
  if (cy < 0) cy = 0; else if (cy >= steer._hh) cy = steer._hh - 1;

  const hw = steer._hw, hh = steer._hh;
  const head = steer._head, next = steer._next;
  const nbSlot = steer._nbSlot, nbDist2 = steer._nbDist2;
  const K = steer.maxNeighbours;
  let count = 0;

  for (let k = 0; k < 9; k++) {
    const ncx = cx + HASH_DX[k];
    const ncy = cy + HASH_DY[k];
    if (ncx < 0 || ncy < 0 || ncx >= hw || ncy >= hh) continue;
    let j = head[ncy * hw + ncx];
    while (j !== -1) {
      if (j !== slot) {
        const dx = steer.x[j] - x;
        const dy = steer.y[j] - y;
        const d2 = dx * dx + dy * dy;
        if (count < K) {
          let p = count;
          while (p > 0 && (nbDist2[p - 1] > d2 || (nbDist2[p - 1] === d2 && nbSlot[p - 1] > j))) {
            nbDist2[p] = nbDist2[p - 1]; nbSlot[p] = nbSlot[p - 1]; p--;
          }
          nbDist2[p] = d2; nbSlot[p] = j;
          count++;
        } else if (d2 < nbDist2[K - 1] || (d2 === nbDist2[K - 1] && j < nbSlot[K - 1])) {
          let p = K - 1;
          while (p > 0 && (nbDist2[p - 1] > d2 || (nbDist2[p - 1] === d2 && nbSlot[p - 1] > j))) {
            nbDist2[p] = nbDist2[p - 1]; nbSlot[p] = nbSlot[p - 1]; p--;
          }
          nbDist2[p] = d2; nbSlot[p] = j;
        }
      }
      j = next[j];
    }
  }
  return count;
}

/**
 * Preallocates a steering system for up to `maxAgents` agents over a world
 * region `bounds = {x0, y0, w, h}` used to size the spatial hash. No later
 * call (`addAgent`/`setWaypoint`/`setFlow`/`step`/`hash`) allocates.
 * @param {{maxAgents:number, hashCell?:number, maxNeighbours?:number,
 *   bounds:{x0:number,y0:number,w:number,h:number}, sepW?:number, idleSepW?:number}} opts
 */
export function createSteer(opts) {
  const maxAgents = opts.maxAgents | 0;
  const hashCell = opts.hashCell ?? 2;
  const maxNeighbours = opts.maxNeighbours ?? 8;
  const bounds = opts.bounds;
  const sepW = opts.sepW ?? 1;
  const idleSepW = opts.idleSepW ?? 0.25;

  const hw = Math.max(1, Math.ceil(bounds.w / hashCell));
  const hh = Math.max(1, Math.ceil(bounds.h / hashCell));
  const nHash = hw * hh;

  const steer = {
    maxAgents, hashCell, maxNeighbours, bounds, sepW, idleSepW,

    x: new Float64Array(maxAgents),
    y: new Float64Array(maxAgents),
    vx: new Float64Array(maxAgents),
    vy: new Float64Array(maxAgents),
    radius: new Float64Array(maxAgents),
    maxSpeed: new Float64Array(maxAgents),
    accel: new Float64Array(maxAgents),
    mode: new Uint8Array(maxAgents),
    active: new Uint8Array(maxAgents),
    tx: new Float64Array(maxAgents),
    ty: new Float64Array(maxAgents),
    arriveR: new Float64Array(maxAgents),
    /** @type {any[]} FlowField object refs, one per slot (see file header). */
    _flowRef: new Array(maxAgents).fill(null),
    /** Exclusive upper bound of slots ever handed out; keeps step()'s scans
     * from walking the full `maxAgents` capacity when fewer are in use. */
    _hi: 0,

    _hw: hw, _hh: hh,
    _head: new Int32Array(nHash).fill(-1),
    _next: new Int32Array(maxAgents).fill(-1),

    _desVx: new Float64Array(maxAgents),
    _desVy: new Float64Array(maxAgents),
    _stopped: new Uint8Array(maxAgents),
    _desOut: { vx: 0, vy: 0, stopped: false },

    _nvx: new Float64Array(maxAgents),
    _nvy: new Float64Array(maxAgents),

    _nbSlot: new Int32Array(maxNeighbours),
    _nbDist2: new Float64Array(maxNeighbours),

    _flowOut: { x: 0, y: 0 },
  };

  // Preallocated u32 views over the Float64 SoA fields for `hash()` (each
  // Float64Array owns a fresh ArrayBuffer at byteOffset 0, so a whole-buffer
  // view is safe). Built once so hash() never allocates.
  const f64Fields = [
    steer.x, steer.y, steer.vx, steer.vy, steer.radius, steer.maxSpeed,
    steer.accel, steer.tx, steer.ty, steer.arriveR,
  ];
  steer._hashViews = f64Fields.map(
    (arr) => new Uint32Array(arr.buffer, arr.byteOffset, arr.length * 2),
  );

  /**
   * Adds an agent at (x,y). Returns the lowest free slot id, or -1 if every
   * slot is in use. New agents start idle with zero velocity.
   */
  steer.addAgent = function addAgent(x, y, radius, maxSpeed, accel) {
    for (let slot = 0; slot < maxAgents; slot++) {
      if (steer.active[slot]) continue;
      steer.active[slot] = 1;
      steer.mode[slot] = MODE_IDLE;
      steer.x[slot] = x; steer.y[slot] = y;
      steer.vx[slot] = 0; steer.vy[slot] = 0;
      steer.radius[slot] = radius;
      steer.maxSpeed[slot] = maxSpeed;
      steer.accel[slot] = accel;
      steer.tx[slot] = x; steer.ty[slot] = y;
      steer.arriveR[slot] = 0;
      steer._flowRef[slot] = null;
      if (slot + 1 > steer._hi) steer._hi = slot + 1;
      return slot;
    }
    return -1;
  };

  /** Frees `id`'s slot (mode -> idle, fields zeroed) for reuse. No-op if
   * `id` is not currently active. */
  steer.removeAgent = function removeAgent(id) {
    if (!steer.active[id]) return;
    steer.active[id] = 0;
    steer.mode[id] = MODE_IDLE;
    steer.x[id] = 0; steer.y[id] = 0;
    steer.vx[id] = 0; steer.vy[id] = 0;
    steer.radius[id] = 0; steer.maxSpeed[id] = 0; steer.accel[id] = 0;
    steer.tx[id] = 0; steer.ty[id] = 0; steer.arriveR[id] = 0;
    steer._flowRef[id] = null;
  };

  /** Sets `id` to waypoint-seek mode 1 toward (tx,ty); `arriveR` is the
   * distance at which speed starts scaling down to 0 (0 = no slow-down,
   * full speed until within the agent's own radius of the target). */
  steer.setWaypoint = function setWaypoint(id, tx, ty, arriveR = 0) {
    steer.mode[id] = MODE_WAYPOINT;
    steer.tx[id] = tx;
    steer.ty[id] = ty;
    steer.arriveR[id] = arriveR;
    steer._flowRef[id] = null;
  };

  /** Sets `id` to flow-follow mode 2: each step it queries
   * `flowField.dirAt(x, y, out)` for its desired direction. `arriveR` (metres,
   * 0 = off) scales speed down over the last `arriveR` metres of `integ`
   * distance to the goal, the same shape as `setWaypoint`'s arrive
   * behaviour - without it, speed snaps from maxSpeed to 0 the instant an
   * agent enters a goal cell, giving a follower right behind it no braking
   * distance. */
  steer.setFlow = function setFlow(id, flowField, arriveR = 0) {
    steer.mode[id] = MODE_FLOW;
    steer._flowRef[id] = flowField;
    steer.arriveR[id] = arriveR;
  };

  /** Sets `id` to idle (mode 0): no seek, zero desired velocity, only ever
   * moved by separation from neighbours. */
  steer.setIdle = function setIdle(id) {
    steer.mode[id] = MODE_IDLE;
    steer._flowRef[id] = null;
  };

  /**
   * Advances every active agent by `dt`. Three phases, in slot order:
   * (1) rebuild the spatial hash; (2) for every agent, compute desired
   * (seek) velocity + "stopped" classification, then gather neighbours and
   * sum separation force (Jacobi: only last step's x/y/vx/vy are read) into
   * a scratch velocity; (3) apply: clamp speed to maxSpeed, move, sliding
   * along an axis if the full move would enter a `cost === 0` cell, else
   * stay put. Throws if any active agent's `maxSpeed*dt >= grid.cell/2`
   * (see file header re: the "asserted at create" wording).
   * @param {number} dt
   * @param {import('./NavGrid.js').NavGrid} grid
   */
  steer.step = function step(dt, grid) {
    const hi = steer._hi;
    const active = steer.active;
    const halfCell = grid.cell / 2;

    for (let i = 0; i < hi; i++) {
      if (active[i] && steer.maxSpeed[i] * dt >= halfCell) {
        throw new Error(
          `steer.step: maxSpeed*dt (${steer.maxSpeed[i] * dt}) >= grid.cell/2 (${halfCell}) `
          + `for agent ${i} - would tunnel through a cell`,
        );
      }
    }

    // 1. Rebuild the spatial hash (ascending slot order).
    const head = steer._head, next = steer._next;
    head.fill(-1);
    for (let i = 0; i < hi; i++) {
      if (!active[i]) continue;
      const idx = hashCellOf(steer, steer.x[i], steer.y[i]);
      next[i] = head[idx];
      head[idx] = i;
    }

    // 2a. Desired velocity + stopped classification, from last step's state.
    const desVx = steer._desVx, desVy = steer._desVy, stopped = steer._stopped;
    const desOut = steer._desOut;
    for (let i = 0; i < hi; i++) {
      if (!active[i]) continue;
      computeDesired(steer, i, grid, desOut);
      desVx[i] = desOut.vx;
      desVy[i] = desOut.vy;
      stopped[i] = desOut.stopped ? 1 : 0;
    }

    // 2b. Neighbours + separation + accel-limited steering -> scratch vel.
    const nvx = steer._nvx, nvy = steer._nvy;
    const sepW = steer.sepW, idleSepW = steer.idleSepW;
    for (let i = 0; i < hi; i++) {
      if (!active[i]) continue;
      const count = gatherNeighbours(steer, i);
      const nbSlot = steer._nbSlot, nbDist2 = steer._nbDist2;
      const xi = steer.x[i], yi = steer.y[i], ri = steer.radius[i];
      let fx = 0, fy = 0;
      for (let p = 0; p < count; p++) {
        const j = nbSlot[p];
        const dist = Math.sqrt(nbDist2[p]);
        const rj = steer.radius[j];
        if (dist === 0) {
          // Exactly-coincident agents (e.g. two units spawned at the
          // identical point): the dist>0 branch below can never fire for
          // them (division by zero), so without this they overlap forever.
          // Push apart deterministically by SLOT ORDER (28.2's determinism
          // rule - never insertion order or any other non-reproducible
          // tiebreak): the lower-numbered slot goes -x, the higher-numbered
          // slot goes +x. x-only per spec - no fy component.
          const w = (stopped[j] && !stopped[i]) ? idleSepW : sepW;
          const mag = (ri + rj) * w;
          fx += (i < j ? -1 : 1) * mag;
        } else if (dist < ri + rj) {
          const push = (ri + rj - dist) / dist;
          // idleSepW only for "a stopped/idle agent pushes a moving one"
          // (spec: "arrived or idle agents push moving ones only with
          // idleSepW"). A stopped agent pushing another stopped agent still
          // uses full sepW - two agents that are both stationary but
          // overlapping have nothing else resolving that overlap, and
          // weakening their mutual repulsion just lets a resting cluster
          // settle into a permanent partial overlap instead of spreading out.
          const w = (stopped[j] && !stopped[i]) ? idleSepW : sepW;
          fx += push * (xi - steer.x[j]) * w;
          fy += push * (yi - steer.y[j]) * w;
        }
      }
      let dvx = desVx[i] + fx - steer.vx[i];
      let dvy = desVy[i] + fy - steer.vy[i];
      const dlen = Math.sqrt(dvx * dvx + dvy * dvy);
      const maxDv = steer.accel[i] * dt;
      if (dlen > maxDv && dlen > 0) {
        const s = maxDv / dlen;
        dvx *= s; dvy *= s;
      }
      nvx[i] = steer.vx[i] + dvx;
      nvy[i] = steer.vy[i] + dvy;
    }

    // 3. Apply in slot order: clamp speed, move with axis sliding.
    for (let i = 0; i < hi; i++) {
      if (!active[i]) continue;
      let vxN = nvx[i], vyN = nvy[i];
      const speed = Math.sqrt(vxN * vxN + vyN * vyN);
      const ms = steer.maxSpeed[i];
      if (speed > ms && speed > 0) {
        const s = ms / speed;
        vxN *= s; vyN *= s;
      }
      steer.vx[i] = vxN;
      steer.vy[i] = vyN;

      const oldX = steer.x[i], oldY = steer.y[i];
      const nx = oldX + vxN * dt;
      const ny = oldY + vyN * dt;
      if (cellWalkable(grid, nx, ny)) {
        steer.x[i] = nx; steer.y[i] = ny;
      } else if (cellWalkable(grid, nx, oldY)) {
        steer.x[i] = nx;
      } else if (cellWalkable(grid, oldX, ny)) {
        steer.y[i] = ny;
      }
      // else: blocked on both axes, stays at (oldX, oldY).
    }
  };

  /** FNV-1a over the u32 view of the SoA buffers (fixed field order: the
   * Float64 fields as their u32 word pairs, then mode/active byte-by-byte).
   * Deterministic, zero allocation. */
  steer.hash = function hash() {
    let h = FNV_OFFSET;
    const views = steer._hashViews;
    for (let f = 0; f < views.length; f++) {
      const v = views[f];
      for (let i = 0; i < v.length; i++) {
        h ^= v[i];
        h = Math.imul(h, FNV_PRIME);
      }
    }
    const mode = steer.mode, active = steer.active;
    for (let i = 0; i < mode.length; i++) {
      h ^= mode[i];
      h = Math.imul(h, FNV_PRIME);
    }
    for (let i = 0; i < active.length; i++) {
      h ^= active[i];
      h = Math.imul(h, FNV_PRIME);
    }
    return h >>> 0;
  };

  /** Mixes the same fields as `hash()` into an external duck-typed hasher
   * `h` (see `engine/core/hash.js`'s `createHasher()` - only `h.u32Array`/
   * `h.u8Array` are used). steer.js stays a dependency-free leaf: it never
   * imports hash.js, just calls methods on whatever `h` the caller passes
   * (same pattern as `Visibility.js`'s `hashInto(h)`). Zero allocation.
   * Does not replace `hash()`, which keeps its own standalone FNV-1a for
   * the existing RE-09 determinism tests. */
  steer.hashInto = function hashInto(h) {
    const views = steer._hashViews;
    for (let f = 0; f < views.length; f++) {
      const v = views[f];
      h.u32Array(v, 0, v.length);
    }
    h.u8Array(steer.mode, 0, steer.mode.length);
    h.u8Array(steer.active, 0, steer.active.length);
    return h;
  };

  return steer;
}
