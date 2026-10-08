// Tests for tools/gltf-import.mjs (ME-13b). Plain Node script, no framework
// (matches tools/vox-import.test.mjs) - run directly:
//   node tools/gltf-import.test.mjs
//
// The .glb fixture is built IN MEMORY (no binary file is committed) - a
// minimal valid GLB container (JSON chunk + BIN chunk), same byte layout
// engine/mesh/gltf.test.js's own buildGlb() produces (duplicated here on
// purpose: every fixture file in this repo builds its own binary buffers
// in-code rather than sharing a test-only module).

import { readMeshJSON } from './mesh-file.mjs';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importGltfBytes, runCli, countSmoothGroups, loadEngineMaterialKeys, stringifyMeshJSON } from './gltf-import.mjs';
import { meshFromJSON, validateMesh } from '../engine/index.js';
import { budgetFor } from './mesh-budgets.mjs';

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
function buildTriangleGlb(positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]], indices = [0, 1, 2]) {
  const posBuf = Buffer.alloc(positions.length * 3 * 4);
  let o = 0;
  for (const p of positions) for (const c of p) { posBuf.writeFloatLE(c, o); o += 4; }
  const idxBuf = pad4(Buffer.alloc(indices.length * 2));
  indices.forEach((v, i) => idxBuf.writeUInt16LE(v, i * 2));
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
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
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
  // MESH-BIN-01: default = small meta + .mesh.bin
  const meta = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.strictEqual(meta.bin, 'tri.mesh.bin');
  assert.ok(!('pos' in meta) && fs.existsSync(path.join(tmpDir, 'out', 'tri.mesh.bin')));
  const mesh = meshFromJSON(readMeshJSON(outPath));
  const { errors } = validateMesh(mesh);
  assert.deepStrictEqual(errors, []);
  // --json = the legacy single all-JSON file
  const legacy = path.join(tmpDir, 'out', 'legacy.mesh.json');
  await runCli([glbPath, 'test:tri-cli', '--json', '--out', legacy]);
  const text = fs.readFileSync(legacy, 'utf8');
  assert.match(text, /"pos": \[.*\]/);
  assert.deepStrictEqual(validateMesh(meshFromJSON(JSON.parse(text))).errors, []);
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
    assert.deepStrictEqual(readMeshJSON(out).mats, { TestMat: 'stone' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 3. --simplify / --budget (MESH-SIMP-01)
/** Flat n x n grid, z = 0 (2 n^2 triangles). */
function gridGlb(n) {
  const pos = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push([i / n, j / n, 0]);
  const v = (i, j) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) idx.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1));
  return buildTriangleGlb(pos, idx);
}
await testAsync('runCli: --simplify reaches about the target, stays valid and deterministic', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-simp-'));
  const glb = path.join(dir, 'grid.glb'), a = path.join(dir, 'a.mesh.json'), b = path.join(dir, 'b.mesh.json');
  try {
    fs.writeFileSync(glb, gridGlb(16)); // 512 tris
    const r = await runCli([glb, 'test_simp', '--simplify', '100', '--out', a]);
    assert.ok(r.report.triCount >= 90 && r.report.triCount <= 110, `triCount ${r.report.triCount}`);
    const json = readMeshJSON(a);
    assert.strictEqual(json.triCount, r.report.triCount);
    assert.strictEqual(validateMesh(meshFromJSON(json)).errors.length, 0);
    await runCli([glb, 'test_simp', '--simplify', '100', '--out', b]);
    assert.deepStrictEqual(fs.readFileSync(path.join(dir, 'a.mesh.bin')), fs.readFileSync(path.join(dir, 'b.mesh.bin')));
    assert.deepStrictEqual(readMeshJSON(a), { ...readMeshJSON(b) });
    const full = await runCli([glb, 'test_simp', '--simplify', '5000', '--dry-run']); // target above the count: untouched
    assert.strictEqual(full.report.triCount, 512);
    await assert.rejects(() => runCli([glb, 'test_simp', '--simplify', '2', '--dry-run']), /triangle target/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

await testAsync('runCli: --budget picks the target from tools/mesh-budgets.mjs by id basename', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-budget-'));
  const glb = path.join(dir, 'g.glb');
  try {
    fs.writeFileSync(glb, gridGlb(12)); // 288 tris
    const pebble = await runCli([glb, 'quaternius/Pebble_Round_9', '--budget', '--dry-run']);
    assert.ok(pebble.report.triCount <= 88 && pebble.report.triCount >= 72, `pebble ${pebble.report.triCount}`);
    const unknown = await runCli([glb, 'quaternius/Whatever', '--budget', '--dry-run']); // no rule -> untouched
    assert.strictEqual(unknown.report.triCount, 288);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mesh-budgets: rules match the story table', () => {
  assert.strictEqual(budgetFor('quaternius/DeadTree_2'), 2000);
  assert.strictEqual(budgetFor('quaternius/Rock_Medium_3'), 400);
  assert.strictEqual(budgetFor('quaternius/RockPath_Round_Thin'), 250);
  assert.strictEqual(budgetFor('quaternius/Mushroom_Common'), 250);
  assert.strictEqual(budgetFor('quaternius/Pebble_Square_1'), 80);
  assert.strictEqual(budgetFor('quaternius/Grass_Wispy_Tall'), 60);
  assert.strictEqual(budgetFor('ruins/BlockNormalMD'), null);
});

await testAsync('runCli: --help with no args returns the help text', async () => {
  const result = await runCli([]);
  assert.strictEqual(result.help, true);
  assert.ok(result.text.includes('gltf-import'));
});

// ---- ALPHA-01a (37.17): alpha masks -------------------------------------------------------------------------------------------------
import { downsampleAlpha, maskFromJSON, stringifyContent } from '../engine/index.js';
const QGLTF = 'design/meshes/quaternius/glTF/CommonTree_1.gltf';

test('mask downsample: hand-checked 2x2 -> 1x1 box average, rounded', () => {
  assert.deepStrictEqual([...downsampleAlpha(Uint8Array.from([0, 255, 255, 255]), 2, 2, 1, 1)], [191]); // 765/4 = 191.25
  assert.deepStrictEqual([...downsampleAlpha(Uint8Array.from([0, 0, 255, 1]), 2, 2, 1, 1)], [64]); // 256/4 = 64
  assert.deepStrictEqual([...downsampleAlpha(Uint8Array.from([10, 20, 30, 40]), 2, 2, 2, 2)], [10, 20, 30, 40]); // same size = identity
  assert.deepStrictEqual([...downsampleAlpha(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 4, 2, 2, 1)], [4, 6]); // (1+2+5+6)/4=3.5->4 , (3+4+7+8)/4=5.5->6
});

await testAsync('CommonTree_1 dry-run: 2 ranges (bark opaque by the auto rule, leaves masked), WARN, mask file named', async () => {
  const r = await runCli([QGLTF, 'quaternius/CommonTree_1', '--dry-run', '--masks', 'content/masks']);
  assert.strictEqual(r.report.ranges.length, 2);
  assert.strictEqual(r.report.ranges[0].mask, undefined);
  assert.strictEqual(r.report.ranges[0].count, 4345);
  assert.deepStrictEqual(r.report.ranges[1].mask, { tex: 'quaternius/Leaves_NormalTree_C', cutoff: 0.2 });
  assert.strictEqual(r.report.ranges[1].count, 1920);
  assert.ok(r.report.warnings.some((w) => w.includes('"Bark_NormalTree"')), 'Bark_NormalTree WARN');
  assert.strictEqual(r.report.maskFiles.length, 1);
});

await testAsync('CommonTree_1: .mesh.json + .mask.json written, re-run byte-identical, mask file canonical + loadable, --masks none = old output', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-mask-'));
  try {
    const run = async (n, extra = []) => runCli([QGLTF, 'quaternius/CommonTree_1', '--out', path.join(dir, `m${n}.json`), '--masks', path.join(dir, `masks${n}`), ...extra]);
    await run(1); await run(2);
    const a = fs.readFileSync(path.join(dir, 'm1.json'), 'utf8');
    assert.strictEqual(a, fs.readFileSync(path.join(dir, 'm2.json'), 'utf8'));
    const mf = path.join('masks1', 'quaternius', 'Leaves_NormalTree_C.mask.json');
    const text = fs.readFileSync(path.join(dir, mf), 'utf8');
    assert.strictEqual(text, fs.readFileSync(path.join(dir, 'masks2', 'quaternius', 'Leaves_NormalTree_C.mask.json'), 'utf8'));
    assert.strictEqual(stringifyContent(JSON.parse(text)), text, 'mask file is in canonical stringifyContent form');
    const mask = maskFromJSON(JSON.parse(text));
    assert.strictEqual(mask.w, 256); assert.strictEqual(mask.h, 256); assert.strictEqual(mask.cutoffDefault, 0.2);
    assert.ok(mask.data.some((b) => b < 51) && mask.data.some((b) => b === 255), 'leaf mask has holes and solid texels');
    const mesh = meshFromJSON(JSON.parse(a));
    assert.deepStrictEqual(validateMesh(mesh).errors, []);
    assert.ok(mesh.uvMask && mesh.ranges[1].mask && !mesh.ranges[0].mask);
    const none = await runCli([QGLTF, 'quaternius/CommonTree_1', '--out', path.join(dir, 'none.json'), '--masks', 'none']);
    assert.strictEqual(none.report.ranges.length, 2);
    assert.ok(!JSON.parse(fs.readFileSync(path.join(dir, 'none.json'), 'utf8')).uvMask, '--masks none imports as before (no uvMask)');
    const low = await runCli([QGLTF, 'quaternius/CommonTree_1', '--dry-run', '--masks', 'content/masks', '--mask-res', '64']);
    assert.ok(low.report.maskFiles.length === 1);
    const forced = await runCli([QGLTF, 'quaternius/CommonTree_1', '--dry-run', '--masks', 'content/masks', '--opaque', 'Leaves_NormalTree']);
    assert.ok(forced.report.ranges.every((r) => !r.mask), '--opaque forces the leaf material opaque');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

await testAsync('ALPHA-01b ARCH CHANGES: masks are opt-in - no --masks = old output (no uvMask, no mask files, no mask warnings)', async () => {
  const r = await runCli([QGLTF, 'quaternius/CommonTree_1', '--dry-run']);
  assert.ok(r.report.ranges.every((x) => !x.mask), 'no masked range by default');
  assert.strictEqual(r.report.maskFiles.length, 0);
});

await testAsync('Ruins import unchanged by ALPHA-01a: no uvMask/mask, render data equals the committed content mesh', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-ruins-'));
  try {
    const out = path.join(dir, 'Line.json');
    await runCli(['design/meshes/ruins/Fences/Line.glb', 'ruins/Fences/Line', '--out', out]);
    const now = JSON.parse(fs.readFileSync(out, 'utf8')), was = readMeshJSON('content/meshes/ruins/Fences/Line.mesh.json');
    assert.ok(!('uvMask' in now));
    for (const k of ['pos', 'uv', 'nrm', 'flat', 'aux', 'bbox', 'ranges', 'matKeys', 'triCount']) assert.deepStrictEqual(now[k], was[k], k);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log(`${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}.`);
if (!process.exitCode) console.log('ALL PASS');
