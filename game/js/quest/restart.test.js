// game/js/quest/restart.test.js (US-017). Headless Node ESM, no framework.
// Run: node game/js/quest/restart.test.js
//
// Per the architect's tech notes (docs/backlog.md US-017 item 5): take the
// lamp, pull the lever, stop mid-open, push the boulder, fire `quest.end` -
// all on a REAL `world_m1` (architect tech note 4's precedent, same as
// boulder.test.js/tower.test.js) - then prove `initialState` (captured
// right after `World.load`, BEFORE any of that) is unaffected: a fresh
// `serialize(deserialize(initialState))` round trip deep-equals it, and a
// world rebuilt from it has the SAME tower `packed.geom` as a totally
// independent fresh `World.load` - i.e. none of this story's live-world
// mutation (the lever's mid-tween `animateSector`, `quest.end`) ever leaked
// into the shared level def/legend objects other loads read from.
import {
  World, serialize, deserialize, validateBehaviours,
  stepRollers, resolveBodyContacts, PHYSICS_DEFAULTS, stepSectorAnims,
} from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
// US-011 (7.5 item 1): World.load's prop spawn throws on any
// props[].model that isn't registered - every tower prop model must
// load, same reasoning as game/index.html's script tags.
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
// US-016: the `farTower` entity + `ferrumLights` horizon billboard world_m1.js references.
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import './index.js'; // registers every quest.* behaviour (lantern.take, lever.pull, quest.end, ...)
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';

paletteMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; farTowerMod; ferrumLightsMod; // classic scripts: side effects on globalThis.ASSETS
const { assets } = await loadTestAssets(); // US-027b: tower/test_room/world_m1 now content/*.json

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// A real world_m1, loaded once. `initialState` is captured right here -
// exactly where main.js takes it (US-017 tech note "Restart / world swap").
// ---------------------------------------------------------------------------
const worldDef = assets.world('world_m1');
const world = World.load(worldDef, assets, {});
const initialState = serialize(world);
const initialStateSnapshot = structuredClone(initialState); // an independent copy, for the "nothing leaked back" check below

ok('0a: quest behaviours are all registered on real content', validateBehaviours(world).length === 0, validateBehaviours(world).join(', '));

const tower = world.structures.find((s) => s.id === 'tower');
const player = world.get('player');

// ---------------------------------------------------------------------------
// 1. Take the lamp.
// ---------------------------------------------------------------------------
const lanternRec = world.interactables.find((r) => r.id === 'lantern');
ok('1a: world has the lantern interactable', !!lanternRec);
world.fireInteraction(lanternRec.name, { engine: {}, def: lanternRec.def, entity: world.get(lanternRec.propId), actor: player });
ok('1b: lantern taken', world.state['tower.lantern.taken'] === true);

// ---------------------------------------------------------------------------
// 2. Pull the lever, then step the grate open partway - "stop mid-open".
// ---------------------------------------------------------------------------
const leverRec = world.interactables.find((r) => r.id === 'lever');
ok('2a: world has the lever interactable', !!leverRec);
world.fireInteraction(leverRec.name, { engine: {}, def: leverRec.def, entity: world.get(leverRec.propId), actor: player });
ok('2b: lever pulled', world.state['tower.lever.pulled'] === true);
// Consume the 0.4 s delay, then run partway through the open tween (well
// short of the grate's own openTime) so `structure.dynamics.grate.t` is a
// genuine mid-open fraction, not 0 or 1.
for (let i = 0; i < 30; i++) stepSectorAnims(world, PHYSICS_DEFAULTS.fixedDt);
const grateT = tower.dynamics.grate && tower.dynamics.grate.t;
ok('2c: grate stopped mid-open', typeof grateT === 'number' && grateT > 0 && grateT < 1, `t=${grateT}`);

