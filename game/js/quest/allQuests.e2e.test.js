// QUEST-E2E-ALL (OWNER PRIORITY 1, D-108/OB-156): one end-to-end check for EVERY quest id in the real content.
//   node game/js/quest/allQuests.e2e.test.js            (exit 1 while any quest breaks the rule)
//   node game/js/quest/allQuests.e2e.test.js --report   (only prints the table, exit 0; also env QUEST_E2E_REPORT=1)
// The rule: '!' over a CHARACTER (gold main / blue side) -> talk -> Accept/Exit -> objectives -> '?' same colour over a CHARACTER
// -> hand-in talk -> reward once -> both marks gone -> `next` offered, never auto-accepted (D-105). No exemption lists: a quest that
// breaks the rule fails with the first failing step. Quests are generated from content/quests (index.json legacy + packs).
// Runtime = the real game objects: loadQuestFiles (questBoot), questRelay/questBook, generateAll + dialogueCtl + compileDialogue,
// createQuestPickups (pickup path + reward grant), saveState round trip. Events: beast:died (kind/ids), area (pollAreas), flags (questFlag).
import assert from 'node:assert/strict';
import fs, { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileDialogue } from '../../../engine/index.js';
import { loadQuestFiles } from '../questBoot.js';
import { createQuestRelay } from '../questRelay.js';
import { createDialogueCtl } from './dialogueCtl.js';
import { offerIndices } from './dialogueView.js';
import { generateAll, generateForNpc } from './questSnippets.js';
import { gateOnMeet, isWorn } from './errands.js';
import { createQuestPickups } from '../questPickups.js';
import { createNoteOffer } from './objectOffer.js';
import { ensureInventory, countOf } from './sim/inventory.js';
import { AVAILABLE, ACTIVE, READY, DONE, STATUS_NAMES } from './sim/questBook.js';
import { loadDesignAssets } from '../../../tools/validate-content.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const rd = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const REPORT = process.argv.includes('--report') || process.env.QUEST_E2E_REPORT === '1';
const T0 = Date.now();

// ---------------------------------------------------------------- real content
const assets = await loadDesignAssets();
const itemDefs = assets.items?.defs || {};
const itemList = Object.values(itemDefs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const qb = await loadQuestFiles((u) => Promise.resolve(rd(u.replace(/^(\.\.\/)+/, ''))), { wantBarks: false, log: () => {}, items: itemList });
assert.ok(qb.questDef && qb.giverDefs, 'quest files load: ' + JSON.stringify(qb.errors));
const m1 = qb.questDef;
const defs = gateOnMeet(qb.giverDefs); // as main.js does
const dlgDir = ROOT + 'content/dialogue/';
const raws = {};
for (const f of readdirSync(dlgDir)) if (f.endsWith('.dialogue.json')) raws[f.replace('.dialogue.json', '')] = rd('content/dialogue/' + f);
const snip = rd('content/dialogue/quest-snippets.json');
const gen = generateAll(raws, defs, snip, itemDefs);
const dialogues = {};
for (const id of Object.keys(raws)) dialogues[id] = compileDialogue(gen[id] || raws[id]);
for (const oid of new Set(qb.giverDefs.filter((d) => d.objectGiver === true && d.giver).map((d) => d.giver.npc))) { // D-087 (main.js): object givers get 'obj.<id>'
  const shell = { kind: 'dialogue', schema: 1, id: 'obj.' + oid, speakers: { obj: { label: 'NOTE' }, you: { label: 'YOU', player: true } }, entry: [{ node: 'obj.none' }], nodes: { 'obj.none': { end: true, lines: ['Nothing more here.'], speaker: 'obj' } } };
  const g = generateForNpc(shell, oid, qb.giverDefs, snip);
  if (g !== shell) dialogues['obj.' + oid] = compileDialogue(g);
}
const areaIds = new Set(Object.keys(rd('content/quests/areas.json').areas || {}));
const entDlg = {}; // world entity id -> dialogue id (components.dialogue), as the game wires it
for (const w of fs.readdirSync(ROOT + 'content/worlds').filter((f) => f.endsWith('.world.json') && f !== 'waterfall_test.world.json')) for (const e of rd('content/worlds/' + w).entities || []) { const c = e.components && e.components.dialogue; if (c) entDlg[e.id] = typeof c === 'string' ? c : c.id; }
const isChar = (id) => !!id && !!entDlg[id] && !!dialogues[entDlg[id]]; // a character = a world entity with a dialogue

// Untracked-on-disk check: every *.quest.json under content/quests must be in the loaded set (a new file is picked up automatically via index.json).
const onDisk = []; { const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(d + '/' + e.name); else if (e.name.endsWith('.quest.json')) onDisk.push(rd(d.slice(ROOT.length) + '/' + e.name).id); } }; walk(ROOT + 'content/quests'); }
const loadedIds = new Set([m1.id, ...defs.map((d) => d.id)]);

