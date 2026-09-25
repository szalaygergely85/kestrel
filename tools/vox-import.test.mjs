// Tests for tools/vox-import.mjs (OWN-REQ-005a). Plain Node script, no
// framework (matches engine/physics/physics.test.js etc.) - run directly:
//   node tools/vox-import.test.mjs
//
// Every .vox fixture is built IN MEMORY by buildVoxBuffer() below (no
// binary .vox file is committed to the repo).

import assert from 'node:assert';
import { parseVox, buildVoxelModel, formatModule } from './vox-import.mjs';
import { validateVoxelModel } from '../engine/index.js';

// OWN-REQ-005b (docs/backlog.md row 25r split) additions below the
// OWN-REQ-005a tests: scene-graph (`nTRN`/`nGRP`/`nSHP`/`LAYR`) fixtures,
// also built byte-for-byte in memory, per the chunk layout documented in
// vox-import.mjs's own "---- scene graph (OWN-REQ-005b) ----" header
// comment (this is what these fixtures are checked for INTERNAL
// consistency against - not a captured real MagicaVoxel export; see that
// file's KNOWN LIMITATIONS note and this session's report for the
// confidence level on the real-world format).

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

// ---- .vox buffer builder (RIFF 'VOX ' v150) --------------------------------

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/** One chunk: id (4 ascii) + contentSize(u32) + childrenSize(u32, always 0
 * here - none of our fixtures need nested chunks) + content. */
function chunk(id, content) {
  return Buffer.concat([Buffer.from(id, 'ascii'), u32(content.length), u32(0), content]);
}

/**
 * Builds a minimal .vox buffer.
 * @param {[number,number,number]} size
 * @param {Array<{x:number,y:number,z:number,c:number}>} voxels
 * @param {Object} [opts]
 * @param {Array<[number,number,number,number]>} [opts.palette] 256 RGBA entries; omit for no RGBA chunk
 * @param {boolean} [opts.unknownChunk] insert a bogus 'FOOO' chunk before XYZI, to exercise skip-safety
 */
function buildVoxBuffer(size, voxels, opts = {}) {
  const sizeContent = Buffer.concat([u32(size[0]), u32(size[1]), u32(size[2])]);
  const sizeChunk = chunk('SIZE', sizeContent);

  const xyziContent = Buffer.alloc(4 + voxels.length * 4);
  xyziContent.writeUInt32LE(voxels.length, 0);
  voxels.forEach((v, i) => {
    const off = 4 + i * 4;
    xyziContent[off] = v.x;
    xyziContent[off + 1] = v.y;
    xyziContent[off + 2] = v.z;
    xyziContent[off + 3] = v.c;
  });
  const xyziChunk = chunk('XYZI', xyziContent);

  const children = [sizeChunk];
  if (opts.unknownChunk) {
    // An id this tool has never heard of, with arbitrary bytes - parseVox
    // must skip it by content+children length alone, not by recognizing it.
    children.push(chunk('FOOO', Buffer.from([1, 2, 3, 4, 5, 6, 7])));
  }
  children.push(xyziChunk);
  if (opts.palette) {
    const rgbaContent = Buffer.alloc(256 * 4);
    opts.palette.forEach((rgba, i) => {
      rgbaContent[i * 4] = rgba[0];
      rgbaContent[i * 4 + 1] = rgba[1];
      rgbaContent[i * 4 + 2] = rgba[2];
      rgbaContent[i * 4 + 3] = rgba[3];
    });
    children.push(chunk('RGBA', rgbaContent));
  }

  const mainContent = Buffer.concat(children);
  const mainChunk = Buffer.concat([Buffer.from('MAIN', 'ascii'), u32(0), u32(mainContent.length), mainContent]);

  return Buffer.concat([Buffer.from('VOX ', 'ascii'), u32(150), mainChunk]);
}

function charForIndex(mats, materialKey) {
  const ch = Object.keys(mats).find((k) => mats[k] === materialKey);
  assert.ok(ch, `expected a mats entry for '${materialKey}'`);
  return ch;
}

// ---- 1. 2x2x2 cube ----------------------------------------------------------

