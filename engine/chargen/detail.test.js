// engine/chargen/detail.test.js (CHARGEN-22a, docs/architecture.md 38.34 item 8 b/c/g): node engine/chargen/detail.test.js
import { validateKit, validateRecipe, downsample2, randomRecipe, effectiveRes, clampRes, GAME_SAFE_RES, CHAR_GAME_MAX_QUADS } from './index.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const clone = (o) => JSON.parse(JSON.stringify(o));
const fill = (n, m, k, c) => Array.from({ length: k }, () => Array.from({ length: m }, () => c.repeat(n)));

// ---- (b) downsample2
{
  const S = { s: {}, e: { keep: 5 }, l: { keep: 3 } };
  const mk = (cells, nx = 2, ny = 2, nz = 2) => {
    const L = fill(nx, ny, nz, '.').map((p) => p.map((r) => r.split('')));
    for (const [x, y, z, c] of cells) L[z][y][x] = c;
    return L.map((p) => p.map((r) => r.join('')));
  };
  ok('keep: a lone iris survives', downsample2(mk([[1, 1, 1, 'e']]), S)[0][0] === 'e');
  ok('keep: iris beats a skin majority', downsample2(mk([[0, 0, 0, 's'], [1, 0, 0, 's'], [0, 1, 0, 's'], [1, 1, 0, 's'], [0, 0, 1, 's'], [1, 1, 1, 'e']]), S)[0][0] === 'e');
  ok('keep: higher keep wins', downsample2(mk([[0, 0, 0, 'l'], [1, 0, 0, 'e']]), S)[0][0] === 'e');
  ok('keep: equal keep, higher count wins', downsample2(mk([[0, 0, 0, 'l'], [1, 0, 0, 'l'], [0, 1, 0, 'e'], [1, 1, 0, 'e'], [0, 0, 1, 'e']]), { e: { keep: 3 }, l: { keep: 3 } })[0][0] === 'e');
  ok('majority: 4 of 8 filled -> majority char', downsample2(mk([[0, 0, 0, 's'], [1, 0, 0, 's'], [0, 1, 0, 's'], [1, 1, 0, 'a']]), { s: {}, a: {} })[0][0] === 's');
  ok('majority tie -> lower char code', downsample2(mk([[0, 0, 0, 'b'], [1, 0, 0, 'b'], [0, 1, 0, 'a'], [1, 1, 0, 'a']]), { a: {}, b: {} })[0][0] === 'a');
  ok('3 of 8 filled -> empty', downsample2(mk([[0, 0, 0, 's'], [1, 0, 0, 's'], [0, 1, 0, 's']]), S)[0][0] === '.');
  const odd = downsample2(mk([[2, 2, 2, 's']], 3, 3, 3), S);
  ok('odd size pads: 3x3x3 -> 2x2x2, lone cell empty', odd.length === 2 && odd[0].length === 2 && odd[0][0].length === 2 && odd[1][1] === '..');
  const full = downsample2(fill(5, 3, 3, 's'), S);
  ok('odd size: full 5x3x3 -> 3x2x2, padded edge blocks need >= 4 filled', JSON.stringify(full) === '[["sss","ss."],["ss.","..."]]', JSON.stringify(full));
  const big = fill(4, 4, 4, 's'); big[0][0] = 'es..';
  ok('deterministic', JSON.stringify(downsample2(big, S)) === JSON.stringify(downsample2(big, S)));
}

// ---- fixture kit: 4x4x6 grid, Spine z0..3 (x1..2,y1..2), Head z4..5 (region head box [0,0,4,3,3,5]); head L2 = 8x8x4
function kitFix() {
  const base = {
    size: [4, 4, 6], anchor: [2, 2, 0],
    layers: [],
    bones: { Spine: { joint: [2, 2, 0], box: [1, 1, 0, 2, 2, 3] }, Head: { joint: [2, 2, 4], box: [0, 0, 4, 3, 3, 5] } },
    anchors: { top: [2, 2, 5] }, stretchRows: [1],
  };
  for (let z = 0; z < 6; z++) base.layers.push(['....', '.ss.', '.ss.', '....']);
  const det = Array.from({ length: 4 }, () => Array.from({ length: 8 }, (_, y) => (y >= 2 && y < 6 ? '..ssss..' : '........')));
  base.detail = { head: { 2: { layers: det } } };
  return {
    id: 'fix', cellM: 0.025,
    skeleton: [{ name: 'Spine', parent: null }, { name: 'Head', parent: 'Spine' }],
    slots: { s: { group: 'skin', shade: 1 }, e: { group: 'eyes', shade: 0, keep: 5 }, h: { group: 'hair', shade: 0 } },
    ramps: { skin: { fair: { 0: 'm.a', 1: 'm.b' } }, eyes: { brown: { 0: 'm.c' } }, hair: { black: { 0: 'm.d' } } },
    bases: { m: base },
    regions: { head: { bones: ['Head'], box: [0, 0, 4, 3, 3, 5] } },
    resLevels: { body: [1], head: [1, 2] },
    shells: [], attachments: [],
  };
}
const mats = ['m.a', 'm.b', 'm.c', 'm.d'];
const errs = (k) => validateKit(k, mats).errors;
{
  const k = kitFix();
  ok('fixture kit is valid', errs(k).length === 0, errs(k).join('; '));
  ok('old kit format (no regions/resLevels/detail) still validates', (() => { const o = kitFix(); delete o.regions; delete o.resLevels; delete o.bases.m.detail; return errs(o).length === 0; })());
}

