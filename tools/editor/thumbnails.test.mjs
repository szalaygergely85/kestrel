// tools/editor/thumbnails.test.mjs - US-067. Plain Node ESM, no DOM (pure
// content-shape math - `buildSpriteThumbnail`/`buildVoxelThumbnail` take a
// bare palette/model fixture, same split as panel.js/livepatch.js).
import {
  THUMB_MAX_W, THUMB_MAX_H, defaultClip, buildSpriteThumbnail, buildVoxelThumbnail,
  buildModelThumbnail, getModelThumbnail,
} from './thumbnails.js';

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; } else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// ---- defaultClip -------------------------------------------------------------
{
  ok('defaultClip: null for a model with no animations', defaultClip({}) === null);
  const m1 = { animations: { unlit: { frames: [1] }, lit: { frames: [2] } } };
  ok('defaultClip: falls back to the first declared animation when there is no "idle"', defaultClip(m1) === m1.animations.unlit);
  const m2 = { animations: { lit: { frames: [2] }, idle: { frames: [3] } } };
  ok('defaultClip: prefers a literal "idle" regardless of declaration order', defaultClip(m2) === m2.animations.idle);
}

// ---- buildSpriteThumbnail: deterministic output for one sprite fixture -----
{
  const palette = { colors: { red: '#ff0000', blue: '#0000ff' } };
  const model = {
    keys: { a: { c: 'red' }, b: { c: 'blue' } },
    animations: { idle: { frames: [{ S: { glyphs: ['ab', 'ba'], fg: ['ab', 'ba'] } }] } },
  };
  const thumb = buildSpriteThumbnail(palette, model);
  const expected = {
    w: 2, h: 2,
    cells: [
      { ch: 'a', fg: '#ff0000' }, { ch: 'b', fg: '#0000ff' },
      { ch: 'b', fg: '#0000ff' }, { ch: 'a', fg: '#ff0000' },
    ],
  };
  ok('buildSpriteThumbnail: deterministic output for a small fixture', JSON.stringify(thumb) === JSON.stringify(expected), JSON.stringify(thumb));

  // A blank glyph (space) or an fg char with no `keys` entry -> a transparent cell.
  const model2 = {
    keys: { a: { c: 'red' } },
    animations: { idle: { frames: [{ S: { glyphs: [' a'], fg: [' a'] } }] } },
  };
  const thumb2 = buildSpriteThumbnail(palette, model2);
  ok('buildSpriteThumbnail: a blank glyph is a transparent cell (fg: null)', thumb2.cells[0].fg === null && thumb2.cells[0].ch === ' ');
  ok('buildSpriteThumbnail: a coloured glyph resolves through model.keys', thumb2.cells[1].fg === '#ff0000');
}

// ---- buildSpriteThumbnail: the 16x8 size cap is enforced -------------------
{
  const wideRow = 'x'.repeat(20);
  const glyphs = new Array(10).fill(wideRow);
  const fg = new Array(10).fill('a'.repeat(20));
  const model = { keys: { a: { c: 'red' } }, animations: { idle: { frames: [{ S: { glyphs, fg } }] } } };
  const thumb = buildSpriteThumbnail({ colors: { red: '#ff0000' } }, model);
  ok('buildSpriteThumbnail: width capped at 16', thumb.w === THUMB_MAX_W, String(thumb.w));
  ok('buildSpriteThumbnail: height capped at 8', thumb.h === THUMB_MAX_H, String(thumb.h));
  ok('buildSpriteThumbnail: cells array matches w*h', thumb.cells.length === THUMB_MAX_W * THUMB_MAX_H);
}

