// OB-156 audit (the rule of record): for EVERY quest def in content, simulate the lifecycle and check the markers the game draws
// (book.markLists): prerequisites met -> ONE '!' at the giver (GOLD = main, BLUE = side); accepted -> none; all objectives done ->
// ONE '?' (same colour) at the return point (turnIn, else giver); handed in -> none.
// OB-181: main-chain (m1) steps end at waypoints/waystones, no return character -> no '?' by design until the chain rewrite.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
import { createQuestBook, AVAILABLE, ACTIVE, READY, DONE } from './sim/questBook.js';
import { kindOf } from './sim/quest.js';

// Quests / steps whose DATA has no return character yet (shrinks when the OB-182 chain rewrite lands). Format: 'm1:<step>' or quest id.
export const KNOWN_DATA_GAPS = [
  'm1:leave', 'm1:waystone', 'm1:road', 'm1:relayFound', 'm1:relay1', // OB-181: main steps end at a waypoint/waystone (mark.end), no '?' hand-in
];

const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets?.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const m1 = all.find(d => d.id === 'm1'), defs = all.filter(d => d !== m1);
const book = createQuestBook(m1, defs);
const have = new Map(); // simulated pack counts
book.packOps = { count: id => have.get(id) || 0, remove: (id, n) => { have.set(id, Math.max(0, (have.get(id) || 0) - n)); }, add: (id, n) => { have.set(id, (have.get(id) || 0) + n); return n; }, equipped: () => true };

const lists = () => { const L = [[], [], [], []]; book.markLists(...L); return { gA: L[0], gR: L[1], sA: L[2], sR: L[3] }; };
const problems = []; // [questId, reason]
const bad = (id, why) => problems.push([id, why]);

function drive(d) { // feed every objective of def d in order
  for (const o of d.objectives) {
    const w = o.when;
    if (w.type === 'flag') book.feed({ type: 'flag:set', key: w.id, value: w.equals === undefined ? true : w.equals });
    else if (w.type === 'item') { have.set(w.id, 1); book.feed({ type: 'item:got', id: w.id }); }
    else if (w.type === 'area') book.feed({ type: 'area:entered', id: w.id });
    else if (w.type === 'beasts') { if (w.ids) for (const b of w.ids) book.feed({ type: 'beast:died', id: b }); else for (let k = 0; k < (w.count || 1); k++) book.feed({ type: 'beast:died', id: w.kind + '_sim' + k }); }
    else { have.set(w.id, Math.max(have.get(w.id) || 0, w.count || 1)); book.feed({ type: 'item:count', id: w.id, n: have.get(w.id) }); }
  }
}
// the entity may carry another quest's legit mark -> only judge absence when no other open quest uses the entity
const othersAt = (id, ent) => defs.some(x => x.id !== id && [book.giverOf(book.index(x.id)), book.turnInOf(book.index(x.id))].includes(ent) && [AVAILABLE, READY].includes(book.statusOf(x.id)));
const count = (L, ent) => L.filter(e => e === ent).length;

