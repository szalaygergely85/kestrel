// Tests for tools/gltf-import.mjs (ME-13b). Plain Node script, no framework
// (matches tools/vox-import.test.mjs) - run directly:
//   node tools/gltf-import.test.mjs
//
// The .glb fixture is built IN MEMORY (no binary file is committed) - a
// minimal valid GLB container (JSON chunk + BIN chunk), same byte layout
// engine/mesh/gltf.test.js's own buildGlb() produces (duplicated here on
// purpose: every fixture file in this repo builds its own binary buffers
// in-code rather than sharing a test-only module).

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importGltfBytes, runCli, countSmoothGroups, loadEngineMaterialKeys, stringifyMeshJSON } from './gltf-import.mjs';
import { meshFromJSON, validateMesh } from '../engine/index.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    console.error(e.stack || e.message);
    process.exitCode = 1;
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    console.error(e.stack || e.message);
    process.exitCode = 1;
  }
}

function pad4(buf, fill = 0x00) {
  const rem = buf.length % 4;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]);
}

/** Minimal valid .glb: one triangle, one node, default scene, one material
 * named "TestMat" (deliberately NOT in the engine's material map, so the
 * unmapped-material report has something to find). */
function buildTriangleGlb(positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]) {
  const posBuf = Buffer.alloc(positions.length * 3 * 4);
  let o = 0;
  for (const p of positions) for (const c of p) { posBuf.writeFloatLE(c, o); o += 4; }
  const idxBuf = Buffer.alloc(3 * 2);
  [0, 1, 2].forEach((v, i) => idxBuf.writeUInt16LE(v, i * 2));
  const bin = Buffer.concat([posBuf, idxBuf]);

  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'TestMat' }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length },
      { buffer: 0, byteOffset: posBuf.length, byteLength: idxBuf.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBuf = pad4(Buffer.from(JSON.stringify(json), 'utf-8'), 0x20);
  const binBuf = pad4(bin);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);
  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuf.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuf]);
}

// ---------------------------------------------------------------------------
// 1. importGltfBytes: core function, no file I/O.
// ---------------------------------------------------------------------------
test('importGltfBytes: produces a MeshData that round-trips through meshFromJSON/validateMesh', () => {
  const glb = buildTriangleGlb();
  const { report, json } = importGltfBytes(glb, 'test:tri', {}, new Set(['stone'])); // 'TestMat' deliberately absent
  assert.strictEqual(report.triCount, 1);
  assert.strictEqual(report.groupCount, 1);
  assert.deepStrictEqual(report.unmapped, ['TestMat']);
  const mesh = meshFromJSON(json);
  const { errors } = validateMesh(mesh);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(mesh.matKeys[0], 'TestMat');
});

test('importGltfBytes: no unmapped report when materialKeys is null (engine material table unavailable)', () => {
  const glb = buildTriangleGlb();
  const { report } = importGltfBytes(glb, 'test:tri2', {}, null);
  assert.deepStrictEqual(report.unmapped, []);
});

test('rounded floats preserve valid geometry and packed integer attributes', () => {
  const glb = buildTriangleGlb([[0.1234567, -0.2345678, 0.3456789], [1.7654321, 0, 0], [0, 1.4567891, 0]]);
  const { mesh, json } = importGltfBytes(glb, 'test:rounded');
  for (const key of ['pos', 'uv', 'aux', 'bbox']) {
    for (let i = 0; i < json[key].length; i++) {
      assert.strictEqual(json[key][i], Math.round(mesh[key][i] * 1e5) / 1e5);
      assert.ok(Math.abs(json[key][i] - mesh[key][i]) <= 5.001e-6);
    }
  }
  for (const key of ['flat', 'nrm']) assert.deepStrictEqual(json[key], Array.from(mesh[key]));
  assert.deepStrictEqual(validateMesh(meshFromJSON(JSON.parse(stringifyMeshJSON(json)))).errors, []);
});

