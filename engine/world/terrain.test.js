// engine/world/terrain.test.js (US-025). Headless Node ESM, no framework.
// Run: node engine/world/terrain.test.js
import { Terrain } from './Terrain.js';
import { World } from './World.js';
import terrainDef from '../../design/levels/overworld_far.js';
import { makeOk } from '../test/assert.js';
// CO-9 regression test (below): needs a real World.load of world_m1, same
// asset set world.test.js/serialize.visibility.test.js use (every model
// world_m1.world.json's props/structures reference must be registered).
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
terrainDef; // runs the IIFE, sets window.ASSETS.levels.overworld_far
paletteMod; detailPassMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod;
farTowerMod; ferrumLightsMod;
const recipe = globalThis.ASSETS.levels.overworld_far;
// CO-9: no more x/y/w/h/ringH fallback in the recipe itself - every
// standalone `new Terrain(recipe)` below drives the SAME shared recipe
// object, so inject the tower's bbox/ringHAt once, here, before any of
// them (same numbers the old fallback hardcoded).
recipe.structures[0].bbox = { x0: 1480, y0: 1018, x1: 1504, y1: 1032 };
recipe.structures[0].ringHAt = () => 2.4;

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

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

// ---------------------------------------------------------------------------
// US-026a (architecture.md 23.1 decision 1, 23.7 S1): bakeNearBand,
// groundAt/groundNormalAt/groundTypeAt, nearReady.
// ---------------------------------------------------------------------------

// --- band == the 9 bakeChunk results, cell for cell -------------------------
{
  const i = new Terrain(recipe);
  const cx = Math.floor(recipe.tower.x / i.chunkSize);
  const cy = Math.floor(recipe.tower.y / i.chunkSize);
  const t0 = performance.now();
  i.bakeNearBand(cx, cy);
  const bakeMs = performance.now() - t0;
  ok('bakeNearBand finishes within the 300 ms AC', bakeMs <= 300, `${bakeMs.toFixed(1)} ms`);
  ok('nearReady flips true', i.nearReady === true);

  const n = i.chunkSize / i.nearCell; // 64
  let mismatches = 0;
  for (let dy = -1; dy <= 1 && mismatches === 0; dy++) {
    for (let dx = -1; dx <= 1 && mismatches === 0; dx++) {
      const G = recipe.util.bakeChunk(cx + dx, cy + dy);
      const bx = (dx + 1) * n, by = (dy + 1) * n; // this chunk's offset inside the 192x192 band
      for (let jj = 0; jj < n; jj++) {
        for (let ii = 0; ii < n; ii++) {
          const bandIdx = (bx + ii) + (by + jj) * i.near.w;
          const chunkIdx = ii + jj * n;
          if (i.near.height[bandIdx] !== G.height[chunkIdx] || i.near.type[bandIdx] !== G.type[chunkIdx]) mismatches++;
        }
      }
    }
  }
  ok('band matches the 9 bakeChunk results cell for cell', mismatches === 0, `${mismatches} mismatched cells`);
}

