// @ts-check
// engine/render/gpu/MeshBuffers.test.js - ME-04 (docs/backlog.md, docs/
// architecture.md 27.11 ME-04 AC "mock-device alloc test" + the
// "JS-twin/rasterJS parity test on the tower" this row also asks for).
//
// Two things checked, both Node-only (no real GL context, per ME-04's own
// scoping - the main session runs the real-GPU browser check):
//  1. Byte-for-byte parity on the REAL tower level mesh: `buildStaticVertexData`
//     is decoded back out and compared field-by-field against the same
//     `MeshData` arrays `engine/mesh/rasterJS.js` (ME-03's oracle) reads -
//     the GPU vertex buffer and the CPU rasteriser are proven to see
//     IDENTICAL per-vertex data, so a `?gpucompare=mesh` divergence (ME-06)
//     could only come from the two rasterisation pipelines, never from a
//     vertex-layout mismatch.
//  2. `MeshBuffers`' cache/eviction behaviour against the Node mock
//     GpuDevice: one upload per mesh id+version, no re-upload on a
//     cache-hit frame, a version bump frees the old buffer and uploads a
//     new one, `dispose()` frees everything.
//  3. ME-06: the same two checks for `buildTerrainVertexData`/the
//     'terrain'-layout branch of `MeshBuffers.get()` (indexed: a vertex
//     AND an index buffer per upload/eviction), against a real
//     `TerrainMeshSet` chunk (ME-05's own tower-band fixture).
//
//   node engine/render/gpu/MeshBuffers.test.js
import {
  buildStaticVertexData, STATIC_STRIDE_BYTES, STATIC_VERTEX_LAYOUT, MeshBuffers,
  buildTerrainVertexData, TERRAIN_STRIDE_BYTES, TERRAIN_VERTEX_LAYOUT,
  buildVoxelVertexData, VOXEL_STRIDE_BYTES, VOXEL_VERTEX_LAYOUT,
} from './MeshBuffers.js';
import { AUX_STRIDE, FLAT_STRIDE } from '../../mesh/MeshData.js';
import { LevelMeshCache } from '../../mesh/DrawList.js';
import { loadLevel } from '../../world/Level.js';
import { bindShading, bindLevel } from '../MaterialTable.js';
import paletteMod from '../../../design/palette.js'; // side effect: globalThis.ASSETS.palette (loadTestAssets needs it set first)
import detailPassMod from '../../../design/detail-pass.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk, makeMockGpuDevice } from '../../test/assert.js';
import { Terrain } from '../../world/Terrain.js';
import terrainDef from '../../../design/levels/overworld_far.js';
import { TerrainMeshSet } from '../../mesh/terrainMesh.js';
import { sharedVoxelMeshCache } from '../../mesh/voxelMesh.js';
import { packVoxelModel } from '../../voxel/voxelPack.js';
import post12 from '../../voxel/fixtures/post12.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

/** Decodes one interleaved static vertex buffer back into MeshData-shaped arrays (the inverse of `buildStaticVertexData`). */
function decode(buf, vertCount) {
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  const words = STATIC_STRIDE_BYTES / 4;
  const pos = new Float32Array(vertCount * 3), uv = new Float32Array(vertCount * 2);
  const nrm = new Uint32Array(vertCount), flat = new Uint32Array(vertCount * FLAT_STRIDE), aux = new Float32Array(vertCount * AUX_STRIDE);
  for (let v = 0; v < vertCount; v++) {
    const base = v * words;
    pos[v * 3] = f32[base]; pos[v * 3 + 1] = f32[base + 1]; pos[v * 3 + 2] = f32[base + 2];
    uv[v * 2] = f32[base + 3]; uv[v * 2 + 1] = f32[base + 4];
    nrm[v] = u32[base + 5];
    flat[v * FLAT_STRIDE] = u32[base + 6]; flat[v * FLAT_STRIDE + 1] = u32[base + 7];
    for (let k = 0; k < AUX_STRIDE; k++) aux[v * AUX_STRIDE + k] = f32[base + 8 + k];
  }
  return { pos, uv, nrm, flat, aux };
}

