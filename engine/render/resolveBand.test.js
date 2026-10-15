// RTX-RAYS-BAND-01 (38.79): pure JS twin rules. node engine/render/resolveBand.test.js
import assert from 'node:assert/strict';
import { RG4, bayer4, bandThreshold, resolveCellJS, RESOLVE_BAND_WGSL } from './resolveBand.js';

const MAT = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.equal(bayer4(x, y), MAT[y][x], `bayer ${x},${y}`);
assert.deepEqual(RG4.map((p) => [p.i, p.j]), [[1, 0], [3, 1], [0, 2], [2, 3]]);
assert.equal(new Set(RG4.map((p) => p.i)).size, 4); assert.equal(new Set(RG4.map((p) => p.j)).size, 4); // every row/column once
assert.ok(Object.isFrozen(RG4) && Object.isFrozen(RG4[0]));
assert.ok(/rg4i/.test(RESOLVE_BAND_WGSL) && !/%/.test(RESOLVE_BAND_WGSL));

// seam dither: +-7.5 % of bandM, all 16 Bayer values hit, mean ~ bandM
let lo = Infinity, hi = -Infinity, sum = 0;
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const t = bandThreshold(40, x, y); lo = Math.min(lo, t); hi = Math.max(hi, t); sum += t; }
assert.ok(Math.abs(lo - 40 * 0.925) < 1e-4 && Math.abs(hi - 40 * 1.075) < 1e-4, `dither range ${lo}..${hi}`);
assert.ok(Math.abs(sum / 16 - 40) < 0.2);
assert.equal(bandThreshold(40, 5, 9), bandThreshold(40, 1, 1), 'depends on cell & 3 only');

const mk = () => ({ pid: new Int32Array(16), kind: new Uint32Array(16).fill(1), mat: new Uint32Array(16), depth: new Float32Array(16).fill(100) });
const out = { idx: -1, cov: -1, far: false };
const rg4idx = RG4.map((p) => p.j * 4 + p.i);

// far cell, uniform: RG4 sample nearest the centre wins (ties -> smallest RG4 index), cov = 7
{ const s = mk(); resolveCellJS(s, 4, 40, 0, 0, out); assert.equal(out.far, true); assert.ok(rg4idx.includes(out.idx)); assert.equal(out.cov, 7); }
// near cell (dMin below every threshold): full vote, same as bandM 0
{ const s = mk(); s.depth.fill(10); for (let c = 0; c < 16; c++) { s.pid[c] = c % 3; s.depth[c] = 10 + c * 0.01; }
  const a = { ...resolveCellJS(s, 4, 40, 1, 2, { idx: 0, cov: 0, far: false }) }, b = { ...resolveCellJS(s, 4, 0, 1, 2, { idx: 0, cov: 0, far: false }) };
  assert.equal(a.far, false); assert.deepEqual(a, b); }
// n < 4 ignores bandM
for (const n of [1, 2, 3]) { const s = mk(); const a = { ...resolveCellJS(s, n, 40, 0, 0, { idx: 0, cov: 0, far: false }) }, b = { ...resolveCellJS(s, n, 0, 0, 0, { idx: 0, cov: 0, far: false }) }; assert.equal(a.far, false); assert.deepEqual(a, b); }
// seam: a cell at depth between 0.925 and 1.075 x bandM is far for some Bayer cells and near for others
{ let far = 0; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const s = mk(); s.depth.fill(40); resolveCellJS(s, 4, 40, x, y, out); if (out.far) far++; } assert.ok(far > 0 && far < 16, `seam dithered (${far}/16 far)`); }
// vote over RG4 only: non-RG4 samples cannot win; 3 vs 1 -> cov = 3*8/4-1 = 5; 2/2 tie -> smaller min depth
{ const s = mk(); for (let c = 0; c < 16; c++) s.pid[c] = 9; for (const c of rg4idx.slice(0, 3)) s.pid[c] = 1; resolveCellJS(s, 4, 40, 0, 0, out);
  assert.equal(s.pid[out.idx], 1); assert.equal(out.cov, 5); }
{ const s = mk(); s.pid[rg4idx[0]] = 1; s.pid[rg4idx[1]] = 1; s.pid[rg4idx[2]] = 2; s.pid[rg4idx[3]] = 2; s.depth[rg4idx[2]] = 90; s.depth[rg4idx[3]] = 95;
  for (let c = 0; c < 16; c++) if (!rg4idx.includes(c)) s.pid[c] = 2;
  resolveCellJS(s, 4, 40, 0, 0, out); assert.equal(s.pid[out.idx], 2, 'tie -> smaller min depth'); assert.equal(out.cov, 3); }
// sky samples do not count towards dMin (a sky-dominated cell with a near hit stays near only if the hit is RG4)
{ const s = mk(); s.kind.fill(0); resolveCellJS(s, 4, 40, 0, 0, out); assert.equal(out.far, true); }
console.log('resolveBand.test.js: bayer, RG4, dither +-7.5 %, near/far rules, n<4 passthrough passed.');
