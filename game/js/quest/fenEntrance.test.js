// CH1-08b: Fen hidden until the relay wakes (+ notice gone), emerge walk, auto-open once per approach, load rules. Run: node game/js/quest/fenEntrance.test.js
import assert from 'node:assert/strict';
import { createNpcWalk } from './npcWalk.js';
import { createFenEntrance } from './fenEntrance.js';

const DT = 1 / 60;
function mk(state0 = {}) {
  const state = { ...state0 }, opened = [], talk = [];
  const ent = { transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel: { anim: 'idle', hidden: true }, collider: { h: 1.8, r: 0.45, kinematic: true },
    walks: { emerge: [[0, 0], [4, 0], [8, 0], [12, 0]] } } };
  const parked = [];
  const world = { state, terrain: { groundAt: () => 0 }, get: () => ({ data: ent }), setEntityCollider: (id, x, y, z) => { parked.push(z); return true; } };
  const walk = createNpcWalk(world, 'fen', {});
  const ui = { busy: false, open: false };
  const f = createFenEntrance({ world, walk, id: 'fen', x: () => ent.transform.x, y: () => ent.transform.y, requestOpen: (id) => opened.push(id),
    addTalk: () => talk.push(1), noticeBusy: () => ui.busy, dialogueOpen: () => ui.open });
  f.load();
  return { f, state, ent, opened, talk, ui, parked };
}
const run = (c, sec, px = 100, py = 0) => { for (let i = 0; i < Math.round(sec * 60); i++) c.f.step(DT, px, py); };

// relay dead: hidden, collider parked, nothing happens
{ const c = mk(); assert.equal(c.ent.components.voxel.hidden, true); assert.ok(c.parked.at(-1) < -100); run(c, 5);
  assert.equal(c.f.started, false); assert.equal(c.ent.components.voxel.hidden, true); assert.deepEqual(c.opened, []); }

// relay woken, notice showing: waits; then emerges (visible, walking), arrives, adds the talk interactable
{ const c = mk(); c.state['waystone.ws_roadBend.woken'] = true; c.ui.busy = true; run(c, 1);
  assert.equal(c.f.started, false, 'waits for the notice to go');
  c.ui.busy = false; run(c, 0.5); assert.equal(c.f.started, true);
  assert.equal(c.ent.components.voxel.hidden, false); assert.equal(c.ent.components.voxel.anim, 'walk'); assert.ok(c.ent.transform.x > 0);
  run(c, 12); assert.equal(c.f.ready, true); assert.equal(c.talk.length, 1); assert.ok(Math.abs(c.ent.transform.x - 12) < 0.6); }

// auto-open: not while far, once within 4 m, re-arms after 7 m, never once met
{ const c = mk(); c.state['waystone.ws_roadBend.woken'] = true; run(c, 14, 100);
  assert.deepEqual(c.opened, []); run(c, 1, 12 + 3); assert.deepEqual(c.opened, ['fen']); run(c, 1, 14);
  assert.equal(c.opened.length, 1, 'latched'); run(c, 1, 30); run(c, 1, 14); assert.equal(c.opened.length, 2);
  c.state['fen.met'] = true; run(c, 1, 30); run(c, 1, 14); assert.equal(c.opened.length, 2, 'met: no more'); }

// load: met -> standing at the end, talk ready; not met + relay woken -> emerges again; mid-state restore never plays twice
{ const c = mk({ 'fen.met': true, 'waystone.ws_roadBend.woken': true }); assert.equal(c.ent.components.voxel.hidden, false);
  assert.equal(c.ent.transform.x, 12); assert.equal(c.f.ready, true); assert.equal(c.talk.length, 1); }
{ const c = mk({ 'waystone.ws_roadBend.woken': true }); assert.equal(c.f.started, true); assert.equal(c.ent.components.voxel.hidden, false); assert.equal(c.ent.transform.x, 0);
  run(c, 12); assert.equal(c.f.ready, true); }
console.log('fenEntrance: PASS');
