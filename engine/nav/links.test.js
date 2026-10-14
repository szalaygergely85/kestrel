// engine/nav/links.test.js (NAV-LINKS-01a, docs/architecture.md 38.71): authored links (ladder, one-way drop, door with stateKey)
// from content data: validateLinks, addAuthoredLinks, per-kind A* + flow field, determinism. Run: node engine/nav/links.test.js
import { NavGrid } from './NavGrid.js';
import { createAStar, findPath } from './astar.js';
import { createFlowField } from './flowField.js';
import { validateLinks, addAuthoredLinks } from './sheets.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const GW = 40, GH = 16, WALL = 20;
// 40x16 ground, solid wall at x = 20 (a cliff / wall the links get across).
function makeGround() {
  const g = new NavGrid({ x0: 0, y0: 0, w: GW, h: GH, cell: 1 });
  g.terrainCost.fill(1);
  for (let y = 0; y < GH; y++) g.terrainCost[y * GW + WALL] = 0;
  g._recomputeCost();
  return g;
}
const pt = (x, y, z = 0) => ({ x, y, z });
const LADDER = { id: 'lad', kind: 'ladder', from: pt(19.5, 5.5), to: pt(21.5, 5.5, 3) };
const DROP = { id: 'drop', kind: 'drop', from: pt(19.5, 10.5, 3), to: pt(21.5, 10.5, 0) };
const DOOR = { id: 'door', kind: 'door', from: pt(19.5, 14.5), to: pt(21.5, 14.5), stateKey: 'gate1' };

const out = new Int32Array(GW * GH + 64);
function route(g, ax, ay, bx, by) {
  const as = createAStar(g), n = findPath(as, ax, ay, bx, by, out);
  return { n, partial: as.partial, cells: Array.from(out.subarray(0, n)) };
}
// flow field seeded at goal: integ finite at start = start -> goal traversable
function reachable(g, goal, start) {
  const ff = createFlowField(g);
  ff.begin(new Int32Array([goal]), 1); ff.step(1e9);
  return ff.integ[start] !== 0xffffffff;
}
const cell = (x, y) => y * GW + x;

// ---- validateLinks ----------------------------------------------------------------------------------------------------
{
  ok('valid defs: no errors (shape)', validateLinks([LADDER, DROP, DOOR]).length === 0, validateLinks([LADDER, DROP, DOOR]).join('|'));
  const g = makeGround();
  ok('valid defs: no errors (grid)', validateLinks([LADDER, DROP, DOOR], g).length === 0, validateLinks([LADDER, DROP, DOOR], g).join('|'));
  const bad = (d, g2) => validateLinks([d], g2 || null);
  ok('bad kind', bad({ ...LADDER, kind: 'rope' }).length === 1);
  ok('door without stateKey', bad({ ...DOOR, stateKey: undefined }).some((e) => e.includes('stateKey')));
  ok('stateKey on a ladder', bad({ ...LADDER, stateKey: 'x' }).some((e) => e.includes('only for doors')));
  ok('non-finite end', bad({ ...LADDER, to: { x: 1, y: NaN, z: 0 } }).some((e) => e.includes('finite')));
  ok('duplicate id', validateLinks([LADDER, LADDER]).some((e) => e.includes('duplicate')));
  ok('drop must fall more than maxStepM', bad({ ...DROP, from: pt(19.5, 10.5, 0.3) }).some((e) => e.includes('drop must fall')));
  ok('end in the wall (not walkable)', bad({ ...LADDER, from: pt(20.5, 5.5) }, g).some((e) => e.includes('not walkable')));
  ok('end off the grid', bad({ ...LADDER, to: pt(90, 5.5) }, g).some((e) => e.includes('not walkable')));
  ok('same cell', bad({ ...LADDER, to: pt(19.5, 5.5) }, g).some((e) => e.includes('same cell')));
  ok('cost below the admissible bound', bad({ ...LADDER, cost: 5 }, g).some((e) => e.includes('admissible')));
  ok('non-integer cost', bad({ ...LADDER, cost: 2.5 }).length === 1);
  let threw = '';
  try { addAuthoredLinks(makeGround(), [{ ...LADDER, cost: 5 }]); } catch (e) { threw = e.message; }
  ok('addAuthoredLinks throws the plain errors', threw.startsWith('nav links:') && threw.includes('admissible'), threw);
}

// ---- no links: the wall splits the map ---------------------------------------------------------------------------------
{
  ok('baseline: wall blocks the route', route(makeGround(), 5, 5, 35, 5).partial);
  const g0 = makeGround();
  addAuthoredLinks(g0, []);
  ok('empty link list leaves a ground-only grid (layers stay null)', g0.layers === null);
}

