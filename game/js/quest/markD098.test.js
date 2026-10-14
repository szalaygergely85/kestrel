// D-098 (QUEST-WOW-01): ONE rule over the REAL quest content. available -> '!' at the giver; active-not-done -> grey '?' at the
// hand-in place; ready -> gold/blue '?' there; never two markers on one entity; m1 chain end = gold '?' on the thing itself.
import assert from 'node:assert/strict';
import { createQuestBook } from './sim/questBook.js';
import { addSideMarks } from './markSide.js';
import { setTalkFlags } from './sim/questBook.js';
import { dialogueFlagOwners, handInFlagOwners } from './talkEnds.js';
import { trackerLines } from '../ui/questTracker.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
import { giverOf, turnInOf } from './sim/giverResolve.js';
import { fileURLToPath } from 'node:url';

const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const m1 = all.find(d => d.id === 'm1'), rest = all.filter(d => d.id !== 'm1').map(d => { const c = structuredClone(d); delete c.requires; return c; }); // requires stripped: the marker rule is by STATUS, so every quest is offered
assert.ok(rest.length >= 60, 'real content: ' + rest.length);

const lists = () => ({ gA: [], gR: [], sA: [], sR: [], gr: [] });
function marks(b) { const l = lists(); b.giverMarks(l.gA, l.gR, l.sA, l.sR); b.chainMarks(l.gA, l.gR); b.activeMarks(l.gr); b.dedupeMarks(l.gA, l.gR, l.sA, l.sR, undefined, l.gr); return l; }
const where = (l, k) => [...l.gA, ...l.sA, ...l.gR, ...l.sR, ...l.gr].includes(k);

let nAvail = 0, nActive = 0, nReady = 0;
for (let i = 1; i < rest.length + 1; i++) {
  const probe = createQuestBook(m1, rest); const d = probe.def(i), id = d.id;
  const main = probe.isMain(i);
  // available (only when it really is offered now): '!' at the giver, right colour
  if (probe.status(i) === 1 && d.giver && giverOf(d)) {
    const l = marks(probe), ent = probe.entityFor(giverOf(d)), all5 = Object.values(l).flat().filter(x => probe.entityFor(x) === ent);
    assert.equal(all5.length, 1, id + ': exactly one marker at the giver ' + ent);
    if (all5[0] === giverOf(d) && !l.gR.includes(all5[0]) && !l.sR.includes(all5[0])) assert.ok((main ? l.gA : [...l.sA, ...l.gA]).includes(giverOf(d)), id + ': ! colour'); nAvail++;
  }
  // active-not-done: accept, expect grey '?' (or a ready/! of something else on that entity)
  const b = createQuestBook(m1, rest);
  if (!b.accept(id)) continue;
  if (b.status(i) === 2 && b.def(i).giver && !b.def(i).giver.auto && turnInOf(b.def(i))) {
    const l = marks(b), t = turnInOf(b.def(i));
    assert.ok(Object.values(l).flat().some(x => b.entityFor(x) === b.entityFor(t)), id + ': active quest must show a marker at its finish place ' + t);
    const mine = l.gr.includes(t); if (mine) assert.ok(![...l.gR, ...l.sR, ...l.gA, ...l.sA].some(x => b.entityFor(x) === b.entityFor(t)), id + ': grey only when nothing stronger'); nActive++;
  }
  const keys = Object.values(marks(b)).flat().map(x => b.entityFor(x)); assert.equal(new Set(keys).size, keys.length, id + ': one marker per entity');
  if (b.status(i) === 3) { const l = marks(b), t = turnInOf(b.def(i)); assert.ok(l.gR.includes(t) || l.sR.includes(t), id + ': ready ? at ' + t); nReady++; }
}
assert.ok(nAvail >= 30 && nActive >= 30, 'walked: avail ' + nAvail + ' active ' + nActive + ' ready ' + nReady);

// forced states on a synthetic pair of quests (ready path is data-dependent, so also checked directly)
{
  const mk = (id, extra) => ({ version: 1, id, title: id, giver: { npc: 'g_' + id, turnIn: 'h_' + id, text: 't', ...extra }, objectives: [{ id: 'o', text: 'Do it', when: { type: 'flag', id: 'f.' + id, equals: true } }] });
  const b = createQuestBook(m1, [mk('a'), mk('s')]);
  let l = marks(b); assert.ok(l.gA.includes('g_a') || l.sA.includes('g_a'), 'available ! at giver');
  assert.ok(b.accept('a')); l = marks(b); assert.deepEqual(l.gr, ['h_a'], 'accepted -> grey ? at hand-in');
  b.feed({ type: 'flag:set', key: 'f.a', value: true }); l = marks(b);
  assert.ok([...l.gR, ...l.sR].includes('h_a') && !l.gr.includes('h_a'), 'objectives done -> coloured ? replaces grey');
}

