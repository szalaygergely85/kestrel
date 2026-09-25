// game/js/quest/beacon.test.js (BUG-PERF-001a, docs/backlog.md row 25w).
// Headless Node ESM, no framework. Run: node game/js/quest/beacon.test.js
//
// BUG-PERF-001a: `stepBeacon` used to `.find()` `world.structures` AND
// `struct.level.def.lights` (two closures allocated, two O(n) scans) on
// EVERY fixed step from the moment the relay's wake timer starts, and -
// since nothing ever stopped it - forever after too (the light stayed
// "on" but the function kept re-deriving the same growDur/targetIntensity
// every single step for the rest of the run). This test proves the fix:
// (1) the per-key struct/lightDef lookup happens ONCE, not per step, even
// against a `world.structures` array padded to a size that would make an
// O(n) scan expensive; (2) once the ramp finishes, `stepBeacon` is an O(1)
// no-op (rule 9) - it does not keep touching `world.structures` at all.
import { World, AssetRegistry } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import towerMod from '../../../design/levels/tower.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import testRoomMod from '../../../design/levels/test_room.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import worldMod from '../../../design/levels/world_m1.js';
import './index.js'; // registers every quest.* behaviour (silences "not registered" warnings)
import { beaconLight, stepBeacon } from './beacon.js';

paletteMod; towerMod; testRoomMod; terrainMod; worldMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; // classic scripts: side effects on globalThis.ASSETS
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const worldM1 = assets.world('world_m1');
const placement = worldM1.structures.find((s) => s.level === 'tower');

function makeWorld() {
  return World.load({
    name: 'tower_only', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [], state: {},
  }, assets, {});
}

// ---- pad world.structures with a lot of decoys, so an O(n) `.find()` scan
// would actually cost something measurable, and instrument Array.prototype.find
// so we can assert exactly how many times it is called. ----
function padAndCountFinds(world, n) {
  const decoy = world.structures[0];
  for (let i = 0; i < n; i++) world.structures.push({ ...decoy, id: `decoy${i}` });
  // the real tower structure must still resolve - keep it reachable, at the END
  // (worst case for a linear .find scan) so caching is the only thing that saves work.
  const real = world.structures.shift();
  world.structures.push(real);

  let findCalls = 0;
  const origFind = Array.prototype.find;
  Array.prototype.find = function patchedFind(...args) {
    findCalls++;
    return origFind.apply(this, args);
  };
  return { restore: () => { Array.prototype.find = origFind; }, count: () => findCalls };
}

const relayRec = worldM1; // not used directly - beaconLight only needs ctx.entity/def/world

// ---- find the tower's real relay prop/light ids from tower.js itself (no literal id - AC) ----
const towerDef = assets.level('tower');
const beaconInteractable = towerDef.interactables.find((i) => i.interact === 'beacon.light');
ok('sanity: tower.js has a beacon.light interactable', !!beaconInteractable);

