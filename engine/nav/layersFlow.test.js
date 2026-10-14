// engine/nav/layersFlow.test.js (NAV-LAYERS-01c, docs/architecture.md 38.71). Flow field, smoothPath and steer on
// layered grids. Run: node engine/nav/layersFlow.test.js (re-runs itself with --expose-gc for the alloc probe).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NavGrid } from './NavGrid.js';
import { createAStar, findPath, findPathCells, smoothPath } from './astar.js';
import { createFlowField } from './flowField.js';
import { createSteer } from './steer.js';
import { sheetCellIndex } from './sheets.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// Same fixture family as sheets.test.js: river x15..24, stair house hole x27..34 y0..7.
const GW = 40, GH = 16;
function makeGround() {
  const g = new NavGrid({ x0: 0, y0: 0, w: GW, h: GH, cell: 1 });
  g.terrainCost.fill(1);
  for (let y = 0; y < GH; y++) for (let x = 15; x <= 24; x++) g.terrainCost[y * GW + x] = 0;
  for (let y = 0; y < 8; y++) for (let x = 27; x <= 34; x++) g.terrainCost[y * GW + x] = 0;
  g._recomputeCost();
  return g;
}
function sheet(x0, y0, w, h, cell, z) {
  const heights = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) heights[i] = typeof z === 'function' ? z(i % w, (i / w) | 0) : z;
  return { x0, y0, w, h, cell, cost: new Uint8Array(w * h).fill(1), height: heights };
}
function makeLayered() {
  const g = makeGround();
  g.buildLayersFromArrays({
    sheets: [
      sheet(15, 9, 10, 2, 1, 0.3),
      sheet(27, 3, 4, 1, 1, (x) => 0.5 * (x + 1)),
      sheet(31, 0, 8, 8, 0.5, 2.0),
    ],
    links: [
      { from: { s: -1, x: 14, y: 9 }, to: { s: 0, x: 0, y: 0 } },
      { from: { s: -1, x: 14, y: 10 }, to: { s: 0, x: 0, y: 1 } },
      { from: { s: 0, x: 9, y: 0 }, to: { s: -1, x: 25, y: 9 } },
      { from: { s: 0, x: 9, y: 1 }, to: { s: -1, x: 25, y: 10 } },
      { from: { s: -1, x: 26, y: 3 }, to: { s: 1, x: 0, y: 0 } },
      { from: { s: 1, x: 3, y: 0 }, to: { s: 2, x: 0, y: 7 } },
    ],
  });
  return g;
}
const N = GW * GH;
const pos = { x: 0, y: 0, z: 0 };
// Independent check: the cell an agent stands in is not cost 0.
function isWalkableHere(g, x, y, z) {
  const L = g.layers;
  if (L) {
    for (let s = 0; s < L.count; s++) {
      const c = L.cell[s], lx = Math.floor((x - L.x0[s]) / c), ly = Math.floor((y - L.y0[s]) / c);
      if (lx < 0 || ly < 0 || lx >= L.w[s] || ly >= L.h[s]) continue;
      const local = L.base[s] + ly * L.w[s] + lx;
      if (Math.abs(L.height[local] - z) <= 1.0) return L.cost[local] !== 0;
    }
  }
  const cx = g.cellX(x), cy = g.cellY(y);
  return g.inBounds(cx, cy) && g.cost[cy * g.w + cx] !== 0;
}

