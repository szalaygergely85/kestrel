// Tests for tools/vox-split.mjs (owner request 2026-09-27: split a
// multi-model .vox pack into one file per unique model). Plain Node
// script, no framework (matches tools/vox-import.test.mjs) - run directly:
//   node tools/vox-split.test.mjs
//
// Every .vox fixture is built IN MEMORY (no binary .vox committed to the
// repo), same convention as vox-import.test.mjs.

import assert from 'node:assert';
import {
  splitVoxFile, fingerprintModel, findDuplicates, mapSceneNodesToModels,
  tightBBox, dominantColors, projections, fitsCurrentLimits, fitsMeshOnly, buildSingleModelVox
} from './vox-split.mjs';
import { parseVox } from './voxParse.js';

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

// ---- .vox buffer builder (RIFF 'VOX ' v150/v200), mirrors vox-import.test.mjs

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function i32(n) { const b = Buffer.alloc(4); b.writeInt32LE(n | 0, 0); return b; }
function chunk(id, content) { return Buffer.concat([Buffer.from(id, 'ascii'), u32(content.length), u32(0), content]); }
function str(s) { const b = Buffer.from(String(s), 'utf8'); return Buffer.concat([u32(b.length), b]); }
function dict(obj) {
  const keys = Object.keys(obj);
  const parts = [u32(keys.length)];
  for (const k of keys) { parts.push(str(k)); parts.push(str(obj[k])); }
  return Buffer.concat(parts);
}
function sizeChunk(sx, sy, sz) { return chunk('SIZE', Buffer.concat([u32(sx), u32(sy), u32(sz)])); }
function xyziChunk(voxels) {
  const body = Buffer.alloc(4 + voxels.length * 4);
  body.writeUInt32LE(voxels.length, 0);
  voxels.forEach((v, i) => {
    const o = 4 + i * 4;
    body[o] = v.x; body[o + 1] = v.y; body[o + 2] = v.z; body[o + 3] = v.c;
  });
  return chunk('XYZI', body);
}
function rgbaChunk(entries256) {
  const body = Buffer.alloc(256 * 4);
  for (let i = 0; i < 256; i++) {
    const e = entries256[i] || [0, 0, 0, 0];
    body[i * 4] = e[0]; body[i * 4 + 1] = e[1]; body[i * 4 + 2] = e[2]; body[i * 4 + 3] = e[3];
  }
  return chunk('RGBA', body);
}
function ntrnChunk(nodeId, childId, layerId, name) {
  const frame = dict({});
  const attribs = name ? { _name: name } : {};
  const body = Buffer.concat([u32(nodeId), dict(attribs), u32(childId), i32(-1), i32(layerId == null ? -1 : layerId), u32(1), frame]);
  return chunk('nTRN', body);
}
function ngrpChunk(nodeId, childIds) {
  const body = Buffer.concat([u32(nodeId), dict({}), u32(childIds.length), ...childIds.map(u32)]);
  return chunk('nGRP', body);
}
function nshpChunk(nodeId, modelId) {
  const body = Buffer.concat([u32(nodeId), dict({}), u32(1), u32(modelId), dict({})]);
  return chunk('nSHP', body);
}

/** Builds a multi-model .vox: one SIZE/XYZI pair per entry in `models`,
 * optionally a trivial scene graph (root nTRN -> nGRP -> one nTRN/nSHP pair
 * per model, matching the real Vox/*.vox files' own shape - one node per
 * model, no names) when `withScene` is set. */
function buildMultiModelVox(models, opts = {}) {
  const modelChunks = [];
  models.forEach((m) => {
    modelChunks.push(sizeChunk(...m.size));
    modelChunks.push(xyziChunk(m.voxels));
  });
  const children = [...modelChunks];
  if (opts.palette) children.push(rgbaChunk(opts.palette));
  let version = 150;
  if (opts.withScene) {
    version = 200;
    const ids = models.map((_, i) => ({ trn: 2 + i * 2, shp: 3 + i * 2 }));
    children.push(ntrnChunk(0, 1, null, null));
    children.push(ngrpChunk(1, ids.map((p) => p.trn)));
    ids.forEach((p, i) => {
      children.push(ntrnChunk(p.trn, p.shp, null, opts.names ? opts.names[i] : null));
      children.push(nshpChunk(p.shp, i));
    });
  }
  const mainContent = Buffer.concat(children);
  const mainChunk = Buffer.concat([Buffer.from('MAIN', 'ascii'), u32(0), u32(mainContent.length), mainContent]);
  return Buffer.concat([Buffer.from('VOX ', 'ascii'), u32(version), mainChunk]);
}

