// Tests for tools/voxAutoMap.mjs (OWN-REQ-011). Plain Node script, no
// framework - run directly:
//   node tools/voxAutoMap.test.mjs
//
// Uses a small hand-built palette-shaped fixture (never imports
// design/palette.js as an ES module - design/**/*.js must stay import/
// export-free classic scripts, check-deps rule 4; the real editor passes
// `window.ASSETS.palette` through as a plain object, same shape as here).

import assert from 'node:assert';
import { hexToRgb, nearestMaterialKey, autoMapColors } from './voxAutoMap.mjs';

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

const fixturePalette = {
  colors: {
    stoneMid: '#8a7f6e',
    mossDark: '#3b5226',
    ironLight: '#9aa0a8',
    scorch: '#2a211c',
  },
  materials: {
    stone: { base: 'stoneMid' },
    moss: { base: 'mossDark' },
    iron: { base: 'ironLight' },
    // no `base` at all - must be skipped, not crash the search.
    broken: {},
    // `base` names a color the palette doesn't have - also must be skipped.
    dangling: { base: 'nonexistent_color' },
  },
};

test('hexToRgb parses a #rrggbb string', () => {
  assert.deepStrictEqual(hexToRgb('#8a7f6e'), [0x8a, 0x7f, 0x6e]);
});

test('hexToRgb rejects a non-hex-color value', () => {
  assert.strictEqual(hexToRgb('not-a-color'), null);
  assert.strictEqual(hexToRgb(undefined), null);
});

test('nearestMaterialKey: an exact color match wins', () => {
  assert.strictEqual(nearestMaterialKey([0x8a, 0x7f, 0x6e], fixturePalette), 'stone');
});

test('nearestMaterialKey: the closest color wins, not the first material', () => {
  // Close to mossDark (#3b5226), far from every other material's base.
  assert.strictEqual(nearestMaterialKey([0x40, 0x55, 0x28], fixturePalette), 'moss');
});

test('nearestMaterialKey: materials with no resolvable base color are skipped, not crashed on', () => {
  assert.strictEqual(nearestMaterialKey([0x9a, 0xa0, 0xa8], fixturePalette), 'iron');
});

test('nearestMaterialKey: null when the palette has no matchable materials at all', () => {
  assert.strictEqual(nearestMaterialKey([1, 2, 3], { colors: {}, materials: {} }), null);
});

test('autoMapColors: builds a map.json-shaped object keyed by decimal-string palette index', () => {
  const used = [
    { index: 1, rgba: [0x8a, 0x7f, 0x6e, 255] }, // -> stone
    { index: 7, rgba: [0x3b, 0x52, 0x26, 255] }, // -> moss
  ];
  assert.deepStrictEqual(autoMapColors(used, fixturePalette), { '1': 'stone', '7': 'moss' });
});

test('autoMapColors: throws a clear error when a used color has no RGBA (no RGBA chunk in the file)', () => {
  assert.throws(
    () => autoMapColors([{ index: 2, rgba: null }], fixturePalette),
    /no RGBA color/
  );
});

test('autoMapColors: throws a clear error when the palette has nothing to match against', () => {
  assert.throws(
    () => autoMapColors([{ index: 2, rgba: [1, 2, 3, 255] }], { colors: {}, materials: {} }),
    /no materials with a resolvable base color/
  );
});

console.log(`\n${passed} test(s) passed`);
