// CH1-MOUNT: the glue main.js relies on, with fake hooks. Run: node game/js/quest/ch1Mount.test.js
import assert from 'node:assert/strict';
import { createRelayWake, FLAG_ATTUNED } from './relayWake.js';
import { createCrystalGrant, FLAG_ATTUNED as CRYSTAL_FLAG } from './crystal.js';
import { createNoticeView } from '../ui/noticeView.js';

// 1) relay wake pushes the notice (not the toast) when one is injected
{
  const ent = { id: 'relayBend', transform: { x: 1, y: 2, z: 3 }, components: { voxel: { model: 'relay', anim: 'dead' }, light: { preset: 'relay', on: false }, waystone: { id: 'ws_roadBend', kind: 'relay' } } };
  const world = { state: { [FLAG_ATTUNED]: true, 'waystone.waystone.woken': true }, assets: { has: () => false }, forEachEntity: (fn) => fn(ent, ent.id),
    get: () => ({ data: ent, play() {} }), addInteractable: (s) => ({ ...s }) };
  const notice = createNoticeView();
  const rw = createRelayWake({ world, palette: { lights: {} }, emit() {}, hum() {}, notice });
  assert.equal(notice.active, false);
  assert.equal(rw.interact('ws_roadBend'), true);
  assert.equal(notice.active, true); assert.equal(notice.title, 'BEND RELAY AWAKENED');
  assert.equal(rw.toastLeft, 0, 'no old toast when the notice view is injected');
  // hidden (menu/dialogue open): timer paused
  notice.update(10, true); assert.equal(notice.active, true);
  notice.update(10, false); assert.equal(notice.active, false);
}

// 2) crystal check on boars-ready + each world:loaded: grants once, burst at the last boar
{
  const state = {}, got = [], bursts = [], toasts = [], flags = [];
  const c = createCrystalGrant({ world: { state }, addItem: (id) => got.push(id), questFlag: (k) => flags.push(k),
    burst: (x, y, z) => bursts.push([x, y, z]), toast: (k) => toasts.push(k) });
  c.noteBoar(4, 5, 6);
  assert.equal(c.check('active'), false, 'not ready: nothing');
  assert.equal(c.check('ready'), true);
  assert.deepEqual(got, ['aetherCrystal']); assert.deepEqual(bursts, [[4, 5, 6]]); assert.equal(toasts.length, 1);
  assert.deepEqual(flags, [CRYSTAL_FLAG]);
  assert.equal(c.check('ready'), false, 'world:loaded again: flag gates, no second grant');
  assert.equal(got.length, 1);
}
console.log('ch1Mount: PASS');
