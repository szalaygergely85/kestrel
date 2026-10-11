// burlEscort.test.js (CH1-07): phases 0-4, wait/resume, barks once, load per phase, auto-open, 0 alloc.
import assert from 'node:assert/strict';
import { createNpcWalk } from './npcWalk.js';
import { createBurlEscort, CALL_NEAR_M, HOME_FAR_M, BEND_FLAG } from './burlEscort.js';

const DT = 1 / 60;
function mk(state0 = {}, o = {}) {
  const state = Object.assign({}, state0), flags = [], played = [], opened = [];
  const ent = { transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel: { anim: 'idle', hidden: false },
    collider: { h: 1.6, r: 0.7, kinematic: true },
    walks: { follow: [[0, 0], [10, 0], [20, 0], [30, 0]], depart: [[30, 0], [30, 10], [30, 25]] },
    walkBarks: { follow: { 1: 'bear.walk1', 3: 'bear.walk2' } } } };
  const world = { state, terrain: { groundAt: () => 0 }, get: () => ({ data: ent }), setEntityCollider: () => true };
  const barks = { play: (id, who, repeat) => { if (!repeat) { if (state['bark.' + id]) return false; state['bark.' + id] = true; } played.push(id); return true; } };
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
  assert.deepEqual(c.played.filter((b) => b !== 'bear.wait'), ['bear.walk1', 'bear.walk2'].filter((b) => c.played.includes(b)));
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
  // QL-05: a fresh load after the departure puts Burl on her slope (walks.follow[0]), talkable, flag burl.home
  for (const p of [3, 4, 5]) { let back = 0; c = mk({ 'burl.phase': p }, { restore: () => back++ }); c.ent.transform.x = 77; c.e.load(); assert.equal(c.ent.components.voxel.hidden, false, 'phase ' + p); assert.equal(c.e.phase, 5); assert.equal(c.ent.transform.x, 0); assert.ok(c.state['burl.home'] && c.flags.includes('burl.home') && back === 1); }
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
// AUD-06: hold (dialogue/menu open) -> no bark, no walking
{
  const c = mk(); c.st.afterLeave = true;
  for (let i = 0; i < 120; i++) c.e.step(DT, 5, 0, true); assert.deepEqual(c.played, [], 'no bark while held');
  run(c, 1, 5); assert.ok(c.played.length >= 1, 'bark resumes when released');
}
// PO-CH1-08: stone woken -> Burl's goodbye talk opens by itself (after the notice), once per approach
{ let busy = true; const c = mk({ 'burl.phase': 2, 'dlg.bear.stone.told': true, 'waystone.waystone.woken': true }, { noticeBusy: () => busy }); c.e.load();
  for (let i = 0; i < 30; i++) c.e.step(DT, 29, 0, false); assert.deepEqual(c.opened, [], 'not while the notice is up');
  busy = false; for (let i = 0; i < 30; i++) c.e.step(DT, 29, 0, false); assert.deepEqual(c.opened, ['bear'], 'auto-opens once the notice is gone');
  for (let i = 0; i < 30; i++) c.e.step(DT, 29, 0, false); assert.equal(c.opened.length, 1, 'latched'); }
{ const c = mk({ 'burl.phase': 2, 'dlg.bear.stone.told': true, 'waystone.waystone.woken': true, 'burl.depart': true }); c.e.load();
  for (let i = 0; i < 30; i++) c.e.step(DT, 29, 0, false); assert.deepEqual(c.opened, [], 'no re-open once the departure is set'); }
console.log('burlEscort ALL PASS');

// PO-CH1-14: the player runs far ahead during the walk -> 'bear.wait' bark, at most once per 20 s
{
  const c = mk({ 'burl.follow': true });
  run(c, 0.1, 0); run(c, 5, 60); // 60 m away from Burl
  assert.equal(c.played.filter((b) => b === 'bear.wait').length, 1, 'one wait bark');
  run(c, 15, 60); assert.equal(c.played.filter((b) => b === 'bear.wait').length, 1, 'cooldown 20 s');
  run(c, 6, 60); assert.equal(c.played.filter((b) => b === 'bear.wait').length, 2, 'again after 20 s');
}

