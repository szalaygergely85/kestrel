import { wireHitSparks, hitSparksEnabled, sparkCount } from './hitSparkWire.js';
import assert from 'node:assert/strict';
const defs = {}, bursts = [];
const particles = { defineEmitter(k) { defs[k] = Object.keys(defs).length; return defs[k]; }, defIdOf(k) { return k in defs ? defs[k] : -1; },
  burstAt(id, x, y, z, n, nx, ny, nz) { bursts.push({ id, x, y, z, n, nx, ny, nz }); } };
const handlers = []; const events = { on(n, f) { handlers.push(f); return () => handlers.splice(handlers.indexOf(f), 1); } };
const w = wireHitSparks(events, particles, () => ({ x: 0, y: 0, z: 0 }), true);
assert.ok(defs.hitSparks0 !== undefined);
handlers[0]({ source: 'player', px: 5, py: 1, pz: 2, dirX: 1, dirY: 0, damage: 1 });
assert.deepEqual(bursts[0], { id: 0, x: 5, y: 1, z: 2, n: 8, nx: -1, ny: -0, nz: 0.3 });
handlers[0]({ source: 'player', px: 4, py: 0, pz: 0, damage: 9, killed: true }); // no dir -> toward player
assert.equal(bursts[1].id, 1); assert.equal(bursts[1].n, 12); assert.equal(bursts[1].nx, -4);
handlers[0]({ source: 'boar', px: 0, py: 0, pz: 0 }); assert.equal(bursts.length, 2);
w.dispose(); assert.equal(handlers.length, 0);
assert.equal(wireHitSparks(events, particles, null, false), null);
assert.equal(sparkCount(0), 8); assert.equal(sparkCount(3), 10); assert.equal(sparkCount(99), 12);
const P = (s) => new URLSearchParams(s);
assert.ok(!hitSparksEnabled(P(''), false)); assert.ok(hitSparksEnabled(P('hitsparks=1'), false)); assert.ok(!hitSparksEnabled(P('hitsparks=1&fx=0'), false)); assert.ok(!hitSparksEnabled(P('hitsparks=1'), true)); assert.ok(!hitSparksEnabled(P('hitsparks=1&capture=1'), false)); // opt-in
console.log('hitSparkWire OK');
