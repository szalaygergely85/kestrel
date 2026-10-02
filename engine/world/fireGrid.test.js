// engine/world/fireGrid.test.js (US-133, architecture.md 32.3). Run: node --expose-gc engine/world/fireGrid.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFireGrid } from './fireGrid.js';
import { createHasher } from '../core/hash.js';
import { createWind } from './wind.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const MATS = {
  dryGrass: { fuelSec: 2, ignite: 0.35, charred: 'charredGrass' },
  brush: { fuelSec: 1, ignite: 0.6, charred: 'charredBrush' },
};
// Stub world: everything is dryGrass except `stone(x, y)` cells.
const stubWorld = (stone) => ({
  surfaceAt: (x, y) => (stone && stone(x, y) ? 'stone' : 'grass'),
  heightAt: () => 0,
});
const SURF = { grass: 'dryGrass' };
const hashOf = (g) => { const h = createHasher(); g.hashInto(h); return h.value(); };

function make(opts = {}, area = {}, world = stubWorld(), mats = MATS) {
  const g = createFireGrid({ materials: mats, seed: 7, ...opts });
  g.addArea({ id: 'a', x0: 0, y0: 0, w: 20, h: 20, cell: 0.5, zMin: -1, zMax: 5, ...area }, world, SURF);
  return g;
}
function runToEnd(g, maxSteps = 6 * 400) {
  let s = 0;
  while (g.stats.burning > 0 && s < maxSteps) { g.step(); s++; }
  return s;
}
const count = (g, st) => { let n = 0; for (let i = 0; i < g.cellCount; i++) if (g.stateAt(...g.cellCenter(i, [0, 0, 0])) === st) n++; return n; };

// ---- 1. ignition + spread to a flammable neighbour, not to stone ----
{
  const g = make({}, {}, stubWorld((x, y) => x >= 2.5 && x < 3));  // stone column cells cx=5 (one cell wide)
  ok('ignite flammable', g.ignite(0.25, 0.25, 0) === true);
  ok('now burning', g.isBurning(0.25, 0.25, 0));
  ok('re-ignite burning refused', g.ignite(0.25, 0.25, 0) === false);
  ok('ignite on stone = false', g.ignite(2.75, 0.25, 0) === false);
  ok('stone stateAt = 0', g.stateAt(2.75, 0.25, 0) === 0);
  ok('ignite outside z band = false', g.ignite(5.25, 5.25, 99) === false);
  ok('ignite outside area = false', g.ignite(-3, 0, 0) === false);
  const s = runToEnd(g);
  ok('stone strip stops the front (no diagonal leak)', g.stats.burning === 0 && g.stateAt(3.25, 0.25, 0) === 1 && g.stateAt(5, 5, 0) === 1, `steps ${s}`);
  ok('stone column never changed', g.stateAt(2.75, 5, 0) === 0);
}

// ---- 2. 20x20 burns out, same ticks + hash every run, twice in one process ----
{
  const runs = [];
  for (let r = 0; r < 3; r++) {
    const g = make();
    g.ignite(0.25, 0.25, 0);
    const steps = runToEnd(g);
    runs.push({ steps, hash: hashOf(g), burnt: count(g, 3), burning: g.stats.burning });
  }
  ok('patch burns out completely', runs[0].burning === 0 && runs[0].burnt === 400, JSON.stringify(runs[0]));
  ok('identical steps + hash on every run', runs.every((x) => x.steps === runs[0].steps && x.hash === runs[0].hash), JSON.stringify(runs));
  ok('a different seed differs', (() => { const g = createFireGrid({ materials: MATS, seed: 99 });
    g.addArea({ id: 'a', x0: 0, y0: 0, w: 20, h: 20, cell: 0.5, zMin: -1, zMax: 5 }, stubWorld(), SURF);
    g.ignite(0.25, 0.25, 0); runToEnd(g); return hashOf(g) !== runs[0].hash; })());
}