function audit(d) {
  const id = d.id, i = book.index(id), side = !book.isMain(i), giver = book.giverOf(i), ret = book.turnInOf(i);
  if (!d.giver) return; // giverless (auto) quests have no marks by design
  let L = lists(); const mine = side ? L.sA : L.gA, other = side ? L.gA : L.sA;
  if (count(mine, giver) === 0 && side && L.gA.includes(giver)) return 'defer'; // a GOLD '!' on the same giver legitimately hides the blue one (OB-155j) until that quest is taken
  if (count(mine, giver) !== 1) bad(id, `available: expected one ${side ? 'BLUE' : 'GOLD'} '!' at ${giver}, got ${count(mine, giver)} (wrong-colour list has ${count(other, giver)})`);
  book.accept(id); L = lists();
  if (!othersAt(id, giver) && [L.gA, L.sA, L.gR, L.sR].some(l => l.includes(giver)) && ret !== giver) bad(id, 'after accept: a mark is still on the giver ' + giver);
  if (!othersAt(id, giver) && count(L.gA, giver) + count(L.sA, giver) > 0) bad(id, 'after accept: a ! is still on the giver ' + giver);
  if (d.requireItem) have.set(d.requireItem, 1);
  drive(d);
  if (book.statusOf(id) !== READY) { bad(id, 'objectives driven but status=' + book.statusOf(id) + ' (sim cannot finish it)'); return; }
  L = lists(); const rm = side ? L.sR : L.gR, wrong = side ? L.gR : L.sR;
  if (count(rm, ret) !== 1) bad(id, `ready: expected one ${side ? 'BLUE' : 'GOLD'} '?' at ${ret}, got ${count(rm, ret)} (wrong-colour list ${count(wrong, ret)})`);
  const r = book.handIn(id);
  if (!r) { bad(id, 'handIn refused in sim'); return; }
  L = lists();
  if (!othersAt(id, ret) && [L.gA, L.sA, L.gR, L.sR].some(l => l.includes(ret))) bad(id, 'after hand-in: mark still on ' + ret);
  if (book.statusOf(id) !== DONE) bad(id, 'not DONE after hand-in');
}

// walk quests as their prerequisites open; satisfy flag / m1-step requirements when stuck
const seen = new Set(); let guard = 0;
while (seen.size < defs.length && guard++ < 500) {
  let progressed = false;
  for (const d of defs) {
    if (seen.has(d.id) || book.statusOf(d.id) !== AVAILABLE && d.giver) continue;
    if (!d.giver) { seen.add(d.id); progressed = true; continue; }
    if (audit(d) === 'defer') continue; seen.add(d.id); progressed = true;
  }
  if (progressed) continue;
  let unlocked = false; // stuck: feed unmet flag requires + the main steps
  for (const d of defs) if (!seen.has(d.id)) for (const r of d.requires || []) if (r.flag && !book.questState(0).flags[r.flag]) { book.feed({ type: 'flag:set', key: r.flag, value: true }); unlocked = true; }
  if (!unlocked && book.questState(0).completed.length < m1.objectives.length) { drive({ objectives: [m1.objectives[book.questState(0).completed.length]] }); unlocked = true; }
  if (!unlocked) break;
}
for (const d of defs) if (!seen.has(d.id)) bad(d.id, 'never became AVAILABLE in the sim (prerequisites unreachable)');

// main chain (m1): chainMarks emits only gold '!' (start, until taken); a step ending at a waypoint has no '?' return -> data gap (OB-181)
const m1Gaps = m1.objectives.filter(o => o.mark && o.mark.end).map(o => 'm1:' + o.id);
{ const a = [], r = ['x']; book.chainMarks(a, r); assert.deepEqual(r, ['x'], 'chainMarks never writes a ? list'); }

// report + gate
const allGaps = new Set(KNOWN_DATA_GAPS);
const bugs = problems.filter(([id]) => !allGaps.has(id));
const fixedGaps = [...allGaps].filter(g => !problems.some(([id]) => id === g) && !m1Gaps.includes(g));
for (const g of m1Gaps) if (!allGaps.has(g)) bugs.push([g, 'main step ends at a waypoint (mark.end) with no return character: add to the chain rewrite or KNOWN_DATA_GAPS']);
if (process.env.MARK_REPORT) { for (const [id, why] of problems) console.log('  ' + id + ': ' + why); }
if (bugs.length) { for (const [id, why] of bugs) console.error('MARK RULE BROKEN  ' + id + ': ' + why); assert.fail(bugs.length + ' quests break the OB-156 mark rule'); }
if (fixedGaps.length) console.log('note: KNOWN_DATA_GAPS entries now passing (remove them): ' + fixedGaps.join(', '));
console.log(`markRule OK (${seen.size}/${defs.length} quests audited, ${KNOWN_DATA_GAPS.length} known data gaps)`);
