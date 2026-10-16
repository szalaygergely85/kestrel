// engine/physics/bvhBuilder.test.js (PERF-03). The resumable BvhBuilder (quickselect split, explicit stack) must
// give the SAME Bvh bit for bit as the pre-PERF-03 recursive full-sort build (kept below as the reference), both in
// one call (buildBvh) and sliced at a zero budget (one node per step); plus the trunk/detail ColliderBuildJob.
// Run: node engine/physics/bvhBuilder.test.js
import { BVH_LEAF_MAX, buildBvh, BvhBuilder } from './bvh.js';
import { buildTrunkCollider, trunkColliderJob } from '../world/colliders.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

/** Pre-PERF-03 build (recursive, full comparator sort per node); unrolled + identity only. */
function refBuild(pos) {
  const n = Math.floor(pos.length / 9), src = Float64Array.from(pos.subarray(0, n * 9));
  const cc = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let t = 0; t < n; t++) for (let a = 0; a < 3; a++) cc[a][t] = (src[t * 9 + a] + src[t * 9 + 3 + a] + src[t * 9 + 6 + a]) / 3;
  const order = new Int32Array(n); for (let t = 0; t < n; t++) order[t] = t;
  const maxN = n > 0 ? 2 * n - 1 : 1, nMin = new Float64Array(maxN * 3), nMax = new Float64Array(maxN * 3), nS = new Int32Array(maxN), nC = new Int32Array(maxN);
  let used = 0, maxDepth = 0;
  function range(ni, s, c, d) {
    if (d > maxDepth) maxDepth = d;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < s + c; i++) for (let k = 0; k < 9; k++) { const v = src[order[i] * 9 + k], a = k % 3; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
    for (let a = 0; a < 3; a++) { nMin[ni * 3 + a] = lo[a]; nMax[ni * 3 + a] = hi[a]; }
    if (c <= BVH_LEAF_MAX) { nS[ni] = s; nC[ni] = c; return; }
    const cl = [Infinity, Infinity, Infinity], ch = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < s + c; i++) for (let a = 0; a < 3; a++) { const v = cc[a][order[i]]; if (v < cl[a]) cl[a] = v; if (v > ch[a]) ch[a] = v; }
    const ex = ch[0] - cl[0], ey = ch[1] - cl[1], ez = ch[2] - cl[2];
    let axis = 0; if (ey > ex) axis = 1; if (axis === 0 ? ez > ex : ez > ey) axis = 2;
    const key = cc[axis], sl = Array.from(order.subarray(s, s + c));
    sl.sort((a, b) => (key[a] < key[b] ? -1 : key[a] > key[b] ? 1 : a - b));
    for (let i = 0; i < c; i++) order[s + i] = sl[i];
    const mid = s + (c >> 1), L = used++, R = used++;
    nS[ni] = L; nC[ni] = 0;
    range(L, s, mid - s, d + 1); range(R, mid, s + c - mid, d + 1);
  }
  range(used++, 0, n, 0);
  const tri = new Float64Array(n * 9), triId = new Int32Array(n);
  for (let i = 0; i < n; i++) { triId[i] = order[i]; for (let k = 0; k < 9; k++) tri[i * 9 + k] = src[order[i] * 9 + k]; }
  return { triCount: n, nodeCount: used, tri, triId, nodeMin: nMin.slice(0, used * 3), nodeMax: nMax.slice(0, used * 3), nodeStart: nS.slice(0, used), nodeTriCount: nC.slice(0, used), stack: new Int32Array(maxDepth + 2) };
}

/** First difference between two Bvhs (Object.is per element), or null. */
function diff(a, b) {
  for (const k of ['triCount', 'nodeCount']) if (a[k] !== b[k]) return k;
  for (const k of ['tri', 'triId', 'nodeMin', 'nodeMax', 'nodeStart', 'nodeTriCount']) {
    if (a[k].length !== b[k].length) return k + '.length';
    for (let i = 0; i < a[k].length; i++) if (!Object.is(a[k][i], b[k][i])) return `${k}[${i}]`;
  }
  return a.stack.length === b.stack.length ? null : 'stack.length';
}

let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const cases = [];
for (const n of [0, 1, 4, 5, 9, 33, 257, 2000]) { // integer coordinates -> many equal centroid keys (tie-break by source index)
  const p = new Float64Array(n * 9); for (let i = 0; i < p.length; i++) p[i] = Math.round(rnd() * 12); cases.push([`grid ${n}`, p]);
}
for (const n of [300, 5000]) { const p = new Float64Array(n * 9); for (let i = 0; i < p.length; i++) p[i] = rnd() * 400; cases.push([`soup ${n}`, p]); }

for (const [name, p] of cases) {
  const ref = refBuild(p);
  ok(`buildBvh == pre-PERF-03 build (${name})`, diff(buildBvh(p, null, null), ref) === null, diff(buildBvh(p, null, null), ref) || '');
  const b = new BvhBuilder(p, null, null);
  let calls = 1; while (!b.step(0)) calls++;
  const d = diff(/** @type {any} */ (b.result), ref);
  ok(`BvhBuilder sliced at 0 ms == reference (${name}, ${calls} calls)`, d === null, d || '');
}

// Trunk collider job == one-call builder (trees in a 200 m square, two species).
{
  const n = 400, sc = { count: n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), yawDeg: new Int16Array(n), species: new Uint8Array(n) };
  for (let i = 0; i < n; i++) { sc.x[i] = rnd() * 200; sc.y[i] = rnd() * 200; sc.z[i] = rnd() * 8; sc.yawDeg[i] = (rnd() * 360) | 0; sc.species[i] = i & 1; }
  const cfg = { species: [{ trunkR: 0.3, trunkH: 4 }, { trunkR: 0.5, trunkH: 6 }] };
  const one = buildTrunkCollider(sc, cfg), job = trunkColliderJob(sc, cfg);
  let calls = 1; while (!job.step(0)) calls++;
  const r = /** @type {any} */ (job.result);
  ok('trunkColliderJob result == buildTrunkCollider', !!one && !!r && r.id === one.id && diff(r.bvh, one.bvh) === null && String(r.min) === String(one.min) && String(r.max) === String(one.max), `${calls} calls`);
  ok('trunkColliderJob is sliced (>= 3 calls at 0 ms)', calls >= 3, `${calls}`);
  const empty = trunkColliderJob({ count: 0 }, cfg);
  ok('trunkColliderJob on an empty scatter -> null in one call', empty.step(0) === true && empty.result === null);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
