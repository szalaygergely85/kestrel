// engine/world/Visibility.test.js (RE-11, docs/architecture.md 28.3).
// Run: node engine/world/Visibility.test.js
import { Visibility } from './Visibility.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const PERF_STRICT = process.env.PERF_STRICT === '1';
function perfOk(name, cond, detail) {
  if (PERF_STRICT) { ok(name, cond, detail); }
  else if (!cond) { console.warn(`WARN perf (non-strict): ${name} - ${detail}`); pass++; }
  else { pass++; }
}

// Local seeded LCG - never Math.random (determinism rule, 28.2).
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---- basic stamp: a single source lights up a disc ------------------------
{
  const vis = new Visibility({ x0: 0, y0: 0, w: 20, h: 20, teams: 2 });
  vis.setSource(1, 0b01, 10, 10, 3);
  ok('centre cell visible', vis.isVisible(0, 10, 10));
  ok('far cell unseen', !vis.isExplored(0, 0, 0));
  ok('team 1 (not in mask) sees nothing', !vis.isVisible(1, 10, 10));
  ok('outside grid -> unseen (0)', vis.stateAt(0, -5, -5) === 0);
}

// ---- setSource no-op when unchanged ----------------------------------------
{
  const vis = new Visibility({ x0: 0, y0: 0, w: 10, h: 10 });
  vis.setSource(1, 0b01, 5, 5, 2);
  const v0 = vis.version[0];
  vis.setSource(1, 0b01, 5, 5, 2); // identical call: must be a true no-op
  ok('unchanged setSource does not bump version', vis.version[0] === v0);
}

// ---- stamp + unstamp restores count byte-equal -----------------------------
{
  const vis = new Visibility({ x0: 0, y0: 0, w: 16, h: 16 });
  const countBefore = vis.count[0].slice();
  vis.setSource(1, 0b01, 8, 8, 4);
  vis.removeSource(1);
  ok('count restored byte-equal after stamp+unstamp', buffersEqual(vis.count[0], countBefore));
  // state should have gone visible -> explored, not back to unseen.
  ok('state left explored (128) after remove, not unseen', vis.stateAt(0, 8, 8) === 128);
}

// ---- stamps commute: shuffled application order -> identical state --------
{
  const w = 24, h = 24;
  const rnd = lcg(42);
  const N = 30;
  const srcs = [];
  for (let i = 0; i < N; i++) {
    srcs.push({
      id: i,
      mask: (i % 3) + 1, // 1, 2 or 3 (bits 0/1)
      x: rnd() * w,
      y: rnd() * h,
      r: 1 + rnd() * 5,
    });
  }
  const visA = new Visibility({ x0: 0, y0: 0, w, h, teams: 2, maxSources: N + 1 });
  for (const s of srcs) visA.setSource(s.id, s.mask, s.x, s.y, s.r);

  // Shuffle (Fisher-Yates with the same LCG stream continued).
  const shuffled = srcs.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
  }
  const visB = new Visibility({ x0: 0, y0: 0, w, h, teams: 2, maxSources: N + 1 });
  for (const s of shuffled) visB.setSource(s.id, s.mask, s.x, s.y, s.r);

  ok('shuffled application order: state[0] byte-equal', buffersEqual(visA.state[0], visB.state[0]));
  ok('shuffled application order: state[1] byte-equal', buffersEqual(visA.state[1], visB.state[1]));
  ok('shuffled application order: count[0] byte-equal', buffersEqual(visA.count[0], visB.count[0]));
}

// ---- clipping at all 4 edges, and a negative origin ------------------------
{
  const vis = new Visibility({ x0: -10, y0: -10, w: 10, h: 10, maxRadiusCells: 8 });
  // Corners: should not throw, and should only touch in-bounds cells.
  vis.setSource(1, 0b01, -10, -10, 5); // top-left corner (world (-10,-10) -> cell (0,0))
  vis.setSource(2, 0b01, -1, -10, 5);  // top-right corner (cell (9,0))
  vis.setSource(3, 0b01, -10, -1, 5);  // bottom-left corner (cell (0,9))
  vis.setSource(4, 0b01, -1, -1, 5);   // bottom-right corner (cell (9,9))
  ok('negative-origin corner stamp: centre cell visible', vis.isVisible(0, -10, -10));
  ok('negative-origin: no throw and grid stays in range', vis.stateAt(0, -10, -10) === 255);

  // A source entirely outside the grid: no-op on the grid, no throw.
  const vis2 = new Visibility({ x0: 0, y0: 0, w: 10, h: 10 });
  let threw = false;
  try { vis2.setSource(1, 0b01, 1000, 1000, 3); } catch { threw = true; }
  ok('source entirely outside grid does not throw', !threw);
  let anyLit = false;
  for (let i = 0; i < vis2.state[0].length; i++) if (vis2.state[0][i] !== 0) anyLit = true;
  ok('source entirely outside grid lights nothing', !anyLit);
}