// ---------------------------------------------------------------- harness
const newRelay = (saved, sq) => createQuestRelay(m1, saved || null, defs, sq || null);
const relay = newRelay();
const book0 = () => relay.book;
const initialStatus = Object.fromEntries(defs.map((d) => [d.id, relay.book.statusOf(d.id)]));

const inv = ensureInventory({}, null);
const world = { state: {}, get: (id) => (isChar(id) ? { data: { transform: { x: 0, y: 0, z: 0 }, components: { dialogue: entDlg[id], voxel: { model: 'x', anim: 'idle', playing: false, loop: true } } }, play() { return this; } } : null), addInteractable: (s) => s };
const bus = []; const events = { emit: (n, d) => bus.push([n, d]), on: () => () => {} };
let tickN = 0; const ctxState = { interactPressed: false };
const player = { transform: { x: 100, y: 100, z: 1 }, components: { equipment: {} } };
const pickups = createQuestPickups({ getBook: () => relay.book, feed: (e) => relay.feed(e), defs: itemDefs, isWorn });
let pickupEnt = null;
const pickWorld = { state: {}, forEachEntity: (fn) => { if (pickupEnt) fn(pickupEnt.e, pickupEnt.id); }, entity: (id) => (pickupEnt && pickupEnt.id === id ? pickupEnt.e : null), remove: () => { pickupEnt = null; }, addInteractable() {}, removeInteractable() {} };
const pctx = { world: pickWorld, events, state: ctxState, inventory: inv, player };
pickups.onBoot(pctx);
const onChangeLog = [];
function hookBook() { relay.book.onChange = (n, id) => { onChangeLog.push(n + ':' + id); if (n === 'quest:done') pickups.grantReward(relay.book.lastReward); }; relay.world = world; }
hookBook();
const sync = () => { for (let i = 0; i < 10; i++) pickups.onTick(); };
sync();

const ctl = createDialogueCtl({ pageLines: 1, world, dialogues, book: () => relay.book, questFlag: (k) => relay.questFlag(k, true), onFlag: () => {} });
const preAccepted = new Set(); // quests accepted on the way because their offer shadowed the one under test
const keys = new Set(); const input = { pressed: (c) => keys.has(c), consumePressed() {} };
const tick = (...k) => { keys.clear(); k.forEach((c) => keys.add(c)); ctl.step(1 / 60, input, true); };
/** Talk to `who` ('obj:<id>' = object offer). Accepts only the offer whose accept choice sets `wantFlag` (q.<id>.accept); every other offer is declined (Q). Returns {opened, offers, lines}. */
function talk(who, wantFlag) {
  const out = { opened: false, offers: 0, accepted: 0, lines: [] };
  out.opened = who.startsWith('obj:') ? ctl.openObject(who.slice(4)) : ctl.openFor(who);
  if (!out.opened) return out;
  for (let i = 0; i < 400 && ctl.open; i++) {
    if (ctl.runner.state === 'choosing') {
      if (offerIndices(ctl.runner)) { out.offers++; const cf = ctl.runner.choiceFlag(offerIndices(ctl.runner).accept), mine = wantFlag && (cf === wantFlag || cf === 's.' + wantFlag.slice(2)), other = /^q.(.+).accept$/.exec(cf || '');
      if (mine || (wantFlag && other && relay.book.statusOf(other[1]) === AVAILABLE)) { if (!mine) preAccepted.add(other[1]); /* another quest's offer comes first: the player takes it, then talks again */ out.accepted++; tick(); tick('KeyE'); } else { tick(); tick('KeyQ'); } continue; }
      tick('KeyE'); continue;
    }
    if (ctl.runner.state === 'typing' && out.lines.at(-1) !== ctl.runner.line) out.lines.push(ctl.runner.line);
    tick('KeyE');
  }
  if (ctl.open) ctl.close();
  tick(); tick();
  return out;
}

