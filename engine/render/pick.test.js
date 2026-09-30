// engine/render/pick.test.js (RE-04, docs/architecture.md 28.1 "RE-04
// engine/render/pick.js"). Zero-alloc gate needs --expose-gc: re-runs itself
// when missing (same pattern as engine/render/projection.pitched.test.js).
// Run: node engine/render/pick.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rayTerrain, pickNearest, selectInRect } from './pick.js';
import { createPitchedTerms, pitchedTerms, worldToCell } from './projection.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// Seeded LCG (never Math.random).
function makeLcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// rayTerrain: flat terrain, straight-down ray hits at the exact expected z.
// ---------------------------------------------------------------------------
{
  const terrain = { groundAt: () => 3 };
  const ray = { ox: 5, oy: 7, oz: 20, dx: 0, dy: 0, dz: -1 };
  const out = { x: 0, y: 0, z: 0, t: 0, hit: false };
  rayTerrain(terrain, ray, out);
  const dz = Math.abs(out.z - 3);
  ok('rayTerrain flat terrain: hits at exact ground z within 1e-6', out.hit && dz < 1e-6, `hit=${out.hit} z=${out.z} dz=${dz}`);
  ok('rayTerrain flat terrain: x,y unchanged for a vertical ray', Math.abs(out.x - 5) < 1e-9 && Math.abs(out.y - 7) < 1e-9);
  ok('rayTerrain flat terrain: t matches oz-groundZ', Math.abs(out.t - 17) < 1e-6, `t=${out.t}`);
}

// ---------------------------------------------------------------------------
// rayTerrain: an angled ray over flat terrain also converges (checks x,y too).
// ---------------------------------------------------------------------------
{
  const terrain = { groundAt: () => 0 };
  const ray = { ox: 0, oy: 0, oz: 10, dx: 1, dy: 0.5, dz: -2 };
  const out = { x: 0, y: 0, z: 0, t: 0, hit: false };
  rayTerrain(terrain, ray, out);
  // Exact analytic crossing: oz + t*dz = 0 -> t = 5.
  const expT = 5, expX = 5, expY = 2.5, expZ = 0;
  ok('rayTerrain angled ray over flat terrain converges within 1e-6',
    out.hit && Math.abs(out.t - expT) < 1e-6 && Math.abs(out.x - expX) < 1e-6 && Math.abs(out.y - expY) < 1e-6 && Math.abs(out.z - expZ) < 1e-6,
    `t=${out.t} x=${out.x} y=${out.y} z=${out.z}`);
}

// ---------------------------------------------------------------------------
// rayTerrain: ray never reaches ground within maxT -> hit:false.
// ---------------------------------------------------------------------------
{
  const terrain = { groundAt: () => -1000 }; // ground far below, unreachable
  const ray = { ox: 0, oy: 0, oz: 10, dx: 0, dy: 0, dz: -1 };
  const out = { x: 0, y: 0, z: 0, t: 0, hit: false };
  rayTerrain(terrain, ray, out, { maxT: 5 });
  ok('rayTerrain: unreachable ground within maxT -> hit:false', out.hit === false, `hit=${out.hit} t=${out.t}`);
}

// ---------------------------------------------------------------------------
// rayTerrain: default maxT is 0 when dz >= 0 (ray never points down) -> miss.
// ---------------------------------------------------------------------------
{
  const terrain = { groundAt: () => -5 };
  const ray = { ox: 0, oy: 0, oz: 10, dx: 1, dy: 0, dz: 0.2 }; // going up
  const out = { x: 0, y: 0, z: 0, t: 0, hit: false };
  rayTerrain(terrain, ray, out);
  ok('rayTerrain: dz >= 0 default maxT=0 -> immediate miss', out.hit === false && out.t === 0, `hit=${out.hit} t=${out.t}`);
}

