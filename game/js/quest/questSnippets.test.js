// QL-T4: generated quest dialogue (entry order, override precedence, never locks) against the REAL content packs.
// Run: node game/js/quest/questSnippets.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadQuestFiles } from '../questBoot.js';
import { compileDialogue } from '../../../engine/index.js';
import { generateForNpc, generateAll, linesFor, kindOf, ANCHORS } from './questSnippets.js';
import { gateOnMeet } from './errands.js';

const ROOT = new URL('../../../', import.meta.url);
const rd = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const files = await loadQuestFiles(async (u) => rd('game/' + u), { items: [], log: () => {} });
const defs = gateOnMeet(files.giverDefs), snip = rd('content/dialogue/quest-snippets.json');
const bear = rd('content/dialogue/bear.dialogue.json'), rook = rd('content/dialogue/rook.dialogue.json');

// every node of a generated dialogue terminates: next/choices resolve, no cycle, every choice node can be left (no forced choice)
function checkNoLock(raw) {
  const N = raw.nodes;
  for (const e of raw.entry) assert.ok(N[e.node], 'entry node exists: ' + e.node);
  const seen = new Set();
  const walk = (id, stack) => {
    assert.ok(N[id], 'node exists: ' + id); assert.ok(!stack.includes(id), 'cycle at ' + id);
    const n = N[id], st = [...stack, id];
    if (n.choices) {
      assert.ok(n.choices.some((c) => !c.setFlag), 'a choice that sets nothing (walk away) in ' + id);
      for (const c of n.choices) walk(c.next, st);
    } else if (n.next) walk(n.next, st);
    else assert.equal(n.end, true, 'node ends: ' + id);
    seen.add(id);
  };
  for (const e of raw.entry) walk(e.node, []);
}

// 1. Burl: all non-hand-written errands routed; order ready < available < active; all before bear.home.again; hand-written blue stays on top
const gb = generateForNpc(bear, 'bear', defs, snip, { before: ANCHORS.bear });
assert.notEqual(gb, bear); assert.ok(bear.entry.length < gb.entry.length, 'input untouched');
const reqs = gb.entry.map((e) => e.requires || '');
const idx = (st) => gb.entry.map((e, i) => (e.node.startsWith('qs.') && e.requires.endsWith('.' + st) ? i : -1)).filter((i) => i >= 0);
const [R, A, V] = [idx('ready'), idx('available'), idx('active')];
assert.ok(R.length && A.length && V.length);
assert.ok(Math.max(...R) < Math.min(...A) && Math.max(...A) < Math.min(...V), 'ready < available < active');
const home = gb.entry.findIndex((e) => e.node === 'bear.home.again');
assert.ok(Math.max(...V) < home, 'generated before the hand-written scenes');
assert.equal(gb.entry[0].node, 'bear.blue.ready', 'hand-written q.* override stays first');
assert.ok(!gb.entry.some((e) => e.node.startsWith('qs.sq.burl.blue')), 'hand-written blue quest not regenerated');
assert.ok(!gb.entry.some((e) => e.node.startsWith('qs.burl.boars')), 'legacy hand-written quest not regenerated');
assert.ok(gb.entry.at(-1).node === 'bear.early' && gb.entry.some((e) => e.node === 'bear.home'), 'hand-written scenes kept');
checkNoLock(gb); compileDialogue(gb);

// 2. Rook: his non-main errands get routes, main quests keep the hand-written q.mq.* scenes; meet stays the fallback
const gr = generateAll({ rook }, defs, snip).rook;
const rookErr = defs.filter((d) => d.giver && d.giver.npc === 'rook' && !d.main);
assert.ok(rookErr.length >= 4);
for (const d of rookErr) for (const s of ['ready', 'available', 'active']) assert.ok(gr.entry.some((e) => e.requires === 'q.' + d.id + '.' + s), d.id + ' ' + s);
assert.ok(!gr.entry.some((e) => /^qs\.mq\./.test(e.node)), 'no generated route for main quests');
assert.equal(gr.entry.at(-1).node, 'rook.meet.1'); checkNoLock(gr); compileDialogue(gr);
assert.deepEqual(rook.entry.map((e) => e.node), JSON.parse(JSON.stringify(rook)).entry.map((e) => e.node), 'input untouched');

