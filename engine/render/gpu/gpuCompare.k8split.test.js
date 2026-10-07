// node engine/render/gpu/gpuCompare.k8split.test.js  (ME-08b 8a counters)
import { compareGeometry, compareCells } from './gpuCompare.js';

let failures = 0;
const check = (name, cond) => { if (!cond) { console.error('FAIL:', name); failures++; } };
const f2u = (f) => new Uint32Array(new Float32Array([f]).buffer)[0];

// 3x3 all one kind, non-edge centre cell (4) carries a u violation.
function geom(kindVal) {
  const cols = 3, rows = 3, n = 9;
  const gbuf = { kind: new Uint8Array(n).fill(kindVal), mat: new Uint16Array(n), planeId: new Int32Array(n), u: new Float32Array(n), v: new Float32Array(n) };
  const depth = new Float32Array(n).fill(5);
  const gi = new Uint32Array(n * 4), ga = new Uint32Array(n * 4), db = new Uint32Array(n * 4);
  for (let i = 0; i < n; i++) { gi[i * 4 + 1] = kindVal; db[i * 4] = f2u(5); }
  ga[4 * 4] = f2u(1); // gpu u = 1 vs cpu 0 -> uvViol at cell 4
  db[4 * 4] = f2u(9); // depth 9 vs 5 -> depthViol on the same cell
  ga[4 * 4 + 2] = f2u(50); // z off -> zViol, same cell
  gbuf.z = new Float32Array(n);
  return compareGeometry(gbuf, depth, gi, ga, db, cols, rows);
}
const g8 = geom(8), g1 = geom(1), g9 = geom(9), g7 = geom(7);
check('one cell, 3 fields -> geomViolCells 1', g1.depthViol + g1.uvViol + g1.zViol === 3 && g1.geomViolCells === 1 && g8.geomViolCells === 1);
check('k8 violation counted, not non-k8', g8.uvViol === 1 && g8.violNonK8 === 0);
check('non-k8 violation counted', g1.uvViol === 1 && g1.violNonK8 === 1);
check('kind-9 violation not counted as non-k8 (A2)', g9.uvViol === 1 && g9.geomViolCells === 1 && g9.violNonK8 === 0);
check('kind-7 violation still non-k8', g7.violNonK8 === 1);

// compareCells: 2 cells, one kind 8 with big fg delta, one kind 1 clean.
const kind = new Uint8Array([8, 1]);
const mk = () => new Uint8Array(8).fill(100);
const jsFg = mk(), jsBg = mk(), gFg = mk(), gBg = mk();
gFg[0] = 250; // k8 outlier, delta 150
const c = compareCells(jsFg, jsBg, gFg, gBg, kind, 2, 1, undefined, undefined, 0.6, 96, true);
check('k8Outside', c.k8Outside === 1 && c.cellsOutside === 1);
check('non-k8 fgMax excludes k8', c.fgMax === 150 && c.fgMaxNonK8 === 0);
check('k8NoCap passes', c.pass === true);
const c2 = compareCells(jsFg, jsBg, gFg, gBg, kind, 2, 1, undefined, undefined, 0.6, 96, false);
check('default cap still fails', c2.pass === false);
gFg[4] = 250; // non-k8 outlier now
const c3 = compareCells(jsFg, jsBg, gFg, gBg, kind, 2, 1, undefined, undefined, 1, 96, true);
check('non-k8 cap applies', c3.fgMaxNonK8 === 150 && c3.pass === false);

if (failures) { console.error(`${failures} failed`); process.exit(1); }
console.log('gpuCompare.k8split.test.js: all checks passed.');
