// COMPASS-TRACK-01 (D-108): needle follows the TRACKED quest only; READY -> hand-in character (+ side colour). Run: node game/js/ui/compassTrack.test.js
import assert from 'node:assert/strict';
import { createCompassHud, FALLBACK_COMPASS_STYLE } from './compassHud.js';
import { createQuestBook, READY } from '../quest/sim/questBook.js';
const ents = { main: [10, 0], gA: [20, 0], tA: [30, 0], gB: [40, 0], tB: [50, 0], stepA: [60, 0], stepB: [70, 0], offer: [80, 0] };
const world = { resolve(kind, id, out) { const p = ents[id]; if (!p) return false; out.x = p[0]; out.y = p[1]; return true; } };
const q = (id, giver, turnIn, step, extra = {}) => ({ version: 1, id, name: id, giver: { npc: giver, turnIn }, objectives: [{ id: 'o', text: 's', when: { type: 'area', id: step } }], reward: { items: [] }, ...extra });
const m1 = { version: 1, id: 'm1', name: 'm1', objectives: [{ id: 'a', text: 'a', when: { type: 'area', id: 'main' } }, { id: 'b', text: 'b', when: { type: 'area', id: 'nope' } }] };
const A = q('qa', 'gA', 'tA', 'stepA', { main: true }), B = q('qb', 'gB', 'tB', 'stepB'), C = q('qc', 'offer', 'offer', 'stepA');
const book = createQuestBook(m1, [A, B, C]);
const hud = createCompassHud({ style: FALLBACK_COMPASS_STYLE });
const at = () => { const t = hud.target(book, world); return t ? t.x : null; };
const isMainQ = (id) => book.isMain(book.index ? book.index(id) : [A, B, C].findIndex(d => d.id === id) + 1);
assert.equal(at(), 20, 'OB-211: nothing accepted -> the gold ! giver of the next main quest (qa @ gA), never the m1 step place');
book.accept('qa'); assert.equal(at(), 60, 'tracked qa: its step');
book.accept('qb'); assert.equal(at(), 70, 'qb most recent -> tracked');
assert.ok(book.track('qa')); assert.equal(at(), 60, 'switch tracking -> needle switches at once');
assert.ok(book.track('qb')); assert.equal(at(), 70);
book.feed({ type: 'area:entered', id: 'stepB' }); // qb ready
assert.equal(book.status(2), READY, 'qb ready');
const t = hud.target(book, world);
assert.equal(t.x, 50, 'ready tracked qb -> its hand-in character'); assert.equal(t.kind, 1);
assert.equal(hud.side, isMainQ('qb') ? false : true, 'side quest return in blue');
assert.ok(book.track('qa')); assert.equal(at(), 60, 'tracking qa ignores qb ready hand-in');
book.feed({ type: 'area:entered', id: 'stepA' });
assert.equal(hud.target(book, world).x, 30, 'qa ready -> tA'); assert.equal(hud.side, false, 'main quest return in gold');
book.handIn('qa'); book.handIn('qb');
assert.equal(book.tracked(), -1, 'nothing tracked'); assert.equal(at(), 80, 'OB-211: nothing tracked -> a giver character (qc @ offer), not the m1 step place');
console.log('compassTrack: ok');
