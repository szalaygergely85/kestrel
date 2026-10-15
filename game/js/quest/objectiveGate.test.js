// OB-199 (rule OB-156/D-082): a not-yet-accepted quest gives no top-left objective line and no compass needle; after accept it does.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createQuestBook, ACTIVE } from './sim/questBook.js';
import { createCompassHud } from '../ui/compassHud.js';
import { createQuestRelay } from '../questRelay.js';

const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const rd = (f) => JSON.parse(fs.readFileSync(dir + '/' + f + '.quest.json', 'utf8'));
const m1 = rd('m1'), give = ['tower.blade', 'burl.boars', 'burl.follow', 'burl.stone'].map(rd);
const book = createQuestBook(m1, give), feed = (e) => book.feed(e);
const world = { resolve(kind, id, out) { out.x = 5; out.y = 5; out.z = 0; return true; } };
const compass = createCompassHud({});
const needle = () => { const t = compass.target(book, world); return t && t.kind === 2; };

feed({ type: 'flag:set', key: 'wake', value: true });
assert.equal(book.mainStepGated(), false, 'wake/breach: no giver quest owns the step -> auto-active');
// breach/sword/leave belong to tower.blade (object giver note): offered until read
assert.equal(book.mainStepGated(), false);
// walk to the waystone step by accepting each giver quest as the chain demands
const accept = (id) => assert.ok(book.accept(id), 'accept ' + id);
accept('tower.blade'); feed({ type: 'area:entered', id: 'breach' }); feed({ type: 'item:got', id: 'sword' }); feed({ type: 'area:entered', id: 'towerDoor' });
book.handIn('tower.blade');
// beasts: boars offered, not accepted -> gated
assert.equal(book.mainStepGated(), true, 'boars offered: gated');
assert.equal(needle(), false, 'no compass needle before accept');
accept('burl.boars');
assert.equal(book.mainStepGated(), false, 'boars accepted: shown');
assert.equal(needle(), true, 'compass needle after accept');
feed({ type: 'beast:died', id: 'boar1' }); for (const b of ['boar2', 'boar3', 'boar4', 'boar5']) feed({ type: 'beast:died', id: b });
book.handIn('burl.boars');
accept('burl.follow'); feed({ type: 'flag:set', key: 'burl.arrived', value: true }); book.handIn('burl.follow');
// waystone: burl.stone offered (OB-199) -> gated until accepted
assert.equal(book.mainStepGated(), true, 'waystone offered: gated');
assert.equal(needle(), false, 'no needle at the unaccepted waystone');
accept('burl.stone');
assert.equal(book.mainStepGated(), false, 'waystone accepted: shown');
assert.equal(needle(), true);
console.log('objectiveGate: ok');
// OB-200: accepted/active -> no '!' (any colour) over the giver
{ const gA = [], gR = [], sA = [], sR = []; book.markLists(gA, gR, sA, sR); assert.deepEqual([gA, gR, sA, sR], [[], [], [], []], 'stone active: no ! over Burl'); }