// QL-05: same session - she stays gone while the player is near the slope, reappears once the player is >= HOME_FAR_M away
{
  const c = mk({ 'burl.phase': 2, 'burl.wp': 3, 'burl.arrived': true, 'waystone.waystone.woken': true, 'dlg.bear.stone.told': true });
  c.e.load(); c.state['burl.depart'] = true; run(c, 0.1, 28); run(c, 40, 28);
  assert.equal(c.e.phase, 4); run(c, 2, 5); assert.equal(c.e.phase, 4, 'player near home: no pop-in');
  assert.equal(c.ent.components.voxel.hidden, true);
  run(c, 1, HOME_FAR_M + 5);
  assert.equal(c.e.phase, 5); assert.equal(c.ent.components.voxel.hidden, false); assert.equal(c.ent.transform.x, 0);
  assert.ok(c.state['burl.home'] && !c.state['burl.departing'] && c.flags.includes('burl.home'));
}
console.log('burlEscort QL-05 home switch ok');

// M4 sq.burl.walk: accepted (status 2) at home -> she leads along walks.toBend, waits when the player is > 14 m behind, fires the flag on arrival
{
  const qs = { v: 5 };
  const c = mk({ 'burl.phase': 5, 'burl.home': true }, { leadStatus: () => qs.v });
  c.ent.components.walks.toBend = [[0, 0], [8, 0], [16, 0], [24, 0], [32, 0], [40, 0], [48, 0]];
  run(c, 0.5, 0); assert.equal(c.e.phase, 5, 'quest not accepted: stays home');
  qs.v = 2; c.st.dialogueOpen = false;
  run(c, 0.1, 0); assert.equal(c.e.phase, 6); assert.ok(c.e.busy);
  run(c, 20, 0); // player stands at home: Burl stops ahead (WAIT 14 m) and idles
  assert.ok(c.walk.waiting && c.ent.transform.x > 8 && c.ent.transform.x < 20 && c.e.phase === 6, 'waits ' + c.ent.transform.x);
  assert.equal(c.ent.components.voxel.anim, 'idle');
  assert.ok(!c.flags.includes(BEND_FLAG));
  const px = () => c.ent.transform.x - 3; // the player follows
  run(c, 1, px); assert.equal(c.ent.components.voxel.anim, 'walk');
  run(c, 60, px);
  assert.equal(c.e.phase, 7); assert.ok(c.flags.includes(BEND_FLAG), 'arrival flag'); assert.equal(c.ent.transform.x, 48);
  // hand-in not done (status 3 ready): she stays at the Bend even with the player far away
  qs.v = 3; run(c, 2, 500); assert.equal(c.e.phase, 7);
  // save/load mid-walk resumes; load at the Bend places her there
  const c2 = mk({ 'burl.phase': 6, 'burl.lwp': 3 }, { leadStatus: () => 2 });
  c2.ent.components.walks.toBend = c.ent.components.walks.toBend; c2.e.load();
  assert.ok(c2.walk.active && c2.ent.transform.x >= 24, 'resumes at wp 3: ' + c2.ent.transform.x);
  const c3 = mk({ 'burl.phase': 7 }, { leadStatus: () => 3 });
  c3.ent.components.walks.toBend = c.ent.components.walks.toBend; c3.e.load(); assert.equal(c3.ent.transform.x, 48); assert.equal(c3.e.phase, 7);
  // hand-in done: she stays while the player is near, goes home (pop-in safe) once the player is >= HOME_FAR_M from the Bend and from home
  qs.v = 4; c.ent.components.walks.follow = [[0, 0], [10, 0]];
  run(c, 2, 49); assert.equal(c.e.phase, 7, 'player near: sits there');
  run(c, 1, 48, HOME_FAR_M + 5); assert.equal(c.e.phase, 5, 'player left: home'); assert.equal(c.ent.transform.x, 0);
  // abandoned mid-walk: back home at once
  const c4 = mk({ 'burl.phase': 5 }, { leadStatus: () => qs4.v }), qs4 = { v: 2 };
  c4.ent.components.walks.toBend = [[0, 0], [8, 0], [16, 0]];
  run(c4, 0.1, 0); run(c4, 3, 10); assert.equal(c4.e.phase, 6); qs4.v = 1; run(c4, 0.1, 10);
  assert.equal(c4.e.phase, 5); assert.equal(c4.ent.transform.x, 0);
}
console.log('burlEscort M4 lead-to-Bend ok');
