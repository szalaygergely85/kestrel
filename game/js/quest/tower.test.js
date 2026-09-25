// game/js/quest/tower.test.js (US-010). Headless Node ESM, no framework.
// Run: node game/js/quest/tower.test.js
//
// Playability of the tower = physics tests, not manual play (architect tech
// note 4): the REAL `design/levels/tower.js` placed in a `World` with
// `terrain: null` at the world_m1 origin, driven by the real `integrate()`
// and `isSectorPassable`. Every coordinate below is derived from the level/
// world data (route, legend tags/zones, props, origin) - nothing is typed
// in, per the "no literal coordinate under game/js/quest/" rule.
import {
  World, loadLevel, integrate, isSectorPassable, PHYSICS_DEFAULTS,
  validateBehaviours, unregisterBehaviour, stepSectorAnims, packLevel, serialize, deserialize, stepAnimations,
  updateTriggers,
} from '../../../engine/index.js';
import { registerQuestBehaviours, QUEST_BEHAVIOURS } from './index.js';
import { stepBeacon } from './beacon.js';
import { stepLantern } from './lantern.js';
import { resetHints, currentHintId, stepHints, setPaletteColors } from './hints.js'; // BUG-OWN-005

const noHintSignals = { walking: false, pointerUnlocked: false, moveOrLook: false, run: false, jump: false, pointerLocked: false, mPressed: false };
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
// US-026a-content: title.js sets globalThis.ASSETS.uiStyle (storyHints incl.
// the new 'stone'/'boundsEdge' entries) - needed for the section 2b check below.
import titleMod from '../../../design/models/title.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';

paletteMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; farTowerMod; ferrumLightsMod; titleMod; // classic scripts: side effects on globalThis.ASSETS
const { assets } = await loadTestAssets(); // US-027b: tower/test_room/world_m1 now content/*.json

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
// US-014 helpers (generic over any `Level`, unlike section 7's `cellsWhere`/`cellSector` which close over the shared `L`).
function cellsForZoneWhere(level, pred) {
  const out = [];
  for (let cy = 0; cy < level.height; cy++) {
    for (let cx = 0; cx < level.width; cx++) {
      const s = level.sectorAt(cx + 0.5, cy + 0.5);
      if (s && pred(s)) out.push([cx, cy]);
    }
  }
  return out;
}
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
const packLevelFresh = (level) => packLevel(level, null);

const P = PHYSICS_DEFAULTS;
const DT = P.fixedDt;
const OPTS = { height: P.height, stepUpMax: P.stepUpMax };
const JUMP_H = (P.jumpSpeed * P.jumpSpeed) / (2 * P.gravity);

const towerDef = assets.level('tower');
const worldM1 = assets.world('world_m1');
const placement = worldM1.structures.find((s) => s.level === 'tower');

// ---------------------------------------------------------------------------
// 1. Loading: single source, no errors, placed at the recipe coordinates.
// ---------------------------------------------------------------------------
{
  const errs = [];
  const orig = console.error; console.error = (m) => errs.push(String(m));
  const lvl = loadLevel(towerDef);
  console.error = orig;
  ok('loadLevel(towerDef) returns a Level', !!lvl);
  ok('loadLevel(towerDef) logs no errors', errs.length === 0, errs.join('\n'));
}

const worldFull = World.load(worldM1, assets, {});
const towerFull = worldFull.structures.find((s) => s.id === 'tower');
{
  const rs = assets.terrain(worldM1.terrain).structures.find((s) => s.id === 'tower');
  ok('World.load(world_m1) places the tower', !!towerFull);
  ok('tower origin == world_m1 placement', towerFull.origin.x === placement.origin.x && towerFull.origin.y === placement.origin.y && towerFull.origin.z === (placement.origin.z || 0));
  ok('tower origin == terrain recipe structures[tower] (two sources agree)',
    !!rs && rs.x === towerFull.origin.x && rs.y === towerFull.origin.y, JSON.stringify(rs));
  const st = towerFull.level.start, o = towerFull.origin;
  const pallet = towerDef.props.find((p) => p.id === 'pallet');
  ok('floorAt(wake start in world coords) == the wake pallet floor', near(worldFull.floorAt(st.x + o.x, st.y + o.y), pallet.z + o.z));
  const player = worldFull.get('player');
  ok('player spawned at start + origin', player && near(player.data.transform.x, st.x + o.x) && near(player.data.transform.y, st.y + o.y));
  ok('level.def is the raw content object (single source, no copy)', towerFull.level.def === towerDef);
}
{
  const bare = World.load({
    name: 'adhoc_test_room', terrain: null,
    structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }],
    entities: [{ id: 'player', type: 'player', spawn: { structure: 'test_room', from: 'start' } }], state: {},
  }, assets, {});
  ok('?level=test_room equivalent (bare world, no terrain) still loads', bare.structures.length === 1 && !!bare.get('player'));
  ok('bare world: outside the grid is solid', bare.outsideSector(-1, -1).solid === true);
}

// ---------------------------------------------------------------------------
// 2. Extension fields reachable through level.def.
// ---------------------------------------------------------------------------
{
  const d = towerFull.level.def;
  for (const k of ['props', 'lights', 'interactables', 'triggers', 'markers']) ok(`def.${k} present`, Array.isArray(d[k]) || (d[k] && typeof d[k] === 'object'));
  ok('def.layers.tilt present, same grid size', Array.isArray(d.layers && d.layers.tilt) && d.layers.tilt.length === towerFull.level.height);
  const ids = (d.interactables || []).map((i) => i.id).sort();
  ok('interactables ids = beacon, lantern, lever', JSON.stringify(ids) === JSON.stringify(['beacon', 'lantern', 'lever']), ids.join(','));
  ok('every interactable has an interact name', (d.interactables || []).every((i) => typeof i.interact === 'string' && i.interact.length));
  // US-026a-content: the tower's own 'end' trigger is gone - the ending
  // moved to a world-level trigger at the waystone (worlds.world_m1.triggers,
  // checked in section 2b below); this only asserts it is really gone here.
  ok('trigger end: no longer present on the tower level (moved world-level, US-026a)', !(d.triggers || []).find((t) => t.id === 'end'));
  const hint = (d.triggers || []).find((t) => t.id === 'hintJump');
  ok('trigger hintJump: type hint, zMin 2.0', hint && hint.type === 'hint' && hint.zMin === 2.0 && hint.trigger === 'hint.show');
  ok('markers.gapEdge present', d.markers && d.markers.gapEdge && typeof d.markers.gapEdge.x === 'number');
  ok('the tower reaches through structures[0]', worldFull.structures[0].level.def === d);
}

