import assert from 'node:assert/strict';
import { lintDialogue, lintInspect, lintDialogueDir } from './dialogue-lint.mjs';
import { fileURLToPath } from 'node:url';

const ok = () => ({ entry: [{ node: 'a' }], nodes: { a: { lines: ['x'], next: 'b' }, b: { end: true, lines: ['y'] } } });
const rules = (d) => lintDialogue(d, 't').map((h) => h.rule).sort().join(',');
assert.equal(rules(ok()), '', 'clean fixture');
let d = ok(); d.nodes.a.next = 'zz'; assert.match(rules(d), /GOTO/);
d = ok(); d.nodes.c = { end: true, lines: ['z'] }; assert.equal(rules(d), 'REACH');
d = ok(); delete d.nodes.b.end; assert.equal(rules(d), 'DEAD');
d = ok(); d.nodes.a = { lines: ['x'], choices: [{ next: 'b', text: 'Ok', setFlag: 'q.x.accept' }] }; assert.equal(rules(d), 'OFFER', 'accept without Exit sibling');
d = ok(); d.nodes.a = { lines: ['x'], choices: [{ next: 'b', text: 'Ok', setFlag: 'q.x.accept' }, { next: 'b', text: 'No' }] }; assert.equal(rules(d), '', 'proper offer node');
d = ok(); d.nodes.a.setFlag = 'q.x.accept'; assert.equal(rules(d), 'OFFER', 'node-level accept flag');
d = ok(); d.nodes.b.setFlag = 'Bad Flag'; assert.equal(rules(d), 'FLAG');
d = ok(); d.nodes.a = { lines: ['x'], choices: [{ next: 'b', text: 'y'.repeat(57) }, { next: 'b', text: 'ok' }] }; assert.equal(rules(d), 'CHOICELEN');
assert.equal(lintInspect({ texts: { k: { lines: ['z'.repeat(60)] } } }).length, 1);

// real content must be clean
const hits = lintDialogueDir(fileURLToPath(new URL('../content/dialogue', import.meta.url)));
assert.deepEqual(hits, [], hits.map((h) => `${h.rule} ${h.where}: ${h.msg}`).join('\n'));
console.log('dialogue-lint.test: ok');
