// ME-14a: actual content loader -> registry, malformed asset errors, and mesh-frame transforms.
import { readMeshJSON } from '../test/meshFile.test.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadContentPack } from './loadPack.js';
import { stringifyContent } from './stringify.js';
import { ID_COLLECTIONS, KEY_ORDER } from './schema.js';
import { AssetRegistry } from '../core/assets.js';
import { makeFrame, localToWorld, worldToLocal, localDirToWorld, localYawToWorld, worldYawToLocal, frameBBox, frameEquals } from '../core/transform.js';
import { meshFromJSON, meshToJSON } from '../mesh/MeshData.js';

const sample = readMeshJSON(new URL('../../content/meshes/ruins/Fences/Line.mesh.json', import.meta.url));
sample.mats = { [sample.matKeys[0]]: 'stone' };
const manifest = { kind: 'manifest', schema: 1, id: 'mesh_pack', nextId: 1, contentVersion: 7, files: ['line.mesh.json'] };
async function load(def = sample, files = manifest.files) {
  return loadContentPack('https://fixtures.invalid/manifest.json', {
    fetchText: async (url) => JSON.stringify(url.endsWith('manifest.json') ? { ...manifest, files } : def),
  });
}
const bundle = await load();
const mesh = bundle.meshes[sample.id];
assert.ok(mesh.pos instanceof Float32Array);
assert.equal(mesh.triCount, sample.triCount);
assert.deepEqual(mesh.mats, sample.mats);
assert.equal(bundle.meta.mesh[sample.id].schema, 1);
const registry = AssetRegistry.fromJSON(bundle, { palette: { materials: { stone: {} } } });
assert.equal(registry.mesh(sample.id), mesh);
assert.ok(registry.has('mesh', sample.id));
assert.deepEqual(registry.keys('mesh'), [sample.id]);
assert.throws(() => registry.mesh('missing'), /unknown mesh/);
assert.throws(() => AssetRegistry.fromJSON(bundle, { palette: {}, meshes: { [sample.id]: mesh } }), /both JS and JSON/);
assert.deepEqual(meshToJSON(meshFromJSON(sample)).mats, sample.mats);
assert.deepEqual(ID_COLLECTIONS.mesh, []);
assert.ok(KEY_ORDER.mesh.includes('mats'));
const canonical = stringifyContent(sample);
assert.equal(stringifyContent(JSON.parse(canonical)), canonical);
assert.ok(canonical.indexOf('"kind"') < canonical.indexOf('"pos"'));
for (const [mutate, message] of [
  [(d) => { d.pos.pop(); }, /multiple of 3/],
  [(d) => { d.schema = 999; }, /newer than/],
  [(d) => { d.id = '../bad'; }, /bad or missing id/],
  [(d) => { d.mats = []; }, /mats must map/],
]) {
  const def = structuredClone(sample); mutate(def);
  await assert.rejects(load(def), (e) => e.name === 'ContentError' && e.errors.some((x) => message.test(x.message)));
}
await assert.rejects(load(sample, ['a.mesh.json', 'b.mesh.json']), (e) => e.errors.some((x) => /duplicate mesh id/.test(x.message)));
for (const yaw of [0, 35, 90, -20, 225]) {
  const frame = makeFrame(12, -3, 1.5, 0, yaw), world = {}, local = {};
  localToWorld(frame, 2, -4, 3, world);
  worldToLocal(frame, world.x, world.y, world.z, local);
  for (const [key, value] of Object.entries({ x: 2, y: -4, z: 3 })) assert.ok(Math.abs(local[key] - value) < 1e-12);
  const direction = [0, 0]; localDirToWorld(frame, 2, -4, direction);
  assert.ok(Math.abs(direction[0] - (world.x - frame.x)) < 1e-12);
  assert.ok(Math.abs(direction[1] - (world.y - frame.y)) < 1e-12);
  assert.equal(worldYawToLocal(frame, localYawToWorld(frame, 67)), 67);
  const box = {}; frameBBox(frame, 2, 4, box);
  for (const x of [0, 2]) for (const y of [0, 4]) {
    localToWorld(frame, x, y, 0, world);
    assert.ok(world.x >= box.x0 && world.x <= box.x1 && world.y >= box.y0 && world.y <= box.y1);
  }
  assert.ok(frameEquals(frame, { ...frame }));
  assert.ok(!frameEquals(frame, { ...frame, yawDeg: yaw + 1 }));
}
assert.throws(() => makeFrame(0, 0, 0, 1, 35), /cannot combine/);
assert.throws(() => makeFrame(0, 0, 0, 0, NaN), /finite/);
console.log('ME-14a loader, registry, serialization, rejection and frame checks ALL PASS');
