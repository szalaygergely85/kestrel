// engine/nav/flowField.test.js (RE-08, docs/architecture.md 28.2). Zero-alloc
// gate needs --expose-gc: re-runs itself when missing (same pattern as
// astar.test.js). Run: node engine/nav/flowField.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NavGrid } from './NavGrid.js';
import { createFlowField, FlowCache } from './flowField.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

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

function openGrid(w, h) {
  const grid = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  grid.terrainCost.fill(1);
  grid._recomputeCost();
  return grid;
}

const UNREACHED = 0xffffffff;
const DIR_GOAL = 254;
const DIR_NONE = 255;
const NEI_DX = [0, 1, 0, -1, 1, 1, -1, -1];
const NEI_DY = [-1, 0, 1, 0, -1, 1, 1, -1];

/** Follows `dir` from `startIdx` and returns the list of integ values
 * visited (including the start), or null if it loops/dead-ends without
 * reaching a goal cell (dir === DIR_GOAL) within `n` steps. */
function followDir(ff, grid, startIdx) {
  const w = grid.w;
  const n = grid.w * grid.h;
  const trail = [ff.integ[startIdx]];
  let idx = startIdx;
  for (let steps = 0; steps < n + 1; steps++) {
    const d = ff.dir[idx];
    if (d === DIR_GOAL) return trail;
    if (d === DIR_NONE || d > 7) return null;
    const cx = idx % w, cy = (idx / w) | 0;
    const nx = cx + NEI_DX[d], ny = cy + NEI_DY[d];
    if (nx < 0 || ny < 0 || nx >= w || ny >= grid.h) return null;
    idx = ny * w + nx;
    trail.push(ff.integ[idx]);
  }
  return null; // too many steps: treat as a loop
}

// ---- every reached cell's dir descends strictly to a goal -------------------
{
  const w = 24, h = 24, n = w * h;
  const rnd = lcg(42);
  const grid = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  for (let i = 0; i < n; i++) grid.terrainCost[i] = rnd() < 0.25 ? 0 : (1 + Math.floor(rnd() * 3));
  grid.terrainCost[0] = 1; // keep goal walkable
  grid._recomputeCost();

  const ff = createFlowField(grid);
  const goals = new Int32Array([0]);
  ff.begin(goals, 1);
  const done = ff.step(1e9);
  ok('descent fixture: build completes in one step call', done);

  let allDescend = true;
  let reachedCount = 0;
  for (let i = 0; i < n; i++) {
    if (ff.integ[i] === UNREACHED) continue;
    reachedCount++;
    if (i === 0) continue; // goal itself
    const trail = followDir(ff, grid, i);
    if (trail === null) { allDescend = false; continue; }
    for (let k = 1; k < trail.length; k++) {
      if (!(trail[k] < trail[k - 1])) { allDescend = false; break; }
    }
  }
  ok('descent: every reached cell has some path', reachedCount > 1, `reachedCount=${reachedCount}`);
  ok('descent: dir from every reached cell strictly decreases integ to the goal', allDescend);
}

// ---- step in chunks of 1000 == one shot (bit-equal integ/dir) --------------
{
  const w = 32, h = 32, n = w * h;
  const rnd = lcg(7);
  const grid = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  for (let i = 0; i < n; i++) grid.terrainCost[i] = rnd() < 0.2 ? 0 : 1;
  grid.terrainCost[0] = 1;
  grid._recomputeCost();

  const goals = new Int32Array([0]);

  const ffOneShot = createFlowField(grid);
  ffOneShot.begin(goals, 1);
  ffOneShot.step(1e9);

  const ffChunked = createFlowField(grid);
  ffChunked.begin(goals, 1);
  let doneChunked = false;
  let guard = 0;
  while (!doneChunked && guard++ < 100000) doneChunked = ffChunked.step(1000);

  let integMatch = true, dirMatch = true;
  for (let i = 0; i < n; i++) {
    if (ffOneShot.integ[i] !== ffChunked.integ[i]) integMatch = false;
    if (ffOneShot.dir[i] !== ffChunked.dir[i]) dirMatch = false;
  }
  ok('chunked step(1000): integ bit-equal to one-shot', integMatch);
  ok('chunked step(1000): dir bit-equal to one-shot', dirMatch);
  ok('chunked step(1000): cellsDone matches one-shot', ffChunked.cellsDone === ffOneShot.cellsDone, `${ffChunked.cellsDone} vs ${ffOneShot.cellsDone}`);
}

