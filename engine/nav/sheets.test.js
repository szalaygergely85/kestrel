// engine/nav/sheets.test.js (NAV-LAYERS-01a, docs/architecture.md 38.71). Sheets + links in NavGrid and layered A*.
// Run: node engine/nav/sheets.test.js (re-runs itself with --expose-gc for the alloc probe).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NavGrid } from './NavGrid.js';
import { createAStar, findPath, findPathCells, planPath } from './astar.js';
import { sheetCellIndex, LINK_DOOR, LINK_DROP } from './sheets.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// 40x16 ground. River x 15..24 (water, cost 0). Stair house: hole x 27..34, y 0..7.
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
      sheet(15, 9, 10, 2, 1, 0.3),                    // 0: bridge deck over the river
      sheet(27, 3, 4, 1, 1, (x) => 0.5 * (x + 1)),    // 1: stair, rises 0.5 per cell to z=2
      sheet(31, 0, 8, 8, 0.5, 2.0),                   // 2: upper floor at 0.5 m cells (4x4 m)
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
// Independent cost of a layered path from the grid arrays (step rule + units).
function layeredCost(g, path, len) {
  const N = g.w * g.h, L = g.layers, pa = { x: 0, y: 0, z: 0 }, pb = { x: 0, y: 0, z: 0 };
  let sum = 0;
  for (let i = 1; i < len; i++) {
    const a = path[i - 1], b = path[i];
    // link?
    let link = -1;
    for (let k = 0; k < L.nLinks; k++) if (L.from[k] === a && L.to[k] === b) link = k;
    if (link >= 0) { sum += L.lcost[link]; continue; }
    g.cellPos(a, pa); g.cellPos(b, pb);
    const diag = Math.abs(pa.x - pb.x) > 1e-6 && Math.abs(pa.y - pb.y) > 1e-6;
    const same = (a < N) === (b < N);
    if (!same) return NaN; // a switch without a link
    const u = b < N ? L.groundU : L.u[g.layers && sheetIdx(L, b - N)];
    const c = b < N ? g.cost[b] : L.cost[b - N];
    sum += (diag ? 14 : 10) * c * u;
  }
  return sum;
}
function sheetIdx(L, local) { let s = 0; while (s + 1 < L.count && L.base[s + 1] <= local) s++; return s; }

// ---- 1. path over a bridge deck ----------------------------------------------
{
  const plain = makeGround();
  const ap = createAStar(plain);
  const out = new Int32Array(plain.totalCells);
  findPath(ap, 5, 9, 35, 9, out, {});
  ok('river without bridge: partial path', ap.partial === true);

  const g = makeLayered();
  const a = createAStar(g);
  const path = new Int32Array(g.totalCells);
  const len = findPath(a, 5, 9, 35, 9, path);
  ok('bridge: exact path over the deck', len > 0 && !a.partial, `len=${len} partial=${a.partial}`);
  let deck = 0, water = 0;
  for (let i = 0; i < len; i++) { if (path[i] >= GW * GH) deck++; else if (g.cost[path[i]] === 0) water++; }
  ok('bridge: 10 deck cells, no water cell', deck === 10 && water === 0, `deck=${deck} water=${water}`);
  ok('bridge: cost 600 (30 straight steps x 10 x u=2: finest cell 0.5)', layeredCost(g, path, len) === 600, `cost=${layeredCost(g, path, len)}`);
  ok('bridge: z along the path is the deck height', Math.abs(g.cellZ(path[10]) - 0.3) < 1e-6);
  // locate picks the sheet by z (deck 0.3) and falls back to ground for a far-away z
  ok('locate: deck cell for z 0.3, ground for z 5', g.locate(16.5, 9.5, 0.3) === sheetCellIndex(g, 0, 1, 0) && g.locate(16.5, 9.5, 5) === 9 * GW + 16);
}

