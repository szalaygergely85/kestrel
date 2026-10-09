// D-050 gameHooks seam: order, unregister, throwing-handler isolation, respawn, no per-call allocation. Node, < 1 s.
import assert from 'node:assert/strict';
import { createGameHooks, bridgeEngineEvents, EVENT_NAMES } from './gameHooks.js';

const H = createGameHooks();
const log = [];
const off1 = H.register({ onBoot: (c) => log.push('a.boot:' + c.world), onTick: (dt) => log.push('a.tick:' + dt), onEvent: (n, d) => log.push('a.ev:' + n + ':' + d.id), drawHud: () => log.push('a.hud'), onRespawn: () => null });
H.register({ onBoot: () => log.push('b.boot'), onTick: () => log.push('b.tick'), onEvent: () => log.push('b.ev'), drawHud: () => log.push('b.hud'), onRespawn: () => ({ x: 1, y: 2, z: 3, yawDeg: 4 }) });
H.register({ onRespawn: () => ({ x: 9, y: 9, z: 9, yawDeg: 9 }) });

// order = registration order
H.boot('W', {}, null, null, null);
H.tick(0.5); H.emitSimple('area:entered', 'x'); H.drawHud({});
assert.deepEqual(log, ['a.boot:W', 'b.boot', 'a.tick:0.5', 'b.tick', 'a.ev:area:entered:x', 'b.ev', 'a.hud', 'b.hud']);
// first non-null respawn wins; null handler skipped
assert.deepEqual(H.respawn(), { x: 1, y: 2, z: 3, yawDeg: 4 });

// unregister
log.length = 0; off1(); H.tick(1);
assert.deepEqual(log, ['b.tick']);
assert.equal(H.count, 2);

// throwing handler: warned once, skipped afterwards, others still run
const warns = []; const realWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
const H2 = createGameHooks(); let calls = 0, ok = 0;
H2.register({ onTick: () => { calls++; throw new Error('boom'); }, onEvent: () => { throw new Error('ev'); }, onRespawn: () => { throw new Error('r'); } });
H2.register({ onTick: () => ok++, onRespawn: () => ({ x: 5, y: 5, z: 5, yawDeg: 0 }) });
for (let i = 0; i < 5; i++) H2.tick(1);
H2.emitSimple('beast:died', 'q'); H2.emitSimple('beast:died', 'q');
const rp = H2.respawn(); H2.respawn();
console.warn = realWarn;
assert.equal(calls, 1, 'throwing handler skipped after the first throw');
assert.equal(ok, 5, 'the healthy handler keeps running');
assert.equal(warns.length, 3, 'one warning per (handler, hook)');
assert.equal(rp.x, 5);

// payloads reused, requestSave reaches listeners, unregister inside a handler is safe
assert.strictEqual(H.payload('item:got'), H.payload('item:got'));
for (const n of EVENT_NAMES) assert.ok(H.payload(n), n);
let saves = 0; const offS = H.onSaveRequest(() => saves++);
H.ctx.requestSave(); H.ctx.requestSave(); offS(); H.ctx.requestSave();
assert.equal(saves, 2);
const seen = [];
H.register({ onEvent: (n, d) => seen.push(d) });
H.emitSimple('item:got', 'a', 2); H.emitSimple('item:got', 'b');
assert.strictEqual(seen[0], seen[1], 'same payload object reused');
assert.equal(seen[1].id, 'b'); assert.equal(seen[1].n, 1);
H.emitSimple('flag:set', 'wake', true); assert.equal(H.payload('flag:set').key, 'wake');
H.emitSimple('player:died', 1, 2, 3); assert.equal(H.payload('player:died').z, 3);
H.emitSimple('prop:touched', 'p1', 'waystone', { x: 1, y: 2, z: 3 }); assert.equal(H.payload('prop:touched').kind, 'waystone');
// no 4th arg (interaction:fired has no position) must not throw; missing coords -> 0,0,0
H.emitSimple('prop:touched', 'p2', 'lever');
assert.deepEqual([H.payload('prop:touched').x, H.payload('prop:touched').y, H.payload('prop:touched').z], [0, 0, 0]);

// bridge from the engine bus
const bus = { m: {}, on(n, f) { (this.m[n] ||= []).push(f); return () => {}; }, emit(n, p) { for (const f of this.m[n] || []) f(p); } };
const H3 = createGameHooks(); const got = []; H3.register({ onEvent: (n, d) => got.push(n + ':' + d.id + ':' + (d.n ?? '')) });
bridgeEngineEvents(bus, H3); bus.emit('beast:died', { id: 'boar1' }); bus.emit('inventory:added', { id: 'meat', n: 2 }); bus.emit('beast:died', {});
assert.deepEqual(got, ['beast:died:boar1:', 'item:got:meat:2']);
// interaction:fired {key, name} -> prop:touched {id:key, kind:name, x,y,z} (no position on the engine event -> 0,0,0)
bus.emit('interaction:fired', { key: 'lever1', name: 'lever' });
assert.equal(H3.payload('prop:touched').id, 'lever1'); assert.equal(H3.payload('prop:touched').kind, 'lever');
assert.deepEqual([H3.payload('prop:touched').x, H3.payload('prop:touched').y, H3.payload('prop:touched').z], [0, 0, 0]);

// no per-call allocation on the hot path (tick / emitSimple / drawHud with 3 handlers)
const H4 = createGameHooks(); let n4 = 0; const hud = {};
for (let i = 0; i < 3; i++) H4.register({ onTick: () => n4++, onEvent: () => n4++, drawHud: () => n4++ });
const run = () => { for (let i = 0; i < 20000; i++) { H4.tick(0.016); H4.emitSimple('item:got', 'a', 1); H4.drawHud(hud); } };
run(); if (global.gc) global.gc();
const before = process.memoryUsage().heapUsed; run();
const grown = process.memoryUsage().heapUsed - before;
assert.ok(grown < 200000, 'hot path allocates ~nothing, heap grew ' + grown);
console.log('gameHooks.test.js: PASS');
