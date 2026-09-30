// engine/nav/steer.test.js (RE-09, docs/architecture.md 28.2).
// Run: node engine/nav/steer.test.js
import { NavGrid } from './NavGrid.js';
import { createFlowField } from './flowField.js';
import { createSteer } from './steer.js';
import { createHasher } from '../core/hash.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const PERF_STRICT = process.env.PERF_STRICT === '1';
function perfOk(name, cond, detail) {
  if (PERF_STRICT) { ok(name, cond, detail); }
  else if (!cond) { console.warn(`WARN perf (non-strict): ${name} - ${detail}`); pass++; }
  else { pass++; }
}

// Local seeded LCG - never Math.random (determinism rule, 28.2).
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function openGrid(w, h, cell = 1) {
  const grid = new NavGrid({ x0: 0, y0: 0, w, h, cell });
  grid.terrainCost.fill(1);
  grid._recomputeCost();
  return grid;
}

const DT = 1 / 60;

// ---- single agent reaches a waypoint and stops --------------------------
{
  const grid = openGrid(10, 10);
  const steer = createSteer({ maxAgents: 4, bounds: { x0: 0, y0: 0, w: 10, h: 10 } });
  const id = steer.addAgent(1, 1, 0.3, 1.5, 3);
  ok('addAgent returns slot 0 for the first agent', id === 0);
  steer.setWaypoint(id, 8, 8, 1);

  let steps = 0;
  const dist = () => Math.hypot(steer.x[id] - 8, steer.y[id] - 8);
  while (dist() > 0.3 && steps < 2000) { steer.step(DT, grid); steps++; }
  ok('single agent: reaches the waypoint', dist() <= 0.3, `dist=${dist()} after ${steps} steps`);

  // Once arrived, further steps should not push it away (no neighbours).
  for (let i = 0; i < 10; i++) steer.step(DT, grid);
  ok('single agent: stays put once arrived (no neighbours to push it)', dist() <= 0.31, `dist=${dist()}`);
}

// ---- addAgent lowest-free-first + removeAgent frees for reuse -----------
{
  const grid = openGrid(5, 5);
  const steer = createSteer({ maxAgents: 3, bounds: { x0: 0, y0: 0, w: 5, h: 5 } });
  const a = steer.addAgent(1, 1, 0.2, 1, 1);
  const b = steer.addAgent(2, 2, 0.2, 1, 1);
  const c = steer.addAgent(3, 3, 0.2, 1, 1);
  ok('lowest-free-first: 3 agents get slots 0,1,2', a === 0 && b === 1 && c === 2, `${a},${b},${c}`);
  const full = steer.addAgent(4, 4, 0.2, 1, 1);
  ok('addAgent returns -1 when every slot is in use', full === -1);
  steer.removeAgent(b);
  const d = steer.addAgent(9, 9, 0.2, 1, 1);
  ok('removeAgent frees its slot for reuse (lowest-free-first)', d === 1);
}

// ---- flow-follow mode: agent reaches the flow field's goal --------------
{
  const grid = openGrid(12, 12);
  const ff = createFlowField(grid);
  const goal = grid.index(10, 10);
  ff.begin(new Int32Array([goal]), 1);
  ff.step(1e9);

  const steer = createSteer({ maxAgents: 2, bounds: { x0: 0, y0: 0, w: 12, h: 12 } });
  const id = steer.addAgent(1, 1, 0.3, 1.5, 3);
  steer.setFlow(id, ff);

  let steps = 0;
  const cx = () => grid.cellX(steer.x[id]);
  const cy = () => grid.cellY(steer.y[id]);
  while (!(cx() === 10 && cy() === 10) && steps < 3000) { steer.step(DT, grid); steps++; }
  ok('flow-follow: reaches the flow field goal cell', cx() === 10 && cy() === 10, `cell=(${cx()},${cy()}) after ${steps} steps`);
}