// ---- 1. flow field descends across a bridge link and a stair link --------------
{
  const g = makeLayered();
  const ff = createFlowField(g);
  const goalUp = sheetCellIndex(g, 2, 6, 2); // upper floor
  const goals = new Int32Array([goalUp]);
  ff.begin(goals, 1);
  ok('layered flow settles', ff.step(1e9) === true, '');
  ok('flow reaches ground start west of the river', ff.integ[3 * GW + 5] !== 0xffffffff, '');
  ok('flow reaches the deck and stair', ff.integ[sheetCellIndex(g, 0, 4, 0)] !== 0xffffffff && ff.integ[sheetCellIndex(g, 1, 1, 0)] !== 0xffffffff, '');
  // Follow dirAt from (5.5, 3.5) with z tracked from the located cell; must climb to the upper floor.
  const o = { x: 0, y: 0 };
  const B1 = N + g.layers.base[1], B2 = N + g.layers.base[2];
  let x = 5.5, y = 3.5, z = 0, sawBridge = false, sawStair = false, steps = 0;
  for (; steps < 3000; steps++) {
    const li = g.locate(x, y, z);
    if (li === goalUp) break;
    if (li >= N) { if (li < B1) sawBridge = true; else if (li < B2) sawStair = true; }
    z = g.cellZ(li);
    ff.dirAt(x, y, o, z);
    if (o.x === 0 && o.y === 0) break;
    x += o.x * 0.2; y += o.y * 0.2;
  }
  ok('flow-follow from ground reaches the upper-floor goal via bridge + stair', g.locate(x, y, z) === goalUp && sawBridge && sawStair, `end ${x.toFixed(2)},${y.toFixed(2)} z=${z} steps=${steps} bridge=${sawBridge} stair=${sawStair}`);

  // Reverse: goal on ground east of the river, start on the upper floor: descends stair and bridge.
  const goalG = new Int32Array([9 * GW + 38]);
  ff.begin(goalG, 1); ff.step(1e9);
  x = 32.25; y = 3.75; z = 2.0; steps = 0; sawStair = false;
  for (; steps < 3000; steps++) {
    const li = g.locate(x, y, z);
    if (li === goalG[0]) break;
    if (li >= B1 && li < B2) sawStair = true;
    z = g.cellZ(li);
    ff.dirAt(x, y, o, z);
    if (o.x === 0 && o.y === 0) break;
    x += o.x * 0.2; y += o.y * 0.2;
  }
  ok('flow-follow from the upper floor descends the stair to a ground goal', g.locate(x, y, z) === goalG[0] && sawStair, `end ${x.toFixed(2)},${y.toFixed(2)} steps=${steps}`);

  // Determinism + chunk independence
  const a = new Uint32Array(ff.integ), da = new Uint8Array(ff.dir);
  ff.begin(goalG, 1); while (!ff.step(7));
  ok('chunked build == one-shot build (integ, dir)', Buffer.compare(Buffer.from(a.buffer), Buffer.from(ff.integ.buffer)) === 0 && Buffer.compare(Buffer.from(da), Buffer.from(ff.dir)) === 0, '');
}

// ---- 2. smoothPath keeps link ends; ground-only identical to the plain path ------
{
  const g = makeLayered();
  const as = createAStar(g), path = new Int32Array(g.totalCells), out = new Float64Array(2 * g.totalCells), outZ = new Float64Array(g.totalCells);
  const goal = sheetCellIndex(g, 2, 6, 2);
  const len = findPathCells(as, 3 * GW + 2, goal, path);
  ok('stair path found', len > 0 && path[len - 1] === goal && !as.partial, `len ${len}`);
  const cnt = smoothPath(g, path, len, out, outZ);
  ok('smoothing shrinks the layered path', cnt < len, `${cnt} of ${len}`);
  const L = g.layers;
  let linkEnds = 0, kept = true;
  const has = (cell) => {
    g.cellPos(cell, pos);
    for (let i = 0; i < cnt; i++) if (out[2 * i] === pos.x && out[2 * i + 1] === pos.y && outZ[i] === pos.z) return true;
    return false;
  };
  for (let i = 1; i < len; i++) {
    let link = false;
    for (let k = 0; k < L.nLinks; k++) if (L.from[k] === path[i - 1] && L.to[k] === path[i]) link = true;
    if (link) { linkEnds++; if (!has(path[i - 1]) || !has(path[i])) kept = false; }
  }
  ok('every link end stays a waypoint (bridge + stair + landing)', linkEnds >= 3 && kept, `links ${linkEnds}`);
  ok('first/last waypoint = path ends, z = cellZ', has(path[0]) && has(path[len - 1]) && outZ[cnt - 1] === 2.0, `lastZ ${outZ[cnt - 1]}`);

  // Ground-only path: same waypoints on the layered grid and on a plain ground grid.
  const plain = makeGround(), outP = new Float64Array(2 * N);
  const asP = createAStar(plain), pathP = new Int32Array(N);
  const lenP = findPath(asP, 1, 1, 12, 14, pathP);
  const cP = smoothPath(plain, pathP, lenP, outP);
  const cL = smoothPath(g, pathP, lenP, out);
  let same = cP === cL;
  for (let i = 0; same && i < 2 * cP; i++) if (outP[i] !== out[i]) same = false;
  ok('ground-only cell path smooths identically with layers present', same && cP >= 2, `${cP} vs ${cL}`);

  // Open-floor sheet run is pulled straight (upper floor diagonal)
  const lf = findPathCells(as, sheetCellIndex(g, 2, 0, 7), sheetCellIndex(g, 2, 7, 0), path);
  const cf = smoothPath(g, path, lf, out);
  ok('open sheet floor pulled to 2 waypoints', lf > 2 && cf === 2, `len ${lf} -> ${cf}`);
}

