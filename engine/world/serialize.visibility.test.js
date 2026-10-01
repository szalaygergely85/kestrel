// engine/world/serialize.visibility.test.js (RE-11b, docs/architecture.md
// 28.3, "Save" / CO-5 extension). Headless Node ESM, no framework.
// Run: node engine/world/serialize.visibility.test.js
//
// Covers the optional `world.visibility` field added to `World`/`serialize`/
// `deserialize`: (a) present + round-tripped when the game sets it, (b)
// completely absent from the saved JSON (byte-identical to before this
// story) when it's left at its `null` default - the regression check that
// matters most, since almost every existing world/save has no `visibility`.
import { World } from './World.js';
import { Visibility } from './Visibility.js';
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

// ---------------------------------------------------------------------------
// 1. Default (null) world.visibility: no key in the saved JSON at all, and
//    the round trip stays byte-identical (the critical regression check).
// ---------------------------------------------------------------------------
{
  const world = World.load(assets.world('world_m1'), assets, {});
  ok('1a: world.visibility defaults to null', world.visibility === null);

  const state = serialize(world);
  ok('1b: no "visibility" key when world.visibility is null', !('visibility' in state));

  const world2 = deserialize(JSON.parse(JSON.stringify(state)), assets, {});
  ok('1c: deserialize leaves visibility null when the key is absent', world2.visibility === null);

  const text1 = stringifySave(state);
  const text2 = stringifySave(serialize(world2));
  ok('1d: stringifySave round trip byte-identical with no visibility set', text1 === text2);
  ok('1e: stringifySave text has no "visibility" line', !/"visibility"/.test(text1));
}

// ---------------------------------------------------------------------------
// 2. world.visibility set: saved, restored (explored survives, never
//    visible - sources aren't saved), and the round trip stays stable.
// ---------------------------------------------------------------------------
{
  const world = World.load(assets.world('world_m1'), assets, {});
  world.visibility = new Visibility({ x0: 0, y0: 0, w: 10, h: 10, teams: 1, maxSources: 4, maxRadiusCells: 4 });
  world.visibility.setSource(1, 0b1, 5, 5, 2);
  world.visibility.setSource(2, 0b1, 1, 1, 1);

  // Sanity: the stamped cell is visible pre-save.
  ok('2a: pre-save: stamped cell is visible', world.visibility.isVisible(0, 5, 5));

  const state = serialize(world);
  ok('2b: "visibility" key is present when world.visibility is set', 'visibility' in state);
  ok('2c: serialized visibility matches saveExplored()\'s own shape',
    JSON.stringify(state.visibility) === JSON.stringify(world.visibility.saveExplored()));

  const world2 = deserialize(JSON.parse(JSON.stringify(state)), assets, {});
  ok('2d: deserialize restores a Visibility instance', world2.visibility instanceof Visibility);
  ok('2e: post-load: previously-visible cell is explored, not visible (sources not restored)',
    world2.visibility.isExplored(0, 5, 5) && !world2.visibility.isVisible(0, 5, 5));
  ok('2f: post-load: an unexplored cell stays unseen', !world2.visibility.isExplored(0, 9, 9));

  const state2 = serialize(world2);
  ok('2g: re-serialized state.visibility matches the restored visibility\'s saveExplored()',
    JSON.stringify(state2.visibility) === JSON.stringify(world2.visibility.saveExplored()));
  ok('2h: re-serialized state.visibility equals the original (explored bits preserved)',
    JSON.stringify(state.visibility) === JSON.stringify(state2.visibility));

  const text1 = stringifySave(state);
  const text2 = stringifySave(state2);
  ok('2i: stringifySave round trip byte-identical with visibility set', text1 === text2);

  // A third independent round trip, to rule out ordering flakiness.
  const world3 = deserialize(JSON.parse(JSON.stringify(state2)), assets, {});
  const text3 = stringifySave(serialize(world3));
  ok('2j: a third round trip is still byte-identical', text1 === text3);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