// ---- 1. Tower parity ----
{
  const { assets } = await loadTestAssets();
  const tower = loadLevel(assets.level('tower'));
  const matTable = bindShading(assets.palette, assets.detailPass, 1);
  bindLevel(matTable, tower);
  const structure = {
    id: 'tower0', level: tower, origin: { x: 0, y: 0, z: 0 },
    bbox: { x0: 0, y0: 0, x1: tower.width, y1: tower.height }, structSeq: 0, packed: { version: 1 },
  };
  const cache = new LevelMeshCache(matTable.idFor);
  const set = cache.get(structure);
  const mesh = set.base;
  const vertCount = mesh.pos.length / 3;

  ok('tower base mesh has vertices (sanity)', vertCount > 0, String(vertCount));
  ok('vertCount is a whole number of triangles', vertCount % 3 === 0, String(vertCount));

  const buf = buildStaticVertexData(mesh);
  ok('buffer size matches stride x vertCount', buf.byteLength === vertCount * STATIC_STRIDE_BYTES, `${buf.byteLength} vs ${vertCount * STATIC_STRIDE_BYTES}`);

  const back = decode(buf, vertCount);
  let posOk = true, uvOk = true, nrmOk = true, flatOk = true, auxOk = true;
  for (let i = 0; i < mesh.pos.length; i++) if (Math.fround(mesh.pos[i]) !== back.pos[i]) { posOk = false; break; }
  for (let i = 0; i < mesh.uv.length; i++) if (Math.fround(mesh.uv[i]) !== back.uv[i]) { uvOk = false; break; }
  for (let i = 0; i < mesh.nrm.length; i++) if (mesh.nrm[i] !== back.nrm[i]) { nrmOk = false; break; }
  for (let i = 0; i < mesh.flat.length; i++) if (mesh.flat[i] !== back.flat[i]) { flatOk = false; break; }
  for (let i = 0; i < mesh.aux.length; i++) {
    const a = mesh.aux[i], b = back.aux[i];
    if (Math.fround(a) !== b && !(a === Infinity && b === Infinity) && !(Number.isNaN(a) && Number.isNaN(b))) { auxOk = false; break; }
  }
  ok('decoded pos matches mesh.pos exactly (float32-rounded)', posOk);
  ok('decoded uv matches mesh.uv exactly (float32-rounded)', uvOk);
  ok('decoded nrm (packed normal bits) matches mesh.nrm exactly', nrmOk);
  ok('decoded flat (planeIdBase, kind|face|mat) matches mesh.flat exactly', flatOk);
  ok('decoded aux (zRef/aoMode/AO fields) matches mesh.aux exactly', auxOk);

  // The layout description itself must line up with the byte offsets above -
  // a future edit to one without the other is exactly the bug this guards.
  const byName = Object.fromEntries(STATIC_VERTEX_LAYOUT.map((a) => [a.name, a]));
  ok('STATIC_VERTEX_LAYOUT.aPos offset matches the encoder', byName.aPos.offsetBytes === 0);
  ok('STATIC_VERTEX_LAYOUT.aUV offset matches the encoder', byName.aUV.offsetBytes === 12);
  ok('STATIC_VERTEX_LAYOUT.aNrmBits offset matches the encoder', byName.aNrmBits.offsetBytes === 20);
  ok('STATIC_VERTEX_LAYOUT.aFlat offset matches the encoder', byName.aFlat.offsetBytes === 24);
  ok('STATIC_VERTEX_LAYOUT.aAux0123 offset matches the encoder', byName.aAux0123.offsetBytes === 32);
  ok('STATIC_VERTEX_LAYOUT.aAux4567 offset matches the encoder', byName.aAux4567.offsetBytes === 48);
}

// ---- 2. MeshBuffers cache/eviction against the mock device ----
{
  const mock = makeMockGpuDevice();
  const buffers = new MeshBuffers(mock.device);
  const mesh = {
    id: 'level:fake', layout: 'static', meshVersion: 1,
    pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uv: new Float32Array([0, 0, 1, 0, 0, 1]),
    nrm: new Uint32Array([1, 1, 1]),
    flat: new Uint32Array([0, 1, 0, 1, 0, 1]),
    aux: new Float32Array(24),
  };

  const createsBefore = mock.createCount;
  const e1 = buffers.get(mesh);
  ok('first get() uploads exactly one buffer', mock.createCount - createsBefore === 1, String(mock.createCount - createsBefore));

  const createsAfterFirst = mock.createCount;
  const e2 = buffers.get(mesh);
  ok('second get() with the same version is a cache hit (no re-upload)', mock.createCount === createsAfterFirst);
  ok('cache hit returns the same buffer handle', e1.vertexBuffer === e2.vertexBuffer);

  mesh.meshVersion = 2;
  const e3 = buffers.get(mesh);
  ok('a version bump uploads a new buffer', mock.createCount - createsAfterFirst === 1);
  ok('a version bump returns a different handle', e3.vertexBuffer !== e1.vertexBuffer);
  ok('the old buffer was disposed on the version bump', e1.vertexBuffer._disposed === true);

  buffers.dispose();
  ok('dispose() frees the remaining buffer', mock.liveCount() === 0, String(mock.liveCount()));
}

