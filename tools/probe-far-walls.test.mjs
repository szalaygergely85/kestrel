// Pure-function tests for tools/probe-far-walls.mjs (no browser).
import assert from 'node:assert/strict';
import { channelStats, histogram, summarizeBox, extractBox } from './probe-far-walls.mjs';

assert.deepEqual(channelStats([]), { n: 0, min: null, mean: null, max: null, std: null });
const s = channelStats([2, 4, 6]);
assert.equal(s.min, 2); assert.equal(s.max, 6); assert.equal(s.mean, 4); assert.ok(Math.abs(s.std - Math.sqrt(8 / 3)) < 1e-12);
assert.deepEqual(histogram([3, 3, 1, 2, 2, 2], 2), [[2, 3], [3, 2]]);

const cell = (fg, depth = 50, kind = 8) => ({ kind, mat: 5, depth, L: [0.5, 0.5, 0.5], sunlit: 1, litCount: 2, shadeFg: [...fg, 65], fg: [...fg, 65], bg: [0, 0, 0, 255] });
const flat = summarizeBox([cell([100, 100, 100]), cell([102, 100, 98]), cell([100, 101, 99])]);
assert.equal(flat.cells, 3); assert.equal(flat.geometryCells, 3); assert.equal(flat.depth.mean, 50);
assert.equal(flat.flatGrey.grey, true); assert.equal(flat.flatGrey.distinctGlyphs, 1);
const rich = summarizeBox([cell([200, 120, 40]), cell([20, 60, 160]), cell([90, 140, 30])]);
assert.equal(rich.flatGrey.grey, false);
const sky = summarizeBox([cell([10, 10, 10], Infinity, 0), cell([10, 10, 10])]);
assert.equal(sky.skyCells, 1); assert.equal(sky.geometryCells, 1);

// extractBox: 4x2 grid, box = x1..2, y1 -> two cells; depth f32 bits of 12.5, light 0.25.
const f = new Float32Array(1), u = new Uint32Array(f.buffer), bits = (v) => { f[0] = v; return u[0]; };
const cols = 4, n = 8, GI = new Uint32Array(n * 4), Depth = new Uint32Array(n * 4), Light = new Uint32Array(n * 4), Sh = new Uint8Array(n * 4), fg = new Uint8Array(n * 4), bg = new Uint8Array(n * 4);
for (const i of [5, 6]) { GI[i * 4 + 1] = (7 << 16) | 8; Depth[i * 4] = bits(12.5); Light[i * 4] = bits(0.25); Light[i * 4 + 3] = 1 | (3 << 8); fg.set([1, 2, 3, 4], i * 4); }
const cs = extractBox({ cols, box: { x: 1, y: 1, w: 2, h: 1 }, GI, Depth, Light, ShadeFg: Sh, fg, bg });
assert.equal(cs.length, 2); assert.equal(cs[0].mat, 7); assert.equal(cs[0].kind, 8); assert.equal(cs[0].depth, 12.5);
assert.equal(cs[0].L[0], 0.25); assert.equal(cs[0].sunlit, 1); assert.equal(cs[0].litCount, 3); assert.deepEqual(cs[1].fg, [1, 2, 3, 4]);
console.log('probe-far-walls: stats / histogram / summarizeBox / extractBox PASS');
