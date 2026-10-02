// engine/render/shadowDirty.test.js (ME-15d, docs/architecture.md 27.9a item 12): the dirty-skip input hash.
// Run: node engine/render/shadowDirty.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shadowInputHash } from './shadowSun.js';
import { DrawList, DRAW_STATIC, DRAW_VOXEL, DRAW_INSTANCED } from '../mesh/DrawList.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const meshA = { id: 'a', meshVersion: 1, ranges: [{}, {}] };
const meshB = { id: 'b', meshVersion: 1, ranges: [{}] };
const M = new Float64Array(16); M[0] = 1; M[5] = 1; M[10] = 1; M[15] = 1;
const list = new DrawList(16);
function fill() {
  list.begin();
  const a = list.push(meshA, DRAW_STATIC); a.rangeFirst = 0; a.rangeCount = 10; a.matrix[9] = 5;
  const v = list.push(meshB, DRAW_VOXEL); v.partMatrices[9] = 2; v.partMatrices[10] = 3;
  const ib = { f32: new Float32Array(32), capacity: 2 };
  const n = list.push(meshB, DRAW_INSTANCED); n.instBuf = ib; n.instCount = 2; n.partMatrices[0] = 1;
  return { a, v, n, ib };
}
const mk = () => new Int32Array(2);
const h = () => { const o = shadowInputHash(list, M, 1, mk()); return o[0] + ':' + o[1]; };

let it = fill();
const base = h();
it = fill();
ok('same inputs -> same key', h() === base);
it = fill(); it.a.matrix[9] = 5.1;
ok('static matrix change -> new key', h() !== base);
it = fill(); it.v.partMatrices[10] = 3.1;
ok('voxel part matrix change (lever moves) -> new key', h() !== base);
{ // 27.9a amendment 4: a 40 m static item at rest with a 1/1000 rotation change must re-render (size-scaled step)
  const big = () => { list.begin(); const b = list.push(meshA, DRAW_STATIC); b.rangeCount = 1;
    b.matrix[0] = 1; b.matrix[4] = 1; b.matrix[8] = 1; b.aabb[0] = -20; b.aabb[3] = 20; b.aabb[1] = -20; b.aabb[4] = 20; return b; };
  big(); const k0 = h(); const b = big(); b.matrix[1] = 0.001;
  ok('40 m item, rotation change 1/1000 -> new key', h() !== k0);
  const s2 = big(); s2.aabb.fill(0); s2.aabb[3] = 0.5; s2.matrix[1] = 0.001; const kS = h(); s2.matrix[1] = 0;
  ok('0.5 m item, same 1/1000 change stays quantised (no re-render)', h() === kS);
}
it = fill(); it.ib.f32[19] = 0.5;
ok('instance buffer content change -> new key', h() !== base);
it = fill(); it.a.matrix[9] = 5.004; it.v.partMatrices[10] = 3.003; it.v.partMatrices[0] = 0.0005;
ok('sub-quantum pose jitter (idle breathing) -> same key', h() === base);
it = fill(); it.a.rangeCount = 9;
ok('range change (terrain LOD) -> new key', h() !== base);
it = fill(); meshA.meshVersion = 2;
ok('meshVersion bump (in-place rebuild) -> new key', h() !== base);
meshA.meshVersion = 1;
it = fill();
ok('restored -> original key', h() === base);
{
  const a = shadowInputHash(list, M, 1, mk()), b = shadowInputHash(list, M, 2, mk());
  ok('structVersion change -> new key', a[0] !== b[0] || a[1] !== b[1]);
  const M2 = Float64Array.from(M); M2[12] = 0.01;
  const c = shadowInputHash(list, M2, 1, mk());
  ok('sun matrix change -> new key', a[0] !== c[0] || a[1] !== c[1]);
}
{
  it = fill(); const o = mk();
  for (let i = 0; i < 5000; i++) shadowInputHash(list, M, 1, o); // JIT warm-up
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 50000; i++) shadowInputHash(list, M, 1, o);
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  ok('hash: no heap growth over 50k calls', grew < 256 * 1024, `grew ${grew}`);
}
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