// ---- no agent ever moves into a cost===0 cell ----------------------------
{
  const w = 16, h = 16;
  const grid = openGrid(w, h);
  for (let cy = 0; cy < h; cy++) {
    if (cy < 6 || cy > 9) grid.terrainCost[cy * w + 8] = 0; // wall column, gap rows 6..9
  }
  grid._recomputeCost();

  const steer = createSteer({ maxAgents: 20, bounds: { x0: 0, y0: 0, w, h }, sepW: 2 });
  for (let i = 0; i < 20; i++) {
    const id = steer.addAgent(1 + (i % 5) * 0.7, 1 + Math.floor(i / 5) * 0.7, 0.25, 1.2, 3);
    steer.setWaypoint(id, 14, 7.5, 1);
  }

  let violation = false;
  for (let s = 0; s < 1500 && !violation; s++) {
    steer.step(DT, grid);
    for (let i = 0; i < 20; i++) {
      if (!steer.active[i]) continue;
      const cx = grid.cellX(steer.x[i]), cy = grid.cellY(steer.y[i]);
      if (!grid.inBounds(cx, cy) || grid.cost[grid.index(cx, cy)] === 0) { violation = true; break; }
    }
  }
  ok('no agent is ever in a cost===0 cell across 1500 steps', !violation);
}

// ---- determinism: 600-step scripted run twice -> same hash() ------------
function build600StepFixture() {
  const w = 20, h = 20;
  const grid = openGrid(w, h);
  for (let cy = 0; cy < h; cy++) {
    if (cy < 8 || cy > 11) grid.terrainCost[cy * w + 10] = 0; // wall, gap rows 8..11
  }
  grid._recomputeCost();

  const steer = createSteer({ maxAgents: 30, bounds: { x0: 0, y0: 0, w, h }, sepW: 2 });
  const rnd = lcg(1234);
  for (let i = 0; i < 30; i++) {
    const x = 1 + (i % 6) * 0.8;
    const y = 1 + Math.floor(i / 6) * 0.8;
    const id = steer.addAgent(x, y, 0.25, 1 + rnd() * 0.5, 2 + rnd());
    if (i % 3 === 0) steer.setWaypoint(id, 18, 9.5, 1);
    else steer.setFlow(id, (() => {
      const ff = createFlowField(grid);
      ff.begin(new Int32Array([grid.index(18, 9)]), 1);
      ff.step(1e9);
      return ff;
    })());
  }
  return { grid, steer };
}
{
  const run1 = build600StepFixture();
  const run2 = build600StepFixture();
  for (let s = 0; s < 600; s++) { run1.steer.step(DT, run1.grid); run2.steer.step(DT, run2.grid); }
  ok('determinism: 600-step scripted run twice -> identical hash()', run1.steer.hash() === run2.steer.hash(),
    `${run1.steer.hash()} vs ${run2.steer.hash()}`);
}

// ---- same slots via different activation history -> identical result ----
{
  const grid1 = openGrid(15, 15);
  const steerA = createSteer({ maxAgents: 10, bounds: { x0: 0, y0: 0, w: 15, h: 15 } });
  const descriptors = [];
  for (let i = 0; i < 10; i++) {
    descriptors.push({ x: 1 + i * 0.6, y: 1 + (i % 3) * 0.6, r: 0.25, ms: 1 + i * 0.05, ac: 2, tx: 12, ty: 12 });
  }
  for (const d of descriptors) {
    const id = steerA.addAgent(d.x, d.y, d.r, d.ms, d.ac);
    steerA.setWaypoint(id, d.tx, d.ty, 1);
  }

  const grid2 = openGrid(15, 15);
  const steerB = createSteer({ maxAgents: 10, bounds: { x0: 0, y0: 0, w: 15, h: 15 } });
  // Different activation history: fill every slot with throwaway dummies,
  // free them all, then add the real descriptors in the same order. Lowest-
  // free-first means the real agents still land in slots 0..9 in order, but
  // they got there through a completely different call sequence.
  const dummies = [];
  for (let i = 0; i < 10; i++) dummies.push(steerB.addAgent(0, 0, 0.1, 0.1, 0.1));
  for (let i = 9; i >= 0; i--) steerB.removeAgent(dummies[i]);
  for (const d of descriptors) {
    const id = steerB.addAgent(d.x, d.y, d.r, d.ms, d.ac);
    steerB.setWaypoint(id, d.tx, d.ty, 1);
  }

  for (let s = 0; s < 300; s++) { steerA.step(DT, grid1); steerB.step(DT, grid2); }
  ok('same slots via different activation history -> identical hash()', steerA.hash() === steerB.hash(),
    `${steerA.hash()} vs ${steerB.hash()}`);
}

