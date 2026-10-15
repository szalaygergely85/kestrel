// OB-183: never stuck - 'Next: talk to <giver>' when no main quest is active. Run: node game/js/questNext.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuestRelay } from './questRelay.js';
import { createCompassHud, FALLBACK_COMPASS_STYLE } from './ui/compassHud.js';
import { createQuestLogScreen } from './ui/questLog.js';
import { nextLine, EXPLORE_TEXT } from './questNext.js';
const rd = (f) => JSON.parse(readFileSync(new URL('../../content/quests/' + f, import.meta.url)));
const m1 = rd('m1.quest.json'), defs = ['tower.blade', 'burl.boars', 'burl.follow', 'burl.stone', 'mq.bend.call', 'mq.ford.stones', 'mq.ford.mirror', 'mq.river.road', 'mq.smoke', 'sq.burl.blue'].map((n) => rd(n + '.quest.json'));
const pos = { rook: [982, 1060], bear: [100, 100], hesk: [500, 500] };
const world = { resolve(kind, id, out) { const p = kind === 'giver' && pos[id]; if (!p) return false; out.x = p[0]; out.y = p[1]; return true; } };
const ctx = { resolve: world.resolve, x: 0, y: 0 };

// nothing available: explore text
const empty = createQuestRelay(m1, null, [], null);
assert.equal(empty.book.count, 1);
// finish m1 completely (all steps) by feeding every objective; then hand in what the book offers until nothing blocks
const relay = createQuestRelay(m1, null, defs, null); relay.nextCtx = ctx;
const b = relay.book;
assert.equal(nextLine(b, ctx), null, 'fresh game: m1 active -> normal objective, no Next');
assert.ok(!relay.objectiveText().startsWith('Next:'));
// force "no active main quest, mq.bend.call available": complete m1 by restoring a state where every step is done
const full = JSON.parse(JSON.stringify(relay.state));
full.completed = m1.objectives.map((o) => o.id); full.flags = {}; 
const r2 = createQuestRelay(m1, full, defs, null); r2.nextCtx = ctx;
const t = r2.objectiveText();
console.log('after m1:', t, '| statuses', [...Array(r2.book.count).keys()].map((i) => r2.book.def(i).id + ':' + r2.book.status(i)).join(' '));
assert.ok(t.startsWith('Next: talk to Rook'), t);
assert.match(t, /\(.+\)/, 'place named');
// compass targets Rook
const hud = createCompassHud({ style: FALLBACK_COMPASS_STYLE });
hud.setNear(0, 0);
const tg = hud.target(r2.book, world);
assert.ok(tg && tg.x === 982 && tg.y === 1060, 'compass -> Rook');
// journal shows Next at top
const log = createQuestLogScreen(r2.book, { nextCtx: () => ctx });
log.open();
const cells = []; const ui = { cols: 100, rows: 40, setCell(x, y, ch) { (cells[y] ||= [])[x] = ch; }, setCellRGB() {} };
log.draw(ui);
assert.ok(cells.some((r) => r && r.join('').includes('Next: talk to Rook')), 'journal Next line');
// accepting it -> active main quest -> normal objective shows
r2.book.accept('mq.bend.call');
assert.ok(!r2.objectiveText().startsWith('Next:'), r2.objectiveText());
assert.equal(nextLine(r2.book, ctx), null);
// nothing available at all
const none = createQuestRelay(m1, full, [], null);
assert.equal(none.objectiveText(), EXPLORE_TEXT);
console.log('questNext: ok');