// ---------------------------------------------------------------------------
// 2b. US-026a-content: world_m1's new world-level `bounds`/`triggers` data
//    (content/worlds/world_m1.world.json, copied verbatim from design/models/
//    voxel_world.js ASSETS.worldPatch.world_m1). This is a DATA check only -
//    `World.load`/`buildTriggers` don't read `def.bounds`/`def.triggers` yet
//    (that's PC-A's US-026a-engine S1-S6); a live "walk in and it fires" test
//    is out of scope until that lands.
// ---------------------------------------------------------------------------
{
  ok('worlds.world_m1.bounds is a circle with r > 0', worldM1.bounds && worldM1.bounds.shape === 'circle' && worldM1.bounds.r > 0);
  const wEnd = (worldM1.triggers || []).find((t) => t.id === 'end');
  ok('worlds.world_m1.triggers has the moved end trigger: circle, quest.end, walkTo, lookAt, pitchTo',
    wEnd && wEnd.shape === 'circle' && wEnd.trigger === 'quest.end' && wEnd.walkTo && typeof wEnd.pitchTo === 'number' && typeof wEnd.lookAt === 'string');
  const wHintStone = (worldM1.triggers || []).find((t) => t.id === 'hintStone');
  const wBoundsEdge = (worldM1.triggers || []).find((t) => t.id === 'boundsEdge');
  ok('worlds.world_m1.triggers has hintStone (shape terrain, hint.show)', wHintStone && wHintStone.shape === 'terrain' && wHintStone.trigger === 'hint.show' && wHintStone.hint === 'stone');
  ok('worlds.world_m1.triggers has boundsEdge (shape bounds, hint.show)', wBoundsEdge && wBoundsEdge.shape === 'bounds' && wBoundsEdge.trigger === 'hint.show' && wBoundsEdge.hint === 'boundsEdge');
  const endMarker = (worldM1.entities || []).find((e) => e.id === 'endMarker');
  ok('worlds.world_m1.entities has the endMarker prop, model waystone', endMarker && endMarker.type === 'prop' && endMarker.components && endMarker.components.voxel && endMarker.components.voxel.model === 'waystone');
  ok('the "stone"/"boundsEdge" hint ids referenced by world triggers exist in uiStyle.storyHints (design/models/title.js)',
    assets.uiStyle && (assets.uiStyle.storyHints || []).some((h) => h.id === 'stone') && (assets.uiStyle.storyHints || []).some((h) => h.id === 'boundsEdge'));
}

// ---------------------------------------------------------------------------
// 3. Behaviour registry wiring.
// ---------------------------------------------------------------------------
{
  ok('validateBehaviours(world) empty after quest/index.js registration', validateBehaviours(worldFull).length === 0, validateBehaviours(worldFull).join(','));
  const names = Object.keys(QUEST_BEHAVIOURS);
  // US-026a-content: 'quest.end' moved off the tower's own triggers[] onto
  // worlds.world_m1.triggers[] (the waystone) - include it here too, or this
  // check would wrongly flag 'quest.end' as an unreferenced registration.
  const referenced = new Set([
    ...(towerDef.interactables || []).map((i) => i.interact),
    ...(towerDef.triggers || []).map((t) => t.trigger),
    ...(worldM1.triggers || []).map((t) => t.trigger),
  ]);
  ok('quest/index.js registers exactly the names the tower + world_m1 data references',
    names.length === referenced.size && names.every((n) => referenced.has(n)), `${names} vs ${[...referenced]}`);
  unregisterBehaviour('lever.pull');
  ok('one registration removed -> exactly that name is listed', JSON.stringify(validateBehaviours(worldFull)) === '["lever.pull"]');
  // World.load warns (once, one line) with the same list. `terrain: null`
  // also makes the prop spawn warn once for `envelopeHeap`'s `z: 'ground'`
  // (7.5 item 1: no terrain -> warn + 0) - filter to the behaviour line so
  // that unrelated warning doesn't fail this assertion.
  const warns = [];
  const origWarn = console.warn; console.warn = (m) => warns.push(String(m));
  World.load({ name: 'w', terrain: null, structures: [{ id: 'tower', level: 'tower', origin: placement.origin }], entities: [], state: {} }, assets, {});
  console.warn = origWarn;
  const behaviourWarns = warns.filter((w) => w.includes('behaviour(s) referenced'));
  ok('World.load warns once naming the missing behaviour', behaviourWarns.length === 1 && /lever\.pull/.test(behaviourWarns[0]), warns.join(' | '));
  registerQuestBehaviours();
  ok('re-registration restores an empty list', validateBehaviours(worldFull).length === 0);
  // Every name QUEST_BEHAVIOURS lists now has a real body (US-012/US-014/
  // US-015/US-017/US-022) - the "callable stub logs not implemented once"
  // case is exercised generically by `engine/core/behaviours.js`'s own
  // tests, nothing tower-specific is left un-implemented to probe here.
  const stillStub = Object.keys(QUEST_BEHAVIOURS).filter((n) => {
    const logged = [];
    const orig = console.warn; console.warn = (m) => logged.push(String(m));
    const r = worldFull.fireInteraction(n, { def: {} });
    console.warn = orig;
    return r === false && logged.some((m) => /not implemented/.test(m));
  });
  ok('no quest behaviour is still a stub', stillStub.length === 0, stillStub.join(','));
}

