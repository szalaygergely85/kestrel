// node engine/render/gpu/gpuCompare.migration.test.js
import { classifyMigrationCells, MIGRATION_CATS } from './gpuCompare.js';

let failures = 0;
const check = (name, cond) => { if (!cond) { console.error('FAIL:', name); failures++; } };

// 8 cells: match, voxel(dda), voxel(mesh), terrainGrid(kind), terrainGrid(glyph, same kind 7), kindOther, glyphOther, colourOther
const n = 8;
const ddaKind = [1, 8, 2, 7, 7, 1, 2, 3];
const meshKind = [1, 2, 8, 2, 7, 3, 2, 3];
const mk = () => new Uint8Array(n * 4).fill(100);
const ddaFg = mk(), ddaBg = mk(), meshFg = mk(), meshBg = mk();
meshFg[4 * 4 + 3] = 7;          // cell 4: glyph differs, kind 7
meshFg[6 * 4 + 3] = 9;          // cell 6: glyph differs
meshBg[7 * 4 + 1] = 100 + 5;    // cell 7: bg green off by 5 (> tolerance 4)
meshFg[0 * 4] = 100 + 4;        // cell 0: within tolerance -> still match

const r = classifyMigrationCells(ddaKind, meshKind, ddaFg, ddaBg, meshFg, meshBg, n);
check('cell categories', Array.from(r.cat).join() === [0, 1, 1, 2, 2, 3, 4, 5].join());
check('counts', r.counts.match === 1 && r.counts.voxel === 2 && r.counts.terrainGrid === 2 &&
  r.counts.kindOther === 1 && r.counts.glyphOther === 1 && r.counts.colourOther === 1);
check('pct', Math.abs(r.pct.voxel - 25) < 1e-9 && Math.abs(r.pct.match - 12.5) < 1e-9);
check('cat names', MIGRATION_CATS.length === 6 && MIGRATION_CATS[0] === 'match');
// sky both sides identical -> match
const s = classifyMigrationCells([0], [0], mk().subarray(0, 4), mk().subarray(0, 4), mk().subarray(0, 4), mk().subarray(0, 4), 1);
check('sky match', s.counts.match === 1);

if (failures) { console.error(`${failures} failed`); process.exit(1); }
console.log('gpuCompare.migration.test.js: all checks passed.');
