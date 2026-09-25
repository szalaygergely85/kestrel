// engine/render/gpu/GpuTimer.test.js
//
// Headless test suite for US-018 (docs/architecture.md section 16) step 2:
// `GpuPassTimer` (per-pass sequential TIME_ELAPSED_EXT queries). Plain Node
// ESM, no test framework, no build step. Run with:
//
//   node engine/render/gpu/GpuTimer.test.js
//
// A minimal fake `gl` stands in for WebGL2 + EXT_disjoint_timer_query_webgl2:
// query "objects" are plain counters, `QUERY_RESULT_AVAILABLE` is
// controlled by the test (so it can simulate a query taking a few frames to
// resolve), and `GPU_DISJOINT_EXT` can be forced on to prove a disjoint
// result is dropped rather than pushed into the history.

import { GpuPassTimer } from './GpuTimer.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

function makeFakeGl() {
  let nextQueryId = 1;
  const results = new Map(); // queryId -> { availableAt, ns }
  let frame = 0;
  let disjoint = false;

  const ext = { TIME_ELAPSED_EXT: 'TIME_ELAPSED_EXT', GPU_DISJOINT_EXT: 'GPU_DISJOINT_EXT' };
  const gl = {
    QUERY_RESULT_AVAILABLE: 'QUERY_RESULT_AVAILABLE',
    QUERY_RESULT: 'QUERY_RESULT',
    getExtension: (name) => (name === 'EXT_disjoint_timer_query_webgl2' ? ext : null),
    createQuery: () => ({ id: nextQueryId++ }),
    deleteQuery: () => {},
    beginQuery: (target, q) => { q._activeSince = frame; },
    endQuery: () => {},
    getQueryParameter: (q, pname) => {
      if (pname === 'QUERY_RESULT_AVAILABLE') {
        const r = results.get(q.id);
        return !!r; // available once a result has been queued for it
      }
      if (pname === 'QUERY_RESULT') {
        return results.get(q.id).ns;
      }
      return null;
    },
    getParameter: (pname) => (pname === 'GPU_DISJOINT_EXT' ? disjoint : null),
    // test helpers, not part of the real gl API
    _resolve(q, ns) { results.set(q.id, { ns }); },
    _setDisjoint(v) { disjoint = v; },
    _tick() { frame++; },
  };
  return { gl, ext };
}

const SLOTS = ['cast', 'terrain', 'voxel', 'resolve', 'light', 'shade', 'edge'];

// ---- sequential begin/end across slots, sum = total ------------------------
{
  const { gl } = makeFakeGl();
  const t = new GpuPassTimer(gl, SLOTS.length);
  ok('available with the fake extension', t.available === true);

  // One "frame": run all 7 passes in order, resolving each query
  // immediately (as if the GPU finished instantly) so writeStats sees data
  // after just one frame.
  const nsPerSlot = [1e6, 2e6, 0.5e6, 1.5e6, 0.8e6, 2.2e6, 0.3e6]; // -> 1,2,0.5,1.5,0.8,2.2,0.3 ms
  for (let slot = 0; slot < SLOTS.length; slot++) {
    t.begin(slot);
    const q = t._queries[slot][0];
    gl._resolve(q, nsPerSlot[slot]);
    t.end();
  }
  // writeStats polls internally (begin() no longer polls, arch review 1
  // item 3) - call it once here, as `_hook()` would, once per frame.
  const p50 = new Float32Array(SLOTS.length);
  const p95 = new Float32Array(SLOTS.length);
  t.writeStats(p50, p95);

  let sum = 0;
  for (let i = 0; i < SLOTS.length; i++) {
    ok(`slot ${SLOTS[i]} p50 = its single sample`, Math.abs(p50[i] - nsPerSlot[i] / 1e6) < 1e-6, `p50=${p50[i]}`);
    sum += p50[i];
  }
  ok('sum of per-pass p50 = whole-frame ms', Math.abs(sum - 8.3) < 1e-6, `sum=${sum}`);
}

// ---- disjoint result is dropped, not pushed into history -------------------
{
  const { gl } = makeFakeGl();
  const t = new GpuPassTimer(gl, SLOTS.length);
  t.begin(0);
  const q = t._queries[0][0];
  gl._resolve(q, 5e6);
  gl._setDisjoint(true);
  t.end(); // begin() no longer polls (arch review 1 item 3) - writeStats does the one poll/frame
  const p50 = new Float32Array(SLOTS.length);
  const p95 = new Float32Array(SLOTS.length);
  t.writeStats(p50, p95); // polls internally, sees the disjoint result, drops it
  ok('a disjoint result never reaches the history (p50 stays NaN)', Number.isNaN(p50[0]), `p50[0]=${p50[0]}`);
  gl._setDisjoint(false);
}

// ---- availability: a query that hasn't resolved yet reports no data --------
{
  const { gl } = makeFakeGl();
  const t = new GpuPassTimer(gl, SLOTS.length);
  t.begin(0);
  // never resolved -> getQueryParameter(..., QUERY_RESULT_AVAILABLE) is false
  t.end();
  const p50 = new Float32Array(SLOTS.length);
  const p95 = new Float32Array(SLOTS.length);
  t.writeStats(p50, p95);
  ok('an unresolved query leaves that slot at NaN', Number.isNaN(p50[0]));
}

// ---- unavailable extension: writeStats fills NaN, begin/end are no-ops -----
{
  const gl = { getExtension: () => null };
  const t = new GpuPassTimer(gl, SLOTS.length);
  ok('unavailable without the extension', t.available === false);
  t.begin(0); // must not throw
  t.end(); // must not throw
  const p50 = new Float32Array(SLOTS.length).fill(123);
  const p95 = new Float32Array(SLOTS.length).fill(123);
  t.writeStats(p50, p95);
  let allNaN = true;
  for (let i = 0; i < SLOTS.length; i++) if (!Number.isNaN(p50[i]) || !Number.isNaN(p95[i])) allNaN = false;
  ok('writeStats fills every slot with NaN when unavailable', allNaN);
}

// ---------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
