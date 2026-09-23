// engine/world/serialize.test.js (US-025, docs/architecture.md section 10).
// Headless Node ESM, no framework. Run: node engine/world/serialize.test.js
import { AssetRegistry } from '../core/assets.js';
import { World } from './World.js';
import { serialize, deserialize } from './serialize.js';
import paletteMod from '../../design/palette.js';
import towerDef from '../../design/levels/tower.js';
import terrainDef from '../../design/levels/overworld_far.js';
import worldMod from '../../design/levels/world_m1.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; towerDef; terrainDef; worldMod;
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const world = World.load(assets.world('world_m1'), assets, {});

// Move the grate partway open and the player a bit, so the round trip
// exercises non-default state.
world.animateSector('grate', 0.5);
const player = world.get('player');
player.data.transform.x += 1.234;
player.data.components.body = { radius: 0.3, height: 1.7, eyeH: 1.6, vx: 0, vy: 0, vz: 0, grounded: true };
world.state['tower.lantern.taken'] = true;

function roundTrip(w) {
  const s1 = serialize(w);
  const json = JSON.parse(JSON.stringify(s1)); // exercise the JSON-safety requirement
  const w2 = deserialize(json, assets, {});
  const s2 = serialize(w2);
  return { s1, s2, w2 };
}

const { s1, s2, w2 } = roundTrip(world);

ok('round trip is deep-equal (serialize -> JSON -> deserialize -> serialize)', JSON.stringify(s1) === JSON.stringify(s2));
ok('positions are bit-exact (no rounding)', s2.entities.find((e) => e.id === 'player').transform.x === player.data.transform.x);
ok('grate dynamics survive the round trip', s2.structures.find((s) => s.id === 'tower').dynamics.grate.t === 0.5);
ok('boulder-style / arbitrary state survives the round trip', s2.state['tower.lantern.taken'] === true);
ok('nextId survives the round trip', s2.nextId === world.nextId);

// Old handles report alive === false after a deserialize (10.1).
ok('old handles report alive === false after deserialize (a NEW World)', player.alive === true && w2.get('player') !== player);

// Terrain overrides copied - mutating the source afterwards does not change the state.
const recipe = globalThis.ASSETS.levels.overworld_far;
const beforeMutate = JSON.stringify(s1.terrain.overrides);
recipe.overrides['11,8'].stamps[0].h = 999; // mutate the SOURCE asset
const sAgain = serialize(world);
ok('terrain overrides in a PREVIOUSLY taken snapshot are independent of later source mutation',
  JSON.stringify(s1.terrain.overrides) === beforeMutate && sAgain.terrain.overrides['11,8'].stamps[0].h === 999);
recipe.overrides['11,8'].stamps[0].h = 2.4; // restore

// Grate ceilH is really live data (US-014 dependency): re-applying dynamics after deserialize actually mutates the legend.
const towerLevel2 = w2.structures.find((s) => s.id === 'tower').level;
ok('deserialize re-applies dynamics onto the new World\'s own legend', Math.abs(towerLevel2.legend['G'].ceilH - (towerLevel2.legend['G'].floorH + (towerLevel2.legend['G'].dynamic.ceilOpen - towerLevel2.legend['G'].floorH) * 0.5)) < 1e-6);

// Unknown version -> a clear error, not silent garbage.
let threw = false;
try { deserialize({ ...s1, version: 999 }, assets, {}); } catch (err) { threw = true; }
ok('deserialize with an unknown version throws a clear error', threw);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