// The pinned keep-light page is read through the note UI (note.read): its Accept/Exit is the note panel's offer (objectOffer.js), not an 'obj.' dialogue.
const noteOffer = createNoteOffer({ getBook: () => relay.book, inspect: () => {} });
/** Read the note `noteId` of object `oid`: returns {opened, offers, accepted, lines} like talk(); the player presses Accept only when `accept`. */
function readNote(oid, accept) {
  const o = noteOffer.offerFor(oid === 'noteKeepLight' ? 'keepLight' : null);
  if (!o) return { opened: false, offers: 0, accepted: 0, lines: [] };
  if (accept) o.accept();
  return { opened: true, offers: 1, accepted: accept ? 1 : 0, lines: [o.title] };
}
const noteGiver = (id) => id === 'noteKeepLight';

// ---------------------------------------------------------------- per-quest run
const lists = () => { const gA = [], gR = [], sA = [], sR = []; relay.book.markLists(gA, gR, sA, sR); return { gA, gR, sA, sR }; };
const idx = (id) => relay.book.index(id);
const results = new Map(); // id -> {ok, step, msg}
const active = new Set();
function otherAt(kind, entity, selfId) { // another quest sharing this entity in the same state (its mark may legitimately show instead)
  const b = relay.book; for (let i = 1; i < b.count; i++) { const d = b.def(i); if (d.id === selfId) continue; const s = b.status(i); if (kind === 'avail' ? (s === AVAILABLE && b.giverOf(i) === entity) : (s === READY && b.turnInOf(i) === entity)) return true; } return false;
}

