// STREAM-01a: PlacementGrid rings, hysteresis, cap, determinism, zero alloc, world_m1 numbers (docs/architecture.md 38.51).
// Run: node engine/world/placementGrid.test.js   (alloc probe re-runs itself in a fresh --expose-gc child)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PlacementGrid } from './placementGrid.js';

const self = fileURLToPath(import.meta.url);
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };

// Synthetic world: 40 x 40 props, 20 m pitch, 2 m boxes (reach = 160 min). Some big ones.
function synth() {
  const s = [];
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
    const big = (i * 7 + j * 3) % 97 === 0, h = big ? 15 : 1;
    const x = i * 20, y = j * 20;
    s.push({ kind: 'mesh', bbox: { x0: x - h, y0: y - h, z0: 0, x1: x + h, y1: y + h, z1: h * 2 } });
  }
  s.splice(5, 0, { kind: 'grid' }); // a non-member in the middle: indices stay structure indices
  return s;
}
const snap = (g) => [Array.from(g.activeList.subarray(0, g.activeCount)).join(','), Array.from(g.warmList.subarray(0, g.warmCount)).join(',')].join('|');

if (process.argv.includes('--alloc')) {
  const g = new PlacementGrid(synth());
  g.update(400, 400);
  for (let k = 0; k < 200; k++) g.update(400 + k * 4, 400 + (k % 7) * 9);
  { let x = 100; for (let k = 0; k < 20000; k++) { x += 5.5 * (k % 200 < 100 ? 1 : -1); g.update(x, 300 + (k % 13)); } } // warm-up JIT on the measured loop (200 was too short: ~25 KB of JIT noise)
  globalThis.gc(); globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  let x = 100;
  for (let k = 0; k < 20000; k++) { x += 5.5 * (k % 200 < 100 ? 1 : -1); g.update(x, 300 + (k % 13)); }
  globalThis.gc();
  const d = process.memoryUsage().heapUsed - before;
  console.log(`alloc delta ${d} B over 20000 updates`);
  process.exit(d < 20000 ? 0 : 1);
}

