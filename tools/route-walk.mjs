#!/usr/bin/env node
// tools/route-walk.mjs (ME-12 phase-2 gate, AC 1-3, 6). Headless Node, no browser.
//   node tools/route-walk.mjs [--json]
// Walks the M1 route on the REAL world_m1 twice - `physics: 'grid'` and `physics: 'mesh'` - with the same
// scripted seek-walker inputs the game's step order uses (stepSectorAnims, integrate, stepRollers,
// stepAnimations, resolveBodyContacts, updateTriggers) and prints, per leg: completed y/n, stuck waypoint,
// fall-through (z below world.floorAt), end position grid vs mesh, max trace difference, and that no roller
// entity survives (TOWER-BOULDER-01 removed the tower boulder).
// The upper stair is permanently open. Rendering is irrelevant to physics, so this
// is valid for both `?renderer=` values. Physics is renderer-independent JS; GPU numbers need the browser.
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import {
  World, serialize, deserialize, PHYSICS_DEFAULTS, integrate, stepRollers, resolveBodyContacts, stepAnimations, stepSectorAnims, updateTriggers,
} from '../engine/index.js';
import paletteMod from '../design/palette.js';
import detailPassMod from '../design/detail-pass.js';
import terrainDef from '../design/levels/overworld_far.js';
import lanternMod from '../design/models/lantern.js';
import leverMod from '../design/models/lever.js';
import voxelPropsMod from '../design/models/voxel_props.js';
import boulderMod from '../design/models/boulder.js';
import rubbleMod from '../design/models/rubble.js';
import wreckageMod from '../design/models/wreckage.js';
import relayMod from '../design/models/relay.js';
import swordMod from '../design/models/sword.js';
import m3PropsMod from '../design/models/m3_props.js';
import farTowerMod from '../design/models/far_tower.js';
import ferrumLightsMod from '../design/models/ferrum_lights.js';
import titleMod from '../design/models/title.js';
import voxelWorldMod from '../design/models/voxel_world.js';
import { moveCircleMesh, Events } from '../engine/dev.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { registerQuestBehaviours } from '../game/js/quest/index.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; terrainDef; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod;
detailPassMod; swordMod; m3PropsMod;
farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod;
const { assets } = await loadTestAssets();
registerQuestBehaviours();

const P = PHYSICS_DEFAULTS;
const DT = P.fixedDt;
const O = { x: 1480, y: 1018 }; // tower origin (world_m1)
const W = ([x, y]) => ({ x: O.x + x + 0.5, y: O.y + y + 0.5 }); // route entries are CELL indices: aim at cell centres
const WAYSTONE = { x: 1428, y: 1040 };
const RELAY = { x: 1262, y: 1033 }; // ws_roadBend (38.36)
const TERRAIN_NEAR = { x: 1470, y: 1029 };
const MAX_WP_STEPS = 600; // 4 s per waypoint before it counts as stuck

function makePlayer(x, y, z) {
  return {
    id: 'probe', type: 'player',
    transform: { x, y, z, yawDeg: 0, pitchDeg: 0 },
    components: { body: { radius: P.radius, height: P.height, eyeH: P.eyeHeight, vx: 0, vy: 0, vz: 0,
      grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: z } },
  };
}

function setup(physics) {
  const world = World.load(assets.world('world_m1'), assets, { physics, events: new Events() });
  const player = makePlayer(O.x + 17, O.y + 9.5, 0);
  const sim = { physics, world, player, controls: { forward: 0, strafe: 0, run: true, jump: false, yawDeg: 0 }, ms: [], step: 0 };
  return sim;
}

function stepOnce(sim) {
  const { world, player, controls } = sim;
  const t0 = performance.now();
  stepSectorAnims(world, DT);
  integrate(player, DT, controls, world, P);
  stepRollers(world, DT, P);
  stepAnimations(world, DT * 1000);
  resolveBodyContacts(world, player, P);
  sim.ms.push(performance.now() - t0);
  updateTriggers(world, {}, player);
  if (sim.stream) world.streamBand(player.transform.x, player.transform.y, 2); // WS2-07
  sim.step++;
}

const yawTo = (fx, fy, tx, ty) => Math.atan2(tx - fx, -(ty - fy)) * 180 / Math.PI;

