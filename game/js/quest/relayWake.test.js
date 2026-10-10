// WS1-06b: relay wake (crystal gate, wake once, clip/light order, reload awake, touch on awake, 0 alloc). Run: node game/js/quest/relayWake.test.js
import assert from 'node:assert/strict';
import { createRelayWake, relayWake, setRelayWakeApi, FLAG_ATTUNED, PROMPT_WAKE, PROMPT_TOUCH, NOTICE } from './relayWake.js';
import { registerQuestBehaviours } from './index.js';

const model = { voxel: { animations: { wake: { durations: [125, 125, 125, 125, 125, 125, 125, 125], events: { glowOn: 2 }, loop: false }, awake: { loop: true } } } };
const palette = { lights: { relay: { intensity: 0.9, grow: { duration: 1 } } } };

function mk(state = {}) {
  const ent = { id: 'relayBend', transform: { x: 10, y: 20, z: 3 }, components: {
    voxel: { model: 'relay', anim: 'dead', playing: true, loop: true }, light: { preset: 'relay', on: false }, waystone: { id: 'ws_roadBend', kind: 'relay' } } };
  const log = [], recs = [];
  const world = { state, assets: { has: () => true, model: () => model },
    forEachEntity: (fn) => fn(ent, ent.id),
    get: (id) => (id === ent.id ? { data: ent, play(a) { log.push('play:' + a); ent.components.voxel.anim = a; ent.components.voxel.playing = true; } } : null),
    addInteractable: (s) => { const r = { ...s }; recs.push(r); return r; } };
  const lights = { entityHandle: new Map([[ent.id, 0]]), baseIntensity: new Float32Array(4) };
  const emits = [], hums = [];
  const rw = createRelayWake({ world, palette, emit: (id, kind, p) => emits.push([id, kind, p.x, p.y, p.z]), hum: () => { hums.push(1); log.push('hum'); } });
  return { ent, rw, world, lights, log, recs, emits, hums };
}

// interactable
{ const t = mk(); assert.equal(t.recs.length, 1); assert.equal(t.recs[0].key, 'relay.ws_roadBend'); assert.equal(t.recs[0].name, 'relay.wake');
  assert.equal(t.recs[0].radius, 2.2); assert.equal(t.recs[0].prompt, PROMPT_WAKE); assert.equal(t.recs[0].def.waystoneId, 'ws_roadBend'); }

// crystal gate: no flag -> hint only, nothing wakes, no hum, no touch
{ const t = mk(); assert.equal(t.rw.interact('ws_roadBend'), false);
  assert.equal(t.rw.hintLeft > 0, true); assert.equal(t.hums.length, 0); assert.equal(t.emits.length, 0); assert.equal(t.ent.components.voxel.anim, 'dead');
  assert.equal(t.world.state['waystone.ws_roadBend.woken'], undefined); }

// wake once; order: clip + hum, then light at the glow event, grow ramp, wake -> awake
{ const t = mk({ [FLAG_ATTUNED]: true });
  assert.equal(t.rw.interact('ws_roadBend'), true);
  assert.deepEqual(t.log, ['play:wake', 'hum']);
  assert.equal(t.ent.components.light.on, false, 'light waits for the glow event');
  assert.equal(t.world.state['waystone.ws_roadBend.woken'], true);
  assert.deepEqual(t.emits, [['ws_roadBend', 'relay', 10, 20, 3]]);
  assert.equal(t.rw.toastLeft > 0, true); assert.equal(NOTICE[0], 'BEND RELAY AWAKENED'); assert.equal(t.recs[0].prompt, PROMPT_TOUCH);
  assert.equal(t.rw.interact('ws_roadBend'), false, 'no replay while waking'); assert.equal(t.hums.length, 1);
  const dt = 1 / 60; let s = 0;
  for (; s < 10; s++) t.rw.step(dt, t.lights); // 0.167 s < 0.25 s
  assert.equal(t.ent.components.light.on, false);
  for (; s < 20; s++) t.rw.step(dt, t.lights); // 0.33 s
  assert.equal(t.ent.components.light.on, true);
  assert.ok(t.lights.baseIntensity[0] > 0 && t.lights.baseIntensity[0] < 0.9, 'growing');
  assert.equal(t.ent.components.voxel.anim, 'wake');
  t.ent.components.voxel.playing = false; // clip ends (1.0 s)
  t.rw.step(dt, t.lights); assert.equal(t.ent.components.voxel.anim, 'awake');
  for (s = 0; s < 120; s++) t.rw.step(dt, t.lights);
  assert.ok(Math.abs(t.lights.baseIntensity[0] - 0.9) < 1e-6, 'ramp reaches the preset intensity');
  assert.equal(t.rw.relays[0].phase, 2);
  // awake: E = touch only (no clip, no hum)
  t.log.length = 0;
  assert.equal(t.rw.interact('ws_roadBend'), true); assert.equal(t.emits.length, 2); assert.equal(t.hums.length, 1); assert.deepEqual(t.log, []);
  // 0 alloc per step
  if (global.gc) {
    global.gc(); const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200000; i++) t.rw.step(dt, t.lights);
    global.gc(); assert.ok(process.memoryUsage().heapUsed - h0 < 200000, 'step allocates nothing');
  }
}

// reload: woken relay comes back awake, light on, no hum, touch prompt
{ const t = mk({ 'waystone.ws_roadBend.woken': true });
  assert.equal(t.ent.components.light.on, true); assert.equal(t.ent.components.voxel.anim, 'awake'); assert.equal(t.hums.length, 0);
  assert.equal(t.recs[0].prompt, PROMPT_TOUCH); t.rw.step(1 / 60, t.lights); assert.ok(Math.abs(t.lights.baseIntensity[0] - 0.9) < 1e-6);
  assert.equal(t.rw.toastLeft, 0); }
// dead stays dead after reload without the woken flag
{ const t = mk({ [FLAG_ATTUNED]: true }); assert.equal(t.ent.components.light.on, false); assert.equal(t.ent.components.voxel.anim, 'dead'); }

// behaviour wiring: relay.wake registered, routes by def.waystoneId, never consumes
{ registerQuestBehaviours(); const t = mk({ [FLAG_ATTUNED]: true }); setRelayWakeApi(t.rw);
  assert.equal(relayWake({ def: { waystoneId: 'ws_roadBend' } }), false); assert.equal(t.hums.length, 1); setRelayWakeApi(null);
  assert.equal(relayWake({ def: { waystoneId: 'ws_roadBend' } }), false); assert.equal(t.hums.length, 1); }
console.log('relayWake.test.js PASS');
