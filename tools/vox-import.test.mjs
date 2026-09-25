// Tests for tools/vox-import.mjs (OWN-REQ-005a). Plain Node script, no
// framework (matches engine/physics/physics.test.js etc.) - run directly:
//   node tools/vox-import.test.mjs
//
// Every .vox fixture is built IN MEMORY by buildVoxBuffer() below (no
// binary .vox file is committed to the repo).

import assert from 'node:assert';
import { parseVox, buildVoxelModel, formatModule } from './vox-import.mjs';
import { validateVoxelModel } from '../engine/index.js';

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

console.log(`\n${passed} test(s) passed`);
if (process.exitCode) {
  console.error('SOME TESTS FAILED');
}
