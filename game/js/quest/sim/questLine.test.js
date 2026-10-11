// QL-05 + QL-03: offer gated on Burl's return (flag requires), tracked quest pin (saved as a main flag), J log offered/track rows.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuestBook, AVAILABLE, ACTIVE, UNAVAILABLE } from './questBook.js';
import { createQuestLogScreen } from '../../ui/questLog.js';
const rd = p => JSON.parse(readFileSync(new URL('../../../../content/quests/' + p, import.meta.url)));
const main = { version: 1, id: 'm1', objectives: [{ id: 'wake', text: 'Wake', when: { type: 'flag', id: 'wake', equals: true } }] };
const blue = rd('sq.burl.blue.quest.json');
const other = { version: 1, id: 'sq.two', title: 'Two', giver: { npc: 'rook' }, objectives: [{ id: 'a', text: 'Do a', when: { type: 'flag', id: 'a', equals: true } }] };
const mk = (saved) => createQuestBook(main, [{ ...blue, requires: undefined }, other], saved);
const doneBoars = { version: 1, id: 'burl.boars', title: 'Boars', giver: { npc: 'bear' }, objectives: [{ id: 'k', text: 'Kill', when: { type: 'flag', id: 'k', equals: true } }] };

// the real quest file: needs burl.boars handed in AND Burl home
let b = createQuestBook(main, [doneBoars, blue]);
assert.equal(b.statusOf('sq.burl.blue'), UNAVAILABLE);
b.feed({ type: 'flag:set', key: 'k', value: true }); b.accept('burl.boars'); b.handIn('burl.boars');
assert.equal(b.statusOf('sq.burl.blue'), UNAVAILABLE, 'boars done but Burl not home');
b.feed({ type: 'flag:set', key: 'burl.home', value: true });
assert.equal(b.statusOf('sq.burl.blue'), AVAILABLE, 'Burl home -> offered');
// home flag survives save/load
const s = b.toSave(); assert.equal(createQuestBook(main, [doneBoars, blue], { quest: s.quest, quests: s.quests }).statusOf('sq.burl.blue'), AVAILABLE);

// track: newest by default, pin by id, only active, saved with the main state, cleared on abandon
b = mk();
assert.equal(b.tracked(), -1);
b.accept('sq.two'); assert.equal(b.tracked(), 2);
assert.equal(b.track('sq.burl.blue'), false, 'not active -> cannot be tracked');
assert.equal(b.track('m1'), false);
const b2 = createQuestBook(main, [{ ...blue, requires: undefined }, other]);
b2.accept('sq.burl.blue'); b2.accept('sq.two'); assert.equal(b2.tracked(), 2);
assert.ok(b2.track('sq.burl.blue')); assert.equal(b2.tracked(), 1);
const sv = b2.toSave();
assert.equal(createQuestBook(main, [{ ...blue, requires: undefined }, other], { quest: sv.quest, quests: sv.quests }).tracked(), 1, 'pin saved');
assert.ok(b2.abandon('sq.burl.blue')); assert.equal(b2.tracked(), 2, 'abandon drops the pin');
b2.track(null); assert.equal(b2.tracked(), 2);

// J log: offered list says "Talk to <giver>", T toggles the tracked row
b = createQuestBook(main, [{ ...blue, requires: undefined }, other]);
const log = createQuestLogScreen(b, { giverName: (id) => (id === 'bear' ? 'Burl' : id) });
log.open(); log.handleKey('KeyD'); // SIDE tab
let lines = log.snapshot().lines.join('\n');
assert.ok(/Offered/.test(lines) && /The Blue Ones/.test(lines), lines);
assert.ok(/Talk to Burl/.test(lines) || (log.handleKey('KeyS'), /Talk to/.test(log.snapshot().lines.join('\n'))), 'offered row shows giver');
assert.ok(!/Esc/.test(lines));
b.accept('sq.two'); log.open(); log.handleKey('KeyD'); // SIDE tab
const act = log.snapshot().lines; assert.ok(act.some(l => /\[T\] Track this|\[T\] Tracked/.test(l)));
b.accept('sq.burl.blue'); log.open(); log.handleKey('KeyD'); // SIDE tab // side: two, blue (blue is newest = tracked by default)
log.handleKey('KeyT'); const t1 = b.tracked(); assert.equal(t1, 2, 'T pins the selected quest');
log.handleKey('KeyT'); assert.notEqual(b.tracked(), t1, 'T again unpins back to newest/other');
console.log('questLine ok');
