// engine/nav/sheetsBake.test.js (NAV-LAYERS-01b, docs/architecture.md 38.71). bakeSheets with fake probes.
// Run: node engine/nav/sheetsBake.test.js
import { NavGrid } from './NavGrid.js';
import { createAStar, findPath, findPathCells } from './astar.js';
import { bakeSheets } from './sheets.js';
import { createHasher } from '../core/hash.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// Fake geometry: boxes {x0,y0,x1,y1,top}; probe returns the highest top <= footZ covering (x,y).
function makeProbe(boxes) {
  return (x, y, foot, out) => {
    let best = -Infinity, nz = 1;
    for (const b of boxes) {
      if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1 && b.top <= foot + 1e-6 && b.top > best) { best = b.top; nz = b.nz ?? 1; }
    }
    if (best === -Infinity) return false;
    out.z = best; out.nz = nz;
    return true;
  };
}
const box = (x0, y0, x1, y1, top, nz) => ({ x0, y0, x1, y1, top, nz });
function ground(w, h, holes) {
  const g = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  g.terrainCost.fill(1);
  for (const [x0, y0, x1, y1] of holes) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.terrainCost[y * w + x] = 0;
  g._recomputeCost();
  return g;
}
function hashOf(g) { const h = createHasher(); g.hashInto(h); return h.value(); }
function layerBytes(L) {
  return [L.x0, L.y0, L.w, L.h, L.cell, L.base, L.cost, L.height, L.from, L.to, L.lcost, L.kind, L.flags, L.linkFlag]
    .map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('hex')).join('|');
}
const timing = [];
// world-xy -> height of any walkable sheet cell there (null if none)
function hAt(L, x, y) {
  for (let s = 0; s < L.count; s++) {
    const c = L.cell[s], lx = Math.floor((x - L.x0[s]) / c), ly = Math.floor((y - L.y0[s]) / c);
    if (lx >= 0 && ly >= 0 && lx < L.w[s] && ly < L.h[s] && L.cost[L.base[s] + ly * L.w[s] + lx]) return L.height[L.base[s] + ly * L.w[s] + lx];
  }
  return null;
}

