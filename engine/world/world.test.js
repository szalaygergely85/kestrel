// engine/world/world.test.js (US-025). Headless Node ESM, no framework.
// Run: node engine/world/world.test.js
import { AssetRegistry } from '../core/assets.js';
import { World } from './World.js';
import { serialize, deserialize } from './serialize.js';
import paletteMod from '../../design/palette.js';
import towerDef from '../../design/levels/tower.js';
import testRoomDef from '../../design/levels/test_room.js';
import terrainDef from '../../design/levels/overworld_far.js';
import worldMod from '../../design/levels/world_m1.js';
// US-011 (7.5 item 1): World.load's prop spawn throws on any props[].model
// that isn't registered - every tower prop model must load, same reasoning
// as game/index.html's script tags.
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
// US-016: the `farTower` entity + `ferrumLights` horizon billboard world_m1.js references.
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; towerDef; testRoomDef; terrainDef; worldMod;
lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod;
farTowerMod; ferrumLightsMod;
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const world = World.load(assets.world('world_m1'), assets, {});
const tower = world.structures.find((s) => s.id === 'tower');

// --- query table inside/outside/on bbox edges (half-open) -------------------
ok('inside the footprint: sectorAt resolves through the level', world.sectorAt(1490, 1020) !== null);
ok('x = x1 is OUTSIDE (half-open bbox)', world.structureAt(tower.bbox.x1, 1020) === null);
ok('y = y1 is OUTSIDE (half-open bbox)', world.structureAt(1490, tower.bbox.y1) === null);
ok('x0,y0 corner is INSIDE (half-open, lower bound inclusive)', world.structureAt(tower.bbox.x0, tower.bbox.y0) !== null);
ok('outside every footprint: sectorAt is null', world.sectorAt(0, 0) === null);

// --- outsideSector returns the SAME object every call -----------------------
const o1 = world.outsideSector(10, 10);
const o2 = world.outsideSector(20, 20);
ok('outsideSector returns the same (reused) object every call', o1 === o2);

// --- terrain: null -> solid --------------------------------------------------
const wNoTerrain = World.load(
  { terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [] },
  assets, {}
);
ok('terrain: null -> outsideSector is solid (Level default)', wNoTerrain.outsideSector(-5, -5).solid === true);

// --- floorAt outside = terrain height ----------------------------------------
const outsideX = 0, outsideY = 0;
ok('floorAt outside every structure == terrain heightAt', world.floorAt(outsideX, outsideY) === world.terrain.heightAt(outsideX, outsideY));
ok('heightAt ignores structures (terrain-only)', typeof world.heightAt(1492, 1025) === 'number');

// --- yawSteps: 1 throws -------------------------------------------------------
let threw = false;
try { world.placeStructure(assets.level('test_room'), { x: 0, y: 2000, z: 0 }, 'x', 1); } catch (err) { threw = true; }
ok('placeStructure with yawSteps != 0 throws (not in M1)', threw);

// --- structTable is populated -------------------------------------------------
ok('structTable row 0 has the tower origin', world.structTable[0] === tower.origin.x && world.structTable[1] === tower.origin.y);

// --- animateSector -------------------------------------------------------------
const grateBefore = tower.level.legend['G'].ceilH;
world.animateSector('grate', 1);
ok('animateSector(tag, 1) opens the grate to dynamic.ceilOpen', tower.level.legend['G'].ceilH === tower.level.legend['G'].dynamic.ceilOpen);
ok('animateSector bumped renderVersion', world.renderVersion > 0);
world.animateSector('grate', 0);
ok('animateSector(tag, 0) closes the grate back to floorH', Math.abs(tower.level.legend['G'].ceilH - tower.level.legend['G'].floorH) < 1e-9);
grateBefore;

// --- player entity spawned at the tower's start, offset by the origin --------
const player = world.get('player');
ok('player entity spawned from spawn:{structure,from:"start"}', player && player.data.type === 'player');
const expectedX = tower.level.start.x + tower.origin.x;
ok('player world position == level.start + origin', Math.abs(player.data.transform.x - expectedX) < 1e-9);

// --- removeEntity bumps renderVersion + forEachEntity reflects it (ARCH CHANGES, US-030c) --
{
  const vBefore = world.renderVersion;
  const h = world.spawn('propTest', { x: 0, y: 0, z: 0 }, { sprite: { model: 'x' } }, 'sprite_test_entity');
  ok('spawn bumped renderVersion', world.renderVersion > vBefore);

  let countAfterSpawn = 0;
  world.forEachEntity((e, id) => { if (id === 'sprite_test_entity') countAfterSpawn++; });
  ok('forEachEntity sees the spawned entity', countAfterSpawn === 1);

  const vBeforeRemove = world.renderVersion;
  world.removeEntity('sprite_test_entity');
  ok('removeEntity bumps renderVersion', world.renderVersion > vBeforeRemove);

  let countAfterRemove = 0;
  world.forEachEntity((e, id) => { if (id === 'sprite_test_entity') countAfterRemove++; });
  ok('forEachEntity count is 0 after removeEntity', countAfterRemove === 0);
  h;
}