test('2x2x2 cube parses and builds a valid model', () => {
  const voxels = [];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) voxels.push({ x, y, z, c: 1 });
  const buf = buildVoxBuffer([2, 2, 2], voxels);

  const parsed = parseVox(buf);
  assert.deepStrictEqual(parsed.size, [2, 2, 2]);
  assert.strictEqual(parsed.voxels.length, 8);

  const def = buildVoxelModel(parsed, { 1: 'stone' }, 0.05);
  assert.deepStrictEqual(def.size, [2, 2, 2]);
  assert.deepStrictEqual(def.anchor, [1, 1, 0]); // feet centre default: [sx/2, sy/2, 0]

  const ch = charForIndex(def.mats, 'stone');
  const full = ch + ch;
  assert.deepStrictEqual(def.layers, [[full, full], [full, full]]);

  const { errors } = validateVoxelModel(def, { materialKeys: ['stone'] });
  assert.deepStrictEqual(errors, []);

  // formatModule output should re-embed the same layers as string literals.
  const src = formatModule('cube', def);
  assert.ok(src.includes('ASSETS.voxelModels.cube = {'));
  assert.ok(src.includes(`'${full}'`));
});

// ---- 2. asymmetric L-shape (handedness check) ------------------------------

test('asymmetric L-shape round-trips with the exact expected grid (handedness)', () => {
  // sx=3, sy=3, sz=1: a staircase, asymmetric under an x-flip (row lengths
  // read differently end to end) AND under a y-flip (row lengths 1,2,3 are
  // not the same read row0->row2 as row2->row0). A row<->column swap
  // (x/y transposed) would also produce a DIFFERENT grid than the one
  // asserted below, so this catches x<->y handedness bugs too.
  //   y0: x0            -> "X.."
  //   y1: x0,x1         -> "XX."
  //   y2: x0,x1,x2      -> "XXX"
  const voxels = [
    { x: 0, y: 0, z: 0, c: 1 },
    { x: 0, y: 1, z: 0, c: 1 }, { x: 1, y: 1, z: 0, c: 1 },
    { x: 0, y: 2, z: 0, c: 1 }, { x: 1, y: 2, z: 0, c: 1 }, { x: 2, y: 2, z: 0, c: 1 }
  ];
  const buf = buildVoxBuffer([3, 3, 1], voxels, { unknownChunk: true }); // also exercises unknown-chunk skipping
  const parsed = parseVox(buf);
  assert.strictEqual(parsed.voxels.length, 6);

  const def = buildVoxelModel(parsed, { 1: 'stone' }, 0.05);
  const X = charForIndex(def.mats, 'stone');
  const dot = '.';
  const expected = [
    [`${X}${dot}${dot}`, `${X}${X}${dot}`, `${X}${X}${X}`]
  ];
  assert.deepStrictEqual(def.layers, expected);

  const { errors } = validateVoxelModel(def, { materialKeys: ['stone'] });
  assert.deepStrictEqual(errors, []);
});

// ---- 3. unmapped palette index --------------------------------------------

test('unmapped palette index is a clear, actionable error listing the index and its RGBA', () => {
  const voxels = [{ x: 0, y: 0, z: 0, c: 5 }];
  const palette = new Array(256).fill([0, 0, 0, 0]);
  palette[4] = [200, 150, 40, 255]; // color index 5 -> palette[c-1] = palette[4]
  const buf = buildVoxBuffer([1, 1, 1], voxels, { palette });
  const parsed = parseVox(buf);

  assert.throws(
    () => buildVoxelModel(parsed, { 1: 'stone' }, 0.05),
    (err) => {
      assert.ok(err.message.includes('palette index 5'), err.message);
      assert.ok(err.message.includes('rgba(200, 150, 40, 255)'), err.message);
      return true;
    }
  );
});

// ---- 4. oversize SIZE chunk -------------------------------------------------

test('oversize SIZE chunk (dimension > 32) is a clear error stating the dims found', () => {
  const buf = buildVoxBuffer([40, 2, 2], []);
  const parsed = parseVox(buf);
  assert.throws(
    () => buildVoxelModel(parsed, {}, 0.05),
    (err) => {
      assert.ok(err.message.includes('[40, 2, 2]'), err.message);
      assert.ok(err.message.includes('32'), err.message);
      return true;
    }
  );
});

test('oversize SIZE chunk (total > 4096) is a clear error stating the count found', () => {
  const buf = buildVoxBuffer([32, 32, 8], []); // 8192 > 4096, all axes <= 32
  const parsed = parseVox(buf);
  assert.throws(
    () => buildVoxelModel(parsed, {}, 0.05),
    (err) => {
      assert.ok(err.message.includes('8192'), err.message);
      assert.ok(err.message.includes('4096'), err.message);
      return true;
    }
  );
});

