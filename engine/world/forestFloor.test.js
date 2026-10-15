// OB-184: forest floor dressing (undergrowth / mushrooms / flowers / stumps, existing Quaternius meshes + voxel logs only).
// Real recipe + world_geo biomes; Northwood band. Counts detail instances on forest ground inside forest biomes (1 broadleaf, 2 pine,
// 3 twisted) per 100 m2, none on roads/paths/water, budget vs maxPlacements. Run: node engine/world/forestFloor.test.js
import { makeOk } from '../test/assert.js';
import { Terrain } from './Terrain.js';
import { scatterDetail } from './scatter.js';
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
const d = scatterDetail(t);
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
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
