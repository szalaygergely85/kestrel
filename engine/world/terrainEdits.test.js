// engine/world/terrainEdits.test.js (ED-TERRAIN-1a, docs/architecture.md 37.12).
// Run: node engine/world/terrainEdits.test.js
import { Terrain } from './Terrain.js';
import { World } from './World.js';
import { createEditLayer, editLayerFromJSON, editLayerToJSON, applyDab, heightDelta, typePaint, sampleDh, setSampleDh, setSampleType } from './terrainEdits.js';
import { stringifyContent } from '../content/stringify.js';
import { loadContentPack } from '../content/loadPack.js';
import terrainDef from '../../design/levels/overworld_far.js';
import { makeOk } from '../test/assert.js';
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
terrainDef; paletteMod; detailPassMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod; farTowerMod; ferrumLightsMod;
const recipe = globalThis.ASSETS.levels.overworld_far;
const tower = recipe.structures[0];
tower.bbox = { x0: 1480, y0: 1018, x1: 1504, y1: 1032 };
tower.ringHAt = () => 2.4;

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// --- empty layer = bit-identical terrain --------------------------------------
const base = new Terrain(recipe); base.bakeFarSync();
const baseSum = base.checksum();
const pts = [[1500, 1000], [1120, 900], [1450, 1030], [300, 300], [1496.5, 1024.5], [1100.3, 1500.7]];
const baseH = pts.map(([x, y]) => recipe.util.heightAt(x, y)), baseT = pts.map(([x, y]) => recipe.util.typeAt(x, y));
{
  const t = new Terrain(recipe, { edits: createEditLayer(2, 128) }); t.bakeFarSync();
  ok('empty layer: checksum() unchanged', t.checksum() === baseSum, `${t.checksum()} vs ${baseSum}`);
  ok('empty layer: heightAt/typeAt bit-identical', pts.every(([x, y], i) => Object.is(recipe.util.heightAt(x, y), baseH[i]) && recipe.util.typeAt(x, y) === baseT[i]));
  const t2 = new Terrain(recipe, { edits: editLayerFromJSON(editLayerToJSON(createEditLayer(2, 128), 'overworld_far')) }); t2.bakeFarSync();
  ok('empty layer through JSON: checksum() unchanged', t2.checksum() === baseSum);
}

// --- height delta: exactly at the edited samples ------------------------------------
{
  const L = createEditLayer(2, 128);
  new Terrain(recipe, { edits: L });
  const px = 1100, py = 900;                // lattice point (even metres), far from the tower/river path
  const h0 = recipe.util.heightAt(px, py), h1x = recipe.util.heightAt(px + 2, py), hFar = recipe.util.heightAt(px + 40, py);
  setSampleDh(L, px / 2, py / 2, 150);      // +1.50 m on one sample
  ok('delta: lattice point moves by exactly +1.5 m', Math.abs(recipe.util.heightAt(px, py) - (h0 + 1.5)) < 1e-9);
  ok('delta: half-way point moves by 0.75 m', Math.abs(recipe.util.heightAt(px + 1, py) - (recipe.util.recipeHeight(px + 1, py) + 0.75)) < 1e-9);
  ok('delta: neighbour sample and far point unchanged', Object.is(recipe.util.heightAt(px + 2, py), h1x) && Object.is(recipe.util.heightAt(px + 40, py), hFar));
  ok('Terrain.heightAt sees the delta', Math.abs(new Terrain(recipe, { edits: L }).heightAt(px, py) - (h0 + 1.5)) < 1e-9);
  ok('delta across a chunk edge (neighbour chunk missing = 0)', (() => { setSampleDh(L, 63, 5, 100); return heightDelta(L, 127, 10) === 0.5 && heightDelta(L, 128, 10) === 0; })());
  new Terrain(recipe);                       // clears the layer again
  ok('Terrain without edits clears the global layer', Object.is(recipe.util.heightAt(px, py), h0));
}