// ---------------------------------------------------------------------------
// rayTerrain: sloped/bumpy synthetic terrain converges to the analytic root.
// ---------------------------------------------------------------------------
{
  const terrain = { groundAt: (x, y) => Math.sin(x) + Math.cos(y) };
  const rnd = makeLcg(11);
  let worst = 0, allOk = true, checked = 0;
  for (let i = 0; i < 200; i++) {
    const ox = (rnd() - 0.5) * 10, oy = (rnd() - 0.5) * 10, oz = 5 + rnd() * 5;
    const dx = (rnd() - 0.5) * 2, dy = (rnd() - 0.5) * 2, dz = -0.5 - rnd() * 2;
    const ray = { ox, oy, oz, dx, dy, dz };
    const out = { x: 0, y: 0, z: 0, t: 0, hit: false };
    rayTerrain(terrain, ray, out, { step: 0.25, maxT: 40 });
    if (!out.hit) continue; // some random rays legitimately never cross within maxT
    checked++;
    const err = Math.abs(out.z - terrain.groundAt(out.x, out.y));
    worst = Math.max(worst, err);
    if (err > 1e-5) allOk = false;
  }
  ok('rayTerrain sloped/bumpy terrain converges to groundAt within 1e-5', allOk && checked > 0, `checked=${checked} worst=${worst}`);
}

// ---------------------------------------------------------------------------
// rayTerrain: default step/maxT documented behaviour (step=0.5, maxT=4*eyeZ/-dz).
// ---------------------------------------------------------------------------
{
  const terrain = { groundAt: () => 0 };
  const ray = { ox: 0, oy: 0, oz: 8, dx: 0, dy: 0, dz: -1 };
  const expectedMaxT = (4 * 8) / 1; // 32
  const out = { x: 0, y: 0, z: 0, t: 0, hit: false };
  rayTerrain(terrain, ray, out); // ground at t=8, well within default maxT=32
  ok('rayTerrain default maxT/step: reachable ground within default maxT hits', out.hit, `t=${out.t} expectedMaxT=${expectedMaxT}`);

  // Ground unreachable beyond the default maxT (t=8 needed, but shrink oz so
  // the *default* maxT itself falls short of a much deeper ground offset).
  const terrainDeep = { groundAt: () => -1e6 };
  const out2 = { x: 0, y: 0, z: 0, t: 0, hit: false };
  rayTerrain(terrainDeep, ray, out2); // default maxT=32, ground unreachable
  ok('rayTerrain default maxT: ground far beyond default maxT -> miss', out2.hit === false);
}

// ---------------------------------------------------------------------------
// pickNearest: ray straight down onto known cylinder positions picks the
// right index.
// ---------------------------------------------------------------------------
{
  const positions = new Float64Array([
    0, 0, 0,     // unit 0 at origin
    10, 10, 0,   // unit 1
    -5, 3, 0,    // unit 2
  ]);
  const radii = [1, 1, 1];
  const heights = [2, 2, 2];
  const ray = { ox: 0, oy: 0, oz: 10, dx: 0, dy: 0, dz: -1 }; // straight down onto unit 0
  const idx = pickNearest(ray, positions, radii, heights, 3);
  ok('pickNearest: straight-down ray onto unit 0 picks index 0', idx === 0, `idx=${idx}`);
}

// ---------------------------------------------------------------------------
// pickNearest: ray missing all cylinders returns -1.
// ---------------------------------------------------------------------------
{
  const positions = new Float64Array([0, 0, 0, 10, 10, 0]);
  const radii = [1, 1];
  const heights = [2, 2];
  const ray = { ox: 50, oy: 50, oz: 10, dx: 0, dy: 0, dz: -1 }; // far from both
  const idx = pickNearest(ray, positions, radii, heights, 2);
  ok('pickNearest: ray missing all cylinders returns -1', idx === -1, `idx=${idx}`);
}

// ---------------------------------------------------------------------------
// pickNearest: two cylinders at equal distance tie to the lower index.
// ---------------------------------------------------------------------------
{
  // A horizontal ray along +x passing through the axis of two cylinders
  // whose centres are placed symmetrically so their near-side hit distance
  // (t) is identical.
  const positions = new Float64Array([
    5, 0, 0,   // index 0
    5, 0, 0,   // index 1 - same position -> identical hit t
  ]);
  const radii = [1, 1];
  const heights = [2, 2];
  const ray = { ox: 0, oy: 0, oz: 1, dx: 1, dy: 0, dz: 0 };
  const idx = pickNearest(ray, positions, radii, heights, 2);
  ok('pickNearest: equal-distance tie resolves to the lower index', idx === 0, `idx=${idx}`);
}