/** Walks through waypoints [{x,y,jump?}]; returns the leg record. `trace` collects x,y,z per step. */
function runLeg(sim, name, wps, { expectBlocked = false, detour = false, maxWpSteps = MAX_WP_STEPS } = {}) {
  const { world, player, controls } = sim;
  const tr = player.transform;
  const rec = { name, steps: 0, completed: true, stuckAt: null, fell: false, minGap: Infinity, maxFall: 0, trace: [] };
  let jumpLeft = 0;
  for (let i = 0; i < wps.length; i++) {
    const wp = wps[i];
    let n = 0, best = Infinity, bestAt = 0, bias = 0, biasLeft = 0, tries = 0;
    for (;; n++) {
      const dx = wp.x - tr.x, dy = wp.y - tr.y, dist = Math.hypot(dx, dy);
      if (dist < 0.4) break;
      if (n >= maxWpSteps) { rec.completed = false; rec.stuckAt = { wp: i, x: tr.x, y: tr.y, z: tr.z }; break; }
      // `detour` (hillside only): after 60 steps without progress steer +-50/100 deg off the line for 45 steps (slope slide-offs).
      if (detour) {
        if (dist < best - 0.3) { best = dist; bestAt = n; }
        if (biasLeft <= 0 && n - bestAt > 60) { tries++; bias = (tries % 2 ? 1 : -1) * 50 * Math.ceil(tries / 2); biasLeft = 45; bestAt = n; }
        if (biasLeft > 0) biasLeft--; else bias = 0;
      }
      controls.yawDeg = yawTo(tr.x, tr.y, wp.x, wp.y) + bias;
      controls.forward = 1; controls.run = true;
      if (wp.jump && dist < 2 && jumpLeft <= 0 && n > 0) jumpLeft = 6;
      controls.jump = jumpLeft > 0; if (jumpLeft > 0) jumpLeft--;
      stepOnce(sim);
      rec.steps++;
      const fl = world.floorAt(tr.x, tr.y);
      if (fl != null) { rec.minGap = Math.min(rec.minGap, tr.z - fl); if (tr.z < fl - 0.25) rec.fell = true; }
      rec.maxFall = Math.max(rec.maxFall, player.components.body.fallDistance || 0);
      rec.trace.push(tr.x, tr.y, tr.z);
    }
    if (!rec.completed) break;
  }
  controls.forward = 0; controls.jump = false;
  if (expectBlocked) rec.completed = !rec.completed; // blocked = pass
  rec.end = { x: tr.x, y: tr.y, z: tr.z };
  return rec;
}

function idle(sim, steps, rec) {
  sim.controls.forward = 0; sim.controls.jump = false;
  for (let i = 0; i < steps; i++) { stepOnce(sim); if (rec) rec.trace.push(sim.player.transform.x, sim.player.transform.y, sim.player.transform.z); }
}

/** TOWER-BOULDER-01: the tower no longer authors a `dynamic` prop, so no roller entity may exist. */
function anyRoller(w) { let f = null; w.forEachEntity((e) => { if (e.components && e.components.roller) f = e; }); return f; }
const upperStairOpen = (sim) => sim.world.structures[0].level.sectorAt(18.5, 10.5).ceilH === 'sky';