function cube(size, c) {
  const [sx, sy, sz] = size;
  const voxels = [];
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) voxels.push({ x, y, z, c });
  return { size, voxels };
}

// ---- fingerprint / duplicate detection ------------------------------------

test('fingerprintModel: identical size+voxels -> identical fingerprint', () => {
  const a = cube([2, 2, 2], 1);
  const b = cube([2, 2, 2], 1);
  assert.strictEqual(fingerprintModel(a), fingerprintModel(b));
});

test('fingerprintModel: voxel order does not matter (sorted internally)', () => {
  const a = { size: [2, 1, 1], voxels: [{ x: 0, y: 0, z: 0, c: 1 }, { x: 1, y: 0, z: 0, c: 2 }] };
  const b = { size: [2, 1, 1], voxels: [{ x: 1, y: 0, z: 0, c: 2 }, { x: 0, y: 0, z: 0, c: 1 }] };
  assert.strictEqual(fingerprintModel(a), fingerprintModel(b));
});

test('fingerprintModel: different color at same cell -> different fingerprint', () => {
  const a = cube([2, 2, 2], 1);
  const b = cube([2, 2, 2], 2);
  assert.notStrictEqual(fingerprintModel(a), fingerprintModel(b));
});

test('findDuplicates: 3 models, #1 duplicates #0, #2 is distinct', () => {
  const models = [cube([2, 2, 2], 1), cube([2, 2, 2], 1), cube([3, 2, 2], 1)];
  const dup = findDuplicates(models);
  assert.deepStrictEqual(dup[0], { index: 0, isUnique: true, duplicateOf: null });
  assert.deepStrictEqual(dup[1], { index: 1, isUnique: false, duplicateOf: 0 });
  assert.deepStrictEqual(dup[2], { index: 2, isUnique: true, duplicateOf: null });
});

// ---- scene-node mapping ----------------------------------------------------

test('mapSceneNodesToModels: no scene graph -> empty map', () => {
  assert.deepStrictEqual(mapSceneNodesToModels(null), {});
});

test('mapSceneNodesToModels: one nSHP per model (real-pack shape), no names', () => {
  const buf = buildMultiModelVox([cube([2, 2, 2], 1), cube([2, 2, 2], 1)], { withScene: true });
  const parsed = parseVox(buf);
  const map = mapSceneNodesToModels(parsed.scene);
  assert.strictEqual(Object.keys(map).length, 2);
  assert.strictEqual(map[0].length, 1);
  assert.strictEqual(map[0][0].name, null);
  assert.strictEqual(map[1].length, 1);
});

test('mapSceneNodesToModels: picks up a named parent nTRN', () => {
  const buf = buildMultiModelVox([cube([2, 2, 2], 1)], { withScene: true, names: ['crate'] });
  const parsed = parseVox(buf);
  const map = mapSceneNodesToModels(parsed.scene);
  assert.strictEqual(map[0][0].name, 'crate');
});

// ---- bbox / dominant colors / projections ---------------------------------

test('tightBBox: tight around the actual voxels, not the declared size', () => {
  const voxels = [{ x: 1, y: 2, z: 0, c: 1 }, { x: 3, y: 2, z: 1, c: 1 }];
  assert.deepStrictEqual(tightBBox(voxels), [1, 2, 0, 4, 3, 2]);
});

test('tightBBox: empty voxel list -> null', () => {
  assert.strictEqual(tightBBox([]), null);
});

