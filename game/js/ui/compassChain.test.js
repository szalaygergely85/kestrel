// COMPASS-QUEST-01: the compass has a target at every step of the m1 chain. Run: node game/js/ui/compassChain.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCompassHud, FALLBACK_COMPASS_STYLE } from './compassHud.js';
import { createQuestBook } from '../quest/sim/questBook.js';
const rd = (f) => JSON.parse(readFileSync(new URL('../../../content/quests/' + f, import.meta.url)));
const m1 = rd('m1.quest.json'), blade = rd('tower.blade.quest.json'), burl = rd('burl.boars.quest.json');
// host tables copied from main.js intent: every flag/item/area/beast id must map to a world entity
const flagMap = { 'quest.burl.boars.done': 'bear', 'burl.arrived': 'bear', 'waystone.waystone.woken': 'endMarker', 'waystone.ws_roadBend.woken': 'relayBend', 'waystone.ws_ford.woken': 'relayFord' };
const ents = { bear: [1, 1], endMarker: [2, 2], relayBend: [3, 3], relayFord: [4, 4], 'tower.sword': [5, 5], noteKeepLight: [6, 6], boar1: [7, 7], boar2: [8, 8], boar3: [9, 9], boar4: [1, 2], boar5: [2, 3] };
const itemMap = { sword: 'tower.sword' };
const world = { resolve(kind, id, out) {
  let p = null;
  if (kind === 'giver') p = ents[id]; else if (kind === 'flag') p = ents[flagMap[id]]; else if (kind === 'item') p = ents[itemMap[id]];
  else if (kind === 'beast') p = ents[id]; else if (kind === 'area') p = ['breach', 'towerDoor', 'roadWest', 'bendRelay'].includes(id) ? [9, 9] : null;
  if (!p) return false; out.x = p[0]; out.y = p[1]; return true; } };
const book = createQuestBook(m1, [blade, burl]);
const hud = createCompassHud({ style: FALLBACK_COMPASS_STYLE });
const need = (label) => assert.ok(hud.target(book, world), 'compass target at: ' + label);
need('start (note giver)');
const feed = (e) => book.feed(e);
const dead = [];
book.actKey('q.tower.blade.accept'); need('note read: blade accepted, wake');
feed({ type: 'flag:set', key: 'wake', value: true }); need('breach');
feed({ type: 'area:entered', id: 'breach' }); need('sword (item step)');
feed({ type: 'item:got', id: 'sword' }); need('tower door');
feed({ type: 'area:entered', id: 'towerDoor' }); need('Burl hand-in (blade ready)');
book.handIn('tower.blade'); need('Burl offers boars');
book.accept('burl.boars'); need('boars (beast step)');
for (let i = 1; i <= 5; i++) { feed({ type: 'beast:died', id: 'boar' + i }); if (i < 5) need('boar ' + i); }
need('Burl hand-in (boars ready)');
book.handIn('burl.boars'); need('follow (burl.arrived) after hand-in');
feed({ type: 'flag:set', key: 'burl.arrived', value: true }); need('stone');
feed({ type: 'flag:set', key: 'waystone.waystone.woken', value: true }); need('road');
feed({ type: 'area:entered', id: 'roadWest' }); need('relay found');
feed({ type: 'area:entered', id: 'bendRelay' }); need('wake relay');
// every `when` in the three quests resolves through the host tables
for (const d of [m1, blade, burl]) for (const o of d.objectives) {
  const w = o.when, tmp = { x: 0, y: 0 };
  if (w.type === 'beasts') assert.ok(w.ids.every((i) => world.resolve('beast', i, tmp)), o.id);
  else assert.ok(world.resolve(w.type, w.id, tmp) || (w.type === 'flag' && w.id === 'wake'), 'resolvable: ' + d.id + '.' + o.id);
}
console.log('compassChain: ok');
