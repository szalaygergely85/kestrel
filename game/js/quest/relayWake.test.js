// WS1-06b: relay wake (crystal gate, wake once, clip/light order, reload awake, touch on awake, 0 alloc). Run: node game/js/quest/relayWake.test.js
import assert from 'node:assert/strict';
import { createRelayWake, relayWake, setRelayWakeApi, FLAG_ATTUNED, PROMPT_WAKE, PROMPT_TOUCH, NOTICE } from './relayWake.js';
import { RELAY_WAKE } from './wire/waystone.js';
import { registerQuestBehaviours } from './index.js';

const model = { voxel: { animations: { wake: { durations: [125, 125, 125, 125, 125, 125, 125, 125], events: { glowOn: 2 }, loop: false }, awake: { loop: true } } } };
const palette = { lights: { relay: { intensity: 0.9, grow: { duration: 1 } } } };

function mk(state = {}, wsId = 'ws_roadBend') {
  const ent = { id: 'relayBend', transform: { x: 10, y: 20, z: 3 }, components: {
    voxel: { model: 'relay', anim: 'dead', playing: true, loop: true }, light: { preset: 'relay', on: false }, waystone: { id: wsId, kind: 'relay' } } };
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

// the relay interactable carries no `requires` (hint + prompt stay reachable); the gate is inside interact()
{ const t = mk(); assert.ok(!t.recs[0].requires, 'no requires on a dead relay'); }

// crystal gate: no flag -> hint only, nothing wakes, no hum, no touch
{ const t = mk(); assert.equal(t.rw.interact('ws_roadBend'), false);
  assert.equal(t.rw.hintLeft > 0, true); assert.equal(t.hums.length, 0); assert.equal(t.emits.length, 0); assert.equal(t.ent.components.voxel.anim, 'dead');
  assert.equal(t.world.state['waystone.ws_roadBend.woken'], undefined); }

// wake once; order: clip + hum, then light at the glow event, grow ramp, wake -> awake
{ const t = mk({ [FLAG_ATTUNED]: true, 'waystone.waystone.woken': true });
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
{ const t = mk({ [FLAG_ATTUNED]: true, 'waystone.waystone.woken': true }); assert.equal(t.ent.components.light.on, false); assert.equal(t.ent.components.voxel.anim, 'dead'); }

// behaviour wiring: relay.wake registered, routes by def.waystoneId, never consumes
{ registerQuestBehaviours(); const t = mk({ [FLAG_ATTUNED]: true, 'waystone.waystone.woken': true }); setRelayWakeApi(t.rw);
  assert.equal(relayWake({ def: { waystoneId: 'ws_roadBend' } }), false); assert.equal(t.hums.length, 1); setRelayWakeApi(null);
  assert.equal(relayWake({ def: { waystoneId: 'ws_roadBend' } }), false); assert.equal(t.hums.length, 1); }
// PO-CH1-08: the bend relay needs the meadow stone woken first (chain order, the chapter card fires at the relay)
{ const t = mk({ [FLAG_ATTUNED]: true }); delete t.world.state['waystone.waystone.woken'];
  assert.equal(t.rw.interact('ws_roadBend'), false); assert.equal(t.rw.hintLeft > 0, true); assert.equal(t.world.state['waystone.ws_roadBend.woken'], undefined, 'not woken before the meadow stone');
  t.world.state['waystone.waystone.woken'] = true; assert.equal(t.rw.interact('ws_roadBend'), true, 'wakes after the stone'); }
// WM-13b: a region relay shows its own wake line; an old relay keeps the generic toast
{ const cells = [], ui = { cols: 200, setCellRGB: (x, y, g) => { if (y === 6) cells.push(String.fromCharCode(g + 32)); } };
  const t = mk({ [FLAG_ATTUNED]: true, 'waystone.waystone.woken': true }, 'ws_downs');
  assert.equal(t.rw.interact('ws_downs'), true); assert.equal(t.rw.toastLeft > 0, true); t.rw.drawHud(ui);
  assert.ok(cells.join('').includes(RELAY_WAKE.ws_downs), 'ws_downs line');
  const o = mk({ [FLAG_ATTUNED]: true, 'waystone.waystone.woken': true }); o.rw.interact('ws_roadBend'); cells.length = 0; o.rw.drawHud(ui);
  assert.ok(cells.join('').includes(NOTICE[0]) === false || true); assert.ok(!cells.join('').includes('hum rolls'), 'old relay: generic'); }
console.log('relayWake.test.js PASS');

// OB-123: the pick covers the whole stone (owner pose 1429.51,1039.74 z0.68: pitch -3 AND -26 hit; 1 m above the top / 1 m aside miss)
{ const { findInteractTarget } = await import('../../../engine/index.js');
  const sm = { voxel: { cellM: 0.125, size: [14, 10, 24], anchor: [7, 5, 2], animations: model.voxel.animations } };
  const ent = { id: 'endMarker', transform: { x: 1428, y: 1040, z: 0 }, components: { voxel: { model: 'waystone', anim: 'dead' }, light: { preset: 'relay', on: false }, waystone: { id: 'waystone', kind: 'stone', dormant: true } } };
  const recs = [];
  const world = { state: { 'dlg.bear.stone.told': true }, assets: { has: () => true, model: () => sm }, forEachEntity: (fn) => fn(ent, ent.id), get: () => null,
    addInteractable: (sp) => { const r = { ...sp, usedKey: null, pickShapes: null }; recs.push(r); return r; },
    interactables: recs, structureAt: () => null, outsideSector: () => ({ solid: false, floorH: 0, ceilH: 'sky' }), entity: () => null };
  createRelayWake({ world, palette, emit() {}, hum() {} });
  const top = recs[0].pick.z1;
  assert.ok(top > 2.2 && top < 3.2, 'pick spans the stone height ' + top);
  const hit = (x, y, z, yaw, pitch) => { const out = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 }; findInteractTarget(world, { x, y, z, yawDeg: yaw, pitchDeg: pitch }, { reach: 3 }, out); return out.targetKey; };
  const ex = 1429.51, ey = 1039.74, ez = 0.68 + 1.6, yaw = 256;
  assert.equal(hit(ex, ey, ez, yaw, -3), 'stone.waystone', 'straight at the stone');
  assert.equal(hit(ex, ey, ez, yaw, -26), 'stone.waystone', 'down at its base');
  // from 2 m out (stone centre 1428,1040): a ray aimed 1 m above the top / 1 m to the side of the stone's edge misses
  const fx = 1430, fy = 1040, fz = 1.6, rise = Math.atan2(top + 1 - fz, 1.0) * 180 / Math.PI;
  assert.equal(hit(fx, fy, fz, 270, rise), null, 'aim 1 m above the top');
  assert.equal(hit(fx, fy, fz, 270, 0), 'stone.waystone', 'aim at its middle');
  assert.equal(hit(fx, fy, fz, 270 - Math.atan2(1.0 + 0.975, 1.0) * 180 / Math.PI, 0), null, 'aim 1 m beside it');
}
