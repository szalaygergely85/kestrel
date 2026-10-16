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

import { AVAILABLE as AVAILABLE_ST } from './quest/sim/questBook.js';
// ---- QUEST-NEXT-GIVER-01: m1 -> mq.bend.call through the real content / relay / offerToast / compass
{
  const { loadQuestFiles } = await import('./questBoot.js');
  const { createOfferToast } = await import('./quest/offerToast.js');
  const { GIVER_INFO } = await import('./questNext.js');
  const { gateOnMeet } = await import('./quest/errands.js');
  const root = new URL('../../', import.meta.url);
  const { loadDesignAssets } = await import('../../tools/validate-content.mjs');
  const idefs = (await loadDesignAssets()).items?.defs || {};
  const itemList = Object.values(idefs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
  const qb = await loadQuestFiles((u) => Promise.resolve(JSON.parse(readFileSync(new URL(u.replace(/^(\.\.\/)+/, ''), root)))), { wantBarks: false, log: () => {}, items: itemList });
  const real = gateOnMeet(qb.giverDefs);
  const mk = (saved) => createQuestRelay(qb.questDef, saved || null, real, null);
  const wd = { resolve: (k, id, o) => { const p = k === 'giver' ? pos[id] : [5, 5]; if (!p) return false; o.x = p[0]; o.y = p[1]; return true; } };
  const nm = (g) => (GIVER_INFO[g] ? GIVER_INFO[g].name : g.charAt(0).toUpperCase() + g.slice(1));
  const ids = qb.questDef.objectives.map((o) => o.id), k = ids.indexOf('relay1');
  // state just before the relay step: every earlier m1 step done, nothing else accepted
  const base = JSON.parse(JSON.stringify(mk().state)); base.completed = ids.slice(0, k); base.flags = {};
  for (const o of qb.questDef.objectives.slice(0, k)) if (o.when.type === 'flag') base.flags[o.when.id] = true;
  const rl = mk(base), bk = rl.book;
  const toast = createOfferToast(bk, nm); toast.seed();
  const h = createCompassHud({ style: FALLBACK_COMPASS_STYLE }); h.setNear(0, 0);
  const tgtOf = (b) => { const t2 = h.target(b, wd); return t2 ? t2.x + ',' + t2.y + ',' + t2.kind : null; };
  assert.notEqual(bk.statusOf('mq.bend.call'), AVAILABLE_ST, 'bend quest not offered before the relay step');
  assert.deepEqual(toast.poll(), [], 'no toast yet');
  rl.questFlag('waystone.ws_roadBend.woken', true); // the real step event
  assert.equal(bk.statusOf('mq.bend.call'), AVAILABLE_ST, 'bend quest offered after the relay step');
  const tl = [...toast.poll()]; assert.ok(tl.includes('New quest: Rook has work for you'), 'toast with the plain giver name: ' + tl);
  assert.ok(tl.every((l) => /^New quest: [A-Z][a-z]+ has work for you$/.test(l)), 'plain display names only: ' + tl);
  assert.equal(tgtOf(bk), '982,1060,3', 'compass needle -> Rook, kind 3 (!)');
  const saved = JSON.parse(JSON.stringify(rl.state)); // save/load in the gap keeps the pointer
  const rl2 = mk(saved); h.setNear(0, 0);
  assert.equal(rl2.book.statusOf('mq.bend.call'), AVAILABLE_ST); assert.equal(tgtOf(rl2.book), '982,1060,3', 'pointer survives save/load');
  const t3 = createOfferToast(rl2.book, nm); t3.seed(); assert.deepEqual([...t3.poll()], [], 'no re-toast after load');
  // tracking/accepting another quest replaces the pointer
  const other = ['sq.burl.blue', 'tower.blade'].find((id) => rl2.book.statusOf(id) === AVAILABLE_ST);
  if (other) { rl2.book.accept(other); const t4 = tgtOf(rl2.book); assert.notEqual(t4, '982,1060,3', 'tracking ' + other + ' replaces the Rook pointer'); }
  // accepting the bend quest clears the "next giver" pointer (needle now follows its step, not the giver offer)
  const rl3 = mk(saved); rl3.book.accept('mq.bend.call');
  assert.ok(!rl3.book.nextOffers().some((o) => o.id === 'mq.bend.call'), 'accepted: no longer an offer');
  assert.notEqual(tgtOf(rl3.book), '982,1060,3', 'accept clears the pointer');
  console.log('questNext e2e (m1 -> mq.bend.call): ok');
}
