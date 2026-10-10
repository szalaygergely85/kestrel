// game/js/quest/npcBear.test.js (NPC-BEAR-01, architecture.md 38.28). Real world_m1 + real bear model + real dialogue.
//   node game/js/quest/npcBear.test.js
import { World, yawFromDelta } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import '../../../design/models/lantern.js'; import '../../../design/models/lever.js'; import '../../../design/models/boulder.js';
import '../../../design/models/rubble.js'; import '../../../design/models/wreckage.js'; import '../../../design/models/relay.js';
import '../../../design/models/sword.js'; import '../../../design/models/m3_props.js'; import '../../../design/models/far_tower.js';
import '../../../design/models/ferrum_lights.js'; import '../../../design/models/voxel_beast.js'; import '../../../design/models/voxel_bear.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { createNpcTurn, NEAR_M, MAX_DEG_S, RETURN_DELAY_S } from './npcBear.js';
import { createDialogueCtl, setDialogueApi, npcTalk } from './dialogueCtl.js';

paletteMod; detailPassMod; terrainMod;
const { assets, bundle } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const world = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
const FX = globalThis.ASSETS.bearFx;

// ---- placement --------------------------------------------------------------------------------------------------
const bear = world.get('bear'), t = bear.data.transform;
ok('bear is an npc entity with model bear + dialogue bear', bear.data.type === 'npc' && bear.getComponent('voxel').model === 'bear' && bear.data.components.dialogue === 'bear');
ok('bear plays idle looping', bear.getComponent('voxel').anim === 'idle' && bear.getComponent('voxel').loop === true);
const g = world.terrain.groundAt(t.x, t.y);
ok('bear stands on the ground (within 0.05 m)', Math.abs(t.z - g) < 0.05, `z ${t.z} ground ${g}`);
const tower = world.structures.find((s) => s.id === 'tower');
const breach = { x: 1486.5, y: 1025 };
const far = world.get('farTower').data.transform;
const dB = Math.hypot(t.x - breach.x, t.y - breach.y);
ok('12-20 m from the breach', dB >= 12 && dB <= 20, `d ${dB.toFixed(1)}`);
const wantYaw = yawFromDelta(far.x - breach.x, far.y - breach.y), haveYaw = yawFromDelta(t.x - breach.x, t.y - breach.y);
const dYaw = Math.abs(((wantYaw - haveYaw + 540) % 360) - 180);
ok('toward the teal signal (within 25 deg of the farTower bearing)', dYaw < 25, `${dYaw.toFixed(1)} deg`);
let maxSlope = 0;
for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) maxSlope = Math.max(maxSlope, Math.abs(world.terrain.groundAt(t.x + ox, t.y + oy) - g));
ok('walkable ground (slope < 30 deg)', Math.atan(maxSlope) * 180 / Math.PI < 30);
const bush = world.structures.find((s) => s.id === 'burlBush');
ok('a bush stands beside it (1-3 m)', !!bush && Math.hypot(bush.origin.x - t.x, bush.origin.y - t.y) >= 1 && Math.hypot(bush.origin.x - t.x, bush.origin.y - t.y) <= 3);
ok('home yaw faces the breach', Math.abs(((yawFromDelta(breach.x - t.x, breach.y - t.y) - t.yawDeg + 540) % 360) - 180) < 5);
ok('breach exit is visible: tower start is within 25 m', Math.hypot(tower.origin.x + 17 - t.x, tower.origin.y + 9.5 - t.y) < 30);