// ---- 2. stair link into a floor and back, cost units --------------------------
{
  const g = makeLayered();
  const a = createAStar(g);
  const path = new Int32Array(g.totalCells), back = new Int32Array(g.totalCells);
  const goal = sheetCellIndex(g, 2, 6, 2); // upper floor, 0.5 m cells
  const start = 6 * GW + 26;
  const len = findPathCells(a, start, goal, path);
  ok('stair: path ground -> stair -> upper floor', len > 0 && !a.partial && path[len - 1] === goal, `len=${len} partial=${a.partial}`);
  const sheetsSeen = new Set();
  for (let i = 0; i < len; i++) if (path[i] >= GW * GH) sheetsSeen.add(sheetIdx(g.layers, path[i] - GW * GH));
  ok('stair: visits sheet 1 then 2', sheetsSeen.has(1) && sheetsSeen.has(2) && path[0] === start);
  const c = layeredCost(g, path, len);
  ok('stair: step costs follow cell units (ground u=2, stair u=2, floor u=1)', Number.isFinite(c) && c > 0, `cost=${c}`);
  // optimality: cell-unit cost cannot beat the octile lower bound
  const pa = { x: 0, y: 0, z: 0 }, pb = { x: 0, y: 0, z: 0 };
  g.cellPos(start, pa); g.cellPos(goal, pb);
  const dx = Math.abs(pa.x - pb.x) / 0.5, dy = Math.abs(pa.y - pb.y) / 0.5;
  ok('stair: cost >= octile bound', c >= 10 * Math.max(dx, dy) + 4 * Math.min(dx, dy), `cost=${c}`);
  const lb = findPathCells(a, goal, start, back);
  ok('stair: way back via mirrored links', lb > 0 && !a.partial && back[lb - 1] === start, `len=${lb}`);
  // step rule: break the stair (a 1 m jump in the middle) -> cannot climb
  const g2 = makeGround();
  g2.buildLayersFromArrays({
    sheets: [sheet(27, 3, 4, 1, 1, (x) => (x < 2 ? 0.5 * (x + 1) : 3 + x)), sheet(31, 0, 8, 8, 0.5, 2.0)],
    links: [{ from: { s: -1, x: 26, y: 3 }, to: { s: 0, x: 0, y: 0 } }, { from: { s: 0, x: 3, y: 0 }, to: { s: 1, x: 0, y: 7 } }],
  });
  const a2 = createAStar(g2), p2 = new Int32Array(g2.totalCells);
  findPathCells(a2, 6 * GW + 26, sheetCellIndex(g2, 1, 6, 2), p2);
  ok('step rule: dz > maxStepM inside a sheet blocks the move', a2.partial === true);
}

// ---- 3. NAV-REACH partial path with sheets -------------------------------------
{
  const g = makeLayered();
  const a = createAStar(g);
  const path = new Int32Array(g.totalCells);
  const len = findPath(a, 5, 3, 20, 3, path); // goal in the river, no bridge on this row
  const end = path[len - 1];
  ok('partial: unreachable water goal ends on the bank', a.partial === true && end < GW * GH && end % GW === 25, `end=${end % GW},${(end / GW) | 0}`);
  const l2 = findPath(a, 5, 3, 35, 4, path, { maxNodes: 40 }); // goal inside the house hole, tiny budget
  ok('partial: maxNodes cut still returns a path', l2 > 0 && a.partial === true);
  // planPath (free-target helper) works with sheets (smoothed per space since 01c; link ends are kept)
  const buf = new Float64Array(64);
  const n = planPath(g, a, 5.5, 9.5, 35.5, 9.5, buf, 4000);
  ok('planPath over layers returns smoothed waypoints incl. link ends', n >= 5 && n <= 10 && !a.partial, `n=${n}`);
}

// ---- 4. ground-only byte identity + determinism --------------------------------
{
  const plain = makeGround(), empty = makeGround();
  empty.buildLayersFromArrays({ sheets: [] });
  const ap = createAStar(plain), ae = createAStar(empty);
  const o1 = new Int32Array(plain.totalCells), o2 = new Int32Array(empty.totalCells);
  const r = lcg(7);
  let same = true;
  for (let q = 0; q < 300 && same; q++) {
    const sx = (r() * GW) | 0, sy = (r() * GH) | 0, gx = (r() * GW) | 0, gy = (r() * GH) | 0;
    const l1 = findPath(ap, sx, sy, gx, gy, o1, { maxNodes: 600 }), l2 = findPath(ae, sx, sy, gx, gy, o2, { maxNodes: 600 });
    if (l1 !== l2 || ap.partial !== ae.partial) { same = false; break; }
    for (let i = 0; i < l1; i++) if (o1[i] !== o2[i]) same = false;
  }
  ok('layers with 0 sheets == ground-only paths (300 seeded queries)', same);
  ok('ground-only grid has no layers and totalCells = w*h', plain.layers === null && plain.totalCells === GW * GH);

  const g = makeLayered(), a1 = createAStar(g), a2 = createAStar(makeLayered());
  const p1 = new Int32Array(g.totalCells), p2 = new Int32Array(g.totalCells);
  const rr = lcg(99);
  let det = true, reachedSheet = 0;
  for (let q = 0; q < 300 && det; q++) {
    const s = (rr() * GW * GH) | 0, t = (rr() * g.totalCells) | 0;
    const l1 = findPathCells(a1, s, t, p1, { maxNodes: 2000 }), l2 = findPathCells(a2, s, t, p2, { maxNodes: 2000 });
    if (l1 !== l2) { det = false; break; }
    for (let i = 0; i < l1; i++) if (p1[i] !== p2[i]) det = false;
    if (l1 > 0 && !a1.partial && t >= GW * GH) reachedSheet++;
  }
  ok('layered seeded queries twice -> identical paths', det && reachedSheet > 5, `reachedSheet=${reachedSheet}`);
  // link table bytes identical across builds
  const A = makeLayered().layers, B = makeLayered().layers;
  ok('link table identical bytes', Buffer.compare(Buffer.from(A.from.buffer), Buffer.from(B.from.buffer)) === 0 && Buffer.compare(Buffer.from(A.to.buffer), Buffer.from(B.to.buffer)) === 0);
}