// ---------------------------------------------------------------------------
// US-011 (7.5 item 1/7): props from level data -> generic prop entities.
// ---------------------------------------------------------------------------
{
  const towerPropDef = assets.level('tower').props.find((p) => p.id === 'gondola');
  const gondola = world.get('tower.gondola');
  ok('tower props spawn with id `tower.<id>`', !!gondola);
  ok('prop world coords = level-local + structure origin',
    Math.abs(gondola.data.transform.x - (towerPropDef.x + tower.origin.x)) < 1e-9 &&
    Math.abs(gondola.data.transform.y - (towerPropDef.y + tower.origin.y)) < 1e-9);

  ok('`decal:` props (scrawl) are skipped, no entity spawned', world.get('tower.scrawl') === null);
  ok('chain props (`from`/`to`, no x/y) are skipped, no entity spawned', world.get('tower.chains') === null);

  const rubble2 = world.get('tower.rubble2'); // tower.js: { id: 'rubble2', model: 'rubble', variant: 1, ... }
  ok('numeric variant packs as `${model}#${n}` (atlas + spawn)', !!rubble2 && rubble2.getComponent('sprite').model === 'rubble#1');

  const boulder = world.get('tower.boulder');
  ok('`dynamic: true` prop (boulder) gets body + roller components',
    !!boulder && !!boulder.getComponent('body') && !!boulder.getComponent('roller'));
  ok('dynamic prop body.radius comes from the prop def', boulder.getComponent('body').radius === assets.level('tower').props.find((p) => p.id === 'boulder').radius);
}

// ---------------------------------------------------------------------------
// US-011 (7.5 item 7): serialize -> deserialize gives the same entity set
// (no duplicate props re-spawned on top of the saved ones) and keeps
// anim/frame.
// ---------------------------------------------------------------------------
{
  const lever = world.get('tower.lever');
  lever.play('pull', { restart: true });
  lever.data.components.sprite.frame = 2;
  lever.stop();

  const idsBefore = new Set();
  world.forEachEntity((e, id) => idsBefore.add(id));

  const state = serialize(world);
  const world2 = deserialize(state, assets, {});

  const idsAfter = new Set();
  world2.forEachEntity((e, id) => idsAfter.add(id));
  ok('deserialize gives the same entity id set as before serialize (no duplicate prop spawn)',
    idsBefore.size === idsAfter.size && [...idsBefore].every((id) => idsAfter.has(id)),
    `${idsBefore.size} vs ${idsAfter.size}`);

  const lever2 = world2.get('tower.lever');
  const s = lever2.getComponent('sprite');
  ok('deserialize keeps the saved sprite anim/frame (lever mid-pull, held)', s.anim === 'pull' && s.frame === 2 && s.playing === false, JSON.stringify(s));
}

// --- US-016 D-011 addendum (architecture.md 14.4 items 13/14): world.horizon[] load/validation ---
{
  ok('world_m1 loads its one horizon entry (ferrumLights)', world.horizon.length === 1 && world.horizon[0].id === 'ferrumLights');
  ok('horizon entry carries bearing/elev/angular/fog/fogColor', world.horizon[0].bearingDeg === 87.6 && world.horizon[0].elevDeg === 1.0 &&
    world.horizon[0].angular.wDeg === 13.2 && world.horizon[0].angular.hDeg === 2.2 && world.horizon[0].fog === 0.55 && world.horizon[0].fogColor === 'fogFar');
  ok('def.horizon is not the SAME array as world.horizon (structuredClone, content not state)',
    assets.world('world_m1').horizon !== world.horizon);

  const base = { terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] };
  ok('no horizon key -> world.horizon = []', World.load(base, assets, {}).horizon.length === 0);

  function throwsWith(def, needle) {
    try { World.load({ ...base, horizon: [def] }, assets, {}); return 'did not throw'; }
    catch (e) { return e.message.includes(needle) ? true : e.message; }
  }
  const good = { id: 'h', model: 'ferrumLights', bearingDeg: 10, elevDeg: 1, angular: { wDeg: 5, hDeg: 2 }, fog: 0.5, fogColor: 'fogFar' };
  ok('missing id throws', throwsWith({ ...good, id: undefined }, '"id" is required') === true);
  ok('duplicate id throws', (() => {
    try { World.load({ ...base, horizon: [good, good] }, assets, {}); return 'did not throw'; }
    catch (e) { return e.message.includes('duplicate id'); }
  })());
  ok('unknown model throws naming the id', throwsWith({ ...good, model: 'noSuchModel' }, 'horizon "h": unknown model') === true);
  ok('non-numeric bearingDeg throws', throwsWith({ ...good, bearingDeg: 'x' }, '"bearingDeg" must be a finite number') === true);
  ok('missing angular throws', throwsWith({ ...good, angular: undefined }, '"angular.wDeg"/"angular.hDeg" are required') === true);
  ok('fog out of [0,1] throws', throwsWith({ ...good, fog: 1.5 }, '"fog" must be in [0, 1]') === true);
  ok('omitting fog does not throw (validated as 0)', (() => {
    try { World.load({ ...base, horizon: [{ ...good, fog: undefined }] }, assets, {}); return true; } catch (e) { return e.message; }
  })() === true);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