// ---------------------------------------------------------------------------
// 3b. US-012: `lantern.take` behaviour body on the real tower data. As with
//    the lever (section 8 below), `entity`/`actor` are stub handle-shaped
//    objects here - real prop entities come from US-011 (tech note 5).
// ---------------------------------------------------------------------------
{
  const lanternDef = towerDef.interactables.find((i) => i.id === 'lantern');
  ok('lantern interactable prompt is "[E] Take lamp" (D-011 reskin)', lanternDef.prompt === '[E] Take lamp', lanternDef.prompt);
  ok('lantern interactable data: once, interact lantern.take', lanternDef.once === true && lanternDef.interact === 'lantern.take');

  let actorLight = null;
  const fakeActor = { setComponent: (name, value) => { if (name === 'light') actorLight = value; } };

  const lanternWorld = World.load({
    name: 'tower_lantern_test', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [], state: {},
  }, assets, {});

  // US-011 (7.5 item 1/tech note 5): `World.load` auto-spawns the real
  // lantern prop entity now - use it instead of a hand-rolled fake.
  // OWN-REQ-006: default anim is now 'lit' (was 'unlit') - the lamp hangs lit by default.
  const lanternProp = lanternWorld.get('tower.lantern');
  ok('World.load auto-spawns the real lantern prop entity', !!lanternProp && lanternProp.getComponent('sprite').model === 'lantern' && lanternProp.getComponent('sprite').anim === 'lit');

  // OWN-REQ-006: the flame prop and the hook light both start present/on.
  const flameProp = lanternWorld.get('tower.lampFlame');
  ok('World.load auto-spawns the lampFlame prop (OWN-REQ-006)', !!flameProp && flameProp.getComponent('sprite').model === 'lampFlame');
  const hookLightDef = towerDef.lights.find((l) => l.id === 'lanternHook');
  ok('the lanternHook light starts on in level data (OWN-REQ-006)', hookLightDef && hookLightDef.on === true && hookLightDef.preset === 'lanternHook');
  ok('lantern interactable data: light "lanternHook", flameProp "lampFlame" (OWN-REQ-006)',
    lanternDef.light === 'lanternHook' && lanternDef.flameProp === 'lampFlame');

  const r = lanternWorld.fireInteraction('lantern.take', { def: lanternDef, entity: lanternProp, actor: fakeActor });
  ok('lantern.take returns true (consumes the once-flag path)', r === true);
  ok('lantern.take attaches an eye light preset "lantern" to the actor', actorLight && actorLight.preset === 'lantern' && actorLight.on === true && actorLight.attach === 'eye');
  const propSprite = lanternProp.getComponent('sprite');
  // US-011 (7.5 item 2): `lantern.take` -> `entity.play('empty')` - assert
  // `sprite.anim`, the field the engine actually renders (not `variant`,
  // which is still written alongside it for readability).
  ok('lantern.take plays the empty-bracket animation, keeping model', propSprite.anim === 'empty' && propSprite.model === 'lantern');
  ok('lantern.take sets tower.lantern.taken', lanternWorld.state['tower.lantern.taken'] === true);

  // OWN-REQ-006: the flame prop is removed immediately (same call, no gap frame) and the
  // hook-light-off key is queued for `stepLantern` (the runtime LightSet is out of this ctx's reach).
  ok('lantern.take removes the lampFlame prop entity', lanternWorld.get('tower.lampFlame') === null);
  ok('lantern.take queues the hook light key for stepLantern', lanternWorld.state['tower.lantern.hookLightOff'] === 'tower.lanternHook');

  const fakeLanternLights = {
    key: ['tower.lanternHook'], count: 1, on: new Uint8Array([1]),
    setOn(h, on) { this.on[h] = on ? 1 : 0; },
  };
  stepLantern(lanternWorld, fakeLanternLights);
  ok('stepLantern switches the hook light off', fakeLanternLights.on[0] === 0);
  ok('stepLantern clears its own state key once done', lanternWorld.state['tower.lantern.hookLightOff'] == null);

  // A repeat call (e.g. a stray extra fixed step) is a cheap no-op, never throws, never re-toggles.
  fakeLanternLights.on[0] = 1;
  stepLantern(lanternWorld, fakeLanternLights);
  ok('stepLantern is a no-op once its key is cleared', fakeLanternLights.on[0] === 1);

  // A second E on the same interactable: `updateInteraction` (not exercised
  // here directly - `interaction.test.js` covers the generic `once` gate)
  // finds no target once `world.interactables`' matching `usedKey` is set;
  // this checks the World-built table carries that key at all.
  const rec = lanternWorld.interactables.find((it) => it.id === 'lantern' && it.structId === 'tower');
  ok('World.load built an interactables entry for the lantern with a usedKey (once: true)', !!rec && rec.usedKey === 'used.tower.lantern');
}