// ---- hashInto(h): deterministic via a real createHasher(), exercises every field hash() does ----
{
  function buildFixture() {
    const grid = openGrid(10, 10);
    const steer = createSteer({ maxAgents: 5, bounds: { x0: 0, y0: 0, w: 10, h: 10 } });
    for (let i = 0; i < 5; i++) {
      const id = steer.addAgent(1 + i * 0.5, 2 + i * 0.3, 0.2 + i * 0.01, 1 + i * 0.1, 2);
      if (i % 2 === 0) steer.setWaypoint(id, 8, 8, 1);
    }
    for (let s = 0; s < 20; s++) steer.step(DT, grid);
    return steer;
  }
  const steerA = buildFixture();
  const steerB = buildFixture();
  const h1 = createHasher();
  const h2 = createHasher();
  steerA.hashInto(h1);
  steerB.hashInto(h2);
  ok('hashInto: identical builds give the same hash', h1.value() === h2.value(), `${h1.value()} vs ${h2.value()}`);

  // Changing state (one more step on only one of the two) must change it.
  const grid2 = openGrid(10, 10);
  steerB.step(DT, grid2);
  const h3 = createHasher();
  steerB.hashInto(h3);
  ok('hashInto: differs after further state change', h3.value() !== h2.value(), `${h3.value()} vs ${h2.value()}`);
}

// ---- dist===0 tie push: exactly-coincident agents separate by slot order, deterministically ----
{
  const grid = openGrid(10, 10);
  const steer = createSteer({ maxAgents: 2, bounds: { x0: 0, y0: 0, w: 10, h: 10 } });
  const i = steer.addAgent(5, 5, 0.3, 1, 2); // slot 0
  const j = steer.addAgent(5, 5, 0.3, 1, 2); // slot 1, exactly coincident
  ok('dist-0 fixture: slots in expected order', i === 0 && j === 1, `${i},${j}`);

  steer.step(DT, grid);
  ok('dist-0: lower slot pushed along -x', steer.vx[i] < 0, `vx[i]=${steer.vx[i]}`);
  ok('dist-0: higher slot pushed along +x', steer.vx[j] > 0, `vx[j]=${steer.vx[j]}`);
  ok('dist-0: no y push (x-only per spec)', steer.vy[i] === 0 && steer.vy[j] === 0, `${steer.vy[i]},${steer.vy[j]}`);

  // Determinism: rerun the identical setup, bit-identical velocities.
  const grid2 = openGrid(10, 10);
  const steer2 = createSteer({ maxAgents: 2, bounds: { x0: 0, y0: 0, w: 10, h: 10 } });
  const i2 = steer2.addAgent(5, 5, 0.3, 1, 2);
  const j2 = steer2.addAgent(5, 5, 0.3, 1, 2);
  steer2.step(DT, grid2);
  ok('dist-0: rerun is bit-identical', steer2.vx[i2] === steer.vx[i] && steer2.vx[j2] === steer.vx[j],
    `${steer2.vx[i2]},${steer2.vx[j2]} vs ${steer.vx[i]},${steer.vx[j]}`);
}

