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
  updateTriggers,
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
// waystone). US-026a-S6 note: `world.triggers` now DOES include this
// world-level record (`buildTriggers`/S2 landed) - see section 8 below for
// the real `updateTriggers`-driven fire (walking onto the circle) rather
// than this direct `fireTrigger` call. This still exercises the real
// registered 'quest.end' behaviour with a ctx built straight from the
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

// ---------------------------------------------------------------------------
// 8. US-026a-S6: the REAL trigger-fired path (walking onto the waystone
// circle, through `updateTriggers` - not the direct `fireTrigger` call in
// section 4), plus a restart-after-terrain-end round trip: `R` (deserialize
// (initialState)) rebuilds `world.triggers` fresh (inside reset to 0, used
// flags gone) so the SAME walk fires the end again, not a stale one-shot.
// A dedicated fresh world (not the heavily-mutated `world` above).
// ---------------------------------------------------------------------------
{
  const engineStub = { assets };
  const w = World.load(worldDef, assets, {});
  const initB = serialize(w);
  const p = w.get('player');

  // US-026a-engine S2 landed since the section-4 comment above was written:
  // world.triggers now really does include the world-level end trigger.
  const endRec = w.triggers.find((t) => t.key === 'world.end');
  ok('8a: world.triggers includes the world-level end trigger', !!endRec && endRec.structId === null);

  // Teleport onto the waystone circle (content: x 1428, y 1040, r 2.5) and
  // step triggers for real - `updateTriggers` -> `quest.end` -> `questEnd`,
  // structId null, absolute walkTo, lookAt farTower - not a synthetic ctx.
  p.data.transform.x = 1428; p.data.transform.y = 1040; p.data.transform.z = w.terrain.groundAt(1428, 1040);
  updateTriggers(w, engineStub, p.data);
  ok('8b: walking onto the waystone circle fires quest.end (endT=0)', w.state['quest.endT'] === 0);
  const ew = p.data.components.body._endWalk;
  const endDef = worldDef.triggers.find((t) => t.id === 'end');
  ok('8c: walk target is the content walkTo verbatim (absolute, not origin-shifted)',
    Math.abs(ew.x0 + ew.dirX * Math.hypot(endDef.walkTo.x - 1428, endDef.walkTo.y - 1040) - endDef.walkTo.x) < 1e-6);
  ok('8d: lookAt farTower resolved to a real finite yaw', typeof ew.yawTo === 'number' && Number.isFinite(ew.yawTo));

  // once: true - staying inside (or being asked again) must not refire.
  w.state['quest.endT'] = -1; // pretend the sequence "finished", so a refire is unmistakable
  updateTriggers(w, engineStub, p.data);
  ok('8e: the end trigger is once - does not refire while still inside', w.state['quest.endT'] === -1);

  // ---- Restart ("R"): main.js does exactly `deserialize(initialState)` ----
  const restored = deserialize(initB, assets);
  const restoredEndRec = restored.triggers.find((t) => t.key === 'world.end');
  ok('8f: restart rebuilds world.triggers fresh (inside reset to 0)', !!restoredEndRec && restoredEndRec.inside === 0);
  ok('8g: restart clears the used-once flag', !restored.state['used.world.end']);
  ok('8h: restart resets quest.endT to -1 (no card/fade carried over)', restored.state['quest.endT'] === -1);

  // Walking onto the waystone again after the restart fires it again -
  // proves this is a real reset, not "the flag just happens to be unset".
  const p2 = restored.get('player');
  p2.data.transform.x = 1428; p2.data.transform.y = 1040; p2.data.transform.z = restored.terrain.groundAt(1428, 1040);
  updateTriggers(restored, engineStub, p2.data);
  ok('8i: after restart, walking onto the waystone fires quest.end again', restored.state['quest.endT'] === 0);

  // ---- hint.show once-per-trigger (23.5's "fires exactly once") ----
  // 'hintStone' ('terrain' shape) is inside the moment the actor is outside
  // any structure footprint AND the world has terrain - true at the
  // waystone spot used above. Confirm it fired once (used flag set) and a
  // second updateTriggers call (still inside, no edge) does not re-set the
  // hint queue (hints.shown/done stay whatever `request` left them - the
  // used flag not flipping again is the trigger-level "once" guarantee).
  ok('8j: hintStone fired once (used flag set) on the same walk-in', restored.state['used.world.hintStone'] === true);
  const shownAfterFirst = JSON.stringify(restored.state['hints.shown'] || []);
  updateTriggers(restored, engineStub, p2.data); // still inside - no edge, must not refire
  ok('8k: a second updateTriggers call (still inside) does not touch hints state again',
    JSON.stringify(restored.state['hints.shown'] || []) === shownAfterFirst);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('ALL PASS');
