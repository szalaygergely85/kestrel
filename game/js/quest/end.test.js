// game/js/quest/end.test.js (US-026a-S6, architecture.md 23.5). Headless
// Node ESM, no framework. Run: node game/js/quest/end.test.js
//
// Covers the S6 end-wiring behaviour that restart.test.js/tower.test.js
// don't: `questEnd` with `structId == null` treats `walkTo` as an ABSOLUTE
// world coordinate (no structure origin added); `lookAt: '<entityId>'`
// resolves the target's position once, at fire time, into a compass-degree
// `yawTo` (`atan2(ex - x, -(ey - y))`); `stepEnd` eases that yaw on the
// SHORTEST arc, including a wraparound case that crosses 0/360 - and the
// original structure-local path (`structId` set, origin added) still works
// unchanged (regression).
import { questEnd, stepEnd } from './end.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// A no-op "collision": moveCapsule normally clips against geometry, but
// these are unit tests of the yaw/pitch/walk-target MATH, not physics - the
// stub just applies the requested delta, same convention as a free capsule
// in open space (nothing here is near a wall).
function stubMoveCapsule(world, x, y, dx, dy, radius, z, grounded, opts, out) {
  out.x = x + dx; out.y = y + dy;
}

function makeEntity(x, y, yawDeg, pitchDeg) {
  return { transform: { x, y, z: 0, yawDeg, pitchDeg }, components: { body: { radius: 0.3, height: 1.8 } } };
}

// ---------------------------------------------------------------------------
// 1. World-level trigger (structId: null): walkTo is ABSOLUTE - no structure
// origin added, even when a same-named structure exists in world.structures
// (regression guard for the old "always add an origin" bug).
// ---------------------------------------------------------------------------
{
  const world = {
    structures: [{ id: 'tower', origin: { x: 1480, y: 1018, z: 0 } }],
    state: {},
    entity: () => null,
  };
  const entity = makeEntity(1428, 1040, 0, 30);
  const def = { walkTo: { x: 1430, y: 1038 }, pitchTo: 0 }; // no lookAt here
  const fired = questEnd({ world, def, entity, structId: null });
  ok('1a: questEnd returns true', fired === true);
  const ew = entity.components.body._endWalk;
  ok('1b: walk target x is walkTo.x verbatim (no origin add)', near(ew.x0 + ew.dirX * Math.hypot(1430 - 1428, 1038 - 1040), 1430));
  ok('1c: walk target y is walkTo.y verbatim (no origin add)', near(ew.y0 + ew.dirY * Math.hypot(1430 - 1428, 1038 - 1040), 1038));
  ok('1d: quest.endT set to 0', world.state['quest.endT'] === 0);
  ok('1e: no lookAt -> yawTo null (yaw untouched)', ew.yawTo === null);
}

// ---------------------------------------------------------------------------
// 2. lookAt resolves to a compass-degree yaw, computed once at fire time.
// Cardinal checks confirm the formula matches the PlayerLook/transform.yawDeg
// convention (0 = north/-y, 90 = east/+x, 180 = south/+y, 270 = west/-x).
// ---------------------------------------------------------------------------
function yawToCase(name, ex, ey) {
  const world = { structures: [], state: {}, entity: (id) => (id === 'farTower' ? { transform: { x: ex, y: ey } } : null) };
  const entity = makeEntity(0, 0, 0, 0);
  const def = { walkTo: { x: 1, y: 0 }, lookAt: 'farTower', pitchTo: 0 };
  questEnd({ world, def, entity, structId: null });
  return entity.components.body._endWalk.yawTo;
}
ok('2a: target due north (0,-10) -> yawTo 0', near(yawToCase('N', 0, -10), 0));
ok('2b: target due east (10,0) -> yawTo 90', near(yawToCase('E', 10, 0), 90));
ok('2c: target due south (0,10) -> yawTo 180', near(yawToCase('S', 0, 10), 180));
ok('2d: target due west (-10,0) -> yawTo 270', near(yawToCase('W', -10, 0), 270));

// The real content case (23.2/story numbers): stone at (1428, 1040), farTower
// entity at (713.8, 1232.1) - the same geometry world_m1.world.json carries.
// Just proves questEnd resolves world.entity('farTower') and computes a
// finite yaw in range, not a specific hand-computed number (that's what the
// cardinal cases above pin down exactly).
{
  const yawTo = yawToCase('content', 713.8, 1232.1);
  ok('2e: real content geometry gives a finite yawTo in [0,360)', Number.isFinite(yawTo) && yawTo >= 0 && yawTo < 360, String(yawTo));
}

