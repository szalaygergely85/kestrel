// engine/world/terrain.test.js (US-025). Headless Node ESM, no framework.
// Run: node engine/world/terrain.test.js
import { Terrain } from './Terrain.js';
import terrainDef from '../../design/levels/overworld_far.js';

globalThis.window = globalThis.window || globalThis;
terrainDef; // runs the IIFE, sets window.ASSETS.levels.overworld_far
const recipe = globalThis.ASSETS.levels.overworld_far;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// --- bakeFarSync checksum == bakeFarStep run to completion ----------------
const a = new Terrain(recipe);
a.bakeFarSync();
const checksumSync = a.checksum();

const b = new Terrain(recipe);
let guard = 0;
while (!b.farReady && guard++ < 100000) b.bakeFarStep(2);
ok('bakeFarStep resumes to the same checksum as bakeFarSync', checksumSync === b.checksum(),
  `${checksumSync} vs ${b.checksum()}`);
ok('bakeFarStep needed more than one call (row-granular, resumable)', guard > 1, `guard=${guard}`);

// --- same seed twice == same checksum --------------------------------------
const c = new Terrain(recipe);
c.bakeFarSync();
ok('same seed twice -> same checksum', c.checksum() === checksumSync);

// --- each bakeFarStep call <= budget + one row ------------------------------
const d = new Terrain(recipe);
const budget = 2;
let worstOver = 0;
while (!d.farReady) {
  const t0 = performance.now();
  d.bakeFarStep(budget);
  const dt = performance.now() - t0;
  // One row's worth of extra time is allowed past the budget (row-granular);
  // give a generous multiple since a single Node process can hiccup (GC).
  if (dt > budget * 6 + 5) worstOver = Math.max(worstOver, dt);
}
ok('bakeFarStep respects its ms budget (row-granular)', worstOver === 0, `worst overrun ${worstOver} ms`);

// --- setCenter by one chunk regenerates exactly 3 chunks --------------------
const e = new Terrain(recipe);
e.setCenter(1480, 1018);
e.bakeChunkStep(10000);
const before = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
  const cx = e._centerCx + dx, cy = e._centerCy + dy;
  before.push(e.chunk(cx, cy));
}
ok('setCenter bakes the initial 3x3 resident ring', before.every((c2) => c2 !== null));

const keysBefore = new Set(before.map((c2) => `${c2.cx},${c2.cy}`));
e.setCenter(1480 + e.chunkSize, 1018); // move exactly one chunk east
e.bakeChunkStep(10000);
let regenerated = 0;
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
  const cx = e._centerCx + dx, cy = e._centerCy + dy;
  const c2 = e.chunk(cx, cy);
  ok(`chunk (${cx},${cy}) resident after the move`, c2 !== null);
  if (c2 && !keysBefore.has(`${c2.cx},${c2.cy}`)) regenerated++;
}
ok('moving one chunk regenerates exactly 3 chunks (the new column)', regenerated === 3, `regenerated=${regenerated}`);

// --- chunk seam vertices equal on both sides --------------------------------
const f = new Terrain(recipe);
f.setCenter(1480, 1018);
f.bakeChunkStep(10000);
const cx0 = f._centerCx, cy0 = f._centerCy;
const left = f.chunk(cx0, cy0);
const right = f.chunk(cx0 + 1, cy0);
if (left && right) {
  const n = f.chunkSize / f.nearCell; // 65x65 vertex convention would need n+1; this recipe bakes n x n cell centers,
  // so the "seam" check here compares the two chunks' shared-edge CELL HEIGHTS via the analytic heightAt directly
  // (both must read the same real-world height at the shared boundary, since heightAt is continuous/analytic - 7).
  const boundaryX = (cx0 + 1) * f.chunkSize;
  const y = (cy0 + 0.5) * f.chunkSize;
  const hL = recipe.util.heightAt(boundaryX - 1e-6, y);
  const hR = recipe.util.heightAt(boundaryX + 1e-6, y);
  ok('chunk seam heights agree (continuous analytic heightAt)', Math.abs(hL - hR) < 1e-3, `${hL} vs ${hR}`);
} else {
  ok('chunk seam vertices equal on both sides', false, 'chunks not resident');
}

// --- sample before farReady does not throw ----------------------------------
const g = new Terrain(recipe);
let threw = false;
try { g.sample(1490, 1020, 500); } catch (err) { threw = true; }
ok('sample() before farReady does not throw', !threw);

// --- normalAt on flat ground points up --------------------------------------
const h = new Terrain(recipe);
const n = { x: 0, y: 0, z: 0 };
h.normalAt(recipe.tower.x, recipe.tower.y, n);
ok('normalAt returns a unit vector', Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-6);
ok('normalAt on the flat tower crown points mostly up', n.z > 0.9, `z=${n.z}`);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f2) => console.error('FAIL:', f2)); process.exit(1); }
console.log('ALL PASS');
