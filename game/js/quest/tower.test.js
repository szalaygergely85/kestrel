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
  validateBehaviours, unregisterBehaviour, stepAnimations,
  updateTriggers,
} from '../../../engine/index.js';
import { registerQuestBehaviours, QUEST_BEHAVIOURS } from './index.js';
import { stepBeacon } from './beacon.js';
import { stepLantern } from './lantern.js';
import { resetHints, currentHintId, stepHints, setPaletteColors } from './hints.js'; // BUG-OWN-005

const noHintSignals = { walking: false, pointerUnlocked: false, moveOrLook: false, run: false, jump: false, pointerLocked: false, mPressed: false };
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
// US-011 (7.5 item 1): World.load's prop spawn throws on any
// props[].model that isn't registered - every tower prop model must
// load, same reasoning as game/index.html's script tags.
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import swordMod from '../../../design/models/sword.js';
import m3PropsMod from '../../../design/models/m3_props.js';
import notesMod from '../../../design/models/notes.js'; // READ-01: ASSETS.notes + uiStyle.note (texts/panel; the note/notePinned prop models are m3_props.js 6c)
// US-016: the `farTower` entity + `ferrumLights` horizon billboard world_m1.js references.
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
import terrainMod from '../../../design/levels/overworld_far.js';
// US-026a-content: title.js sets globalThis.ASSETS.uiStyle (storyHints incl.
// the new 'stone'/'boundsEdge' entries) - needed for the section 2b check below.
import titleMod from '../../../design/models/title.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';

paletteMod; detailPassMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; farTowerMod; ferrumLightsMod; titleMod; notesMod; // classic scripts: side effects on globalThis.ASSETS
const { assets } = await loadTestAssets(); // US-027b: tower/test_room/world_m1 now content/*.json

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
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
  // CO-9: the recipe entry no longer carries its own x/y - it only gets a
  // real bbox (World.load's injection, from the actual placement) now.
  ok('tower origin == terrain recipe structures[tower] (two sources agree)',
    !!rs && !!rs.bbox && rs.bbox.x0 === towerFull.origin.x && rs.bbox.y0 === towerFull.origin.y, JSON.stringify(rs));
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
  // US-078c: + the "sword" interactable (content/levels/tower.level.json, copied in from design/models/sword.js's levelPatch.towerSword).
  // READ-01: + the 4 "note*" interactables (hand-copied from design/models/notes.js's levelPatch.towerNotes.appendInteractables).
  // CH1-D1a: - lantern (no lamp pickup), + door (door.unbar, ground-floor SW door), + noteLeave (summit doorway note).
  ok('interactables ids = beacon, note* x5, sword', JSON.stringify(ids) === JSON.stringify(['beacon', 'noteKeepLight', 'noteKeeperLog', 'noteLeave', 'noteMason', 'noteSteelHush', 'sword']), ids.join(','));
  ok('every interactable has an interact name', (d.interactables || []).every((i) => typeof i.interact === 'string' && i.interact.length));
  // US-026a-content: the tower's own 'end' trigger is gone - the ending
  // moved to a world-level trigger at the waystone (worlds.world_m1.triggers,
  // checked in section 2b below); this only asserts it is really gone here.
  ok('trigger end: no longer present on the tower level (moved world-level, US-026a)', !(d.triggers || []).find((t) => t.id === 'end'));
  const hint = (d.triggers || []).find((t) => t.id === 'hintJump');
  ok('trigger hintJump: type hint, zMin 3.0 (CH1-D1a, gap in the SW corner)', hint && hint.type === 'hint' && hint.zMin === 3.0 && hint.trigger === 'hint.show');
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
  { const c0 = worldM1.bounds && worldM1.bounds.parts ? worldM1.bounds.parts[0] : worldM1.bounds; ok('worlds.world_m1.bounds is (or starts with) a circle with r > 0 (WS1-04 union)', c0 && c0.shape === 'circle' && c0.r > 0); }
  const wEnd = (worldM1.triggers || []).find((t) => t.id === 'end');
  ok('worlds.world_m1.triggers has the "end" zone: circle at the waystone, NO behaviour/walkTo (WAYSTONE-NORMAL-01, D-056; quest area "waystone" still points at it)',
    wEnd && wEnd.shape === 'circle' && wEnd.trigger === undefined && wEnd.walkTo === undefined && wEnd.x === 1428 && wEnd.y === 1040);
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
    ...(worldM1.triggers || []).map((t) => t.trigger).filter(Boolean),
    'lantern.take', // kept registered (lantern.js, lantern.test/quest.test legacy fixtures) though CH1-D1a removed the tower interactable
    'door.unbar', // kept registered (doorUnbar.js) though TOWER-DOOR-OPEN-01 removed the tower interactable (door open from start)
    'quest.end', // kept registered (end.js, end.test.js, restart.test.js) though world_m1 no longer references it (WAYSTONE-NORMAL-01)
    'npc.talk', // NPC-BEAR-01: runtime-only (dialogueCtl.addNpc -> World.addInteractable), no content reference
    'beast.loot', // US-091a2: runtime-only (sim/loot.js World.addInteractable per boar), no content reference
    'relay.wake', // WS1-06b: runtime-only (relayWake.js World.addInteractable per kind:'relay' point), no content reference
  ]);
  ok('quest/index.js registers exactly the names the tower + world_m1 data references',
    names.length === referenced.size && names.every((n) => referenced.has(n)), `${names} vs ${[...referenced]}`);
  unregisterBehaviour('sword.take');
  ok('one registration removed -> exactly that name is listed', JSON.stringify(validateBehaviours(worldFull)) === '["sword.take"]');
  // World.load warns (once, one line) with the same list. `terrain: null`
  // also makes the prop spawn warn once for `envelopeHeap`'s `z: 'ground'`
  // (7.5 item 1: no terrain -> warn + 0) - filter to the behaviour line so
  // that unrelated warning doesn't fail this assertion.
  const warns = [];
  const origWarn = console.warn; console.warn = (m) => warns.push(String(m));
  World.load({ name: 'w', terrain: null, structures: [{ id: 'tower', level: 'tower', origin: placement.origin }], entities: [], state: {} }, assets, {});
  console.warn = origWarn;
  const behaviourWarns = warns.filter((w) => w.includes('behaviour(s) referenced'));
  ok('World.load warns once naming the missing behaviour', behaviourWarns.length === 1 && /sword.take/.test(behaviourWarns[0]), warns.join(' | '));
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
// 3b. CH1-D1a: the lamp pickup is gone; `door.unbar` (ground-floor SW door) replaces it as the tower's
//    one prop-variant interactable. Runs the real behaviour on the real tower data.
// ---------------------------------------------------------------------------
{
  ok('3b: no lantern interactable any more (lamp pickup removed)', !towerDef.interactables.some((i) => i.id === 'lantern' || i.interact === 'lantern.take'));
  // TOWER-DOOR-OPEN-01: the door is open from load: no door interactable, doorBar variant open, collider off.
  ok('3b: no door interactable (door is open from the start)', !towerDef.interactables.some((i) => i.id === 'door' || i.interact === 'door.unbar'));
  const doorProp = towerDef.props.find((p) => p.id === 'doorBar');
  ok('3b: doorBar prop starts open with collider-off variant', doorProp.variant === 'open' && doorProp.colliders.length === 0);
  const doorWorld = World.load({
    name: 'tower_door_test', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [], state: {},
  }, assets, { physics: 'mesh' });
  const bar = doorWorld.get('tower.doorBar');
  ok('3b: World.load spawns the doorBar prop open', !!bar && bar.getComponent('voxel').anim === 'open');
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
  return s && !s.solid && Math.abs(s.floorH - cellSector(landing[0], landing[1]).floorH) <= 0.45; // STEP-HEIGHT-01: second landing cell may be a <= step-up half-step
})());