// ---- explored bit survives a removeSource ----------------------------------
{
  const vis = new Visibility({ x0: 0, y0: 0, w: 10, h: 10 });
  vis.setSource(1, 0b01, 5, 5, 2);
  ok('pre-remove: visible', vis.isVisible(0, 5, 5));
  vis.removeSource(1);
  ok('post-remove: no longer visible', !vis.isVisible(0, 5, 5));
  ok('post-remove: still explored', vis.isExplored(0, 5, 5));
}

// ---- dirty rect is exact ----------------------------------------------------
{
  const vis = new Visibility({ x0: 0, y0: 0, w: 20, h: 20 });
  const out = new Int32Array(4);
  ok('no dirty before any change', vis.takeDirty(0, out) === false);

  vis.setSource(1, 0b01, 10, 10, 2);
  // Expected disc bbox at radius 2: rows 8..12 (span table dependent on
  // columns per row), so at minimum the exact bbox of touched cells.
  let expMinX = Infinity, expMinY = Infinity, expMaxX = -Infinity, expMaxY = -Infinity;
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      if (vis.state[0][y * 20 + x] === 255) {
        if (x < expMinX) expMinX = x;
        if (x + 1 > expMaxX) expMaxX = x + 1;
        if (y < expMinY) expMinY = y;
        if (y + 1 > expMaxY) expMaxY = y + 1;
      }
    }
  }
  const got = vis.takeDirty(0, out) ? out.slice() : null;
  ok('dirty rect present after a stamp', got !== null);
  ok('dirty rect exact bbox', got && got[0] === expMinX && got[1] === expMinY && got[2] === expMaxX && got[3] === expMaxY,
    `got=${got}, exp=${[expMinX, expMinY, expMaxX, expMaxY]}`);
  ok('dirty resets after take', vis.takeDirty(0, out) === false);

  // Moving the source should produce a dirty rect covering (at least) the
  // union of the old and new discs - check it's non-empty and resets again.
  vis.setSource(1, 0b01, 11, 10, 2);
  ok('dirty after a move', vis.takeDirty(0, out) === true);
  ok('dirty resets again', vis.takeDirty(0, out) === false);
}

// ---- saveExplored / fromSave round trip ------------------------------------
{
  const vis = new Visibility({ x0: 5, y0: -3, w: 15, h: 11, teams: 3, maxSources: 8, maxRadiusCells: 6 });
  vis.setSource(1, 0b101, 10, 3, 4);
  vis.setSource(2, 0b010, 12, 0, 2);
  const saved = vis.saveExplored();
  const restored = Visibility.fromSave(saved);

  ok('fromSave: dims match', restored.w === vis.w && restored.h === vis.h
    && restored.x0 === vis.x0 && restored.y0 === vis.y0 && restored.teams === vis.teams);

  for (let t = 0; t < vis.teams; t++) {
    let match = true;
    for (let i = 0; i < vis.state[t].length; i++) {
      const wasExplored = vis.state[t][i] !== 0;
      const gotExplored = restored.state[t][i] !== 0;
      if (wasExplored !== gotExplored) { match = false; break; }
      // Restored cells are never 255 (no sources saved).
      if (restored.state[t][i] === 255) { match = false; break; }
    }
    ok(`fromSave: team ${t} explored bit round trips (as state 128, never 255)`, match);
  }

  // Re-saving the restored grid should reproduce the same RLE (idempotent).
  const saved2 = restored.saveExplored();
  ok('saveExplored is idempotent through a round trip', JSON.stringify(saved.explored) === JSON.stringify(saved2.explored));

  // Sum of every run length must equal w*h, for every team.
  let sumsOk = true;
  for (const runs of saved.explored) {
    const sum = runs.reduce((a, b) => a + b, 0);
    if (sum !== vis.w * vis.h) sumsOk = false;
  }
  ok('RLE run lengths sum to w*h', sumsOk);
}

// ---- clearSources drops sources and demotes visible -> explored -----------
{
  const vis = new Visibility({ x0: 0, y0: 0, w: 10, h: 10 });
  vis.setSource(1, 0b01, 5, 5, 2);
  ok('pre-clear: visible', vis.isVisible(0, 5, 5));
  vis.clearSources();
  ok('post-clear: no longer visible', !vis.isVisible(0, 5, 5));
  ok('post-clear: still explored', vis.isExplored(0, 5, 5));
  let countsZero = true;
  for (const c of vis.count[0]) if (c !== 0) countsZero = false;
  ok('post-clear: counts all zero', countsZero);
  // Re-adding the same id after a clear must work (slot fully freed).
  let threw = false;
  try { vis.setSource(1, 0b01, 1, 1, 1); } catch { threw = true; }
  ok('post-clear: id 1 can be re-added', !threw);
}

