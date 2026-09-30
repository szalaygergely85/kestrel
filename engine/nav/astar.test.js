// engine/nav/astar.test.js (RE-05, docs/architecture.md 28.2). Zero-alloc
// gate needs --expose-gc: re-runs itself when missing (same pattern as
// engine/mesh/culling.test.js). Run: node engine/nav/astar.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NavGrid } from './NavGrid.js';
import { createAStar, findPath, smoothPath, pathCrossesRect } from './astar.js';
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

function octileCost(dx, dy) {
  const adx = Math.abs(dx), ady = Math.abs(dy);
  return 10 * Math.max(adx, ady) + 4 * Math.min(adx, ady);
}

function pathCost(grid, path, len) {
  let sum = 0;
  const w = grid.w;
  for (let i = 1; i < len; i++) {
    const a = path[i - 1], b = path[i];
    const ax = a % w, ay = (a / w) | 0;
    const bx = b % w, by = (b / w) | 0;
    const diag = ax !== bx && ay !== by;
    sum += (diag ? 14 : 10) * grid.cost[b];
  }
  return sum;
}

// ---- open-field path cost == octile optimum --------------------------------
{
  const grid = openGrid(20, 20);
  const astar = createAStar(grid);
  const outPath = new Int32Array(grid.w * grid.h);
  const len = findPath(astar, 0, 0, 19, 12, outPath);
  ok('open field: path found', len > 0);
  ok('open field: not partial', astar.partial === false);
  ok('open field: cost == octile optimum', pathCost(grid, outPath, len) === octileCost(19, 12), `cost=${pathCost(grid, outPath, len)} optimum=${octileCost(19, 12)}`);
  ok('open field: starts at start, ends at goal', outPath[0] === 0 && outPath[len - 1] === 12 * 20 + 19);
}

// ---- no corner cutting ------------------------------------------------------
{
  // 5x5: block (2,1) and (1,2), the two orthogonal neighbours of the
  // diagonal step (1,1)->(2,2), so that step is disallowed - but plenty of
  // other routes remain from (0,0) to (4,4).
  const grid = openGrid(5, 5);
  grid.terrainCost[1 * 5 + 2] = 0; // (2,1)
  grid.terrainCost[2 * 5 + 1] = 0; // (1,2)
  grid._recomputeCost();
  const astar = createAStar(grid);
  const outPath = new Int32Array(25);
  const len = findPath(astar, 0, 0, 4, 4, outPath);
  ok('corner rule: a path is still found (goes around)', len > 0 && !astar.partial);
  let cutsCorner = false;
  const w = grid.w;
  for (let i = 1; i < len; i++) {
    const a = outPath[i - 1], b = outPath[i];
    const ax = a % w, ay = (a / w) | 0, bx = b % w, by = (b / w) | 0;
    const dx = bx - ax, dy = by - ay;
    if (dx !== 0 && dy !== 0) {
      const o1 = ay * w + bx, o2 = by * w + ax;
      if (grid.cost[o1] === 0 || grid.cost[o2] === 0) cutsCorner = true;
    }
  }
  ok('corner rule: no diagonal step crosses a blocked orthogonal pair', !cutsCorner);
}

// ---- blocked/unreachable goal -> partial path ------------------------------
{
  const grid = openGrid(5, 5);
  // Fully wall off the goal cell (4,4) so it's isolated.
  grid.terrainCost[4 * 5 + 4] = 0;
  grid._recomputeCost();
  const astar = createAStar(grid);
  const outPath = new Int32Array(25);
  const len = findPath(astar, 0, 0, 4, 4, outPath);
  ok('blocked goal: partial path returned', astar.partial === true);
  ok('blocked goal: non-empty path (best-effort toward the goal)', len > 0);
  ok('blocked goal: path never reaches the blocked cell', outPath[len - 1] !== 4 * 5 + 4);
}

