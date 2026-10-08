// engine/mesh/meshBin.test.js (MESH-BIN-01): .mesh.bin encode/decode, header validation, and EVERY committed mesh:
// bin-loaded MeshData == the all-JSON path (meshToJSON -> JSON text -> meshFromJSON) byte for byte.
// Run: node engine/mesh/meshBin.test.js
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { meshFromJSON, meshToJSON, packFlat1 } from './MeshData.js';
import { encodeMeshBin, decodeMeshBin, meshFromBin, meshBinMeta, MESH_BIN_MAGIC } from './meshBin.js';
import { loadContentPack } from '../content/loadPack.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`FAIL - ${name}\n${e.stack || e.message}`); process.exitCode = 1; }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`FAIL - ${name}\n${e.stack || e.message}`); process.exitCode = 1; }
}

/** First difference between two MeshData (typed arrays compared by bytes), or ''. */
function diff(a, b) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k];
    if (ArrayBuffer.isView(x) || ArrayBuffer.isView(y)) {
      if (!ArrayBuffer.isView(x) || !ArrayBuffer.isView(y) || x.constructor !== y.constructor || x.length !== y.length
        || Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.byteLength), Buffer.from(y.buffer, y.byteOffset, y.byteLength))) return k;
    } else if (k === 'mats') {
      if (JSON.stringify(x, Object.keys(x || {}).sort()) !== JSON.stringify(y, Object.keys(y || {}).sort())) return k;
    } else if (JSON.stringify(x) !== JSON.stringify(y)) return k;
  }
  return '';
}

// ---- synthetic meshes: every encoding ----
function manual(nTris, mode) {
  const n = nTris * 3;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), nrm = new Uint32Array(n), flat = new Uint32Array(n * 2), aux = new Float32Array(n * 8);
  for (let v = 0; v < n; v++) {
    const t = Math.floor(v / 3);
    pos.set([Math.fround(Math.sin(v) * 5), Math.fround(Math.cos(v * 1.3) * 3), Math.fround(v * 0.01)], v * 3);
    if (mode === 'planar') uv.set([pos[v * 3 + 1], pos[v * 3 + 2]], v * 2); // plane (1,2) for every tri
    else uv.set([Math.fround(v * 0.1), Math.fround(1 / (v + 1))], v * 2);
    nrm[v] = (t % 7) * 1000 + (v % 3 === 0 ? 1 : 0);
    flat[v * 2] = 0xe0000000 + t; flat[v * 2 + 1] = packFlat1(1, 2, t % 3);
  }
  return {
    version: 1, id: 't/manual', layout: 'static', pos, uv, nrm, flat, aux, idx: null, triCount: nTris,
    bbox: Float64Array.from([-5, -3, 0, 5, 3, 1]), ranges: [{ start: 0, count: nTris, part: 'p' }], matKeys: ['a', 'b', 'c'], matsResolved: false, meshVersion: 0,
  };
}

test('round trip (planar uv, tri-uniform flat, const aux, dict nrm)', () => {
  const m = manual(40, 'planar');
  const bin = encodeMeshBin(m);
  const back = meshFromBin(meshBinMeta(m, 'x.mesh.bin'), bin);
  assert.equal(diff(m, back), '');
  assert.ok(bin.length < 40 * 3 * (12 + 8 + 4 + 8 + 32), 'smaller than raw');
});
test('round trip (non-planar uv falls back to a generic encoding)', () => {
  const m = manual(40, 'free');
  assert.equal(diff(m, meshFromBin(meshBinMeta(m, 'x.mesh.bin'), encodeMeshBin(m))), '');
});
test('round trip with uvMask, collider, flags and -0 / NaN-free exact bits', () => {
  const m = manual(10, 'planar');
  m.uvMask = new Float32Array(m.pos.length / 3 * 2).fill(0.5); m.uvMask[3] = -0;
  m.collider = Float32Array.from({ length: 27 }, (_, i) => Math.fround(i * 0.1 - 1));
  m.castShadow = false; m.collide = false; m.mats = { a: 'rock' };
  m.ranges = [{ start: 0, count: 5, part: 'o' }, { start: 5, count: 5, part: 'm', mask: { tex: 'p/Leaf', cutoff: 0.25 } }];
  const back = meshFromBin(meshBinMeta(m, 'x.mesh.bin'), encodeMeshBin(m));
  assert.equal(diff(m, back), '');
  assert.ok(Object.is(back.uvMask[3], -0));
});
test('large unique count uses 32-bit dictionary indices', () => {
  const m = manual(30000, 'free'); // 90k unique uv tuples > 65536
  assert.equal(diff(m, meshFromBin(meshBinMeta(m, 'x.mesh.bin'), encodeMeshBin(m))), '');
});
test('terrain layout: idx stream round-trips as Uint32Array', () => {
  const m = manual(2, 'free'); m.layout = 'terrain'; m.idx = Uint32Array.from([0, 1, 2, 3, 4, 5]); m.uv = new Float32Array(0);
  const d = decodeMeshBin(encodeMeshBin({ ...m, uv: new Float32Array(0) }));
  assert.deepEqual(Array.from(d.idx), [0, 1, 2, 3, 4, 5]);
});
test('deterministic bytes; 16-byte aligned sections; misaligned Node Buffer input accepted', () => {
  const m = manual(12, 'planar');
  const a = encodeMeshBin(m), b = encodeMeshBin(m);
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
  const dv = new DataView(a.buffer);
  for (let i = 0; i < dv.getUint32(16, true); i++) assert.equal(dv.getUint32(32 + i * 24 + 8, true) % 16, 0);
  const shifted = new Uint8Array(a.length + 1); shifted.set(a, 1);
  assert.equal(diff(m, meshFromBin(meshBinMeta(m, 'x'), shifted.subarray(1))), '');
  assert.ok(decodeMeshBin(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)).pos instanceof Float32Array);
});
test('raw streams are zero-copy views into the fetched buffer', () => {
  const m = manual(12, 'free');
  for (let i = 0; i < m.nrm.length; i++) m.nrm[i] = i * 7919; // all distinct: raw wins over dict
  const bin = encodeMeshBin(m);
  const d = decodeMeshBin(bin);
  assert.equal(d.nrm.buffer, bin.buffer);
});

