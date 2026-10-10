// CH1-04b: dormant meadow stone: waystoneTouch skips it until woken, relayWake kind:'stone' (talk gate + crystal gate), reload awake.
// Run: node game/js/quest/stoneWake.test.js
import assert from 'node:assert/strict';
import { createRelayWake, FLAG_ATTUNED, FLAG_STONE_TOLD } from './relayWake.js';
import { createWaystoneTouch } from '../waystoneTouch.js';
import { createNoticeView } from '../ui/noticeView.js';

const model = { voxel: { animations: { wake: { durations: [125, 125, 125, 125], events: { glowOn: 2 }, loop: false }, awake: { loop: true } } } };
function mk(state = {}) {
  const ent = { id: 'endMarker', transform: { x: 5, y: 6, z: 1 }, components: { voxel: { model: 'waystone', anim: 'dead', playing: true },
    light: { preset: 'waystone', on: false }, waystone: { id: 'waystone', kind: 'stone', dormant: true, notice: 'waystone' } } };
  const log = [], recs = [], emits = [], flags = [];
  const world = { state, assets: { has: () => true, model: () => model }, forEachEntity: (fn) => fn(ent, ent.id),
    get: () => ({ data: ent, play(a) { log.push(a); ent.components.voxel.anim = a; ent.components.voxel.playing = true; } }),
    addInteractable: (s) => { const r = { ...s }; recs.push(r); return r; } };
  const notice = createNoticeView();
  const rw = createRelayWake({ world, palette: { lights: { waystone: { intensity: 0.6, grow: { duration: 0.75 } } } }, notice, hum() {},
    emit: (id, kind) => emits.push([id, kind]), questFlag: (k) => { flags.push(k); state[k] = true; } });
  return { ent, rw, world, recs, log, emits, notice, flags, state };
}

// interactable shape + gates
{ const t = mk(); assert.equal(t.recs.length, 1); assert.equal(t.recs[0].key, 'stone.waystone'); assert.equal(t.recs[0].requires, FLAG_STONE_TOLD);
  assert.equal(t.rw.interact('waystone'), false, 'no talk, no crystal: nothing');
  t.state[FLAG_STONE_TOLD] = true; assert.equal(t.rw.interact('waystone'), false, 'talk but no crystal: nothing');
  assert.equal(t.emits.length, 0); assert.equal(t.notice.active, false); }

// wake once: clip, flag, touch as a waystone, notice 'waystone'
{ const t = mk({ [FLAG_STONE_TOLD]: true, [FLAG_ATTUNED]: true });
  assert.equal(t.rw.interact('waystone'), true);
  assert.deepEqual(t.log, ['wake']); assert.deepEqual(t.emits, [['waystone', 'waystone']]); assert.deepEqual(t.flags, ['waystone.waystone.woken']);
  assert.equal(t.notice.active, true); assert.equal(t.notice.title, 'WAYSTONE AWAKENED'); assert.equal(t.recs[0].requires, undefined);
  assert.equal(t.rw.interact('waystone'), false, 'no replay while waking'); assert.equal(t.emits.length, 1);
  for (let i = 0; i < 400; i++) { t.rw.step(1 / 60, null); if (t.ent.components.voxel.anim === 'wake' && i > 20) t.ent.components.voxel.playing = false; }
  assert.equal(t.ent.components.voxel.anim, 'awake'); assert.equal(t.ent.components.light.on, true);
  assert.equal(t.rw.interact('waystone'), true); assert.equal(t.emits.length, 2, 'awake E = plain touch'); assert.equal(t.log.filter((x) => x === 'wake').length, 1); }

// reload / old save: woken flag -> awake, light on, no gate, no wake clip, no notice
{ const t = mk({ 'waystone.waystone.woken': true }); assert.equal(t.ent.components.voxel.anim, 'awake'); assert.equal(t.ent.components.light.on, true);
  assert.equal(t.recs[0].requires, undefined); assert.equal(t.notice.active, false); assert.deepEqual(t.log, ['awake']); }

// a stone without dormant stays out of relayWake (non-CH1 data)
{ const t = mk(); t.ent.components.waystone.dormant = false; const w2 = createRelayWake({ world: t.world, emit() {} }); assert.equal(w2.relays.length, 0); }

// waystoneTouch: skips the dormant stone (walk-in and E) until woken
{
  const ev = [], hooks = { emitSimple: (...a) => ev.push(a) };
  const state = {}, tr = { x: 0, y: 0, z: 0 }, player = { transform: { x: 0, y: 0, z: 0 } };
  const world = { state, forEachEntity: (fn) => fn({ id: 'endMarker', transform: tr, components: { waystone: { id: 'waystone', kind: 'stone', dormant: true } } }) };
  const cs = { world, player, state: { interactPressed: true } };
  const wt = createWaystoneTouch(hooks); wt.onBoot(cs);
  wt.onTick(); assert.equal(ev.length, 0, 'dormant: no touch even on E'); 
  state['waystone.waystone.woken'] = true; wt.onTick(); assert.equal(ev.length, 1); assert.equal(ev[0][1], 'waystone');
}
console.log('stoneWake: PASS');
