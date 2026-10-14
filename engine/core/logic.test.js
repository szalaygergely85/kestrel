// engine/core/logic.test.js (ED-LOGIC-01a): node engine/core/logic.test.js
// Fake vocabulary only - the engine interpreter knows no game names. The ambush test mirrors arch 38.70.
import { compileLogic, createLogic, validateLogic } from './logic.js';
import { createHasher } from './hash.js';
import { allocProbe, skipNote } from '../../tools/allocProbe.mjs';
import { makeOk } from '../test/assert.js';
import { spawnSync } from 'node:child_process';

// the allocation probe needs gc(): re-spawn once with --expose-gc
if (typeof globalThis.gc !== 'function' && !process.env.LOGIC_TEST_GC) {
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, LOGIC_TEST_GC: '1' } });
  process.exit(r.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const EV = ['enter', 'ping', 'a', 'b', 'died'];
const evId = (n) => EV.indexOf(n);
const vocab = {
  events: {
    enter: { args: { area: 'ref:area' } }, ping: { args: {} }, a: { args: {} }, b: { args: {} },
    died: { args: { kind: 'ref:kind?', group: 'ref:group?' } },
  },
  conds: {
    quest: { args: { quest: 'ref:quest', state: 'active|done' }, test: (c, a) => c.quests[a.quest] === a.state },
    flag: { args: { flag: 'ref:flag', eq: 'bool' }, test: (c, a) => !!c.flags[a.flag] === a.eq },
  },
  acts: {
    mark: { args: { n: 'int' }, run: (c, a) => { c.h.u32(a.n); c.log.push(a.n); } },
    close: { args: { prop: 'ref:prop' }, run: (c, a) => { c.props[a.prop] = 'closed'; } },
    spawn: { args: { group: 'ref:group', count: 'int' }, run: (c, a) => { c.spawned[a.group] = (c.spawned[a.group] | 0) + a.count; } },
    raise: { args: { k: 'int', a: 'int' }, run: (c, a) => { c.logic.push(a.k, a.a); } },
    flag: { args: { flag: 'ref:flag', value: 'bool' }, run: (c, a) => { c.flags[a.flag] = a.value; } },
  },
};
const mkCtx = () => ({ quests: {}, flags: {}, props: {}, spawned: {}, log: [], h: createHasher(), logic: null });
const mk = (blocks, o) => { const program = compileLogic(blocks, vocab); const logic = createLogic(program, o); return { program, logic, ctx: Object.assign(mkCtx(), { logic }) }; };

// ---- 0) allocation first: 0 B per step, with events + conditions + actions + delayed + chaining
{
  const blocks = [
    { id: 'p1', rev: 1, when: { on: 'ping' }, if: [{ is: 'flag', flag: 'f', eq: false }], do: [{ act: 'mark', n: 1 }, { act: 'mark', n: 2, after: 3 }] },
    { id: 'c1', rev: 1, when: { on: 'a' }, do: [{ act: 'raise', k: evId('b'), a: 0 }] },
    { id: 'c2', rev: 1, when: { on: 'b' }, do: [{ act: 'raise', k: evId('a'), a: 0 }] },
  ];
  const { logic, ctx } = mk(blocks);
  ctx.log = { push() {} }; ctx.h = { u32() {} }; // the test trace (and the hasher's heap-number hash) must not allocate
  logic.push(evId('a'), 0);
  allocProbe(() => {}, { n: 1 }); // prime the probe itself (first call in a process reads ~3 KB of its own noise)
  const r = allocProbe((n) => { for (let i = 0; i < n; i++) { if ((i & 7) === 0) logic.push(evId('ping'), 0); logic.step(ctx); } }, { n: 4000 });
  if (!skipNote(r, 'logic step alloc')) ok('0 alloc per step', r.bytes <= 512, `${r.bytes} B / ${r.n} steps`);
}

// ---- 1) the ambush shape: enter area A while quest X active -> close gate G, spawn 3 goblins
const AMBUSH = [{
  id: 'rook.ambush', rev: 1, once: true, when: { on: 'enter', area: 'rook.yard' },
  if: [{ is: 'quest', quest: 'sq.x', state: 'active' }],
  do: [{ act: 'close', prop: 'rook.gate' }, { act: 'spawn', group: 'rook.goblins', count: 3 }],
}];
{
  const t = mk(AMBUSH);
  t.logic.push(evId('enter'), t.program.argId('area', 'rook.yard'));
  t.logic.step(t.ctx);
  ok('ambush: quest not active -> nothing', !t.ctx.props['rook.gate'] && !t.ctx.spawned['rook.goblins'] && t.logic.fireCount('rook.ambush') === 0);
  t.ctx.quests['sq.x'] = 'active';
  t.logic.push(evId('enter'), t.program.argId('area', 'other.area'));
  t.logic.step(t.ctx);
  ok('ambush: other area -> nothing', !t.ctx.props['rook.gate']);
  t.logic.push(evId('enter'), t.program.argId('area', 'rook.yard'));
  t.logic.step(t.ctx);
  ok('ambush: gate closed + 3 goblins within 1 step', t.ctx.props['rook.gate'] === 'closed' && t.ctx.spawned['rook.goblins'] === 3);
  t.logic.push(evId('enter'), t.program.argId('area', 'rook.yard'));
  t.logic.step(t.ctx);
  ok('ambush: once -> fires only once', t.ctx.spawned['rook.goblins'] === 3 && t.logic.fireCount('rook.ambush') === 1);
  // save/load after the ambush: not refired
  const s = JSON.parse(JSON.stringify(t.logic.save()));
  const u = mk(AMBUSH); u.ctx.quests['sq.x'] = 'active'; u.logic.load(s);
  u.logic.push(evId('enter'), u.program.argId('area', 'rook.yard')); u.logic.step(u.ctx);
  ok('ambush: loaded save does not refire', !u.ctx.spawned['rook.goblins']);
}

// ---- 2) next-step chaining: A->B->A advances one hop per step
{
  const { logic, ctx, program } = mk([
    { id: 'c1', rev: 1, when: { on: 'a' }, do: [{ act: 'mark', n: 10 }, { act: 'raise', k: evId('b'), a: 0 }] },
    { id: 'c2', rev: 1, when: { on: 'b' }, do: [{ act: 'mark', n: 20 }, { act: 'raise', k: evId('a'), a: 0 }] },
  ]);
  void program;
  logic.push(evId('a'), 0);
  for (let i = 0; i < 5; i++) logic.step(ctx);
  ok('chain: one hop per step', ctx.log.join() === '10,20,10,20,10', ctx.log.join());
}

// ---- 3) `after` timing exact + stable insertion order on ties
{
  const { logic, ctx } = mk([
    { id: 'd1', rev: 1, when: { on: 'ping' }, do: [{ act: 'mark', n: 1, after: 3 }, { act: 'mark', n: 2, after: 3 }, { act: 'mark', n: 3 }, { act: 'mark', n: 4, after: 1 }] },
  ]);
  logic.push(evId('ping'), 0);
  const seen = [];
  for (let s = 1; s <= 5; s++) { logic.step(ctx); seen.push(ctx.log.join('')); }
  // step1: event -> 3 now, 1 and 2 parked at 3, 4 at 1.  step2: 4.  step4: 1,2 (event step + 3)
  ok('after: exact steps + tie order', seen.join('|') === '3|34|34|3412|3412', seen.join('|'));
}

// ---- 4) caps: maxPerStep defers whole blocks to the next step; ring + pending overflow warn once
{
  const warns = [];
  const blocks = [0, 1, 2].map((i) => ({ id: 'm' + i, rev: 1, when: { on: 'ping' }, do: [{ act: 'mark', n: i * 10 + 1 }, { act: 'mark', n: i * 10 + 2 }] }));
  const { logic, ctx } = mk(blocks, { maxPerStep: 4, warn: (m) => warns.push(m) });
  logic.push(evId('ping'), 0);
  logic.step(ctx); const a = ctx.log.join();
  logic.step(ctx); const b = ctx.log.join();
  ok('maxPerStep: 2 blocks now, the rest next step', a === '1,2,11,12' && b === '1,2,11,12,21,22' && logic.queued === 0, a + ' / ' + b);

  const r2 = mk(blocks, { ring: 4, warn: (m) => warns.push(m) });
  for (let i = 0; i < 7; i++) r2.logic.push(evId('ping'), 0);
  ok('ring overflow: drops newest, counts, warns once', r2.logic.queued === 4 && r2.logic.stats.droppedEvents === 3 && warns.filter((w) => w.includes('event queue')).length === 1);

  const p = mk([{ id: 'q', rev: 1, when: { on: 'ping' }, do: [{ act: 'mark', n: 1, after: 5 }, { act: 'mark', n: 2, after: 5 }, { act: 'mark', n: 3, after: 5 }] }], { pending: 2, warn: (m) => warns.push(m) });
  p.logic.push(evId('ping'), 0); p.logic.step(p.ctx);
  ok('pending overflow: dropped + warned once', p.logic.pending === 2 && p.logic.stats.droppedPending === 1 && warns.filter((w) => w.includes('delayed')).length === 1);

  const lim = validateLogic(Array.from({ length: 129 }, (_, i) => ({ id: 'x' + i, rev: 1, when: { on: 'ping' }, do: [{ act: 'mark', n: 1 }] })), vocab);
  ok('limit: >128 blocks per area -> plain error', lim.length === 1 && /Too many blocks: 129/.test(lim[0]), lim.join('|'));
  let thrown = '';
  try { compileLogic([{ id: 'z', rev: 1, when: { on: 'nope' }, do: [{ act: 'mark', n: 1 }] }], vocab); } catch (e) { thrown = e.message; }
  ok('compile throws plain text on invalid data', /unknown event "nope"/.test(thrown), thrown);
}

// ---- 5) determinism: replay twice -> same trace hash
const SCRIPT = [
  { id: 'a1', rev: 1, when: { on: 'ping' }, do: [{ act: 'mark', n: 1 }, { act: 'raise', k: evId('a'), a: 0 }, { act: 'mark', n: 5, after: 4 }] },
  { id: 'a2', rev: 1, max: 3, when: { on: 'a' }, if: [{ is: 'not', cond: { is: 'flag', flag: 'f', eq: true } }], do: [{ act: 'mark', n: 2 }, { act: 'raise', k: evId('ping'), a: 0 }] },
  { id: 'a3', rev: 1, when: { on: 'enter', area: 'z' }, do: [{ act: 'mark', n: 3, after: 2 }, { act: 'flag', flag: 'f', value: true }] },
];
function replay(saveAt) {
  let t = mk(SCRIPT);
  const area = t.program.argId('area', 'z');
  const hs = createHasher();
  for (let s = 0; s < 40; s++) {
    if (s % 6 === 0) t.logic.push(evId('ping'), 0);
    if (s === 9) t.logic.push(evId('enter'), area);
    t.logic.step(t.ctx);
    t.logic.hashInto(hs); hs.u32(t.ctx.log.length);
    if (s === saveAt) { // mid-pending: save, rebuild everything, load, carry on
      const snap = JSON.parse(JSON.stringify(t.logic.save()));
      const log = t.ctx.log, flags = t.ctx.flags, hOld = t.ctx.h;
      const n = mk(SCRIPT); n.ctx.log = log; n.ctx.flags = flags; n.ctx.h = hOld;
      n.logic.load(snap); t = n;
    }
  }
  return { trace: hs.value(), log: t.ctx.log.join(), pend: t.logic.pending };
}
{
  const r1 = replay(-1), r2 = replay(-1);
  ok('determinism: replay twice -> same hash', r1.trace === r2.trace && r1.log === r2.log && r1.log.length > 5, `${r1.trace} vs ${r2.trace}`);
  // save at step 10 (after the 'enter' at 9 parked a delayed mark) and every other pending-rich moment
  let allSame = true, bad = '';
  for (const at of [3, 9, 10, 11, 20]) { const r = replay(at); if (r.trace !== r1.trace || r.log !== r1.log) { allSame = false; bad += at + ' '; } }
  ok('save/load mid-pending == uninterrupted run', allSame, 'differs at ' + bad);
}

// ---- 6) migration: unknown id dropped, missing id fresh, rev change resets count, pending cleanup
{
  const b = (id, rev, extra) => ({ id, rev, when: { on: 'ping' }, do: [{ act: 'mark', n: 1, after: 9 }], ...extra });
  const old = { v: 1, b: { keep: { n: 2, rev: 1 }, bumped: { n: 5, rev: 1 }, gone: { n: 9, rev: 1 } }, p: [['keep', 0, 4], ['gone', 0, 2], ['keep', 7, 1]], g: { grp: 1 } };
  const t = mk([b('keep', 1), b('bumped', 2), b('fresh', 1)]);
  t.logic.load(old);
  ok('migrate: same rev keeps count', t.logic.fireCount('keep') === 2);
  ok('migrate: rev change resets count', t.logic.fireCount('bumped') === 0);
  ok('migrate: missing block is fresh', t.logic.fireCount('fresh') === 0);
  ok('migrate: pending of unknown block/action dropped', t.logic.pending === 1);
  ok('migrate: game section kept; no save -> fresh', t.logic.groups.grp === 1 && (t.logic.load(undefined), t.logic.pending === 0 && !('grp' in t.logic.groups)));
  const s = t.logic.save();
  ok('save keyed by block id', !!s.b.keep && !!s.b.bumped && !('gone' in s.b));
}

// ---- 7) validateLogic: one plain-text error per broken fixture
{
  const good = { id: 'g', rev: 1, when: { on: 'enter', area: 'x' }, if: [{ is: 'flag', flag: 'f', eq: true }], do: [{ act: 'mark', n: 1 }] };
  const bad = (name, mut, re) => {
    const b = JSON.parse(JSON.stringify(good)); mut(b);
    const e = validateLogic([b], vocab);
    ok('validate: ' + name, e.length === 1 && re.test(e[0]), e.join(' | '));
  };
  ok('validate: good block is clean', validateLogic([good], vocab).length === 0);
  bad('unknown event', (b) => { b.when.on = 'zap'; }, /unknown event "zap"/);
  bad('missing arg', (b) => { delete b.when.area; }, /"area" is missing/);
  bad('wrong type', (b) => { b.do[0].n = 'x'; }, /"n" must be a whole number/);
  bad('unknown condition', (b) => { b.if[0].is = 'zz'; }, /unknown condition "zz"/);
  bad('bad enum', (b) => { b.if = [{ is: 'quest', quest: 'q', state: 'sleeping' }]; }, /must be one of: active, done/);
  bad('unknown action', (b) => { b.do[0].act = 'boom'; }, /unknown action "boom"/);
  bad('after range', (b) => { b.do[0].after = 3601; }, /"after" must be a whole number from 0 to 3600/);
  bad('empty do', (b) => { b.do = []; }, /needs at least one action/);
  bad('too many actions', (b) => { b.do = Array.from({ length: 9 }, () => ({ act: 'mark', n: 1 })); }, /too many actions \(9, at most 8\)/);
  bad('too many conditions', (b) => { b.if = Array.from({ length: 9 }, () => ({ is: 'flag', flag: 'f', eq: true })); }, /too many conditions \(9/);
  bad('unknown field', (b) => { b.do[0].oops = 1; }, /unknown field "oops"/);
  bad('bad rev', (b) => { b.rev = 0; }, /"rev" must be/);
  bad('nested not', (b) => { b.if = [{ is: 'not', cond: { is: 'not', cond: { is: 'flag', flag: 'f', eq: true } } }]; }, /cannot be nested/);
  const dup = validateLogic([good, good], vocab);
  ok('validate: duplicate id', dup.length === 1 && /id is used twice/.test(dup[0]), dup.join('|'));
  const refs = validateLogic([good], vocab, { area: new Set(['y']) });
  ok('validate: missing ref (with refs)', refs.length === 1 && /refers to "x" which does not exist/.test(refs[0]), refs.join('|'));
  ok('validate: not a list', validateLogic({}, vocab).length === 1);
}

console.log(`logic.test: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