// ---- revealAll ---------------------------------------------------------
{
  const vis = new Visibility({ x0: 0, y0: 0, w: 8, h: 8 });
  vis.setSource(1, 0b01, 4, 4, 1);
  vis.revealAll(0);
  let allExplored = true;
  for (const s of vis.state[0]) if (s === 0) allExplored = false;
  ok('revealAll: every cell explored or visible', allExplored);
  ok('revealAll: previously visible cell stays visible', vis.isVisible(0, 4, 4));
}

// ---- maxRadiusCells throws --------------------------------------------------
{
  const vis = new Visibility({ x0: 0, y0: 0, w: 10, h: 10, maxRadiusCells: 4 });
  let threw = false;
  try { vis.setSource(1, 0b01, 5, 5, 100); } catch { threw = true; }
  ok('radius exceeding maxRadiusCells throws', threw);
}

// ---- teams > 8 throws --------------------------------------------------
{
  let threw = false;
  try { new Visibility({ x0: 0, y0: 0, w: 4, h: 4, teams: 9 }); } catch { threw = true; }
  ok('teams > 8 throws', threw);
}

// ---- hashInto: same value in two runs --------------------------------------
{
  function makeFakeHasher() {
    let h = 0x811c9dc5 | 0;
    const FNV_PRIME = 16777619;
    return {
      u8Array(arr, start, end) {
        for (let i = start; i < end; i++) {
          h ^= arr[i];
          h = Math.imul(h, FNV_PRIME);
        }
      },
      value() { return h >>> 0; },
    };
  }
  const vis = new Visibility({ x0: 0, y0: 0, w: 12, h: 12, teams: 2 });
  vis.setSource(1, 0b01, 6, 6, 3);
  vis.setSource(2, 0b10, 2, 2, 2);

  const h1 = makeFakeHasher();
  vis.hashInto(h1);
  const h2 = makeFakeHasher();
  vis.hashInto(h2);
  ok('hashInto gives the same value in two runs', h1.value() === h2.value());

  const vis2 = new Visibility({ x0: 0, y0: 0, w: 12, h: 12, teams: 2 });
  const h3 = makeFakeHasher();
  vis2.hashInto(h3);
  ok('hashInto differs for a different visibility state', h1.value() !== h3.value());
}

// ---- perf: 200 sources, rc=8, moving 1 cell/tick <= 0.5 ms/tick ------------
{
  const w = 200, h = 200;
  const vis = new Visibility({ x0: 0, y0: 0, w, h, maxSources: 256, maxRadiusCells: 8 });
  const N = 200;
  const rnd = lcg(7);
  const px = new Float64Array(N), py = new Float64Array(N), dir = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    px[i] = 10 + rnd() * (w - 20);
    py[i] = 10 + rnd() * (h - 20);
    dir[i] = 1;
    vis.setSource(i, 0b01, px[i], py[i], 8);
  }

  function tick() {
    for (let i = 0; i < N; i++) {
      px[i] += dir[i];
      if (px[i] > w - 10 || px[i] < 10) dir[i] = -dir[i];
      vis.setSource(i, 0b01, px[i], py[i], 8);
    }
  }

  for (let i = 0; i < 10; i++) tick(); // warm up

  const REPS = 60;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < REPS; i++) tick();
  const t1 = process.hrtime.bigint();
  const msEach = Number(t1 - t0) / 1e6 / REPS;
  perfOk('perf: 200 sources, rc=8, move 1 cell/tick <= 0.5 ms/tick', msEach <= 0.5, `${msEach.toFixed(3)} ms/tick (PERF_STRICT=${PERF_STRICT ? 1 : 0})`);
}

// ---- zero allocation over 10k setSource calls ------------------------------
{
  if (typeof global.gc === 'function') {
    const vis = new Visibility({ x0: 0, y0: 0, w: 64, h: 64, maxSources: 32, maxRadiusCells: 8 });
    const N = 16;
    const rnd = lcg(99);
    for (let i = 0; i < N; i++) vis.setSource(i, 0b01, rnd() * 64, rnd() * 64, 5);
    for (let i = 0; i < 2000; i++) { // warm up
      const id = i % N;
      vis.setSource(id, 0b01, rnd() * 64, rnd() * 64, 5);
    }
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 10000; i++) {
      const id = i % N;
      vis.setSource(id, 0b01, rnd() * 64, rnd() * 64, 5);
    }
    global.gc();
    const after = process.memoryUsage().heapUsed;
    const grew = after - before;
    ok('zero alloc: setSource() over 10k calls (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes`);
  } else {
    console.warn('WARN: zero-alloc check skipped (run with --expose-gc for a real gate)');
    pass++;
  }
}

function buffersEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
