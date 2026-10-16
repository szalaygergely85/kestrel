// 38.82 CELL-AA mechanism A (AA-03a, OB-198): coverage-weighted colour, JS twin.
// Run: node engine/render/coverageColour.test.js
import assert from 'node:assert/strict';
import { bindShading, bindLevel } from './MaterialTable.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import paletteModule from '../../design/palette.js';
import detailPassModule from '../../design/detail-pass.js';
import { loadLevel } from '../world/Level.js';
import { shadeDetailFast, matFlatColor } from './detailShade.js';

const palette = paletteModule.default || paletteModule;
const detailPass = detailPassModule.default || detailPassModule;
const { bundle } = await loadTestAssets();
const table = bindShading(palette, detailPass, 16 / 9);
bindLevel(table, loadLevel(bundle.levels.test_room));

const ids = [];
for (let i = 1; i < table.records.length && ids.length < 12; i++) if (table.records[i] && table.records[i].v2) ids.push(i);
assert.ok(ids.length >= 2, 'need two v2 materials');
// pick two materials whose flat colours differ clearly
const light = [0.8, 0.75, 0.7], face = 2, kind = 2;
const fa = [0, 0, 0], ba = [0, 0, 0], fb = [0, 0, 0], bb = [0, 0, 0];
let A = ids[0], B = ids[1], best = -1;
for (const a of ids) for (const b of ids) {
  matFlatColor(table, table.records[a].v2, face, kind, light, fa, ba); matFlatColor(table, table.records[b].v2, face, kind, light, fb, bb);
  const d = Math.abs(fa[0] - fb[0]) + Math.abs(fa[1] - fb[1]) + Math.abs(fa[2] - fb[2]);
  if (d > best) { best = d; A = a; B = b; }
}
assert.ok(best > 20, `materials differ (${best})`);
const recA = table.records[A].v2, recB = table.records[B].v2;

const gbuf = { u: [1.3], v: [0.7], z: [1], face: [face], kind: [kind], aoD: [1e30], dudx: [0.02], dvdx: [0], dudy: [0], dvdy: [0.02] };
const mk = () => ({ glyphIdx: 0, fg: [0, 0, 0], bg: [0, 0, 0], f: 0, onJoint: false });
const dist = 0.5; // inside fog start: f = 0
const base = shadeDetailFast(table, recA, 0, gbuf, dist, light, mk());
assert.equal(base.f, 0, 'fixture is fog free');

// 9/16 winner + 7/16 minority
const minor = { count: 7, nTotal: 16, recs: Array(8).fill(recB), faces: Array(8).fill(face), kinds: Array(8).fill(kind) };
const mixed = shadeDetailFast(table, recA, 0, gbuf, dist, light, mk(), minor);
matFlatColor(table, recB, face, kind, light, fb, bb);
for (let c = 0; c < 3; c++) {
  assert.ok(Math.abs(mixed.fg[c] - (0.5625 * base.fg[c] + 0.4375 * fb[c])) <= 1, `fg[${c}]`);
  assert.ok(Math.abs(mixed.bg[c] - (0.5625 * base.bg[c] + 0.4375 * bb[c])) <= 1, `bg[${c}]`);
}
assert.equal(mixed.glyphIdx, base.glyphIdx, 'glyph stays the winner\'s');
// per-step change is bounded by 1/16 of the colour gap
const m8 = shadeDetailFast(table, recA, 0, gbuf, dist, light, mk(), { ...minor, count: 8 });
for (let c = 0; c < 3; c++) assert.ok(Math.abs(m8.fg[c] - mixed.fg[c]) <= Math.abs(base.fg[c] - fb[c]) / 16 + 1, 'one sample moves <= 1/16');

// n = 1 / single-key cell / count 0: byte-identical to the old path
for (const mn of [undefined, { ...minor, count: 0 }, { ...minor, nTotal: 1 }]) {
  const o = shadeDetailFast(table, recA, 0, gbuf, dist, light, mk(), mn);
  assert.deepEqual([o.glyphIdx, ...o.fg, ...o.bg, o.f], [base.glyphIdx, ...base.fg, ...base.bg, base.f]);
}

// fog: at f = 1 the minority colour is the fog colour, mix == winner
const far = table.fog.full + 1;
const baseF = shadeDetailFast(table, recA, 0, gbuf, far, light, mk());
const mixF = shadeDetailFast(table, recA, 0, gbuf, far, light, mk(), minor);
for (let c = 0; c < 3; c++) assert.ok(Math.abs(mixF.fg[c] - baseF.fg[c]) <= 1, 'fully fogged: no tint');

// zero allocation per call (matFlatColor + mix reuse module scratch)
const o = mk(); for (let i = 0; i < 2000; i++) shadeDetailFast(table, recA, 0, gbuf, dist, light, o, minor);
if (global.gc) { global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 20000; i++) matFlatColor(table, recB, face, kind, light, fb, bb); const grew = process.memoryUsage().heapUsed - h0; assert.ok(grew < 200000, `matFlatColor alloc ${grew}`); }
console.log('coverageColour OK');