function runQuest(def) {
  if (results.has(def.id)) return results.get(def.id);
  if (active.has(def.id)) return { ok: false, step: 'requires', msg: 'requires cycle' };
  active.add(def.id);
  let res = null;
  const fail = (step, msg) => { if (!res) res = { ok: false, step, msg }; };
  const b0 = () => relay.book, I = idx(def.id), st = () => b0().statusOf(def.id);
  const giver = def.giver && def.giver.npc, turnIn = def.giver && (def.giver.turnIn || def.giver.npc), objectGiver = def.objectGiver === true;
  const side = !b0().isMain(I), colour = side ? 'blue' : 'gold';

  // 0. prerequisites (a real run: earlier quests handed in, flags set through the real setter)
  for (const r of def.requires || []) {
    if (r.flag) { if (relay.state.flags[r.flag] !== true) relay.questFlag(r.flag, true); continue; }
    const dep = defs.find((d) => d.id === r.quest);
    if (dep) runQuest(dep); else if (r.quest === 'm1') advanceM1(r.step);
  }
  const prev = defs.find((d) => d.next === def.id); if (prev) runQuest(prev);

  for (const sl of inv.slots) { sl.id = null; sl.n = 0; } // fresh pack for this quest (rewards are measured by delta)

  if (preAccepted.has(def.id) && st() === DONE) { active.delete(def.id); results.set(def.id, res || { ok: true }); return results.get(def.id); } // accepted + handed in through a shadowing offer / ready route of the same NPC while testing another quest

  // 1. offered only when requires are met
  if ((def.requires || []).length && initialStatus[def.id] === AVAILABLE) fail('1 offered-only-when-requires-met', 'AVAILABLE on a fresh game although it requires ' + JSON.stringify(def.requires));
  if (def.giver === undefined) { // giverless area quest: no '!', no talk, no hand-in
    fail('2 giver-character', 'giverless quest: no giver and no hand-in character (no "!" / "?" at all)');
    for (const o of def.objectives) doObjective(def, o, fail);
    results.set(def.id, res || { ok: true }); active.delete(def.id); return results.get(def.id);
  }
  const skipOffer = preAccepted.has(def.id) && st() === ACTIVE; // accepted earlier through a shadowing offer: its offer/accept were exercised there
  if (!skipOffer && st() !== AVAILABLE) { fail('1 offered-only-when-requires-met', 'not AVAILABLE after its requires are met (status ' + STATUS_NAMES[st()] + ')'); active.delete(def.id); results.set(def.id, res); return res; }

  if (!skipOffer) {
  // 2. '!' over a CHARACTER in the right colour
  if (!objectGiver && !isChar(giver)) fail('2 giver-character', "giver '" + giver + "' is not a character (no dialogue) and the quest is not objectGiver");
  if (objectGiver && !def.main && dialogues['obj.' + giver] === undefined && !noteGiver(giver)) fail('2 giver-character', "objectGiver '" + giver + "' has no generated offer dialogue");
  if (!isChar(turnIn)) fail('2 giver-character', "hand-in '" + turnIn + "' is not a character (no dialogue): '?' must sit over a character");
  { const L = lists(); const mine = side ? L.sA : L.gA, other = side ? L.gA : L.sA;
    if (!mine.includes(giver) && !((otherAt('avail', giver, def.id) || (side && L.gA.includes(giver))) && (L.gA.includes(giver) || L.sA.includes(giver)))) fail('2 mark-offer', "no " + colour + " '!' over giver '" + giver + "'" + (other.includes(giver) ? ' (wrong colour)' : '')); }

  // 3. talk -> Accept / Exit; Exit keeps it available
  const who = objectGiver ? 'obj:' + giver : giver;
  const notePanel = objectGiver && def.main; // main object givers (tower.blade): offer + accept through the note panel (objectOffer.offerFor -> book.accept)
  const exit = notePanel ? { opened: true, offers: 1, lines: [] } : (objectGiver && noteGiver(giver) ? readNote(giver, false) : talk(who, null));
  if (!exit.opened) fail('3 talk-offer', 'cannot open a conversation with ' + who);
  else if (exit.offers < 1) fail('3 talk-offer', 'no Accept/Exit offer shown by ' + who + ' (' + (exit.lines[0] || 'no lines').slice(0, 40) + ')');
  if (st() !== AVAILABLE) fail('3 exit-keeps-available', 'Exit changed the status to ' + STATUS_NAMES[st()]);
  else if (exit.offers) { const L = lists(); if (!(side ? L.sA : L.gA).includes(giver) && !otherAt('avail', giver, def.id)) fail('3 exit-keeps-available', "'!' vanished after Exit"); }

  // 4. Accept -> '!' gone, tracked
  let acc = null; for (let n = 0; n < 4 && st() === AVAILABLE; n++) acc = notePanel ? (b0().accept(def.id), { opened: true, offers: 1, lines: [] }) : (objectGiver && noteGiver(giver) ? readNote(giver, true) : talk(who, 'q.' + def.id + '.accept')); // a player talks again if another quest's offer came first
  if (st() === AVAILABLE) { fail('4 accept', 'talk with ' + who + ' did not accept (opened ' + (acc && acc.opened) + ', offers ' + (acc && acc.offers) + ', first line: ' + String(acc && acc.lines[0]).slice(0, 36) + ')'); b0().accept(def.id); }
  { const L = lists(); if ((side ? L.sA : L.gA).includes(giver) && !otherAt('avail', giver, def.id)) fail('4 accept', "'!' still shows after Accept"); }
  if (b0().tracked() !== I) fail('4 accept', 'accepted quest is not the tracked one');
  } // skipOffer
  const snap = structuredClone(relay.book.questState(I));
  const pre = new Set(snap.completed); // objectives already true at accept (facts count before accept)
  midSaveCheck(def, fail);

  // 5. every objective through the real events
  const objs = def.objectives;
  for (let k = 0; k < objs.length; k++) {
    doObjective(def, objs[k], fail);
    const s = st();
    if (k < objs.length - 1) {
      if (s !== ACTIVE && !objs.slice(k + 1).every((x) => pre.has(x.id) || holds(snap, x.when) || (x.when.type === 'deliver' && countOf(inv, x.when.id) >= x.when.count)) /* deliver of the item just collected is satisfied by the same pack count; the hand-in talk takes it */) fail('5 objectives', "after step '" + objs[k].id + "' status " + STATUS_NAMES[s] + ' (expected active; ' + (objs.length - 1 - k) + ' left)');
      else if (s === ACTIVE) { const L = lists(); if ((side ? L.sR : L.gR).includes(turnIn) && !otherAt('ready', turnIn, def.id)) fail('6 ready-only-after-last', "'?' over " + turnIn + " before the last objective"); }
    }
  }
  if (st() !== READY) { fail('5 objectives', 'after all objectives status ' + STATUS_NAMES[st()] + ' (expected ready); needs: ' + objs.map((o, k) => o.id + '=' + (relay.book.questState(I).completed.includes(o.id) ? 'ok' : 'open')).join(' ')); }

  // 6. READY '?' same colour over a character
  { const L = lists(); const mine = side ? L.sR : L.gR;
    if (st() === READY && !mine.includes(turnIn)) fail('6 mark-ready', "no " + colour + " '?' over hand-in '" + turnIn + "'" + ((side ? L.gR : L.sR).includes(turnIn) ? ' (wrong colour)' : '')); }

  // 7. hand-in talk -> reward once -> marks gone
  if (def.requireItem && countOf(inv, def.requireItem) < 1) getItem(def.requireItem, 1, fail); // the player brings the required item / wears the required gear (EQ-13)
  if (def.requireEquipped) for (const id of def.requireEquipped) { const sl = (itemDefs[id] && itemDefs[id].equip && itemDefs[id].equip.slot) || 'main'; player.components.equipment[sl] = id; }
  const before = rewardSnapshot(def);
  const doneEv = () => onChangeLog.filter((e) => e === 'quest:done:' + def.id).length;
  let hi = null; for (let n = 0; n < 4 && st() === READY; n++) hi = talk(turnIn, null); // offers inside the hand-in talk (next quest) are declined: D-105
  if (st() === READY) {
    fail('7 handin-talk', "talk with '" + turnIn + "' did not hand in (opened " + hi.opened + ')');
    if (st() === READY) { const r = relay.book.handIn(def.id); if (!r) fail('7 handin-talk', 'book.handIn refused (deliver items / requireItem missing)'); }
  }
  if (st() !== DONE) fail('7 handin-talk', 'status after hand-in ' + STATUS_NAMES[st()]);
  if (doneEv() !== 1) fail('7 reward-once', 'quest:done fired ' + doneEv() + 'x');
  rewardCheck(def, before, fail);
  { const again = rewardSnapshot(def); talk(turnIn, null); rewardCheck(def, again, fail, true); }
  { const L = lists(); for (const [n, l] of [['gold !', L.gA], ['blue !', L.sA]]) if (l.includes(giver) && !otherAt('avail', giver, def.id) && st() === DONE && !def.next) fail('7 marks-gone', n + ' still over ' + giver); if ((L.gR.includes(turnIn) || L.sR.includes(turnIn)) && !otherAt('ready', turnIn, def.id)) fail('7 marks-gone', "'?' still over " + turnIn); }

  // 8. next offered, never auto-accepted (D-105)
  if (def.next) {
    const ns = relay.book.statusOf(def.next);
    if (ns === ACTIVE || ns === READY) fail('8 next-not-auto', "next '" + def.next + "' was auto-accepted (" + STATUS_NAMES[ns] + ')');
    else if (ns !== AVAILABLE) fail('8 next-offered', "next '" + def.next + "' is " + STATUS_NAMES[ns] + ' after the hand-in (expected available)');
  }
  // 9. save -> load identical
  saveCheck(def, fail, '9 save-load');

  active.delete(def.id);
  results.set(def.id, res || { ok: true });
  return results.get(def.id);
}

