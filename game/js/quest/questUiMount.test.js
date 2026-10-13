// QG-04 / QG-05: giver marker source per status, map marker kinds, J binding, quest log open/close (the pause relation in main.js is qlIsOpen()).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../../design/palette.js';
import '../../../design/models/quest_mark.js';
import { createGameHooks } from '../gameHooks.js';
import { createQuestBook } from './sim/questBook.js';
import { createQuestMarks } from './wire/questMarks.js';
import { createChartCard } from './mapCard.js';
import { createSafeBindings, resolveGameKeys } from '../gameKeys.js';
import { createQuestLogScreen } from '../ui/questLog.js';

const rd = n => JSON.parse(readFileSync(new URL('../../../content/quests/' + n, import.meta.url)));
const main = rd('m1.quest.json'); main.objectives.find(o => o.id === 'beasts').when = { type: 'flag', id: 'quest.burl.boars.done', equals: true };
const burl = rd('burl.boars.quest.json'), blade = rd('tower.blade.quest.json');
const book = createQuestBook(main, [blade, burl]);
const fx = globalThis.ASSETS.questMarkFx;

// two marker instances fed by book.giverMarks, same shape as main.js
const aList = [], rList = [];
function inst(list) {
  const hooks = createGameHooks(), ents = [];
  const host = { fx, resolve: (id, o) => { o.x = 5; o.y = 0; o.z = 1; return true; },
    create: () => { const e = { hidden: true, scale: 1, anim: '', setPos() {} }; ents.push(e); return e; },
    source: (out) => { book.giverMarks(aList, rList); out.done = false; out.targets = list; } };
  const w = createQuestMarks(hooks, host); hooks.register({ onBoot: w.onBoot, onTick: w.onTick });
  hooks.boot(null, { transform: { x: 0, y: 0, z: 0 } }, null, null, null);
  return { w, run: (s) => { for (let i = 0; i < Math.round(s * 60); i++) hooks.tick(1 / 60); }, ents };
}
const A = inst(aList), R = inst(rList);
const state = () => [A.w.active, R.w.active];
const run = (s = 1) => { A.run(s); R.run(s); };
for (const e of [{ type: 'flag:set', key: 'wake', value: true }, { type: 'item:got', id: 'lantern' }, { type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }]) book.feed(e);
run(); assert.deepEqual(state(), [1, 0], "blade available -> '!' (over the note)");
book.accept('tower.blade'); run(); assert.deepEqual(state(), [0, 0], 'blade active -> none');
book.feed({ type: 'area:entered', id: 'towerDoor' }); run(); assert.deepEqual(state(), [0, 1], "blade done -> '?' (over Burl)");
book.handIn('tower.blade'); run(); assert.deepEqual(state(), [1, 0], "blade turned in -> boars '!'");
book.accept('burl.boars'); run(); assert.deepEqual(state(), [0, 0], 'active -> none');
for (const id of ['boar1', 'boar2', 'boar3', 'boar4', 'boar5']) book.feed({ type: 'beast:died', id });
run(); assert.deepEqual(state(), [0, 1], 'ready -> ? only');
book.handIn('burl.boars'); run(); assert.deepEqual(state(), [0, 0], 'done -> none');

// map marker kinds
const palette = globalThis.ASSETS.palette;
const chart = { chartVersion: 1, width: 2, rows: 2, bounds: { x0: 0, y0: 0, x1: 100, y1: 100 }, shadeLevels: 16, categories: ['grass', 'water'], glyphs: ['01', '10'], shades: ['ff', '00'] };
const view = createChartCard(chart, palette, { width: 16, rows: 8 });
const base = view.art.codes.slice();
view.setQuestMarkers([{ kind: 'quest', x: 50, y: 50 }]);
const cell = (x, y) => (1 + Math.floor(y * 6 / 100)) * 16 + 1 + Math.floor(x * 14 / 100);
assert.equal(view.art.codes[cell(50, 50)], 33, 'quest -> !');
view.setQuestMarkers([{ kind: 'questReady', x: 50, y: 50 }]);
assert.equal(view.art.codes[cell(50, 50)], 63, 'questReady -> ?');
view.setQuestMarkers([]); assert.deepEqual([...view.art.codes], [...base], 'cleared back to the plain chart');
assert.throws(() => view.setQuestMarkers([{ kind: 'relay', x: 1, y: 1 }]));
assert.throws(() => createChartCard(chart, palette, { width: 16, rows: 8, markers: [{ kind: 'bogus', x: 1, y: 1 }] }));

// J binding
assert.equal(resolveGameKeys(createSafeBindings(null)).questLog, 'KeyJ');

// quest log opens/closes on J; closed = sim resumes (main.js pauses on isOpen())
const log = createQuestLogScreen(book);
assert.equal(log.isOpen(), false); log.open(); assert.equal(log.isOpen(), true);
assert.equal(log.handleKey('KeyJ'), true); assert.equal(log.isOpen(), false);
log.open(); log.handleKey('Escape'); assert.equal(log.isOpen(), false);
console.log('questUiMount: ok');