// m1 chain: the waystone step shows a gold '?' on the waystone itself (and no '!'), tracker lists the objective
{
  const b = createQuestBook(m1, rest); const steps = m1.objectives; let seen = false;
  for (let k = 0; k < steps.length; k++) {
    const o = steps[k]; const a = [], r = []; b.chainMarks(a, r);
    if (o.id === 'waystone') { assert.deepEqual(r, ['endMarker'], 'Wake the waystone: gold ? on the waystone'); seen = true; }
    const w = o.when;
    if (w.type === 'flag') b.feed({ type: 'flag:set', key: w.id, value: w.equals !== undefined ? w.equals : true });
    else if (w.type === 'area') b.feed({ type: 'area:entered', id: w.id });
    else if (w.type === 'item') b.feed({ type: 'item:got', id: w.id });
  }
  assert.ok(seen);
  const t = trackerLines(createQuestBook(m1, rest)); assert.ok(t.length >= 2 && t[0].kind === 'title' && t.some(x => x.kind === 'active'), 'tracker shows title + active objective');
}
// D-098 (QUEST-WOW-01b): TALK steps (flag set by a dialogue / a quest hand-in) show the '?' over the CHARACTER; place steps keep the target
{
  const raw = JSON.parse((await import('node:fs')).readFileSync(fileURLToPath(new URL('../../../content/dialogue/bear.dialogue.json', import.meta.url)), 'utf8'));
  const owners = dialogueFlagOwners({ bear: raw });
  assert.equal(owners['bear.talked'], 'bear', 'dialogue flag -> its npc');
  const bd = JSON.parse((await import('node:fs')).readFileSync(fileURLToPath(new URL('../../../content/quests/burl.boars.quest.json', import.meta.url)), 'utf8'));
  Object.assign(owners, handInFlagOwners([bd])); assert.equal(owners['quest.burl.boars.done'], 'bear', 'hand-in flag -> the hand-in npc');
  setTalkFlags(owners);
  const b = createQuestBook(m1, rest); const ends = {};
  for (const o of m1.objectives) {
    const a = [], r = []; b.chainMarks(a, r); ends[o.id] = r.join(',');
    const w = o.when;
    if (w.type === 'flag') b.feed({ type: 'flag:set', key: w.id, value: w.equals !== undefined ? w.equals : true });
    else if (w.type === 'area') b.feed({ type: 'area:entered', id: w.id });
    else if (w.type === 'item') b.feed({ type: 'item:got', id: w.id });
  }
  assert.equal(ends.beasts, 'bear', 'talk step (quest.burl.boars.done = hand-in to Burl): ? over Burl');
  assert.equal(ends.waystone, 'endMarker', 'place step keeps the ? on the target');
  assert.equal(ends.leave, 'doorMarker'); assert.equal(ends.relayFound, 'relayBend');
  setTalkFlags({ 'burl.arrived': 'bear' }); // a dialogue-set flag directly
  const c = createQuestBook(m1, rest); for (const o of m1.objectives) { if (o.id === 'follow') break; const w = o.when; if (w.type === 'flag') c.feed({ type: 'flag:set', key: w.id, value: true }); else if (w.type === 'area') c.feed({ type: 'area:entered', id: w.id }); else if (w.type === 'item') c.feed({ type: 'item:got', id: w.id }); }
  const a = [], r = []; c.chainMarks(a, r); assert.deepEqual(r, ['bear'], 'dialogue-flag step: ? over the npc'); setTalkFlags({});
}
// grey model exists once the side marks are registered
{ const A = { voxelModels: { questMark: assets.voxelModels.questMark, questMarkReady: assets.voxelModels.questMarkReady } }; if (A.voxelModels.questMarkReady) { addSideMarks(A); assert.equal(A.voxelModels.questMarkGrey.voxel.mats.C, 'team.a'); } }
console.log('markD098 ok: avail ' + nAvail + ' active ' + nActive + ' ready ' + nReady);