/** The real pickup path: a questPickup prop next to the player + E (questPickups.onTick) until the pack holds n of `id`. */
function getItem(id, n, fail) {
  const have = countOf(inv, id);
  if (have >= n) return;
  pickupEnt = { id: 'pk', e: { transform: { x: player.transform.x, y: player.transform.y, z: player.transform.z }, components: { questPickup: { item: id, n: n - have } } } };
  pickups.onBoot(pctx); ctxState.interactPressed = true; pickups.onTick(); ctxState.interactPressed = false;
  if (countOf(inv, id) < n) fail('5 objectives', "pickup of '" + id + "' x" + (n - have) + ' did not reach the pack (item def / pack full?)');
}

/** true when the fact behind `when` was already in the quest state (facts count before accept, so a later step may already be satisfied). */
function holds(q, w) {
  switch (w.type) {
    case 'area': return q.areas.includes(w.id);
    case 'item': return q.items.includes(w.id);
    case 'flag': return q.flags[w.id] === (w.equals === undefined ? true : w.equals);
    case 'beasts': return w.kind !== undefined ? (q.counts['kill_' + w.kind] || 0) >= w.count : w.ids.filter((i) => q.deadBeasts.includes(i)).length >= w.count;
    default: return (q.counts[w.id] || 0) >= w.count;
  }
}

