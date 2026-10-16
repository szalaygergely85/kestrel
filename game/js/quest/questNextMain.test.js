// OB-210 / OB-211 (D-108 amendment) on the REAL content: after Burl's stone hand-in Burl offers "The Road West" (burl.road);
// with no accepted quest the compass needle points at the character with the gold '!', never at a bare place; a tracked quest keeps D-108;
// saves from before burl.road existed migrate without lost progress. Run: node game/js/quest/questNextMain.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadQuestFiles } from '../questBoot.js';
import { createQuestRelay } from '../questRelay.js';
import { gateOnMeet } from './errands.js';
import { AVAILABLE, ACTIVE, DONE } from './sim/questBook.js';
import { createCompassHud, FALLBACK_COMPASS_STYLE } from '../ui/compassHud.js';
import { loadDesignAssets } from '../../../tools/validate-content.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const rd = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const assets = await loadDesignAssets();
const items = Object.values(assets.items?.defs || {}).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const qb = await loadQuestFiles((u) => Promise.resolve(rd(u.replace(/^(\.\.\/)+/, ''))), { wantBarks: false, log: () => {}, items });
const m1 = qb.questDef, defs = gateOnMeet(qb.giverDefs);
const POS = { 'giver:bear': [100, 0], 'giver:rook': [200, 0], 'area:roadWest': [300, 0], 'area:bendRelay': [400, 0] };
const world = { resolve(kind, id, out) { const p = POS[kind + ':' + id]; if (!p) return false; out.x = p[0]; out.y = p[1]; out.z = NaN; return true; } };
const needle = (r) => { const t = createCompassHud({ style: FALLBACK_COMPASS_STYLE }).target(r.book, world); return t ? t.x + '/' + t.kind : null; };

// drive one quest's objectives with real events
function satisfy(r, def) {
  for (const o of def.objectives) {
    const w = o.when;
    if (w.type === 'flag') r.questFlag(w.id, w.equals === undefined ? true : w.equals);
    else if (w.type === 'item') r.feed({ type: 'item:got', id: w.id });
    else if (w.type === 'area') r.pollAreas(500, 500, 2, [{ id: w.id, x: 500, y: 500, r: 3, zMin: 0 }]);
    else if (w.type === 'beasts') for (let n = 0; n < w.count; n++) r.feed({ type: 'beast:died', id: w.kind !== undefined ? w.kind + 'T' + n : w.ids[n] });
  }
}
// play the opening chain (m1) up to and including `stepId` through the quests that own its steps
function playTo(r, stepId) {
  for (const o of m1.objectives) {
    if (!r.state.completed.includes(o.id)) {
      const dep = o.when.type === 'flag' && /^quest\.(.+)\.done$/.exec(o.when.id), def = dep && defs.find((d) => d.id === dep[1]);
      if (def) { r.book.accept(def.id); satisfy(r, def); assert.ok(r.book.handIn(def.id), 'hand in ' + def.id); }
      else satisfy(r, { objectives: [o] });
    }
    if (o.id === stepId) return;
  }
}

// 1. fresh game: Burl's stone hand-in -> Burl offers burl.road; no accepted quest -> needle at Burl (gold '!')
const r = createQuestRelay(m1, null, defs, null);
playTo(r, 'stoneDone');
assert.equal(r.book.statusOf('burl.stone'), DONE);
assert.equal(r.book.tracked(), -1, 'no accepted quest after the hand-in');
assert.equal(r.book.statusOf('burl.road'), AVAILABLE, 'Burl offers The Road West right after the hand-in');
assert.equal(r.book.giverOf(r.book.index('burl.road')), 'bear');
assert.equal(needle(r), '100/3', 'OB-211: needle -> Burl (the gold ! of the next main quest), not the road place');
// 2. tracked quest: D-108 unchanged (objective, then the hand-in character)
assert.ok(r.book.accept('burl.road'));
assert.equal(needle(r), '300/2', 'tracked burl.road -> its objective (road west)');
satisfy(r, r.book.def(r.book.index('burl.road')));
assert.equal(needle(r), '200/1', 'ready -> hand-in character Rook');
assert.ok(r.book.handIn('burl.road'));
assert.equal(r.book.statusOf('mq.bend.call'), AVAILABLE, 'Rook offers The Call Carries after the hand-in');
assert.equal(needle(r), '200/3', 'no accepted quest -> Rook (gold !)');

// 3. old saves (made before burl.road existed): drop burl.road from the save, m1 facts decide
const old = (fn) => {
  const r0 = createQuestRelay(m1, null, defs, null); playTo(r0, 'stoneDone'); fn(r0);
  const s = JSON.parse(JSON.stringify(r0.book.toSave())); delete s.quests['burl.road'];
  return createQuestRelay(m1, s.quest, defs, s.quests);
};
let o = old(() => {});
assert.equal(o.book.statusOf('burl.road'), AVAILABLE, 'old save before Burl sent the player off: offered');
o = old((x) => x.questFlag('burl.departing', true));
assert.equal(o.book.statusOf('burl.road'), ACTIVE, 'old save after Burl left: accepted (no second offer from a gone bear)');
assert.equal(needle(o), '300/2');
o = old((x) => { x.questFlag('burl.departing', true); playTo(x, 'relayFound'); });
assert.equal(o.book.statusOf('burl.road'), ACTIVE); assert.deepEqual(o.book.questState(o.book.index('burl.road')).completed, ['road', 'find'], 'facts kept');
o = old((x) => { x.questFlag('burl.departing', true); playTo(x, 'relay1'); });
assert.equal(o.book.statusOf('burl.road'), DONE, 'old save past the Bend wake: handed in (no lost progress)');
assert.equal(o.book.statusOf('mq.bend.call'), AVAILABLE, 'and Rook still offers The Call Carries');
console.log('questNextMain ok');