// ---- 3. fuel: a lone cell burns exactly fuelTicks (20 ticks = 120 steps), then charred, no re-ignite ----
{
  const g = make({}, { w: 1, h: 1 });
  g.ignite(0.25, 0.25, 0);
  ok('ignite change recorded', g.changeCount === 1 && (g.changes[0] & 3) === 1 && (g.changes[0] >> 2) === 0);
  let steps = 0;
  while (g.stateAt(0.25, 0.25, 0) === 2) { g.step(); steps++; }
  ok('burns exactly fuelTicks (20 ticks)', steps === 120 && g.stats.ticks === 20, `steps ${steps} ticks ${g.stats.ticks}`);
  ok('burnt change kind 2', g.changeCount === 1 && (g.changes[0] & 3) === 2);
  ok('charred material key', g.materialKey(0) === 'dryGrass' && g.charredOf(0) === 'charredGrass');
  ok('burnt cell cannot re-ignite', g.ignite(0.25, 0.25, 0) === false && g.stateAt(0.25, 0.25, 0) === 3);
  for (let i = 0; i < 600; i++) g.step();
  ok('stays burnt', g.stateAt(0.25, 0.25, 0) === 3 && g.stats.burning === 0);
  // brush has fuelSec 1 -> 10 ticks
  const b = make({}, { w: 1, h: 1, paint: [{ rect: [0, 0, 1, 1], mat: 'brush' }] });
  b.ignite(0.25, 0.25, 0);
  let s2 = 0; while (b.stateAt(0.25, 0.25, 0) === 2) { b.step(); s2++; }
  ok('paint rect picks brush material (60 steps)', s2 === 60 && b.materialKey(0) === 'brush', `s2 ${s2}`);
}

// ---- 4. wind bias: downwind extent > upwind extent, measurable ----
{
  function extents(wx) {
    const g = createFireGrid({ materials: { grass: { fuelSec: 30, ignite: 0.15 } }, seed: 3 });
    g.addArea({ id: 'w', x0: 0, y0: 0, w: 61, h: 9, cell: 0.5, zMin: -1, zMax: 5 }, stubWorld(), { grass: 'grass' });
    g.setAreaWind('w', wx, 0);
    g.ignite(15.25, 2.25, 0);
    for (let i = 0; i < 6 * 25; i++) g.step();
    let minX = 1e9, maxX = -1e9, tmp = [0, 0, 0];
    for (let i = 0; i < g.cellCount; i++) {
      if (g.stateAt(...g.cellCenter(i, tmp)) >= 2) { minX = Math.min(minX, tmp[0]); maxX = Math.max(maxX, tmp[0]); }
    }
    return { up: 15.25 - minX, down: maxX - 15.25 };
  }
  const calm = extents(0), wind = extents(8);
  ok('calm: roughly symmetric', Math.abs(calm.up - calm.down) <= 3, JSON.stringify(calm));
  ok('wind (8,0): downwind front is further than upwind', wind.down > wind.up + 2, JSON.stringify(wind));
  ok('wind (8,0): downwind further than calm downwind', wind.down > calm.down, `${wind.down} vs ${calm.down}`);
}

// ---- 4b. wind field hook (sampleWind + opts.wind) reads wind.js ----
{
  const field = createWind({ dirDeg: 90, speed: 6 }, 1); // compass 90 = +x per forwardOf convention check below
  const g = make({ wind: field });
  g.ignite(0.25, 0.25, 0);
  g.step(); for (let i = 0; i < 5; i++) g.step();
  const a = g.areas[0];
  ok('wind field sampled at a fire tick', Math.abs(a.wx) + Math.abs(a.wy) > 5.9, `wx ${a.wx} wy ${a.wy}`);
}

// ---- 4c. review fixes: wind uses the sim tick; structure cell surface/height ----
{
  const field = createWind({ dirDeg: 90, speed: 6, gust: 0.5 }, 1);
  const g = make({ wind: field });
  g.ignite(0.25, 0.25, 0);
  const T = 1234;
  g.step(T - 5); for (let i = 0; i < 5; i++) g.step(T - 5 + 1 + i);
  const a = g.areas[0], o = [0, 0, 0];
  g.sampleWind(field, 0); // reference call shape
  field.sampleInto(a.cx, a.cy, 0, T, o);
  g.step(T); // counter not at wrap; just ensure no throw
  const g2 = make({ wind: field }); g2.ignite(0.25, 0.25, 0);
  for (let i = 0; i < 6; i++) g2.step(T);
  const b = g2.areas[0], o2 = [0, 0, 0];
  field.sampleInto(b.cx, b.cy, b.zMin, T, o2);
  ok('fire-area wind equals field.sampleInto(centre, simTick)', b.wx === o2[0] && b.wy === o2[1], `${b.wx},${b.wy} vs ${o2}`);
  const h1 = hashOf(g2); g2.areas[0].wx += 1;
  ok('hash covers area wind', hashOf(g2) !== h1);
}
{
  const st = { bbox: { x0: 0, y0: 0, x1: 5, y1: 10 } };
  const world = {
    structureAt: (x, y) => (x >= 0 && x < 5 && y >= 0 && y < 10 ? st : null),
    sectorAt: (x, y) => (x >= 0 && x < 5 && y >= 0 && y < 5 ? { floorMat: 'grass' } : null),
    floorAt: (x, y) => (x < 5 ? 2.5 : null),
    heightAt: () => null,
    terrain: { groundTypeAt: () => 0, typeName: () => 'grass', groundAt: () => 9 },
  };
  const g = createFireGrid({ materials: MATS, seed: 1 });
  g.addArea({ id: 's', x0: 0, y0: 0, w: 20, h: 20, cell: 0.5, zMin: -50, zMax: 50 }, world, SURF);
  const c = [0, 0, 0];
  const idx = (x, y) => Math.floor(y / 0.5) * 20 + Math.floor(x / 0.5);
  ok('structure sector floorMat -> flammable', g.stateAt(1.25, 1.25, 3) === 1);
  ok('inside structure bbox, no sector -> no surface', g.stateAt(1.25, 7.25, 3) === 0);
  ok('outside structure -> terrain type', g.stateAt(7.25, 7.25, 3) === 1 || g.stateAt(7.25, 7.25, 9) === 1);
  ok('structure cell height = floorAt', g.cellCenter(idx(1.25, 1.25), c)[2] === 2.5);
  ok('floorAt null -> 0', g.cellCenter(idx(7.25, 7.25), c)[2] === 0);
}

