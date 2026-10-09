// Run: node --expose-gc engine/entities/tintEnvelope.test.js (re-spawns itself with --expose-gc if missing)
import { spawnSync } from 'node:child_process';
import { tintAt, setTint, sampleTint } from './tintEnvelope.js';
if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const o = { r: 0, g: 0, b: 0, k: 0 };
const W = { name: 'windup', windupSec: 0.8 };
ok(tintAt(W, 0, o).k === 0, 'windup k=0 at 0');
let prev = -1, mono = true;
for (let t = 0; t <= 800; t += 10) { const k = tintAt(W, t, o).k; if (k < prev) mono = false; prev = k; }
ok(mono, 'windup monotone');
ok(tintAt(W, 400, o).k < 0.5, 'accelerating (below linear)');
ok(tintAt(W, 800, o).k === 1, 'windup k=1 at windupSec');
ok(tintAt(W, 800 + 100, o).k === 1 && tintAt(W, 800 + 300, o).k === 0.7, 'flicker 2 Hz');
ok(tintAt(W, 800 + 1100, o).k === tintAt(W, 800 + 100, o).k, 'flicker periodic/deterministic');
ok(tintAt({ name: 'hit' }, 79, o).k === 1 && Math.abs(tintAt({ name: 'hit' }, 140, o).k - 0.5) < 1e-9 && tintAt({ name: 'hit' }, 200, o).k === 0, 'hit');
ok(Math.abs(tintAt({ name: 'hurt' }, 0, o).k - 0.5) < 1e-9 && tintAt({ name: 'hurt' }, 300, o).k === 0 && Math.abs(o.r - 0.45) < 1e-9, 'hurt');
const e = {}; setTint(e, 'hit', 1000);
ok(sampleTint(e, 1010, o).k === 1 && sampleTint({}, 5, o).k === 0, 'component');
for (let i = 0; i < 1e4; i++) { tintAt(W, i, o); sampleTint(e, i, o); }
gc(); const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 1e5; i++) { tintAt(W, i, o); tintAt({ name: 'hit' } === 0 ? W : W, i, o); }
gc(); const d = process.memoryUsage().heapUsed - h0;
ok(d < 200000, 'zero alloc 1e5 calls (delta ' + d + ')');
console.log(fail ? 'tintEnvelope: ' + fail + ' FAILED' : 'tintEnvelope: all ok');
process.exit(fail ? 1 : 0);
