import assert from 'node:assert/strict';
import { questDiff, diffText } from './diff.js';
const mk = (raw) => ({ id: 'x', raw: structuredClone(raw) });
const base = { id: 'x', title: 'T', requires: ['a'], reward: { xp: 5, items: [{ id: 'sword' }] }, objectives: [{ kind: 'goto', text: 'A' }, { kind: 'flag', text: 'B' }], lines: { offer: ['hi'] } };
const dmOf = (lines) => { const o = { entry: [{ requires: 'q.x.available', node: 'n1' }], nodes: { n1: { lines } } }; return { files: new Map([['f.dialogue.json', { name: 'f.dialogue.json', obj: structuredClone(o), orig: structuredClone(o) }]]) }; };
// no-op
assert.deepEqual(questDiff(base, mk(base), dmOf(['a'])), []);
assert.equal(diffText([]), 'No changes\n');
// field change
let q = mk(base); q.raw.title = 'U';
let d = questDiff(base, q); assert.equal(d.length, 1); assert.deepEqual([d[0].label, d[0].old, d[0].new], ['title', 'T', 'U']);
// objective field change
q = mk(base); q.raw.objectives[1].text = 'C';
d = questDiff(base, q); assert.equal(d.length, 1); assert.equal(d[0].label, 'Objective 2.text'); assert.equal(diffText(d), 'Objective 2.text: "B" -> "C"\n');
// add / remove
q = mk(base); q.raw.objectives.push({ kind: 'flag', text: 'D' });
d = questDiff(base, q); assert.equal(d.length, 1); assert.equal(d[0].kind, 'added');
q = mk(base); q.raw.objectives.pop(); d = questDiff(base, q); assert.equal(d[0].kind, 'removed');
// reorder
q = mk(base); q.raw.objectives.reverse(); d = questDiff(base, q); assert.equal(d.length, 1); assert.equal(d[0].kind, 'moved');
// reward
q = mk(base); q.raw.reward.xp = 9; d = questDiff(base, q); assert.deepEqual([d[0].label, d[0].card, d[0].new], ['reward.xp', 'rewards', 9]);
// pack line + dialogue line
q = mk(base); q.raw.lines.offer[0] = 'yo'; d = questDiff(base, q); assert.equal(d[0].label, 'Offer line 1');
const dm = dmOf(['a']); dm.files.get('f.dialogue.json').obj.nodes.n1.lines = ['b', 'c'];
d = questDiff(base, mk(base), dm); assert.equal(d.length, 2); assert.equal(d[0].kind, 'changed'); assert.equal(d[1].kind, 'added'); assert.equal(d[0].card, 'conversation');
console.log('diff.test ok');