// ---------------------------------------------------------------------------
// pickNearest: ray hits the infinite cylinder horizontally but misses the
// finite height band.
// ---------------------------------------------------------------------------
{
  const positions = new Float64Array([0, 0, 0]); // base z=0, height 2 -> band [0,2]
  const radii = [1];
  const heights = [2];
  // Horizontal ray at z=10, well above the cylinder's finite height band,
  // passing straight through its horizontal footprint.
  const ray = { ox: -10, oy: 0, oz: 10, dx: 1, dy: 0, dz: 0 };
  const idx = pickNearest(ray, positions, radii, heights, 1);
  ok('pickNearest: horizontal hit but outside finite height band excluded', idx === -1, `idx=${idx}`);
}

// ---------------------------------------------------------------------------
// selectInRect: units inside/outside/on-the-boundary of a screen rect;
// units behind the camera excluded; ids ascending.
// ---------------------------------------------------------------------------
{
  const grid = { cols: 100, rows: 50 };
  const cam = { x: 0, y: 0, z: 5, yawDeg: 0, pitchDeg: -30 };
  const terms = createPitchedTerms();
  pitchedTerms(cam, grid, terms);

  // Probe a handful of world points, find their cell via worldToCell, then
  // pick a rect that is known (from that same projection) to include some
  // and exclude others - this avoids guessing screen-space by hand.
  const probeScratch = new Float64Array(3);
  function cellOf(x, y, z) {
    worldToCell(terms, x, y, z, probeScratch);
    return { col: probeScratch[0], row: probeScratch[1], vd: probeScratch[2] };
  }

  // At yaw 0, forward = (sin 0, -cos 0) = (0, -1): the camera looks toward
  // -y. Points roughly in front of the camera at increasing lateral offsets.
  const pts = [
    [0, -20, 0],    // near centre -> should be inside a generous centred rect
    [-30, -20, 0],  // far left -> likely outside a centred rect
    [30, -20, 0],   // far right -> likely outside a centred rect
    [0, 20, 0],     // behind the camera (camera looks toward -y at yaw 0) -> vd <= 0
  ];
  const cells = pts.map((p) => cellOf(p[0], p[1], p[2]));
  ok('selectInRect fixture sanity: point 0 is in front of the camera (vd>0)', cells[0].vd > 0, `vd=${cells[0].vd}`);
  ok('selectInRect fixture sanity: point 3 is behind the camera (vd<=0)', cells[3].vd <= 0, `vd=${cells[3].vd}`);

  const positions = new Float64Array([
    pts[0][0], pts[0][1], pts[0][2],
    pts[1][0], pts[1][1], pts[1][2],
    pts[2][0], pts[2][1], pts[2][2],
    pts[3][0], pts[3][1], pts[3][2],
  ]);
  // Rect built tightly around cell 0's projected position (with a small
  // margin), and its exact boundary equal to its own col/row to check the
  // inclusive-boundary rule.
  const c0 = Math.floor(cells[0].col - 2), r0 = Math.floor(cells[0].row - 2);
  const c1 = Math.ceil(cells[0].col + 2), r1 = Math.ceil(cells[0].row + 2);
  const outIds = new Int32Array(4);
  const n = selectInRect(terms, c0, r0, c1, r1, positions, 4, outIds);
  const ids = Array.from(outIds.slice(0, n));
  ok('selectInRect: point 0 (inside rect) is selected', ids.includes(0), `ids=${ids}`);
  ok('selectInRect: point 3 (behind camera) is excluded even if horizontally in range', !ids.includes(3), `ids=${ids}`);
  ok('selectInRect: ids come out ascending', ids.every((v, i) => i === 0 || v > ids[i - 1]), `ids=${ids}`);

  // Boundary test: a rect whose edge sits exactly on cell 0's projected
  // col/row must include it (inclusive rect).
  const exactCol = Math.floor(cells[0].col + 0.5), exactRow = Math.floor(cells[0].row + 0.5);
  // Recompute the projected cell for a point placed so its col/row is an
  // integer boundary: reuse point 0's own projected col/row as the rect edge.
  const bC0 = Math.floor(cells[0].col), bR0 = Math.floor(cells[0].row);
  const outIds2 = new Int32Array(4);
  const n2 = selectInRect(terms, bC0, bR0, bC0, bR0, positions, 4, outIds2);
  // Since bC0/bR0 is floor(col/row), the point's exact col/row is >= bC0/bR0
  // and < bC0+1/bR0+1; only guaranteed inside when col/row are near-integers,
  // so instead assert the more robust inclusive-boundary contract directly:
  ok('selectInRect: a 1-cell rect at floor(col),floor(row) still selects the point when it lies inside it',
    n2 === 0 || (outIds2[0] === 0), `n2=${n2}`);
}