// ---- buildVoxelThumbnail: deterministic output for one voxel fixture ------
{
  const palette = {
    colors: { stoneColor: '#123456' },
    materials: { stoneish: { base: 'stoneColor', ramp: 'test', albedo: 1 } },
    ramps: { test: ' .#' },
  };
  // size [sx=2, sy=1, sz=2]: layers[z][y] - a diagonal pattern (front y=0 only).
  const model = { voxel: { size: [2, 1, 2], mats: { X: 'stoneish' }, layers: [['X.'], ['.X']] } };
  const thumb = buildVoxelThumbnail(palette, model);
  // image row 0 = top = z=1 ('.X'); row 1 = bottom = z=0 ('X.').
  const expected = {
    w: 2, h: 2,
    cells: [
      { ch: ' ', fg: null }, { ch: '#', fg: '#123456' },
      { ch: '#', fg: '#123456' }, { ch: ' ', fg: null },
    ],
  };
  ok('buildVoxelThumbnail: deterministic front-orthographic output for a small fixture', JSON.stringify(thumb) === JSON.stringify(expected), JSON.stringify(thumb));
}

// ---- buildVoxelThumbnail: the 16x8 size cap is enforced --------------------
{
  const palette = { colors: { c: '#ffffff' }, materials: { m: { base: 'c', ramp: 'nope', albedo: 0.5 } } };
  const sx = 20, sz = 10;
  const layers = [];
  for (let z = 0; z < sz; z++) layers.push(['M'.repeat(sx)]);
  const model = { voxel: { size: [sx, 1, sz], mats: { M: 'm' }, layers } };
  const thumb = buildVoxelThumbnail(palette, model);
  ok('buildVoxelThumbnail: width capped at 16', thumb.w === THUMB_MAX_W, String(thumb.w));
  ok('buildVoxelThumbnail: height capped at 8', thumb.h === THUMB_MAX_H, String(thumb.h));
}

// ---- buildVoxelThumbnail: an empty column/row (no solid voxel) is blank ----
{
  const palette = { colors: { c: '#ffffff' }, materials: { m: { base: 'c', ramp: 'r', albedo: 1 } }, ramps: { r: ' .#' } };
  const model = { voxel: { size: [1, 1, 1], mats: { M: 'm' }, layers: [['.']] } };
  const thumb = buildVoxelThumbnail(palette, model);
  ok('buildVoxelThumbnail: no solid voxel anywhere -> a blank thumbnail', thumb.cells[0].ch === ' ' && thumb.cells[0].fg === null);
}

// ---- buildModelThumbnail: dispatches by shape -------------------------------
{
  const palette = { colors: { red: '#ff0000' } };
  const sprite = { keys: { a: { c: 'red' } }, animations: { idle: { frames: [{ S: { glyphs: ['a'], fg: ['a'] } }] } } };
  ok('buildModelThumbnail: a model with no .voxel uses the sprite builder',
    JSON.stringify(buildModelThumbnail(palette, sprite)) === JSON.stringify(buildSpriteThumbnail(palette, sprite)));

  const voxelPalette = { colors: { c: '#fff' }, materials: { m: { base: 'c', ramp: 'r', albedo: 1 } }, ramps: { r: ' .#' } };
  const voxel = { voxel: { size: [1, 1, 1], mats: { M: 'm' }, layers: [['M']] } };
  ok('buildModelThumbnail: a model with .voxel uses the voxel builder',
    JSON.stringify(buildModelThumbnail(voxelPalette, voxel)) === JSON.stringify(buildVoxelThumbnail(voxelPalette, voxel)));
}

// ---- getModelThumbnail: built once and cached ------------------------------
{
  let calls = 0;
  const palette = { colors: { red: '#ff0000' } };
  const model = { keys: { a: { c: 'red' } }, animations: { idle: { frames: [{ S: { glyphs: ['a'], fg: ['a'] } }] } } };
  const assets = { palette, model(k) { calls++; return model; } };
  const t1 = getModelThumbnail(assets, 'lantern');
  const t2 = getModelThumbnail(assets, 'lantern');
  ok('getModelThumbnail: caches - assets.model() is only called once per key', calls === 1, String(calls));
  ok('getModelThumbnail: returns the same (cached) result', t1 === t2);

  const assets2 = { palette, model(k) { return model; } };
  const t3 = getModelThumbnail(assets2, 'lantern');
  ok('getModelThumbnail: cache is keyed per-registry (a different assets object is not affected)', t3 !== t1 && JSON.stringify(t3) === JSON.stringify(t1));
}

console.log(`thumbnails.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