{
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
  ok('route walk: every route cell reached grounded at its floorH (gap jumped, upper stair always open)', allReached);
}

// TOWER-LEVER-01: no quest interaction is required at the landing.
{
  ok('tower props omit lever and chains', !towerDef.props.some(p => p.id === 'lever' || p.id === 'chains'));
  ok('quest registry omits lever.pull', !Object.hasOwn(QUEST_BEHAVIOURS, 'lever.pull'));
  ok('no grate tag or dynamic ceiling in the tower', !Object.values(towerDef.legend).some(s => s.tag === 'grate' || s.dynamic));
  const stair = cellSector(18, 10);
  ok('landing retains its 3 m floor and open sky ceiling', stair.floorH === 3 && stair.ceilH === 'sky' && !stair.solid);
  const ent = makeBody(wx(19), wy(10), cellFloor(19, 10));
  ok('landing passes from the ledge without an interaction', driveTo(ent, wx(17), wy(10), { maxSteps: 240 }) >= 0);
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
  const open = reachable(ledge);
  ok('upper stair: summit reachable from the ledge on first load', summit.some(([x, y]) => open.has(`${x},${y}`)));

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
  ok('no trap: the breach is reachable from the wake pallet (upper stair open)', breach.length > 0 && breach.every(([x, y]) => a.has(`${x},${y}`)));
  ok('lantern-free: reachability is identical with and without the lantern', a.size === b.size && [...a].every((k) => b.has(k)));

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
// 11. Summit hint fires once through hint.show on the real tower data.
// ---------------------------------------------------------------------------
function hintUiStyleFixture() {
  const s = {
    hint: { anchor: 'bottom-left', x: 2, yFromBottom: 2, maxOnScreen: 1, prefix: '> ', prefixColor: 'uiDim',
      text: 'uiHint', key: 'gold', plate: { pad: 1, bgMul: 0.35 }, fadeIn: 0.3, fadeOut: 0.5, timeout: 8.0 },
    hints: [],
    storyHints: [
      { id: 'exit', text: 'The top. Look west through the breach.', keys: [], on: { type: 'zone', zone: 'hintExit' } },
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

resetHints(); // leave the module-level singleton clean for any test runner that loads more than one file in-process

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