test('dominantColors: sorted by count descending, capped', () => {
  const voxels = [
    { x: 0, y: 0, z: 0, c: 1 }, { x: 1, y: 0, z: 0, c: 1 }, { x: 2, y: 0, z: 0, c: 1 },
    { x: 3, y: 0, z: 0, c: 2 }, { x: 4, y: 0, z: 0, c: 2 },
    { x: 5, y: 0, z: 0, c: 3 }
  ];
  const palette = new Array(256).fill([1, 2, 3, 255]);
  const top = dominantColors(voxels, palette, 2);
  assert.strictEqual(top.length, 2);
  assert.strictEqual(top[0].index, 1);
  assert.strictEqual(top[0].count, 3);
  assert.strictEqual(top[1].index, 2);
  assert.strictEqual(top[1].count, 2);
});

test('projections: front/top pick the nearest/topmost voxel per column', () => {
  // A 2x2x2 cube where the back-bottom voxel (y1,z0) is color 5 and the
  // front-bottom voxel (y0,z0) at the same x is color 9 - front view must
  // show 9 (min y wins), and the z1 layer (color 7 at y0) must win on top.
  const palette = new Array(256).fill(null);
  palette[8] = [255, 0, 0, 255]; // index 9
  palette[4] = [0, 255, 0, 255]; // index 5
  palette[6] = [0, 0, 255, 255]; // index 7
  const model = {
    size: [1, 2, 2],
    voxels: [
      { x: 0, y: 0, z: 0, c: 9 }, // front-bottom
      { x: 0, y: 1, z: 0, c: 5 }, // back-bottom
      { x: 0, y: 0, z: 1, c: 7 }  // front-top
    ]
  };
  const { front, top } = projections(model, palette);
  // front: w=sx=1, h=sz=2; row 0 = highest z (z1), row 1 = z0
  assert.strictEqual(front.rows[0][0], '#0000ff'); // z1 front voxel (color 7)
  assert.strictEqual(front.rows[1][0], '#ff0000'); // z0: min-y (front) wins -> color 9, not 5
  // top: w=sx=1, h=sy=2; row 0 = y0 (front row)
  assert.strictEqual(top.rows[0][0], '#0000ff'); // y0 column: max-z wins -> color 7 (z1), not 9 (z0)
  assert.strictEqual(top.rows[1][0], '#00ff00'); // y1 column: only z0 present -> color 5
});

// ---- fit check --------------------------------------------------------------

test('fitsCurrentLimits: small model fits', () => {
  assert.strictEqual(fitsCurrentLimits([8, 8, 8]), true);
});

test('fitsCurrentLimits: an axis over 32 does not fit', () => {
  assert.strictEqual(fitsCurrentLimits([40, 8, 8]), false);
});

test('fitsCurrentLimits: under 32/axis but over 4096 total does not fit', () => {
  assert.strictEqual(fitsCurrentLimits([32, 32, 8]), false); // 8192 voxels
});

test('fitsCurrentLimits: under both caps but axis-sum over 48 does not fit (single-body-part rule)', () => {
  assert.strictEqual(fitsCurrentLimits([20, 20, 20]), false); // sum 60
  assert.strictEqual(fitsCurrentLimits([16, 16, 16]), true);  // sum 48, 4096 voxels - exactly at both caps
});

// ---- fitsMeshOnly (ME-22, docs/architecture.md 28.12 item 6) ---------------

test('fitsMeshOnly: small model fits (no axis-sum rule - mesh-only skips it)', () => {
  assert.strictEqual(fitsMeshOnly([20, 20, 20]), true); // sum 60, would fail fitsCurrentLimits
});

test('fitsMeshOnly: a model over fitsCurrentLimits but within mesh-only bounds fits', () => {
  assert.strictEqual(fitsCurrentLimits([40, 40, 40]), false);
  assert.strictEqual(fitsMeshOnly([40, 40, 40]), true); // 64000 voxels, well under 2,097,152
});

test('fitsMeshOnly: an axis over 256 does not fit', () => {
  assert.strictEqual(fitsMeshOnly([300, 8, 8]), false);
});

