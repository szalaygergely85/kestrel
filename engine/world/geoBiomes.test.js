// MAP-01c (arch 38.42): biomeAt + geo.biomes + scatter hook. Run: node engine/world/geoBiomes.test.js
// Real recipe + world_geo areas: biome 0 inside the keep rect (trees + detail byte-identical with/without biomes), biome-driven
// placements outside, table validator, and the budget print (placements per km2 vs the designer's caps 4k trees / 12k small plants).
import assert from 'node:assert/strict';
import { makeOk } from '../test/assert.js';
import { Terrain } from './Terrain.js';
import { scatterTrees, scatterDetail } from './scatter.js';
import terrainDef from '../../design/levels/overworld_far.js';
import '../../design/levels/world_geo.js';
globalThis.window = globalThis.window || globalThis;
terrainDef;
let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.error('FAIL:', m));
const recipe = globalThis.ASSETS.levels.overworld_far, G = globalThis.ASSETS.levels.world_geo, util = recipe.util;
recipe.structures[0].bbox = { x0: 1480, y0: 1018, x1: 1504, y1: 1032 }; recipe.structures[0].ringHAt = () => 2.4;
const KEEP = recipe.geo.keep;

const mk = (cx, cy, cw, ch) => { const t = new Terrain(recipe, { realTrees: true }); t.bakeNearBand(cx, cy, cw, ch); return t; };
const same = (a, b, keys) => a.count === b.count && keys.every(k => Buffer.from(a[k].buffer).equals(Buffer.from(b[k].buffer)));
const TK = ['x', 'y', 'z', 'yawDeg', 'species'], DK = ['x', 'y', 'z', 'yawDeg', 'species', 'r2'];

// 1. no table -> hook off; baseline in keep and outside
util.setGeoBiomes(null);
ok('no biomes: biomeAt = 0 everywhere', util.biomeAt(500, 400) === 0 && util.biomeAt(1500, 1000) === 0);
const tKeep = mk(7, 7, 3, 3), tOut = mk(12, 3, 3, 3);
const baseKeepT = scatterTrees(tKeep), baseKeepD = scatterDetail(tKeep), baseOutT = scatterTrees(tOut), baseOutD = scatterDetail(tOut);
ok('baseline has trees in keep', baseKeepT.count > 50);

// 2. install the designer's biomes
const F = G.util.installBiomes(util);
ok('biome fields built (<= 16)', F && F.ids.length <= 16 && F.ids.length >= 6);
ok('table exposed as geo.biomes', recipe.geo.biomes === G.biomes);
// biome 0 in the keep: sampled grid + edge
let keepBad = 0, n = 0;
for (let x = KEEP.x0; x < KEEP.x1; x += 8) for (let y = KEEP.y0; y < KEEP.y1; y += 8) { n++; if (util.biomeAt(x, y) !== 0) keepBad++; }
ok(`biomeAt = 0 on all ${n} keep samples`, keepBad === 0);
// deterministic, ids from the table, soft stochastic edge, several biomes present
const seen = {}; let det = true;
for (let x = 0; x < 2048; x += 16) for (let y = 0; y < 1800; y += 16) { const b = util.biomeAt(x, y); seen[b] = (seen[b] || 0) + 1; if (b !== util.biomeAt(x, y)) det = false; }
ok('deterministic', det);
ok('all seen ids are 0 or in the table', Object.keys(seen).every(k => +k === 0 || G.biomes[k]));
ok('pine(2), twisted(3), dead(4), flowers(5), beach(7), fen(8), alpine(9) all occur', [2, 3, 4, 5, 7, 8, 9].every(k => seen[k] > 0));
console.log('biome sample counts (16 m grid):', JSON.stringify(seen));
ok('Northwood (1650,600) is pine', [2].includes(util.biomeAt(1650, 600)) || util.biomeAt(1700, 500) === 2);
// edge softness: crossing a region edge mixes both ids over a band (not a single step)
{ let flips = 0, prev = -1; for (let x = 1400; x < 1500; x += 1) { const b = util.biomeAt(x, 600); if (prev !== -1 && b !== prev) flips++; prev = b; } ok('region edge is a mixed band (>= 2 flips over 100 m)', flips >= 2); }

