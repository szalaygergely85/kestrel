import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssetRegistry, meshFromJSON, createPitchedTerms, pitchedTerms, worldToCell } from '../../engine/index.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import { listMeshAssetGroups, meshIconKey, meshKeyFromIcon, iconAsset } from './meshAssets.js';
import { createIconWorld } from './iconRender.js';
import { modelBounds, fitIconCamera, iconCacheKey } from './iconFit.js';

const meshes = {};
for (const path of ['quaternius/Rock_Medium_1', 'quaternius/Pebble_Round_1', 'ruins/Fences/Line']) {
  const json = JSON.parse(readFileSync(new URL(`../../content/meshes/${path}.mesh.json`, import.meta.url), 'utf8'));
  meshes[path] = meshFromJSON(json);
}
const assets = new AssetRegistry({ palette: globalThis.ASSETS.palette, detailPass: globalThis.ASSETS.detailPass,
  meshes, models: { 'quaternius/Rock_Medium_1': { world: {w:1,h:1} } } });
assert.deepEqual(listMeshAssetGroups(assets), [
  { pack: 'Quaternius', keys: ['quaternius/Pebble_Round_1', 'quaternius/Rock_Medium_1'] },
  { pack: 'Ruins', keys: ['ruins/Fences/Line'] },
]);
assert.deepEqual(listMeshAssetGroups(assets, ' ROCK_medium '), [{ pack: 'Quaternius', keys: ['quaternius/Rock_Medium_1'] }]);
assert.equal(listMeshAssetGroups(assets, 'MESH').flatMap(g=>g.keys).length, 3);
assert.deepEqual(listMeshAssetGroups(assets, 'no-such-asset'), []);
assert.equal(meshKeyFromIcon('ordinaryModel'), null);
assert.equal(iconAsset(assets, 'quaternius/Rock_Medium_1'), assets.model('quaternius/Rock_Medium_1'));
for (const [key, mesh] of Object.entries(meshes)) {
  const token = meshIconKey(key);
  assert.equal(meshKeyFromIcon(token), key);
  assert.equal(iconAsset(assets, token), mesh);
  assert.notEqual(iconCacheKey(token, mesh), iconCacheKey(key, mesh));
  const b = mesh.bbox, bounds = modelBounds(mesh);
  assert.deepEqual(bounds, { w:b[3]-b[0], d:b[4]-b[1], h:b[5]-b[2] });
  const world = createIconWorld(assets, token);
  assert.equal(world.structures[0].level.def.props.length, 0);
  const placed = world.structures.find(s=>s.kind==='mesh');
  assert.equal(placed.mesh, mesh);
  assert.equal((placed.bbox.x0+placed.bbox.x1)/2, 3);
  assert.equal((placed.bbox.y0+placed.bbox.y1)/2, 3);
  assert.equal(placed.bbox.z0, 0);
  assert.equal(assets.has('level', '__icon'), false);
  const grid = { cols:160, rows:60, pxCellW:8, pxCellH:16 };
  const cam = fitIconCamera(bounds, 75, grid.cols*8/(grid.rows*16));
  cam.x+=3; cam.y+=3;
  const terms = pitchedTerms(cam, grid, createPitchedTerms()), cell = new Float64Array(3);
  for (const x of [placed.bbox.x0,placed.bbox.x1]) for (const y of [placed.bbox.y0,placed.bbox.y1]) for (const z of [0,bounds.h]) {
    worldToCell(terms,x,y,z,cell);
    assert.ok(cell[2]>0 && cell[0]>=8 && cell[0]<=152 && cell[1]>=3 && cell[1]<=57, `${key}: icon fits frame`);
  }
}
console.log('meshAssets: grouping/search, distinct model/mesh keys, 3 real mesh mini-worlds and camera bounds PASS');
