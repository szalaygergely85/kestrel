// Tests for tools/voxParse.js (OWN-REQ-011). Plain Node script, no
// framework (matches tools/vox-import.test.mjs's own style) - run directly:
//   node tools/voxParse.test.mjs
//
// tools/vox-import.test.mjs already exercises the full parsing/building
// surface via tools/vox-import.mjs's re-exports (unchanged after the
// OWN-REQ-011 extraction - see that file). This suite instead focuses on
// what's NEW here: that voxParse.js's `parseVox` is genuinely portable
// (accepts a plain ArrayBuffer/Uint8Array, not just a Node Buffer - the
// whole point of the extraction), and the new `usedPaletteEntries` helper
// the editor's auto color-mapping (OWN-REQ-011) is built on.

import assert from 'node:assert';
import { parseVox, buildVoxelModel, usedPaletteEntries } from './voxParse.js';

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

// ---- .vox buffer builder (RIFF 'VOX ' v150) - same layout as
// tools/vox-import.test.mjs's own builder, kept minimal here. --------------

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function chunk(id, content) {
  return Buffer.concat([Buffer.from(id, 'ascii'), u32(content.length), u32(0), content]);
}

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

  const children = [sizeChunk, xyziChunk];
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

const palette = new Array(256).fill([0, 0, 0, 255]);
palette[0] = [200, 30, 30, 255]; // index 1
palette[4] = [30, 200, 30, 255]; // index 5

const voxels = [
  { x: 0, y: 0, z: 0, c: 1 },
  { x: 1, y: 0, z: 0, c: 5 },
];
const buf = buildVoxBuffer([2, 1, 1], voxels, { palette });

test('parseVox accepts a Node Buffer (the CLI\'s own input type)', () => {
  const parsed = parseVox(buf);
  assert.deepStrictEqual(parsed.size, [2, 1, 1]);
  assert.strictEqual(parsed.voxels.length, 2);
});

test('parseVox accepts a plain Uint8Array (no Buffer-specific APIs used)', () => {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const parsed = parseVox(bytes);
  assert.deepStrictEqual(parsed.size, [2, 1, 1]);
  assert.strictEqual(parsed.palette[0][0], 200);
});

test('parseVox accepts a raw ArrayBuffer (what File.arrayBuffer() returns in the browser)', () => {
  // Copy into a fresh, exactly-sized ArrayBuffer (File.arrayBuffer()'s own
  // contract - never a Node pooled-buffer slice) to prove offset/length
  // handling is not accidentally relying on Buffer's own bookkeeping.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = parseVox(ab);
  assert.deepStrictEqual(parsed.size, [2, 1, 1]);
  assert.strictEqual(parsed.voxels[1].c, 5);
});

test('parseVox rejects a non-buffer input with a clear error', () => {
  assert.throws(() => parseVox('not a buffer'), /expected a Buffer, Uint8Array, or ArrayBuffer/);
});

test('usedPaletteEntries: distinct indices in ascending order, each with its RGBA', () => {
  const parsed = parseVox(buf);
  const entries = usedPaletteEntries(parsed.voxels, parsed.palette);
  assert.deepStrictEqual(entries, [
    { index: 1, rgba: [200, 30, 30, 255] },
    { index: 5, rgba: [30, 200, 30, 255] },
  ]);
});

test('usedPaletteEntries: null rgba when the file has no RGBA chunk', () => {
  const noRgbaBuf = buildVoxBuffer([1, 1, 1], [{ x: 0, y: 0, z: 0, c: 3 }]);
  const parsed = parseVox(noRgbaBuf);
  const entries = usedPaletteEntries(parsed.voxels, parsed.palette);
  assert.deepStrictEqual(entries, [{ index: 3, rgba: null }]);
});

test('buildVoxelModel (single-part path) round-trips through the portable parser', () => {
  const parsed = parseVox(buf);
  const map = { '1': 'stone', '5': 'moss' };
  const def = buildVoxelModel(parsed, map, 0.05, null, { parts: false });
  assert.strictEqual(def.cellM, 0.05);
  assert.deepStrictEqual(def.size, [2, 1, 1]);
  assert.deepStrictEqual(Object.keys(def.parts), ['body']);
  const mats = def.mats;
  const chStone = Object.keys(mats).find((k) => mats[k] === 'stone');
  const chMoss = Object.keys(mats).find((k) => mats[k] === 'moss');
  assert.strictEqual(def.layers[0][0][0], chStone);
  assert.strictEqual(def.layers[0][0][1], chMoss);
});

console.log(`\n${passed} test(s) passed`);
