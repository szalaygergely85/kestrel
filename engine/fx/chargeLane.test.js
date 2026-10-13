// engine/fx/chargeLane.test.js: laneCells / laneAlpha. Run: node --expose-gc engine/fx/chargeLane.test.js
import { laneCells, laneAlpha } from './chargeLane.js';
import { spawnSync } from 'node:child_process';
import { makeOk } from '../test/assert.js';

if (typeof gc !== 'function' && !process.env.CL_CHILD) {
  const r = spawnSync(process.execPath, ['--expose-gc', new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
    { stdio: 'inherit', env: { ...process.env, CL_CHILD: '1' } });
  process.exit(r.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const out = new Int32Array(2 * 512);
const D = Math.PI / 180;
const dedup = (n) => new Set(Array.from({ length: n }, (_, i) => out[2 * i] + ',' + out[2 * i + 1])).size === n;
const bounds = (n) => { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (let i = 0; i < n; i++) { a = Math.min(a, out[2*i]); b = Math.max(b, out[2*i]); c = Math.min(c, out[2*i+1]); d = Math.max(d, out[2*i+1]); } return [a, b, c, d]; };

// yaw 0 (+z), origin at a cell corner (0,0), length 8.4, width 1 (cell 0.5): z centres 0.5..8.25 -> 16 rows, 2 cols
{
  const n = laneCells(0, 0, 0, 8.4, 1, out);
  const [x0, x1, z0, z1] = bounds(n);
  ok('yaw0: 2 cols x 17 rows = 34', n === 34 && dedup(n));
  ok('yaw0: z offsets 0..16', z0 === 0 && z1 === 16 && x0 === -1 && x1 === 0);
}
{
  const n = laneCells(0, 0, 90 * D, 8.4, 1, out); // +x
  const [x0, x1, z0, z1] = bounds(n);
  ok('yaw90: transposed, 34 cells, no dups', n === 34 && dedup(n) && x0 === 0 && x1 === 16 && z0 === -1 && z1 === 0);
}
{
  const n = laneCells(0, 0, 45 * D, 8.4, 1, out);
  const area = n * 0.25;
  ok('yaw45: area ~ 8.4 m^2, no dups', Math.abs(area - 8.4) < 2 && dedup(n));
  let allIn = true;
  for (let i = 0; i < n; i++) {
    const dx = (out[2*i] + 0.5) * 0.5, dz = (out[2*i+1] + 0.5) * 0.5, f = Math.SQRT1_2;
    const u = (dx + dz) * f, v = (dx - dz) * f;
    if (u < -1e-6 || u > 8.4 + 1e-6 || Math.abs(v) > 0.5) allIn = false;
  }
  ok('yaw45: all cell centres inside rectangle', allIn);
}
ok('cap truncates to out size', laneCells(0, 0, 0, 8.4, 1, new Int32Array(10)) === 5);
ok('custom cellM=1 yaw0 width2 length 8.4 -> 8 rows x 2 cols', laneCells(0, 0, 0, 8.4, 2, out, 1) === 16);

ok('alpha t=0 -> 0', laneAlpha(0, 0.6) === 0);
ok('alpha mid -> 0.4', Math.abs(laneAlpha(300, 0.6) - 0.4) < 1e-9);
ok('alpha near end ~0.8', Math.abs(laneAlpha(599.999, 0.6) - 0.8) < 1e-3);
ok('alpha after windup / negative / bad windup -> 0', laneAlpha(600, 0.6) === 0 && laneAlpha(-5, 0.6) === 0 && laneAlpha(10, 0) === 0);

// zero alloc (loop in a function so the accumulator is not a boxed module-level number)
function churn(k) { let s = 0; for (let i = 0; i < k; i++) s += laneCells(1, 2, i * 0.01, 8.4, 1, out) + laneAlpha(i % 700, 0.6); return s; }
{
  churn(30000); gc(); const h0 = process.memoryUsage().heapUsed;
  const s = churn(20000); gc();
  const grow = process.memoryUsage().heapUsed - h0;
  ok('zero alloc (heap growth < 100 KB over 20k calls)', grow < 100000 && s > 0);
}
console.log(`chargeLane: ${pass} pass, ${fail} fail`);
for (const f of failures) console.log('FAIL ' + f);
process.exit(fail ? 1 : 0);
