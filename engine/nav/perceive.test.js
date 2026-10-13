// Run: node --expose-gc engine/nav/perceive.test.js (re-spawns itself with --expose-gc if missing)
import { spawnSync } from 'node:child_process';
import { perceive, NOISE_SPRINT, NOISE_SWING } from './perceive.js';
if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const A = { x: 0, y: 0, fx: 0, fy: 1, halfAngle: Math.PI / 4, range: 10, hearR: 4, homeX: 0, homeY: 0, homeR: 20 };
const T = { x: 0, y: 5, noise: 1 };
const o = { sees: false, hears: false, dist: 0, returnHome: false };
const clear = () => true, blocked = () => false;
ok(perceive(A, T, clear, o).sees && Math.abs(o.dist - 5) < 1e-12, 'ahead seen, dist');
T.x = 5; T.y = 5; // exactly on cone edge (45 deg)
ok(perceive(A, T, clear, o).sees, 'cone edge in');
T.x = 5.2; ok(!perceive(A, T, clear, o).sees, 'just outside cone');
T.x = 0; T.y = -5; ok(!perceive(A, T, clear, o).sees, 'behind not seen');
T.y = 10.5; ok(!perceive(A, T, clear, o).sees, 'beyond range');
T.y = 4.5; T.noise = 1; ok(!perceive(A, T, clear, o).hears, 'outside hearR');
T.noise = NOISE_SWING; ok(perceive(A, T, clear, o).hears, 'swing x1.5 -> 6 hears 4.5');
T.y = 7.5; ok(!perceive(A, T, clear, o).hears, 'swing 6 < 7.5');
T.noise = NOISE_SPRINT; ok(perceive(A, T, clear, o).hears, 'sprint x2 -> 8 hears 7.5');
T.y = 3; T.noise = 1; perceive(A, T, blocked, o);
ok(!o.sees && o.hears, 'LOS false blocks sight, not hearing');
perceive(A, T, null, o); ok(o.sees, 'no losFn = clear');
A.x = 10; ok(!perceive(A, T, clear, o).returnHome, 'within leash'); A.x = 20.01; ok(perceive(A, T, clear, o).returnHome, 'leash flips past homeR');
A.x = 0;
const s1 = JSON.stringify(perceive(A, T, clear, o)); ok(s1 === JSON.stringify(perceive(A, T, clear, o)), 'deterministic');
T.y = 5; for (let i = 0; i < 1e4; i++) perceive(A, T, clear, o);
gc(); const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 1e5; i++) { T.x = i % 7; perceive(A, T, clear, o); }
gc(); const d = process.memoryUsage().heapUsed - h0;
ok(d < 200000, 'zero alloc 1e5 calls (delta ' + d + ')');
console.log(fail ? 'perceive: ' + fail + ' FAILED' : 'perceive: all ok');
process.exit(fail ? 1 : 0);
