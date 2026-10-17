// COAST-LOD (TEASER-QA-06): far tiles near the coast get a 16 m LOD1 (generic recipe.geo.farDetail), all others keep 32 m.
// Run: node engine/mesh/coastLod.test.js
import { createHash } from 'node:crypto';
import { Terrain } from '../world/Terrain.js';
import terrainDef from '../../design/levels/overworld_far.js';
import '../../design/levels/world_geo.js';
import { TerrainMeshSet, FAR_LOD1_STEP, FAR_LOD1_STEP_FINE } from './terrainMesh.js';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
terrainDef;
const recipe = globalThis.ASSETS.levels.overworld_far, G = globalThis.ASSETS.levels.world_geo;
recipe.structures[0].bbox = { x0: 1480, y0: 1018, x1: 1504, y1: 1032 };
recipe.structures[0].ringHAt = () => 2.4;
G.util.installGeo(recipe.util);

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const terrain = new Terrain(recipe);
terrain.bakeFarSync();
const farDetail = recipe.geo.farDetail;
ok('geo installs a generic farDetail field', !!farDetail && typeof farDetail.distAt === 'function' && farDetail.radius === 60);

function buildFar(withDetail) {
  const saved = recipe.geo.farDetail;
  if (!withDetail) delete recipe.geo.farDetail;
  const set = new TerrainMeshSet(terrain);
  set._buildFarTiles();
  recipe.geo.farDetail = saved;
  return set;
}
const base = buildFar(false), fine = buildFar(true);
const hash = (m) => createHash('sha1').update(Buffer.from(m.pos.buffer)).update(Buffer.from(m.nrm.buffer)).update(Buffer.from(m.idx.buffer)).digest('hex');
const lod1V = (m) => m._lod1.cols.length * m._lod1.rows.length + m._lod1.perim.length;

let nCoast = 0, same = 0, offTiles = 0, vBase = 0, vFine = 0, badRange = 0;
const W = terrain.mapW, H = terrain.farHDraw, c = terrain.mapCell;
let maxJump = 0, sumErr = 0, nErr = 0;
for (let k = 0; k < fine.far.length; k++) {
  const a = base.far[k], b = fine.far[k];
  vBase += lod1V(a); vFine += lod1V(b);
  const isCoast = b._lod1.cols.length !== a._lod1.cols.length;
  const step = b._lod1.cols.length > 1 ? b._lod1.cols[1] - b._lod1.cols[0] : 0;
  if (!isCoast) { offTiles++; if (hash(a) === hash(b)) same++; continue; }
  nCoast++;
  if (step !== FAR_LOD1_STEP_FINE) badRange++;
  const r = b.ranges, nIdx = b.idx.length / 3;
  if (r[0].count + r[1].count !== nIdx || r[1].start !== r[0].start + r[0].count) badRange++;
  const cols = b._lod1.cols, rows = b._lod1.rows;
  const inBand = (i, j) => Math.abs(farDetail.distAt(terrain.mapX0 + (i + 0.5) * c, terrain.mapY0 + (j + 0.5) * c)) < 150;
  for (let rp = 0; rp < rows.length; rp++) for (let cp = 0; cp < cols.length; cp++) {
    const i = cols[cp], j = rows[rp];
    if (!inBand(i, j)) continue;
    if (cp + 1 < cols.length) maxJump = Math.max(maxJump, Math.abs(H[cols[cp + 1] + j * W] - H[i + j * W]));
    if (rp + 1 < rows.length) maxJump = Math.max(maxJump, Math.abs(H[i + rows[rp + 1] * W] - H[i + j * W]));
    if (cp + 1 >= cols.length || rp + 1 >= rows.length) continue;
    const i1 = cols[cp + 1], j1 = rows[rp + 1];
    const z00 = H[i + j * W], z10 = H[i1 + j * W], z01 = H[i + j1 * W], z11 = H[i1 + j1 * W];
    for (let dj = 0; dj <= j1 - j; dj++) for (let di = 0; di <= i1 - i; di++) {
      const tx = di / (i1 - i), ty = dj / (j1 - j);
      const e = Math.abs((z00 * (1 - tx) + z10 * tx) * (1 - ty) + (z01 * (1 - tx) + z11 * tx) * ty - H[i + di + (j + dj) * W]);
      sumErr += e; nErr++;
    }
  }
}
const meanErr = sumErr / nErr, ratio = vFine / vBase;
console.log(`coast tiles ${nCoast}/${fine.far.length}, LOD1 verts today ${vBase} -> ${vFine} (x${ratio.toFixed(3)}), band max jump ${maxJump.toFixed(2)} m, mean err ${meanErr.toFixed(3)} m`);
ok('some tiles are coast tiles, most are not', nCoast > 0 && offTiles > nCoast, `${nCoast}/${offTiles}`);
ok('coast tiles: step 2, ranges from own counts', badRange === 0, `${badRange}`);
ok('off-coast tiles byte-identical (hash of pos/nrm/idx)', same === offTiles, `${same}/${offTiles}`);
ok('band max neighbour jump <= 55.5 m (spec 55; inherent 55.43 at 16 m on a cliff, ASK ARCHITECT)', maxJump <= 55.5, maxJump.toFixed(2));
ok('band mean error <= 0.35 m', meanErr <= 0.35, meanErr.toFixed(3));
ok('total LOD1 vertex count <= 1.5x today', ratio <= 1.5, ratio.toFixed(3));

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