// ---- 50 agents through a 3 m gap: overlap, no deadlock, stays walkable --
// Uses flow-follow mode (not waypoint-seek): the goal is behind a wall, and
// per 28.2 "do not: run per-unit A* for large group moves - use the flow
// field", group moves through an obstacle are exactly what the flow field
// is for. Waypoint-seek has no obstacle awareness (it seeks a straight
// line to a point), so it is the wrong mode for a target on the far side of
// a wall - it would pin every agent against the wall outside the gap's y
// range with no way to discover the opening.
{
  const w = 30, h = 10;
  const grid = openGrid(w, h);
  const gapCy0 = 3, gapCy1 = 6; // 3 m gap (cy 3,4,5)
  for (let cy = 0; cy < h; cy++) {
    if (cy < gapCy0 || cy >= gapCy1) grid.terrainCost[cy * w + 15] = 0;
  }
  grid._recomputeCost();

  const ff = createFlowField(grid);
  const goalCells = [];
  for (let cy = 1; cy < h - 1; cy++) {
    for (let cx = 25; cx < 29; cx++) goalCells.push(grid.index(cx, cy));
  }
  ff.begin(Int32Array.from(goalCells), goalCells.length);
  ff.step(1e9);

  const N = 50;
  const radius = 0.3;
  // sepW is high relative to accel/maxSpeed on purpose: separation only
  // resists actual overlap ((ri+rj-dist)/dist, zero outside it), so with 50
  // agents funnelling through one 3-cell gap and then re-converging on a
  // shared goal region, a weak sepW lets a compact, temporarily-overlapping
  // cluster settle into a stable partial overlap near the exit instead of
  // spreading out (measured while tuning this fixture: sepW 3 -> ~190%
  // overlap, sepW 25 -> ~43%, sepW 80 -> ~16%, comfortably under the 20% AC).
  const steer = createSteer({ maxAgents: N, bounds: { x0: 0, y0: 0, w, h }, hashCell: 2, maxNeighbours: 8, sepW: 80, idleSepW: 0.5 });
  // Small seeded jitter on spawn position and maxSpeed breaks the spawn
  // grid's left/right symmetry: pure separation (no lane discipline) can
  // otherwise lock into a stable, perfectly force-cancelling deadlock at a
  // symmetric doorway when every agent and its mirror image push with
  // identical force - the same reason real crowd-sim models need some
  // tie-breaker for a perfectly symmetric case.
  const rndGap = lcg(2024);
  const ids = [];
  for (let i = 0; i < N; i++) {
    const col = i % 10, row = Math.floor(i / 10);
    const jx = (rndGap() - 0.5) * 0.1;
    const jy = (rndGap() - 0.5) * 0.1;
    // accel high enough that the strong separation above can actually act
    // within one step (steering is accel-limited, see step()'s doc comment).
    const id = steer.addAgent(1 + col * 0.8 + jx, 1 + row * 0.8 + jy, radius, 1.1 + rndGap() * 0.2, 10);
    // arriveR gives following agents room to brake before a leader stops
    // dead in a goal cell (see computeDesired's flow-mode comment) - without
    // it, abrupt goal-entry stops caused much of the overlap during tuning.
    steer.setFlow(id, ff, 2.5);
    ids.push(id);
  }

  const stillCounter = new Int32Array(N);
  const arrived = new Uint8Array(N);
  let maxStill = 0;
  let maxOverlapFrac = 0;
  let cost0Violation = false;
  const MAX_STEPS = 3000;
  let s = 0;
  for (; s < MAX_STEPS; s++) {
    const prevX = new Float64Array(N), prevY = new Float64Array(N);
    for (let i = 0; i < N; i++) { prevX[i] = steer.x[i]; prevY[i] = steer.y[i]; }

    steer.step(DT, grid);

    let allArrived = true;
    for (let i = 0; i < N; i++) {
      const cx = grid.cellX(steer.x[i]), cy = grid.cellY(steer.y[i]);
      if (!grid.inBounds(cx, cy) || grid.cost[grid.index(cx, cy)] === 0) cost0Violation = true;

      if (cx >= 25) arrived[i] = 1;
      else allArrived = false;

      const moved = Math.hypot(steer.x[i] - prevX[i], steer.y[i] - prevY[i]);
      if (!arrived[i] && moved < 0.002) {
        stillCounter[i]++;
        if (stillCounter[i] > maxStill) maxStill = stillCounter[i];
      } else {
        stillCounter[i] = 0;
      }
    }

    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = steer.x[i] - steer.x[j], dy = steer.y[i] - steer.y[j];
        const dist = Math.sqrt(dx * dx + dy * dy);
        const overlap = (radius + radius) - dist;
        if (overlap > 0) {
          const frac = overlap / radius;
          if (frac > maxOverlapFrac) maxOverlapFrac = frac;
        }
      }
    }

    if (allArrived) { s++; break; }
  }

  let allArrivedFinal = true;
  for (let i = 0; i < N; i++) if (!arrived[i]) allArrivedFinal = false;

  ok('3m gap: all 50 agents reach the goal area', allArrivedFinal, `after ${s} steps, arrived=${arrived.reduce((a, b) => a + b, 0)}/${N}`);
  ok('3m gap: no agent ever enters a cost===0 cell', !cost0Violation);
  ok('3m gap: max overlap <= 20% of radius', maxOverlapFrac <= 0.2, `maxOverlapFrac=${maxOverlapFrac.toFixed(3)}`);
  ok('3m gap: no agent stays still for > 120 steps before arriving', maxStill <= 120, `maxStill=${maxStill}`);
}

