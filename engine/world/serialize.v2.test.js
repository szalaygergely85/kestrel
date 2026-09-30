// engine/world/serialize.v2.test.js (CO-5, docs/coordinates.md section 8).
// Headless Node ESM, no framework. Run: node engine/world/serialize.v2.test.js
//
// Covers what serialize.test.js/serialize.contentIds.test.js do not: the
// `WorldState` v2 shape itself (version, `entities[].parent`) and the
// byte-stable save -> load -> save round trip through `stringifySave`.
import { World } from './World.js';
import { serialize, deserialize, stringifySave } from './serialize.js';
import { migrateState } from './migrateState.js';
import paletteMod from '../../design/palette.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; terrainDef;
lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod;
farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const world = World.load(assets.world('world_m1'), assets, {});
// A structure z != 0 and a non-zero yawStep would be nice to also exercise,
// but world_m1's real tower is z=0/yawSteps=0 - the migration fixture test
// (migrateState.test.js) covers a `z = -3`/`'ground'`-props save instead
// (this file sticks to real, loadable content).
const state = serialize(world);

// ---------------------------------------------------------------------------
// 1. Shape.
// ---------------------------------------------------------------------------
ok('1a: serialize writes version 2', state.version === 2);

const brazier = state.entities.find((e) => e.id === 'tower.brazier');
ok('1b: a structure-owned content prop gets parent = its structure id', !!brazier && brazier.parent === 'tower');

// CO-5 follow-up: `player`'s id has no "tower."-dot prefix, but it IS
// spawned via `ed.spawn: {structure: "tower", ...}` (world_m1.world.json) -
// its real, live `parent` is "tower". Before the follow-up fix, serialize()
// recomputed `parent` from the id prefix instead of reading the live field,
// so this wrongly came out `null`; `endMarker`/`farTower` below (inline
// x/y/z, no `spawn`, no dot prefix) correctly stay `null` either way.
const player = state.entities.find((e) => e.id === 'player');
ok('1c: an entity spawned from a structure gets parent = that structure\'s id (even without a dot-id)', !!player && player.parent === 'tower');

const endMarker = state.entities.find((e) => e.id === 'endMarker');
ok('1c2: a world-level entity with no struct-id prefix and no spawn gets parent = null', !!endMarker && endMarker.parent === null);

ok('1d: every entity has a parent key (string or null)', state.entities.every((e) => e.parent === null || typeof e.parent === 'string'));

// ---------------------------------------------------------------------------
// 2. Round trip keeps version 2 and the same parent values.
// ---------------------------------------------------------------------------
const world2 = deserialize(JSON.parse(JSON.stringify(state)), assets, {});
const state2 = serialize(world2);
ok('2a: round-tripped state is still version 2', state2.version === 2);
ok('2b: round-tripped state deep-equals the original (parent included)', JSON.stringify(state) === JSON.stringify(state2));

// ---------------------------------------------------------------------------
// 3. Byte-stable canonical stringify: save -> load -> save -> identical text.
// ---------------------------------------------------------------------------
const text1 = stringifySave(state);
const text2 = stringifySave(state2);
ok('3a: stringifySave round trip is byte-identical', text1 === text2);
ok('3b: stringifySave output is non-empty canonical JSON text', text1.startsWith('{\n') && text1.endsWith('}\n'));

// A second independent load + serialize + stringify, to rule out any
// ordering flakiness (e.g. a Set/Map iteration order dependency).
const world3 = deserialize(JSON.parse(JSON.stringify(state2)), assets, {});
const text3 = stringifySave(serialize(world3));
ok('3c: a third round trip is still byte-identical', text1 === text3);

// ---------------------------------------------------------------------------
// 4. Unknown/future version throws a clear, specific error (not a
// best-effort migration) - both directly from migrateState and via deserialize.
// ---------------------------------------------------------------------------
{
  let threw = null;
  try { migrateState({ ...state, version: 3 }); } catch (err) { threw = err; }
  ok('4a: migrateState throws on a future version', threw instanceof Error);
  ok('4b: the error message names the version', !!threw && /version 3/.test(threw.message));
}
{
  let threw = null;
  try { deserialize({ ...state, version: 3 }, assets, {}); } catch (err) { threw = err; }
  ok('4c: deserialize throws on a future version (no silent best-effort)', threw instanceof Error);
}
{
  let threw = null;
  try { migrateState({ ...state, version: 0 }); } catch (err) { threw = err; }
  ok('4d: migrateState throws on an invalid (0) version', threw instanceof Error);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
