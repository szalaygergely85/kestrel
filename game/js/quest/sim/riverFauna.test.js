// OB-142: New Game, player at the Ford relay (river crossing on the main road): >= 3 beasts (boar/wolf/bear) have homes within 120 m. Run: node game/js/quest/sim/riverFauna.test.js
import { World, createRng } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import geoMod from '../../../../design/levels/world_geo.js';
import '../../../../design/models/lantern.js'; import '../../../../design/models/lever.js'; import '../../../../design/models/boulder.js';
import '../../../../design/models/rubble.js'; import '../../../../design/models/wreckage.js'; import '../../../../design/models/relay.js';
import '../../../../design/models/sword.js'; import '../../../../design/models/m3_props.js'; import '../../../../design/models/far_tower.js';
import '../../../../design/models/ferrum_lights.js'; import '../../../../design/models/voxel_beast.js'; import '../../../../design/models/voxel_bear.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { buildBeastNav } from './beastNav.js';
import { createBand } from './band.js';
import { createBeastSim, MAX_BEASTS, STATE_CORPSE } from './beastSim.js';
import { safeSpots, REGION_RULES, REGIONAL_BEAST_COUNT, generateRegionalBeasts, spawnRegionalBeasts, makeWalkable, inPolygon } from './regionalBeasts.js';

paletteMod; detailPassMod; terrainMod;
const G = globalThis.ASSETS.levels.world_geo; geoMod;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
const def = assets.world('world_m1');
const mkWorld = () => World.load(def, assets, { physics: 'grid' });
const quiet = (f) => { const w = console.warn; console.warn = () => {}; try { return f(); } finally { console.warn = w; } };
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d || ''); } };
const w = World.load(def, assets, { physics: 'grid' });
quiet(() => spawnRegionalBeasts(w, G, 12));
const FX = 992, FY = 1079; // relayFordBase origin (world_m1.world.json)
const homes = []; w.forEachEntity((e) => { const b = e.components && e.components.brain; if (b && b.kind === 'beast' && /^(boar|wolf|bear|blackBear|deer)/i.test(String(e.id))) { const h = b.home || [e.transform.x, e.transform.y]; homes.push(Math.hypot(h[0] - FX, h[1] - FY)); } });
const n80 = homes.filter((d) => d <= 80).length, n120 = homes.filter((d) => d <= 120).length, n150 = homes.filter((d) => d <= 150).length;
console.log('ford beasts within 80/120/150 m:', n80, n120, n150);
ok('OB-142: >= 3 beasts within 120 m of the Ford', n120 >= 3, 'n120=' + n120);
// OB-142 river-road groups: every 50 m segment of the road x1280 -> x1085 has >= 2 beast homes within 80 m of its midpoint (road y ~ 1045 -> 1070).
const roadY = (x) => 1045 + (1260 - x) * (x > 1180 ? 15 / 80 : 0) + (x <= 1180 ? 17 + (1180 - x) * 8 / 90 : 0);
for (let x0 = 1280; x0 > 1085; x0 -= 50) {
  const mx = x0 - 25, my = roadY(mx); let n = 0;
  w.forEachEntity((e) => { const b = e.components && e.components.brain; if (b && b.kind === 'beast' && /^(boar|wolf|bear|deer)/i.test(String(e.id))) { const h = b.home || [e.transform.x, e.transform.y]; if (Math.hypot(h[0] - mx, h[1] - my) <= 80) n++; } });
  ok('OB-142: >= 2 beasts within 80 m of road segment x' + x0 + '..' + (x0 - 50), n >= 2, 'n=' + n);
}
console.log(fail ? 'FAILED' : 'ok', pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
