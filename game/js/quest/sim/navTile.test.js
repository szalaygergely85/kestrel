// game/js/quest/sim/navTile.test.js (WM-03 / arch 38.59): per-band nav tile == NavGrid.buildFromWorld on the same rect; swap = pointer flip; bytes counted; fixed-area worlds untouched.
// Lives in game/ (world + nav together); engine/world must not import engine/nav (rule 14), so the world gets its NavGrid through `setNavTiles({create})`.
// Run: node game/js/quest/sim/navTile.test.js
import { NavGrid, World } from '../../../../engine/index.js';
import { makeOk } from '../../../../engine/test/assert.js';
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

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod; farTowerMod; ferrumLightsMod;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const { assets } = await loadTestAssets();
const def0 = (() => { const d = JSON.parse(JSON.stringify(assets.world('world_m1'))); delete d.terrainBand; delete d.terrainBands; return d; })();
const GRID = { cx0: 0, cy0: 0, cx1: 32, cy1: 32, cw: 5, ch: 3, stepX: 2, stepY: 1, ox: 0, oy: 0 };
const CFG = { maxSlopeDeg: 30, blockedTypes: ['water'], maxStepM: Infinity, create: (x0, y0, w, h, cell) => new NavGrid({ x0, y0, w, h, cell }) };

// fixed-area world: no tiles unless asked, nav stays null
const fixed = World.load({ ...def0 }, assets, { detail: true });
ok('fixed-area world: no nav tile', fixed.nav === null && fixed.navTiles === null);

// --- spawn next to a structure so the keep is inside the band
const probe = World.load({ ...def0, terrainGrid: GRID }, assets, { detail: true });
const st0 = (probe.structures || []).find((s) => s.bbox) || null;
const sp = st0 ? { x: (st0.bbox.x0 + st0.bbox.x1) / 2, y: (st0.bbox.y0 + st0.bbox.y1) / 2 } : { x: 1344, y: 22 * 128 + 64 };
const w = World.load({ ...def0, terrainGrid: GRID }, assets, { detail: true, spawn: sp });
w.setNavTiles(CFG);
ok('live band tile built, same rect + 2 m cell', w.nav && w.nav.x0 === w.terrain.near.x0 && w.nav.y0 === w.terrain.near.y0 && w.nav.w === w.terrain.near.w && w.nav.h === w.terrain.near.h && w.nav.cell === 2);

function compare(world) {
  const t = world.nav, ref = new NavGrid({ x0: t.x0, y0: t.y0, w: t.w, h: t.h, cell: t.cell });
  ref.buildFromWorld(world, { maxSlopeDeg: 30, blockedTypes: ['water'] });
  let same = 0, sSame = 0, sN = 0, walk = 0;
  for (let cy = 0; cy < t.h; cy++) for (let cx = 0; cx < t.w; cx++) {
    const i = cy * t.w + cx, a = t.terrainCost[i] > 0, b = ref.terrainCost[i] > 0;
    if (a === b) same++; if (a) walk++;
    if (world.structureAt(t.cellCenterX(cx), t.cellCenterY(cy))) { sN++; if (a === b) sSame++; }
  }
  return { pct: same / (t.w * t.h) * 100, sN, sSame, walk: walk / (t.w * t.h) };
}
const c0 = compare(w);
console.log(`  live tile ${w.nav.w}x${w.nav.h}: match ${c0.pct.toFixed(2)} %, walkable ${(c0.walk * 100).toFixed(1)} %, structure cells ${c0.sSame}/${c0.sN}`);
ok('tile walkability == buildFromWorld for >= 99.5 % of cells', c0.pct >= 99.5, c0.pct.toFixed(3));
ok('structure (keep) cells 100 % identical', c0.sSame === c0.sN, `${c0.sSame}/${c0.sN}`);

// --- walk north: baked-ahead bundles carry the tile; swap flips w.nav
const ev = []; w.events = { emit: (n, e) => ev.push([n, e && e.nav]) };
let x = sp.x, y = sp.y, swaps = 0;
for (let n = 0; n < 600; n++) w.streamBand(x, y, 2);
const first = w.nav;
let frames = 0;
while (swaps < 2 && frames < 20000) { y -= 6 / 60; if (w.streamBand(x, y, 2) === 2) swaps++; frames++; }
ok('swapped twice', swaps === 2, String(swaps));
ok('world.nav replaced on swap, matches the new band rect', w.nav !== first && w.nav.x0 === w.terrain.near.x0 && w.nav.y0 === w.terrain.near.y0);
ok('world:band carried the new tile', ev.some((e) => e[0] === 'world:band' && e[1] === w.nav));
ok('cached bundle carries its tile, counted in bytes', (() => { const b = w.bandCache.get(w._bandKey(w._bandCur)); return b && b.nav === w.nav && b.bytes >= b.near.height.byteLength + w.nav.cost.byteLength * 3; })());
const c1 = compare(w);
console.log(`  after swaps: match ${c1.pct.toFixed(2)} %; misses ${w.bandMisses}`);
ok('swapped tile still >= 99.5 %', c1.pct >= 99.5, c1.pct.toFixed(3));
// swap = pointer flip (code path: `_publishBand` assigns `world.nav`; only a legacy bundle without a tile builds one)
ok('0 misses: every swap was a cache hit', w.bandMisses === 0);
console.log(`navTile: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
