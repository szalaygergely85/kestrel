// OB-221: journal groups quests under a gold "Main" and a blue "Side" heading (main first, empty group has no heading); selection walks the quests in order.
// Run: node game/js/ui/questLogGroups.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUiLayer } from '../../../engine/index.js';
import { createQuestBook } from '../quest/sim/questBook.js';
import { createQuestLogScreen } from './questLog.js';

const rd = n => JSON.parse(readFileSync(new URL('../../../content/quests/' + n, import.meta.url)));
const main = { ...rd('m1.quest.json'), internal: false }, /* M1-RETIRE: legacy-mechanism test on a VISIBLE copy of m1 (the real m1 is internal; m1Retire.test.js covers the player view) */ blade = rd('tower.blade.quest.json');
const side = (id, title) => ({ version: 1, id, title, giver: { npc: 'g' + id }, objectives: [{ id: 'o', text: 'Do ' + title, journal: 'j', when: { type: 'area', id: 'a' + id } }] });
const sA = side('sq.a', 'Side Alpha'), sB = side('sq.b', 'Side Beta');
const ui = createUiLayer({ cols: 160 });
const book = createQuestBook(main, [blade, sA, sB]);
const log = createQuestLogScreen(book);
log.open(); log.draw(ui);
assert.deepEqual(log.snapshot().groups, ['main'], 'wake step only: Side heading hidden (empty group)');
book.feed({ type: 'flag:set', key: 'wake', value: true });
book.accept('sq.a'); book.accept('tower.blade'); book.accept('sq.b');
log.open(); log.draw(ui);
let s = log.snapshot();
assert.deepEqual(s.groups, ['main', 'side']);
assert.equal(s.view[0], 'Main'); assert.equal(s.view[1], 'Not Safe');
const si = s.view.indexOf('Side'); assert.ok(si > 1, 'Side heading after the main rows');
assert.deepEqual(s.view.slice(si + 1).sort(), ['Side Alpha', 'Side Beta'], 'side quests under Side');
assert.ok(s.left.indexOf('Not Safe') < s.left.indexOf('Side Alpha') && s.left.indexOf('Not Safe') < s.left.indexOf('Side Beta'), 'main first: ' + s.left);
// keyboard walks every quest row in order (headings are not stops)
const seen = [];
for (let k = 0; k < s.left.length; k++) { log.draw(ui); seen.push(log.snapshot().right[0]); log.handleKey('KeyS'); }
assert.deepEqual(seen, s.left, 'selection order = list order, headings skipped');
// mouse: click a Side row selects it, a heading click is swallowed; rows below headings are offset by the heading row
const b = log.draw(ui); log.handleKey('KeyS'); // wraps to the first
const rowY = v => b.y + 6 + v; // LIST_TOP = 6
assert.equal(log.handleClick(b.x + 6, rowY(0)), true, 'heading click consumed'); log.draw(ui);
assert.equal(log.snapshot().right[0], s.left[1 % s.left.length], 'heading click does not move the selection');
assert.equal(log.handleClick(b.x + 6, rowY(si + 1)), true); log.draw(ui);
assert.equal(log.snapshot().right[0], s.view[si + 1], 'clicking the row under the Side heading selects it');
console.log('questLogGroups OK');
