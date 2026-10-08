// ME-20a: tools/vertex-ao.mjs + gltf-import --ao. Run: node tools/vertex-ao.test.mjs
import assert from 'node:assert';
import { bakeVertexAo, writeVertexAo, readVertexAo } from './vertex-ao.mjs';
import { importGltfBytes } from './gltf-import.mjs';
import { meshFromJSON, validateMesh } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`FAIL - ${name}\n${e.stack}`); process.exitCode = 1; } };

// L-shaped fixture: floor 0..4 x 0..4 at z=0, wall at x=0 rising to z=4. Indexed glTF positions.
const P = [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0], [0, 0, 4], [0, 4, 4]];
const I = [0, 1, 2, 0, 2, 3, /* wall */ 0, 3, 5, 0, 5, 4];

function glb(positions, indices) {
  const pad4 = (b, f = 0) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), f)]) : b);
  const posBuf = Buffer.alloc(positions.length * 12);
  positions.forEach((p, i) => p.forEach((c, k) => posBuf.writeFloatLE(c, i * 12 + k * 4)));
  const idxBuf = pad4(Buffer.alloc(indices.length * 2));
  indices.forEach((v, i) => idxBuf.writeUInt16LE(v, i * 2));
  const bin = Buffer.concat([posBuf, idxBuf]);
  const json = { asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], materials: [{ name: 'M' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: posBuf.length }, { buffer: 0, byteOffset: posBuf.length, byteLength: idxBuf.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' }],
    buffers: [{ byteLength: bin.length }] };
  const jb = pad4(Buffer.from(JSON.stringify(json)), 0x20), bb = pad4(bin);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + jb.length + 8 + bb.length, 8);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(jb.length, 0); c1.writeUInt32LE(0x4e4f534a, 4);
  const c2 = Buffer.alloc(8); c2.writeUInt32LE(bb.length, 0); c2.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, c1, jb, c2, bb]);
}

const aoAt = (mesh, ao, x, y, z) => { // AO of the first vertex found at (x,y,z)
  for (let v = 0; v < mesh.triCount * 3; v++) {
    if (Math.abs(mesh.pos[v * 3] - x) < 1e-4 && Math.abs(mesh.pos[v * 3 + 1] - y) < 1e-4 && Math.abs(mesh.pos[v * 3 + 2] - z) < 1e-4) return ao[v];
  }
  throw new Error("no vertex " + [x, y, z] + " bbox " + Array.from(mesh.bbox));
};

test('closed corner AO < open top AO; deterministic; range (0,1]', () => {
  const { mesh } = importGltfBytes(glb(P, I), 'test:L', {}, null);
  const a = bakeVertexAo(mesh, { rays: 32 }), b = bakeVertexAo(mesh, { rays: 32 });
  assert.deepStrictEqual(Array.from(a), Array.from(b));
  assert.ok(a.every((x) => x > 0 && x <= 1));
  const corner = aoAt(mesh, a, 0, 0, 0), far = aoAt(mesh, a, 4, 0, 4), top = aoAt(mesh, a, 0, -4, 0) /* glTF y-up -> engine (x,-z,y) */;
  assert.ok(corner < far - 0.1, `corner ${corner} < open floor ${far}`);
  assert.ok(corner < top, `corner ${corner} < wall top ${top}`);
});

test('importGltfBytes --ao: valid mesh, aux[5..7] per triangle; default off leaves aux unchanged', () => {
  const off = importGltfBytes(glb(P, I), 'test:L', {}, null);
  const on = importGltfBytes(glb(P, I), 'test:L', { ao: true }, null);
  const again = importGltfBytes(glb(P, I), 'test:L', { ao: 32 }, null);
  assert.strictEqual(readVertexAo(off.mesh), null);
  assert.ok(off.json.aux.every((x, i) => i % 8 < 5 || x === 0));
  assert.deepStrictEqual(on.json.aux, again.json.aux, 'default rays == 32');
  assert.deepStrictEqual(validateMesh(meshFromJSON(on.json)).errors, []);
  // everything except aux[5..7] is identical to the off import
  for (const k of ['pos', 'uv', 'nrm', 'flat', 'bbox', 'ranges', 'matKeys', 'triCount']) assert.deepStrictEqual(on.json[k], off.json[k], k);
  const ao = readVertexAo(on.mesh);
  assert.ok(ao && ao.length === on.mesh.triCount * 3 && Math.min(...ao) < 1);
  for (let i = 0; i < on.json.aux.length; i++) if (i % 8 < 5) assert.strictEqual(on.json.aux[i], off.json.aux[i]);
});

test('writeVertexAo refuses non-AO_NONE meshes', () => {
  const m = { triCount: 1, aux: new Float32Array(24) };
  m.aux[1] = 1;
  assert.throws(() => writeVertexAo(m, new Float32Array(3).fill(1)), /AO_NONE/);
});

console.log(`${passed} passed`);