// ---- 1. 2-storey house: ring wall with a 1 m door, stair, opening, low shelf --------------------
// Footprint x 10..22, y 2..12 (ground cells there are holes). Walls 0.5 m thick, 4 m high. South door x 15..16.
function houseScene() {
  const g = ground(32, 16, [[10, 2, 22, 12]]);
  const boxes = [
    box(10.5, 2.5, 21.5, 11.5, 0),            // ground-floor slab
    box(15, 2, 16, 2.5, 0),                   // door threshold
    box(10, 2, 15, 2.5, 4), box(16, 2, 22, 2.5, 4), // south wall with 1 m gap
    box(10, 11.5, 22, 12, 4), box(10, 2, 10.5, 12, 4), box(21.5, 2, 22, 12, 4), // other walls
    box(14, 2.5, 21.5, 11.5, 3),              // upper floor (x >= 14); stair opening over x 11..14
    box(10.5, 8, 12, 9.5, 1.4),               // low shelf: floor under it has 1.4 m headroom -> cut
  ];
  for (let k = 0; k < 6; k++) boxes.push(box(11 + 0.5 * k, 5, 11.5 + 0.5 * k, 6, 0.5 * (k + 1))); // stair +0.5 per cell
  return { g, boxes, src: [{ id: 'house', x0: 10, y0: 2, x1: 22, y1: 12, zTop: 5, cell: 0.5 }] };
}
{
  const { g, boxes, src } = houseScene();
  const r = bakeSheets(g, src, makeProbe(boxes));
  timing.push(...r.stats);
  const L = g.layers;
  ok('house: sheets baked', !!L, 'no layers');
  console.log(`  house: ${L.count} sheets, ${L.nLinks} links, ${L.cost.length} cells, dropped ${r.dropped}`);
  ok('house: wall tops + shelf top dropped as unreachable', r.dropped >= 1, `dropped=${r.dropped}`);
  ok('house: walkable floor inside (z 0), none in the wall', hAt(L, 12, 4) === 0 && hAt(L, 10.25, 6) === null);
  ok('house: 1 m door survives at 0.5 m cells', hAt(L, 15.25, 2.25) === 0 && hAt(L, 15.75, 2.25) === 0 && hAt(L, 14.75, 2.25) === null);
  ok('house: headroom cut under the 1.4 m shelf', hAt(L, 11, 8.25) === null, `h=${hAt(L, 11, 8.25)}`);
  ok('house: floor beside the shelf stays', hAt(L, 13, 8.25) === 0);
  const hs = (x, y) => { const o = []; for (let s = 0; s < L.count; s++) { const c = L.cell[s], lx = Math.floor((x - L.x0[s]) / c), ly = Math.floor((y - L.y0[s]) / c); if (lx >= 0 && ly >= 0 && lx < L.w[s] && ly < L.h[s] && L.cost[L.base[s] + ly * L.w[s] + lx]) o.push(L.height[L.base[s] + ly * L.w[s] + lx]); } return o; };
  ok('house: stair steps 0.5 .. 3.0 present', hs(13.75, 5.5).includes(3) && hs(11.25, 5.5).includes(0.5) && hs(12.25, 5.5).includes(1.5), hs(13.75, 5.5) + ' | ' + hs(11.25, 5.5));
  ok('house: upper floor at z 3 (x >= 14)', hAt(L, 18, 8) === 3 || hAt(L, 18, 8) === 0);
  // storeys are separate sheets: same xy, two heights
  const heights = new Set();
  for (let s = 0; s < L.count; s++) {
    const c = L.cell[s], lx = Math.floor((18 - L.x0[s]) / c), ly = Math.floor((8 - L.y0[s]) / c);
    if (lx >= 0 && ly >= 0 && lx < L.w[s] && ly < L.h[s] && L.cost[L.base[s] + ly * L.w[s] + lx]) heights.add(L.height[L.base[s] + ly * L.w[s] + lx]);
  }
  ok('house: both storeys present above (18, 8): z 0 and z 3', heights.has(0) && heights.has(3), [...heights].join(','));
  const a = createAStar(g), path = new Int32Array(g.totalCells);
  const gs = g.locate(18.25, 8.25, 3);
  const len = findPathCells(a, 1 * 32 + 15, gs, path); // ground cell (15,1) south of the door
  ok('house: path outside -> door -> stair -> upper floor', len > 0 && !a.partial && path[len - 1] === gs, `len=${len} partial=${a.partial} z=${g.cellZ(gs)}`);
  let zmax = 0;
  for (let i = 0; i < len; i++) zmax = Math.max(zmax, g.cellZ(path[i]));
  ok('house: path reaches z 3', zmax === 3, `zmax=${zmax}`);
}

// ---- 2. bridge over unwalkable water + slope filter -------------------------------------------
{
  const g = ground(40, 12, [[15, 0, 25, 12]]);
  const boxes = [box(14, 5, 26, 7, 0.3), box(14, 0, 15, 4, 0.2, 0.3)]; // deck + steep slab (normal z 0.3: slope rejected)
  const r = bakeSheets(g, [{ id: 'bridge', x0: 14, y0: 0, x1: 26, y1: 8, zTop: 3, cell: 1 }], makeProbe(boxes));
  timing.push(...r.stats);
  const L = g.layers;
  let walk = 0;
  for (let i = 0; i < L.cost.length; i++) walk += L.cost[i] ? 1 : 0;
  ok('bridge: one sheet of 24 cells (12 x 2), steep slab rejected', L.count === 1 && walk === 24, `count=${L.count} walk=${walk}`);
  const a = createAStar(g), path = new Int32Array(g.totalCells);
  const len = findPath(a, 5, 6, 35, 6, path);
  let water = 0, deck = 0;
  for (let i = 0; i < len; i++) { if (path[i] >= 40 * 12) deck++; else if (g.cost[path[i]] === 0) water++; }
  ok('bridge: path crosses over the water', len > 0 && !a.partial && water === 0 && deck >= 10, `len=${len} deck=${deck} water=${water}`);
}

