// engine/world/serialize.fire.test.js (US-133, architecture.md 32.3 "Save"). Run: node engine/world/serialize.fire.test.js
// Optional `world.fire`: absent from the save when null; saved + restorable via grid.load when set.
// 28.3, "Save" / CO-5 extension). Headless Node ESM, no framework.
// Run: node engine/world/serialize.visibility.test.js
//
// Covers the optional `world.visibility` field added to `World`/`serialize`/
// `deserialize`: (a) present + round-tripped when the game sets it, (b)
// completely absent from the saved JSON (byte-identical to before this
// story) when it's left at its `null` default - the regression check that
// matters most, since almost every existing world/save has no `visibility`.
import { World } from './World.js';
import { createFireGrid } from './fireGrid.js';
import { serialize, deserialize, stringifySave } from './serialize.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef;
lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod;
farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

{
  const world = World.load(assets.world('world_m1'), assets, {});
  ok('world.fire defaults to null', world.fire === null);
  ok('no "fire" key when null', !('fire' in serialize(world)));
  const mk = () => { const g = createFireGrid({ materials: { grass: { fuelSec: 2, ignite: 0.4 } }, seed: 3 });
    g.addArea({ id: 'a', x0: 0, y0: 0, w: 10, h: 10, cell: 0.5, zMin: -5, zMax: 50 }, { surfaceAt: () => 'g', heightAt: () => 0 }, { g: 'grass' }); return g; };
  world.fire = mk();
  world.fire.ignite(1, 1, 0);
  for (let i = 0; i < 60; i++) world.fire.step();
  const state = JSON.parse(stringifySave(serialize(world)));
  ok('"fire" key saved', state.fire && state.fire.v === 1);
  const back = deserialize(state, assets, {});
  ok('deserialize leaves fire to the game (null)', back.fire === null);
  const g2 = mk(); g2.load(state.fire);
  for (let i = 0; i < 120; i++) { world.fire.step(); g2.step(); }
  ok('game-side load resumes identically', JSON.stringify(world.fire.save()) === JSON.stringify(g2.save()));
}
console.log(`serialize.fire.test: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
