// engine/world/terrainEditsFix.test.js (ED-TERRAIN-1 arch fixes 1-3, docs/architecture.md 37.12).
// Run: node engine/world/terrainEditsFix.test.js
import { Terrain } from './Terrain.js';
import { createEditLayer, applyDab, editHeightAt, sampleDh, sampleType } from './terrainEdits.js';
import * as engine from '../index.js';
import terrainDef from '../../design/levels/overworld_far.js';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
terrainDef;
const recipe = globalThis.ASSETS.levels.overworld_far;
const tower = recipe.structures[0];
tower.bbox = { x0: 1480, y0: 1018, x1: 1504, y1: 1032 };
tower.ringHAt = () => 2.4;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

ok('editHeightAt exported from engine/index.js', engine.editHeightAt === editHeightAt);

// --- 1. flatten/smooth under a structure footprint settle ------------------------------
{
  const L = createEditLayer(2, 128);
  // stub: base 10, inside the footprint heightAt ignores the delta (structureBlend), baseHeightAt does not
  const inFoot = (x, y) => x >= 90 && x <= 110 && y >= 90 && y <= 110;
  const stub = {
    util: { baseHeightAt: (x, y) => 10 + L.heightDelta(x, y) },
    heightAt: (x, y) => (inFoot(x, y) ? 10 : 10 + L.heightDelta(x, y)),
  };
  for (let k = 0; k < 50; k++) applyDab(L, stub, 'flatten', 100, 100, 6, 0.5, null, 12);
  let max = 0;
  for (let j = 40; j <= 60; j++) for (let i = 40; i <= 60; i++) max = Math.max(max, Math.abs(sampleDh(L, i, j)));
  ok('stub footprint: 50 flatten dabs settle at +2 m (200 cm), no clamp', max <= 200 && max > 150, `${max} cm`);
  for (let k = 0; k < 50; k++) applyDab(L, stub, 'smooth', 100, 100, 6, 1);
  let max2 = 0;
  for (let j = 40; j <= 60; j++) for (let i = 40; i <= 60; i++) max2 = Math.max(max2, Math.abs(sampleDh(L, i, j)));
  ok('stub footprint: 50 smooth dabs stay bounded', max2 <= 200, `${max2} cm`);
  // without baseHeightAt the same dabs would run (documents the old behaviour)
  const L2 = createEditLayer(2, 128);
  const old = { heightAt: (x, y) => (inFoot(x, y) ? 10 : 10 + L2.heightDelta(x, y)) };
  for (let k = 0; k < 50; k++) applyDab(L2, old, 'flatten', 100, 100, 6, 0.5, null, 12);
  ok('control: without baseHeightAt the old path runs away', Math.abs(sampleDh(L2, 50, 50)) > 1000, `${sampleDh(L2, 50, 50)} cm`);

  // real recipe + real tower footprint
  const L3 = createEditLayer(2, 128);
  const t = new Terrain(recipe, { edits: L3 });
  ok('editHeightAt = util.baseHeightAt (real recipe)', editHeightAt(t, 1490, 1025) === recipe.util.baseHeightAt(1490, 1025));
  const target = editHeightAt(t, 1490, 1025) + 1.5;
  for (let k = 0; k < 50; k++) applyDab(L3, t, 'flatten', 1490, 1025, 6, 0.5, null, target);
  let m3 = 0;
  for (let j = 509; j <= 516; j++) for (let i = 741; i <= 749; i++) m3 = Math.max(m3, Math.abs(sampleDh(L3, i, j)));
  ok('real footprint: dh settles near +1.5 m, far from the clamp', m3 > 0 && m3 <= 160, `${m3} cm`);
  new Terrain(recipe);
}

// --- 2. paint dab symmetric around a cell centre ---------------------------------------
{
  const L = createEditLayer(2, 128);
  const rect = {};
  applyDab(L, { heightAt: () => 0 }, 'paint', 101, 101, 3, 4, rect); // centre of cell (50,50)
  let sym = true, n = 0;
  for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
    const a = sampleType(L, 50 + di, 50 + dj) !== 255, b = sampleType(L, 50 - di, 50 - dj) !== 255, c = sampleType(L, 50 + dj, 50 + di) !== 255;
    if (a !== b || a !== c) sym = false;
    if (a) n++;
  }
  ok('paint r=3 at a cell centre is symmetric', sym, `${n} cells`);
  ok('paint r=3 at a cell centre: expected 9 cells (2 m pitch, corners d=2.83)', n === 9, `${n}`);
  ok('paint rect spans 49..51 around cell 50', rect.i0 === 49 && rect.i1 === 51 && rect.j0 === 49 && rect.j1 === 51, JSON.stringify(rect));
}

// --- 3. two Terrains, one recipe, different layers ---------------------------------------
{
  const mk = (x, y, op, s) => { const L = createEditLayer(2, 128); const t = new Terrain(recipe, { edits: L }); applyDab(L, t, op, x, y, 8, s); return { L, t }; };
  const solo = (x, y, op, s) => {
    const { t } = mk(x, y, op, s);
    t.bakeFarSync(); t.bakeNearBand(11, 7);
    return { sum: t.checksum(), h: Float32Array.from(t.near.height), ty: Uint8Array.from(t.near.type), probe: t.heightAt(x, y) };
  };
  const sA = solo(1400, 900, 'raise', 3), sB = solo(1330, 1000, 'lower', 2);
  const A = mk(1400, 900, 'raise', 3), B = mk(1330, 1000, 'lower', 2); // B constructed last: it owns the global
  A.t.bakeFarSync(); B.t.bakeFarSync();
  A.t.bakeNearBand(11, 7); B.t.bakeNearBand(11, 7);
  const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  ok('interleaved: far checksum of each == its solo bake', A.t.checksum() === sA.sum && B.t.checksum() === sB.sum);
  ok('interleaved: near height/type of each == its solo bake', same(A.t.near.height, sA.h) && same(A.t.near.type, sA.ty) && same(B.t.near.height, sB.h) && same(B.t.near.type, sB.ty));
  ok('analytic heightAt follows the owning Terrain', Object.is(A.t.heightAt(1400, 900), sA.probe) && Object.is(B.t.heightAt(1330, 1000), sB.probe) && Object.is(A.t.heightAt(1400, 900), sA.probe));
  // rebakeRect on A after B was last used
  const rect = {};
  applyDab(A.L, A.t, 'raise', 1500, 800, 8, 2, rect);
  B.t.heightAt(1, 1); // B grabs the global
  A.t.rebakeRect(rect.i0 * 2, rect.j0 * 2, rect.i1 * 2, rect.j1 * 2);
  const fresh = new Terrain(recipe, { edits: A.L }); fresh.bakeFarSync(); fresh.bakeNearBand(11, 7);
  ok('rebakeRect binds its own layer (== fresh bake)', same(A.t.near.height, fresh.near.height) && same(A.t.near.type, fresh.near.type));
  // setEdits
  const L4 = createEditLayer(2, 128); applyDab(L4, B.t, 'raise', 1400, 900, 8, 1);
  B.t.setEdits(L4);
  ok('setEdits installs and binds the layer', B.t.edits === L4 && Math.abs(B.t.heightAt(1400, 900) - recipe.util.recipeHeight(1400, 900)) > 0.5 && recipe.util.getEditLayer() === L4);
  new Terrain(recipe);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