function routeRun(physics, { reload = false } = {}) {
  const sim = setup(physics);
  const legs = [];
  const info = {};
  // 1 wake: settle on the pallet, then walk out to the room.
  let r = { name: '1 wake', steps: 0, completed: true, trace: [], fell: false, minGap: Infinity };
  idle(sim, 120, r); r.end = { ...sim.player.transform }; info.wakeZ = sim.player.transform.z;
  const r1b = runLeg(sim, '1 wake (walk out)', [W([17, 8])]); r.trace.push(...r1b.trace); r.steps += r1b.steps; r.completed = r1b.completed; r.stuckAt = r1b.stuckAt; r.fell = r1b.fell; r.minGap = r1b.minGap; r.end = r1b.end;
  legs.push(r);
  // PROP-COLLIDE-01b: PC-A approved the eastern wake -> burner -> stair corridor; the gondola stays solid.
  // 2 stair base: walk that corridor to the open stair entrance. TOWER-BOULDER-01 removed the roller boulder
  // (its sphere physics moved it, but the voxel model never rotated, so it slid), so there is nothing to push
  // and no settle wait - the leg is the corridor + open-entrance regression it always also carried.
  r = runLeg(sim, '2 stair base (east corridor)', [W([17, 7]), W([18, 7]), W([17, 7]), W([16, 6]), W([16, 5]), W([15, 5]), W([15, 3])]);
  info.stairBaseClear = !anyRoller(sim.world);
  r.end = { ...sim.player.transform }; legs.push(r);
  // 3 stairs: base -> top of the lower flight and the step before the gap.
  const stairs = [[16, 3], [17, 3], [18, 3], [19, 3], [19, 4], [20, 4], [20, 5], [20, 6], [20, 7], [20, 8]].map(W);
  legs.push(runLeg(sim, '3 stairs (to step 9)', stairs));
  // 4 ledge (CH1-D1a: no jump here any more; the gap moved to the SW corner, leg 5b).
  legs.push(runLeg(sim, '4 ledge', [W([20, 9]), W([19, 9])]));
  // TOWER-LEVER-01: pass the landing and upper flight without an interaction.
  info.upperStairOpen = upperStairOpen(sim);
  info.leverAbsent = !sim.world.get('tower.lever') && !sim.world.interactables.some(r => r.id === 'lever');
  legs.push(runLeg(sim, '5a open landing', [W([19, 10]), W([18, 10])]));
  legs.push(runLeg(sim, '5b upper steps + gap jump (SW)', [W([17, 10]), W([16, 10]), { ...W([14, 10]), jump: true }, W([14, 9]), W([13, 9]), W([13, 8]), W([13, 7]), W([12, 7])]));
  if (reload) {
    // AC 4: save mid-route (upper stair open), reload on the same physics mode, probes bit-equal, walk continues.
    const w1 = sim.world, w2 = deserialize(serialize(w1), assets, { physics });
    const r1 = anyRoller(w1); sim.world = w2; const r2 = anyRoller(w2);
    info.reload = { rollerAbsent: !r1 && !r2, upperStairOpen: upperStairOpen(sim), colliders: w2.colliders.map((c) => c.id).join(',') };
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const o1 = {}, o2 = {}, opts = { height: 1.7, stepUpMax: 0.45, walkCos: Math.cos(50 * Math.PI / 180) };
    let bad = 0;
    for (let i = 0; i < 200; i++) {
      const x = O.x + 1 + rnd() * 22, y = O.y + 1 + rnd() * 12, dx = (rnd() * 2 - 1) * 0.2, dy = (rnd() * 2 - 1) * 0.2, z = rnd() * 8, gr = rnd() > 0.5;
      if (physics === 'mesh') {
        const a = w1.collideCircle(x, y, dx, dy, 0.3, z, gr, opts, o1), ax = a.x, ay = a.y, ab = a.blockedX, ac = a.blockedY;
        const b = w2.collideCircle(x, y, dx, dy, 0.3, z, gr, opts, o2);
        if (ax !== b.x || ay !== b.y || ab !== b.blockedX || ac !== b.blockedY) bad++;
        const s1 = w1.supportAt(x, y, z, gr, opts), f1 = s1.floorH, c1 = s1.ceilH, s2 = w2.supportAt(x, y, z, gr, opts);
        if (!Object.is(f1, s2.floorH) || !Object.is(c1, s2.ceilH)) bad++;
      } else if (w1.floorAt(x, y) !== w2.floorAt(x, y) || w1.ceilAt(x, y) !== w2.ceilAt(x, y)) bad++;
    }
    info.reload.probeMismatches = bad;
  }
  // 6 doorway + summit walkway to the breach.
  legs.push(runLeg(sim, '6 doorway + summit', [W([11, 7]), W([10, 7]), W([10, 8]), W([9, 8]), W([8, 8]), W([7, 8]), W([7, 7])]));
  legs.push(runLeg(sim, '7a breach (parapet overlook)', [W([6, 7])]));
  // CH1-10 probe A: sword spot reached from the summit walk (leg 6 end is inside the sword's 1.8 m interact radius).
  info.swordDist = Math.hypot(legs[legs.length - 2].end.x - 7.45 - O.x, legs[legs.length - 2].end.y - 8.4 - O.y);
  legs[legs.length - 2].completed = legs[legs.length - 2].completed && info.swordDist <= 1.8;
  // CH1-10 probe B: no exit over the parapet/breach. Walk W / NW / SW from the breach; every heading must stay blocked on the
  // summit (z >= 5, x never past the outer ring of the breach). Pass = blocked and never dropped.
  {
    const t = sim.player.transform, b = sim.player.components.body, from = { x: t.x, y: t.y, z: t.z };
    const bp = { name: '7a2 breach no-exit probe (W/NW/SW)', steps: 0, completed: true, stuckAt: null, fell: false, minGap: Infinity, maxFall: 0, trace: [] };
    let minZ = Infinity;
    for (const [tx, ty] of [[-6, 7.5], [1, 1], [1, 14]]) {
      t.x = from.x; t.y = from.y; t.z = from.z; b.vx = b.vy = b.vz = 0; b.grounded = true; b.peakZ = t.z;
      const r2 = runLeg(sim, 'sub', [{ x: O.x + tx, y: O.y + ty }], { expectBlocked: true, maxWpSteps: 300 });
      for (let i = 2; i < r2.trace.length; i += 3) minZ = Math.min(minZ, r2.trace[i]);
      bp.steps += r2.steps; bp.completed = bp.completed && r2.completed && !r2.fell; bp.trace.push(...r2.trace);
    }
    info.breachMinZ = minZ; bp.completed = bp.completed && minZ >= 5;
    t.x = from.x; t.y = from.y; t.z = from.z; b.vx = b.vy = b.vz = 0; b.grounded = true; b.peakZ = t.z;
    bp.end = { ...t }; legs.push(bp);
  }
  // 7c walk-down (DOOR-TOGGLE-01: the SW door starts CLOSED; the player opens it with E = the real door.toggle interactable):
  // probe the doorway closed (blocked), open it, probe again (must pass), then take the sword and walk the summit -> upper steps ->
  // gap-alcove drop -> ground-floor SW door -> outside stair to the outer ring (8,12).
  const barProbe = () => { // mesh: a capsule pushed +y into the doorway (15.5, 11.1) is blocked only if a collider sits there
    if (physics !== 'mesh') return null;
    const o = {}, op = { height: 1.7, stepUpMax: 0.45, walkCos: Math.cos(50 * Math.PI / 180) };
    const q = sim.world.collideCircle(O.x + 15.5, O.y + 10.9, 0, 0.3, 0.3, 0, true, op, o);
    return !!q.blockedY;
  };
  info.doorBlocksWhenClosed = barProbe(); // mesh: must be true (closed door blocks the doorway)
  registerQuestBehaviours();
  info.doorToggled = sim.world.fireInteraction('door.toggle', { structId: 'tower' }) === true;
  info.doorBlocksWhenOpen = barProbe(); // mesh: must be false (open door lets you through)
  sim.world.state['tower.sword.taken'] = true;
  info.doorOpen = sim.world.state['tower.door.open'] === true && sim.world.get('tower.doorBar').getComponent('voxel').variant === 'open';
  const down = [[7, 7], [7, 8], [8, 8], [9, 8], [10, 8], [10, 7], [11, 7], [12, 7], [13, 7], [13, 8], [13, 9], [14, 9], [14, 10], [16, 10, true], [17, 10], [18, 10], [19, 10], [19, 9],
    [20, 9], [20, 8], [20, 7], [20, 6], [20, 5], [20, 4], [19, 4], [19, 3], [18, 3], [17, 3], [16, 3], [15, 3], [15, 5], [16, 5], [16, 6], [17, 7], [17, 8], [17, 9], [16, 9], [15, 9],
    [15, 10], [15, 11], [15, 12], [14, 12], [13, 12], [12, 12], [11, 12], [10, 12], [9, 12], [8, 12]].map(([x, y, jump]) => (jump ? { ...W([x, y]), jump: true } : W([x, y])));
  legs.push(runLeg(sim, '7c down -> door (E) -> outside', down));
  // 7b hillside + waystone (fires the real world `end` trigger zone).
  const endRec = sim.world.triggers.find((t) => t.id === 'end' && t.structId === null); // area-only zone (WAYSTONE-NORMAL-01): reached, but fires no end sequence
  let sawEnd = false;
  const origStep = sim.step;
  const hill = runLeg(sim, '7b hillside -> waystone', [TERRAIN_NEAR, WAYSTONE], { detour: true });
  sawEnd = !!endRec && endRec.inside === 1;
  info.endTrigger = sawEnd; hill.sawEnd = sawEnd;
  info.endStarted = sim.world.state['quest.endT'] >= 0; // must stay false: no end sequence (WAYSTONE-NORMAL-01)
  legs.push(hill);
  // WS1-08 / 38.36: leg 8 waystone -> road-bend relay (1420,1032) -> (1350,1050) -> (1270,1042); must end <= 3 m from the relay (1262,1033).
  const l8 = runLeg(sim, '8 waystone -> relay', [{ x: 1420, y: 1032 }, { x: 1350, y: 1050 }, { x: 1270, y: 1042 }, { x: 1263, y: 1034 }], { maxWpSteps: 1500 }); // 80+ m legs at 6 m/s need > 600 steps
  const relayD = Math.hypot(sim.player.transform.x - RELAY.x, sim.player.transform.y - RELAY.y);
  info.relayDist = relayD; l8.completed = l8.completed && relayD <= 3 && !l8.fell;
  legs.push(l8);
  // WS2-07 / 38.38 leg 9: bend relay -> road -> ford -> across the stepping stones -> relay #2 (ws_ford) -> bound probe -> back to the east.
  // The sim streams the near band like the game (streamBand per step, 2 ms budget): one swap each way, no band:late, no fall.
  const bandEv = []; let late = 0; sim.world.events = sim.world.events || new Events();
  sim.world.events.on('world:band', (e) => bandEv.push(e.from + '>' + e.to));
  sim.world.events.on('band:late', () => { late++; });
  sim.stream = true;
  const RELAY2 = { x: 992, y: 1079 };
  const dataStones = JSON.parse(readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8')).structures.filter((s) => /^fordS[0-9]+$/.test(s.id)).map((s) => ({ x: s.origin.x, y: s.origin.y, z: s.origin.z }));
  const E2W = dataStones.slice().sort((p, q) => q.x - p.x), W2E = dataStones.slice().sort((p, q) => p.x - q.x);
  const to = [{ x: 1180, y: 1062 }, { x: 1090, y: 1070 }, { x: 1046, y: 1069 }, ...E2W, { x: 1010, y: 1069 }, { x: 998, y: 1075 }, { x: 993, y: 1077 }];
  const l9 = runLeg(sim, '9 bend -> ford -> stones -> relay 2', to, { maxWpSteps: 1500 });
  const r2 = Math.hypot(sim.player.transform.x - RELAY2.x, sim.player.transform.y - RELAY2.y);
  info.relay2Dist = r2; l9.completed = l9.completed && r2 <= 3 && !l9.fell && dataStones.length >= 5;
  legs.push(l9);
  // Bound probe: keep walking west of the ford relay; the widened walk bound must stop us (min x stays >= ~958).
  const bp = runLeg(sim, '9b bound probe (west of the ford)', [{ x: 900, y: 1075 }], { expectBlocked: true, maxWpSteps: 3000 });
  let minX = Infinity; for (let i = 0; i < bp.trace.length; i += 3) minX = Math.min(minX, bp.trace[i]);
  info.boundMinX = minX; bp.completed = bp.completed && minX >= 955;
  legs.push(bp);
  // WS2-07b (D-064) wade probe: from the west bank walk straight east THROUGH the water beside the stones (y 1076, 7 m off the lane): the water block must stop us (mesh; the grid has no mesh colliders so it is not blocked there).
  const wade = runLeg(sim, '9d wade probe (water beside the stones)', [{ x: 1008, y: 1076 }, { x: 1046, y: 1076 }], { expectBlocked: true, maxWpSteps: 1500 });
  let maxWx = -Infinity; for (let i = 0; i < wade.trace.length; i += 3) maxWx = Math.max(maxWx, wade.trace[i]);
  info.wadeMaxX = maxWx; info.wadeBlocked = wade.completed && maxWx < 1017 && maxWx > 1005; wade.completed = sim.physics === 'mesh' ? info.wadeBlocked : true;
  legs.push(wade);
  // MAP-22/24 crossroads probe: east bank -> trade post front -> signpost -> up the footpath stones -> back -> straw-man field (targets) -> back to the stones. No stuck spot, no fall.
  const xr = runLeg(sim, '9e crossroads (post, sign, footpath, straw field)', [{ x: 1008, y: 1069 }, { x: 1001, y: 1064 }, { x: 994, y: 1058 }, { x: 986, y: 1053 }, { x: 980, y: 1048 }, { x: 986, y: 1053 }, { x: 994, y: 1058 }, { x: 994, y: 1064 }, { x: 984, y: 1086 }, { x: 975, y: 1093 }, { x: 984, y: 1086 }, { x: 998, y: 1075 }, { x: 1008, y: 1069 }], { maxWpSteps: 1500 });
  xr.completed = xr.completed && !xr.fell;
  legs.push(xr);
  // MAP-23: Rook's nest ruin climb. Up the rubble stair-block columns (jump per column, east -> west), onto the roof deck to the nest anchor and back down + out. Roof deck z ~ nest.z - 0.2.
  {
    const wd = JSON.parse(readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
    const cols = [...new Set(wd.structures.filter((q) => /^poi[0-9]+$/.test(q.id) && q.mesh === 'quaternius/Stairs_Exterior_Straight' && Math.abs(q.origin.x - 970.7) < 0.5 && q.origin.y < 1075).map((q) => q.origin.y))].sort((p, q) => q - p); // pile columns, south end (start) first
    const PX = wd.structures.find((q) => q.mesh === 'quaternius/Stairs_Exterior_Straight' && /^poi/.test(q.id)).origin.x;
    const nest = wd.entities.find((e) => e.id === 'nest'), up = cols.map((y) => ({ x: PX, y, jump: true }));
    const rk = runLeg(sim, 'R1 Rook ruin climb (steps -> roof -> nest -> down)', [{ x: 1001, y: 1064 }, { x: 994, y: 1064 }, { x: 990, y: 1067 }, { x: 980, y: 1071 }, { x: 975.5, y: cols[0] + 2.2 }, { x: PX, y: cols[0] + 2.2 }, ...up, { x: nest.x, y: nest.y }, { x: nest.x + 1.6, y: nest.y }, ...up.slice().reverse().map((w) => ({ x: w.x, y: w.y })), { x: PX, y: cols[0] + 2.2 }, { x: 975.5, y: cols[0] + 2.2 }, { x: 980, y: 1071 }, { x: 990, y: 1067 }, { x: 994, y: 1058 }, { x: 1001, y: 1064 }, { x: 1008, y: 1069 }], { maxWpSteps: 1500 });
    rk.completed = rk.completed && !rk.fell && cols.length >= 3;
    info.roofZ = Math.max(...rk.trace.filter((_, i) => i % 3 === 2)); info.roofCols = cols.length;
    if (sim.physics === 'mesh') rk.completed = rk.completed && info.roofZ >= nest.z - 0.6; // the grid has no mesh colliders: there it only has to walk the line without a stuck spot
    legs.push(rk);
  }
  const back = runLeg(sim, '9c ford -> back over the stones -> bend', [{ x: 1008, y: 1069 }, ...W2E, { x: 1046, y: 1069 }, { x: 1090, y: 1070 }, { x: 1180, y: 1062 }, { x: 1260, y: 1045 }, { x: 1310, y: 1048 }], { maxWpSteps: 1500 });
  back.completed = back.completed && !back.fell;
  legs.push(back);
  // WS2-07b: the player stands ON the slab tops (mesh): z at the sample nearest each stone centre is >= slab base + 0.09 m.
  info.stoneLift = []; for (const st of dataStones) { let bd = 1e9, bz = 0; for (let i = 0; i < l9.trace.length; i += 3) { const d = Math.hypot(l9.trace[i] - st.x, l9.trace[i + 1] - st.y); if (d < bd) { bd = d; bz = l9.trace[i + 2]; } } info.stoneLift.push(+(bz - st.z).toFixed(2)); }
  info.bands = bandEv.join(','); info.bandLate = late; info.maxSwapMs = +sim.world.lastSwapMs.toFixed(2);
  l9.completed = l9.completed && bandEv.length === 2 && bandEv[0] === 'east>west' && bandEv[1] === 'west>east' && late === 0;
  sim.stream = false;
  return { legs, info, ms: sim.ms, sim };
}

// ---- jump arc / landing (AC 2): a standing jump and a running jump on flat tower floor.
function jumpProbe(physics) {
  const out = {};
  for (const mode of ['stand', 'run']) {
    const sim = setup(physics);
    sim.player.transform.x = O.x + 16; sim.player.transform.y = O.y + 7.5; sim.player.transform.z = 0;
    sim.player.components.body.peakZ = 0;
    sim.controls.yawDeg = 270; // west across the flat floor
    let peak = 0, landStep = -1;
    for (let i = 0; i < 90; i++) {
      sim.controls.forward = mode === 'run' ? 1 : 0; sim.controls.jump = i < 6 && i >= 2;
      stepOnce(sim);
      const t = sim.player.transform;
      if (t.z > peak) peak = t.z;
      if (i > 10 && sim.player.components.body.grounded && landStep < 0) landStep = i;
    }
    const t = sim.player.transform;
    out[mode] = { peak, landStep, x: t.x, y: t.y, z: t.z };
  }
  return out;
}

// ---- GS-01f probe: every terrainFloor (grass ring) cell stays walkable. 5 points per flagged cell, drop 0.2 m above the
// level floor, idle 20 steps, then a short walk along the ring: z must stay on the floor height (never fall through).
function ringProbe(physics) {
  const sim = setup(physics), st = sim.world.structures[0], lv = st.level;
  let cells = 0, pts = 0, minZ = Infinity, bad = [];
  const pt = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]];
  const tr = sim.player.transform, b = sim.player.components.body;
  for (let r = 0; r < lv.height; r++) for (let c = 0; c < lv.width; c++) {
    const sec = lv.sectorAt(c + 0.5, r + 0.5);
    if (!sec || sec.terrainFloor !== true) continue;
    cells++;
    for (const [ox, oy] of pt) {
      const want = st.origin.z + sec.floorH;
      tr.x = O.x + c + ox; tr.y = O.y + r + oy; tr.z = want + 0.2; b.vx = b.vy = b.vz = 0; b.grounded = false; b.peakZ = tr.z;
      idle(sim, 20);
      pts++; minZ = Math.min(minZ, tr.z - want);
      if (tr.z < want - 0.3) bad.push(`(${c},${r}) z${(tr.z - want).toFixed(2)}`);
    }
  }

  return { cells, pts, minDz: minZ, bad };
}

