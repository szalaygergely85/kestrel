// game/js/quest/sim/navFord.test.js (NAV-LINKS-01b, arch 38.71): shallow water (< 0.6 m) is walkable at the ford cost, deep water stays blocked; no option = byte-identical.
// Run: node game/js/quest/sim/navFord.test.js
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainDef from '../../../../design/levels/overworld_far.js';
import lanternMod from '../../../../design/models/lantern.js';
import leverMod from '../../../../design/models/lever.js';
import voxelPropsMod from '../../../../design/models/voxel_props.js';
import boulderMod from '../../../../design/models/boulder.js';
import rubbleMod from '../../../../design/models/rubble.js';
import wreckageMod from '../../../../design/models/wreckage.js';
import relayMod from '../../../../design/models/relay.js';
import swordMod from '../../../../design/models/sword.js';
import m3PropsMod from '../../../../design/models/m3_props.js';
import farTowerMod from '../../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { NavGrid, World, findPath, createAStar } from '../../../../engine/index.js';
import { makeOk } from '../../../../engine/test/assert.js';
import { buildBeastNav, createLayerBaker } from './beastNav.js';
globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod; farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();
const def0 = JSON.parse(JSON.stringify(assets.world('world_m1'))); delete def0.terrainBand; delete def0.terrainBands;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const w = World.load({ ...def0 }, assets, { detail: true, physics: 'mesh' });
const base = buildBeastNav(w, { ...def0.nav, layers: undefined, ford: undefined });
const base2 = buildBeastNav(w, { ...def0.nav, layers: undefined, ford: undefined });
ok('no ford option: build twice -> identical bytes', Buffer.compare(bytes(base.grid.terrainCost), bytes(base2.grid.terrainCost)) === 0);
const fnav = buildBeastNav(w, { ...def0.nav, layers: undefined, ford: { maxDepth: 0.6, cost: 4 } });
const g = fnav.grid, g0 = base.grid;
let fordCells = 0, onlyDiff = true;
for (let i = 0; i < g.w * g.h; i++) {
  if (g.terrainCost[i] !== g0.terrainCost[i]) { if (g0.terrainCost[i] === 0 && g.terrainCost[i] === 4) fordCells++; else onlyDiff = false; }
}
ok('ford build only opens water cells at cost 4', onlyDiff && fordCells > 0, `fordCells=${fordCells} onlyDiff=${onlyDiff}`);
// Route across the Ford (x 1010 -> 1042 at y 1062): through ford cells with the option; never through deep (>= 0.6 m) water.
const out = new Int32Array(g.w * g.h);
const route = (nav, sx, sy, gx, gy) => {
  const a = createAStar(nav.grid), n = findPath(a, nav.grid.cellX(sx), nav.grid.cellY(sy), nav.grid.cellX(gx), nav.grid.cellY(gy), out);
  return { n, partial: a.partial, cells: Array.from(out.subarray(0, n)) };
};
const wq = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: 0, look: 0 };
const r0 = route(base, 1010, 1062, 1042, 1062), r1 = route(fnav, 1010, 1062, 1042, 1062);
ok('without ford option the river blocks the direct route (partial)', r0.partial, `n=${r0.n} partial=${r0.partial}`);
const fordOnPath = r1.cells.filter((c) => g.terrainCost[c] === 4);
ok('ford route is complete and uses ford cells', !r1.partial && r1.n > 0 && fordOnPath.length > 0, `n=${r1.n} partial=${r1.partial} ford=${fordOnPath.length}`);
let maxD = 0;
for (const c of r1.cells) { const x = g.cellCenterX(c % g.w), y = g.cellCenterY((c / g.w) | 0); if (w.waterAt(x, y, wq) && g.terrainCost[c] === 4) maxD = Math.max(maxD, wq.depth); }
ok('every ford cell on the route is shallower than 0.6 m', maxD < 0.6, `maxDepth=${maxD.toFixed(2)}`);
// Deep water stays blocked: same build with maxDepth 0.1 (all of this ford is deeper) opens fewer cells and the route is partial again.
const dnav = buildBeastNav(w, { ...def0.nav, layers: undefined, ford: { maxDepth: 0.05 } });
const rd = route(dnav, 1010, 1062, 1042, 1062);
ok('deep water (over maxDepth) stays blocked: the route detours instead of wading', rd.partial || rd.n > 2 * r1.n, `deep n=${rd.n} partial=${rd.partial} ford n=${r1.n}`);
let deepMax = 0;
for (const c of rd.cells) if (dnav.grid.terrainCost[c] === 4) { w.waterAt(dnav.grid.cellCenterX(c % g.w), dnav.grid.cellCenterY((c / g.w) | 0), wq); deepMax = Math.max(deepMax, wq.depth); }
ok('deep route only wades cells shallower than its maxDepth', deepMax < 0.05, `deepMax=${deepMax}`);
const r1b = route(buildBeastNav(w, { ...def0.nav, layers: undefined, ford: { maxDepth: 0.6, cost: 4 } }), 1010, 1062, 1042, 1062);
ok('same route every run', JSON.stringify(r1.cells) === JSON.stringify(r1b.cells));
// D-103: world_m1 nav block now carries `ford` + the 7 flagged stones; the real config crosses the river at the ford, deep water stays blocked.
const real = buildBeastNav(w, def0.nav);
const rr1 = route(real, 1010, 1062, 1042, 1062);
ok('world_m1 nav (ford on): beast route crosses the river at the ford', def0.nav.ford && !rr1.partial && rr1.n > 0, `n=${rr1.n} partial=${rr1.partial}`);
const rr2 = route(real, 1010, 1062, 1042, 1062);
ok('world_m1 nav route deterministic', JSON.stringify(rr1.cells) === JSON.stringify(rr2.cells));
let deepWade = 0;
for (const c of rr1.cells) { const x = real.grid.cellCenterX(c % real.grid.w), y = real.grid.cellCenterY((c / real.grid.w) | 0); if (w.waterAt(x, y, wq) && wq.depth >= 0.6 && real.grid.terrainCost[c] !== 0) deepWade++; }
ok('world_m1 route never wades deep (>= 0.6 m) water', deepWade === 0, `deep=${deepWade}`);
console.log(`navFord: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join(String.fromCharCode(10))); process.exit(1); }