// `lookAt` naming an entity that doesn't resolve (e.g. not spawned) must not
// throw, and yaw simply stays untouched (yawTo null).
{
  const world = { structures: [], state: {}, entity: () => null };
  const entity = makeEntity(0, 0, 45, 0);
  const def = { walkTo: { x: 1, y: 0 }, lookAt: 'nope', pitchTo: 0 };
  questEnd({ world, def, entity, structId: null });
  ok('2f: unresolved lookAt -> yawTo stays null, no throw', entity.components.body._endWalk.yawTo === null);
}

// ---------------------------------------------------------------------------
// 3. stepEnd eases yaw on the SHORTEST arc, including a 0/360 wraparound.
// yaw0 = 350, yawTo = 10: the short way is +20 (via 360 -> 0), not -340.
// At frac 0.5 (ease(0.5) = 0.5, smoothstep is exactly linear at its
// midpoint) the eased yaw must land exactly on the 350/0/10 wrap seam (0),
// and at frac 1 it must land exactly on 10.
// ---------------------------------------------------------------------------
{
  const world = { structures: [], state: {}, entity: (id) => (id === 'farTower' ? { transform: { x: -1, y: 0 } } : null) };
  // Craft a target whose computed yawTo really is 10 deg and set yaw0 = 350
  // directly on the entity's transform (questEnd captures whatever is on
  // the transform at fire time as yaw0 - it doesn't need to match the
  // lookAt geometry, only the wraparound arithmetic below does).
  const entity = makeEntity(0, 0, 350, 0);
  // yawTo 10 deg: ex - x0 = sin(10deg), -(ey - y0) = cos(10deg)
  const rad = 10 * Math.PI / 180;
  const ex = Math.sin(rad), ey = -Math.cos(rad);
  world.entity = (id) => (id === 'farTower' ? { transform: { x: ex, y: ey } } : null);
  const def = { walkTo: { x: 0, y: -0.01 }, lookAt: 'farTower', pitchTo: 0 }; // tiny walk so frac math is easy to reason about
  questEnd({ world, def, entity, structId: null });
  const ew = entity.components.body._endWalk;
  ok('3a: yaw0 captured as 350', near(ew.yaw0, 350));
  ok('3b: yawTo resolves to 10 (within fp tolerance)', near(ew.yawTo, 10, 1e-4), String(ew.yawTo));

  const uiStyle = undefined; // default WALK_SEC = 1.5
  const dt = 1.5 / 2; // two steps of exactly half WALK_SEC each -> frac 0.5 then 1.0
  stepEnd(world, entity, dt, uiStyle, stubMoveCapsule);
  ok('3c: at frac 0.5, yaw wraps through 0 (not decreasing through 180)', near(entity.transform.yawDeg, 0, 1e-3), String(entity.transform.yawDeg));
  stepEnd(world, entity, dt, uiStyle, stubMoveCapsule);
  ok('3d: at frac 1.0, yaw lands exactly on yawTo (10)', near(entity.transform.yawDeg, 10, 1e-3), String(entity.transform.yawDeg));
}

// ---------------------------------------------------------------------------
// 4. Regression: the ORIGINAL structure-local path (`structId` set) still
// adds the structure's origin to `walkTo`, unchanged by the S6 work above.
// ---------------------------------------------------------------------------
{
  const world = {
    structures: [{ id: 'tower', origin: { x: 1480, y: 1018, z: 0 } }],
    state: {},
    entity: () => null,
  };
  const entity = makeEntity(1497, 1027.5, 0, 30); // world coords (inside the tower footprint)
  const def = { walkTo: { x: 15.0, y: 8.0 }, pitchTo: 0 }; // level-local
  questEnd({ world, def, entity, structId: 'tower' });
  const ew = entity.components.body._endWalk;
  const expectX = 1480 + 15.0, expectY = 1018 + 8.0;
  const len = Math.hypot(expectX - 1497, expectY - 1027.5);
  ok('4a: structure-local walkTo still adds the origin', near(ew.x0 + ew.dirX * len, expectX) && near(ew.y0 + ew.dirY * len, expectY));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('ALL PASS');