// objective -> real event
function doObjective(def, o, fail) {
  const w = o.when, b = relay.book;
  switch (w.type) {
    case 'flag':
      if (/^quest\..+\.done$/.test(w.id)) { const dep = defs.find((d) => 'quest.' + d.id + '.done' === w.id); if (dep) runQuest(dep); else fail('5 objectives', "flag '" + w.id + "' belongs to an unknown quest"); }
      else relay.questFlag(w.id, w.equals === undefined ? true : w.equals);
      break;
    case 'item': relay.feed({ type: 'item:got', id: w.id }); break;
    case 'area': {
      if (!areaIds.has(w.id)) fail('5 objectives', "area '" + w.id + "' is not in content/quests/areas.json (no trigger zone)");
      player.transform.x = 500; player.transform.y = 500; player.transform.z = 2;
      relay.pollAreas(500, 500, 2, [{ id: w.id, x: 500, y: 500, r: 3, zMin: 0 }]); break;
    }
    case 'beasts': {
      const ids = w.kind !== undefined ? Array.from({ length: w.count }, (_, n) => w.kind + 'E2E' + (n + 1)) : w.ids.slice(0, w.count); // kind: right kind prefix (kindOf), count of kills
      for (const id of ids) relay.feed({ type: 'beast:died', id });
      break;
    }
    case 'collect': case 'deliver': getItem(w.id, w.count, fail); sync(); break;
    default: fail('5 objectives', 'unknown objective type ' + w.type);
  }
  relay.book.version; void b;
}

function rewardSnapshot(def) { const m = {}; for (const it of (def.reward && def.reward.items) || []) m[it.id] = countOf(inv, it.id); return m; }
function rewardCheck(def, before, fail, again) {
  for (const it of (def.reward && def.reward.items) || []) {
    const got = countOf(inv, it.id) - before[it.id];
    if (again) { if (got !== 0) fail('7 reward-once', 'second talk granted ' + it.id + ' again (+' + got + ')'); }
    else if (got !== it.n && !(def.objectives.some((o) => o.when.id === it.id))) fail('7 reward-once', 'reward ' + it.id + ' x' + it.n + ' granted ' + got + 'x (inventory delta)');
  }
}

// save -> load must give the identical book (BH-S1 class)
function snapshot(r) { const b = r.book, out = []; for (let i = 0; i < b.count; i++) out.push(b.status(i)); return JSON.stringify([out, b.toSave()]); }
function saveCheck(def, fail, step) {
  const s = relay.book.toSave(); const r2 = newRelay(JSON.parse(JSON.stringify(s.quest)), JSON.parse(JSON.stringify(s.quests)));
  if (snapshot(r2) !== snapshot(relay)) fail(step, 'state after save -> load differs');
}
function midSaveCheck(def, fail) { saveCheck(def, fail, '4 save-load-active'); }

