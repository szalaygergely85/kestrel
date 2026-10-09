// GRID-TEXEL-GLYPH-01a (architecture.md 38.24): per-material grid.glyph 'texel'.
// Run: node engine/render/gridTexel.test.js
import { bindShading, bindLevel } from './MaterialTable.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import paletteModule from '../../design/palette.js';
import detailPassModule from '../../design/detail-pass.js';
import { loadLevel } from '../world/Level.js';
import { makeOk } from '../test/assert.js';
import { shadeCore } from './detailShade.js';
import { packMaterialTable, unpackMatI, MAT_I_WIDTH, F_GRID_TEXEL, F_HAS_GRID } from './gpu/ShadeTextures.js';

const palette = paletteModule.default || paletteModule;
const detailPass = detailPassModule.default || detailPassModule;
const { bundle } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const table = bindShading(palette, detailPass, 16 / 9);
bindLevel(table, loadLevel(bundle.levels.test_room));

// Pick a grid material with jitter and a multi-glyph set.
let id = 0;
for (let i = 1; i < table.records.length; i++) {
  const r = table.records[i] && table.records[i].v2;
  if (r && r.grid && r.grid.lines && r.jitter > 0 && r.overlay == null && r.speckle == null) { id = i; break; }
}
if (!id) for (let i = 1; i < table.records.length; i++) { const r = table.records[i] && table.records[i].v2; if (r && r.grid) { id = i; break; } }
ok('fixture: found a grid material', id > 0);
const rec = table.records[id].v2;
const recT = { ...rec, grid: { ...rec.grid, texel: true } };
const light = [0.8, 0.75, 0.7];
const run = (r, u, v, d = 0.02) => shadeCore(table, r, u, v, 1, 1e30, d, 0, 0, d, 4, 1, 2, light, {});

// 1. Flag off is byte-identical to the legacy formula (block die keyed hA, hash of (bix,course)).
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
let same = true;
const recOff = { ...rec, grid: { ...rec.grid, texel: false } };
for (let i = 0; i < 200; i++) {
  const u = rnd() * 20, v = rnd() * 20, d = 0.005 + rnd() * 0.05;
  const a = run(rec, u, v, d), b = run(recOff, u, v, d);
  for (const k of ['b', 'gb', 'cr', 'cg', 'cb', 'bgK', 'hA', 'hB', 'onJoint', 'lineCode', 'setId']) if (a[k] !== b[k]) same = false;
}
ok('flag off: identical to default record', same);

// 2. Flag on: >= 2 distinct hA within one block; off: exactly 1.
const g = rec.grid, d0 = 0.02;
const bu0 = 3 * g.u + 0.01, bv0 = 2 * g.v; // course 2 is even: no stagger
const seenOn = new Set(), seenOff = new Set();
for (let i = 0; i < 16; i++) {
  const u = bu0 + (i % 4) * (g.u * 0.2), v = bv0 + g.v * 0.1 + Math.floor(i / 4) * (g.v * 0.15);
  seenOn.add(run(recT, u, v, d0).hA); seenOff.add(run(rec, u, v, d0).hA);
}
ok('flag on: >= 2 hA values inside one block', seenOn.size >= 2, `${seenOn.size}`);
ok('flag off: 1 hA value per block', seenOff.size === 1, `${seenOff.size}`);

// 3. Per-block brightness b unchanged by the flag (jit uses the block die).
let bSame = true, tested = 0;
for (let i = 0; i < 200; i++) {
  const u = rnd() * 20, v = rnd() * 20;
  const a = run(rec, u, v), b = run(recT, u, v);
  if (a.onJoint || b.onJoint || rec.overlay || rec.speckle) { if (a.b !== b.b) bSame = false; tested++; continue; }
  if (a.b !== b.b || a.gb !== b.gb) bSame = false; tested++;
}
ok('flag on: per-block b / gb unchanged', bSame, `${tested}`);

// 4. F1: shifting u by 0.1 texel inside one texel keeps hA.
{
  const ds = rec.detail; // oct from d0 = 0.02 -> tpc = 0.02*detail
  let stable = true;
  for (let i = 0; i < 100; i++) {
    const u = 1 + rnd() * 10, v = 1 + rnd() * 10;
    const a = run(recT, u, v, d0).hA;
    const tpc = 0.02 * ds; const oct = tpc >= 4 ? -3 : tpc >= 2 ? -2 : tpc >= 1 ? -1 : tpc >= 0.5 ? 0 : tpc >= 0.25 ? 1 : 2;
    const texW = 1 / (ds * 2 ** oct * 0.5); // texel width in u
    const cu = Math.floor(u / texW) * texW + texW * 0.3; // inside texel
    const h1 = run(recT, cu, v, d0).hA, h2 = run(recT, cu + texW * 0.1, v, d0).hA;
    if (h1 !== h2) stable = false; void a;
  }
  ok('F1: sub-texel shift keeps hA', stable);
}

// 5. Packing bit 17.
{
  const pk = packMaterialTable(table);
  const flagsOf = (i) => unpackMatI(pk.matI, i, 0, MAT_I_WIDTH);
  ok('F_GRID_TEXEL is bit 17', F_GRID_TEXEL === 131072);
  const any = []; for (let i = 1; i < table.records.length; i++) if (table.records[i] && table.records[i].v2) any.push(i);
  let none = true; for (const i of any) { const f = flagsOf(i)[0] ?? flagsOf(i); void f; }
  const saved = table.records[id].v2.grid;
  table.records[id].v2.grid = { ...saved, texel: true };
  const pk2 = packMaterialTable(table);
  table.records[id].v2.grid = saved;
  const f1 = flagsOf(id), f2 = unpackMatI(pk2.matI, id, 0, MAT_I_WIDTH);
  const word = (x) => x[1]; // matI slot 0 .y = flags
  ok('packing: bit 17 clear when flag off', (word(f1) & F_GRID_TEXEL) === 0 && (word(f1) & F_HAS_GRID) !== 0, `${word(f1)}`);
  ok('packing: bit 17 set when glyph texel', (word(f2) & F_GRID_TEXEL) !== 0, `${word(f2)}`);
  void none;
}

console.log(`gridTexel.test: ${pass} passed, ${fail} failed`);
for (const m of failures) console.error('FAIL', m);
process.exit(fail ? 1 : 0);
