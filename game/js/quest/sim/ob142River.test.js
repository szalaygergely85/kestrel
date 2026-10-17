// OB-142: "going down to the river, no animals or boars". The generated regional beasts must put live (non-croc) land beasts
// within 60 m of the ford (1010,1060) and of the river road south of the tower. Run: node game/js/quest/sim/ob142River.test.js
import assert from 'node:assert/strict';
import { World } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import geoMod from '../../../../design/levels/world_geo.js';
import '../../../../design/models/lantern.js'; import '../../../../design/models/lever.js'; import '../../../../design/models/boulder.js';
import '../../../../design/models/rubble.js'; import '../../../../design/models/wreckage.js'; import '../../../../design/models/relay.js';
import '../../../../design/models/sword.js'; import '../../../../design/models/m3_props.js'; import '../../../../design/models/far_tower.js';
import '../../../../design/models/ferrum_lights.js'; import '../../../../design/models/voxel_beast.js'; import '../../../../design/models/voxel_bear.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { safeSpots, generateRegionalBeasts } from './regionalBeasts.js';

paletteMod; detailPassMod; terrainMod;
const G = globalThis.ASSETS.levels.world_geo; geoMod;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'grid' });
const avoid = []; w.forEachEntity((e) => { const b = e.components?.brain; if (b?.kind === 'beast') avoid.push([...b.home]); });
const list = generateRegionalBeasts({ geo: G, terrain: w.terrain, seed: 12, avoid, safe: safeSpots(w) });
const land = list.filter((b) => !/^croc/.test(b.id));
const near = (x, y, r) => land.filter((b) => { const h = [b.x, b.y]; return Math.hypot(h[0] - x, h[1] - y) <= r; });
const bd = land.map((b) => [b.id, b.x, b.y, Math.round(Math.hypot(b.x - 1010, b.y - 1060))]).sort((a, b) => a[3] - b[3]).slice(0, 8); console.log(bd.map((r) => r.join(' ')).join(String.fromCharCode(10)));
for (const [n, x, y, r, min] of [['ford', 1010, 1060, 60, 1], ['ford wide', 1010, 1060, 150, 3], ['river road mid', 1190, 1100, 60, 1]]) {
  const b = near(x, y, r); console.log(n, b.length, b.map((q) => q.id).join(' '));
  assert.ok(b.length >= min, n + ': expected >= ' + min + ' land beasts within ' + r + ' m of (' + x + ',' + y + '), got ' + b.length);
}
console.log('ob142River OK');
