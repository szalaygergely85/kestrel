// game/js/quest/beastLook.test.js (ANIM-LOOKAT-01): beastView + beastLook wiring: aware beasts turn the head to the player within the limits,
// unaware / dead / far beasts stay byte-identical (lookRot null or off), models without lookAt stay inert. node --expose-gc game/js/quest/beastLook.test.js
import { packVoxelModel, validateVoxelModel } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';
import { allocProbe } from '../../../tools/allocProbe.mjs';
import { createBeastLook } from './beastLook.js';
import { presentBeasts } from './beastView.js';
import { STATE_WANDER, STATE_CHASE, STATE_WINDUP, STATE_DYING } from './sim/beastSim.js';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/models/voxel_beast.js';
import '../../../design/models/voxel_wolf.js';
import '../../../design/models/voxel_goblin.js';
import '../../../design/models/voxel_bear.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const M = globalThis.ASSETS.models;
const names = { wolf: 'wolf', boar: 'boarPlaceholder', goblin: 'goblin', bear: 'bear' };
const pms = {};
for (const k of Object.keys(names)) {
  const def = M[names[k]] && M[names[k]].voxel;
  ok(`${k}: model + valid def`, !!def && validateVoxelModel(def).errors.length === 0);
  pms[names[k]] = packVoxelModel(def, () => 1);
  ok(`${k}: lookAt packed (head part ${pms[names[k]].lookAt && pms[names[k]].lookAt.part})`, !!pms[names[k]].lookAt && pms[names[k]].lookAt.part >= 0);
}
const pool = { models: new Map(Object.entries(pms)) };
const OVL = { bar() {} }, STY = { beastNotice: 0 }, W = { terrain: { groundAt: () => 0 } };

function mk(model) {
  const voxel = { model, anim: 'idle', frame: 0, t: 0, loop: true, playing: true, hidden: false };
  const e = { transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel } };
  const sim = { count: 1, cfgSteps: { die: 24, sink: 30, notice: 36 }, state: [STATE_WANDER], timer: [0], hurtT: [9999], fx: [0], fy: [-1], moving: [0], entities: [e], fleeing: [0], ranged: [0] };
  return { sim, e, voxel };
}
const run = (b, look, st, n) => { b.sim.state[0] = st; for (let i = 0; i < n; i++) presentBeasts(b.sim, W, OVL, STY, undefined, undefined, undefined, undefined, look); };

// (runs first: after the other scenarios drive the same functions polymorphically the probe reads JIT tier-state bytes, see animBlend.test.js)
// 0 alloc per presentBeasts frame (look part)
{
  const look = createBeastLook({ pool }); const b = mk('wolf');
  const tg = look.target; // setTarget(...) with computed doubles boxes its args at the CALL site (caller-side, 38.61): the probe writes the typed array directly
  const drive = (i) => { tg[0] = Math.sin(i / 30) * 8; tg[1] = -4; tg[2] = 1; tg[3] = 1; b.sim.state[0] = (i % 300) < 200 ? STATE_CHASE : STATE_WANDER; presentBeasts(b.sim, W, OVL, STY, undefined, undefined, undefined, undefined, look); };
  for (let i = 0; i < 2000; i++) drive(i);
  const r = allocProbe((n) => { for (let i = 0; i < n; i++) drive(i); }, { n: 100000 });
  const base = (i) => { b.sim.state[0] = (i % 300) < 200 ? STATE_CHASE : STATE_WANDER; presentBeasts(b.sim, W, OVL, STY, undefined, undefined, undefined, undefined, undefined); };
  for (let i = 0; i < 2000; i++) base(i);
  const r0 = allocProbe((n) => { for (let i = 0; i < n; i++) base(i); }, { n: 100000 });
  if (r.skipped) console.log('SKIP alloc (no --expose-gc)');
  else {
    console.log(`  info: presentBeasts without look ${r0.perCall.toFixed(2)} B/frame, with look ${r.perCall.toFixed(2)}`);
    ok(`look adds ~0 B/frame (<= 1 B over the presentBeasts baseline): ${(r.perCall - r0.perCall).toFixed(3)}`, r.perCall - r0.perCall < 1);
  }
}

for (const key of Object.keys(names)) {
  const model = names[key], pm = pms[model], L = pm.lookAt;
  const look = createBeastLook({ pool });
  const b = mk(model);
  look.setTarget(6, -2, 1); // ahead-right of a beast facing -y
  run(b, look, STATE_WANDER, 60);
  ok(`${key}: wandering (unaware) beast does not look`, !b.voxel.lookRot || b.voxel.lookRot[0] === 0);
  run(b, look, STATE_CHASE, 240);
  const r = b.voxel.lookRot;
  const want = Math.min(L.yawLimit, Math.atan2(6, 2) * 180 / Math.PI);
  ok(`${key}: chasing beast turns the head to the player: rz ${r && r[4].toFixed(2)} (want ${want.toFixed(2)}, limit ${L.yawLimit})`, r && r[0] === 1 && r[1] === L.part && Math.abs(r[4] - want) < 0.05 && Math.abs(r[4]) <= L.yawLimit);
  look.setTarget(0, 60, 1); // 60 m away: beyond LOOK_R
  run(b, look, STATE_WINDUP, 400);
  ok(`${key}: far target releases the head to neutral`, b.voxel.lookRot[0] === 0);
  look.setTarget(6, -2, 1);
  run(b, look, STATE_CHASE, 30);
  run(b, look, STATE_DYING, 1);
  ok(`${key}: dying beast releases (lookRot null)`, b.voxel.lookRot === null);
}

// inert without a block / without the object
{
  const b = mk('wolf'); const poolNo = { models: new Map([['wolf', { ...pms.wolf, lookAt: null }]]) };
  const look = createBeastLook({ pool: poolNo }); look.setTarget(6, -2, 1);
  run(b, look, STATE_CHASE, 30);
  ok('model without lookAt: inert (lookRot unset/null, no slot)', !b.voxel.lookRot && look.stats.attached === 0);
  const b2 = mk('wolf'); run(b2, undefined, STATE_CHASE, 30);
  ok('no look object (?lookat=0): lookRot never set', b2.voxel.lookRot === undefined);
  const off = createBeastLook({ pool, enabled: false }); const b3 = mk('wolf'); off.setTarget(6, -2, 1); run(b3, off, STATE_CHASE, 30);
  ok('enabled:false: inert', b3.voxel.lookRot === undefined);
}

// NPC-style entity step (dialogue open = active)
{
  const look = createBeastLook({ pool }); look.setTarget(4, -4, 1);
  const b = mk('bear');
  for (let i = 0; i < 200; i++) look.stepEntity(1030, b.e, b.voxel, true);
  ok(`stepEntity active: looks 45 deg right (limit 55): ${b.voxel.lookRot[4].toFixed(2)}`, Math.abs(b.voxel.lookRot[4] - 45) < 0.05);
  for (let i = 0; i < 600; i++) look.stepEntity(1030, b.e, b.voxel, false);
  ok('stepEntity inactive: eases back to neutral', b.voxel.lookRot[0] === 0);
}

console.log(`beastLook: ${pass} pass, ${fail} fail`);
for (const m of failures) console.log('  FAIL ' + m);
process.exit(fail ? 1 : 0);