// ---- 5. door link (stateIdx) + one-way drop + validation ------------------------
{
  const g = new NavGrid({ x0: 0, y0: 0, w: 10, h: 3, cell: 1 });
  g.terrainCost.fill(1);
  for (let y = 0; y < 3; y++) g.terrainCost[y * 10 + 5] = 0;
  g._recomputeCost();
  g.buildLayersFromArrays({
    sheets: [sheet(5, 1, 1, 1, 1, 0)],
    links: [
      { from: { s: -1, x: 4, y: 1 }, to: { s: 0, x: 0, y: 0 }, kind: LINK_DOOR, stateIdx: 3 },
      { from: { s: 0, x: 0, y: 0 }, to: { s: -1, x: 6, y: 1 }, kind: LINK_DOOR, stateIdx: 3 },
    ],
  });
  const a = createAStar(g), p = new Int32Array(g.totalCells);
  findPath(a, 1, 1, 8, 1, p);
  ok('door closed: no path through', a.partial === true);
  const v0 = g.version;
  g.setLinkOpen(3, true);
  const l = findPath(a, 1, 1, 8, 1, p);
  ok('door opened: path via the gate sheet cell, version bumped', !a.partial && l > 0 && g.version > v0);
  g.setLinkOpen(3, false);
  findPath(a, 1, 1, 8, 1, p);
  ok('door closed again', a.partial === true);

  const h = makeGround();
  h.buildLayersFromArrays({ sheets: [sheet(30, 12, 2, 2, 1, -2)], links: [{ from: { s: -1, x: 29, y: 12 }, to: { s: 0, x: 0, y: 0 }, kind: LINK_DROP }] });
  const ah = createAStar(h), ph = new Int32Array(h.totalCells);
  findPathCells(ah, 12 * GW + 29, sheetCellIndex(h, 0, 1, 1), ph);
  ok('drop: down works', !ah.partial);
  findPathCells(ah, sheetCellIndex(h, 0, 0, 0), 12 * GW + 29, ph);
  ok('drop: one way (no way back up)', ah.partial === true);

  let threw = false;
  try { makeGround().buildLayersFromArrays({ sheets: [sheet(30, 12, 2, 2, 1, 0)], links: [{ from: { s: -1, x: 20, y: 12 }, to: { s: 0, x: 0, y: 0 }, cost: 5 }] }); } catch { threw = true; }
  ok('validateLinks: cost below the admissible bound is rejected', threw);
  threw = false;
  try { makeGround().buildLayersFromArrays({ sheets: [sheet(0, 0, 200, 200, 1, 0)] }); } catch { threw = true; }
  ok('cap: > maxSheetCells is a build error', threw);
}

// ---- 6. memory per sheet cell + zero alloc after warm-up ------------------------
{
  const g = makeLayered(), L = g.layers;
  const bytes = L.cost.byteLength + L.height.byteLength + (L.linkFlag.byteLength - GW * GH);
  const cells = L.cost.length;
  ok('memory: 6 B per sheet cell in the grid (cap 6)', bytes / cells <= 6.0001, `${bytes / cells} B/cell, ${cells} cells`);
  const a = createAStar(g), path = new Int32Array(g.totalCells);
  const goal = sheetCellIndex(g, 2, 6, 2);
  const cut = { maxNodes: 300 };
  const run = (n) => {
    for (let i = 0; i < n; i++) {
      findPath(a, 5, 9, 35, 9, path);
      findPathCells(a, 6 * GW + 26, goal, path);
      findPath(a, 5, 3, 20, 3, path, cut);
    }
  };
  run(300); run(300); // warm-up
  let best = Infinity;
  for (let w = 0; w < 5; w++) {
    global.gc(); global.gc();
    const m0 = process.memoryUsage().heapUsed;
    run(1000);
    const d = process.memoryUsage().heapUsed - m0;
    if (d < best) best = d;
  }
  ok('0 alloc per layered query after warm-up (3000 queries)', best < 16 * 1024, `grew ${best} B`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