// ---- explicit anchor override ---------------------------------------------

test('explicit anchor overrides the feet-centre default', () => {
  const voxels = [{ x: 0, y: 0, z: 0, c: 1 }];
  const buf = buildVoxBuffer([1, 1, 1], voxels);
  const parsed = parseVox(buf);
  const def = buildVoxelModel(parsed, { 1: 'stone' }, 0.05, [0.4, 0.6, 0.2]);
  assert.deepStrictEqual(def.anchor, [0.4, 0.6, 0.2]);
  assert.deepStrictEqual(def.parts.body.pivot, [0.4, 0.6, 0.2]);
  const { errors } = validateVoxelModel(def);
  assert.deepStrictEqual(errors, []);
});

// ---- OWN-REQ-005b: scene-graph (nTRN/nGRP/nSHP/LAYR) byte builders --------

function i32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n | 0, 0);
  return b;
}

function str(s) {
  const bytes = Buffer.from(s, 'utf8');
  return Buffer.concat([u32(bytes.length), bytes]);
}

function dict(pairs) {
  const keys = Object.keys(pairs);
  const parts = [u32(keys.length)];
  for (const k of keys) {
    parts.push(str(k));
    parts.push(str(String(pairs[k])));
  }
  return Buffer.concat(parts);
}

/** One nTRN node: `t` = "x y z" translation string (omit for none), `r` =
 * the raw rotation byte (omit for none/identity). */
function nTRNChunk(nodeId, { childId, layerId = -1, t, r, name } = {}) {
  const frameAttribs = {};
  if (t !== undefined) frameAttribs._t = t;
  if (r !== undefined) frameAttribs._r = String(r);
  const content = Buffer.concat([
    u32(nodeId),
    dict(name !== undefined ? { _name: name } : {}),
    u32(childId),
    i32(-1),
    i32(layerId),
    u32(1), // numFrames
    dict(frameAttribs)
  ]);
  return chunk('nTRN', content);
}

function nGRPChunk(nodeId, children) {
  const content = Buffer.concat([u32(nodeId), dict({}), u32(children.length), ...children.map(u32)]);
  return chunk('nGRP', content);
}

function nSHPChunk(nodeId, modelId) {
  const content = Buffer.concat([u32(nodeId), dict({}), u32(1), u32(modelId), dict({})]);
  return chunk('nSHP', content);
}

function LAYRChunk(layerId, name) {
  const content = Buffer.concat([u32(layerId), dict({ _name: name }), i32(-1)]);
  return chunk('LAYR', content);
}

/** Builds a multi-model .vox buffer with a scene graph: one SIZE/XYZI pair
 * per entry of `models` (model id = array index), plus whatever raw scene
 * chunk buffers are passed in `sceneChunks` (already-built nTRN/nGRP/nSHP/
 * LAYR chunks, any order - `parseVox` looks nodes up by id, not by scan
 * order, so tests can freely choose id numbering/ordering). */
function buildVoxSceneBuffer(models, sceneChunks) {
  const modelChunks = models.flatMap(({ size, voxels }) => {
    const sizeChunk = chunk('SIZE', Buffer.concat([u32(size[0]), u32(size[1]), u32(size[2])]));
    const xyziContent = Buffer.alloc(4 + voxels.length * 4);
    xyziContent.writeUInt32LE(voxels.length, 0);
    voxels.forEach((v, i) => {
      const off = 4 + i * 4;
      xyziContent[off] = v.x; xyziContent[off + 1] = v.y; xyziContent[off + 2] = v.z; xyziContent[off + 3] = v.c;
    });
    return [sizeChunk, chunk('XYZI', xyziContent)];
  });
  const mainContent = Buffer.concat([...modelChunks, ...sceneChunks]);
  const mainChunk = Buffer.concat([Buffer.from('MAIN', 'ascii'), u32(0), u32(mainContent.length), mainContent]);
  return Buffer.concat([Buffer.from('VOX ', 'ascii'), u32(200), mainChunk]);
}

/** A 2-layer scene: root(0) -> nGRP(1){2,4}; 2=nTRN(layer0,t=0 0 0)->nSHP(3)->model0
 * (a 2x2x2 cube, palette 1); 4=nTRN(layer1,t=5 0 0)->nSHP(5)->model1 (a
 * 1x1x3 stick, palette 2); LAYR 0='body', LAYR 1='arm'. */