// m1 (the opening chain): drive its steps in order up to `stepId` with the real events
function advanceM1(stepId) {
  for (const o of m1.objectives) {
    if (relay.state.completed.includes(o.id)) { if (o.id === stepId) return; continue; }
    const w = o.when;
    if (w.type === 'flag' && /^quest\..+\.done$/.test(w.id)) { const dep = defs.find((d) => 'quest.' + d.id + '.done' === w.id); if (dep) runQuest(dep); }
    else if (w.type === 'flag') relay.questFlag(w.id, w.equals === undefined ? true : w.equals);
    else if (w.type === 'item') relay.feed({ type: 'item:got', id: w.id });
    else if (w.type === 'area') relay.pollAreas(500, 500, 2, [{ id: w.id, x: 500, y: 500, r: 3, zMin: 0 }]);
    if (o.id === stepId) return;
  }
}

// ---------------------------------------------------------------- run everything
const rows = [];
for (const def of defs) {
  let r; try { r = runQuest(def); } catch (e) { r = { ok: false, step: 'crash', msg: String((e && e.stack) || e).split('\n').slice(0, 2).join(' | ') }; results.set(def.id, r); active.delete(def.id); }
  rows.push({ id: def.id, ...r });
}
// m1: every section of the opening chain must END in a hand-in (a quest:<id>:done flag = a giver quest handed in at a character); a waypoint ending is a bug (OB-181/182)
advanceM1(m1.objectives[m1.objectives.length - 1].id);
{
  const secs = new Map();
  for (const o of m1.objectives) { const k = o.section || o.id; if (!secs.has(k)) secs.set(k, []); secs.get(k).push(o); }
  for (const [sid, list] of secs) {
    const last = list[list.length - 1], w = last.when, dep = w.type === 'flag' && /^quest\.(.+)\.done$/.exec(w.id);
    const owner = dep && defs.find((d) => d.id === dep[1]);
    if (!owner) rows.push({ id: 'm1:' + sid, ok: false, step: '6 mark-ready', msg: "chain section '" + sid + "' ends on '" + last.id + "' (" + w.type + ' ' + w.id + ') with no hand-in: completes at a waypoint, no "?" over a character' });
    else rows.push({ id: 'm1:' + sid, ok: results.get(owner.id) && results.get(owner.id).ok, step: results.get(owner.id) ? results.get(owner.id).step : '?', msg: 'hand-in via ' + owner.id });
  }
}
for (const id of onDisk) if (!loadedIds.has(id)) rows.push({ id, ok: false, step: '0 loaded', msg: 'quest file on disk is not loaded (index.json legacy/packs)' });

// ---------------------------------------------------------------- report
const bad = rows.filter((r) => !r.ok), good = rows.filter((r) => r.ok);
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
for (const r of rows) console.log((r.ok ? 'PASS ' : 'FAIL ') + pad(r.id, 34) + (r.ok ? '' : ' | ' + r.step + ' | ' + String(r.msg).slice(0, 170)));
const bySteps = {}; for (const r of bad) bySteps[r.step] = (bySteps[r.step] || 0) + 1;
console.log('\nQUEST-E2E-ALL summary: ' + rows.length + ' quests (' + defs.length + ' giver + m1 sections), ' + good.length + ' passing, ' + bad.length + ' failing, ' + (Date.now() - T0) + ' ms');
console.log('failing by first failing step: ' + (Object.entries(bySteps).sort().map(([k, v]) => k + '=' + v).join(', ') || 'none'));
if (!REPORT) {
  assert.equal(bad.length, 0, bad.length + ' of ' + rows.length + ' quests break the rule (first failing steps above; QUEST-HANDIN-ALL fixes them)');
  console.log('allQuests.e2e ok');
}