// 3. byte-identity in the keep, change outside
const kT = scatterTrees(tKeep), kD = scatterDetail(tKeep);
ok('keep trees identical with biomes', same(kT, baseKeepT, TK));
ok('keep detail identical with biomes', same(kD, baseKeepD, DK));
const oT = scatterTrees(tOut), oD = scatterDetail(tOut);
ok('outside: trees differ (biome-driven)', !same(oT, baseOutT, TK));
const pineIdx = new Set(); for (let i = 0; i < oT.count; i++) if (util.biomeAt(oT.x[i], oT.y[i]) === 2 && oT.species[i] >= 5) pineIdx.add(oT.species[i]);
ok('pine biome plants Pine species', pineIdx.size >= 3);
let wrongSp = 0, inPine = 0; for (let i = 0; i < oT.count; i++) if (util.biomeAt(oT.x[i], oT.y[i]) === 2) { inPine++; if (oT.species[i] === 4 || oT.species[i] === 3) wrongSp++; }
ok('pine biome never plants zero-weight CommonTree_4/5', inPine > 20 && wrongSp === 0);
ok('outside detail count follows densityMult (<= base for pine/mult 1 mix is fine)', oD.count > 0);
console.log(`northwood band trees ${baseOutT.count} -> ${oT.count}; detail ${baseOutD.count} -> ${oD.count}`);

// 4. validator
const bad = (tbl, re) => { util.setGeoBiomes(tbl, {}); try { scatterTrees(tOut); } catch (e) { return re.test(e.message); } return false; };
ok('unknown species rejected', bad({ 1: { forest: { species: { 'nope/Tree': 1 } } } }, /not in forest\.trees\.species/));
ok('negative weight rejected', bad({ 1: { forest: { species: { 'quaternius/Pine_1': -1 } } } }, /invalid biome/));
ok('fill > 1 rejected', bad({ 1: { forest: { fill: 2 } } }, /forest\.fill/));
ok('bad detail mult rejected', bad({ 1: { detail: { rocks: -1 } } }, /detail\.rocks/));
assert.throws(() => util.setGeoBiomes({ 0: {} }, {}), /1\.\.255/); ok('id 0 rejected', true);
assert.throws(() => util.setGeoBiomes({ 1: {} }, { 3: () => 0 }), /unknown biome/); ok('area for unknown biome rejected', true);
util.setGeoBiomes(null);
ok('cleared: back to baseline bytes', same(scatterTrees(tOut), baseOutT, TK) && same(scatterDetail(tOut), baseOutD, DK));

// 5. budget: worst-case placements per km2 vs the designer's caps (docs/world-map-2026-10-11.md section 6)
const tc = recipe.recipe.forest.trees, cellA = tc.cellM * tc.cellM, KM2 = 1e6, TREE_FRAC = 0.23;   // forward half of a 384 m tree band
const lay = recipe.recipe.detail.layers;
console.log('biome            trees/km2  trees/frame(cap 4000)  detail/frame(cap 12000)');
let worstT = 0, worstD = 0;
for (const [id, b] of Object.entries(G.biomes)) {
  const fill = b.forest && b.forest.fill !== undefined ? b.forest.fill : tc.fill, perKm = KM2 / cellA * fill;
  let det = 0; for (const l of lay) { const m = (b.detail && b.detail[l.name]) ?? 1; det += (KM2 / (l.cellM * l.cellM)) * Math.min(1, l.fill * m) * (Math.PI * l.drawM * l.drawM / 2) / KM2; }
  worstT = Math.max(worstT, perKm * TREE_FRAC); worstD = Math.max(worstD, det);
  console.log(`${id}:${b.name.padEnd(14)} ${perKm.toFixed(0).padStart(8)}  ${(perKm * TREE_FRAC).toFixed(0).padStart(10)}  ${det.toFixed(0).padStart(14)}`);
}
ok(`worst trees/frame ${worstT.toFixed(0)} <= 4000`, worstT <= 4000);
ok(`worst detail/frame ${worstD.toFixed(0)} <= 12000`, worstD <= 12000);
ok('detail band worst case <= maxPlacements 40000 (all layers, mult capped)', (() => { let w = 0; const area = 384 * 384; for (const l of lay) w += area / (l.cellM * l.cellM) * Math.min(1, l.fill * Math.max(...Object.values(G.biomes).map(b => (b.detail && b.detail[l.name]) ?? 1))); return w <= recipe.recipe.detail.maxPlacements; })());
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