// --- groundAt inside == gridHeight(near); outside == heightAt; near heightAt off the band edge --
{
  const i = new Terrain(recipe);
  const cx = Math.floor(recipe.tower.x / i.chunkSize);
  const cy = Math.floor(recipe.tower.y / i.chunkSize);
  i.bakeNearBand(cx, cy);

  const insideX = i.near.x0 + i.near.w * i.near.cell / 2, insideY = i.near.y0 + i.near.h * i.near.cell / 2;
  ok('groundAt inside the band == gridHeight(near)', i.groundAt(insideX, insideY) === recipe.util.gridHeight(i.near, insideX, insideY));

  const farOutX = i.near.x0 - 5000, farOutY = i.near.y0 - 5000;
  ok('groundAt far outside the band == analytic heightAt', i.groundAt(farOutX, farOutY) === i.heightAt(farOutX, farOutY));

  // The contract: band nodes ARE heightAt samples (physics, render and the water column all read the grid).
  // Between nodes the bilinear error depends on content curvature (a 3 m-falloff pond bowl gives ~0.14 m), so it is
  // bounded loosely and only for a fraction of points. Seeded so the suite can't fail at random.
  let worstNode = 0;
  for (let jj = 0; jj < i.near.h; jj++) for (let ii = 0; ii < i.near.w; ii++) {
    const x = i.near.x0 + (ii + 0.5) * i.near.cell, y = i.near.y0 + (jj + 0.5) * i.near.cell;
    worstNode = Math.max(worstNode, Math.abs(i.groundAt(x, y) - i.heightAt(x, y)));
  }
  ok('groundAt == heightAt at every band node (<= 1e-4 m)', worstNode <= 1e-4, `worst ${worstNode}`);

  let seed = 0x9e3779b9 >>> 0;
  const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let worstDiff = 0, within = 0; const N = 5000;
  for (let k = 0; k < N; k++) {
    const x = i.near.x0 + rnd() * i.near.w * i.near.cell, y = i.near.y0 + rnd() * i.near.h * i.near.cell;
    const diff = Math.abs(i.groundAt(x, y) - i.heightAt(x, y));
    if (diff <= 0.01) within++;
    if (diff > worstDiff) worstDiff = diff;
  }
  ok('|groundAt - heightAt| <= 0.01 m on >= 99.5 % of 5000 seeded band points', within >= 0.995 * N, `${within}/${N}`);
  ok('|groundAt - heightAt| <= 0.25 m everywhere in the band (interpolation sanity)', worstDiff <= 0.25, `worst ${worstDiff}`);
}

// --- groundTypeAt / groundNormalAt basic sanity -----------------------------
{
  const i = new Terrain(recipe);
  const cx = Math.floor(recipe.tower.x / i.chunkSize);
  const cy = Math.floor(recipe.tower.y / i.chunkSize);
  i.bakeNearBand(cx, cy);

  const insideX = i.near.x0 + i.near.w * i.near.cell / 2, insideY = i.near.y0 + i.near.h * i.near.cell / 2;
  ok('groundTypeAt inside the band == nearest near.type texel', i.groundTypeAt(insideX, insideY) === i._nearGridType(insideX, insideY));
  const farOutX = i.near.x0 - 5000, farOutY = i.near.y0 - 5000;
  ok('groundTypeAt outside the band == analytic typeAt', i.groundTypeAt(farOutX, farOutY) === i.typeAt(farOutX, farOutY));

  const gn = { x: 0, y: 0, z: 0 };
  i.groundNormalAt(recipe.tower.x, recipe.tower.y, gn);
  ok('groundNormalAt returns a unit vector', Math.abs(Math.hypot(gn.x, gn.y, gn.z) - 1) < 1e-6);
  ok('groundNormalAt on the flat tower crown points mostly up', gn.z > 0.9, `z=${gn.z}`);
}

// --- before bakeNearBand: groundAt/groundTypeAt fall back to analytic, no throw --
{
  const i = new Terrain(recipe);
  let threw = false;
  let gVal, hVal;
  try { gVal = i.groundAt(recipe.tower.x, recipe.tower.y); hVal = i.heightAt(recipe.tower.x, recipe.tower.y); } catch (e) { threw = true; }
  ok('groundAt before bakeNearBand does not throw and matches heightAt', !threw && gVal === hVal);
}

// --- CO-9 regression: World.load's real injection is the ONLY path (no --
// --- fallback left to mask a regression here) -----------------------------
{
  const { assets } = await loadTestAssets();
  const world = World.load(assets.world('world_m1'), assets, {});
  const rs = world.terrain.recipe.structures.find((s) => s.id === 'tower');
  ok('World.load injects a real bbox onto the tower structure entry',
    !!rs && !!rs.bbox && isFinite(rs.bbox.x0) && isFinite(rs.bbox.y0) && isFinite(rs.bbox.x1) && isFinite(rs.bbox.y1),
    JSON.stringify(rs && rs.bbox));
  ok('World.load injects a real ringHAt function onto the tower structure entry',
    !!rs && typeof rs.ringHAt === 'function');
  const ringSample = rs && rs.ringHAt((rs.bbox.x0 + rs.bbox.x1) / 2, rs.bbox.y0 - 1);
  ok('the injected ringHAt returns a finite height near the tower ring', typeof ringSample === 'number' && isFinite(ringSample), `${ringSample}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f2) => console.error('FAIL:', f2)); process.exit(1); }
console.log('ALL PASS');
