// engine/nav/heap.test.js (RE-05). Zero-allocation gate needs --expose-gc:
// re-runs itself when missing (same pattern as engine/mesh/culling.test.js).
// Run: node engine/nav/heap.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IndexHeap } from './heap.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---- basic pop order (min-heap by a key array, index tie-break) -----------
{
  const n = 64;
  const key = new Int32Array(n);
  const rnd = lcg(1);
  for (let i = 0; i < n; i++) key[i] = Math.floor(rnd() * 1000);
  const heap = new IndexHeap(n, (a, b) => key[a] !== key[b] ? key[a] < key[b] : a < b);
  for (let i = 0; i < n; i++) heap.push(i);
  ok('length after n pushes', heap.length === n, `length=${heap.length}`);
  const order = [];
  while (heap.length > 0) order.push(heap.pop());
  let sorted = true;
  for (let i = 1; i < order.length; i++) {
    const prevKey = key[order[i - 1]], curKey = key[order[i]];
    if (prevKey > curKey || (prevKey === curKey && order[i - 1] > order[i])) { sorted = false; break; }
  }
  ok('pop order matches (key asc, then index asc)', sorted, order.map((i) => key[i]).join(','));
  ok('heap empty after popping all', heap.length === 0, `length=${heap.length}`);
  for (let i = 0; i < n; i++) ok(`item ${i} not "has" after full drain`, !heap.has(i));
}

// ---- decreaseKey moves an item up ------------------------------------------
{
  const n = 8;
  const key = new Int32Array(n).fill(100);
  const heap = new IndexHeap(n, (a, b) => key[a] !== key[b] ? key[a] < key[b] : a < b);
  for (let i = 0; i < n; i++) heap.push(i);
  key[5] = 1; // item 5 now has the smallest key
  heap.decreaseKey(5);
  const top = heap.pop();
  ok('decreaseKey brings the item to the top', top === 5, `top=${top}`);
}

// ---- clear + reuse ----------------------------------------------------------
{
  const n = 16;
  const key = new Int32Array(n);
  const heap = new IndexHeap(n, (a, b) => key[a] !== key[b] ? key[a] < key[b] : a < b);
  for (let i = 0; i < n; i++) { key[i] = n - i; heap.push(i); }
  heap.clear();
  ok('clear empties the heap', heap.length === 0);
  for (let i = 0; i < n; i++) ok(`item ${i} not "has" after clear`, !heap.has(i));
  for (let i = 0; i < n; i++) { key[i] = i; heap.push(i); }
  ok('reused heap length', heap.length === n);
  ok('reused heap pops 0 first (fresh keys)', heap.pop() === 0);
}

// ---- has() reflects membership ---------------------------------------------
{
  const heap = new IndexHeap(4, (a, b) => a < b);
  heap.push(2);
  ok('has(2) true after push', heap.has(2));
  ok('has(1) false (never pushed)', !heap.has(1));
  heap.pop();
  ok('has(2) false after pop', !heap.has(2));
}

// ---- zero allocation: 50k push/pop cycles on a warm heap -------------------
{
  const n = 256;
  const key = new Int32Array(n);
  const rnd = lcg(7);
  for (let i = 0; i < n; i++) key[i] = Math.floor(rnd() * 1e6);
  const heap = new IndexHeap(n, (a, b) => key[a] !== key[b] ? key[a] < key[b] : a < b);
  let sink = 0;
  // Warm up.
  for (let iter = 0; iter < 1000; iter++) {
    for (let i = 0; i < n; i++) heap.push(i);
    while (heap.length > 0) sink += heap.pop();
  }
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let iter = 0; iter < 50000; iter++) {
    for (let i = 0; i < n; i++) heap.push(i);
    heap.decreaseKey(n >> 1);
    while (heap.length > 0) sink += heap.pop();
  }
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('IndexHeap: no significant heap growth over 50k push/pop cycles (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes (sink=${sink})`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