function build2LayerFixture() {
  const cubeVoxels = [];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) cubeVoxels.push({ x, y, z, c: 1 });
  const stickVoxels = [{ x: 0, y: 0, z: 0, c: 2 }, { x: 0, y: 0, z: 1, c: 2 }, { x: 0, y: 0, z: 2, c: 2 }];
  const models = [{ size: [2, 2, 2], voxels: cubeVoxels }, { size: [1, 1, 3], voxels: stickVoxels }];
  const sceneChunks = [
    nTRNChunk(0, { childId: 1 }),
    nGRPChunk(1, [2, 4]),
    nTRNChunk(2, { childId: 3, layerId: 0, t: '0 0 0' }),
    nSHPChunk(3, 0),
    nTRNChunk(4, { childId: 5, layerId: 1, t: '5 0 0' }),
    nSHPChunk(5, 1),
    LAYRChunk(0, 'body'),
    LAYRChunk(1, 'arm')
  ];
  return buildVoxSceneBuffer(models, sceneChunks);
}

test('OWN-REQ-005b: 2-layer file -> 2 parts with correct boxes, pivots and parent', () => {
  const buf = build2LayerFixture();
  const parsed = parseVox(buf);
  assert.ok(parsed.scene, 'expected a parsed scene graph');
  assert.strictEqual(parsed.models.length, 2);

  const def = buildVoxelModel(parsed, { 1: 'stone', 2: 'brass' }, 0.05);
  assert.deepStrictEqual(def.size, [7, 2, 3]);
  assert.strictEqual(Object.keys(def.parts).length, 2);

  assert.deepStrictEqual(def.parts.body, { box: [0, 0, 0, 2, 2, 2], pivot: [1, 1, 0] });
  assert.deepStrictEqual(def.parts.arm, { box: [6, 1, 0, 7, 2, 3], pivot: [6.5, 1.5, 0], parent: 'body' });

  const { errors } = validateVoxelModel(def, { materialKeys: ['stone', 'brass'] });
  assert.deepStrictEqual(errors, []);

  const src = formatModule('twopart', def);
  assert.ok(src.includes("parent: 'body'"), src);
});

test('OWN-REQ-005b: --parts off (opts.parts=false) reproduces the single-body-part output', () => {
  const buf = build2LayerFixture();
  const parsed = parseVox(buf);
  const def = buildVoxelModel(parsed, { 1: 'stone' }, 0.05, null, { parts: false });
  // parsed.models[0] is the 2x2x2 cube (model id 0) - the scene graph is
  // ignored entirely by --parts off, same as OWN-REQ-005a on a v150 file.
  assert.deepStrictEqual(def.size, [2, 2, 2]);
  assert.deepStrictEqual(Object.keys(def.parts), ['body']);
  const { errors } = validateVoxelModel(def, { materialKeys: ['stone'] });
  assert.deepStrictEqual(errors, []);
});

test('OWN-REQ-005b: a file with no scene graph at all still defaults to the single body part', () => {
  // A plain v150 fixture (built via buildVoxBuffer, no nTRN/nGRP/nSHP) must
  // still work under the new buildVoxelModel with no opts at all - this is
  // the OWN-REQ-005a regression case (opts.parts defaults true, but there
  // is no `parsed.scene` to use, so it silently falls back).
  const voxels = [{ x: 0, y: 0, z: 0, c: 1 }];
  const buf = buildVoxBuffer([1, 1, 1], voxels);
  const parsed = parseVox(buf);
  assert.strictEqual(parsed.scene, null);
  const def = buildVoxelModel(parsed, { 1: 'stone' }, 0.05);
  assert.deepStrictEqual(Object.keys(def.parts), ['body']);
});

test('OWN-REQ-005b: non-identity rotation is a clear, specific error', () => {
  const cubeVoxels = [{ x: 0, y: 0, z: 0, c: 1 }];
  const models = [{ size: [1, 1, 1], voxels: cubeVoxels }];
  const sceneChunks = [
    nTRNChunk(0, { childId: 1 }),
    nGRPChunk(1, [2]),
    nTRNChunk(2, { childId: 3, layerId: 0, t: '0 0 0', r: 9 }), // 9 != identity (4)
    nSHPChunk(3, 0),
    LAYRChunk(0, 'body')
  ];
  const buf = buildVoxSceneBuffer(models, sceneChunks);
  const parsed = parseVox(buf);
  assert.throws(
    () => buildVoxelModel(parsed, { 1: 'stone' }, 0.05),
    (err) => {
      assert.ok(err.message.includes('rotation'), err.message);
      assert.ok(err.message.includes('not supported'), err.message);
      return true;
    }
  );
});