// ---- stair-edge probe (AC 2): approach each stair step head-on from the base row (y=3 flight), see z follow.
function pct(a, p) { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }

// ---- probe C (DOOR-TOGGLE-01): the SW door starts CLOSED and blocks the doorway; after door.toggle it lets you through
// (mesh only: grid has no prop colliders).
function doorClosedProbe(physics) {
  if (physics !== 'mesh') return { ok: true, skipped: true };
  registerQuestBehaviours();
  const walkOut = (sim) => {
    const t = sim.player.transform, b = sim.player.components.body;
    t.x = O.x + 15.5; t.y = O.y + 9.5; t.z = sim.world.floorAt(t.x, t.y) ?? 0; b.peakZ = t.z;
    const r = runLeg(sim, 'door', [{ x: O.x + 15.5, y: O.y + 13 }], { maxWpSteps: 300 });
    return { completed: r.completed, y: sim.player.transform.y - O.y };
  };
  const closedSim = setup(physics), closed = walkOut(closedSim);
  const openSim = setup(physics), toggled = openSim.world.fireInteraction('door.toggle', { structId: 'tower' }) === true, open = walkOut(openSim);
  const blocked = !closed.completed && closed.y < 11.2, passes = open.completed && open.y > 12.5;
  return { ok: toggled && blocked && passes && !closedSim.world.state['tower.sword.taken'], closedEndY: +closed.y.toFixed(2), openEndY: +open.y.toFixed(2) };
}