// ---- (c) validateKit
{
  let k = kitFix();
  k.bases.m.stretchRows = [4];
  ok('stretch row inside the head box -> error', errs(k).some((e) => /stretchRows: row 4 is inside region "head"/.test(e)));

  k = kitFix();
  k.regions.head.box = [0, 0, 4, 3, 3, 9];
  ok('region box outside grid -> error', errs(k).some((e) => /outside the grid/.test(e)));

  k = kitFix();
  k.regions.head.box = [0, 0, 3, 3, 3, 5];
  ok('detail size mismatch -> error', errs(k).some((e) => /does not match box extent x 2/.test(e)));

  k = kitFix();
  k.regions.head.box = [0, 0, 3, 3, 3, 5];
  k.bases.m.detail.head[2].layers = Array.from({ length: 6 }, () => Array.from({ length: 8 }, (_, y) => (y >= 2 && y < 6 ? '..ssss..' : '........')));
  k.bases.m.stretchRows = [];
  ok('seam rule: head L2 overlapping Spine -> error', errs(k).some((e) => /head L2 overlaps Spine at 1,1,3/.test(e)), errs(k).join('; '));

  k = kitFix();
  k.resLevels.head = [1, 2, 4];
  ok('resLevel finer than authored -> error', errs(k).some((e) => /lists 4 but the finest authored level is 2/.test(e)));
  k = kitFix();
  k.resLevels.head = [1, 3];
  ok('resLevel 3 -> error', errs(k).some((e) => /resLevels\.head/.test(e)));
  k = kitFix();
  delete k.bases.m.detail;
  ok('resLevel 2 without authored detail -> error', errs(k).some((e) => /lists 2 but the finest authored level is 1/.test(e)));

  k = kitFix();
  k.regions.head.bones = ['Head', 'Nope'];
  ok('unknown region bone -> error', errs(k).some((e) => /unknown bone "Nope"/.test(e)));
  k = kitFix();
  k.regions.neck = { bones: ['Head'], box: [0, 0, 4, 3, 3, 5] };
  ok('bone in two regions -> error', errs(k).some((e) => /already in region "head"/.test(e)));
  k = kitFix();
  k.slots.e.keep = 12;
  ok('keep out of range -> error', errs(k).some((e) => /keep must be an int 0..9/.test(e)));

  k = kitFix();
  k.attachments = [{ id: 'cap', slot: 'hat', bone: 'Head', anchor: 'top', offset: [0, 0, 0], box: [1, 1, 1], layers: [['h']], res: 2 }];
  ok('attachment res in resLevels -> ok', errs(k).length === 0, errs(k).join('; '));
  k.attachments[0].res = 4;
  ok('attachment res 4 not offered -> error', errs(k).some((e) => /res 4 is not in resLevels\.head/.test(e)));
  k.attachments[0].bone = 'Spine'; k.attachments[0].res = 2;
  ok('attachment on body bone with res 2 -> error', errs(k).some((e) => /res 2 is not in resLevels\.body/.test(e)));

  const d1 = downsample2(kitFix().bases.m.detail.head[2].layers, kitFix().slots);
  ok('L2 -> L1 downsample has the head box size 4x4x2', d1.length === 2 && d1[0].length === 4 && d1[0][0].length === 4);
}

// ---- (g) recipe.res
{
  const kit = kitFix();
  const r = { v: 1, kit: 'fix', base: 'm', height: 0, age: 'adult', skin: 'fair', eyes: 'brown' };
  ok('missing res is valid', validateRecipe(kit, r).errors.length === 0);
  ok('missing res = {1,1}', JSON.stringify(effectiveRes(r)) === '{"body":1,"head":1}');
  ok('res {1,2} valid', validateRecipe(kit, { ...r, res: { body: 1, head: 2 } }).errors.length === 0);
  ok('level not offered -> error', validateRecipe(kit, { ...r, res: { body: 2, head: 2 } }).errors.some((e) => /res\.body/.test(e)));
  const k2 = clone(kit); k2.resLevels.body = [1, 2];
  ok('head < body rejected', validateRecipe(k2, { ...r, res: { body: 2, head: 1 } }).errors.some((e) => /head \(1\) must be >= body \(2\)/.test(e)));
  ok('res not an object -> error', validateRecipe(kit, { ...r, res: 2 }).errors.length > 0);
  ok('clamp to GAME_SAFE_RES deterministic', JSON.stringify(clampRes({ body: 2, head: 4 })) === '{"body":1,"head":2}' && JSON.stringify(clampRes({ body: 2, head: 4 })) === JSON.stringify(clampRes({ body: 2, head: 4 })));
  ok('clamp keeps smaller values', JSON.stringify(clampRes({ body: 1, head: 1 })) === '{"body":1,"head":1}');
  ok('constants', GAME_SAFE_RES.head === 2 && GAME_SAFE_RES.body === 1 && CHAR_GAME_MAX_QUADS === 4096);
  const a = randomRecipe(kit, 7);
  ok('randomRecipe without defaults.res has no res', a.res === undefined);
  const k3 = clone(kit); k3.defaults = { res: { body: 1, head: 2 } };
  const b = randomRecipe(k3, 7);
  ok('randomRecipe uses defaults.res, rest of stream unchanged', JSON.stringify(b.res) === '{"body":1,"head":2}' && JSON.stringify({ ...b, res: undefined }) === JSON.stringify({ ...a, res: undefined }));
  ok('randomRecipe(res) validates', validateRecipe(k3, b).errors.length === 0);
}

console.log(`detail.test: ${pass} passed, ${fail} failed`);
if (fail > 0) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
console.log('ALL PASS');
