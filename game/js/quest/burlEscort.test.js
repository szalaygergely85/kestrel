// burlEscort.test.js (CH1-07): phases 0-4, wait/resume, barks once, load per phase, auto-open, 0 alloc.
import assert from 'node:assert/strict';
import { createNpcWalk } from './npcWalk.js';
import { createBurlEscort, CALL_NEAR_M } from './burlEscort.js';

const DT = 1 / 60;
function mk(state0 = {}, o = {}) {
  const state = Object.assign({}, state0), flags = [], played = [], opened = [];
  const ent = { transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel: { anim: 'idle', hidden: false },
    collider: { h: 1.6, r: 0.7, kinematic: true },
    walks: { follow: [[0, 0], [10, 0], [20, 0], [30, 0]], depart: [[30, 0], [30, 10], [30, 25]] },
    walkBarks: { follow: { 1: 'bear.walk1', 3: 'bear.walk2' } } } };
  const world = { state, terrain: { groundAt: () => 0 }, get: () => ({ data: ent }), setEntityCollider: () => true };
  const barks = { play: (id) => { if (state['bark.' + id]) return false; state['bark.' + id] = true; played.push(id); return true; } };
  const walk = createNpcWalk(world, 'bear', { barks });
  const questFlag = (k) => { flags.push(k); state[k] = true; };
  const st = { dialogueOpen: false, afterLeave: true };
  const e = createBurlEscort(Object.assign({ world, walk, questFlag, barks, id: 'bear',
    x: () => ent.transform.x, y: () => ent.transform.y, dialogueOpen: () => st.dialogueOpen, afterLeave: () => st.afterLeave,
    requestOpen: (id) => opened.push(id) }, o));
  return { e, state, flags, played, opened, ent, walk, st, world };
}
const run = (c, sec, px, py = 0) => { for (let i = 0; i < Math.round(sec * 60); i++) c.e.step(DT, typeof px === 'function' ? px() : px, py); };
const follow = (c) => () => c.ent.transform.x - 3;

// bear.call: only after leave, within 14 m, once
{
  const c = mk(); c.st.afterLeave = false;
  run(c, 1, 5); assert.deepEqual(c.played, []);
  c.st.afterLeave = true; run(c, 1, CALL_NEAR_M + 2); assert.deepEqual(c.played, []);
  run(c, 1, CALL_NEAR_M - 1); assert.deepEqual(c.played, ['bear.call']);
  run(c, 1, 5); assert.deepEqual(c.played, ['bear.call'], 'once');
  assert.equal(c.e.phase, 0);
}
// escort: follow flag starts phase 1, waits for the player, barks once, arrives -> phase 2 + burl.arrived
{
  const c = mk({ 'burl.follow': true });
  run(c, 0.1, 0); assert.equal(c.e.phase, 1); assert.ok(c.e.busy);
  run(c, 15, 0); // player stays home: Burl waits ~10 m out
  assert.ok(c.walk.waiting && c.ent.transform.x < 12 && c.e.phase === 1, 'waits ' + c.ent.transform.x);
  const wp = c.state['burl.wp']; assert.ok(wp >= 0);
  run(c, 40, follow(c)); assert.equal(c.e.phase, 2); assert.ok(c.state['burl.arrived']); assert.equal(c.state['burl.wp'], 3);
  assert.deepEqual(c.played, ['bear.walk1', 'bear.walk2'].filter((b) => c.played.includes(b)));
  assert.equal(c.played.filter((x) => x === 'bear.walk1').length, 1); assert.equal(c.played.filter((x) => x === 'bear.walk2').length, 1);
  assert.equal(c.flags.filter((f) => f === 'burl.arrived').length, 1); assert.ok(!c.e.busy);
  // stone talk auto-open: not while far, once within 4 m, re-arms after 7 m, stops after bear.stone.told
  assert.deepEqual(c.opened, ['bear'], 'the player walked up with him: opened on arrival'); run(c, 1, 28); assert.equal(c.opened.length, 1, 'latched');
  run(c, 1, 0); assert.equal(c.opened.length, 1, 'far: nothing'); run(c, 1, 28); assert.equal(c.opened.length, 2, 're-armed after leaving');
  c.state['bear.stone.told'] = true; run(c, 1, 0); run(c, 1, 28); assert.equal(c.opened.length, 2, 'told: no more');
  // departure waits for the dialogue to close, then walks depart and hides at the end
  c.state['burl.depart'] = true; c.st.dialogueOpen = true; run(c, 1, 28); assert.equal(c.e.phase, 2);
  c.st.dialogueOpen = false; run(c, 0.1, 28); assert.equal(c.e.phase, 3); assert.ok(c.state['burl.departing']);
  run(c, 40, 28); assert.equal(c.e.phase, 4); assert.equal(c.ent.components.voxel.hidden, true);
  assert.equal(c.ent.transform.y, 25);
}
// load rules
{
  let c = mk({ 'burl.phase': 1, 'burl.wp': 2 }); c.e.load();
  assert.equal(c.ent.transform.x, 20); assert.equal(c.walk.wp, 2); assert.equal(c.e.phase, 1);
  run(c, 12, follow(c)); assert.equal(c.e.phase, 2, 'resumes and finishes');
  assert.ok(!c.played.includes('bear.walk1'), 'passed bark not replayed');
  c = mk({ 'burl.phase': 2, 'burl.wp': 3, 'burl.arrived': true }); c.e.load();
  assert.equal(c.ent.transform.x, 30); assert.equal(c.ent.components.voxel.hidden, false); assert.ok(!c.e.busy);
  for (const p of [3, 4]) { c = mk({ 'burl.phase': p }); c.e.load(); assert.equal(c.ent.components.voxel.hidden, true, 'phase ' + p); assert.equal(c.e.phase, 4); }
  c = mk(); c.e.load(); assert.equal(c.ent.components.voxel.hidden, false); assert.equal(c.e.phase, 0);
}
// 0 allocation per step at home (proximity) and while waiting
{
  const c = mk(); c.st.afterLeave = false;
  for (let i = 0; i < 30000; i++) c.e.step(DT, 50, 0);
  if (global.gc) {
    let best = Infinity;
    for (let r = 0; r < 3; r++) { global.gc(); const m = process.memoryUsage().heapUsed; for (let i = 0; i < 20000; i++) c.e.step(DT, 50, 0); best = Math.min(best, process.memoryUsage().heapUsed - m); }
    assert.ok(best < 100000, 'heap flat: ' + best);
  }
}
console.log('burlEscort ALL PASS');
