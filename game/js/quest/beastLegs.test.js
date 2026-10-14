// game/js/quest/beastLegs.test.js (ANIM-C-05): beastView leg IK wiring with a fake sim + flat/sloped ground. node game/js/quest/beastLegs.test.js
import { packVoxelModel } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';
import { createBeastLegs } from './beastLegs.js';
import { presentBeasts } from './beastView.js';
import { STATE_CHASE, STATE_GONE, STATE_DYING } from './sim/beastSim.js';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/models/voxel_bear.js';
import '../../../design/models/voxel_bear_black.js';

// heap-growth gate (inline: game tests may not deep-import engine/test/allocGate.js); re-runs itself with --expose-gc
if (typeof globalThis.gc !== 'function' && !process.env.ALLOC_GATE_CHILD) {
  const { spawnSync } = process.getBuiltinModule('node:child_process');
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, ALLOC_GATE_CHILD: '1' } });
  process.exit(r.status ?? 1);
}
function heapGrowth(fn, warm) { warm(); gc(); gc(); const h0 = process.memoryUsage().heapUsed; fn(); gc(); gc(); return process.memoryUsage().heapUsed - h0; }

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const pm = packVoxelModel(globalThis.ASSETS.models.bear.voxel, () => 1);
const pmB = packVoxelModel(globalThis.ASSETS.models.bearBlack.voxel, () => 1);
const pmNo = { ...pm, legRig: null };
const WALK = pm.clipIndex.walk;
const hill = { groundAt: (x, y) => 0.2 * y }; // 11 deg slope
const noHill = { groundAt: () => 0 };

function mk(model) {
  const voxel = { model, anim: 'idle', frame: 0, t: 0, loop: true, playing: true, hidden: false };
  const e = { transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel } };
  const sim = { count: 1, cfgSteps: { die: 24, sink: 30, notice: 36 }, state: [STATE_CHASE], timer: [0], hurtT: [9999], fx: [0], fy: [1], moving: [1], entities: [e], fleeing: [0] };
  return { sim, e, voxel };
}
// bear sim clip for CHASE is 'charge' (gait? maybe none); force the walk clip by wandering
const pool = { models: new Map([['bear', pm], ['bearBlack', pmB], ['noRig', pmNo]]) };
function walkFrames(legs, rig, ground, n, slope) {
  const { sim, e, voxel } = mk(rig);
  const world = { terrain: ground };
  const ovl = { bar() {} };
  const trace = [];
  for (let s = 0; s < n; s++) {
    e.transform.y += 1.0 / 60; // 1 m/s north (fx,fy = 0,1)
    e.transform.z = ground.groundAt(e.transform.x, e.transform.y);
    sim.state[0] = STATE_CHASE;
    presentBeasts(sim, world, ovl, { beastNotice: 0 }, undefined, legs, { x: 0, y: -5 });
    trace.push({ frame: voxel.frame, t: voxel.t, playing: voxel.playing, legs: voxel.legPose });
  }
  return { trace, voxel, sim, e };
}

// attach on the first visible frame, release when hidden
{
  const legs = createBeastLegs({ pool });
  const { sim, e, voxel } = mk('bear');
  presentBeasts(sim, { terrain: noHill }, { bar() {} }, { beastNotice: 0 }, undefined, legs, { x: 0, y: -5 });
  ok('attached on first visible frame', legs.stats.attached === 1);
  sim.state[0] = STATE_GONE;
  presentBeasts(sim, { terrain: noHill }, { bar() {} }, { beastNotice: 0 }, undefined, legs, { x: 0, y: -5 });
  ok('released at GONE, legPose null', legs.stats.attached === 0 && !voxel.legPose && voxel.hidden === true);
  sim.state[0] = 0; presentBeasts(sim, { terrain: noHill }, { bar() {} }, { beastNotice: 0 }, undefined, legs, { x: 0, y: -5 });
  sim.state[0] = STATE_DYING; sim.timer[0] = 10;
  presentBeasts(sim, { terrain: noHill }, { bar() {} }, { beastNotice: 0 }, undefined, legs, { x: 0, y: -5 });
  ok('released while dying', legs.stats.attached === 0);
  void e;
}
// model without legRig stays inert
{
  const legs = createBeastLegs({ pool });
  const r = walkFrames(legs, 'noRig', noHill, 30);
  ok('no legRig: never attaches, no legPose', legs.stats.attached === 0 && r.trace.every((x) => !x.legs));
}
// phase-driven clip time + legPose on a slope
{
  const legs = createBeastLegs({ pool });
  const r = walkFrames(legs, 'bearBlack', hill, 240);
  const tail = r.trace.slice(120);
  ok('walking: legPose set (w>0) on the slope', tail.every((x) => x.legs && x.legs[0] > 0), JSON.stringify(tail[0]));
  ok('walking: clip time driven (playing false)', tail.every((x) => x.playing === false));
  const frames = new Set(tail.map((x) => x.frame));
  ok('walking: gait frame advances with the phase', frames.size > 3, [...frames].join());
  ok('walking: body pitched on the slope (bodyRx != 0)', Math.abs(tail[tail.length - 1].legs[1]) > 0.01);
}
// ?legik=0: nothing attached, voxel byte-identical to no-legs call
{
  const a = walkFrames(createBeastLegs({ pool, enabled: false }), 'bearBlack', hill, 100);
  const b = walkFrames(undefined, 'bearBlack', hill, 100);
  ok('legik off identical to no legs arg', JSON.stringify(a.trace) === JSON.stringify(b.trace) && a.trace.every((x) => !x.legs));
}
// scripted NPC (Burl, model bear, anim 'walk' set by npcWalk): phase-driven frames, playing untouched; hidden releases
{
  const legs = createBeastLegs({ pool });
  const voxel = { model: 'bear', anim: 'walk', frame: 0, t: 0, playing: true, hidden: false };
  const e = { transform: { x: 0, y: 0, z: 0, yawDeg: 0 } };
  const fr = new Set(); let withLegs = 0;
  for (let s = 0; s < 300; s++) { e.transform.y += 1.0 / 60; e.transform.z = hill.groundAt(0, e.transform.y); voxel.anim = 'walk'; legs.stepNpc('bear', e, voxel, 0, -5, hill); if (s > 120) { fr.add(voxel.frame); if (voxel.legPose && voxel.legPose[0] > 0) withLegs++; } }
  ok('NPC: legPose on while walking', withLegs === 179, String(withLegs));
  ok('NPC: gait frames cycle from the phase, playing left true', fr.size > 3 && voxel.playing === true, [...fr].join());
  voxel.hidden = true; legs.stepNpc('bear', e, voxel, 0, -5, hill);
  ok('NPC: hidden releases', legs.stats.attached === 0 && !voxel.legPose);
  // 0 alloc per step (stepNpc, steady state)
  voxel.hidden = false;
  const go = (n) => { for (let s = 0; s < n; s++) { e.transform.y += 1 / 60; e.transform.z = hill.groundAt(0, e.transform.y); voxel.anim = 'walk'; legs.stepNpc('bear', e, voxel, 0, -5, hill); } };
  const grow = heapGrowth(() => go(5000), () => go(8000));
  ok('0 retained bytes over 5000 steps (' + grow + ' B)', grow < 8192);
}
console.log(`beastLegs: ${pass} pass, ${fail} fail`);
for (const f of failures) console.log('FAIL', f);
process.exit(fail ? 1 : 0);
