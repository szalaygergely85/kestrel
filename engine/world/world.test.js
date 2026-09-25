// engine/world/world.test.js (US-025). Headless Node ESM, no framework.
// Run: node engine/world/world.test.js
import { World } from './World.js';
import { serialize, deserialize } from './serialize.js';
import { updateTriggers } from './triggers.js';
import paletteMod from '../../design/palette.js';
import terrainDef from '../../design/levels/overworld_far.js';
// US-011 (7.5 item 1): World.load's prop spawn throws on any props[].model
// that isn't registered - every tower prop model must load, same reasoning
// as game/index.html's script tags.
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
// US-041a (15.3 item 1): the real designer voxel def for the lever, used by
// this file's "voxel component binding" test below (globalThis.ASSETS.voxelModels.lever).
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
// US-016: the `farTower` entity + `ferrumLights` horizon billboard world_m1.js references.
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
// US-027b: tower/test_room/world_m1 moved to content/*.json.
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; terrainDef;
lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; voxelPropsMod;
farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();

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

// US-041a (15.3 item 1): `voxel` component binding. `ASSETS.voxelModels.lever`
// (design/models/voxel_props.js) is a REAL designer voxel def, not merged
// into `ASSETS.models.lever` yet (US-056's job - the materials merge/attach
// step) - this test mirrors that merge by hand, on a throwaway copy of the
// shared model object, restored at the end so it can't leak into a later
// check in this same process.
// ---------------------------------------------------------------------------
{
  const leverModel = assets.model('lever');
  const savedVoxel = leverModel.voxel;
  leverModel.voxel = globalThis.ASSETS.voxelModels.lever.voxel;

  // both sprite and voxel on one entity -> World.spawn throws.
  let threw = false;
  try {
    world.spawn('prop', { x: 0, y: 0, z: 0 },
      { sprite: { model: 'lever', anim: 'idle' }, voxel: { model: 'lever', anim: 'idle' } }, 'voxtest_both');
  } catch (e) { threw = true; }
  ok('World.spawn throws when an entity has both sprite and voxel components', threw);

  const h = world.spawn('prop', { x: 10, y: 10, z: 0, yawDeg: 90, pitchDeg: 0 }, { voxel: { model: 'lever', anim: 'idle' } }, 'voxtest1');
  const vc = h.getComponent('voxel');
  ok('components.voxel gets the same default shape as sprite (t/frame/speed/playing)',
    vc.t === 0 && vc.frame === 0 && vc.speed === 1 && vc.playing === true, JSON.stringify(vc));

  // "spawn picks voxel when registry.model(key).voxel exists" (architect
  // delta, 15.3 item 1) - no level edit: reload world_m1 as-is and the SAME
  // 'lever' prop now spawns as a voxel entity instead of a sprite one.
  const worldVoxel = World.load(assets.world('world_m1'), assets, {});
  const leverH = worldVoxel.get('tower.lever');
  ok('prop spawn picks components.voxel when model.voxel exists (no level edit)',
    !!leverH.getComponent('voxel') && !leverH.getComponent('sprite'));
  ok('voxel anim resolves the level\'s string variant ("idle") exactly like a sprite would',
    leverH.getComponent('voxel').anim === 'idle');

  // serialize -> deserialize round trip (US-011 7.5 item 7's own rule,
  // extended to voxel): same entity set, voxel component state intact, and
  // serializing the round-tripped world again is byte-for-byte the same
  // (deep-equals via JSON - every field here is already JSON-safe).
  const state = serialize(worldVoxel);
  const world2 = deserialize(state, assets, {});
  const leverH2 = world2.get('tower.lever');
  ok('deserialize keeps the voxel component (model/anim) intact',
    leverH2 && leverH2.getComponent('voxel') && leverH2.getComponent('voxel').model === 'lever' && leverH2.getComponent('voxel').anim === 'idle');
  ok('serialize(deserialize(state)) deep-equals state (round trip is stable)',
    JSON.stringify(serialize(world2)) === JSON.stringify(state));

  leverModel.voxel = savedVoxel;
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

// ---------------------------------------------------------------------------
// US-026a (architecture.md 23.1/23.2/23.3, 23.7 S2): near band baked in
// World.load, outsideSector terrain fields, world.bounds, world-level
// triggers (3 shapes), z:'ground' world entities, bounds/triggers round trip.
// ---------------------------------------------------------------------------
{
  // `world` (top of file) is the real world_m1 - already has terrain,
  // bounds and the waystone endMarker/triggers from content.
  ok('World.load bakes the near band before returning (nearReady)', world.terrain.nearReady === true);

  // -- outsideSector terrain fields (23.3) --
  const outsideX = world.terrain.recipe.tower.x, outsideY = world.terrain.recipe.tower.y - 60; // well clear of the tower footprint
  const outSec = world.outsideSector(outsideX, outsideY);
  ok('outsideSector sets terrain:true off the near band', outSec.terrain === true);
  const nlen = Math.hypot(outSec.nx, outSec.ny, outSec.nz);
  ok('outsideSector normal (nx,ny,nz) is a unit vector', Math.abs(nlen - 1) < 1e-6, `len=${nlen}`);
  ok('outsideSector floorH == terrain.groundAt', outSec.floorH === world.terrain.groundAt(outsideX, outsideY));

  // -- world.bounds loaded from content, exactly (23.2) --
  ok('world.bounds loaded from content', !!world.bounds && world.bounds.shape === 'circle');
  const boundsDef = assets.world('world_m1').bounds;
  ok('world.bounds matches content bounds', world.bounds.x === boundsDef.x && world.bounds.y === boundsDef.y && world.bounds.r === boundsDef.r);

  // -- validateBounds throws on a bad shape/field (mirrors validateHorizon's convention) --
  const baseNoTerrain = { terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 } }], entities: [] };
  function boundsThrows(bounds) {
    try { World.load({ ...baseNoTerrain, bounds }, assets, {}); return false; } catch (e) { return true; }
  }
  ok('bounds: unknown shape throws', boundsThrows({ shape: 'square', x: 0, y: 0, r: 5 }));
  ok('bounds: non-finite x throws', boundsThrows({ shape: 'circle', x: NaN, y: 0, r: 5 }));
  ok('bounds: r <= 0 throws', boundsThrows({ shape: 'circle', x: 0, y: 0, r: 0 }));
  ok('no bounds key -> world.bounds = null (unbounded, every world before this story)', World.load(baseNoTerrain, assets, {}).bounds === null);

  // -- world-level triggers: 3 shapes, structId: null (23.2/23.5) --
  const worldTriggers = world.triggers.filter((t) => t.structId === null);
  ok('world_m1 has the 3 content world-level triggers', worldTriggers.length === 3, worldTriggers.map((t) => t.id).join(','));
  const endRec = worldTriggers.find((t) => t.id === 'end');
  const hintStoneRec = worldTriggers.find((t) => t.id === 'hintStone');
  const boundsEdgeRec = worldTriggers.find((t) => t.id === 'boundsEdge');
  ok('"end" is a world-level circle trigger, absolute coords (no origin add)', endRec && endRec.shape === 'circle' && endRec.key === 'world.end' && endRec.x === 1428 && endRec.y === 1040);
  ok('"hintStone" is a world-level terrain-shape trigger', !!hintStoneRec && hintStoneRec.shape === 'terrain');
  ok('"boundsEdge" is a world-level bounds-shape trigger', !!boundsEdgeRec && boundsEdgeRec.shape === 'bounds');

  // -- firing behaviour per shape (updateTriggers, fresh worlds so `inside`
  // starts clean; firing is tracked by DEF OBJECT IDENTITY, not by the
  // fired behaviour name - `hintStone` and `boundsEdge` both name
  // "hint.show", same as several of the tower's own level triggers, so a
  // name-only check could false-positive on an unrelated real trigger) --
  {
    const w2 = World.load(assets.world('world_m1'), assets, {});
    const contentTriggers = assets.world('world_m1').triggers;
    const endDef = contentTriggers.find((t) => t.id === 'end');
    const hintStoneDef = contentTriggers.find((t) => t.id === 'hintStone');
    const boundsEdgeDef = contentTriggers.find((t) => t.id === 'boundsEdge');
    const fired = [];
    w2.fireTrigger = (name, ctx) => { fired.push(ctx.def); return true; };
    // Start INSIDE the tower (the only place no world-level trigger with an
    // unconditional/"first terrain contact" shape can have already fired) -
    // the waystone/edge points below are themselves "outside every
    // structure", so `hintStone` ('terrain' shape) must be checked before
    // the actor ever steps outside for the first time.
    const actor = { transform: { x: 1490, y: 1020, z: 0 }, components: { body: { radius: 0.3 } } };

    // 'terrain' shape: inside the tower footprint -> no fire (not terrain); step outside -> fires.
    updateTriggers(w2, {}, actor);
    ok('"terrain" shape does not fire while inside the tower footprint', !fired.includes(hintStoneDef));
    actor.transform.x = 1470; actor.transform.y = 1020; // well outside every structure, first terrain contact
    updateTriggers(w2, {}, actor);
    ok('"terrain" shape fires on first terrain contact (outside every structure)', fired.includes(hintStoneDef));

    // circle 'end': fires standing at the waystone.
    fired.length = 0;
    actor.transform.x = 1428; actor.transform.y = 1040;
    updateTriggers(w2, {}, actor);
    ok('circle "end" fires standing at the waystone', fired.includes(endDef));

    // 'bounds' shape: well inside the circle -> no fire; at/past the edge -> fires.
    fired.length = 0;
    const b = w2.bounds;
    actor.transform.x = b.x; actor.transform.y = b.y; // dead centre
    updateTriggers(w2, {}, actor);
    ok('"bounds" shape does not fire near the centre', !fired.includes(boundsEdgeDef));
    actor.transform.x = b.x + b.r; // right on the edge
    updateTriggers(w2, {}, actor);
    ok('"bounds" shape fires at the walk-bound edge', fired.includes(boundsEdgeDef));
  }

  // -- z:'ground' world entity (endMarker/waystone) resolves through terrain.groundAt (23.2) --
  const endMarker = world.get('endMarker');
  ok('endMarker world entity spawned', !!endMarker);
  ok('endMarker z resolves through terrain.groundAt (z:"ground")', endMarker.data.transform.z === world.terrain.groundAt(1428, 1040));

  // -- serialize/deserialize round-trips bounds/triggers (content, not state) --
  {
    const state = serialize(world);
    ok('serialize writes world.bounds', state.bounds && state.bounds.x === world.bounds.x && state.bounds.r === world.bounds.r);
    ok('serialize writes world.triggers (the world-level trigger DEFS)', Array.isArray(state.triggers) && state.triggers.length === 3);

    const world2 = deserialize(state, assets, {});
    ok('deserialize restores world.bounds', world2.bounds && world2.bounds.x === world.bounds.x && world2.bounds.r === world.bounds.r);
    const world2Triggers = world2.triggers.filter((t) => t.structId === null);
    ok('deserialize rebuilds the same 3 world-level triggers', world2Triggers.length === 3, world2Triggers.map((t) => t.id).join(','));
    ok('deserialize re-bakes the near band', world2.terrain.nearReady === true);
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