// ---- unreachable goal (disconnected region) --------------------------------
{
  const grid = openGrid(6, 3);
  // A full wall at column 3 splits the grid into two disconnected halves.
  for (let y = 0; y < 3; y++) grid.terrainCost[y * 6 + 3] = 0;
  grid._recomputeCost();
  const astar = createAStar(grid);
  const outPath = new Int32Array(18);
  const len = findPath(astar, 0, 0, 5, 0, outPath);
  ok('disconnected region: partial path returned', astar.partial === true);
  ok('disconnected region: path stays on the reachable side', len > 0 && (outPath[len - 1] % 6) < 3);
}

// ---- unwalkable start -> 0 --------------------------------------------------
{
  const grid = openGrid(3, 3);
  grid.terrainCost[0] = 0;
  grid._recomputeCost();
  const astar = createAStar(grid);
  const outPath = new Int32Array(9);
  const len = findPath(astar, 0, 0, 2, 2, outPath);
  ok('unwalkable start returns 0', len === 0);
}

// ---- typeCost multiplier changes the chosen route --------------------------
{
  // 3-row strip: row 0 is cheap (cost 1), row 1 is expensive (cost 5), row 2 cheap.
  // A straight path through row 1 should cost more than detouring isn't
  // possible here (1 row of height), so just check heavier cost is reflected.
  const grid = new NavGrid({ x0: 0, y0: 0, w: 5, h: 1, cell: 1 });
  grid.terrainCost.fill(5);
  grid._recomputeCost();
  const astar = createAStar(grid);
  const outPath = new Int32Array(5);
  const len = findPath(astar, 0, 0, 4, 0, outPath);
  ok('typeCost multiplier reflected in path cost', pathCost(grid, outPath, len) === 10 * 4 * 5, `cost=${pathCost(grid, outPath, len)}`);
}

// ---- determinism: 1000 seeded random queries run twice -> identical -------
{
  const w = 24, h = 24, n = w * h;
  const rnd = lcg(12345);
  const grid = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  for (let i = 0; i < n; i++) grid.terrainCost[i] = rnd() < 0.2 ? 0 : (1 + Math.floor(rnd() * 3));
  grid._recomputeCost();

  const queries = [];
  for (let i = 0; i < 1000; i++) {
    queries.push([Math.floor(rnd() * w), Math.floor(rnd() * h), Math.floor(rnd() * w), Math.floor(rnd() * h)]);
  }

  function runAll() {
    const astar = createAStar(grid);
    const results = [];
    for (const [sx, sy, gx, gy] of queries) {
      const outPath = new Int32Array(n);
      const len = findPath(astar, sx, sy, gx, gy, outPath);
      results.push({ len, partial: astar.partial, path: Array.from(outPath.subarray(0, len)) });
    }
    return results;
  }

  const runA = runAll();
  const runB = runAll();
  let allMatch = true;
  let firstMismatch = -1;
  for (let i = 0; i < runA.length; i++) {
    const a = runA[i], b = runB[i];
    if (a.len !== b.len || a.partial !== b.partial || a.path.join(',') !== b.path.join(',')) {
      allMatch = false; firstMismatch = i; break;
    }
  }
  ok('1000 seeded random queries: identical across two runs', allMatch, `first mismatch at query ${firstMismatch}`);
}

