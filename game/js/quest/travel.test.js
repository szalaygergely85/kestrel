// WS1-07b: travel state machine (timings, gates, one request at a time, teleport once, arrive/respawn, bounds, 0 alloc).
import assert from 'node:assert/strict';
import { createTravel, TOAST_HERE } from './travel.js';

const anchors = { a: { x: 10, y: 10, z: 1, yawDeg: 90 }, b: { x: 100, y: 10, z: 2, yawDeg: 0 }, out: { x: 9999, y: 0, z: 0, yawDeg: 0 } };
function rig(over = {}) {
  const log = { tele: [], arrive: [] }, pos = { x: 10, y: 11 };
  let ok = true;
  const tr = createTravel({
    canTravel: () => ok, anchorOf: (id) => anchors[id] || null, playerPos: () => pos,
    teleport: (p) => { log.tele.push(p); pos.x = p.x; pos.y = p.y; },
    arrive: (id, p) => log.arrive.push([id, p]),
    inBounds: (p) => Math.abs(p.x) < 500, ...over,
  });
  return { tr, log, pos, block: (v) => { ok = !v; } };
}

{ // timings: 0.35 s out, teleport once at black, 0.35 s in
  const { tr, log } = rig();
  assert.equal(tr.request('b'), 'ok');
  assert.equal(tr.phase, 'out'); assert.ok(tr.inputLocked); assert.equal(tr.alpha, 0);
  const dt = 1 / 60; let n = 0, black = 0;
  while (tr.phase === 'out') { tr.step(dt); n++; assert.ok(n < 100); }
  assert.ok(Math.abs(n * dt - 0.35) <= dt + 1e-9, 'fade out 0.35 s, got ' + n * dt);
  assert.equal(log.tele.length, 1); assert.equal(log.arrive.length, 1);
  assert.deepEqual(log.tele[0], anchors.b); assert.equal(log.arrive[0][0], 'b');
  assert.equal(tr.phase, 'in'); assert.ok(tr.inputLocked);
  let m = 0; while (tr.phase === 'in') { tr.step(dt); m++; assert.ok(m < 100); if (tr.alpha >= 0.996) black++; }
  assert.ok(Math.abs(m * dt - 0.35) <= dt + 1e-9, 'fade in 0.35 s');
  assert.equal(tr.phase, 'idle'); assert.ok(!tr.inputLocked); assert.equal(tr.alpha, 0);
  assert.equal(log.tele.length, 1, 'teleport called once'); assert.equal(tr.teleports, 1);
}
{ // alpha is monotone up then down and reaches full black at the jump
  const { tr } = rig(); tr.request('b'); let prev = 0, peak = 0;
  for (let i = 0; i < 20; i++) { tr.step(1 / 60); assert.ok(tr.alpha >= prev - 1e-9); prev = tr.alpha; peak = Math.max(peak, prev); }
  assert.ok(peak > 0.99);
}
{ // one request at a time
  const { tr, log } = rig(); assert.equal(tr.request('b'), 'ok');
  assert.equal(tr.request('a'), 'busy'); tr.step(0.2); assert.equal(tr.request('a'), 'busy');
  tr.step(0.2); assert.equal(tr.request('a'), 'busy', 'busy during fade in');
  tr.step(0.4); assert.equal(tr.phase, 'idle'); assert.equal(log.tele.length, 1);
  assert.equal(tr.request('a'), 'ok', 'free again after the fade');
}
{ // gates
  const r = rig(); r.block(true);
  assert.equal(r.tr.request('b'), 'blocked'); assert.equal(r.tr.phase, 'idle'); assert.equal(r.log.tele.length, 0);
  r.block(false);
  assert.equal(r.tr.request('nope'), 'unknown');
  assert.equal(r.tr.request('out'), 'bounds', 'target outside bounds refused');
  assert.equal(r.tr.phase, 'idle');
}
{ // already here: within 6 m -> toast, no fade, no teleport
  const r = rig();
  assert.equal(r.tr.request('a'), 'here'); assert.equal(r.tr.phase, 'idle'); assert.ok(r.tr.toastLeft > 0);
  assert.equal(r.log.tele.length, 0); assert.equal(TOAST_HERE, 'Already here.');
  r.tr.step(3); assert.ok(r.tr.toastLeft <= 0, 'toast times out');
}
{ // draw: dither + toast use setCellRGB only; no allocation in step
  const cells = []; const ui = { cols: 40, rows: 12, setCellRGB: (...a) => cells.push(a) };
  const r = rig(); r.tr.request('a'); r.tr.draw(ui); assert.ok(cells.length > 0, 'toast drawn');
  cells.length = 0; r.tr.request('b'); r.tr.step(0.36); r.tr.draw(ui);
  assert.equal(cells.length, 40 * 12, 'solid black at the jump');
  const q = rig(); q.tr.request('b'); q.tr.step(0.1); global.gc && global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100000; i++) { q.tr.step(0); q.tr.alpha; }
  assert.ok(process.memoryUsage().heapUsed - h0 < 2e6, 'step is allocation-free');
}
{ // WS2-05: fade-in waits for the terrain band (fake world); no bandReady = byte-identical timing
  let ready = false, polls = 0; const dt = 1 / 60;
  const r = rig({ bandReady: () => { polls++; return ready; } });
  r.tr.request('b'); while (r.tr.phase === 'out') r.tr.step(dt);
  assert.equal(r.tr.phase, 'in');
  for (let i = 0; i < 120; i++) r.tr.step(dt); // 2 s with the band still baking
  assert.equal(r.tr.phase, 'in'); assert.equal(r.tr.alpha, 1, 'stays black while waiting'); assert.ok(r.tr.inputLocked); assert.ok(polls >= 120);
  ready = true; let n = 0; while (r.tr.phase === 'in') { r.tr.step(dt); n++; assert.ok(n < 100); }
  assert.ok(Math.abs(n * dt - 0.35) <= dt + 1e-9, 'fade-in runs its full 0.35 s once ready'); assert.equal(r.log.tele.length, 1);
  const q = rig({ bandReady: () => true }); q.tr.request('b'); q.tr.step(0.36); global.gc && global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100000; i++) { q.tr.step(0); q.tr.alpha; }
  assert.ok(process.memoryUsage().heapUsed - h0 < 2e6, 'step with bandReady is allocation-free');
}
console.log('travel.test.js ok');