// ---------------------------------------------------------------------------
// 3c. US-022: `beacon.light` behaviour body + `stepBeacon`'s per-step ramp,
//    on the real tower data (D-011 reskin: "wake the relay"). As with the
//    lantern above, the real World.load-spawned relay prop entity is used
//    (US-011 tech note 5). `stepBeacon`'s `lights` arg only needs the
//    public surface it actually reads/writes (`key`/`count`/`baseIntensity`/
//    `on`/`setOn`), so a small fake stands in for the real `LightSet` class.
// ---------------------------------------------------------------------------
{
  const beaconDef = towerDef.interactables.find((i) => i.id === 'beacon');
  ok('beacon interactable prompt is "[E] Wake the relay" (D-011 reskin)', beaconDef.prompt === '[E] Wake the relay', beaconDef.prompt);
  ok('beacon interactable data: once, requires the quest-state key lantern.js writes, light id "beacon"',
    beaconDef.once === true && beaconDef.requires === 'tower.lantern.taken' && beaconDef.interact === 'beacon.light' && beaconDef.light === 'beacon');

  const beaconWorld = World.load({
    name: 'tower_beacon_test', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [], state: {},
  }, assets, {});

  const relayProp = beaconWorld.get('tower.beaconBowl');
  ok('World.load auto-spawns the real relay prop entity, dead', !!relayProp && relayProp.getComponent('sprite').model === 'relay' && relayProp.getComponent('sprite').anim === 'dead');

  const relayLightDef = towerDef.lights.find((l) => l.id === 'beacon');
  ok('the relay light starts off in level data (US-022 wakes it)', relayLightDef && relayLightDef.on === false && relayLightDef.preset === 'relay');

  const r = beaconWorld.fireInteraction('beacon.light', { def: beaconDef, entity: relayProp });
  ok('beacon.light returns true (consumes the once-flag path)', r === true);
  ok('beacon.light plays the wake clip', relayProp.getComponent('sprite').anim === 'wake');
  ok('beacon.light sets tower.beacon.lit (US-017 end-card altWhen key)', beaconWorld.state['tower.beacon.lit'] === true);
  ok('beacon.light derives structId "tower" from the prop id, no hard-coded string', beaconWorld.state['tower.beacon.structId'] === 'tower');
  ok('beacon.light records the light id from def.light', beaconWorld.state['tower.beacon.lightId'] === 'beacon');

  const rec = beaconWorld.interactables.find((it) => it.id === 'beacon' && it.structId === 'tower');
  ok('World.load built an interactables entry for the beacon with a usedKey (once: true)', !!rec && rec.usedKey === 'used.tower.beacon');

  const fakeLights = {
    key: ['tower.beacon'], count: 1, baseIntensity: new Float32Array(1), on: new Uint8Array(1),
    setOn(h, on) { this.on[h] = on ? 1 : 0; },
  };
  const palette = assets.palette;
  const relayModel = assets.model('relay');
  const wakeAnim = relayModel.animations.wake;
  const startT = relayModel.wakeLightFrame / wakeAnim.fps; // when the point light itself starts (not press time)
  const growDur = palette.lights[towerDef.lights.find((l) => l.id === 'beacon').preset].grow.duration;
  const targetIntensity = palette.lights[towerDef.lights.find((l) => l.id === 'beacon').preset].intensity;

  beaconWorld.state['tower.beacon.wakeT'] = startT / 2;
  stepBeacon(beaconWorld, fakeLights, 0, palette);
  ok('stepBeacon: light stays off before wakeLightFrame', fakeLights.on[0] === 0);

  beaconWorld.state['tower.beacon.wakeT'] = startT + growDur / 2;
  stepBeacon(beaconWorld, fakeLights, 0, palette);
  ok('stepBeacon: light on, intensity partway through its own 1.0 s grow', fakeLights.on[0] === 1
    && fakeLights.baseIntensity[0] > 0 && fakeLights.baseIntensity[0] < targetIntensity, fakeLights.baseIntensity[0]);

  beaconWorld.state['tower.beacon.wakeT'] = startT + growDur + 1;
  stepBeacon(beaconWorld, fakeLights, 0, palette);
  ok('stepBeacon: intensity ramps to (and clamps at) the relay preset value, never the legacy orange beacon preset',
    near(fakeLights.baseIntensity[0], targetIntensity), `${fakeLights.baseIntensity[0]} vs ${targetIntensity}`);

  // wake -> awake once the (non-looping) wake clip ends - frame count/fps
  // come from the real model data, not a literal.
  const frameMs = 1000 / wakeAnim.fps;
  for (let i = 0; i < wakeAnim.frames.length; i++) stepAnimations(beaconWorld, frameMs);
  ok('the wake clip finished (non-looping, holds its last frame)', relayProp.getComponent('sprite').playing === false);
  stepBeacon(beaconWorld, fakeLights, 0, palette);
  ok('stepBeacon switches wake -> awake once the clip ends', relayProp.getComponent('sprite').anim === 'awake');
}

// ---------------------------------------------------------------------------
// Physics harness over the real tower, terrain: null.
// ---------------------------------------------------------------------------
const world = World.load({
  name: 'tower_only', terrain: null,
  structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
  entities: [], state: {},
}, assets, {});
const tower = world.structures[0];
const L = tower.level, O = tower.origin;
const cellSector = (cx, cy) => L.sectorAt(cx + 0.5, cy + 0.5);
const cellFloor = (cx, cy) => cellSector(cx, cy).floorH + O.z;
const wx = (cx) => O.x + cx + 0.5, wy = (cy) => O.y + cy + 0.5;

function makeBody(x, y, z, grounded = true) {
  return {
    id: 'probe', type: 'player',
    transform: { x, y, z, yawDeg: 0, pitchDeg: 0 },
    components: { body: { radius: P.radius, height: P.height, eyeH: P.eyeHeight, vx: 0, vy: 0, vz: 0, grounded, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: z } },
  };
}
const controls = { forward: 0, strafe: 0, run: false, jump: false, yawDeg: 0, pitchDeg: 0 };
function step(ent, forward, run, jump, yawDeg) {
  controls.forward = forward; controls.run = run; controls.jump = jump; controls.yawDeg = yawDeg;
  integrate(ent, DT, controls, world, P);
}
const yawToward = (dx, dy) => Math.atan2(dx, -dy) * 180 / Math.PI; // compass: 0 = north (-y), 90 = east (+x)
const finite = (t) => Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z);

/**
 * Drives the body toward a world point at walking speed (proportional slow-
 * down inside 0.3 m). `jumpAt` = {axis, edge, dir}: hold Space from 0.25 m
 * before that take-off edge until the next landing. Returns steps used or -1.
 */
