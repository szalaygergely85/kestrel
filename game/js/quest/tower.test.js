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
  World, AssetRegistry, loadLevel, integrate, isSectorPassable, PHYSICS_DEFAULTS,
  validateBehaviours, unregisterBehaviour, stepSectorAnims, packLevel, serialize, deserialize,
} from '../../../engine/index.js';
import { registerQuestBehaviours, QUEST_BEHAVIOURS } from './index.js';
import paletteMod from '../../../design/palette.js';
import towerMod from '../../../design/levels/tower.js';
import testRoomMod from '../../../design/levels/test_room.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import worldMod from '../../../design/levels/world_m1.js';

paletteMod; towerMod; testRoomMod; terrainMod; worldMod; // classic scripts: side effects on globalThis.ASSETS
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);

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
  const end = (d.triggers || []).find((t) => t.id === 'end');
  ok('trigger end: 4 cells, walkTo, pitchTo', end && end.cells.length === 4 && end.walkTo && typeof end.pitchTo === 'number' && end.trigger === 'quest.end');
  const hint = (d.triggers || []).find((t) => t.id === 'hintJump');
  ok('trigger hintJump: type hint, zMin 2.0', hint && hint.type === 'hint' && hint.zMin === 2.0 && hint.trigger === 'hint.show');
  ok('markers.gapEdge present', d.markers && d.markers.gapEdge && typeof d.markers.gapEdge.x === 'number');
  ok('the tower reaches through structures[0]', worldFull.structures[0].level.def === d);
}

// ---------------------------------------------------------------------------
// 3. Behaviour registry wiring.
// ---------------------------------------------------------------------------
{
  ok('validateBehaviours(world) empty after quest/index.js registration', validateBehaviours(worldFull).length === 0, validateBehaviours(worldFull).join(','));
  const names = Object.keys(QUEST_BEHAVIOURS);
  const referenced = new Set([
    ...(towerDef.interactables || []).map((i) => i.interact),
    ...(towerDef.triggers || []).map((t) => t.trigger),
  ]);
  ok('quest/index.js registers exactly the names the tower data references',
    names.length === referenced.size && names.every((n) => referenced.has(n)), `${names} vs ${[...referenced]}`);
  unregisterBehaviour('lever.pull');
  ok('one registration removed -> exactly that name is listed', JSON.stringify(validateBehaviours(worldFull)) === '["lever.pull"]');
  // World.load warns (once, one line) with the same list.
  const warns = [];
  const origWarn = console.warn; console.warn = (m) => warns.push(String(m));
  World.load({ name: 'w', terrain: null, structures: [{ id: 'tower', level: 'tower', origin: placement.origin }], entities: [], state: {} }, assets, {});
  console.warn = origWarn;
  ok('World.load warns once naming the missing behaviour', warns.length === 1 && /lever\.pull/.test(warns[0]), warns.join(' | '));
  registerQuestBehaviours();
  ok('re-registration restores an empty list', validateBehaviours(worldFull).length === 0);
  // The remaining stubs (US-012/US-014 replaced their own bodies; US-022/
  // US-015/US-017 have not landed yet) are callable, return false and log
  // "not implemented" once.
  const logged = [];
  console.warn = (m) => logged.push(String(m));
  const r1 = worldFull.fireInteraction('beacon.light', { def: {} });
  const r2 = worldFull.fireInteraction('beacon.light', { def: {} });
  console.warn = origWarn;
  ok('stub returns false and logs "not implemented" once', r1 === false && r2 === false && logged.length === 1 && /not implemented/.test(logged[0]), logged.join(' | '));
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

  let propSprite = { model: 'lantern', variant: 'unlit' };
  const fakeProp = {
    getComponent: (name) => (name === 'sprite' ? propSprite : undefined),
    setComponent: (name, value) => { if (name === 'sprite') propSprite = value; },
  };
  let actorLight = null;
  const fakeActor = { setComponent: (name, value) => { if (name === 'light') actorLight = value; } };

  const lanternWorld = World.load({
    name: 'tower_lantern_test', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
    entities: [], state: {},
  }, assets, {});

  const r = lanternWorld.fireInteraction('lantern.take', { def: lanternDef, entity: fakeProp, actor: fakeActor });
  ok('lantern.take returns true (consumes the once-flag path)', r === true);
  ok('lantern.take attaches an eye light preset "lantern" to the actor', actorLight && actorLight.preset === 'lantern' && actorLight.on === true && actorLight.attach === 'eye');
  ok('lantern.take swaps the prop sprite to the empty-bracket variant, keeping model', propSprite.variant === 'empty' && propSprite.model === 'lantern');
  ok('lantern.take sets tower.lantern.taken', lanternWorld.state['tower.lantern.taken'] === true);

  // A second E on the same interactable: `updateInteraction` (not exercised
  // here directly - `interaction.test.js` covers the generic `once` gate)
  // finds no target once `world.interactables`' matching `usedKey` is set;
  // this checks the World-built table carries that key at all.
  const rec = lanternWorld.interactables.find((it) => it.id === 'lantern' && it.structId === 'tower');
  ok('World.load built an interactables entry for the lantern with a usedKey (once: true)', !!rec && rec.usedKey === 'used.tower.lantern');
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
  const endCells = cellsWhere((s) => s.tag === 'trigger:end');
  world.state['tower.lantern.taken'] = false;
  const a = reachable([startCell]);
  world.state['tower.lantern.taken'] = true;
  const b = reachable([startCell]);
  ok('no trap: the breach is reachable from the wake pallet (grate open)', breach.length > 0 && breach.every(([x, y]) => a.has(`${x},${y}`)));
  ok('the end trigger cells are reachable from the wake pallet', endCells.length === 4 && endCells.every(([x, y]) => a.has(`${x},${y}`)));
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

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