{
  const world = makeWorld();
  const tower = world.structures[0];
  const structId = tower.id;
  const entity = world.get(`${structId}.${beaconInteractable.prop}`);
  ok('sanity: relay prop entity exists', !!entity);

  const { restore, count } = padAndCountFinds(world, 2000);

  const lights = {
    count: 1,
    key: [`${structId}.${beaconInteractable.light}`],
    baseIntensity: new Float32Array([0]),
    setOn() {},
  };

  // Fire the interaction (real body, same as updateInteraction would call it).
  beaconLight({ world, def: beaconInteractable, entity });
  ok('wake timer armed', world.state['tower.beacon.wakeT'] === 0);

  const DT = 1 / 60;
  const model = assets.model('relay');
  const wakeAnim = model.animations.wake;
  const startT = model.wakeLightFrame / wakeAnim.fps;
  const growDur = assets.palette.lights[towerDef.lights.find((l) => l.id === beaconInteractable.light).preset].grow.duration;
  const totalSteps = Math.ceil((startT + growDur) / DT) + 30; // run well past the ramp's end

  for (let i = 0; i < totalSteps; i++) stepBeacon(world, lights, DT, assets.palette);

  const findsUsed = count();
  restore();

  ok('the ramp actually completed (baseIntensity reached the preset target)',
    Math.abs(lights.baseIntensity[0] - assets.palette.lights[towerDef.lights.find((l) => l.id === beaconInteractable.light).preset].intensity) < 1e-6,
    `baseIntensity=${lights.baseIntensity[0]}`);
  // The only allowed `.find()` calls are the ONE-TIME struct/lightDef lookup
  // (2 calls: world.structures.find + level.def.lights.find) - never one per
  // step. Before the fix this would have been ~2 * totalSteps (thousands).
  ok(`Array.prototype.find called a bounded number of times (<=4), not once per step (${totalSteps} steps)`,
    findsUsed <= 4, `find() calls=${findsUsed}`);

  // ---- run MANY more steps past the ramp's end (light fully lit, cache
  // already warm): must stay a flat O(1) no-op, touching
  // world.structures.find zero further times - the fix is the CACHE, not a
  // one-shot early return, so the wake -> awake clip-switch check right
  // above it keeps running every step (cheaply) as it must. ----
  const { restore: restore2, count: count2 } = padAndCountFinds(world, 0); // just re-instrument, no more padding needed
  for (let i = 0; i < 600; i++) stepBeacon(world, lights, DT, assets.palette); // 10 s more
  const findsAfterDone = count2();
  restore2();
  ok('zero further .find() calls once the ramp has finished (cache stays warm, no "forever re-scans")', findsAfterDone === 0, `find() calls=${findsAfterDone}`);
}

// ---- a step time sanity check: with structures padded to 5000, one step
// after the ramp has already been cached must not be measurably slower than
// one step with only the real structure - i.e. genuinely O(1), not "O(n) but
// the n happens to be small in this game". ----
{
  const worldSmall = makeWorld();
  const worldBig = makeWorld();
  padAndCountFinds(worldBig, 5000).restore(); // pad only, discard the instrumentation

  const structIdSmall = worldSmall.structures[0].id, structIdBig = worldBig.structures[0].id;
  const entitySmall = worldSmall.get(`${structIdSmall}.${beaconInteractable.prop}`);
  const entityBig = worldBig.get(`${structIdBig}.${beaconInteractable.prop}`);
  const lightsSmall = { count: 1, key: [`${structIdSmall}.${beaconInteractable.light}`], baseIntensity: new Float32Array([0]), setOn() {} };
  const lightsBig = { count: 1, key: [`${structIdBig}.${beaconInteractable.light}`], baseIntensity: new Float32Array([0]), setOn() {} };
  beaconLight({ world: worldSmall, def: beaconInteractable, entity: entitySmall });
  beaconLight({ world: worldBig, def: beaconInteractable, entity: entityBig });

  const DT = 1 / 60;
  // Warm the cache with one step each (this is the one allowed scan).
  stepBeacon(worldSmall, lightsSmall, DT, assets.palette);
  stepBeacon(worldBig, lightsBig, DT, assets.palette);

  const N = 5000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) stepBeacon(worldSmall, lightsSmall, DT, assets.palette);
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) stepBeacon(worldBig, lightsBig, DT, assets.palette);
  const t2 = process.hrtime.bigint();
  const msSmall = Number(t1 - t0) / 1e6, msBig = Number(t2 - t1) / 1e6;
  // Generous ratio bound (Node timing is noisy) - an O(n) scan against 5000
  // decoys every step would blow this well past 3x; O(1) caching keeps it flat.
  ok(`step time stays flat regardless of world.structures size (small=${msSmall.toFixed(2)}ms big=${msBig.toFixed(2)}ms for ${N} steps each)`,
    msBig < msSmall * 3 + 5);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