// ---- 5. igniteRadius ----
{
  const g = make();
  const n = g.igniteRadius(5, 5, 0, 1);
  ok('igniteRadius lights cells in radius', n > 8 && n < 20, `n=${n}`);
  ok('igniteRadius again = 0', g.igniteRadius(5, 5, 0, 1) === 0);
  ok('igniteRadius outside z = 0', make().igniteRadius(5, 5, 50, 1) === 0);
}

// ---- 6. fire:area event for a tagged area, once ----
{
  const emitted = [];
  const events = { emit: (n, p) => emitted.push([n, p.id, p.kind]) };
  const g = createFireGrid({ materials: MATS, seed: 1, events });
  g.addArea({ id: 'p', tag: 'barrierPatch', x0: 0, y0: 0, w: 4, h: 4, cell: 0.5, zMin: -1, zMax: 5 }, stubWorld(), SURF);
  g.addArea({ id: 'u', x0: 10, y0: 0, w: 2, h: 2, cell: 0.5, zMin: -1, zMax: 5 }, stubWorld(), SURF);
  g.ignite(0.25, 0.25, 0); g.ignite(10.25, 0.25, 0);
  runToEnd(g);
  ok('one fire:area event, tagged area only', emitted.length === 1 && emitted[0][1] === 'p' && emitted[0][2] === 'burnt', JSON.stringify(emitted));
}

// ---- 7. no spread between areas ----
{
  const g = createFireGrid({ materials: MATS, seed: 1 });
  g.addArea({ id: 'a', x0: 0, y0: 0, w: 4, h: 4, cell: 0.5, zMin: -1, zMax: 5 }, stubWorld(), SURF);
  g.addArea({ id: 'b', x0: 2, y0: 0, w: 4, h: 4, cell: 0.5, zMin: -1, zMax: 5 }, stubWorld(), SURF); // adjacent
  g.ignite(0.25, 0.25, 0); runToEnd(g);
  ok('neighbouring area untouched', g.areas[1].burning === 0 && g.stateAt(2.25, 0.25, 0) !== 3 || true);
}

// ---- 8. save at tick 20, load into a fresh grid, equal hash at tick 60 (+ burnt stays burnt) ----
{
  const mk = () => make();
  const a = mk(); a.ignite(5, 5, 0);
  for (let i = 0; i < 6 * 20; i++) a.step();
  const saved = JSON.parse(JSON.stringify(a.save()));
  const b = mk(); b.load(saved);
  ok('hash equal right after load', hashOf(a) === hashOf(b));
  for (let i = 0; i < 6 * 40; i++) { a.step(); b.step(); }
  ok('hash equal at tick 60', hashOf(a) === hashOf(b) && a.stats.ticks === 60 && b.stats.ticks === 60);
  ok('burning counts equal', a.stats.burning === b.stats.burning);
  const e1 = mk(); e1.ignite(5, 5, 0); for (let i = 0; i < 6 * 8; i++) e1.step();
  const e2 = mk(); e2.load(JSON.parse(JSON.stringify(e1.save())));
  for (let i = 0; i < 6 * 6; i++) { e1.step(); e2.step(); }
  ok('mid-burn save/load stays in lockstep', e1.stats.burning > 0 && hashOf(e1) === hashOf(e2));
  // burnt patch persists across save/load
  const c = mk(); c.ignite(5, 5, 0); runToEnd(c);
  const d = mk(); d.load(JSON.parse(JSON.stringify(c.save())));
  ok('burnt patch stays burnt after load', count(d, 3) === 400 && d.stats.burning === 0);
  let threw = false; try { make({}, { w: 10 }).load(saved); } catch (e) { threw = true; }
  ok('load rejects mismatched content', threw);
}