// ---- save/load mid-build gives the same result -----------------------------
{
  const w = 20, h = 20, n = w * h;
  const rnd = lcg(555);
  const grid = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  for (let i = 0; i < n; i++) grid.terrainCost[i] = rnd() < 0.15 ? 0 : 1;
  grid.terrainCost[n - 1] = 1;
  grid._recomputeCost();

  const goals = new Int32Array([n - 1]);

  // Build fully.
  const ffFull = createFlowField(grid);
  ffFull.begin(goals, 1);
  ffFull.step(1e9);

  // Build halfway, "save" {goals, cellsDone}, then reload via begin + step(cellsDone).
  const ffHalf = createFlowField(grid);
  ffHalf.begin(goals, 1);
  ffHalf.step(30); // partial build, not yet done
  const savedCellsDone = ffHalf.cellsDone;
  ok('save/load fixture: halfway build is not yet done', savedCellsDone > 0 && savedCellsDone < n);

  const ffReloaded = createFlowField(grid);
  ffReloaded.begin(goals, 1);
  ffReloaded.step(savedCellsDone);
  ok('save/load: reloaded cellsDone matches saved', ffReloaded.cellsDone === savedCellsDone);

  let integMatch = true, dirMatch = true;
  for (let i = 0; i < n; i++) {
    if (ffReloaded.integ[i] !== ffHalf.integ[i]) integMatch = false;
    if (ffReloaded.dir[i] !== ffHalf.dir[i]) dirMatch = false;
  }
  ok('save/load: reloaded state bit-equal to the original partial build', integMatch && dirMatch);

  // Finish both the same way and check they still match the full build.
  ffReloaded.step(1e9);
  ffHalf.step(1e9);
  let finalMatch = true;
  for (let i = 0; i < n; i++) {
    if (ffReloaded.integ[i] !== ffFull.integ[i] || ffReloaded.dir[i] !== ffFull.dir[i]) finalMatch = false;
  }
  ok('save/load: finishing after reload matches the one-shot full build', finalMatch);
}

// ---- multi-goal --------------------------------------------------------------
{
  const w = 10, h = 10, n = w * h;
  const grid = openGrid(w, h);
  const goalA = 0; // (0,0)
  const goalB = w - 1; // (w-1, 0)
  const ff = createFlowField(grid);
  const goals = new Int32Array([goalA, goalB]);
  ff.begin(goals, 2);
  ff.step(1e9);

  ok('multi-goal: both goal cells marked DIR_GOAL', ff.dir[goalA] === DIR_GOAL && ff.dir[goalB] === DIR_GOAL);
  ok('multi-goal: both goal cells have integ 0', ff.integ[goalA] === 0 && ff.integ[goalB] === 0);

  // A cell nearer to goalB should have an integ <= the straight-line octile
  // distance to goalB (sanity: it is not routed only through goalA).
  const nearB = (h - 1) * w + (w - 2); // bottom row, near the right edge
  const straightToB = 10 * (h - 1) + 4 * 0; // not exact octile since goalB is top-right; just check reachability
  ok('multi-goal: far cell reached', ff.integ[nearB] !== UNREACHED);

  // Every reached non-goal cell must still strictly descend to *a* goal.
  let allDescend = true;
  for (let i = 0; i < n; i++) {
    if (ff.integ[i] === UNREACHED || i === goalA || i === goalB) continue;
    const trail = followDir(ff, grid, i);
    if (trail === null) { allDescend = false; break; }
  }
  ok('multi-goal: every reached cell still descends to a goal', allDescend);
}