// ---- buildStaticVertexData rejects a non-static mesh ----
{
  let threw = false;
  try { buildStaticVertexData(/** @type {any} */({ layout: 'terrain' })); } catch (e) { threw = true; }
  ok('buildStaticVertexData rejects a non-static mesh', threw);
}

// ---- buildTerrainVertexData rejects a non-terrain mesh ----
{
  let threw = false;
  try { buildTerrainVertexData(/** @type {any} */({ layout: 'static' })); } catch (e) { threw = true; }
  ok('buildTerrainVertexData rejects a non-terrain mesh', threw);
}

// ---- 3. ME-06 terrain vertex buffer parity (real TerrainMeshSet chunk) ----
{
  globalThis.window = globalThis.window || globalThis;
  terrainDef; // side effect: window.ASSETS.levels.overworld_far
  const recipe = globalThis.ASSETS.levels.overworld_far;
  const terrain = new Terrain(recipe);
  terrain.bakeFarSync();
  const towerCx = Math.floor(recipe.tower.x / terrain.chunkSize), towerCy = Math.floor(recipe.tower.y / terrain.chunkSize);
  terrain.bakeNearBand(towerCx, towerCy);
  const set = new TerrainMeshSet(terrain);
  let n = 0;
  while (set.step(2) && n++ < 500);

  const mesh = set.near[4]; // centre chunk - always non-empty
  ok('near chunk has triangles (sanity)', mesh.triCount > 0, String(mesh.triCount));
  const vertCount = mesh.pos.length / 3;

  const buf = buildTerrainVertexData(mesh);
  ok('terrain buffer size matches stride x vertCount', buf.byteLength === vertCount * TERRAIN_STRIDE_BYTES, `${buf.byteLength} vs ${vertCount * TERRAIN_STRIDE_BYTES}`);

  const f32 = new Float32Array(buf), u32 = new Uint32Array(buf);
  const words = TERRAIN_STRIDE_BYTES / 4;
  let posOk = true, nrmOk = true;
  for (let v = 0; v < vertCount; v++) {
    const base = v * words;
    if (Math.fround(mesh.pos[v * 3]) !== f32[base] || Math.fround(mesh.pos[v * 3 + 1]) !== f32[base + 1] || Math.fround(mesh.pos[v * 3 + 2]) !== f32[base + 2]) { posOk = false; break; }
    if (mesh.nrm[v] !== u32[base + 3]) { nrmOk = false; break; }
  }
  ok('decoded terrain pos matches mesh.pos exactly (float32-rounded)', posOk);
  ok('decoded terrain nrm (packed normal bits) matches mesh.nrm exactly', nrmOk);

  const byName = Object.fromEntries(TERRAIN_VERTEX_LAYOUT.map((a) => [a.name, a]));
  ok('TERRAIN_VERTEX_LAYOUT.aPos offset matches the encoder', byName.aPos.offsetBytes === 0);
  ok('TERRAIN_VERTEX_LAYOUT.aNrmBits offset matches the encoder', byName.aNrmBits.offsetBytes === 12);

  // MeshBuffers cache/eviction for the indexed terrain layout (mock device):
  // one vertex + one index buffer per upload, both freed together.
  const mock = makeMockGpuDevice();
  const buffers = new MeshBuffers(mock.device);
  const createsBefore = mock.createCount;
  const e1 = buffers.get(mesh);
  ok('terrain get() uploads exactly two buffers (vertex + index)', mock.createCount - createsBefore === 2, String(mock.createCount - createsBefore));
  ok('terrain entry carries an indexBuffer + indexCount', !!e1.indexBuffer && e1.indexCount === mesh.idx.length);

  const e2 = buffers.get(mesh);
  ok('second get() with the same version is a cache hit (no re-upload)', mock.createCount - createsBefore === 2);
  ok('cache hit returns the same vertex + index handles', e1.vertexBuffer === e2.vertexBuffer && e1.indexBuffer === e2.indexBuffer);

  mesh.meshVersion = (mesh.meshVersion || 1) + 1;
  const e3 = buffers.get(mesh);
  ok('a version bump re-uploads both buffers', mock.createCount - createsBefore === 4);
  ok('the old vertex buffer was disposed on the version bump', e1.vertexBuffer._disposed === true);
  ok('the old index buffer was disposed on the version bump', e1.indexBuffer._disposed === true);
  ok('a version bump returns different handles', e3.vertexBuffer !== e1.vertexBuffer && e3.indexBuffer !== e1.indexBuffer);

  buffers.dispose();
  ok('dispose() frees every remaining buffer', mock.liveCount() === 0, String(mock.liveCount()));
}

