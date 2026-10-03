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
import { importGltfBytes, runCli } from './gltf-import.mjs';
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
function buildTriangleGlb() {
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
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
  const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
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

await testAsync('runCli: --help with no args returns the help text', async () => {
  const result = await runCli([]);
  assert.strictEqual(result.help, true);
  assert.ok(result.text.includes('gltf-import'));
});

console.log(`${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}.`);
if (!process.exitCode) console.log('ALL PASS');
