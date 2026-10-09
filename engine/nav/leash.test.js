// Run: node --expose-gc engine/nav/leash.test.js (re-spawns itself with --expose-gc if missing)
import { spawnSync } from 'node:child_process';
import { leashState, returnTarget, LEASH_HOME as H, LEASH_ENGAGE as E, LEASH_RETURN as R, LEASH_GIVEUP as G } from './leash.js';
if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const def = { homeX: 10, homeZ: 10, homeR: 3, leashR: 15, aggroR: 8, loseScale: 1.25, returnSpeed: 1.6, giveUpT: 5 };
const mk = (x, z) => ({ x, z, leashMode: H, leashT: 0 });
const T = { x: 10, z: 30 };
let a = mk(10, 10);
ok(leashState(a, def, T, 0.1) === H, 'target far -> HOME');
T.x = 10; T.z = 17; ok(leashState(a, def, T, 0.1) === E, 'target in aggro -> ENGAGE');
// hysteresis on target loss: 8 < d < 10 stays engaged, > 10 returns
a.z = 10; T.z = 19; ok(leashState(a, def, T, 0.1) === E, 'd=9 stays ENGAGE (hysteresis)');
T.z = 20.5; ok(leashState(a, def, T, 0.1) === R, 'd=10.5 -> RETURN');
// RETURN ignores target, stays until within homeR
a.z = 14; T.z = 15; ok(leashState(a, def, T, 0.1) === R, 'RETURN ignores close target');
a.z = 12.9; ok(leashState(a, def, T, 0.1) === H, 'within homeR -> HOME');
// no re-engage flicker: at homeR edge outside, target in aggro does not engage
a = mk(10, 14); T.x = 10; T.z = 18; ok(leashState(a, def, T, 0.1) === H, 'outside homeR cannot engage from HOME');
// leash radius
a = mk(10, 12); T.z = 19; leashState(a, def, T, 0.1); ok(a.leashMode === E, 'engaged');
a.z = 24.9; T.z = 30; ok(leashState(a, def, T, 0.1) === E || a.leashMode === R, 'sanity');
a = mk(10, 12); T.z = 19; leashState(a, def, T, 0.1); a.z = 25.5; T.z = 30.5; // 15.5 from home, target 5 away
ok(leashState(a, def, T, 0.1) === R, 'past leashR -> RETURN');
// give-up after timeout
a = mk(10, 10); T.x = 10; T.z = 15; leashState(a, def, T, 0.1);
a.z = 14; // chasing away from home, still inside leashR
for (let i = 0; i < 49; i++) leashState(a, def, T, 0.1);
ok(a.leashMode === E, 'still ENGAGE before giveUpT');
for (let i = 0; i < 3; i++) leashState(a, def, T, 0.1);
ok(a.leashMode === G, 'GIVEUP after timeout');
ok(leashState(a, def, T, 0.1) === G, 'GIVEUP persists while away, target near');
a.x = 10; a.z = 11; ok(leashState(a, def, T, 0.1) === H && a.leashT === 0, 'home resets timer');
// return target
const o = { x: 0, z: 0, speed: 0 };
ok(returnTarget(def, o) === o && o.x === 10 && o.z === 10 && o.speed === 1.6, 'return target = home + speed scale');
// zero alloc
a = mk(10, 10);
for (let i = 0; i < 1e4; i++) { T.z = 10 + (i % 25); a.z = 10 + (i % 17); leashState(a, def, T, 0.016); returnTarget(def, o); }
gc(); const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 1e5; i++) { T.z = 10 + (i % 25); a.z = 10 + (i % 17); leashState(a, def, T, 0.016); returnTarget(def, o); }
gc(); const d = process.memoryUsage().heapUsed - h0;
ok(d < 200000, 'zero alloc 1e5 steps (delta ' + d + ')');
console.log(fail ? 'leash: ' + fail + ' FAILED' : 'leash: all ok');
process.exit(fail ? 1 : 0);
