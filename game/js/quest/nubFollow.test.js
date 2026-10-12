// nubFollow.test.js (NUB-01): stays 3-8 m (after settling), never in water, stuck cadence/duration, trots after walking Burl, deterministic.
import assert from 'node:assert/strict';
import { createNubFollow, NEAR_MAX_M, STUCK_MAX_S, STUCK_DUR_MAX_S } from './nubFollow.js';

const DT = 1 / 60;
function mk(o = {}) {
  const burl = { x: 100, y: 100, walking: false, hidden: false };
  const ent = { data: { transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { voxel: { anim: 'idle' } } }, played: [], play(a) { this.played.push(a); } };
  const isWater = o.isWater || (() => false);
  const n = createNubFollow({ handle: ent, groundAt: () => 0, isWater, seed: o.seed, burl: { x: () => burl.x, y: () => burl.y, walking: () => burl.walking, hidden: () => burl.hidden } });
  return { n, burl, ent, t: ent.data.transform, v: ent.data.components.voxel };
}
const dist = (c) => Math.hypot(c.t.x - c.burl.x, c.t.y - c.burl.y);
const trace = (seed) => { const c = mk({ seed }); const out = []; for (let i = 0; i < 6000; i++) { c.n.step(DT); if (i % 100 === 0) out.push(c.t.x.toFixed(3) + ',' + c.t.y.toFixed(3) + c.n.anim); } return out.join('|'); };

// spawn near Burl, stays within 3-8 m over 10 min, uses several clips
{
  const c = mk(); assert.ok(dist(c) >= 3 - 1e-6 && dist(c) <= 8.02, 'spawn ' + dist(c));
  let max = 0, min = 99; const seen = new Set();
  for (let i = 0; i < 60 * 600; i++) { c.n.step(DT); const d = dist(c); if (d > max) max = d; if (i > 600 && d < min) min = d; seen.add(c.n.anim); }
  assert.ok(max <= NEAR_MAX_M + 0.5, 'max ' + max);
  for (const a of ['walk', 'sniff', 'stuckWiggle', 'lieDown', 'lie', 'getUp']) assert.ok(seen.has(a), 'clip ' + a + ' ' + [...seen]);
}
// stuck: first within 120 s, lasts 3-5 s then frees itself
{
  const c = mk(); let start = -1, end = -1, pos;
  for (let i = 0; i < 60 * 300 && end < 0; i++) {
    c.n.step(DT);
    if (start < 0 && c.n.mode === 'stuck') { start = i; pos = [c.t.x, c.t.y]; }
    else if (start >= 0 && c.n.mode !== 'stuck') end = i;
  }
  assert.ok(start >= 0 && start * DT <= STUCK_MAX_S + 1, 'stuck at ' + start * DT);
  const dur = (end - start) * DT; assert.ok(dur >= 2.9 && dur <= STUCK_DUR_MAX_S + 0.1, 'dur ' + dur);
  assert.deepEqual([c.t.x, c.t.y], pos, 'stays put while stuck');
}
// never enters water: a river band x in 95..99 between most spawn points and Burl
{
  const c = mk({ isWater: (x) => x > 93 && x < 99 });
  for (let i = 0; i < 60 * 600; i++) { c.n.step(DT); assert.ok(!(c.t.x > 93 && c.t.x < 99), 'in water ' + c.t.x + ' @' + i); }
}
// Burl walks away at 1.6 m/s: Nub trots and keeps up (< 8 m)
{
  const c = mk(); for (let i = 0; i < 600; i++) c.n.step(DT);
  c.burl.walking = true; let sawTrot = false, max = 0;
  for (let i = 0; i < 60 * 40; i++) { c.burl.x += 1.6 * DT; c.n.step(DT); if (c.n.anim === 'trot') sawTrot = true; if (i > 300) max = Math.max(max, dist(c)); }
  assert.ok(sawTrot && max <= NEAR_MAX_M + 0.5, 'trot ' + sawTrot + ' ' + max);
  c.burl.walking = false; for (let i = 0; i < 60 * 10; i++) c.n.step(DT); assert.ok(dist(c) <= NEAR_MAX_M + 0.5);
}
// Burl hidden/teleported (goHome): Nub hides, then respawns near her
{
  const c = mk(); c.burl.hidden = true; c.n.step(DT); assert.equal(c.v.hidden, true);
  c.burl.x = 500; c.burl.hidden = false; c.n.step(DT); assert.equal(c.v.hidden, false); assert.ok(dist(c) <= 8.02);
  c.burl.x = 900; c.n.step(DT); assert.ok(dist(c) <= 8.02, 'far teleport respawn');
}
// deterministic, seed-dependent, no Math.random
{
  assert.equal(trace(7), trace(7)); assert.notEqual(trace(7), trace(8));
  const r = Math.random; Math.random = () => { throw new Error('Math.random'); }; try { trace(3); } finally { Math.random = r; }
}
console.log('nubFollow.test.js OK');