function driveTo(ent, tx, ty, { run = false, jumpAt = null, maxSteps = 900 } = {}) {
  const t = ent.transform, b = ent.components.body;
  let holdJump = false;
  for (let i = 0; i < maxSteps; i++) {
    const dx = tx - t.x, dy = ty - t.y, dist = Math.hypot(dx, dy);
    const floorH = world.floorAt(t.x, t.y);
    if (dist < 0.1 && b.grounded && Math.abs(t.z - floorH) < 0.01) return i;
    if (jumpAt && b.grounded) {
      const pos = jumpAt.axis === 'x' ? t.x : t.y;
      const toEdge = (jumpAt.edge - pos) * jumpAt.dir;
      if (toEdge <= 0.25 && toEdge > -0.5) holdJump = true;
    }
    step(ent, Math.min(1, dist / 0.3), run, holdJump, yawToward(dx, dy));
    if (holdJump && b.landed) holdJump = false;
    if (!finite(t)) return -1;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// 4. Route walk: every route cell reached grounded, each stair step <= stepUpMax.
// ---------------------------------------------------------------------------
const route = towerDef.route;
const landingKey = Object.keys(towerDef.routeNotes).find((k) => /jumped/.test(towerDef.routeNotes[k]));
const landingIdx = route.findIndex(([x, y]) => `${x},${y}` === landingKey);
ok('route has a "jumped" landing note', landingIdx > 0);
const takeoff = route[landingIdx - 1], landing = route[landingIdx];
const jumpAxis = takeoff[0] === landing[0] ? 'y' : 'x';
const jumpDir = Math.sign((jumpAxis === 'x' ? landing[0] - takeoff[0] : landing[1] - takeoff[1]));
const gapCell = jumpAxis === 'x' ? [takeoff[0] + jumpDir, takeoff[1]] : [takeoff[0], takeoff[1] + jumpDir];
const takeoffEdge = (jumpAxis === 'x' ? O.x + takeoff[0] : O.y + takeoff[1]) + (jumpDir > 0 ? 1 : 0);
const jumpAt = { axis: jumpAxis, edge: takeoffEdge, dir: jumpDir };
ok('the gap is exactly one cell wide', Math.abs(landing[0] - takeoff[0]) + Math.abs(landing[1] - takeoff[1]) === 2);
ok('the landing is at least 2 cells deep (PO note)', (() => {
  const beyond = jumpAxis === 'x' ? [landing[0] + jumpDir, landing[1]] : [landing[0], landing[1] + jumpDir];
  const s = cellSector(beyond[0], beyond[1]);
  return s && !s.solid && near(s.floorH, cellSector(landing[0], landing[1]).floorH);
})());

{
  world.animateSector('grate', 1); // the lever (US-014) opens it in play; the route test opens it directly
  const ent = makeBody(wx(route[0][0]), wy(route[0][1]), cellFloor(route[0][0], route[0][1]));
  let allReached = true, allRises = true;
  for (let i = 1; i < route.length; i++) {
    const [cx, cy] = route[i];
    const isJump = i === landingIdx;
    const rise = cellFloor(cx, cy) - cellFloor(route[i - 1][0], route[i - 1][1]);
    if (!isJump && rise > P.stepUpMax + 1e-9) { allRises = false; failures.push(`route step ${i} rises ${rise}`); }
    const steps = driveTo(ent, wx(cx), wy(cy), { jumpAt: isJump ? jumpAt : null });
    const t = ent.transform;
    const good = steps >= 0 && ent.components.body.grounded && Math.abs(t.z - cellFloor(cx, cy)) < 0.01;
    if (!good) { allReached = false; failures.push(`route cell ${i} (${cx},${cy}) not reached: steps=${steps} at (${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)})`); }
  }
  ok('every stair step on the route rises <= stepUpMax', allRises);
  ok('route walk: every route cell reached grounded at its floorH (gap jumped, grate open)', allReached);
  world.animateSector('grate', 0);
}

// Grate closed: the route cannot pass the grate cell.
{
  const gIdx = route.findIndex(([x, y]) => (cellSector(x, y).tag === 'grate'));
  ok('the route passes through the grate cell', gIdx > 0);
  const before = route[gIdx - 1], g = route[gIdx];
  const ent = makeBody(wx(before[0]), wy(before[1]), cellFloor(before[0], before[1]));
  const steps = driveTo(ent, wx(g[0]), wy(g[1]), { maxSteps: 240 });
  ok('grate closed: driving into the grate cell is blocked', steps === -1 && Math.abs(ent.transform.x - wx(g[0])) > 0.5);
}

// ---------------------------------------------------------------------------
// 5. The gap: no Space -> falls (walk and run); Space at the edge -> lands.
// ---------------------------------------------------------------------------
{
  const startCell = route[landingIdx - 3]; // three cells before the landing, on the stair
  const takeoffH = cellFloor(takeoff[0], takeoff[1]);
  const landingH = cellFloor(landing[0], landing[1]);
  const gapH = cellFloor(gapCell[0], gapCell[1]);
  for (const run of [false, true]) {
    const ent = makeBody(wx(startCell[0]), wy(startCell[1]), cellFloor(startCell[0], startCell[1]));
    const yaw = yawToward(landing[0] - startCell[0], landing[1] - startCell[1]);
    let nan = false;
    for (let i = 0; i < 240; i++) { step(ent, 1, run, false, yaw); if (!finite(ent.transform)) { nan = true; break; } }
    const t = ent.transform, b = ent.components.body;
    ok(`${run ? 'run' : 'walk'} across the gap without Space: ends below the take-off (${takeoffH})`, !nan && t.z < takeoffH - 1e-6 && b.grounded, `z=${t.z} grounded=${b.grounded}`);
    ok(`${run ? 'run' : 'walk'} without Space: lands on the debris pile`, !nan && near(t.z, gapH), `z=${t.z}`);
  }
  for (const run of [false, true]) {
    const ent = makeBody(wx(startCell[0]), wy(startCell[1]), cellFloor(startCell[0], startCell[1]));
    const steps = driveTo(ent, wx(landing[0]), wy(landing[1]), { run, jumpAt });
    const t = ent.transform;
    ok(`${run ? 'run' : 'walk'} + Space at the edge: lands on the ledge at ${landingH}`, steps >= 0 && near(t.z, landingH), `steps=${steps} z=${t.z}`);
  }
}

// ---------------------------------------------------------------------------
// 6. Falls: dropping off any stair/ledge/upper cell into a lower neighbour
//    lands grounded on that neighbour's floor, no NaN, no trap.
// ---------------------------------------------------------------------------
{
  const DROP_ZONES = new Set(['stair', 'ledge', 'upper']);
  let drops = 0, bad = 0;
  for (let cy = 0; cy < L.height; cy++) {
    for (let cx = 0; cx < L.width; cx++) {
      const s = cellSector(cx, cy);
      if (!s || s.solid || !DROP_ZONES.has(s.zone)) continue;
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        const n = cellSector(nx, ny);
        if (!n || n.solid || n.floorH >= s.floorH - P.stepUpMax) continue;
        drops++;
        const ent = makeBody(wx(nx), wy(ny), s.floorH + O.z, false);
        let landed = false;
        for (let i = 0; i < 600 && !landed; i++) { step(ent, 0, false, false, 0); landed = ent.components.body.grounded; if (!finite(ent.transform)) break; }
        const t = ent.transform;
        if (!(landed && finite(t) && near(t.z, n.floorH + O.z))) { bad++; failures.push(`drop from (${cx},${cy}) ${s.floorH} into (${nx},${ny}) ${n.floorH}: landed=${landed} z=${t.z}`); }
      }
    }
  }
  ok(`falls: ${drops} drop edges checked, all land grounded on the neighbour floor`, drops > 10 && bad === 0);
}

// ---------------------------------------------------------------------------
// 7. Reachability BFS over isSectorPassable (walk <= stepUpMax, jump <= JUMP_H, 1-cell gaps).
// ---------------------------------------------------------------------------
function canEnter(from, to, jump) {
  if (!to || to.solid) return false;
  if (isSectorPassable(to, from.floorH, true, OPTS)) return true;
  if (!jump) return false;
  const zTop = Math.min(from.floorH + JUMP_H, from.ceilH === 'sky' ? Infinity : from.ceilH - P.height);
  return to.floorH <= zTop + 1e-9 && isSectorPassable(to, to.floorH, true, OPTS);
}
function reachable(startCells) {
  const seen = new Set(), queue = [];
  for (const [x, y] of startCells) { seen.add(`${x},${y}`); queue.push([x, y]); }
  while (queue.length) {
    const [x, y] = queue.shift();
    const from = cellSector(x, y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n1 = [x + dx, y + dy], n2 = [x + 2 * dx, y + 2 * dy];
      const s1 = cellSector(n1[0], n1[1]);
      if (canEnter(from, s1, true) && !seen.has(`${n1}`)) { seen.add(`${n1}`); queue.push(n1); }
      // one-cell gap: fly over n1 (not solid, headroom at the landing height) onto n2
      const s2 = cellSector(n2[0], n2[1]);
      if (s1 && !s1.solid && s2 && (s1.ceilH === 'sky' || s1.ceilH >= s2.floorH + P.height) &&
          canEnter(from, s2, true) && !seen.has(`${n2}`)) { seen.add(`${n2}`); queue.push(n2); }
    }
  }
  return seen;
}
const cellsWhere = (pred) => {
  const out = [];
  for (let cy = 0; cy < L.height; cy++) for (let cx = 0; cx < L.width; cx++) { const s = cellSector(cx, cy); if (s && pred(s)) out.push([cx, cy]); }
  return out;
};
{
  const ledge = cellsWhere((s) => s.zone === 'ledge');
  const summit = cellsWhere((s) => s.zone === 'summit');
  ok('ledge and summit cells exist', ledge.length >= 4 && summit.length > 0);
  world.animateSector('grate', 0);
  const closed = reachable(ledge);
  ok('grate closed: no summit cell is reachable from the ledge', summit.every(([x, y]) => !closed.has(`${x},${y}`)),
    summit.filter(([x, y]) => closed.has(`${x},${y}`)).join(' '));
  world.animateSector('grate', 1);
  const open = reachable(ledge);
  ok('grate open: the summit is reachable from the ledge', summit.some(([x, y]) => open.has(`${x},${y}`)));

  // Whole slice: pallet -> breach, structurally lantern-free (the BFS has no lantern input;
  // toggling the world's lantern state changes nothing).
  const st = L.start;
  const startCell = [Math.floor(st.x), Math.floor(st.y)];
  const breach = cellsWhere((s) => s.tag === 'breach');
  // US-026a-content: the outcrop past the breach (legend X/Y) no longer
  // carries a "trigger:end" tag (the ending moved world-level, to the
  // waystone) - only the breach reachability check remains here.
  world.state['tower.lantern.taken'] = false;
  const a = reachable([startCell]);
  world.state['tower.lantern.taken'] = true;
  const b = reachable([startCell]);
  ok('no trap: the breach is reachable from the wake pallet (grate open)', breach.length > 0 && breach.every(([x, y]) => a.has(`${x},${y}`)));
  ok('lantern-free: reachability is identical with and without the lantern', a.size === b.size && [...a].every((k) => b.has(k)));
  world.animateSector('grate', 0);
  const c = reachable([startCell]);
  ok('grate closed: the ledge IS reachable from the pallet (the gap jump works) but the summit is not',
    ledge.every(([x, y]) => c.has(`${x},${y}`)) && summit.every(([x, y]) => !c.has(`${x},${y}`)));
}

// ---------------------------------------------------------------------------
// 8. US-014: `lever.pull` behaviour body on the real tower data. The
//    interaction system itself (US-012, `findInteractTarget`/
//    `updateInteraction`) doesn't exist yet, so this calls
//    `world.fireInteraction('lever.pull', ctx)` directly, the same way
//    `updateInteraction` will once US-012 lands - the "no second target"
//    (used-flag/prompt-hiding) part of the story is generic `once` handling
//    that lives in `updateInteraction`, so it isn't tested here.
// ---------------------------------------------------------------------------
{
  const leverWorld = World.load({
    name: 'tower_lever_test', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [], state: { 'tower.lever.pulled': false },
  }, assets, {});
  const leverStruct = leverWorld.structures[0];
  const leverDef = towerDef.interactables.find((i) => i.id === 'lever');
  ok('lever interactable data: once, target.tag = grate', leverDef.once === true && leverDef.target && leverDef.target.tag === 'grate');

  const grateCell = cellsForZoneWhere(leverStruct.level, (s) => s.tag === 'grate')[0];
  const grateSector = () => leverStruct.level.sectorAt(grateCell[0] + 0.5, grateCell[1] + 0.5);
  const clearance = () => grateSector().ceilH - grateSector().floorH;
  ok('grate starts closed (no clearance)', clearance() < 1.70);

  let played = null;
  const fakeEntity = { play(anim) { played = anim; } };
  const r = leverWorld.fireInteraction('lever.pull', { def: leverDef, entity: fakeEntity, actor: leverWorld.get('player') });
  ok('lever.pull returns true (consumes the once-flag path)', r === true);
  ok('lever.pull plays the "pull" clip on the prop entity', played === 'pull');
  ok('lever.pull sets tower.lever.pulled', leverWorld.state['tower.lever.pulled'] === true);
  ok('lever.pull does not move the grate immediately (0.4 s delay)', clearance() < 1.70);

  const dt = PHYSICS_DEFAULTS.fixedDt;
  for (let i = 0; i < 10; i++) stepSectorAnims(leverWorld, dt); // well inside the 0.4 s delay (24 steps @ 60 Hz)
  ok('mid-delay, the grate has not started moving yet', clearance() < 1.70);
  for (let i = 0; i < 200; i++) stepSectorAnims(leverWorld, dt); // generous margin past delay(0.4s)+openTime(1.5s) = 114 steps
  ok('grate fully open: clearance >= 1.70 m (passable)', clearance() >= 1.70);
  ok('grate fully open: isSectorPassable is true at the grate cell', isSectorPassable(grateSector(), grateSector().floorH, true, OPTS));
  ok('dynamics.grate landed exactly on target 1', leverStruct.dynamics.grate.t === 1 && leverStruct.dynamics.grate.target === 1);

  // A second call while already-open re-targets (no-op geometrically) - not
  // part of the AC (that's the `once` flag, US-012), just checked so this
  // behaviour body never throws on a repeat call.
  played = null;
  const r2 = leverWorld.fireInteraction('lever.pull', { def: leverDef, entity: fakeEntity, actor: leverWorld.get('player') });
  ok('a second lever.pull call does not throw and still returns true', r2 === true && played === 'pull');
}

// ---------------------------------------------------------------------------
// 8b. US-011 (7.5 item 7): the animation player over the REAL lever prop -
//    `lever.pull` -> `sprite.anim === 'pull'`, held on frame 4 (5 frames at
//    12.5 fps = 0.4 s, `loop: false`) once `stepAnimations` has run 0.4 s.
// ---------------------------------------------------------------------------
{
  const leverWorld2 = World.load({
    name: 'tower_lever_anim_test', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [], state: {},
  }, assets, {});
  const leverDef2 = towerDef.interactables.find((i) => i.id === 'lever');
  const leverProp = leverWorld2.get('tower.lever');
  ok('World.load auto-spawns the real lever prop, initial anim "idle" (variant, was legacy pose "up")',
    !!leverProp && leverProp.getComponent('sprite').anim === 'idle', leverProp && JSON.stringify(leverProp.getComponent('sprite')));

  leverWorld2.fireInteraction('lever.pull', { def: leverDef2, entity: leverProp, actor: leverWorld2.get('player') });
  ok('lever.pull (real entity) sets sprite.anim to "pull"', leverProp.getComponent('sprite').anim === 'pull');

  const dt2 = PHYSICS_DEFAULTS.fixedDt;
  for (let i = 0; i < 24; i++) stepAnimations(leverWorld2, dt2 * 1000); // 24 steps @ 60 Hz = 0.4 s
  const s2 = leverProp.getComponent('sprite');
  ok('after 0.4 s the pull clip holds on frame 4, not playing', s2.anim === 'pull' && s2.frame === 4 && s2.playing === false, JSON.stringify(s2));
}

// ---------------------------------------------------------------------------
// 9. Determinism: `serialize`/`deserialize` mid-open resumes and finishes
//    bit-identical to an uninterrupted run (US-014 tech note 6).
// ---------------------------------------------------------------------------
{
  const dt = PHYSICS_DEFAULTS.fixedDt;
  const runA = World.load({
    name: 'tower_lever_determinism', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [], state: {},
  }, assets, {});
  runA.animateSectorTo('grate', 1, { delay: 0.4 });
  for (let i = 0; i < 40; i++) stepSectorAnims(runA, dt); // stop mid-open (16 steps into the 90-step tween)

  const saved = JSON.parse(JSON.stringify(serialize(runA)));
  const runB = deserialize(saved, assets, {});
  const gA = runA.structures[0], gB = runB.structures[0];
  ok('save mid-open: dynamics.grate.t/target/delay round-trip exactly',
    gB.dynamics.grate.t === gA.dynamics.grate.t && gB.dynamics.grate.target === gA.dynamics.grate.target && gB.dynamics.grate.delay === gA.dynamics.grate.delay,
    JSON.stringify(gB.dynamics.grate) + ' vs ' + JSON.stringify(gA.dynamics.grate));

  for (let i = 0; i < 150; i++) { stepSectorAnims(runA, dt); stepSectorAnims(runB, dt); } // generous margin: finish both the same way
  const cellG = cellsForZoneWhere(gA.level, (s) => s.tag === 'grate')[0];
  const secA = gA.level.sectorAt(cellG[0] + 0.5, cellG[1] + 0.5);
  const secB = gB.level.sectorAt(cellG[0] + 0.5, cellG[1] + 0.5);
  ok('resumed run finishes bit-identical to the uninterrupted run (ceilH)', secA.ceilH === secB.ceilH, `${secA.ceilH} vs ${secB.ceilH}`);
  ok('resumed run: packed geom/flags/relief equal a fresh packLevel of the mutated level', (() => {
    const fresh = packLevelFresh(gB.level);
    return arraysEqual(gB.packed.geom, fresh.geom) && arraysEqual(gB.packed.flags, fresh.flags) && arraysEqual(gB.packed.relief, fresh.relief);
  })());
}

// ---------------------------------------------------------------------------
// 10. US-015 hint zones (docs/architecture.md 7.6 item 9): both zones
//    present in the real `design/levels/tower.js` triggers[] (copied by
//    hand from `title.js` levelPatch.towerHints), the wake spawn is outside
//    hintBurner, the lamp is inside it, and the two circles never overlap.
// ---------------------------------------------------------------------------
{
  const trBurner = towerDef.triggers.find((t) => t.id === 'hintBurner');
  const trClimb = towerDef.triggers.find((t) => t.id === 'hintClimb');
  ok('hintBurner trigger present, circle, hint.show', !!trBurner && trBurner.shape === 'circle' && trBurner.trigger === 'hint.show');
  ok('hintClimb trigger present, circle, hint.show', !!trClimb && trClimb.shape === 'circle' && trClimb.trigger === 'hint.show');

  const spawn = towerDef.start;
  const dSpawnBurner = Math.hypot(spawn.x - trBurner.x, spawn.y - trBurner.y);
  ok('spawn is outside hintBurner', dSpawnBurner > trBurner.r, `d=${dSpawnBurner} r=${trBurner.r}`);

  const lantern = towerDef.props.find((p) => p.id === 'lantern');
  const dLampBurner = Math.hypot(lantern.x - trBurner.x, lantern.y - trBurner.y);
  ok('the lamp is inside hintBurner', dLampBurner <= trBurner.r, `d=${dLampBurner} r=${trBurner.r}`);

  const dCentres = Math.hypot(trBurner.x - trClimb.x, trBurner.y - trClimb.y);
  ok('hintBurner and hintClimb never overlap', dCentres > trBurner.r + trClimb.r, `d=${dCentres} sumR=${trBurner.r + trClimb.r}`);
}

// ---------------------------------------------------------------------------
// 11. BUG-OWN-005 (docs/backlog.md row 25j): the lever-pull hint ('grate')
//    and the summit hint ('exit') both fire, once, through the real quest
//    behaviours (hint.show / lever.pull), on the real tower data.
// ---------------------------------------------------------------------------
function hintUiStyleFixture() {
  const s = {
    hint: { anchor: 'bottom-left', x: 2, yFromBottom: 2, maxOnScreen: 1, prefix: '> ', prefixColor: 'uiDim',
      text: 'uiHint', key: 'gold', plate: { pad: 1, bgMul: 0.35 }, fadeIn: 0.3, fadeOut: 0.5, timeout: 8.0 },
    hints: [],
    storyHints: [
      { id: 'grate', text: 'Something rattles above.', keys: [], on: { type: 'event', event: 'lever.pull' } },
      { id: 'exit', text: 'Out there. Step through the breach.', keys: [], on: { type: 'zone', zone: 'hintExit' } },
    ],
  };
  setPaletteColors(s, { uiDim: '#6a6a78', uiHint: '#a9a390', gold: '#ffd24a' });
  return s;
}

{
  // ---- 11a: hintExit trigger data - geometry (doorway + breach marker inside, summit-only zMin) ----
  const trExit = towerDef.triggers.find((t) => t.id === 'hintExit');
  ok('hintExit trigger present, circle, hint.show, hint id "exit"',
    !!trExit && trExit.shape === 'circle' && trExit.trigger === 'hint.show' && trExit.hint === 'exit');
  ok('hintExit has a summit-only zMin (>= the 6.0 summit floorH, minus float slop)', trExit.zMin >= 5.8 && trExit.zMin <= 6.0);

  const doorway = { x: 11.5, y: 7.5 }; // route's first summit cell (11, 7), centred
  const dDoorway = Math.hypot(doorway.x - trExit.x, doorway.y - trExit.y);
  ok('hintExit covers the summit doorway', dDoorway <= trExit.r, `d=${dDoorway} r=${trExit.r}`);
  ok('hintExit is centred on markers.breach', trExit.x === towerDef.markers.breach.x && trExit.y === towerDef.markers.breach.y);

  // US-026a-content: the "hintExit reaches the end-trigger walk target too"
  // check that used to live here no longer applies - `quest.end`'s trigger
  // moved off the tower level entirely, onto worlds.world_m1.triggers (the
  // waystone, outside the tower, in world coordinates - see section 2b
  // above), so it can no longer be compared against a tower-local circle
  // like this. Whether hintExit still fires before the (now much farther)
  // ending is a live-play property that needs PC-A's world-level-trigger +
  // terrain-band engine work (US-026a-engine S1-S6), not testable in Node yet.
}

{
  // ---- 11b: hintExit actually fires (once) through updateTriggers + hint.show on a real World ----
  const uiStyle = hintUiStyleFixture();
  const exitWorld = World.load({
    name: 'tower_hintExit_test', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [{ id: 'player', type: 'player', spawn: { structure: 'tower', from: 'start' } }], state: {},
  }, assets, {});
  const trExit = towerDef.triggers.find((t) => t.id === 'hintExit');
  const player = exitWorld.get('player');
  const fakeEngine = { assets: { uiStyle } };

  resetHints();
  // Below zMin (ground floor): must not fire even inside the circle's x/y.
  player.data.transform.x = placement.origin.x + trExit.x;
  player.data.transform.y = placement.origin.y + trExit.y;
  player.data.transform.z = placement.origin.z; // ground level, well under zMin
  updateTriggers(exitWorld, fakeEngine, player.data);
  ok('below summit height: hintExit does not fire', !(exitWorld.state['hints.shown'] || []).includes('exit'));

  // Walk up to summit height, inside the circle: fires once (request() only
  // queues it - stepHints is what pops the queue into `hints.shown`/current,
  // same as the real per-frame main.js order).
  player.data.transform.z = placement.origin.z + 6.0;
  updateTriggers(exitWorld, fakeEngine, player.data);
  stepHints(exitWorld, uiStyle, 0.001, noHintSignals);
  ok('at summit height inside the circle: hintExit fires ("exit" shown or currently up)',
    (exitWorld.state['hints.shown'] || []).includes('exit') || currentHintId() === 'exit');

  // Leaving and re-entering does not re-fire (once + used flag).
  player.data.transform.z = placement.origin.z; // step back down
  updateTriggers(exitWorld, fakeEngine, player.data);
  player.data.transform.z = placement.origin.z + 6.0; // and back up
  const beforeShown = [...exitWorld.state['hints.shown']];
  updateTriggers(exitWorld, fakeEngine, player.data);
  stepHints(exitWorld, uiStyle, 0.001, noHintSignals);
  ok('re-entering hintExit does not fire it a second time', JSON.stringify(exitWorld.state['hints.shown']) === JSON.stringify(beforeShown));
}

{
  // ---- 11c: pulling the real lever requests the 'grate' hint (once, no zone - the interaction is the trigger) ----
  const uiStyle = hintUiStyleFixture();
  const leverWorld = World.load({
    name: 'tower_lever_hint_test', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [], state: {},
  }, assets, {});
  const leverDef = towerDef.interactables.find((i) => i.id === 'lever');
  const fakeEntity = { play() {} };
  const fakeEngine = { assets: { uiStyle } };

  resetHints();
  ok('sanity: "grate" not queued/shown before the pull', currentHintId() !== 'grate');
  leverWorld.fireInteraction('lever.pull', { engine: fakeEngine, def: leverDef, entity: fakeEntity, actor: leverWorld.get('player') });
  stepHints(leverWorld, uiStyle, 0.001, noHintSignals);
  ok('"grate" is requested right on the pull (hints.shown or currently showing)',
    (leverWorld.state['hints.shown'] || []).includes('grate') || currentHintId() === 'grate');

  // No engine.assets on the ctx (e.g. the older headless callers, restart.test.js item 2) must stay a no-op, not throw.
  resetHints();
  const leverWorld2 = World.load({
    name: 'tower_lever_hint_test2', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [], state: {},
  }, assets, {});
  const r = leverWorld2.fireInteraction('lever.pull', { def: leverDef, entity: fakeEntity, actor: leverWorld2.get('player') });
  ok('lever.pull without engine.assets does not throw and still returns true', r === true);
}
resetHints(); // leave the module-level singleton clean for any test runner that loads more than one file in-process

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
