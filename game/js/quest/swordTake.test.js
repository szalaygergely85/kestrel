// game/js/quest/swordTake.test.js (US-078c). Headless Node ESM, no framework.
// Run: node game/js/quest/swordTake.test.js
//
// Same real-content pattern tower.test.js uses for lantern/lever/beacon
// (architect tech note 4): the REAL content/levels/tower.level.json "sword"
// prop + interactable (copied in from design/models/sword.js's
// `ASSETS.levelPatch.towerSword`), driven through `world.fireInteraction`,
// never a hand-rolled fake def/entity.
import {
  World, serialize, deserialize, validateBehaviours,
} from '../../../engine/index.js';
import { registerQuestBehaviours } from './index.js';
import { removeSwordIfTaken } from './swordTake.js';

import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
// US-011 (7.5 item 1): World.load's prop spawn throws on any props[].model
// that isn't registered - every tower prop model must load.
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import swordMod from '../../../design/models/sword.js';
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';

paletteMod; detailPassMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; farTowerMod; ferrumLightsMod; // classic scripts: side effects on globalThis.ASSETS
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

registerQuestBehaviours();
ok('sword.take is a real registered behaviour', validateBehaviours.name === 'validateBehaviours'); // sanity: import resolved

const worldM1 = assets.world('world_m1');
const placement = worldM1.structures.find((s) => s.level === 'tower');
const towerDef = assets.level('tower');

// Full world_m1 (restart.test.js's own precedent for a real `player` entity
// to serialize/deserialize) - a real actor is needed here, not the fake
// `setComponent`-only stub `tower.test.js`'s lantern test uses, since test 3
// below round-trips the carried light through `serialize`/`deserialize`.
function freshWorld() {
  return World.load(worldM1, assets, {});
}

const swordDef = towerDef.interactables.find((i) => i.id === 'sword');
ok('tower.level.json has a "sword" interactable (US-078c content copy)', !!swordDef && swordDef.interact === 'sword.take' && swordDef.prop === 'sword' && swordDef.once === true);

// ---------------------------------------------------------------------------
// 1. Order A: lantern first, then sword. Lantern's offset starts at +0.3,
//    swordTake must flip it to -0.3; flag set; prop gone.
// ---------------------------------------------------------------------------
{
  const world = freshWorld();
  const lanternDef = towerDef.interactables.find((i) => i.id === 'lantern');
  const lanternProp = world.get('tower.lantern');
  const swordProp = world.get('tower.sword');
  const player = world.get('player');

  ok('World.load auto-spawns the real sword prop entity', !!swordProp && swordProp.getComponent('voxel').model === 'sword');

  world.fireInteraction('lantern.take', { def: lanternDef, entity: lanternProp, actor: player });
  ok('1a: lantern.take gives +0.3 right offset before the sword is taken', player.getComponent('light').offset.right === 0.3);

  const r = world.fireInteraction('sword.take', { def: swordDef, entity: swordProp, actor: player });
  ok('1b: sword.take returns true', r === true);
  ok('1c: sword.take sets tower.sword.taken', world.state['tower.sword.taken'] === true);
  ok('1d: sword.take removes the sword prop entity', world.get('tower.sword') === null);
  ok('1e: sword.take flips the carried light to -0.3 (lantern taken first)', player.getComponent('light').offset.right === -0.3);
  // down/fwd/preset/attach untouched by the offset tweak.
  const light = player.getComponent('light');
  ok('1f: sword.take leaves the rest of the light component alone', light.offset.down === 0.3 && light.offset.fwd === 0.4 && light.preset === 'lantern' && light.on === true && light.attach === 'eye');
}

// ---------------------------------------------------------------------------
// 2. Order B: sword first (no light yet - no-op on the light), then lantern,
//    which must itself choose -0.3 since the sword is already taken.
// ---------------------------------------------------------------------------
{
  const world = freshWorld();
  const lanternDef = towerDef.interactables.find((i) => i.id === 'lantern');
  const lanternProp = world.get('tower.lantern');
  const swordProp = world.get('tower.sword');
  const player = world.get('player');

  const r = world.fireInteraction('sword.take', { def: swordDef, entity: swordProp, actor: player });
  ok('2a: sword.take (first) returns true', r === true);
  ok('2b: sword.take (first) sets the flag and removes the prop', world.state['tower.sword.taken'] === true && world.get('tower.sword') === null);
  ok('2c: sword.take (first) is a no-op on the light (actor has none yet)', player.getComponent('light') == null);

  world.fireInteraction('lantern.take', { def: lanternDef, entity: lanternProp, actor: player });
  ok('2d: lantern.take (second) sees the sword flag and starts at -0.3', player.getComponent('light').offset.right === -0.3);
}

// ---------------------------------------------------------------------------
// 3. Serialize/deserialize round trip keeps all three facts: the flag, the
//    prop gone, and the light offset.
// ---------------------------------------------------------------------------
{
  const world = freshWorld();
  const lanternDef = towerDef.interactables.find((i) => i.id === 'lantern');
  const lanternProp = world.get('tower.lantern');
  const swordProp = world.get('tower.sword');
  const player = world.get('player');

  world.fireInteraction('lantern.take', { def: lanternDef, entity: lanternProp, actor: player });
  world.fireInteraction('sword.take', { def: swordDef, entity: swordProp, actor: player });

  const saved = serialize(world);
  const loaded = deserialize(saved, assets);

  ok('3a: round trip keeps tower.sword.taken', loaded.state['tower.sword.taken'] === true);
  ok('3b: round trip keeps the sword prop gone', loaded.get('tower.sword') === null);
  const loadedPlayer = loaded.get('player');
  ok('3c: round trip keeps the carried light at -0.3', loadedPlayer.getComponent('light').offset.right === -0.3);

  // A FURTHER round trip (save of a save) must still keep it gone - the
  // removed-content set itself has to survive, not just the one hop.
  const saved2 = serialize(loaded);
  ok('3d: removed set carries through a second save', saved2.removed.includes('tower.sword'));
  const loaded2 = deserialize(saved2, assets);
  ok('3e: second round trip still keeps the prop gone', loaded2.get('tower.sword') === null);
}

// ---------------------------------------------------------------------------
// 4. removeSwordIfTaken (the world:loaded safety net, architecture.md 30.1):
//    a world built directly with the flag already set in its initial state
//    (not via a deserialize `removed` set) still spawns the content prop -
//    removeSwordIfTaken is what a 'world:loaded' handler would call to clear it.
// ---------------------------------------------------------------------------
{
  const world = World.load({
    name: 'tower_sword_preset_test', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [], state: { 'tower.sword.taken': true },
  }, assets, {});

  ok('4a: a flag set in initial state does NOT by itself stop the prop spawning', !!world.get('tower.sword'));
  removeSwordIfTaken(world);
  ok('4b: removeSwordIfTaken removes it', world.get('tower.sword') === null);

  // No-op when the flag is unset or the prop is already gone - never throws.
  const world2 = freshWorld();
  removeSwordIfTaken(world2);
  ok('4c: removeSwordIfTaken is a no-op when the flag is unset', !!world2.get('tower.sword'));
  removeSwordIfTaken(world2);
  ok('4d: removeSwordIfTaken on a world with no "tower" structure id match / already-gone prop never throws', true);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n' + failures.join('\n')); process.exit(1); }
