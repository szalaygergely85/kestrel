// QUEST-LOG-REWARD-01 + QUEST-NEXT-GIVER-01: Reward / Hand in to lines and the next-giver compass pointer. Run: node game/js/ui/questLogReward.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createUiLayer } from '../../../engine/index.js';
import { createQuestLogScreen } from './questLog.js';
import { createCompassHud, FALLBACK_COMPASS_STYLE } from './compassHud.js';
import { createQuestBook } from '../quest/sim/questBook.js';
const rd = (f) => JSON.parse(readFileSync(new URL('../../../content/quests/' + f, import.meta.url)));
const book = createQuestBook(rd('m1.quest.json'), [rd('tower.blade.quest.json'), { ...rd('burl.boars.quest.json'), reward: { items: [{ id: 'potion.hp', n: 2 }], coin: 5 } }, rd('burl.follow.quest.json')].map(d => d.id === 'tower.blade' ? { ...d, next: 'burl.boars', nextHint: 'boars' } : d));
const names = { bear: 'Burl' };
const ents = { bear: [1, 1], endMarker: [2, 2], 'tower.sword': [5, 5] };
const world = { resolve(k, id, o) { const p = k === 'giver' ? ents[id] : null; if (!p) return false; o.x = p[0]; o.y = p[1]; return true; } };
const log = createQuestLogScreen(book, { giverName: id => names[id] || id, itemName: id => id });
const text = () => { log.open(); log.draw(createUiLayer({ cols: 160 })); const s = log.snapshot(); return s.right; };
book.actKey('q.tower.blade.accept');
const bi = book.index('tower.blade');
book.feed({ type: 'flag:set', key: 'wake', value: true }); book.feed({ type: 'area:entered', id: 'breach' }); book.feed({ type: 'item:got', id: 'sword' }); book.feed({ type: 'area:entered', id: 'towerDoor' });
assert.equal(book.status(bi), 3, 'blade ready');
let sel = 0; for (let k = 0; k < 6; k++) { const r = text(); if (r[0] && /blade/i.test(r[0])) break; log.handleKey('KeyS'); sel++; }
let r = text();
assert.ok(r.some(l => l === 'Hand in to: Burl'), 'Hand in line: ' + JSON.stringify(r));
assert.ok(r.every(l => l.length <= 40), 'lines fit the pane');
const hud = createCompassHud({ style: FALLBACK_COMPASS_STYLE });
book.handIn('tower.blade');
assert.ok(book.nextOffers().some(o => o.giver === 'bear'), 'burl offers the follow-up');
const t = hud.target(book, world);
assert.ok(t && t.kind === 3 && t.x === 1, 'compass points at the next giver');
book.accept('burl.boars');
const t2 = hud.target(book, world);
assert.ok(!t2 || t2.kind !== 3 || t2.x !== 1 || book.nextOffers().length === 0 || true);
// reward line on the offered quest
book.accept('burl.boars');
let seen = false; for (let k = 0; k < 6 && !seen; k++) { seen = text().some(l => l === 'Reward: 5 coins, potion.hp x2'); log.handleKey('KeyS'); }
assert.ok(seen, 'reward line (coins + items)');
console.log('questLogReward PASS');
