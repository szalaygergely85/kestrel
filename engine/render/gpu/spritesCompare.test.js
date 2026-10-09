// SPRITECOMPARE-WG-01 gate scope: with frameGate:false the whole-frame glyph/colour % are informational, but
// poisonedSurvivors === 0 (cells the GPU never wrote) must still be required; plus frameGate:true unchanged.
import assert from 'node:assert/strict';
import { runSpriteCompare } from './spritesCompare.js';

const COLS = 8, ROWS = 4, N = COLS * ROWS;
function harness() {
  const cells = { cols: COLS, rows: ROWS, fg: new Uint8Array(N * 4), bg: new Uint8Array(N * 4), mask: new Uint8Array(N) };
  const fb = { rt: { cells, gpuActive: false }, gbuf: { kind: new Uint8Array(N).fill(1) }, depth: { depth: new Float32Array(N) } };
  const pool = { count: 0, atlas: { data: new Uint8Array(4), width: 1, pal: new Uint8Array(4) }, spr: new Float32Array(0), reset() {}, project() {} };
  const renderCpu = () => { for (let i = 0; i < N; i++) { cells.fg.set([100, 100, 100, 60], i * 4); cells.bg.set([10, 10, 10, 255], i * 4); } };
  return { cells, fb, pool, renderCpu, poses: [{ name: 'p', x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 }], placeSprites() {}, light: [1, 1, 1] };
}
const gpuOf = (glyph, rgb) => () => {
  const fg = new Uint8Array(N * 4), bg = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) { fg.set([rgb, rgb, rgb, glyph], i * 4); bg.set([rgb, rgb, rgb, 255], i * 4); }
  return Promise.resolve({ fg, bg });
};

{ // GPU shades everything differently (whole frame mismatch), nothing poisoned
  const h = harness();
  const mk = (frameGate) => runSpriteCompare({ ...h, renderGpu: gpuOf(61, 140), frameGate });
  const gated = await mk(true), info = await mk(false);
  assert.ok(!gated.ok, 'frameGate:true fails on the frame mismatch');
  assert.ok(info.ok && info.rows[0].poisonedSurvivors === 0 && info.rows[0].glyphMatchPct < 99, 'frameGate:false: frame % informational only');
}
{ // GPU never wrote the cells: the poison signature (glyph 255, rgb 0) survives -> FAIL even with frameGate:false
  const h = harness();
  const r = await runSpriteCompare({ ...h, renderGpu: gpuOf(255, 0), frameGate: false });
  assert.ok(r.rows[0].poisonedSurvivors > 0 && !r.ok && !r.rows[0].ok, 'poisonedSurvivors > 0 fails the row when frameGate is false');
}
console.log('spritesCompare.test.js: all checks passed.');