test('OWN-REQ-005b: overlapping part boxes is a clear error', () => {
  const voxelsA = [{ x: 0, y: 0, z: 0, c: 1 }];
  const voxelsB = [{ x: 0, y: 0, z: 0, c: 2 }];
  const models = [{ size: [1, 1, 1], voxels: voxelsA }, { size: [1, 1, 1], voxels: voxelsB }];
  const sceneChunks = [
    nTRNChunk(0, { childId: 1 }),
    nGRPChunk(1, [2, 4]),
    nTRNChunk(2, { childId: 3, layerId: 0, t: '0 0 0' }),
    nSHPChunk(3, 0),
    nTRNChunk(4, { childId: 5, layerId: 1, t: '0 0 0' }), // same world cell as layer 0 - forces an overlap
    nSHPChunk(5, 1),
    LAYRChunk(0, 'a'),
    LAYRChunk(1, 'b')
  ];
  const buf = buildVoxSceneBuffer(models, sceneChunks);
  const parsed = parseVox(buf);
  assert.throws(
    () => buildVoxelModel(parsed, { 1: 'stone', 2: 'brass' }, 0.05),
    (err) => {
      assert.ok(err.message.includes('overlaps'), err.message);
      return true;
    }
  );
});

test('OWN-REQ-005b: more than 8 named layers is a clear error', () => {
  const models = [];
  const sceneChunks = [nTRNChunk(0, { childId: 1 }), nGRPChunk(1, [])];
  const children = [];
  for (let i = 0; i < 9; i++) {
    const trnId = 2 + i * 2;
    const shpId = trnId + 1;
    models.push({ size: [1, 1, 1], voxels: [{ x: 0, y: 0, z: 0, c: 1 }] });
    sceneChunks.push(nTRNChunk(trnId, { childId: shpId, layerId: i, t: `${i * 2} 0 0` }));
    sceneChunks.push(nSHPChunk(shpId, i));
    sceneChunks.push(LAYRChunk(i, `layer${i}`));
    children.push(trnId);
  }
  // Patch the group's child list (built above with an empty list) by
  // rebuilding it now that we know the child ids.
  sceneChunks[1] = nGRPChunk(1, children);
  const buf = buildVoxSceneBuffer(models, sceneChunks);
  const parsed = parseVox(buf);
  assert.throws(
    () => buildVoxelModel(parsed, { 1: 'stone' }, 0.05),
    (err) => {
      assert.ok(err.message.includes('9 parts'), err.message);
      assert.ok(err.message.includes('8'), err.message);
      return true;
    }
  );
});

test('OWN-REQ-005b: fallback to top-level group naming when the file has no named layers', () => {
  const cubeVoxels = [{ x: 0, y: 0, z: 0, c: 1 }];
  const stickVoxels = [{ x: 0, y: 0, z: 0, c: 2 }];
  const models = [{ size: [1, 1, 1], voxels: cubeVoxels }, { size: [1, 1, 1], voxels: stickVoxels }];
  const sceneChunks = [
    nTRNChunk(0, { childId: 1 }),
    nGRPChunk(1, [2, 4]),
    nTRNChunk(2, { childId: 3, t: '0 0 0', name: 'wing_L' }), // layerId omitted -> -1, no LAYR chunks at all
    nSHPChunk(3, 0),
    nTRNChunk(4, { childId: 5, t: '3 0 0', name: 'wing_R' }),
    nSHPChunk(5, 1)
  ];
  const buf = buildVoxSceneBuffer(models, sceneChunks);
  const parsed = parseVox(buf);
  const def = buildVoxelModel(parsed, { 1: 'stone', 2: 'brass' }, 0.05);
  assert.deepStrictEqual(Object.keys(def.parts), ['wing_L', 'wing_R']);
  const { errors } = validateVoxelModel(def, { materialKeys: ['stone', 'brass'] });
  assert.deepStrictEqual(errors, []);
});

console.log(`\n${passed} test(s) passed`);
if (process.exitCode) {
  console.error('SOME TESTS FAILED');
}
