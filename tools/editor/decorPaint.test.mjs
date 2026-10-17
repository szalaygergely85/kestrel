// ED-FOLIAGE-04: decor mode of grassBrush (real engine grassMask, neutral 128).
import { createGrassMask, grassSampleAt, setGrassSample, grassMaskFromJSON, grassMaskToJSON } from '../../engine/index.js';
import * as GB from './grassBrush.js';
let fails = 0;
const ok = (n, c, d = '') => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${c ? '' : d}`); };
const api = { createGrassMask, sampleAt: grassSampleAt, setSample: setGrassSample, grassMaskToJSON, grassMaskFromJSON };
const mk = () => GB.createDecorLayers(['flowers', 'tufts'], api);
const at = (gm, x, y) => gm.get(Math.floor(x / gm.cell), Math.floor(y / gm.cell));
const stroke = (layers, name, op, target, x0, x1) => {
  const ctx = { gm: layers[name], key: 'w' };
  const s = GB.beginDecorStroke(ctx, { layer: name, op, target, radius: 4, strength: 0.6, x: x0, y: 0 });
  for (const [x, y] of s.points(x1, 0)) s.dab(x, y);
  return { s, rec: GB.endStroke(ctx, s) };
};

const L = mk();
ok('fresh layer reads neutral 128', at(L.flowers, 5, 5) === 128 && at(L.flowers, -300, 900) === 128);
ok('empty layers -> empty text layers', JSON.parse(GB.decorPaintText(L, 'w')).layers && Object.keys(JSON.parse(GB.decorPaintText(L, 'w')).layers).length === 0);
ok('goals', GB.decorGoal('paint', 2) === 255 && GB.decorGoal('paint', 1.5) === 192 && GB.decorGoal('erase') === 0 && GB.decorGoal('reset') === 128);

// paint up, erase, reset
const up = stroke(L, 'flowers', 'paint', 2, 0, 8);
ok('record kind decor + layer', GB.isDecorRecord(up.rec) && up.rec.layer === 'flowers' && up.rec.label === 'decor paint' && !GB.isGrassRecord(up.rec));
ok('paint raised centre above 128, other layer untouched', at(L.flowers, 4.25, 0.25) > 128 && at(L.tufts, 4.25, 0.25) === 128);
ok('every entry went up toward 255', up.rec.entries.every((e) => e[2] === 128 && e[3] > 128 && e[3] <= 255));
for (let n = 0; n < 6; n++) stroke(L, 'flowers', 'paint', 2, 0, 8);
ok('repeated paint converges to goal 255', at(L.flowers, 4.25, 0.25) === 255);
stroke(L, 'flowers', 'erase', 2, 0, 8); stroke(L, 'flowers', 'erase', 2, 0, 8); stroke(L, 'flowers', 'erase', 2, 0, 8);
ok('erase moves toward 0', at(L.flowers, 4.25, 0.25) < 64);
for (let n = 0; n < 40; n++) stroke(L, 'flowers', 'reset', 2, 0, 8);
ok('reset returns to neutral and drops chunks', at(L.flowers, 4.25, 0.25) === 128 && Object.keys(L.flowers.toJSON('w').chunks).length === 0);

// undo / redo round trip through the record, byte-identical json
const M = mk(), before = M.flowers.toJSON('w');
const r1 = stroke(M, 'flowers', 'paint', 1.5, 2, 12).rec;
const afterJ = JSON.stringify(M.flowers.toJSON('w'));
ok('painted json differs', afterJ !== JSON.stringify(before));
ok('undo rect returned', GB.applyDecorSide(M, r1, 'before') === r1.rect);
ok('undo restores json byte-identical', JSON.stringify(M.flowers.toJSON('w')) === JSON.stringify(before));
GB.applyDecorSide(M, r1, 'after');
ok('redo restores', JSON.stringify(M.flowers.toJSON('w')) === afterJ);
ok('unknown layer -> null', GB.applyDecorSide(M, { ...r1, layer: 'nope' }, 'after') === null);
ok('no-change stroke -> null', stroke(mk(), 'tufts', 'reset', 1, 0, 8).rec === null);

// canonical save text + round trip
const text = GB.decorPaintText(M, 'w');
const obj = JSON.parse(text);
ok('text: version 1, only painted layer, canonical LF + trailing newline', obj.version === 1 && Object.keys(obj.layers).join() === 'flowers' && text.endsWith('}\n') && !text.includes('\r'));
ok('layer json carries neutral 128', obj.layers.flowers.neutral === 128 && obj.layers.flowers.kind === 'grassMask');
const back = GB.parseDecorPaint(obj, ['flowers', 'tufts'], api);
ok('load round trip: same text', GB.decorPaintText(back, 'w') === text);
ok('load round trip: samples equal', at(back.flowers, 6.25, 0.25) === at(M.flowers, 6.25, 0.25) && at(back.tufts, 6, 0) === 128);
ok('text is stable under re-stringify', GB.decorPaintText(GB.parseDecorPaint(JSON.parse(GB.decorPaintText(back, 'w')), ['flowers'], api), 'w') === text);
ok('world opt exposes raw layers', GB.decorWorldOpt(back).flowers === back.flowers.layer && GB.decorPaintPath('w') === 'terrain/w.decorPaint.json');
let threw = false; try { GB.parseDecorPaint({ version: 2 }, [], api); } catch { threw = true; }
ok('bad version rejected', threw);

// rebuild hook: rect only
const calls = [], world = { rebuildDecor: (r) => calls.push(r) };
ok('rebuildDecor passes the stroke rect only', GB.rebuildDecor(world, r1.rect) && calls.length === 1 && calls[0].x0 === r1.rect.x0 && calls[0].x1 === r1.rect.x1 && calls[0].y0 === r1.rect.y0 && calls[0].y1 === r1.rect.y1);
ok('rebuildDecor guarded without method', GB.rebuildDecor({}, r1.rect) === false);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