// ---- 4. ME-08a: a voxel MeshData (all parts' ranges in ONE buffer) uploads once ----
{
  const mock = makeMockGpuDevice();
  const buffers = new MeshBuffers(mock.device);
  const pm = packVoxelModel(post12, () => 1);
  const partNames = Object.keys(post12.parts);
  const mesh = sharedVoxelMeshCache.get(pm, 'post12', partNames);
  ok('voxel mesh: cache returns the same MeshData for the same pm (no per-frame rebuild)', sharedVoxelMeshCache.get(pm, 'post12', partNames) === mesh);
  ok('voxel mesh: one range per part', mesh.ranges.length === partNames.length, String(mesh.ranges.length));
  const before = mock.createCount;
  const e1 = buffers.get(mesh);
  ok('voxel mesh: first get() uploads exactly one buffer', mock.createCount - before === 1, String(mock.createCount - before));
  const after1 = mock.createCount;
  const e2 = buffers.get(sharedVoxelMeshCache.get(pm, 'post12', partNames));
  ok('voxel mesh: second frame with the same pool creates no buffer, same entry', mock.createCount === after1 && e1 === e2);
  // A repack (new pm, same id 'vox:post12') gets a NEW unique meshVersion -> exactly one re-upload.
  const pm2 = packVoxelModel(post12, () => 1);
  const mesh2 = sharedVoxelMeshCache.get(pm2, 'post12', partNames);
  ok('voxel mesh: a rebuilt model has the same id but a different meshVersion', mesh2.id === mesh.id && mesh2.meshVersion !== mesh.meshVersion);
  const e3 = buffers.get(mesh2);
  ok('voxel mesh: a new meshVersion re-uploads once and frees the old buffer', mock.createCount - after1 === 1 && e3.vertexBuffer !== e1.vertexBuffer && e1.vertexBuffer._disposed === true);
  buffers.dispose();
  ok('voxel mesh: dispose() frees every buffer', mock.liveCount() === 0, String(mock.liveCount()));
}