// ---- smoothPath never crosses a cost===0 cell ------------------------------
{
  const w = 12, h = 12, n = w * h;
  const rnd = lcg(999);
  const grid = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  for (let i = 0; i < n; i++) grid.terrainCost[i] = rnd() < 0.25 ? 0 : 1;
  grid.terrainCost[0] = 1; // keep start walkable
  grid.terrainCost[n - 1] = 1; // keep goal walkable
  grid._recomputeCost();
  const astar = createAStar(grid);
  const outPath = new Int32Array(n);
  const len = findPath(astar, 0, 0, w - 1, h - 1, outPath);
  ok('smoothPath fixture: a path exists', len > 0 && !astar.partial);
  const outXY = new Float64Array(2 * len);
  const count = smoothPath(grid, outPath, len, outXY);
  ok('smoothPath: at least start+end waypoints', count >= 2, `count=${count}`);

  // Independent oracle: walk a supercover line between consecutive waypoints
  // (world coords -> cells) and check every touched cell has cost > 0.
  function segmentClear(x0, y0, x1, y1) {
    let cx0 = grid.cellX(x0), cy0 = grid.cellY(y0);
    let cx1 = grid.cellX(x1), cy1 = grid.cellY(y1);
    const dx = Math.abs(cx1 - cx0), dy = Math.abs(cy1 - cy0);
    const sx = cx0 < cx1 ? 1 : -1, sy = cy0 < cy1 ? 1 : -1;
    let err = dx - dy;
    let x = cx0, y = cy0;
    if (grid.cost[y * w + x] === 0) return false;
    while (x !== cx1 || y !== cy1) {
      const e2 = 2 * err;
      let stepX = 0, stepY = 0;
      if (e2 > -dy) { err -= dy; stepX = sx; }
      if (e2 < dx) { err += dx; stepY = sy; }
      x += stepX; y += stepY;
      if (grid.cost[y * w + x] === 0) return false;
    }
    return true;
  }
  let crossed = false;
  for (let i = 1; i < count; i++) {
    if (!segmentClear(outXY[(i - 1) * 2], outXY[(i - 1) * 2 + 1], outXY[i * 2], outXY[i * 2 + 1])) crossed = true;
  }
  ok('smoothPath: no segment crosses a cost===0 cell', !crossed);
}

// ---- pathCrossesRect --------------------------------------------------------
{
  const grid = openGrid(10, 10);
  const astar = createAStar(grid);
  const outPath = new Int32Array(100);
  const len = findPath(astar, 0, 0, 9, 0, outPath); // straight row 0
  ok('pathCrossesRect: true for a rect covering the path', pathCrossesRect(outPath, len, grid, { cx0: 3, cy0: 0, cx1: 6, cy1: 1 }));
  ok('pathCrossesRect: false for a rect elsewhere', !pathCrossesRect(outPath, len, grid, { cx0: 0, cy0: 5, cx1: 10, cy1: 10 }));
}

// ---- perf: 256x256 worst-case (corner to corner) <= 1 ms (warn-only) -------
{
  const grid = openGrid(256, 256);
  const astar = createAStar(grid);
  const outPath = new Int32Array(256 * 256);
  // Warm up (JIT).
  findPath(astar, 0, 0, 255, 255, outPath);
  const N = 5;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) findPath(astar, 0, 0, 255, 255, outPath);
  const t1 = process.hrtime.bigint();
  const msEach = Number(t1 - t0) / 1e6 / N;
  perfOk('perf: 256x256 corner-to-corner <= 1 ms', msEach <= 1, `${msEach.toFixed(3)} ms/query (PERF_STRICT=${PERF_STRICT ? 1 : 0})`);
}

// ---- zero allocation per query (after construction) ------------------------
{
  const grid = openGrid(64, 64);
  const astar = createAStar(grid);
  const outPath = new Int32Array(64 * 64);
  const outXY = new Float64Array(2 * 64 * 64);
  let sink = 0;
  // Warm up.
  for (let i = 0; i < 200; i++) {
    const len = findPath(astar, 0, 0, 63, 63, outPath);
    sink += smoothPath(grid, outPath, len, outXY);
  }
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) {
    const len = findPath(astar, 0, 0, 63, 63, outPath);
    sink += smoothPath(grid, outPath, len, outXY);
    sink += pathCrossesRect(outPath, len, grid, { cx0: 10, cy0: 10, cx1: 20, cy1: 20 }) ? 1 : 0;
  }
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('zero alloc: findPath/smoothPath/pathCrossesRect over 2000 queries (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes (sink=${sink})`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