// ---- 3. ruin room: 1 m gap, beam slab cutting the floor --------------------------------------------
{
  const g = ground(30, 20, [[10, 5, 18, 13]]);
  const boxes = [
    box(10.5, 5.5, 17.5, 12.5, 0.1),          // broken floor
    box(10, 5, 18, 5.5, 2), box(10, 12.5, 18, 13, 2), box(10, 5, 10.5, 13, 2), box(17.5, 5, 18, 13, 2),
    box(13, 5, 14, 5.5, 0.1),                 // 1 m gap in the south wall
    box(11, 9, 13, 11, 1.2),                  // collapsed beam: floor under it has 1.1 m headroom
  ];
  const r = bakeSheets(g, [{ id: 'ruin', x0: 10, y0: 5, x1: 18, y1: 13, zTop: 3, cell: 0.5 }], makeProbe(boxes));
  timing.push(...r.stats);
  const L = g.layers;
  ok('ruin: one reachable sheet; walls + beam top dropped', L.count === 1 && r.dropped >= 1, `count=${L.count} dropped=${r.dropped}`);
  const a = createAStar(g), path = new Int32Array(g.totalCells);
  const goal = g.locate(12.25, 7.25, 0.1);
  const len = findPathCells(a, 3 * 30 + 13, goal, path);
  ok('ruin: path through the 1 m gap into the room', len > 0 && !a.partial && path[len - 1] === goal, `len=${len}`);
  ok('ruin: floor under the beam is cut, beside it stays', hAt(L, 12, 10) === null && Math.abs(hAt(L, 12, 8) - 0.1) < 1e-6 && Math.abs(hAt(L, 15, 10) - 0.1) < 1e-6, hAt(L, 12, 10) + ' ' + hAt(L, 12, 8));
}

// ---- 4. determinism, hash, drops, caps -----------------------------------------------------------
{
  const s1 = houseScene(), s2 = houseScene();
  bakeSheets(s1.g, s1.src, makeProbe(s1.boxes));
  bakeSheets(s2.g, s2.src, makeProbe(s2.boxes.slice().reverse()));
  ok('bake twice -> identical bytes (probe box order irrelevant)', layerBytes(s1.g.layers) === layerBytes(s2.g.layers));
  ok('hashInto includes layers and is stable', hashOf(s1.g) === hashOf(s2.g));
  ok('layers change the hash', hashOf(houseScene().g) !== hashOf(s1.g));
  const hClosed = hashOf(s1.g);
  const door = ground(20, 20, []);
  ok('ground-only hash is stable', hashOf(door) === hashOf(ground(20, 20, [])));
  void hClosed;

  const mk = (autoDrops) => {
    const g = ground(20, 10, []);
    return bakeSheets(g, [{ id: 'ledge', x0: 5, y0: 2, x1: 8, y1: 6, zTop: 5, cell: 1 }], makeProbe([box(5, 2, 8, 6, 2)]), { autoDrops, keepIsolated: true });
  };
  const noDrop = mk(false), withDrop = mk(true);
  ok('drops: none by default, one-way (kind 2) with autoDrops', noDrop.layers.nLinks === 0 && withDrop.layers.nLinks > 0 && withDrop.layers.kind[0] === 2, `${noDrop.layers.nLinks} ${withDrop.layers.nLinks}`);
  let msg = '';
  try { bakeSheets(ground(20, 10, []), [{ id: 'big', x0: 0, y0: 0, x1: 20, y1: 10, zTop: 1, cell: 0.5 }], makeProbe([box(0, 0, 20, 10, 0)]), { maxSheetCells: 100, keepIsolated: true }); } catch (e) { msg = String(e.message); }
  ok('cap: overflow names the source', msg.includes('"big"'), msg);
}

console.log('bake ms per source:', timing.map((t) => `${t.id}=${t.ms.toFixed(2)} (${t.cells} cells, ${t.sheets} comps)`).join(', '));
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