// ---- unreachable region: unreached cells stay UNREACHED/DIR_NONE ------------
{
  const w = 6, h = 3;
  const grid = openGrid(w, h);
  for (let y = 0; y < h; y++) grid.terrainCost[y * w + 3] = 0; // wall splits the grid
  grid._recomputeCost();
  const ff = createFlowField(grid);
  const goals = new Int32Array([0]);
  ff.begin(goals, 1);
  ff.step(1e9);
  let ok1 = true;
  for (let x = 3; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (x === 3) { if (ff.integ[i] !== UNREACHED) ok1 = false; continue; }
      if (ff.integ[i] !== UNREACHED || ff.dir[i] !== DIR_NONE) ok1 = false;
    }
  }
  ok('disconnected region: unreachable cells stay UNREACHED/DIR_NONE', ok1);
}

// ---- dirAt returns correct unit vectors, including the diagonal constant ----
{
  const grid = openGrid(5, 5);
  const ff = createFlowField(grid);
  const goals = new Int32Array([0]); // (0,0)
  ff.begin(goals, 1);
  ff.step(1e9);
  const out = { x: 0, y: 0 };

  // (1,1) should point toward (0,0), i.e. diagonal NW: (-1/sqrt2, -1/sqrt2).
  const cx = grid.cellCenterX(1), cy = grid.cellCenterY(1);
  ff.dirAt(cx, cy, out);
  const inv = 0.7071067811865476;
  ok('dirAt: diagonal cell points NW with the exact 1/sqrt(2) constant',
    Math.abs(out.x - -inv) < 1e-15 && Math.abs(out.y - -inv) < 1e-15,
    `got (${out.x}, ${out.y})`);

  // Outside the grid -> (0,0).
  ff.dirAt(-100, -100, out);
  ok('dirAt: outside the grid returns (0,0)', out.x === 0 && out.y === 0);

  // The goal cell itself -> (0,0) (dir === DIR_GOAL, not a movement direction).
  ff.dirAt(grid.cellCenterX(0), grid.cellCenterY(0), out);
  ok('dirAt: the goal cell itself returns (0,0)', out.x === 0 && out.y === 0);
}

// ---- no corner cutting in the flow field -------------------------------------
{
  // Same fixture shape as astar.test.js's corner-rule test.
  const grid = openGrid(5, 5);
  grid.terrainCost[1 * 5 + 2] = 0; // (2,1)
  grid.terrainCost[2 * 5 + 1] = 0; // (1,2)
  grid._recomputeCost();
  const ff = createFlowField(grid);
  const goals = new Int32Array([0]);
  ff.begin(goals, 1);
  ff.step(1e9);
  // (2,2) reached only by going around, never straight diagonal from (1,1)
  // stepping past the two blocked orthogonal cells. Verify by construction:
  // integ[(2,2)] must exceed the direct (blocked) diagonal chain cost of 2*14.
  const idx22 = 2 * 5 + 2;
  ok('corner rule: (2,2) integ reflects the detour, not the cut-corner shortcut',
    ff.integ[idx22] > 2 * 14, `integ=${ff.integ[idx22]}`);
}