// ---- CH1-10 clearance of the NPC walk polylines (read from world_m1 data, not hard-coded).
function clearance() {
  const { world } = setup('mesh'), data = assets.world('world_m1'), out = [];
  const walks = (id) => { const e = data.entities.find((en) => en.components && en.components.walks && en.components.walks[id]); return e.components.walks[id]; };
  const area = data.nav.area;
  const statics = world.colliders.filter((c) => c.id !== 'npcs:kinematic');
  const opts = { height: 1.7, stepUpMax: 0.45, walkCos: Math.cos(50 * Math.PI / 180) }, o = {}, nn = {};
  for (const name of ['follow', 'depart']) {
    const pts = walks(name), bad = [];
    // sample every 1 m along the polyline
    const samples = [];
    for (let i = 0; i < pts.length; i++) {
      samples.push(pts[i]);
      if (i + 1 < pts.length) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], n = Math.floor(Math.hypot(bx - ax, by - ay)); for (let k = 1; k < n; k++) samples.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]); }
    }
    for (const [x, y] of samples) {
      const z = world.terrain.groundAt(x, y);
      const q = moveCircleMesh(statics, statics.length, x, y, 0.001, 0, 0.8, z, true, opts, o);
      const push = Math.hypot(q.x - (x + 0.001), q.y - y);
      world.terrain.groundNormalAt(x, y, nn);
      const slope = Math.hypot(nn.x, nn.y) / Math.max(1e-6, nn.z);
      const inNav = x >= area.x0 && x < area.x0 + area.w && y >= area.y0 && y < area.y0 + area.h;
      const why = [];
      if (push > 0.02 || q.blockedX || q.blockedY) why.push(`collider<0.8m (push ${push.toFixed(2)})`);
      if (slope >= 0.6) why.push(`slope ${slope.toFixed(2)}`);
      if (name === 'follow' && !inNav) why.push('outside nav area');
      if (why.length) bad.push(`(${x.toFixed(1)},${y.toFixed(1)}) ${why.join(', ')}`);
    }
    out.push({ name, samples: samples.length, bad });
  }
  return out;
}