// ---- ladder: two-way, A* + flow ----------------------------------------------------------------------------------------
{
  const g = makeGround();
  const { stateKeys } = addAuthoredLinks(g, [LADDER]);
  ok('ladder: no state keys', stateKeys.length === 0);
  const fwd = route(g, 5, 5, 35, 5), back = route(g, 35, 5, 5, 5);
  ok('ladder: route west -> east crosses via the link', !fwd.partial && fwd.cells.includes(cell(19, 5)) && fwd.cells.includes(cell(21, 5)));
  ok('ladder: two-way (east -> west)', !back.partial && back.n > 0);
  ok('ladder: flow field reaches both ways', reachable(g, cell(35, 5), cell(5, 5)) && reachable(g, cell(5, 5), cell(35, 5)));
}

// ---- drop: one way -----------------------------------------------------------------------------------------------------
{
  const g = makeGround();
  addAuthoredLinks(g, [DROP]);
  const down = route(g, 5, 10, 35, 10), up = route(g, 35, 10, 5, 10);
  ok('drop: west (high) -> east (low) works', !down.partial && down.cells.includes(cell(19, 10)) && down.cells.includes(cell(21, 10)));
  ok('drop: east -> west is blocked (one way)', up.partial);
  // NAV-FLOW-REV: flow expands links in reverse.
  ok('drop flow: goal below -> cells above reach it', reachable(g, cell(35, 10), cell(5, 10)));
  ok('drop flow: goal above -> cells below do NOT route through the drop', !reachable(g, cell(5, 10), cell(35, 10)));
  const ff = createFlowField(g), o = { x: 0, y: 0 };
  ff.begin(new Int32Array([cell(35, 10)]), 1); ff.step(1e9);
  ff.dirAt(19.5, 10.5, o, 3);
  ok('drop flow: cell at the drop top points over the drop (+x)', o.x > 0.9);
  ok('drop flow: dir at drop top is a link move', ff.dir[cell(19, 10)] === 253 && ff.next[cell(19, 10)] === cell(21, 10));
  const ff2 = createFlowField(g), ff3 = createFlowField(g);
  for (const f of [ff2, ff3]) { f.begin(new Int32Array([cell(35, 10)]), 1); f.step(1e9); }
  ok('drop flow: deterministic', Buffer.compare(Buffer.from(ff2.integ.buffer), Buffer.from(ff3.integ.buffer)) === 0 && Buffer.compare(Buffer.from(ff2.dir), Buffer.from(ff3.dir)) === 0);
  // 0 alloc with reverse expansion: covered by layersFlow.test.js (gc-based probe)
}

// ---- door: stateKey + setLinkOpen --------------------------------------------------------------------------------------
{
  const g = makeGround();
  const { stateKeys } = addAuthoredLinks(g, [DOOR, { ...DOOR, id: 'door2', from: pt(19.5, 13.5), to: pt(21.5, 13.5) }]);
  ok('door: stateKeys = [gate1] (two doors share one key)', stateKeys.length === 1 && stateKeys[0] === 'gate1');
  ok('door starts closed', route(g, 5, 14, 35, 14).partial);
  const v0 = g.version;
  g.setLinkOpen(stateKeys.indexOf('gate1'), true);
  ok('setLinkOpen bumps the grid version', g.version > v0);
  const open = route(g, 5, 14, 35, 14);
  ok('door open: route passes the door', !open.partial && open.cells.includes(cell(19, 14)) && open.cells.includes(cell(21, 14)));
  ok('door open: second door of the same key opens too', !route(g, 5, 13, 35, 13).partial);
  ok('door open: flow reaches both ways', reachable(g, cell(35, 14), cell(5, 14)) && reachable(g, cell(5, 14), cell(35, 14)));
  g.setLinkOpen(0, false);
  ok('door closed again: route blocked', route(g, 5, 14, 35, 14).partial && !reachable(g, cell(35, 14), cell(5, 14)));
  const g2 = makeGround();
  addAuthoredLinks(g2, [{ ...DOOR, open: true }]);
  ok('door with open:true starts open', !route(g2, 5, 14, 35, 14).partial);
}

// ---- all kinds together: same result every run -------------------------------------------------------------------------
{
  const build = () => { const g = makeGround(); const r = addAuthoredLinks(g, [DOOR, DROP, LADDER]); g.setLinkOpen(0, true); return { g, r }; };
  const A = build(), B = build();
  const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const same = (k) => Buffer.compare(bytes(A.g.layers[k]), bytes(B.g.layers[k])) === 0;
  ok('link table bytes identical across builds', ['from', 'to', 'lcost', 'kind', 'flags', 'stateIdx', 'linkFlag'].every(same));
  const paths = (g) => JSON.stringify([route(g, 5, 5, 35, 5).cells, route(g, 5, 14, 35, 14).cells, route(g, 5, 10, 35, 10).cells]);
  ok('paths identical across builds', paths(A.g) === paths(B.g));
  ok('link table is sorted by (from, to)', (() => {
    const L = A.g.layers;
    for (let k = 1; k < L.nLinks; k++) if (L.from[k - 1] > L.from[k] || (L.from[k - 1] === L.from[k] && L.to[k - 1] > L.to[k])) return false;
    return true;
  })());
}

console.log(`links: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join(String.fromCharCode(10))); process.exit(1); }