// ---- 3. steer never enters a cost-0 cell on a sheet ------------------------------
{
  const g = new NavGrid({ x0: 0, y0: 0, w: 20, h: 10, cell: 1 });
  g.terrainCost.fill(1); g._recomputeCost();
  const sh = sheet(5, 2, 10, 5, 1, 2.0);
  for (let y = 0; y < 5; y++) sh.cost[y * 10 + 4] = 0; // railing column x = 9 on the deck
  g.buildLayersFromArrays({ sheets: [sh], links: [] });
  const steer = createSteer({ maxAgents: 4, bounds: { x0: 0, y0: 0, w: 20, h: 10 } });
  const a = steer.addAgent(6.5, 4.5, 0.3, 3, 20), b = steer.addAgent(6.5, 8.5, 0.3, 3, 20);
  steer.setZ(a, 2.0); steer.setZ(b, 0);
  steer.setWaypoint(a, 13.5, 4.5); steer.setWaypoint(b, 13.5, 8.5);
  let bad = 0, maxXa = 0;
  for (let i = 0; i < 600; i++) {
    steer.step(1 / 60, g);
    if (!isWalkableHere(g, steer.x[a], steer.y[a], steer.z[a])) bad++;
    if (!isWalkableHere(g, steer.x[b], steer.y[b], steer.z[b])) bad++;
    if (steer.x[a] > maxXa) maxXa = steer.x[a];
  }
  ok('deck agent stops at the cost-0 railing column although open ground lies below', bad === 0 && maxXa < 9.0, `bad ${bad} maxX ${maxXa}`);
  ok('ground agent (z=0) passes under the deck', steer.x[b] > 13.3, `x ${steer.x[b]}`);

  // Whole fixture: steer + flow field climbs bridge and stair, never in a cost-0 cell.
  const g2 = makeLayered();
  const ff = createFlowField(g2);
  ff.begin(new Int32Array([sheetCellIndex(g2, 2, 6, 2)]), 1); ff.step(1e9);
  const s2 = createSteer({ maxAgents: 2, bounds: { x0: 0, y0: 0, w: GW, h: GH } });
  const c = s2.addAgent(5.5, 3.5, 0.3, 4, 30);
  s2.setFlow(c, ff, 0.5);
  let bad2 = 0, maxZ = 0;
  for (let i = 0; i < 4000; i++) {
    s2.step(1 / 60, g2);
    if (!isWalkableHere(g2, s2.x[c], s2.y[c], s2.z[c])) bad2++;
    if (s2.z[c] > maxZ) maxZ = s2.z[c];
  }
  ok('flow-follow steer crosses bridge + stair to the upper floor without a cost-0 cell', bad2 === 0 && maxZ === 2.0 && s2.x[c] > 31, `bad ${bad2} maxZ ${maxZ} at ${s2.x[c].toFixed(2)},${s2.y[c].toFixed(2)},${s2.z[c]}`);
}

// ---- 4. zero alloc + determinism -------------------------------------------------
{
  const g = makeLayered();
  const ff = createFlowField(g), as = createAStar(g), path = new Int32Array(g.totalCells), out = new Float64Array(2 * g.totalCells), outZ = new Float64Array(g.totalCells);
  const goals = new Int32Array([sheetCellIndex(g, 2, 6, 2)]), o = { x: 0, y: 0 };
  const steer = createSteer({ maxAgents: 4, bounds: { x0: 0, y0: 0, w: GW, h: GH } });
  const a = steer.addAgent(5.5, 3.5, 0.3, 4, 30); steer.addAgent(6.5, 3.5, 0.3, 4, 30);
  const goal = sheetCellIndex(g, 2, 6, 2);
  ff.begin(goals, 1); ff.step(1e9);
  steer.setFlow(a, ff, 0.5);
  const run = (n) => {
    for (let i = 0; i < n; i++) {
      ff.begin(goals, 1); ff.step(1e9);
      ff.dirAt(20.5, 9.5, o, 0.3);
      const len = findPathCells(as, 3 * GW + 2, goal, path);
      smoothPath(g, path, len, out, outZ);
      steer.step(1 / 60, g);
    }
  };
  run(3000); // warm-up (JIT)
  let best = Infinity;
  for (let w = 0; w < 5; w++) {
    global.gc(); global.gc();
    const m0 = process.memoryUsage().heapUsed;
    run(200);
    const d = process.memoryUsage().heapUsed - m0;
    if (d < best) best = d;
  }
  ok('0 alloc: layered flow build + dirAt + smoothPath + steer.step', best < 16 * 1024, `grew ${best} B`);

  const sim = () => {
    const s = createSteer({ maxAgents: 2, bounds: { x0: 0, y0: 0, w: GW, h: GH } });
    const c = s.addAgent(5.5, 3.5, 0.3, 4, 30); s.setFlow(c, ff, 0.5);
    for (let i = 0; i < 1500; i++) s.step(1 / 60, g);
    return `${s.x[c]},${s.y[c]},${s.z[c]}`;
  };
  ok('steer + layered flow deterministic across runs', sim() === sim(), '');
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