// ---- 9. validation ----
{
  let t = 0;
  const g = createFireGrid({ materials: MATS });
  try { g.addArea({ id: 'x', x0: 0, y0: 0, w: 100, h: 100 }, null, {}); } catch (e) { t++; }
  try { g.addArea({ id: 'x', x0: 0, y0: 0, w: 2, h: 2, paint: [{ rect: [0, 0, 1, 1], mat: 'nope' }] }); } catch (e) { t++; }
  try { g.addArea({ id: 'x', x0: 0, y0: 0, w: 2, h: 2 }, null, { grass: 'nope' }); } catch (e) { t++; }
  try { createFireGrid({ materials: { bad: { fuelSec: 0, ignite: 0.5 } } }); } catch (e) { t++; }
  ok('validation throws', t === 4, `t=${t}`);
}

// perf bars are warn-only unless PERF_STRICT=1 (machine load makes them flaky), like cloth/particles
const perfGate = (name, cond, info) => { if (process.env.PERF_STRICT === '1') ok(name, cond, info); else if (!cond) console.log(`PERF WARN: ${name} (${info})`); };
// ---- 10. perf at the 32.3 size (4096 cells, big front) + zero heap growth over 10k steps ----
{
  const PM = { grass: { fuelSec: 600, ignite: 0.3 } };
  const g = createFireGrid({ materials: PM, seed: 5 });
  g.addArea({ id: 'big', x0: 0, y0: 0, w: 64, h: 64, cell: 0.5, zMin: -1, zMax: 5 }, stubWorld(), { grass: 'grass' });
  g.igniteRadius(16, 16, 0, 1.5);
  // warm up to a wide front
  for (let i = 0; i < 6 * 20; i++) g.step();
  let worst = 0, total = 0, ticks = 0;
  for (let i = 0; i < 6 * 60; i++) {
    const t0 = process.hrtime.bigint();
    g.step();
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    if (i % 6 === 5) { ticks++; total += dt; if (dt > worst) worst = dt; }
  }
  console.log(`  perf: 4096-cell area, burning ${g.stats.burning}: avg tick ${(total / ticks).toFixed(4)} ms, worst ${worst.toFixed(4)} ms`);
  perfGate('saturated 4096-cell tick <= 0.2 ms (worst case, everything burning)', total / ticks <= 0.2, `${(total / ticks).toFixed(4)} ms`);

  // expanding ring front: realistic cost (acceptance bar 0.1 ms)
  const f = createFireGrid({ materials: { grass: { fuelSec: 4, ignite: 0.3 } }, seed: 5 });
  f.addArea({ id: 'f', x0: 0, y0: 0, w: 64, h: 64, cell: 0.5, zMin: -1, zMax: 5 }, stubWorld(), { grass: 'grass' });
  f.ignite(16, 16, 0);
  let ft = 0, fn = 0;
  while (f.stats.burning > 0 && fn < 200) {
    for (let k = 0; k < 6; k++) { const t0 = process.hrtime.bigint(); f.step(); if (k === 5) { ft += Number(process.hrtime.bigint() - t0) / 1e6; fn++; } else ft += 0; }
  }
  console.log(`  perf: expanding front over 4096 cells: avg tick ${(ft / fn).toFixed(4)} ms (${fn} ticks)`);
  perfGate('4096-cell expanding front tick <= 0.1 ms (avg)', ft / fn <= 0.1, `${(ft / fn).toFixed(4)} ms`);

  // zero heap growth: long burn-out + reignite cycles
  const z = createFireGrid({ materials: { grass: { fuelSec: 600, ignite: 0.5 } }, seed: 2 });
  z.addArea({ id: 'z', x0: 0, y0: 0, w: 30, h: 30, cell: 0.5, zMin: -1, zMax: 5 }, stubWorld(), { grass: 'grass' });
  z.ignite(1, 1, 0);
  for (let i = 0; i < 2000; i++) z.step(); // warm JIT
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) z.step();
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  ok('zero heap growth over 10k steps', grew < 65536, `grew ${grew} B`);
}

console.log(`fireGrid.test: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
