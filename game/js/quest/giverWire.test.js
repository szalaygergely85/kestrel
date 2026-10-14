// QFIX-S5a-2 (D-098, OB-155): real content. Every non-pending quest offers at its giverNpc and hands in at its turnInNpc; object givers keep
// their object but hand in at a character; markers follow. Run: node game/js/quest/giverWire.test.js
import assert from 'node:assert/strict';
import { createQuestBook } from './sim/questBook.js';
import { giverOf, turnInOf, setPlacedNpcs } from './sim/giverResolve.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
import { fileURLToPath } from 'node:url';

const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const m1 = all.find(d => d.id === 'm1');
const rest = all.filter(d => d.id !== 'm1' && d.giver).map(d => { const c = structuredClone(d); delete c.requires; return c; });
const lists = () => ({ gA: [], gR: [], sA: [], sR: [], gr: [] });
const marks = (b) => { const l = lists(); b.giverMarks(l.gA, l.gR, l.sA, l.sR); b.chainMarks(l.gA, l.gR); b.activeMarks(l.gr); b.dedupeMarks(l.gA, l.gR, l.sA, l.sR, undefined, l.gr); return l; };
const flat = (l) => Object.values(l).flat();

let nNew = 0, nObj = 0, nPend = 0;
for (const d of rest) {
  const wantG = d.objectGiver ? d.giver.npc : (d.pendingNpc ? d.giver.npc : (d.giverNpc || d.giver.npc));
  const wantT = d.pendingNpc ? (d.giver.turnIn || d.giver.npc) : (d.turnInNpc || d.giver.turnIn || d.giver.npc);
  assert.equal(giverOf(d), wantG, d.id + ' giver'); assert.equal(turnInOf(d), wantT, d.id + ' turnIn');
  const b = createQuestBook(m1, rest), i = [...Array(b.count).keys()].find(k => k && b.def(k).id === d.id);
  assert.equal(b.giverOf(i), wantG, d.id + ' book giver');
  if (d.pendingNpc) { nPend++; continue; }
  if (d.objectGiver) { nObj++; assert.ok(d.turnInNpc && d.turnInNpc !== d.giver.npc, d.id + ': object giver hands in at a character'); }
  nNew++;
  // offer: '!' on the giver entity, plan(giver) = offer
  if (b.status(i) === 1) {
    assert.equal(b.plan(wantG)?.id && b.plan(wantG).action, 'offer', d.id + ' offer at giver');
    assert.ok(flat(marks(b)).includes(wantG), d.id + ' ! at giver');
  }
  if (!b.accept(d.id)) continue;
  assert.ok(marks(b).gr.includes(wantT) || flat(marks(b)).includes(wantT), d.id + ' grey ? at hand-in ' + wantT);
}
// pending: no crash, old ids until the NPC is registered as placed
const pend = rest.filter(d => d.pendingNpc && d.giverNpc && !d.objectGiver)[0];
if (pend) { assert.equal(giverOf(pend), pend.giver.npc); setPlacedNpcs([pend.giverNpc]); assert.equal(giverOf(pend), pend.giverNpc); setPlacedNpcs(null); }
assert.ok(nNew >= 40 && nObj === 6 - rest.filter(d => d.objectGiver && d.pendingNpc).length, `counts new=${nNew} obj=${nObj} pend=${nPend}`);
console.log(`giverWire OK: ${nNew} resolved, ${nObj} object givers, ${nPend} pending`);
