// OB-190: the on-screen objective tracker reaches the HUD buffer for an accepted giver quest (same call chain as main.js: gameHooks.drawHud -> saveRelay handler -> questRelay.draw).
//   node game/js/quest/ob190Tracker.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuestRelay, HUD_ROW } from '../questRelay.js';

const rd = (p) => JSON.parse(readFileSync(new URL('../../../' + p, import.meta.url), 'utf8'));
const m1 = rd('content/quests/m1.quest.json');
const givers = ['tower.blade', 'burl.boars', 'burl.follow', 'burl.stone'].map((n) => rd(`content/quests/${n}.quest.json`));
const r = createQuestRelay(m1, undefined, givers, undefined);
r.world = { state: {} };
function hudText() {
  const cells = new Map();
  const ui = { cols: 120, rows: 40, setCellRGB: (x, y, g) => cells.set(x + ',' + y, String.fromCharCode(g + 32)) };
  r.draw(ui);
  let s = ''; for (let x = 0; x < 120; x++) s += cells.get(x + ',' + HUD_ROW) || ''; return s.trim();
}
console.log('main:', JSON.stringify(hudText()));
assert.ok(hudText().length > 3, 'main quest objective drawn');
const BOARS = givers[1].objectives[0].when.ids;
r.book.actKey('q.tower.blade.accept');
r.feed({ type: 'flag:set', key: 'wake', value: true }); r.feed({ type: 'area:entered', id: 'breach' });
r.feed({ type: 'item:got', id: 'sword' }); r.feed({ type: 'area:entered', id: 'towerDoor' });
console.log('blade ->', r.book.statusOf('tower.blade'), JSON.stringify(hudText()));
r.book.handIn('tower.blade'); r.book.accept('burl.boars');
console.log('boars accepted', r.book.statusOf('burl.boars'), 'tracked', r.book.tracked(), JSON.stringify(hudText()));
assert.ok(hudText().length > 3, 'boars objective drawn');
for (const b of BOARS) r.feed({ type: 'beast:died', id: b });
console.log('boars ready', r.book.statusOf('burl.boars'), JSON.stringify(hudText()));
r.book.handIn('burl.boars'); r.checkSections();
console.log('handed in', r.book.statusOf('burl.boars'), JSON.stringify(hudText()));
r.book.accept('burl.follow');
console.log('follow', r.book.statusOf('burl.follow'), 'tracked', r.book.tracked(), JSON.stringify(hudText()));
assert.equal(r.book.statusOf('burl.follow'), 2);
assert.ok(hudText().length > 3, 'follow objective drawn');
// the vitals bars (design layout hpRow/mpRow, drawn AFTER the tracker in main.js) must not share the tracker row
const lay = readFileSync(new URL('../../../design/models/m3_props.js', import.meta.url), 'utf8').match(/layout: \{ x: 2, hpRow: (\d+), mpRow: (\d+)/);
assert.ok(lay, 'vitals layout found');
assert.ok(HUD_ROW !== +lay[1] && HUD_ROW !== +lay[2], 'tracker row ' + HUD_ROW + ' must not be a vitals row ' + lay[1] + '/' + lay[2]);
console.log('ob190Tracker ok');