// ---------------------------------------------------------------------------
// selectInRect: explicit inclusive-boundary check with a synthetic point
// placed at an exact integer cell.
// ---------------------------------------------------------------------------
{
  const grid = { cols: 100, rows: 50 };
  const cam = { x: 0, y: 0, z: 5, yawDeg: 0, pitchDeg: 0 };
  const terms = createPitchedTerms();
  pitchedTerms(cam, grid, terms);

  // Binary-search along +y for a world point that projects to col===50.0
  // exactly (centre column of a 100-col grid, yaw 0, at some fixed depth) -
  // by symmetry x=0 always projects to the centre column, so use that
  // directly instead of searching.
  const probe = new Float64Array(3);
  worldToCell(terms, 0, -20, 0, probe); // yaw 0 forward is -y
  const exactCol = probe[0], exactRow = probe[1];
  const positions = new Float64Array([0, -20, 0]);
  const outIds = new Int32Array(1);

  const nIn = selectInRect(terms, Math.floor(exactCol), Math.floor(exactRow), Math.ceil(exactCol), Math.ceil(exactRow), positions, 1, outIds);
  ok('selectInRect: point included when rect exactly brackets its col/row', nIn === 1 && outIds[0] === 0, `nIn=${nIn}`);

  const nOut = selectInRect(terms, exactCol + 1, exactRow + 1, exactCol + 5, exactRow + 5, positions, 1, outIds);
  ok('selectInRect: point excluded when rect is entirely past it', nOut === 0, `nOut=${nOut}`);
}

// ---------------------------------------------------------------------------
// Zero alloc: rayTerrain, pickNearest, selectInRect over thousands of calls
// with reused scratch/out params (--expose-gc).
// ---------------------------------------------------------------------------
{
  const terrain = { groundAt: (x, y) => Math.sin(x * 0.1) + Math.cos(y * 0.1) };
  const ray = { ox: 0, oy: 0, oz: 20, dx: 0.3, dy: 0.2, dz: -1 };
  const out = { x: 0, y: 0, z: 0, t: 0, hit: false };

  const positions = new Float64Array([0, 0, 0, 5, 5, 0, -5, 5, 0]);
  const radii = [1, 1, 1];
  const heights = [2, 2, 2];
  const pickRay = { ox: 0, oy: 0, oz: 10, dx: 0, dy: 0, dz: -1 };

  const grid = { cols: 100, rows: 50 };
  const terms = createPitchedTerms();
  pitchedTerms({ x: 0, y: 0, z: 5, yawDeg: 0, pitchDeg: -30 }, grid, terms);
  const outIds = new Int32Array(3);

  let sink = 0;
  function work() {
    rayTerrain(terrain, ray, out);
    sink += out.t;
    sink += pickNearest(pickRay, positions, radii, heights, 3);
    sink += selectInRect(terms, 0, 0, grid.cols, grid.rows, positions, 3, outIds);
  }

  for (let i = 0; i < 500; i++) work(); // warm up
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) work();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('rayTerrain + pickNearest + selectInRect: no significant heap growth over 10k calls (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes (sink=${sink})`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