// --- dab ops on a flat stub terrain ---------------------------------------------------
{
  const L = createEditLayer(2, 128);
  const stub = { heightAt(x, y) { return 10 + L.heightDelta(x, y); } };
  const rect = {};
  applyDab(L, stub, 'raise', 100, 100, 6, 1, rect);
  ok('raise: centre +1.00 m, edge 0, outside untouched', sampleDh(L, 50, 50) === 100 && sampleDh(L, 53, 50) === 0 && sampleDh(L, 60, 50) === 0, `${sampleDh(L, 50, 50)} ${sampleDh(L, 53, 50)}`);
  ok('raise: falloff monotonic and rect reported', sampleDh(L, 51, 50) < 100 && sampleDh(L, 51, 50) > sampleDh(L, 52, 50) && rect.i0 === 47 && rect.i1 === 53, JSON.stringify(rect));
  applyDab(L, stub, 'lower', 100, 100, 6, 1, rect);
  ok('lower undoes raise exactly', sampleDh(L, 50, 50) === 0 && sampleDh(L, 51, 50) === 0);
  applyDab(L, stub, 'raise', 100, 100, 6, 2);
  applyDab(L, stub, 'flatten', 100, 100, 6, 1, null, 10);    // back to the target height 10 at the centre
  ok('flatten (strength 1) reaches target at the centre', sampleDh(L, 50, 50) === 0);
  applyDab(L, stub, 'raise', 100, 100, 2, 4);
  const before = stub.heightAt(100, 100);
  applyDab(L, stub, 'smooth', 100, 100, 2, 1);
  ok('smooth lowers a spike toward the 3x3 mean', stub.heightAt(100, 100) < before && stub.heightAt(100, 100) > 10);
  ok('paint: hard edge, sets type', applyDab(L, stub, 'paint', 200, 200, 4, 4) && typePaint(L, 200.5, 200.5) === 4 && typePaint(L, 207, 200) === -1);
  ok('paint again with same type reports no change', applyDab(L, stub, 'paint', 200, 200, 4, 4) === false);
}

// --- format round trip, deterministic bytes ------------------------------------------
{
  const L = createEditLayer(2, 128);
  const stub = { heightAt(x, y) { return 5 + L.heightDelta(x, y); } };
  applyDab(L, stub, 'raise', 127, 100, 8, 3);      // straddles chunk 0/1
  applyDab(L, stub, 'lower', 300, -60, 5, 2);       // negative chunk
  applyDab(L, stub, 'paint', 640, 640, 5, 4);
  setSampleDh(L, 1000, 1000, 5); setSampleDh(L, 1000, 1000, 0);   // an all-zero chunk is dropped
  const j = editLayerToJSON(L, 'overworld_far');
  const text = stringifyContent(j);
  const L2 = editLayerFromJSON(JSON.parse(text));
  const text2 = stringifyContent(editLayerToJSON(L2, 'overworld_far'));
  ok('round trip: byte-identical text', text === text2);
  ok('round trip: samples equal', sampleDh(L2, 63, 50) === sampleDh(L, 63, 50) && sampleDh(L2, 64, 50) === sampleDh(L, 64, 50) && typePaint(L2, 640, 640) === 4);
  const keys = Object.keys(j.chunks);
  ok('all-zero chunk dropped, keys sorted', !('7,7' in j.chunks) && keys.join('|') === keys.slice().sort().join('|') && keys.length === 7, keys.join(' '));
  let bad = 0;
  const first = keys[0];
  for (const mut of [(o) => { o.chunks[first].dh = 'AAAA'; }, (o) => { o.chunks['x,y'] = o.chunks[first]; }, (o) => { o.chunks[first].type = '!!'; }, (o) => { o.kind = 'level'; }]) {
    const o = JSON.parse(text); mut(o); try { editLayerFromJSON(o); } catch (e) { bad++; }
  }
  ok('validation rejects bad base64 length / key / kind', bad === 4, `${bad}`);
}

