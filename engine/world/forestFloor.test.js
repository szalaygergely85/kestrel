// OB-184: forest floor dressing (undergrowth / mushrooms / flowers / stumps, existing Quaternius meshes + voxel logs only).
// Real recipe + world_geo biomes; Northwood band. Counts detail instances on forest ground inside forest biomes (1 broadleaf, 2 pine,
// 3 twisted) per 100 m2, none on roads/paths/water, budget vs maxPlacements. Run: node engine/world/forestFloor.test.js
import { makeOk } from '../test/assert.js';
import { Terrain } from './Terrain.js';
import { scatterDetail, scatterTrees } from './scatter.js';
import terrainDef from '../../design/levels/overworld_far.js';
import '../../design/levels/world_geo.js';
globalThis.window = globalThis.window || globalThis;
terrainDef;
let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.error('FAIL:', m));
const recipe = globalThis.ASSETS.levels.overworld_far, G = globalThis.ASSETS.levels.world_geo, util = recipe.util;
recipe.structures[0].bbox = { x0: 1480, y0: 1018, x1: 1504, y1: 1032 }; recipe.structures[0].ringHAt = () => 2.4;
G.util.installBiomes(util);
const FOREST_BIOMES = new Set([1, 2, 3]);
const MIN_PER_100M2 = 2.0;   // dressing instances (undergrowth + floor items) per 100 m2 of forest floor
const t = new Terrain(recipe, { realTrees: true });
t.bakeNearBand(12, 3, 3, 3);                       // x 1536..1920, y 384..768 (Northwood + Glasswater edge)
const trees = scatterTrees(t);
const d = scatterDetail(t, [], [], undefined, trees);
const nm = (i) => { const s = d.speciesDefs[d.species[i]]; return s.mesh || s.model || ''; };
const typeOf = (x, y) => t.typeName(t.groundTypeAt(x, y));
// forest-floor area: 8 m sampling grid
let area = 0;
for (let x = 1536; x < 1920; x += 8) for (let y = 384; y < 768; y += 8) if (FOREST_BIOMES.has(util.biomeAt(x, y)) && typeOf(x, y) === 'forest') area += 64;
let inForest = 0, bad = 0; const byName = {};
for (let i = 0; i < d.count; i++) {
  const ty = typeOf(d.x[i], d.y[i]);
  if (ty === 'path' || ty === 'water') bad++;
  if (ty === 'forest' && FOREST_BIOMES.has(util.biomeAt(d.x[i], d.y[i]))) { inForest++; const n = nm(i).replace('quaternius/', ''); byName[n] = (byName[n] || 0) + 1; }
}
const per100 = inForest / area * 100;
console.log(`forest floor ${area} m2, ${inForest} instances = ${per100.toFixed(2)} / 100 m2 = ${(per100 * 1e4).toFixed(0)} / km2`, JSON.stringify(byName));
ok(`forest floor dressing >= ${MIN_PER_100M2} / 100 m2 (got ${per100.toFixed(2)})`, per100 >= MIN_PER_100M2);
ok('no detail on path / water', bad === 0);
const kinds = Object.keys(byName).join();
ok('undergrowth + mushrooms + flowers present', /Fern_1/.test(kinds) && /Mushroom/.test(kinds) && /Flower/.test(kinds));
ok('stumps / logs / rocks present', /stumpCut|logShort|logLong/.test(kinds) && /Rock_Medium|Pebble/.test(kinds));
const lay = recipe.recipe.detail.layers.find(l => l.name === 'undergrowth');
ok('undergrowth layer is CPU (not gpu) + existing meshes only', !!lay && !lay.gpu && Object.values(lay.ground).every(L => L.every(s => s.mesh && !s.model)));
ok(`band total ${d.count} <= maxPlacements ${recipe.recipe.detail.maxPlacements}`, d.count <= recipe.recipe.detail.maxPlacements);
// OB-184b clustering: mean distance undergrowth -> nearest trunk is lower than for the same layer without `cluster` (uniform spread)
const UG = /Fern_1|Plant_1|Plant_7|Bush_Common|Mushroom|Flower_3|Flower_4|Pebble_Round/;
const nearest = (set, list) => {
  const g = new Map(); for (let i = 0; i < trees.count; i++) { const k = Math.floor(trees.x[i] / 8) * 100003 + Math.floor(trees.y[i] / 8); (g.get(k) || g.set(k, []).get(k)).push(i); }
  let sum = 0, n = 0, mul = 0;
  for (const i of list) {
    let best = 1e9; const cx = Math.floor(set.x[i] / 8), cy = Math.floor(set.y[i] / 8);
    for (let a = cx - 2; a <= cx + 2; a++) for (let b = cy - 2; b <= cy + 2; b++) for (const j of (g.get(a * 100003 + b) || [])) best = Math.min(best, Math.hypot(trees.x[j] - set.x[i], trees.y[j] - set.y[i]));
    if (best < 1e9) { sum += best; n++; }
  }
  return sum / n;
};
const ugIdx = (set) => { const r = []; for (let i = 0; i < set.count; i++) if (UG.test(set.speciesDefs[set.species[i]].mesh || '') && FOREST_BIOMES.has(util.biomeAt(set.x[i], set.y[i])) && typeOf(set.x[i], set.y[i]) === 'forest') r.push(i); return r; };
const flat = { ...recipe.recipe.detail, layers: recipe.recipe.detail.layers.map(l => { if (l.name !== 'undergrowth') return l; const c = { ...l }; delete c.cluster; return c; }) };
const dU = scatterDetail(t, [], [], flat, trees);
const iC = ugIdx(d), iU = ugIdx(dU), mC = nearest(d, iC), mU = nearest(dU, iU);
console.log(`undergrowth clustered ${iC.length} (${(iC.length / area * 1e6).toFixed(0)}/km2) mean trunk dist ${mC.toFixed(2)} m; uniform ${iU.length} (${(iU.length / area * 1e6).toFixed(0)}/km2) ${mU.toFixed(2)} m`);
ok(`clustered mean trunk distance ${mC.toFixed(2)} < uniform ${mU.toFixed(2)}`, mC < mU - 0.3);
ok('cluster keeps count within +-25% of uniform', Math.abs(iC.length - iU.length) < 0.25 * iU.length);
// SAPLINGS: young trees in forest tiles, scaled 0.3-0.5, never on paths/water
{
  const sap = [];
  for (let i = 0; i < d.count; i++) { const sd = d.speciesDefs[d.species[i]]; if (sd.scale) sap.push(i); }
  const inF = sap.filter(i => typeOf(d.x[i], d.y[i]) === 'forest' && FOREST_BIOMES.has(util.biomeAt(d.x[i], d.y[i])));
  console.log(`saplings ${sap.length} (${(inF.length / area * 100).toFixed(2)} / 100 m2)`);
  ok('saplings present in forest tiles', inF.length > 50 && inF.length === sap.length);
  ok('sapling scale within 0.3..0.5', sap.every(i => d.scale[i] >= 0.3 - 1e-6 && d.scale[i] <= 0.5 + 1e-6));
  ok('no saplings on path / water', sap.every(i => { const ty = typeOf(d.x[i], d.y[i]); return ty !== 'path' && ty !== 'water'; }));
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