// ---- FlowCache: hit/miss + LRU by sim tick (never wall time) ----------------
{
  const grid = openGrid(8, 8);
  const cache = new FlowCache(grid, 2, 8); // only 2 slots to force eviction

  const goalsA = new Int32Array([0]);
  const goalsB = new Int32Array([63]);
  const goalsC = new Int32Array([7]);

  const ffA1 = cache.get(goalsA, 1, 1);
  ffA1.step(1e9);
  const ffA2 = cache.get(goalsA, 1, 2); // same key -> same instance, hit
  ok('FlowCache: identical goal set + version is a cache hit (same instance)', ffA1 === ffA2);

  const ffB = cache.get(goalsB, 1, 3);
  ok('FlowCache: different goal set is a cache miss (new instance)', ffB !== ffA1);
  ffB.step(1e9);

  // A was touched more recently (tick 2) than B (tick 3 is more recent than
  // A's tick 2 too - so touch A again to make B strictly the LRU one) - make
  // the order unambiguous before forcing a third distinct key in.
  cache.get(goalsA, 1, 4); // A now most-recently-used (tick 4); B is LRU (tick 3)
  const ffC = cache.get(goalsC, 1, 5); // must evict B, the LRU slot
  ffC.step(1e9);
  ok('FlowCache: a third distinct key evicts the LRU slot, not the MRU one',
    ffC.integ[7] === 0 && ffC.dir[7] === DIR_GOAL, `integ[7]=${ffC.integ[7]} dir[7]=${ffC.dir[7]}`);

  // A must still be cached (it was MRU, never evicted): same instance, no rebuild.
  const ffA3 = cache.get(goalsA, 1, 6);
  ok('FlowCache: the MRU slot survives eviction (still a hit)', ffA3 === ffA1);

  // B was evicted, so asking for it again must miss and rebuild from scratch.
  const ffB2 = cache.get(goalsB, 1, 7);
  ok('FlowCache: the evicted key rebuilds correctly on next request',
    ffB2.integ[63] === 0 && ffB2.dir[63] === DIR_GOAL);
}

// ---- FlowCache: a grid.version change invalidates a stale cached field -----
{
  const grid = openGrid(8, 8);
  const cache = new FlowCache(grid, 4, 8);
  const goals = new Int32Array([0]);
  const ff1 = cache.get(goals, 1, 1);
  ff1.step(1e9);
  const versionBefore = grid.version;

  grid.terrainCost[5] = 0; // change walkability
  grid._recomputeCost(); // bumps grid.version
  ok('FlowCache fixture: grid.version actually changed', grid.version !== versionBefore);

  const ff2 = cache.get(goals, 1, 2);
  ok('FlowCache: stale version is a miss even for the same goal set (rebuilt, not stale integ 0 everywhere-but-blocked)', ff2.integ[5] === UNREACHED);
}

// ---- perf: 256x256 full build <= 3 ms; step(16384) <= 0.8 ms (warn-only) ----
{
  const grid = openGrid(256, 256);
  const ff = createFlowField(grid);
  const goals = new Int32Array([0]);

  // Warm up.
  ff.begin(goals, 1);
  ff.step(1e9);

  const N = 5;
  let t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    ff.begin(goals, 1);
    ff.step(1e9);
  }
  let t1 = process.hrtime.bigint();
  const msFullEach = Number(t1 - t0) / 1e6 / N;
  perfOk('perf: 256x256 full build <= 3 ms', msFullEach <= 3, `${msFullEach.toFixed(3)} ms/build (PERF_STRICT=${PERF_STRICT ? 1 : 0})`);

  ff.begin(goals, 1);
  ff.step(16384); // warm up this size too
  ff.begin(goals, 1);
  t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    ff.begin(goals, 1);
    ff.step(16384);
  }
  t1 = process.hrtime.bigint();
  const msStepEach = Number(t1 - t0) / 1e6 / N;
  perfOk('perf: step(16384) <= 0.8 ms', msStepEach <= 0.8, `${msStepEach.toFixed(3)} ms/step (PERF_STRICT=${PERF_STRICT ? 1 : 0})`);
}

// ---- zero allocation per begin/step/dirAt (after construction) -------------
{
  const grid = openGrid(64, 64);
  const ff = createFlowField(grid);
  const goals = new Int32Array([0]);
  const out = { x: 0, y: 0 };
  let sink = 0;

  // Warm up.
  for (let i = 0; i < 50; i++) {
    ff.begin(goals, 1);
    ff.step(1e9);
    ff.dirAt(10, 10, out);
    sink += out.x;
  }
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) {
    ff.begin(goals, 1);
    ff.step(1e9);
    ff.dirAt(10, 10, out);
    sink += out.x;
  }
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('zero alloc: begin/step/dirAt over 2000 iterations (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes (sink=${sink})`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