test('fitsMeshOnly: under 256/axis but over 2,097,152 total does not fit', () => {
  assert.strictEqual(fitsMeshOnly([200, 200, 53]), false); // 2,120,000 voxels
});

// ---- buildSingleModelVox round-trips through parseVox ---------------------

test('buildSingleModelVox: round-trips through parseVox (size, voxels, palette)', () => {
  const model = { size: [2, 3, 1], voxels: [{ x: 0, y: 0, z: 0, c: 1 }, { x: 1, y: 2, z: 0, c: 2 }] };
  const palette = new Array(256).fill([0, 0, 0, 0]);
  palette[0] = [10, 20, 30, 255];
  palette[1] = [40, 50, 60, 255];
  const buf = buildSingleModelVox(model, palette);
  const parsed = parseVox(buf);
  assert.deepStrictEqual(parsed.size, [2, 3, 1]);
  assert.strictEqual(parsed.voxels.length, 2);
  assert.strictEqual(parsed.scene, null); // single model, no scene graph written
  assert.deepStrictEqual(parsed.palette[0], [10, 20, 30, 255]);
});

// ---- splitVoxFile end-to-end -----------------------------------------------

test('splitVoxFile: writes one file per unique model, skips exact duplicates', () => {
  const models = [
    cube([2, 2, 2], 1),  // unique -> pack_01
    cube([2, 2, 2], 1),  // duplicate of #0
    cube([3, 2, 2], 2),  // unique -> pack_02
    cube([2, 2, 2], 1)   // duplicate of #0 again
  ];
  const buf = buildMultiModelVox(models, { withScene: true, palette: (() => {
    const p = new Array(256).fill([0, 0, 0, 0]);
    p[0] = [200, 0, 0, 255]; p[1] = [0, 200, 0, 255];
    return p;
  })() });
  const result = splitVoxFile(buf, 'pack');

  assert.strictEqual(result.totalModels, 4);
  assert.strictEqual(result.uniqueModels, 2);
  assert.strictEqual(result.duplicateModels, 2);
  assert.strictEqual(result.files.length, 2);
  assert.strictEqual(result.files[0].id, 'pack_01');
  assert.strictEqual(result.files[1].id, 'pack_02');

  assert.strictEqual(result.entries[0].id, 'pack_01');
  assert.strictEqual(result.entries[0].duplicateOf, null);
  assert.strictEqual(result.entries[1].id, null);
  assert.strictEqual(result.entries[1].duplicateOf, 'pack_01');
  assert.strictEqual(result.entries[2].id, 'pack_02');
  assert.strictEqual(result.entries[3].id, null);
  assert.strictEqual(result.entries[3].duplicateOf, 'pack_01');

  // each unique file round-trips and matches its own model's shape
  const parsedFirst = parseVox(result.files[0].buffer);
  assert.deepStrictEqual(parsedFirst.size, [2, 2, 2]);
  assert.strictEqual(parsedFirst.voxels.length, 8);
});

test('splitVoxFile: fits/fitsNote reflects current engine limits per model (ME-22 mesh-only note)', () => {
  const models = [cube([8, 8, 8], 1), cube([40, 40, 40], 1)];
  const result = splitVoxFile(buildMultiModelVox(models), 'pack');
  assert.strictEqual(result.entries[0].fits, true);
  assert.strictEqual(result.entries[0].fitsNote, null);
  assert.strictEqual(result.entries[1].fits, false);
  // 40^3 = 64000 voxels - over fitsCurrentLimits but well within the
  // mesh-only bounds (ME-22).
  assert.strictEqual(result.entries[1].fitsNote, 'mesh-only (ME-22)');
});

test('splitVoxFile: fitsNote is "too large even for mesh-only" past the mesh-only bounds too', () => {
  // A single axis of 300 (> MESH_ONLY_MAX_DIM 256) - cheap (300 voxels total).
  const models = [cube([300, 1, 1], 1)];
  const result = splitVoxFile(buildMultiModelVox(models), 'pack');
  assert.strictEqual(result.entries[0].fits, false);
  assert.strictEqual(result.entries[0].fitsNote, 'too large even for mesh-only - split');
});

console.log(`${passed} passed`);
