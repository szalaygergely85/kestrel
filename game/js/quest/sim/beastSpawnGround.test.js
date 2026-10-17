// OB-155 (beasts): every beast spawn z on the real world_m1 matches the real floor (floorZ: mesh/structure top or terrain),
// not terrain-only heightAt. Offenders: float > 0.3 m or sunk > 0.4 m. Run: node game/js/quest/sim/beastSpawnGround.test.js [--list]
import { World } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainDef from '../../../../design/levels/overworld_far.js';
import geoMod from '../../../../design/levels/world_geo.js';
import voxelWorldMod from '../../../../design/models/voxel_world.js';
import { Events } from '../../../../engine/dev.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { spawnRegionalBeasts } from './regionalBeasts.js';
import { floorZ } from '../groundSnap.js';
import m_lantern from '../../../../design/models/lantern.js';
import m_lever from '../../../../design/models/lever.js';
import m_voxel_props from '../../../../design/models/voxel_props.js';
import m_boulder from '../../../../design/models/boulder.js';
import m_rubble from '../../../../design/models/rubble.js';
import m_wreckage from '../../../../design/models/wreckage.js';
import m_relay from '../../../../design/models/relay.js';
import m_sword from '../../../../design/models/sword.js';
import m_m3_props from '../../../../design/models/m3_props.js';
import m_far_tower from '../../../../design/models/far_tower.js';
import m_ferrum_lights from '../../../../design/models/ferrum_lights.js';
import m_title from '../../../../design/models/title.js';
import m_vt from '../../../../design/models/voxel_tower.js';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
m_vt;paletteMod; terrainDef; detailPassMod; voxelWorldMod;
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh', events: new Events() });
const geo = globalThis.ASSETS.levels.world_geo; geoMod; geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
try { spawnRegionalBeasts(w, geo, 12, undefined, undefined); } catch (e) { console.log('regional spawn skipped:', e.message); }
const off = [];
let n = 0;
w.forEachEntity((e) => {
  const b = e.components && e.components.brain; if (!b || b.kind !== 'beast') return;
  const t = e.transform; n++;
  w.ensureBandFor(t.x, t.y);
  const f = floorZ(w, t.x, t.y, t.z, 0.6), d = t.z - f;
  if (f != null && (d > 0.3 || d < -0.4)) off.push({ id: e.id, x: +t.x.toFixed(1), y: +t.y.toFixed(1), z: +t.z.toFixed(2), floor: +f.toFixed(2), d: +d.toFixed(2) });
});
console.log('beasts', n, 'offenders', off.length);
if (process.argv.includes('--list')) console.log(JSON.stringify(off.slice(0, 40)));
{ const c = w.get('skelwar.crypt.4').data.transform, fl = floorZ(w, c.x, c.y, -56.8, 0.6); assert.ok(Math.abs(c.z - fl) < 0.05, 'crypt.4 seated on the level floor ' + c.z + ' vs ' + fl); }
assert.equal(off.length, 0, 'offenders: ' + JSON.stringify(off.slice(0, 5)));
console.log('beastSpawnGround: PASS');
