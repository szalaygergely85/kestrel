// Run: node --expose-gc engine/entities/animState.test.js (re-spawns itself with --expose-gc if missing)
import { spawnSync } from 'node:child_process';
import { createAnimState, blend, BLEND_MS, PRIORITY } from './animState.js';
if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const st = (clip, frames, loop, events) => ({ clip, frames, frameMs: 100, loop, events });
const mk = () => createAnimState({
  states: {
    idle: st('idle', 4, true), walk: st('walk', 4, true), windup: st('windup', 5, false),
    attack: st('attack', 4, false, [{ frame: 3, name: 'hit' }]), hurt: st('hurt', 2, false), die: st('die', 3, false, [{ frame: 2, name: 'dead' }]),
  },
  transitions: { windup: 'attack' },
});
const order = ['idle', 'walk', 'windup', 'attack', 'hurt', 'die'];
ok(order.every((n, i) => PRIORITY[n] === i), 'priority table');
// every ordered pair: higher interrupts, lower does not
for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
  if (a === b || a < 2 || b < 2) continue;
  const s = mk(); s.request(order[a]); const ch = s.request(order[b]);
  ok(ch === (b > a) && s.name === (b > a ? order[b] : order[a]), 'pair ' + order[a] + '->' + order[b]);
}
let s = mk(); s.request('windup'); s.update(150); s.request('hurt');
ok(s.name === 'hurt', 'hurt interrupts windup');
s.request('walk'); ok(s.name === 'hurt' && s.base === 'walk', 'walk deferred during hurt');
s.update(250); ok(s.name === 'walk', 'hurt finishes -> base walk');
s = mk(); s.request('die'); ok(s.request('idle') === false && s.request('hurt') === false && s.request('attack') === false, 'die terminal');
s.update(5000); ok(s.name === 'die' && s.finished && s.frame === 2, 'die holds last frame');
// events once per play
s = mk(); s.request('attack'); let n = 0; const cb = () => n++;
for (let i = 0; i < 2; i++) s.update(100, cb);
ok(n === 0, 'no event before frame 3');
s.update(100, cb); s.update(10, cb); ok(n === 1, 'event fires at frame 3');
s = mk(); s.request('attack'); n = 0; s.update(1000, cb); ok(n === 1, 'big step fires once (and returns to idle)');
s = mk(); s.request('attack'); n = 0; for (let i = 0; i < 400; i++) s.update(1, cb); ok(n === 1, 'fine steps fire once');
s.request('attack'); s.update(1000, cb); ok(n === 2, 'new play re-arms');
s = mk(); s.request('windup'); s.update(500); ok(s.name === 'attack' && s.frame === 0, 'windup -> attack transition');
// blend
let prev = -1, mono = true; for (let t = -5; t < 200; t += 5) { const w = blend(t); if (w < prev) mono = false; prev = w; }
ok(mono && blend(0) === 0 && blend(BLEND_MS / 2) === 0.5 && blend(BLEND_MS) === 1 && blend(500) === 1, 'blend monotone over 80 ms');
s = mk(); s.request('walk'); s.update(40); ok(Math.abs(s.blend() - 0.5) < 1e-9 && s.prev === 'idle', 'instance blend');
// zero alloc
s = mk(); for (let i = 0; i < 1e4; i++) { s.request(order[i % 6 | 0]); s.update(16, cb); if (s.dead) s = mk(); }
gc(); const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 1e5; i++) { s.request(order[i % 5]); s.update(16, cb); }
gc(); const d = process.memoryUsage().heapUsed - h0;
ok(d < 200000, 'zero alloc 1e5 steps (delta ' + d + ')');
console.log(fail ? 'animState: ' + fail + ' FAILED' : 'animState: all ok');
process.exit(fail ? 1 : 0);