// 3. override precedence: writer lines > kind snippet > generic; slots filled; no leftover {slot}
const base = defs.find((d) => d.lines && d.lines.offer && !d.main);
assert.deepEqual(linesFor(base, 'available', snip, 'Burl'), base.lines.offer.map((l) => l.slice(0, 200)), 'writer offer wins');
const bare = { ...base, lines: undefined }, bare2 = { ...base, lines: { offer: ['Only an ask.'] } };
const sl = linesFor(bare, 'available', snip, 'Burl');
assert.ok(sl.length >= 2 && sl.every((l) => !/\{\w+\}/.test(l)), 'snippet slots filled: ' + sl.join(' | '));
assert.ok(sl.some((l) => l.includes(base.title) || l.includes(bare.objectives[0].text)));
assert.deepEqual(linesFor(bare2, 'active', snip, 'Burl'), ['Only an ask.'], 'offer-only writer: active repeats the ask');
assert.deepEqual(linesFor(bare, 'ready', {}, 'X'), ['Well done.'], 'no snippets file -> still a line');
const kinds = new Set(defs.filter((d) => d.objectives).map(kindOf)); for (const k of kinds) assert.ok(k === 'generic' || snip.byKind[k], 'snippet for kind ' + k);
assert.equal(kindOf({ objectives: [{ when: { type: 'flag', id: 'talk.rook' } }] }), 'talk'); assert.equal(kindOf({ objectives: [{ when: { type: 'flag', id: 'escort.bear.relayBend' } }] }), 'escort');

// 4. every non-main quest in content gets all three entries at its giver (even without a dialogue file: synthetic one), no lock
const npcs = [...new Set(defs.map((d) => d.giver && d.giver.npc).filter(Boolean))];
let n = 0;
for (const npc of npcs) {
  const empty = { kind: 'dialogue', schema: 1, id: npc, speakers: { x: { label: 'X' }, you: { label: 'YOU', player: true } }, entry: [{ node: 'x.idle' }], nodes: { 'x.idle': { lines: ['...'], end: true, speaker: 'x' } } };
  const g = generateForNpc(empty, npc, defs, snip);
  for (const d of defs) if (d.giver && d.giver.npc === npc && !d.main) { n++; for (const s of ['ready', 'available', 'active']) assert.ok(g.entry.some((e) => e.requires === 'q.' + d.id + '.' + s), npc + ' ' + d.id + ' ' + s); }
  assert.equal(g.entry.at(-1).node, 'x.idle', 'idle last'); checkNoLock(g); compileDialogue(g);
}
assert.ok(n >= 30, 'quests covered: ' + n);

// 4b. ch12 run beat 13: generated Rook errands never hide his main-quest hand-in / offer entries (call.ready/active, mirror.active/available)
{
  const gr = generateAll({ rook }, defs, snip).rook, at = (n) => gr.entry.findIndex((e) => e.node === n);
  const firstGen = gr.entry.findIndex((e) => /^qs\./.test(e.node));
  assert.ok(firstGen > 0, 'rook has generated errand rows');
  for (const n of ['rook.call.ready.1', 'rook.call.active', 'rook.mirror.active', 'rook.ford.1']) assert.ok(at(n) >= 0 && at(n) < firstGen, n + ' precedes the errands');
  assert.ok(at('rook.ford.repeat2') > firstGen, 'repeat chatter comes after the errands');
}

// 5. deterministic / idempotent output
assert.equal(JSON.stringify(generateAll({ bear, rook }, defs, snip)), JSON.stringify(generateAll({ bear, rook }, defs, snip)));
console.log('questSnippets.test.js: OK (' + n + ' quests, ' + npcs.length + ' givers)');