const G = routeRun('grid'), M = routeRun('mesh'), MR = routeRun('mesh', { reload: true }), GR = routeRun('grid', { reload: true });
const JG = jumpProbe('grid'), JM = jumpProbe('mesh');
const reloadSame = MR.legs.every((l, i) => l.completed === M.legs[i].completed && Math.abs(l.end.x - M.legs[i].end.x) < 1e-9 && Math.abs(l.end.y - M.legs[i].end.y) < 1e-9 && Math.abs(l.end.z - M.legs[i].end.z) < 1e-9);
const RP = [ringProbe('grid'), ringProbe('mesh')];
const DC = [doorClosedProbe('grid'), doorClosedProbe('mesh')], CL = clearance();
const NL = '\n    ';
const asJson = process.argv.includes('--json');
const f = (n) => (n == null ? '-' : n.toFixed(2));
const rows = [];
for (let i = 0; i < G.legs.length; i++) {
  const g = G.legs[i], m = M.legs[i];
  let maxd = 0; const n = Math.min(g.trace.length, m.trace.length) / 3;
  for (let k = 0; k < n; k++) maxd = Math.max(maxd, Math.hypot(g.trace[3 * k] - m.trace[3 * k], g.trace[3 * k + 1] - m.trace[3 * k + 1], g.trace[3 * k + 2] - m.trace[3 * k + 2]));
  const stuck = (l) => (l.stuckAt ? `wp${l.stuckAt.wp}@(${f(l.stuckAt.x - O.x)},${f(l.stuckAt.y - O.y)},z${f(l.stuckAt.z)})` : '');
  rows.push({
    leg: g.name,
    grid: { ok: g.completed, steps: g.steps, fell: g.fell, end: g.end, stuck: stuck(g), minGap: g.minGap },
    mesh: { ok: m.completed, steps: m.steps, fell: m.fell, end: m.end, stuck: stuck(m), minGap: m.minGap },
    maxTraceDiff: maxd, endDiff: Math.hypot(g.end.x - m.end.x, g.end.y - m.end.y, g.end.z - m.end.z),
  });
}
if (asJson) { console.log(JSON.stringify({ rows, gInfo: G.info, mInfo: M.info, jumpGrid: JG, jumpMesh: JM }, null, 1)); }
else {
  console.log('leg                              grid(ok steps fell end)                    mesh(ok steps fell end)                    maxDiff endDiff');
  for (const r of rows) {
    const s = (x) => `${x.ok ? 'Y' : 'N'} ${String(x.steps).padStart(4)} ${x.fell ? 'FELL' : 'ok  '} (${f(x.end.x - O.x)},${f(x.end.y - O.y)},${f(x.end.z)}) ${x.stuck}`;
    console.log(`${r.leg.padEnd(32)} ${s(r.grid).padEnd(44)} ${s(r.mesh).padEnd(44)} ${r.maxTraceDiff.toFixed(3)} ${r.endDiff.toFixed(3)}`);
  }
  console.log('info grid:', JSON.stringify(G.info));
  console.log('info mesh:', JSON.stringify(M.info));
  console.log('save round trip (mid-route, after the upper stair):', 'mesh', JSON.stringify(MR.info.reload), 'grid', JSON.stringify(GR.info.reload), '| continued route end positions == uninterrupted mesh run:', reloadSame);
  console.log(`probe breach no-exit (grid/mesh): ${G.legs.find((l) => l.name.startsWith('7a2')).completed ? 'PASS' : 'FAIL'} / ${M.legs.find((l) => l.name.startsWith('7a2')).completed ? 'PASS' : 'FAIL'}  minZ ${f(G.info.breachMinZ)}/${f(M.info.breachMinZ)}`);
  for (const [i, nm] of ['grid', 'mesh'].entries()) console.log(`probe grass ring walkable (${nm}, ${RP[i].cells} cells, ${RP[i].pts} points): ${RP[i].cells > 0 && RP[i].bad.length === 0 ? 'PASS' : 'FAIL'} minDz ${f(RP[i].minDz)}${RP[i].bad.length ? NL + RP[i].bad.slice(0, 8).join(NL) : ''}`);
  console.log(`probe door closed blocks / open lets through (mesh; grid has no prop colliders): ${DC[1].ok ? 'PASS' : 'FAIL'} ${JSON.stringify(DC[1])}`);
  console.log(`max fall distance (7c down->door->outside) grid/mesh: ${f(G.legs.find((l) => l.name.startsWith('7c')).maxFall)}/${f(M.legs.find((l) => l.name.startsWith('7c')).maxFall)} (limit 3.5)`);
  { const stones = M.info.stoneLift.every((d) => d >= 0.09), wadeOk = M.info.wadeBlocked; const L = (R) => R.legs.filter((l) => /^9/.test(l.name)); const ok = [G, M].every((R) => L(R).length === 5 && L(R).every((l) => l.completed && !l.fell) && R.info.bandLate === 0 && R.info.bands === 'east>west,west>east');
    console.log(`leg 9 ford (grid+mesh): ${ok && stones ? 'PASS' : 'FAIL'} swaps ${M.info.bands} band:late ${M.info.bandLate} max swap ${M.info.maxSwapMs} ms, relay2 ${f(M.info.relay2Dist)} m, west bound minX ${f(M.info.boundMinX)}`);
    console.log(`probe ford stones walk-on (mesh): ${stones ? 'PASS' : 'FAIL'} lift over slab base ${JSON.stringify(M.info.stoneLift)}`);
    console.log(`probe ford water blocks wading (grid n/a: no mesh colliders / mesh): ${wadeOk ? 'PASS' : 'FAIL'} east-most x ${f(M.info.wadeMaxX)} (wall at 1016)`); }
  for (const c of CL) console.log(`clearance ${c.name} (${c.samples} samples, 0.8 m collider, slope<0.6${c.name === 'follow' ? ', inside nav' : ''}): ${c.bad.length ? 'FAIL' : 'PASS'}${c.bad.length ? NL + c.bad.join(NL) : ''}`);
  console.log('jump grid:', JSON.stringify(JG));
  console.log('jump mesh:', JSON.stringify(JM));
  console.log(`sim ms/step p50 p95 max  grid: ${pct(G.ms, 0.5).toFixed(4)} ${pct(G.ms, 0.95).toFixed(4)} ${Math.max(...G.ms).toFixed(4)}   mesh: ${pct(M.ms, 0.5).toFixed(4)} ${pct(M.ms, 0.95).toFixed(4)} ${Math.max(...M.ms).toFixed(4)}`);
}
