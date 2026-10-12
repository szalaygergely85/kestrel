// MASK-d: grass brush with a stubbed paint layer (real one: engine/world/grassMask.js, MASK-a; same function names).
import { wrapLayer, applyGrassDab, beginStroke, endStroke, applyGrassSide, isGrassRecord, effectiveStrength, rebuildCarpet, grassMaskText, grassMaskPath, paintedPoints } from './grassBrush.js';
let fails = 0;
const ok = (n, c, d = '') => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${c ? '' : d}`); };

const api = {
  sampleAt: (l, i, j) => l.m.get(`${i},${j}`) || 0, // absent = 0
  setSample: (l, i, j, v) => { l.m.set(`${i},${j}`, v); },
  grassMaskToJSON: (l, id) => ({ kind: 'grassMask', schema: 1, id, cell: l.cell, chunks: [...l.m].sort() }),
};
const mk = () => wrapLayer({ cell: 0.5, m: new Map() }, api);
const at = (gm, x, y) => gm.get(Math.floor(x / gm.cell), Math.floor(y / gm.cell));

const L = mk(), rect = {};
ok('paint changes', applyGrassDab(L, 'paint', 10, 10, 4, 0.5, rect));
const centre = at(L, 10.25, 10.25), mid = at(L, 11.75, 10.25), edge = at(L, 13.75, 10.25), out = at(L, 15, 10);
ok('falloff centre > mid > edge >= 0', centre > mid && mid > edge && edge >= 0 && out === 0, [centre, mid, edge, out]);
ok('rect covers radius', rect.x0 <= 6 && rect.x1 >= 14 && rect.y0 <= 6 && rect.y1 >= 14);
for (let n = 0; n < 10; n++) applyGrassDab(L, 'paint', 10, 10, 4, 0.5, rect);
ok('clamps at 255', at(L, 10.25, 10.25) === 255);
for (let n = 0; n < 10; n++) applyGrassDab(L, 'erase', 10, 10, 4, 0.5, rect);
ok('erase clamps at 0', at(L, 10.25, 10.25) === 0);
ok('erase on empty is a no-op', applyGrassDab(mk(), 'erase', 0, 0, 3, 0.5, {}) === false);

// stroke + undo/redo
const S = mk(), ctx = { gm: S, key: 'w' };
const st = beginStroke(ctx, { op: 'paint', radius: 3, strength: effectiveStrength(60), x: 0, y: 0 });
let dabs = 0;
for (const [x, y] of st.points(8, 0)) { st.dab(x, y); dabs++; }
ok('fixed-step dabs along a drag', dabs > 3, dabs);
const rec = endStroke(ctx, st);
ok('one record', isGrassRecord(rec) && rec.entries.length > 20 && rec.label === 'grass paint');
const after = JSON.stringify([...S.layer.m].sort());
applyGrassSide(S, rec, 'before');
ok('undo restores (all zero)', [...S.layer.m.values()].every((v) => v === 0));
applyGrassSide(S, rec, 'after');
ok('redo restores', JSON.stringify([...S.layer.m].sort()) === after);
ok('no-change stroke -> null', endStroke(ctx, beginStroke(ctx, { op: 'erase', radius: 2, strength: 0.5, x: 90, y: 90 })) === null);

// erase after paint, then undo
const s2 = beginStroke(ctx, { op: 'erase', radius: 2, strength: 0.5, x: 2, y: 0 });
for (const [x, y] of s2.points(2, 0)) s2.dab(x, y);
const r2 = endStroke(ctx, s2), v0 = at(S, 2.25, 0.25);
ok('erase lowers coverage', r2 && r2.entries.every((e) => e[3] < e[2]));
applyGrassSide(S, r2, 'before');
ok('undo erase restores', at(S, 2.25, 0.25) > v0);

// carpet hook guard + save shape
let got = null;
ok('rebuild hook guarded', rebuildCarpet({}, rect) === false && rebuildCarpet({ rebuildCarpetMask: (r) => { got = r; } }, { x0: 1, y0: 2, x1: 3, y1: 4 }) && got.join() === '1,2,3,4');
const t1 = grassMaskText(S, 'overworld_far');
ok('save text deterministic layer JSON', JSON.parse(t1).kind === 'grassMask' && JSON.parse(t1).id === 'overworld_far' && t1 === grassMaskText(S, 'overworld_far'));
ok('path', grassMaskPath('k') === 'terrain/k.grassMask.json');
ok('overlay points', paintedPoints(S, 4, 0, 6).length > 0 && paintedPoints(mk(), 0, 0, 5).length === 0);
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('grassBrush: all ok');