// ---------------------------------------------------------------------------
// 3. Push the boulder (same approach as boulder.test.js: spawn the real
// tower.js boulder prop as a roller entity and drive it with stepRollers).
// ---------------------------------------------------------------------------
// US-011 (7.5 item 1): `World.load` now auto-spawns `tower.boulder` itself
// (body + roller, `dynamic: true`) - reuse it instead of spawning a second
// entity under the same id (which now throws, `boulder.test.js`).
const towerDef = assets.level('tower');
const boulderProp = towerDef.props.find((p) => p.id === 'boulder');
const bx = tower.origin.x + boulderProp.x, by = tower.origin.y + boulderProp.y;
const boulder = world.entity('tower.boulder');
boulder.components.body.vx = 2; boulder.components.body.vy = 0.5;
for (let i = 0; i < 60; i++) {
  stepRollers(world, PHYSICS_DEFAULTS.fixedDt, PHYSICS_DEFAULTS);
}
ok('3a: boulder moved from its start position', boulder.transform.x !== bx || boulder.transform.y !== by);

// ---------------------------------------------------------------------------
// 4. Fire quest.end directly (same shape `updateTriggers` fires it with).
// US-026a-content: the 'end' trigger moved off the tower level onto
// worlds.world_m1.triggers (world coordinates, structId: null - the
// waystone). `world.triggers` (built by the current `buildTriggers`, which
// only reads structure-level `def.triggers`) does not include it yet - that
// wiring is PC-A's US-026a-engine work (S2/S5). This still exercises the
// real registered 'quest.end' behaviour with a ctx built straight from the
// content data, same as `fireTrigger` always does.
// ---------------------------------------------------------------------------
const worldEndDef = (worldDef.triggers || []).find((t) => t.id === 'end');
ok('4a: worlds.world_m1 content has the end trigger (moved world-level, US-026a)', !!worldEndDef);
world.fireTrigger('quest.end', { engine: {}, def: worldEndDef, entity: player.data, structId: null });
ok('4b: quest.endT set', world.state['quest.endT'] === 0);

// ---------------------------------------------------------------------------
// 5. `initialState` is unaffected by any of the above (captured BEFORE it).
// ---------------------------------------------------------------------------
ok('5a: initialState itself never changed', deepEqual(initialState, initialStateSnapshot));
ok('5b: initialState.state.quest.endT is still -1', initialState.state['quest.endT'] === -1);
ok('5c: initialState has no tower dynamics (grate never opened at capture time)',
  !initialState.structures.find((s) => s.id === 'tower').dynamics.grate
  || initialState.structures.find((s) => s.id === 'tower').dynamics.grate.t === 0);

// ---------------------------------------------------------------------------
// 6. serialize(deserialize(initialState)) deep-equals initialState.
// ---------------------------------------------------------------------------
const roundTripped = serialize(deserialize(initialState, assets));
ok('6a: serialize(deserialize(initialState)) deep-equals initialState', deepEqual(roundTripped, initialState));

// ---------------------------------------------------------------------------
// 7. A world rebuilt from `initialState` has the SAME tower packed.geom as
// a totally independent fresh World.load - the live world's mutations
// (lever mid-tween, quest.end) never touched the shared def/legend objects.
// ---------------------------------------------------------------------------
const restored = deserialize(initialState, assets);
const restoredTower = restored.structures.find((s) => s.id === 'tower');
const freshWorld = World.load(worldDef, assets, {});
const freshTower = freshWorld.structures.find((s) => s.id === 'tower');
ok('7a: restored tower packed.geom equals a fresh load', geomEqual(restoredTower.packed.geom, freshTower.packed.geom));
ok('7b: restored tower dynamics.grate is at rest (t=0), unlike the mutated live world', !restoredTower.dynamics.grate || restoredTower.dynamics.grate.t === 0);
ok('7c: validateBehaviours is empty on the restored world too', validateBehaviours(restored).length === 0);

function geomEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('ALL PASS');