// --- paint rules: river wins, paint over path, structure footprint unaffected -------------
{
  const L = createEditLayer(2, 128);
  new Terrain(recipe, { edits: L });
  const ry = 1000, rx = Math.round(recipe.util.riverX(ry) / 2) * 2;           // river centre
  const [ax, ay] = recipe.recipe.path.points[1];
  const gx = Math.floor(ax / 2), gy = Math.floor(ay / 2);
  ok('precondition: river is water, path is path', recipe.util.typeAt(rx, ry) === 2 && recipe.util.typeAt(gx * 2 + 1, gy * 2 + 1) === 4);
  setSampleType(L, rx / 2, ry / 2, 3); setSampleType(L, gx, gy, 0);
  ok('paint never over the river', recipe.util.typeAt(rx + 0.5, ry + 0.5) === 2);
  ok('paint wins over the path', recipe.util.typeAt(gx * 2 + 1, gy * 2 + 1) === 0);
  ok('paint wins over other terrain rules', (() => { setSampleType(L, 600, 600, 3); return recipe.util.typeAt(1201, 1201) === 3; })());

  const edge = [[1492, 1025], [1480, 1018], [1504, 1032]];
  const ring0 = edge.map(([x, y]) => recipe.util.heightAt(x, y));
  const S = { heightAt: (x, y) => recipe.util.heightAt(x, y) };
  applyDab(L, S, 'raise', 1492, 1025, 30, 5);
  ok('structure footprint height unchanged under a raise dab (ring exact)', edge.every(([x, y], i) => Object.is(recipe.util.heightAt(x, y), ring0[i]) && ring0[i] === 2.4), edge.map(([x, y]) => recipe.util.heightAt(x, y)).join(','));
  ok('outside the blend zone the dab does change heights', heightDelta(L, 1465, 1025) !== 0 && recipe.util.heightAt(1465, 1025) !== recipe.util.recipeHeight(1465, 1025));
  new Terrain(recipe);
}

// --- loadPack + registry + World.load: a hand-written edits file shows in groundAt ----------
{
  const L = createEditLayer(2, 128);
  setSampleDh(L, 700, 400, 250);                     // lattice point (1400, 800): +2.5 m
  const file = editLayerToJSON(L, 'overworld_far');
  const manifest = { kind: 'manifest', schema: 1, id: 'fx', contentVersion: 1, files: ['a.terrainedits.json'] };
  const bundle = await loadContentPack('http://x/m.json', { fetchText: async (u) => (u.endsWith('m.json') ? JSON.stringify(manifest) : JSON.stringify(file)) });
  ok('loadContentPack accepts kind terrainEdits (no nextId)', !!bundle.terrainEdits.overworld_far && bundle.terrainEdits.overworld_far.cell === 2);
  const badFile = { ...file, chunks: { '0,0': { dh: 'AAAA', type: 'AA' } } };
  let threw = false;
  try { await loadContentPack('http://x/m.json', { fetchText: async (u) => (u.endsWith('m.json') ? JSON.stringify(manifest) : JSON.stringify(badFile)) }); } catch (e) { threw = true; }
  ok('loadContentPack rejects a malformed edits file', threw);

  const { assets } = await loadTestAssets();
  // ED-TERRAIN-1c ships content/terrain/overworld_far.edits.json (empty layer = today's terrain); before it, terrainEdits() was null.
  const shipped = assets.terrainEdits('overworld_far');
  ok('registry: shipped edits file is an empty layer', shipped === null || Object.keys(shipped.chunks).length === 0);
  const w0 = World.load(assets.world('world_m1'), assets, {});
  const g0 = w0.terrain.groundAt(1400, 800);
  const withEdits = Object.create(assets); withEdits.terrainEdits = (k) => (k === 'overworld_far' ? bundle.terrainEdits[k] : null);
  const w1 = World.load(withEdits.world('world_m1'), withEdits, {});
  ok('World.load applies the edits file: groundAt = base + 2.5', Math.abs(w1.terrain.groundAt(1400, 800) - (g0 + 2.5)) < 1e-6, `${g0} -> ${w1.terrain.groundAt(1400, 800)}`);
  const w2 = World.load(assets.world('world_m1'), assets, {});
  ok('a later load without edits clears them', Math.abs(w2.terrain.groundAt(1400, 800) - g0) < 1e-9);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