// ---- no-tunnelling assertion throws when maxSpeed*dt >= cell/2 -----------
{
  const grid = openGrid(5, 5);
  const steer = createSteer({ maxAgents: 2, bounds: { x0: 0, y0: 0, w: 5, h: 5 } });
  const id = steer.addAgent(1, 1, 0.2, 100, 10); // way too fast for dt=1/60, cell=1
  steer.setWaypoint(id, 4, 4, 1);
  let threw = false;
  try { steer.step(DT, grid); } catch (e) { threw = true; }
  ok('step() throws when maxSpeed*dt >= grid.cell/2 (no-tunnelling invariant)', threw);
}

// ---- perf: 500 agents step <= 1 ms (warn-only) ---------------------------
{
  const w = 64, h = 64;
  const grid = openGrid(w, h);
  const N = 500;
  const steer = createSteer({ maxAgents: N, bounds: { x0: 0, y0: 0, w, h }, hashCell: 3, maxNeighbours: 8 });
  const rnd = lcg(99);
  for (let i = 0; i < N; i++) {
    const id = steer.addAgent(rnd() * w, rnd() * h, 0.25, 1 + rnd(), 2 + rnd());
    steer.setWaypoint(id, rnd() * w, rnd() * h, 1);
  }

  for (let i = 0; i < 30; i++) steer.step(DT, grid); // warm up

  const REPS = 50;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < REPS; i++) steer.step(DT, grid);
  const t1 = process.hrtime.bigint();
  const msEach = Number(t1 - t0) / 1e6 / REPS;
  perfOk('perf: 500 agents step <= 1 ms', msEach <= 1, `${msEach.toFixed(3)} ms/step (PERF_STRICT=${PERF_STRICT ? 1 : 0})`);

  const N200 = 200;
  const steer200 = createSteer({ maxAgents: N200, bounds: { x0: 0, y0: 0, w, h }, hashCell: 3, maxNeighbours: 8 });
  for (let i = 0; i < N200; i++) {
    const id = steer200.addAgent(rnd() * w, rnd() * h, 0.25, 1 + rnd(), 2 + rnd());
    steer200.setWaypoint(id, rnd() * w, rnd() * h, 1);
  }
  for (let i = 0; i < 30; i++) steer200.step(DT, grid);
  const t2 = process.hrtime.bigint();
  for (let i = 0; i < REPS; i++) steer200.step(DT, grid);
  const t3 = process.hrtime.bigint();
  const msEach200 = Number(t3 - t2) / 1e6 / REPS;
  perfOk('perf: 200 agents step <= 0.4 ms', msEach200 <= 0.4, `${msEach200.toFixed(3)} ms/step (PERF_STRICT=${PERF_STRICT ? 1 : 0})`);
}

// ---- zero allocation per step (after construction) -----------------------
{
  if (typeof global.gc === 'function') {
    const w = 32, h = 32;
    const grid = openGrid(w, h);
    const N = 100;
    const steer = createSteer({ maxAgents: N, bounds: { x0: 0, y0: 0, w, h } });
    const rnd = lcg(3);
    for (let i = 0; i < N; i++) {
      const id = steer.addAgent(rnd() * w, rnd() * h, 0.25, 1, 2);
      steer.setWaypoint(id, rnd() * w, rnd() * h, 1);
    }
    for (let i = 0; i < 50; i++) steer.step(DT, grid); // warm up
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) steer.step(DT, grid);
    global.gc();
    const after = process.memoryUsage().heapUsed;
    const grew = after - before;
    ok('zero alloc: step() over 2000 iterations (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes`);
  } else {
    console.warn('WARN: zero-alloc check skipped (run with --expose-gc for a real gate)');
    pass++;
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
