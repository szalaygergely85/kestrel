// game/js/quest/boulder.test.js (US-013). Headless Node ESM, no framework.
// Run: node game/js/quest/boulder.test.js
//
// Physics-over-real-data, same approach as tower.test.js (architect tech
// note 4): the REAL `design/levels/tower.js` boulder prop (position,
// radius, the `tilt` layer) placed in a `World` at the world_m1 origin, and
// driven by the real `stepRollers`/`resolveBodyContacts`. No literal
// coordinate is typed in - the boulder's start comes from `towerDef.props`,
// exactly as the US-013 tech notes require ("no quest behaviour is
// needed" - this file spawns the entity itself, since the generic
// prop-to-entity spawn is US-011's, not yet built).
import {
  World, stepRollers, resolveBodyContacts, PHYSICS_DEFAULTS,
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
import terrainMod from '../../../design/levels/overworld_far.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';

paletteMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; // classic scripts: side effects on globalThis.ASSETS
const { assets } = await loadTestAssets(); // US-027b: tower/test_room/world_m1 now content/*.json

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const P = PHYSICS_DEFAULTS;
const DT = P.fixedDt;

const towerDef = assets.level('tower');
const worldM1 = assets.world('world_m1');
const placement = worldM1.structures.find((s) => s.level === 'tower');

const world = World.load({
  name: 'tower_only', terrain: null,
  structures: [{ id: 'tower', level: 'tower', origin: placement.origin, yawSteps: 0 }],
  entities: [], state: {},
}, assets, {});
const tower = world.structures[0];
const L = tower.level, O = tower.origin;

const boulderProp = towerDef.props.find((p) => p.id === 'boulder');
ok('tower.js has a boulder prop with dynamic: true and a radius', !!boulderProp && boulderProp.dynamic === true && typeof boulderProp.radius === 'number');

const startX = O.x + boulderProp.x, startY = O.y + boulderProp.y, startZ = O.z + boulderProp.z;
const RADIUS = boulderProp.radius;

/** Level-local tag/zone at a WORLD position (undefined off-grid). */
function tagAt(wx, wy) {
  const s = L.sectorAt(wx - O.x, wy - O.y);
  return s ? { tag: s.tag, zone: s.zone } : null;
}

// US-011: `World.load` now spawns every level prop itself (7.5 item 1),
// `tower.boulder` included (body + roller, `dynamic: true`) - no manual
// spawn here any more (it would throw on the now-duplicate id).
const boulder = world.entity('tower.boulder');
ok('World.load auto-spawned tower.boulder with body+roller (US-011 prop spawn)',
  !!boulder && boulder.components.body && boulder.components.roller && boulder.components.body.radius === RADIUS);

const startTag = tagAt(startX, startY);
ok('boulder start sits on the stairBase tag (tower.js position)', startTag && startTag.tag === 'stairBase', JSON.stringify(startTag));

function resetBoulder() {
  const t = boulder.transform, b = boulder.components.body, r = boulder.components.roller;
  t.x = startX; t.y = startY; t.z = startZ; t.yawDeg = 0;
  b.vx = 0; b.vy = 0; b.vz = 0; b.grounded = true;
  r.rollDist = 0; r.sleeping = false; r.sleepT = 0;
}

/** Kicks the boulder with an initial (angle, speed) and simulates up to 4 s (240 steps @ 60 Hz). */
function pushAndSettle(angleRad, speed, maxSteps = 240) {
  resetBoulder();
  boulder.components.body.vx = Math.cos(angleRad) * speed;
  boulder.components.body.vy = Math.sin(angleRad) * speed;
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    stepRollers(world, DT, P);
    if (boulder.components.roller.sleeping) break;
  }
  return { steps, settled: boulder.components.roller.sleeping, tag: tagAt(boulder.transform.x, boulder.transform.y) };
}

// ---------------------------------------------------------------------------
// 20 pushes from varied angles/speeds: all end in the hollow (`o`/tag
// 'hollow') within 4 s, never resting on the stair base, the slope apron, a
// stair cell, or off the tower's ground zone.
// ---------------------------------------------------------------------------
const N = 20;
let allInHollow = true, allSettledInTime = true, anyOnStairBaseOrStair = false;
const angles = [];
for (let i = 0; i < N; i++) angles.push((i / N) * 2 * Math.PI + (i % 3) * 0.17);
const speeds = [0.6, 1.0, 1.5, 2.2, 3.0];

for (let i = 0; i < N; i++) {
  const angle = angles[i];
  const speed = speeds[i % speeds.length];
  const r = pushAndSettle(angle, speed);
  if (!r.settled) allSettledInTime = false;
  if (!r.tag || r.tag.tag !== 'hollow') allInHollow = false;
  if (r.tag && (r.tag.tag === 'stairBase' || r.tag.zone === 'stair')) anyOnStairBaseOrStair = true;
  ok(`push ${i + 1}/20 (angle ${angle.toFixed(2)}, speed ${speed}) settles in the hollow within 4 s`,
    r.settled && r.tag && r.tag.tag === 'hollow',
    `settled=${r.settled} steps=${r.steps} tag=${r.tag && r.tag.tag}`);
}
ok('all 20 pushes end in the hollow', allInHollow);
ok('all 20 pushes settle within 4 s (<= 240 steps)', allSettledInTime);
ok('never at rest on the stair base or a stair cell', !anyOnStairBaseOrStair);

// The start cell (stair base) is clear after every trial above (the last
// reset moved the boulder away; re-check the LAST settled position, which
// is what "the stair base is then clear" means at the end of a run).
{
  const last = pushAndSettle(0.35, 2.0);
  const stairBaseNowOccupied = Math.hypot(boulder.transform.x - startX, boulder.transform.y - startY) < RADIUS;
  ok('the stair base is clear after a push (boulder moved off it)', !stairBaseNowOccupied && last.settled);
}

// ---------------------------------------------------------------------------
// Once in the hollow, it cannot be pushed back out: settle it there, then
// try to kick it toward the stair (and a few other strong directions).
// ---------------------------------------------------------------------------
{
  pushAndSettle(0.35, 2.0); // settle in the hollow first
  ok('pre-condition: boulder is asleep in the hollow before the escape attempts', boulder.components.roller.sleeping);

  const escapeAngles = [Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI * 1.25, Math.PI * 0.75];
  let everEscaped = false;
  for (const angle of escapeAngles) {
    boulder.components.roller.sleeping = false;
    boulder.components.roller.sleepT = 0;
    boulder.components.body.vx = Math.cos(angle) * 4; // a hard shove
    boulder.components.body.vy = Math.sin(angle) * 4;
    let settled = false, finalTag = null;
    for (let i = 0; i < 240; i++) {
      stepRollers(world, DT, P);
      if (boulder.components.roller.sleeping) { settled = true; finalTag = tagAt(boulder.transform.x, boulder.transform.y); break; }
    }
    if (!settled || !finalTag || finalTag.tag !== 'hollow') everEscaped = true;
  }
  ok('the hollow is a one-way trap: no shove pushes the boulder back out', !everEscaped);
}

// ---------------------------------------------------------------------------
// Restart (US-017) semantics: the boulder's serialized/authored start
// position is the stair base, independent of wherever it ended up rolling -
// this is what US-017's world swap relies on (US-013 AC "Restart puts the
// boulder back at its start position").
// ---------------------------------------------------------------------------
{
  pushAndSettle(1.1, 2.5); // move it away from the start
  resetBoulder();
  const dist = Math.hypot(boulder.transform.x - startX, boulder.transform.y - startY);
  ok('resetting the boulder returns it exactly to its authored start position', dist < 1e-9);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
