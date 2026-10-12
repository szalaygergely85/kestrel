// node tools/verify-ch12-run.test.mjs - pure parts of the M4-C2 harness.
import assert from 'node:assert/strict';
import { lineOf, buildGapTable, compareSnaps, questVerdict, renderReport } from './verify-ch12-lib.mjs';

const S = (t, o = {}) => ({ t, x: t, y: 0, hour: 8, tracked: false, compass: false, giver: false, event: 'e' + t, ...o });

// gap table: 7 blind samples (5..35 s) = 35 s stretch > 30 -> one row, located at the first blind sample
{
  const s = [S(0, { tracked: true }), ...[5, 10, 15, 20, 25, 30, 35].map((t) => S(t)), S(40, { compass: true })];
  const g = buildGapTable(s);
  assert.equal(g.length, 1); assert.equal(g[0].t, 5); assert.equal(g[0].x, 5); assert.equal(g[0].lenS, 35); assert.equal(g[0].lastEvent, 'e5');
}
// exactly 30 s (6 samples) is not longer than 30; any one signal breaks the run; trailing run counts
assert.equal(buildGapTable([0, 5, 10, 15, 20, 25].map((t) => S(t))).length, 0);
assert.equal(buildGapTable([0, 5, 10, 15, 20, 25, 30].map((t) => S(t, { giver: t === 15 }))).length, 0);
assert.equal(buildGapTable([0, 5, 10, 15, 20, 25, 30].map((t) => S(t))).length, 1);
assert.equal(buildGapTable([]).length, 0);
{ // --walk streams: 1 s apart, real durations; main vs errand gaps are separate rows
  const W = (t, o = {}) => S(t, { event: '9 road west', ...o });
  const g = buildGapTable(Array.from({ length: 41 }, (_, t) => W(t)), { every: 1 });
  assert.equal(g.length, 1); assert.equal(g[0].lenS, 41); assert.equal(g[0].line, 'main');
  assert.equal(buildGapTable(Array.from({ length: 30 }, (_, t) => W(t)), { every: 1 }).length, 0); // exactly 30 s is not > 30
  for (const brk of ['tracked', 'compass', 'giver']) assert.equal(buildGapTable(Array.from({ length: 41 }, (_, t) => W(t, { [brk]: t === 20 })), { every: 1 }).length, 0, 'split by ' + brk + ' gives 2 x 20 s');
  const m = Array.from({ length: 25 }, (_, t) => W(t)).concat(Array.from({ length: 25 }, (_, t) => W(25 + t, { event: 'E2 explore (sq.burl.tower)' })));
  assert.equal(buildGapTable(m, { every: 1 }).length, 0, 'main 25 s + errand 25 s are not one 50 s gap');
  const e = buildGapTable(Array.from({ length: 40 }, (_, t) => W(t, { event: 'E5 escort (sq.burl.walk)' })), { every: 1 });
  assert.equal(e.length, 1); assert.equal(e[0].line, 'errand');
  assert.equal(lineOf('1 wake in the tower'), 'main');
}

// save compare
const snap = () => ({ pos: [1, 2, 3], hp: 20, max: 30, inventory: { slots: [{ id: 'sword', n: 1 }] }, equipment: { main: 'sword', off: null }, quickbar: [], main: { completed: ['wake'], flags: { a: 1, b: 2 } }, quests: { q: { accepted: true } }, tracked: 1, state: { 'clock.hour': 9, 'm4.x': 1 }, dead: ['boar1'], chests: [] });
{
  const a = snap(), b = snap(); b.pos = [1.03, 2, 3]; b.main.flags = { b: 2, a: 1 }; b.state['clock.hour'] = 9.05;
  assert.deepEqual(compareSnaps(a, b), [], 'tolerances + key order');
  b.pos = [1.5, 2, 3]; b.equipment.main = null; b.dead = [];
  assert.deepEqual(compareSnaps(a, b).map((d) => d.name).sort(), ['dead', 'equipment', 'pos']);
}

// verdict
assert.equal(questVerdict([{ id: 'a', status: 'done' }]).ok, true);
{ const v = questVerdict([{ id: 'a', status: 'done' }, { id: 'b', status: 'active', lastObjective: 'x' }]); assert.equal(v.ok, false); assert.equal(v.open[0].id, 'b'); }

// report
{
  const md = renderReport({ date: '2026-10-11', quests: [{ id: 'm1', status: 'done' }, { id: 'sq.x', status: 'active', lastObjective: 'a|b', forced: ['flag z'] }], beats: [{ id: 'wake', t: 1.234, still: 'wake.png' }],
    forced: ['flag z'], gaps: [{ x: 1, y: 2, t: 35, hour: 8, lenS: 40, lastEvent: 'walk' }], ac: { ac1: false, ac2: true, ac3: true }, diffs: [], equipment: { main: 'sword' }, notes: ['n'] });
  for (const k of ['AC1 all Ch1-2 beats + errands done | FAIL', 'AC3 save / Continue byte-stable | PASS', '| 1, 2 | 35 | 8 | 40 | walk |', '![wake](wake.png)', 'a/b', 'Identical after Continue.', 'flag z']) assert.ok(md.includes(k), k);
}
console.log('verify-ch12 pure parts: PASS');