const W = synth(), N = W.length;
{ // AC5-lite + membership
  const g = new PlacementGrid(W);
  ok(g.memberCount === N - 1 && g.cellOf[5] === -1, 'non-mesh is not a member');
  g.update(0, 0);
  ok(g.activeCount > 0 && g.activeCount < N - 1, `near corner: some but not all active (${g.activeCount}/${N - 1})`);
  let asc = true; for (let i = 1; i < g.activeCount; i++) if (g.activeList[i] <= g.activeList[i - 1]) asc = false;
  ok(asc && !g.activeList.subarray(0, g.activeCount).includes(5), 'activeList ascending, structure indices');
  const far = new PlacementGrid(W, { minM: 1e6, farM: 1e6 });
  far.update(0, 0); ok(far.activeCount === N - 1, 'huge reach = everything active');
}
{ // AC1 hysteresis: +-3 m across a border 200 times -> no transitions beyond the first classify
  const g = new PlacementGrid(W);
  g.update(-500, 400);
  // find the x where the first cell enters active along +x (eye at y 400), then oscillate around it
  let bx = -500; while (g.activeCount === 0 && bx < 2000) { bx += 1; g.update(bx, 400); }
  ok(g.activeCount > 0, 'found an entry border');
  for (let i = 0; i < 40; i++) g.update(bx, 400); // drain any queue
  const t0 = g.transitions;
  for (let i = 0; i < 200; i++) { g.update(bx - 3, 400); g.update(bx + 3, 400); }
  ok(g.transitions === t0, `no extra transitions (${g.transitions - t0})`);
}
{ // AC2 cap + drain + ring invariants
  const g = new PlacementGrid(W, { maxCellsPerFrame: 3 });
  g.update(0, 0);                           // first classify is uncapped
  let t = g.transitions;
  g.update(700, 700);                       // big jump: capped
  ok(g.transitions - t <= 3, `<= cap per update (${g.transitions - t})`);
  for (let k = 0; k < 100; k++) { t = g.transitions; g.update(700, 700); ok(g.transitions - t <= 3, 'cap'); }
  let valid = true;
  const o = g.opts;
  for (let c = 0; c < g.cellCount; c++) {
    const d = g._dist(c, 700, 700), r = g.cellReach[c], s = g.state[c];
    if (s === 2 && d > r + 2 * o.hystM) valid = false;
    if (s !== 2 && d <= r + o.hystM) valid = false;
    if (s === 0 && d <= r + o.warmM) valid = false;
  }
  ok(valid, 'drained state obeys the ring rules');
  const f = new PlacementGrid(W, { maxCellsPerFrame: 3 }); f.update(700, 700); // fresh classify (first = uncapped)
  // equal to a fresh classify for every cell outside the two hysteresis bands (inside them the state is history-dependent by design)
  let same = true, cmp = 0;
  for (let c = 0; c < g.cellCount; c++) {
    const d = g._dist(c, 700, 700), r = g.cellReach[c];
    const inBand = (d > r + o.hystM && d <= r + 2 * o.hystM) || (d > r + o.warmM && d <= r + o.warmM + o.hystM);
    if (inBand) continue;
    cmp++; if (g.state[c] !== f.state[c]) same = false;
  }
  ok(same && cmp > g.cellCount / 2, `drained set equals a fresh classify outside the hysteresis bands (${cmp}/${g.cellCount} compared)`);
}
{ // AC3 determinism
  const run = () => { const g = new PlacementGrid(W); const out = [];
    for (let k = 0; k < 300; k++) { g.update(k * 3, 200 + 150 * Math.sin(k / 20)); if (k % 25 === 0) out.push(snap(g)); }
    return out.join('#'); };
  ok(run() === run(), 'same trace, same lists');
}
{ // AC4 zero alloc (fresh gc child)
  const r = spawnSync(process.execPath, ['--expose-gc', self, '--alloc'], { encoding: 'utf8' });
  console.log(r.stdout.trim());
  ok(r.status === 0, 'update allocates nothing (gc probe)');
}
{ // AC5 world_m1 numbers
  const { loadTestAssets } = await import('../../tools/testing/content-node.mjs');
  const mods = ['palette', 'detail-pass'].map((m) => `../../design/${m}.js`);
  for (const m of mods) await import(m);
  for (const m of ['lantern', 'lever', 'voxel_props', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_world']) await import(`../../design/models/${m}.js`);
  await import('../../design/levels/overworld_far.js');
  globalThis.window = globalThis.window || globalThis;
  const { World } = await import('./World.js');
  const { assets } = await loadTestAssets();
  const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
  const g = w.placementGrid;
  ok(g instanceof PlacementGrid && w.refreshPlacementGrid() === g, 'world.placementGrid built at load');
  const n = g.memberCount;
  g.update(1480, 1018);
  // drawn = active cell AND own reach (the per-placement d2 <= reach2 compare the 01b feeds do): world_m1 is 1265 m wide and most
  // cells hold one big mesh (cellReach = farM 2000), so whole cells stay active; the per-placement test does the culling here.
  let drawn = 0;
  for (let k = 0; k < g.activeCount; k++) { const s = w.structures[g.activeList[k]].bbox;
    const dx = 1480 < s.x0 ? s.x0 - 1480 : 1480 > s.x1 ? 1480 - s.x1 : 0, dy = 1018 < s.y0 ? s.y0 - 1018 : 1018 > s.y1 ? 1018 - s.y1 : 0;
    if (dx * dx + dy * dy <= g.reach2[g.activeList[k]]) drawn++; }
  ok(drawn < n, `tower: drawn ${drawn} < N ${n} (active cells hold ${g.activeCount})`);
  const c = w.colliders.find((x) => x.id === 'meshes:static');
  let bytes = 0;
  const seen = new Set();
  const walk = (o, depth) => { if (!o || typeof o !== 'object' || seen.has(o) || depth > 3) return; seen.add(o);
    if (ArrayBuffer.isView(o)) { bytes += o.byteLength; return; }
    for (const k of Object.keys(o)) walk(o[k], depth + 1); };
  walk(c, 0);
  const t = g.transitions;
  g.update(1480 + 200, 1018);
  console.log(`STREAM-01a world_m1: structures ${w.structures.length}, mesh members ${n}, cells ${g.cellCount}, tower active ${g.activeCount}/${n} drawn ${drawn} warm ${g.warmCount}, grid ${g.bytes} B, meshes:static ${(bytes / 1048576).toFixed(2)} MB (${c ? 'found' : 'MISSING'}), +200m transitions ${g.transitions - t}`);
  ok(bytes <= 24 * 1048576, `meshes:static ${bytes} B <= 24 MB (else ESCALATE)`);
  // setMeshPlacement marks dirty -> refresh rebuilds
  const id = w.structures.find((s) => s.kind === 'mesh').id, s0 = w.structures.find((s) => s.id === id);
  w.setMeshPlacement(id, { x: s0.origin.x, y: s0.origin.y, z: s0.origin.z });
  ok(w.refreshPlacementGrid() !== g, 'dirty placement -> grid rebuilt');
}
console.log(`placementGrid: ${checks - fails}/${checks} checks${fails ? ' FAILED' : ' ok'}`);
process.exit(fails ? 1 : 0);