// ---- 5. RE-06b: voxel vertex encoder (32 B verts + index buffer) ----
{
  const pm = packVoxelModel(post12, () => 1);
  const partNames = Object.keys(post12.parts);
  const mesh = sharedVoxelMeshCache.get(pm, 'post12', partNames);
  const enc = buildVoxelVertexData(mesh);
  ok('voxel enc: quadCount = triCount/2', enc.quadCount * 2 === mesh.triCount, String(enc.quadCount));
  ok('voxel enc: vertex bytes = 4 x 32 per quad', enc.vertex.byteLength === enc.quadCount * 4 * VOXEL_STRIDE_BYTES);
  ok('voxel enc: u16 indices for a small mesh', enc.index instanceof Uint16Array && enc.index.length === enc.quadCount * 6);
  const vu = new Uint32Array(enc.vertex);
  const posU = new Uint32Array(mesh.pos.buffer, mesh.pos.byteOffset, mesh.pos.length);
  const uvU = new Uint32Array(mesh.uv.buffer, mesh.uv.byteOffset, mesh.uv.length);
  let same = true;
  const W = VOXEL_STRIDE_BYTES / 4;
  for (let t = 0; t < mesh.triCount * 3 && same; t++) {
    const base = enc.index[t] * W; // index[t] = encoded vertex for unrolled vert t
    same = vu[base] === posU[t * 3] && vu[base + 1] === posU[t * 3 + 1] && vu[base + 2] === posU[t * 3 + 2]
      && vu[base + 3] === uvU[t * 2] && vu[base + 4] === uvU[t * 2 + 1]
      && vu[base + 5] === mesh.nrm[t] && vu[base + 6] === mesh.flat[t * FLAT_STRIDE] && vu[base + 7] === mesh.flat[t * FLAT_STRIDE + 1];
  }
  ok('voxel enc: index -> vertex round-trips bitwise to the unrolled triangle list, in order', same);
  ok('voxel enc: ranges start on quad boundaries', mesh.ranges.every((r) => r.start % 2 === 0));
  const byName = Object.fromEntries(VOXEL_VERTEX_LAYOUT.map((a) => [a.name, a]));
  ok('VOXEL_VERTEX_LAYOUT = static attribs 0-3', VOXEL_VERTEX_LAYOUT.length === 4 && VOXEL_VERTEX_LAYOUT.every((a, i) => a === STATIC_VERTEX_LAYOUT[i]) && byName.aFlat.offsetBytes === 24);

  // u32 path: synthetic > 16384 quads
  const Q = 16385, V = Q * 6;
  const big = {
    id: 'vox:big', layout: 'static', meshVersion: 1, triCount: Q * 2,
    pos: new Float32Array(V * 3), uv: new Float32Array(V * 2), nrm: new Uint32Array(V),
    flat: new Uint32Array(V * FLAT_STRIDE), aux: new Float32Array(V * AUX_STRIDE),
  };
  const corner = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const order = [0, 1, 2, 0, 2, 3];
  for (let q = 0; q < Q; q++) {
    for (let k = 0; k < 6; k++) {
      const v = q * 6 + k;
      big.pos[v * 3] = q + corner[order[k]][0]; big.pos[v * 3 + 1] = corner[order[k]][1];
      big.nrm[v] = q;
    }
  }
  const eb = buildVoxelVertexData(/** @type {any} */(big));
  ok('voxel enc: u32 indices above 65536 verts', eb.index instanceof Uint32Array && eb.index[eb.index.length - 1] === Q * 4 - 1);

  const thr = (m) => { try { buildVoxelVertexData(m); return false; } catch (e) { return String(e.message).includes(String(m.id)); } };
  ok('voxel enc: rejects non-static layout', thr({ ...big, id: 'a', layout: 'terrain' }));
  ok('voxel enc: rejects odd triCount', thr({ ...big, id: 'b', triCount: 3 }));
  const aux = new Float32Array(big.aux); aux[5] = 1;
  ok('voxel enc: rejects non-zero aux', thr({ ...big, id: 'c', aux }));
  const pos = new Float32Array(big.pos); pos[3 * 3] += 1; // vert 3 != vert 0
  ok('voxel enc: rejects non-quad triangle pairs', thr({ ...big, id: 'd', pos }));

  const mock = makeMockGpuDevice();
  const buffers = new MeshBuffers(mock.device);
  const before = mock.createCount;
  const e1 = buffers.getVoxel(mesh);
  ok('getVoxel: first call uploads vertex + index (2 buffers)', mock.createCount - before === 2 && e1.indexType === 'u16' && e1.indexCount === enc.index.length);
  ok('getVoxel: cache hit, no upload', buffers.getVoxel(mesh) === e1 && mock.createCount - before === 2);
  const pm2 = packVoxelModel(post12, () => 1);
  const mesh2 = sharedVoxelMeshCache.get(pm2, 'post12', partNames);
  const e3 = buffers.getVoxel(mesh2);
  ok('getVoxel: new meshVersion re-uploads and frees both old buffers', mock.createCount - before === 4 && e1.vertexBuffer._disposed && e1.indexBuffer._disposed && e3 !== e1);
  buffers.dispose();
  ok('getVoxel: dispose() frees both buffers', mock.liveCount() === 0, String(mock.liveCount()));
}

// ---- an unsupported layout throws clearly (voxel per-part instancing is ME-07/08) ----
{
  const mock = makeMockGpuDevice();
  const buffers = new MeshBuffers(mock.device);
  let threw = false;
  try { buffers.get(/** @type {any} */({ id: 'x', layout: 'voxel', meshVersion: 1 })); } catch (e) { threw = true; }
  ok('MeshBuffers.get rejects an unsupported layout', threw);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
