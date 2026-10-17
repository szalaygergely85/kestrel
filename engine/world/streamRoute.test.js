// STREAM-01c (Node part): route-walk trace tower -> ford -> Outwall on world_m1 (docs/architecture.md 38.51).
// At every 2 m step every placement whose projected size >= 1 cell at 480 columns must be in grid.activeList and pass its own
// reach compare (the draw rule the 01b feeds use). Records the resident (active + warm) placement / distinct-mesh counts per leg.
import { PlacementGrid, isLandmark } from './placementGrid.js';
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.error('FAIL: ' + m); } };
const { loadTestAssets } = await import('../../tools/testing/content-node.mjs');
for (const m of ['palette', 'detail-pass']) await import(`../../design/${m}.js`);
for (const m of ['lantern', 'lever', 'voxel_props', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_world']) await import(`../../design/models/${m}.js`);
await import('../../design/levels/overworld_far.js');
globalThis.window = globalThis.window || globalThis;
const { World } = await import('./World.js');
const { PROJ_HFOV_DEG } = await import('../render/projection.js');
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
ok(w.placementGrid instanceof PlacementGrid, 'grid built');
const COLS = 480, CELL_RAD = (PROJ_HFOV_DEG * Math.PI / 180) / COLS;
// poses from tools/route-walk.mjs: tower origin, road/ford (leg 9), Outwall gate/plaza/goose farm (leg 10o)
const LEGS = [
  ['tower', [[1480, 1018], [1420, 1032], [1350, 1050], [1270, 1042]]],
  ['ford', [[1180, 1062], [1090, 1070], [1046, 1069], [1010, 1069], [998, 1075]]],
  ['outwall', [[1010, 1066], [1010.5, 1049], [1013.5, 1035], [988, 1038], [978, 1010], [966, 985], [956, 962], [954, 940], [944, 925.3], [920, 927], [905, 927], [905, 948], [905, 927], [946, 925.5], [952, 915], [930, 912], [890, 912], [865, 925], [852, 955], [855, 978], [874, 990]]],
];
const st = w.structures;
const meshOf = (i) => st[i].mesh;
// Needed reachPerM: size 2r seen at d spans >= 1 cell when d <= r * 2/CELL_RAD (~733 at 480 cols, HFOV 75); the 38.51 default 400 is short of that.
const NEED = 2 / CELL_RAD;
function run(g, label) {
let steps = 0, worst = 0;
for (const [name, pts] of LEGS) {
  let peakRes = 0, peakMesh = 0, minRes = 1e9; const tally = (arr, n, set) => { for (let k = 0; k < n; k++) set.add(meshOf(arr[k])); };
  const walk = (x, y) => {
    g.update(x, y); let guard = 0; while (g.pending && guard++ < 200) g.update(x + 1e-3 * guard, y); // drain the capped queue
    steps++;
    const inAct = new Uint8Array(st.length); for (let k = 0; k < g.activeCount; k++) inAct[g.activeList[k]] = 1;
    for (let i = 0; i < st.length; i++) {
      if (g.cellOf[i] < 0) continue;
      const b = st[i].bbox;
      const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0, dy = y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0;
      const d = Math.hypot(dx, dy), size = 2 * Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0) * 0.5;
      const cut = g.opts.cutM > 0 && d > g.opts.cutM && !isLandmark(st[i], g.opts.keepFar); // OB-089: beyond cutM non-landmarks are intentionally inactive
      if (!cut && size / Math.max(d, 0.5) >= CELL_RAD) {
        const vis = inAct[i] === 1 && d * d <= g.reach2[i] + 1;
        if (!vis) { worst++; if (worst <= 8) if (label.startsWith('reachPerM')) console.error(`  miss ${name} (${x.toFixed(0)},${y.toFixed(0)}) ${st[i].id} d ${d.toFixed(0)} size ${size.toFixed(1)} reach ${Math.sqrt(g.reach2[i]).toFixed(0)} active ${inAct[i]}`); }
      }
    }
    const meshes = new Set(); tally(g.activeList, g.activeCount, meshes); tally(g.warmList, g.warmCount, meshes);
    const res = g.activeCount + g.warmCount; peakRes = Math.max(peakRes, res); minRes = Math.min(minRes, res); peakMesh = Math.max(peakMesh, meshes.size);
  };
  for (let p = 0; p + 1 < pts.length; p++) {
    const [ax, ay] = pts[p], [bx, by] = pts[p + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 2));
    for (let s = 0; s <= n; s++) walk(ax + (bx - ax) * s / n, ay + (by - ay) * s / n);
  }
  console.log(`STREAM-01c [${label}] leg ${name}: resident placements ${minRes}..${peakRes} of ${g.memberCount}, distinct meshes (peak) ${peakMesh}, standing-still end: active ${g.activeCount} warm ${g.warmCount}`);
}
return { worst, steps };
}
const def = run(w.placementGrid, 'default reachPerM ' + w.placementGrid.opts.reachPerM);
console.log(`STREAM-01c default grid: ${def.worst} (step, placement) misses of >= 1 cell placements over ${def.steps} steps; reachPerM needed ~${NEED.toFixed(0)}`);
const fit = run(new PlacementGrid(st, { reachPerM: Math.ceil(NEED) }), 'reachPerM ' + Math.ceil(NEED));
ok(def.worst === 0, `${def.worst} misses with the DEFAULT grid (reachPerM ${w.placementGrid.opts.reachPerM})`);
ok(fit.worst === 0, `${fit.worst} visible placements (>= 1 cell @ ${COLS} cols, HFOV ${PROJ_HFOV_DEG}) missing over ${fit.steps} steps with reachPerM ${Math.ceil(NEED)}`);
console.log(`streamRoute: ${checks - fails}/${checks} checks${fails ? ' FAILED' : ' ok'}`);
process.exit(fails ? 1 : 0);