test('header validation: bad magic / version / truncated / bad section', () => {
  const m = manual(6, 'planar');
  const good = encodeMeshBin(m);
  const bad = (mut, re) => { const c = Uint8Array.from(good); mut(c, new DataView(c.buffer)); assert.throws(() => decodeMeshBin(c), re); };
  bad((c, dv) => dv.setUint32(0, 0x12345678, true), /mesh\.bin: bad magic/);
  bad((c, dv) => dv.setUint32(4, 99, true), /mesh\.bin: unsupported version 99/);
  assert.throws(() => decodeMeshBin(good.subarray(0, good.length - 16)), /mesh\.bin: truncated/);
  assert.throws(() => decodeMeshBin(good.subarray(0, 10)), /mesh\.bin: truncated/);
  bad((c, dv) => dv.setUint32(32, 77, true), /unknown section id 77/);
  bad((c, dv) => dv.setUint32(32 + 4, 42, true), /unknown encoding 42/);
  bad((c, dv) => dv.setUint32(32 + 8, 1 << 20, true), /out of bounds/);
  bad((c, dv) => dv.setUint32(8, 7, true), /vertices, header says 7/);
  assert.equal(MESH_BIN_MAGIC, 0x48534d4b);
  assert.throws(() => meshFromBin({ ...meshBinMeta(m, 'x'), triCount: 5 }, good), /triCount/);
});

// ---- every committed mesh ----
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../content');
const metaFiles = [];
(function walk(d) { for (const f of readdirSync(d).sort()) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.mesh.json')) metaFiles.push(p); } })(path.join(root, 'meshes'));
test(`every content mesh (${metaFiles.length}): bin MeshData == JSON-path MeshData, byte for byte`, () => {
  assert.ok(metaFiles.length >= 30);
  for (const f of metaFiles) {
    const meta = JSON.parse(readFileSync(f, 'utf8'));
    if (typeof meta.bin !== 'string') continue; // legacy all-JSON file: the JSON path itself
    const bytes = readFileSync(path.join(path.dirname(f), meta.bin));
    const fromBin = meshFromBin(meta, bytes);
    const viaJson = meshFromJSON(JSON.parse(JSON.stringify(meshToJSON(fromBin))));
    assert.equal(diff(viaJson, fromBin), '', f);
    // and a re-encode of the decoded mesh reproduces the committed file exactly (canonical encoder)
    assert.deepEqual(Buffer.from(encodeMeshBin(fromBin, { collider: false })), Buffer.from(bytes), `${f}: re-encode differs`);
  }
});
test('DeadTree_1 payload <= 0.3 MB (was ~3 MB of json)', () => {
  const j = path.join(root, 'meshes/quaternius/DeadTree_1.mesh.json');
  const meta = JSON.parse(readFileSync(j, 'utf8'));
  const total = statSync(j).size + statSync(path.join(path.dirname(j), meta.bin)).size;
  assert.ok(total <= 300 * 1024, `${total} bytes`);
});

await atest('loadContentPack: manifest meshes load from meta + bin (fetchBytes), errors name the file', async () => {
  const manifestUrl = new URL('../../content/manifest.json', import.meta.url).href;
  const fetchText = async (u) => readFileSync(new URL(u), 'utf8');
  const fetchBytes = async (u) => readFileSync(new URL(u));
  const bundle = await loadContentPack(manifestUrl, { fetchText, fetchBytes });
  const ids = Object.keys(bundle.meshes);
  assert.ok(ids.length >= 12, `${ids.length} registered meshes`);
  for (const id of ids) {
    const url = bundle.meta.mesh[id].url;
    const meta = JSON.parse(readFileSync(new URL(url), 'utf8'));
    if (typeof meta.bin !== 'string') continue;
    const direct = meshFromBin(meta, readFileSync(new URL(meta.bin, url)));
    direct.mats = bundle.meshes[id].mats;
    assert.equal(diff(direct, bundle.meshes[id]), '', id);
  }
  // a corrupt bin surfaces as a ContentError that names the mesh
  const corrupt = async (u) => { const b = Uint8Array.from(readFileSync(new URL(u))); b[0] = 0; return b; };
  await assert.rejects(loadContentPack(manifestUrl, { fetchText, fetchBytes: corrupt }), (e) => e.errors.some((x) => /bad magic/.test(x.message)));
  await assert.rejects(loadContentPack(manifestUrl, { fetchText, fetchBytes: async () => { throw new Error('HTTP 404'); } }), (e) => e.errors.some((x) => /404/.test(x.message)));
});

console.log(`meshBin.test: ${passed} passed`);