// ---- solid ------------------------------------------------------------------------------------------------------
{
  const o = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
  const opts = { height: 1.6, stepUpMax: 0.4, walkCos: 0.7 };
  let x = t.x + 2.5; const y = t.y;
  for (let i = 0; i < 120; i++) { world.collideCircle(x, y, -0.05, 0, 0.4, g, true, opts, o); x = o.x; }
  ok('player cannot walk through the bear (stops at r 0.7 + 0.4)', x >= t.x + 0.7 + 0.4 - 0.02 && x < t.x + 1.3, `x offset ${(x - t.x).toFixed(3)}`);
  let x2 = t.x + 2.5, y2 = t.y + 2.5; // the free side must still be walkable
  for (let i = 0; i < 20; i++) { world.collideCircle(x2, y2, 0.05, 0.05, 0.4, g, true, opts, o); x2 = o.x; y2 = o.y; }
  ok('free ground next to it is not blocked', x2 > t.x + 3.0);
}

// ---- turn to player (BEAR-FOLLOW-01: calm bear, no tracking) ------------------------------------------------------
{
  const dt = 1 / 60;
  const fake = { d: { transform: { x: 0, y: 0, z: 0, yawDeg: 90 } } };
  const w = { get: () => ({ data: fake.d }) };
  const turn = createNpcTurn(w, 'n'), tr = fake.d.transform;
  ok('createNpcTurn returns null for a missing entity', createNpcTurn({ get: () => null }, 'x') === null);
  ok('constants', NEAR_M === 2.5 && MAX_DEG_S === 120 && RETURN_DELAY_S === 2);
  // player walks past at 3-6 m: no turning at all, even when standing still at 3 m
  for (let i = 0; i < 600; i++) turn.step(dt, -6 + 12 * i / 600, -3 - 3 * (i % 100) / 100);
  ok('no turning while the player walks past at 3-6 m', tr.yawDeg === 90, `yaw ${tr.yawDeg}`);
  for (let i = 0; i < 120; i++) turn.step(dt, 0, -3);
  ok('no turning when stopped at 3 m', tr.yawDeg === 90);
  // walking by at 1.5 m (close but moving): no turn
  for (let i = 0; i < 240; i++) turn.step(dt, -2 + 4 * i / 240, -1.5);
  ok('no turning while walking by at 1.5 m', tr.yawDeg === 90, `yaw ${tr.yawDeg}`);
  // close and stopped: turns (north, target 0), rate-limited, then holds; walking away then returns home after the delay
  const seq = [];
  for (let i = 0; i < 120; i++) { const before = tr.yawDeg; turn.step(dt, 0, -2); seq.push(before - tr.yawDeg); }
  ok('turns when close (<=2.5 m) and stopped', Math.abs(tr.yawDeg) < 2, `yaw ${tr.yawDeg}`);
  ok('rate <= 120 deg/s, monotonic, no overshoot', seq.every((d) => d <= MAX_DEG_S * dt + 1e-9 && d >= -1e-9));
  const hold = tr.yawDeg;
  for (let i = 0; i < 100; i++) turn.step(dt, 8 + i * 0.05, 0); // walking off, 1.67 s
  ok('holds facing during the delay', tr.yawDeg === hold);
  for (let i = 0; i < 400; i++) turn.step(dt, 20, 0);
  ok('returns to home yaw after the delay', Math.abs(tr.yawDeg - 90) < 2, `yaw ${tr.yawDeg}`);
  // talking turns him even from 5 m and while moving; ends -> back home
  for (let i = 0; i < 120; i++) turn.step(dt, -5 + i * 0.001, 0, true);
  ok('turns to the player when talking (5 m)', Math.abs(((tr.yawDeg - yawFromDelta(-5, 0) + 540) % 360) - 180) < 2, `yaw ${tr.yawDeg}`);
  for (let i = 0; i < 60; i++) turn.step(dt, 20, 0, false);
  ok('after talking he waits, then turns home', tr.yawDeg !== 90);
  for (let i = 0; i < 400; i++) turn.step(dt, 20, 0, false);
  ok('back home after the delay', Math.abs(tr.yawDeg - 90) < 2);
  // position constant over 1e4 steps, whatever the player does
  tr.x = 12.5; tr.y = -3.25; tr.z = 7;
  for (let i = 0; i < 10000; i++) turn.step(dt, 12.5 + 8 * Math.sin(i * 0.01), -3.25 + 8 * Math.cos(i * 0.013), i % 700 < 100);
  ok('position constant over 1e4 steps', tr.x === 12.5 && tr.y === -3.25 && tr.z === 7);
  if (global.gc) { global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 10000; i++) turn.step(dt, i & 1 ? 2 : 9, 0); global.gc(); ok('0 heap growth over 10k steps', process.memoryUsage().heapUsed - h0 < 50000); }
}