test('packed numeric arrays preserve JSON strings and stable output', () => {
  const { json } = importGltfBytes(buildTriangleGlb(), 'test:[1,  2]');
  json.matKeys = ['material [1,  2] "quoted"'];
  const text = stringifyMeshJSON(json);
  assert.deepStrictEqual(JSON.parse(text), JSON.parse(JSON.stringify(json)));
  for (const key of ['pos', 'uv', 'nrm', 'flat', 'aux', 'bbox']) {
    const line = text.split('\n').find((l) => l.startsWith(`  "${key}": [`));
    assert.ok(line && /\],?$/.test(line), `${key} must occupy one line`);
  }
  assert.strictEqual(text, stringifyMeshJSON(json));
  assert.ok(text.length < JSON.stringify(json, null, 2).length);
});

test('smoothing groups retain object identity and deduplicate repeated vertices', () => {
  const mesh = { flat: Uint32Array.from([0xe0100001, 9, 0xe0100001, 9, 0xe0200001, 9, 0xe0200002, 9]) };
  assert.strictEqual(countSmoothGroups(mesh), 3);
});

await testAsync('unavailable material tables emit a warning explaining the skipped check', async () => {
  const warnings = [], original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const keys = await loadEngineMaterialKeys(async () => { throw new Error('fixture unavailable'); });
    assert.strictEqual(keys, null);
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /WARNING.*unmapped-material check skipped.*fixture unavailable/);
  } finally {
    console.warn = original;
  }
});

// ---------------------------------------------------------------------------
// 2. runCli: writes content/meshes/<id>.mesh.json (to a temp --out path) and
// the written file round-trips through meshFromJSON/validateMesh.
// ---------------------------------------------------------------------------
await testAsync('runCli: writes a .mesh.json that round-trips', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gltf-import-test-'));
  const glbPath = path.join(tmpDir, 'tri.glb');
  fs.writeFileSync(glbPath, buildTriangleGlb());
  const outPath = path.join(tmpDir, 'out', 'tri.mesh.json');
  const result = await runCli([glbPath, 'test:tri-cli', '--out', outPath]);
  assert.strictEqual(result.wrote, outPath);
  assert.strictEqual(result.report.triCount, 1);
  const text = fs.readFileSync(outPath, 'utf8');
  assert.match(text, /"pos": \[.*\]/);
  const written = JSON.parse(text);
  const mesh = meshFromJSON(written);
  const { errors } = validateMesh(mesh);
  assert.deepStrictEqual(errors, []);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

await testAsync('runCli: --dry-run writes nothing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gltf-import-test-'));
  const glbPath = path.join(tmpDir, 'tri.glb');
  fs.writeFileSync(glbPath, buildTriangleGlb());
  const result = await runCli([glbPath, 'test:tri-dry', '--dry-run']);
  assert.strictEqual(result.wrote, null);
  assert.strictEqual(fs.existsSync(path.join('content', 'meshes', 'test:tri-dry.mesh.json')), false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('material sidecar maps glTF names in both MeshData and its content JSON', () => {
  const mats = { TestMat: 'stone' };
  const result = importGltfBytes(buildTriangleGlb(), 'test_mapped', { mats }, new Set(['stone']));
  assert.deepStrictEqual(result.report.unmapped, []);
  assert.deepStrictEqual(result.mesh.mats, mats);
  assert.deepStrictEqual(result.json.mats, mats);
  assert.equal(result.json.kind, 'mesh');
  assert.equal(result.json.schema, 1);
  assert.deepStrictEqual(meshFromJSON(result.json).mats, mats);
  for (const invalid of [[], null, { TestMat: 7 }]) assert.throws(() => importGltfBytes(buildTriangleGlb(), 'test_badmap', { mats: invalid }), /must be an object/);
});

await testAsync('runCli: --mats reads and persists the sidecar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-mats-'));
  const glb = path.join(dir, 'tri.glb'), map = path.join(dir, 'tri.mats.json'), out = path.join(dir, 'tri.mesh.json');
  try {
    fs.writeFileSync(glb, buildTriangleGlb());
    fs.writeFileSync(map, JSON.stringify({ TestMat: 'stone' }));
    const result = await runCli([glb, 'test_mapped_cli', '--mats', map, '--out', out]);
    assert.deepStrictEqual(result.report.unmapped, []);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).mats, { TestMat: 'stone' });
  } finally {
    for (const file of [glb, map, out]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});

await testAsync('runCli: --help with no args returns the help text', async () => {
  const result = await runCli([]);
  assert.strictEqual(result.help, true);
  assert.ok(result.text.includes('gltf-import'));
});

console.log(`${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}.`);
if (!process.exitCode) console.log('ALL PASS');