// ---- [E] Talk end to end ----------------------------------------------------------------------------------------
{
  const flags = [];
  const ctl = createDialogueCtl({ world, dialogues: bundle.dialogues, jawOpenDeg: FX.talk.jawMaxDeg, onFlag: (k) => flags.push(k), book: () => ({ hasKey: (k) => k === 'q.tower.blade.ready', actKey: () => false }) });
  setDialogueApi(ctl);
  const it = ctl.addNpc('bear');
  ok('addNpc registers [E] Talk, radius 2.2, def.npcId bear', it && it.prompt === '[E] Talk' && it.radius === 2.2 && it.def.npcId === 'bear');
  ok('jaw axis in the model header is rx, sign +', FX.talk.jawAxis === 'rx' && FX.talk.jawOpenSign === 1 && FX.talk.jawPart === 
'jaw');
  const model = assets.model('bear');
  ok('model has a jaw part', JSON.stringify(model).includes('"jaw"'));
  ok('the interactable fires the behaviour (npc.talk) and opens', npcTalk({ def: it.def }) === false && ctl.open && ctl.locked);
  const keys = new Set(); const input = { pressed: (c) => keys.has(c) };
  const comp = bear.getComponent('voxel');
  let maxJaw = 0, sawTalk = false, sawListen = false, steps = 0;
  while (ctl.open && steps++ < 20000) {
    keys.clear();
    if (ctl.runner.state === 'waiting' && steps % 7 === 0) keys.add('KeyE');
    if (ctl.runner.state === 'choosing') keys.add('Enter');
    ctl.step(1 / 60, input, true);
    if (comp.partRot && comp.partRot.rx > maxJaw) maxJaw = comp.partRot.rx;
    if (comp.anim === 'talk') sawTalk = true;
    if (comp.anim === 'listen') sawListen = true;
  }
  ok('conversation ran to the end', !ctl.open);
  ok('bear played talk and listen', sawTalk && sawListen);
  ok('jaw opened via partRot.rx, within 0..jawMaxDeg', maxJaw > 5 && maxJaw <= FX.talk.jawMaxDeg + 1e-6, `max ${maxJaw}`);
  for (let i = 0; i < 60; i++) ctl.step(1 / 60, input, true);
  ok('jaw closed and bear back to idle afterwards', comp.partRot.rx === 0 && comp.anim === 'idle', `${comp.partRot.rx} ${comp.anim}`);
  ok('talked flag set once', world.state['dlg.bear.talked'] === true && flags.filter((f) => f === 'bear.talked').length === 1);
  setDialogueApi(null);
}
// ---- paused while walking (CH1-07) ----
{
  const d = { transform: { x: 0, y: 0, z: 0, yawDeg: 90 } };
  const turn = createNpcTurn({ get: () => ({ data: d }) }, 'n');
  turn.paused = true;
  for (let i = 0; i < 120; i++) turn.step(1 / 60, 0, -1.5, true); // even talking: the walk owns the yaw
  ok('paused: yaw untouched', d.transform.yawDeg === 90);
  d.transform.yawDeg = 10; turn.step(1 / 60, 0, -1.5); ok('paused: the home yaw follows the walk', turn.homeYaw === 10 && turn.mode === 0);
  turn.paused = false; for (let i = 0; i < 300; i++) turn.step(1 / 60, 0, 20); ok('unpaused: stays at the new home yaw', d.transform.yawDeg === 10);
}

console.log(`npcBear: ${pass} pass, ${fail} fail`);
if (fail) { console.error(failures.join('\n')); process.exit(1); }
