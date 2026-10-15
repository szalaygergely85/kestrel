// QUEST-RULES-E2E (owner rules OB-156 / D-082 / D-087 / D-105): drives EVERY real quest (questBoot loads index.json + all packs: ch3, ch3b, ch12, regions)
// from offer to hand-in through the real book / relay / dialogueCtl / compassHud / quest journal, and asserts the owner rules R1..R9 at each state:
//   R1 '!' iff available, talk offers Accept/Exit   R2 gold main / blue side   R3 nothing in journal/HUD/compass before accept
//   R4 after accept '!' gone + tracked              R5 compass target per step resolvable, never a giver (own while gathering / other quest's)
//   R6 all done -> '?' same colour at turn-in, hand-in gives the reward   R7 requires unlock next, nothing early   R8 abandon -> available + '!' back
//   R9 never stuck (every step completable with the simulated world)
//   node game/js/quest/questRules.e2e.test.js [--all] (print every row, not only non-PASS)
// Known open bugs are listed in TODO below as 'quest|rule' -> OB id (reported as todo, suite stays green); anything else FAIL exits 1.
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
let relay = newRelay();
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
      if (/^quest\..+\.done$/.test(w.id)) { const dep = defs.find((d) => 'quest.' + d.id + '.done' === w.id); if (dep) fastDone(dep); else fail('5 objectives', "flag '" + w.id + "' belongs to an unknown quest"); }
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

// m1 (the opening chain): drive its steps in order up to `stepId` with the real events
function advanceM1(stepId) {
  for (const o of m1.objectives) {
    if (relay.state.completed.includes(o.id)) { if (o.id === stepId) return; continue; }
    const w = o.when;
    if (w.type === 'flag' && /^quest\..+\.done$/.test(w.id)) { const dep = defs.find((d) => 'quest.' + d.id + '.done' === w.id); if (dep) fastDone(dep); }
    else if (w.type === 'flag') relay.questFlag(w.id, w.equals === undefined ? true : w.equals);
    else if (w.type === 'item') relay.feed({ type: 'item:got', id: w.id });
    else if (w.type === 'area') relay.pollAreas(500, 500, 2, [{ id: w.id, x: 500, y: 500, r: 3, zMin: 0 }]);
    if (o.id === stepId) return;
  }
}

// ---------------------------------------------------------------- rules harness
import { createCompassHud, FALLBACK_COMPASS_STYLE } from '../ui/compassHud.js';
import { createQuestLogScreen } from '../ui/questLog.js';
import { createUiLayer } from '../../../engine/index.js';
const SHOW_ALL = process.argv.includes('--all');
/** Known open owner bugs: 'quest|rule' or '*|rule' -> OB id. They print as todo and do not fail the suite. */
const TODO = {
  // OB-206 class: a hand-written 'q.<main>.active' dialogue entry sits before the generated 'available' offers (questSnippets.js:104), so an active quest hides another quest's offer at the same giver
  'sq.burl.blue|R1': 'OB-206', 'mq.river.road|R1': 'OB-206', 'mq.ford.stones|R1': 'OB-206', 'mq.ford.mirror|R1': 'OB-206', 'mq.smoke|R1': 'OB-206', 'mq.ow.path|R1': 'OB-206', 'mq.ow.fence|R1': 'OB-206', 'mq.ow.relay|R1': 'OB-206', 'mq.ow.board|R1': 'OB-206',
  'sq.post.spare|R5': 'OB-207', 'sq.fc.cog|R5': 'OB-207', 'sq.honey|R5': 'OB-207', 'sq.ow.parcel|R5': 'OB-207', 'sq.reg.strand|R5': 'OB-207', // deliver step, item handed over on accept (sources.json giver:true): compass falls back to an available giver
  'sq.rook.gift|R6': 'hand-in behind pending offer', 'sq.honey|R6': 'hand-in behind pending offer', 'sq.ow.trail|R6': 'hand-in behind pending offer', // Exit on a pending offer at the turn-in blocks the hand-in
};
const sources = rd('content/items/sources.json').items || {};
const ui = createUiLayer({ cols: 160 });
// compass world: every giver id gets a unique spot; areas/sources/beasts resolve like the game (area in areas.json, item source in sources.json)
const spot = new Map(); const spotOf = (key) => { if (!spot.has(key)) spot.set(key, 10 * (spot.size + 1)); return spot.get(key); };
for (const d of defs) { if (d.giver) { spotOf('giver:' + d.giver.npc); spotOf('giver:' + (d.giver.turnIn || d.giver.npc)); } }
const giverAt = new Map([...spot].filter(([k]) => k.startsWith('giver:')).map(([k, v]) => [v, k.slice(6)]));
const cworld = { resolve(kind, id, out) {
  let key = null;
  if (kind === 'giver') key = 'giver:' + id;
  else if (kind === 'area') { if (areaIds.has(id)) key = 'area:' + id; }
  else if (kind === 'source') { const s = sources[id]; if (s && !s.giver) key = 'source:' + id; }
  else if (kind === 'beast') key = 'beast:' + id;
  if (!key) return false;
  out.x = spotOf(key); out.y = 0; return true;
} };
const hud = createCompassHud({ style: FALLBACK_COMPASS_STYLE });
const rows = [];
const rec = (q, rule, ok, detail) => { const t = TODO[q + '|' + rule] || TODO['*|' + rule]; rows.push({ q, rule, res: ok ? 'PASS' : t ? 'todo' : 'FAIL', detail: ok ? (detail || '') : (t ? t + ': ' : '') + detail }); };

function fresh() {
  relay = newRelay(); hookBook(); for (const sl of inv.slots) { sl.id = null; sl.n = 0; } preAccepted.clear(); pickups.onBoot(pctx); sync();
  for (const k of Object.keys(player.components.equipment)) delete player.components.equipment[k];
}
const noopFail = () => {};
/** Complete `def` (and what it needs) with the simulated world, no rule checks; used to unlock prerequisites. */
function fastDone(def) {
  const b = () => relay.book;
  if (b().statusOf(def.id) === DONE) return;
  prereqs(def);
  if (b().statusOf(def.id) === AVAILABLE) b().accept(def.id);
  for (const o of def.objectives) { if (b().statusOf(def.id) !== ACTIVE) break; doObjective(def, o, noopFail); }
  if (def.requireItem && countOf(inv, def.requireItem) < 1) getItem(def.requireItem, 1, noopFail);
  if (def.requireEquipped) for (const id of def.requireEquipped) { const sl = (itemDefs[id] && itemDefs[id].equip && itemDefs[id].equip.slot) || 'main'; player.components.equipment[sl] = id; }
  if (b().statusOf(def.id) === READY) { b().handIn(def.id); pickups.grantReward(b().lastReward); }
}
function prereqs(def) {
  for (const r of def.requires || []) {
    if (r.flag) { if (relay.state.flags[r.flag] !== true) relay.questFlag(r.flag, true); continue; }
    const dep = defs.find((d) => d.id === r.quest); if (dep) fastDone(dep); else if (r.quest === 'm1') advanceM1(r.step);
  }
  const prev = defs.find((d) => d.next === def.id); if (prev) fastDone(prev);
}
/** other quests accepted on the way (their offer came first at the same giver): the player finishes them, then talks again */
function finishShadows(except) { for (const id of [...preAccepted]) { if (id === except) continue; const d = defs.find((x) => x.id === id); if (d && st(id) !== DONE) fastDone(d); } }
const st = (id) => relay.book.statusOf(id);
/** all AVAILABLE (or READY) quests sharing this entity: the single marker shows the best of them (gold beats blue) */
function sharing(kind, ent) { const b = relay.book, out = []; for (let i = 1; i < b.count; i++) { const s = b.status(i); if (kind === 'avail' ? (s === AVAILABLE && b.giverOf(i) === ent) : (s === READY && b.turnInOf(i) === ent)) out.push(i); } return out; }
function markState(kind, ent) { const L = lists(); const g = kind === 'avail' ? L.gA : L.gR, s = kind === 'avail' ? L.sA : L.sR; return g.includes(ent) ? 'gold' : s.includes(ent) ? 'blue' : 'none'; }
const expectColour = (kind, ent) => { const sh = sharing(kind, ent); if (!sh.length) return 'none'; return sh.some((i) => relay.book.isMain(i)) ? 'gold' : 'blue'; };
function journalNames() { const log = createQuestLogScreen(relay.book); log.open(); log.draw(ui); const s = log.snapshot(); return s.left.concat(s.right).join('\n'); }
const lists = () => { const gA = [], gR = [], sA = [], sR = []; relay.book.markLists(gA, gR, sA, sR); return { gA, gR, sA, sR }; };
const idx = (id) => relay.book.index(id);
const ITEM = new Set(['item', 'collect', 'deliver']);
const posKey = (w) => { const k = w.type === 'area' ? 'area:' + w.id : ITEM.has(w.type) ? 'source:' + w.id : null; return k && spot.has(k) ? spot.get(k) : null; };

function audit(def) {
  const q = def.id;
  // ---- R7 early: nothing offered before requires / previous quest are done
  fresh();
  const prev = defs.find((d) => d.next === def.id), needs = (def.requires || []).length > 0 || !!prev;
  const giver = def.giver && def.giver.npc, turnIn = def.giver && (def.giver.turnIn || def.giver.npc), objectGiver = def.objectGiver === true;
  if (needs) {
    const e = [];
    if (st(q) === AVAILABLE) e.push('AVAILABLE on a fresh game although it ' + (prev ? 'follows ' + prev.id : 'requires ' + JSON.stringify(def.requires)));
    rec(q, 'R7', !e.length, e.join('; '));
  }
  prereqs(def);
  if (needs && st(q) !== AVAILABLE) rec(q, 'R7', false, 'not AVAILABLE after its prerequisites are done (status ' + STATUS_NAMES[st(q)] + ')');
  if (st(q) !== AVAILABLE) { rec(q, 'R9', false, 'stuck: quest never becomes available (status ' + STATUS_NAMES[st(q)] + ')'); return; }
  const I = idx(q), side = !relay.book.isMain(I), colour = side ? 'blue' : 'gold';
  if (def.giver === undefined) { rec(q, 'R1', false, 'giverless quest: no giver, no "!" and no hand-in'); return; }

  // ---- R3: nothing visible before accept
  {
    const e = []; const txt = relay.objectiveText() || '';
    const texts = [def.title, ...def.objectives.map((o) => o.text)].filter(Boolean);
    if (relay.book.tracked() === I) e.push('quest is tracked before accept');
    for (const t of texts) if (t.length > 3 && txt.includes(t)) { e.push("HUD line shows '" + txt.slice(0, 40) + "' before accept"); break; }
    const jn = journalNames(); if (def.title && jn.includes(def.title.slice(0, 14))) e.push('journal lists it before accept');
    if (def.objectives.some((o) => jn.includes(o.text.slice(0, 18)))) e.push('journal shows its objective before accept');
    const t = hud.target(relay.book, cworld); const p0 = posKey(def.objectives[0].when);
    if (t && t.kind === 2 && p0 !== null && t.x === p0) e.push('compass needle points at its first step before accept');
    if (t && t.kind === 1 && giverAt.get(t.x) === turnIn) e.push('compass shows a ready hand-in for it');
    rec(q, 'R3', !e.length, e.join('; '));
  }

  // ---- R1/R2: '!' over the giver (right colour), talk offers Accept/Exit
  const who = objectGiver ? 'obj:' + giver : giver;
  const notePanel = objectGiver && def.main;
  const shared = sharing('avail', giver).length;
  {
    const m = markState('avail', giver), want = expectColour('avail', giver);
    rec(q, 'R2', m === want, m === 'none' ? "no '!' over '" + giver + "'" : m !== want ? "'!' over " + giver + ' is ' + m + ' (expected ' + want + ')' : colour + ' ok');
  }
  {
    const e = [];
    const exit = notePanel ? { opened: true, offers: 1 } : (objectGiver && noteGiver(giver) ? readNote(giver, false) : talk(who, null));
    if (!exit.opened) e.push('cannot open a conversation with ' + who); else if (exit.offers < 1) e.push("'!' shown but talking gives NO Accept/Exit (OB-206 class)"); else if (exit.offers > shared) e.push('talk offered ' + exit.offers + ' quests, ' + shared + ' available at ' + giver);
    if (st(q) !== AVAILABLE) e.push('Exit changed status to ' + STATUS_NAMES[st(q)]); else if (markState('avail', giver) === 'none') e.push("'!' vanished after Exit");
    rec(q, 'R1', !e.length, e.join('; ') || 'offers ' + exit.offers + '/' + shared);
  }

  // ---- R4: accept -> '!' gone, tracked
  {
    const e = [];
    for (let n = 0; n < 30 && st(q) === AVAILABLE; n++) { notePanel ? relay.book.accept(q) : (objectGiver && noteGiver(giver) ? readNote(giver, true) : talk(who, 'q.' + q + '.accept')); finishShadows(q); }
    if (st(q) === AVAILABLE) { e.push('talking to ' + who + ' never accepts the quest (Accept flag q.' + q + '.accept); at giver: ' + defs.filter((d) => d.giver && d.giver.npc === giver).map((d) => d.id.replace(/^.*./, '') + ':' + STATUS_NAMES[st(d.id)]).join(' ')); relay.book.accept(q); }
    if (markState('avail', giver) !== 'none' && !sharing('avail', giver).length) e.push("'!' still shows over " + giver + ' after accept');
    if (relay.book.tracked() !== I) e.push('accepted quest is not tracked');
    if (st(q) === ACTIVE && !(relay.objectiveText() || '')) e.push('empty HUD line after accept');
    if (st(q) === ACTIVE && !journalNames().includes((def.title || q).slice(0, 14))) e.push('journal does not list it after accept');
    rec(q, 'R4', !e.length, e.join('; '));
  }

  // ---- R5/R9: every step through the compass + real events
  {
    const e5 = [], e9 = []; const o = def.objectives;
    for (let k = 0; k < o.length && st(q) === ACTIVE; k++) {
      const w = o[k].when;
      if (relay.book.questState(I).completed.length > k) continue; // already true at accept
      const t = hud.target(relay.book, cworld), tag = "step '" + o[k].id + "' (" + w.type + ' ' + (w.id || w.kind || '') + ')';
      if (ITEM.has(w.type) && !sources[w.id]) e5.push(tag + ': item has no entry in content/items/sources.json (compass cannot guide)');
      if (!t) e5.push(tag + ': no compass target');
      else {
        const g = giverAt.get(t.x);
        if (t.kind === 3) e5.push(tag + ": needle falls back to available giver '" + g + "' (OB-207 class)");
        else if (t.kind === 2 && g && g !== giver) e5.push(tag + ": needle points at another quest's giver '" + g + "'");
        else if (t.kind === 2 && g && ITEM.has(w.type)) e5.push(tag + ": needle points at its own giver '" + g + "' while gathering");
      }
      const f = []; doObjective(def, o[k], (s, m) => f.push(m)); if (f.length) e9.push(tag + ': ' + f[0]);
    }
    if (st(q) !== READY) e9.push('after all objectives status ' + STATUS_NAMES[st(q)] + ' (expected ready)');
    rec(q, 'R5', !e5.length, e5.join('; ')); rec(q, 'R9', !e9.length, e9.join('; '));
  }

  // ---- R6: '?' same colour at the turn-in, hand-in gives the reward
  {
    const e = [];
    if (st(q) === READY) {
      const m = markState('ready', turnIn), want = expectColour('ready', turnIn);
      if (m === 'none') e.push("no '?' over " + turnIn); else if (m !== want) e.push("'?' over " + turnIn + ' is ' + m + ' (expected ' + want + ')');
      const t = hud.target(relay.book, cworld); if (!t || t.kind !== 1 || giverAt.get(t.x) !== turnIn) e.push('compass does not point at the hand-in ' + turnIn);
      if (def.requireItem && countOf(inv, def.requireItem) < 1) getItem(def.requireItem, 1, noopFail);
      if (def.requireEquipped) for (const id of def.requireEquipped) { const sl = (itemDefs[id] && itemDefs[id].equip && itemDefs[id].equip.slot) || 'main'; player.components.equipment[sl] = id; }
      const before = {}; for (const it of (def.reward && def.reward.items) || []) before[it.id] = countOf(inv, it.id);
      for (let n = 0; n < 3 && st(q) === READY; n++) talk(turnIn, null);
      if (st(q) === READY) { for (let n = 0; n < 30 && st(q) === READY; n++) { talk(turnIn, 'q.__none__.accept'); finishShadows(q); } if (st(q) === DONE) e.push('hand-in only reachable after ACCEPTING the other pending offer(s) at ' + turnIn + ': Exit leaves the hand-in unreachable'); }
      if (st(q) !== DONE) { e.push('talking to ' + turnIn + ' did not hand in'); relay.book.handIn(q); }
      for (const it of (def.reward && def.reward.items) || []) { const got = countOf(inv, it.id) - before[it.id]; if (got !== it.n && !def.objectives.some((x) => x.when.id === it.id)) e.push('reward ' + it.id + ' x' + it.n + ' granted ' + got); }
      if (markState('ready', turnIn) !== 'none' && !sharing('ready', turnIn).length) e.push("'?' still over " + turnIn + ' after hand-in');
      if (def.next && st(def.next) !== AVAILABLE) e.push('next ' + def.next + ' is ' + STATUS_NAMES[st(def.next)] + ' after hand-in (expected available)');
    } else e.push('not READY after the objectives');
    rec(q, 'R6', !e.length, e.join('; '));
  }

  // ---- R1b (OB-206 class): with this quest ACTIVE at the giver, another AVAILABLE quest's '!' must still lead to its Accept/Exit
  if (!objectGiver) {
    fresh(); prereqs(def); relay.book.accept(q);
    const o2 = defs.find((d) => d.id !== q && d.giver && d.giver.npc === giver && !d.objectGiver && st(d.id) === AVAILABLE);
    if (o2 && markState('avail', giver) !== 'none') {
      let tries = 0; while (tries++ < 30 && st(o2.id) === AVAILABLE) { talk(giver, 'q.' + o2.id + '.accept'); finishShadows(q); }
      rec(q, 'R1', st(o2.id) !== AVAILABLE, "with '" + q + "' active, '!' over " + giver + " shows but talking never offers/accepts '" + o2.id + "' (OB-206)");
    }
  }

  // ---- R8: abandon -> available, '!' back, untracked
  {
    const e = [];
    fresh(); prereqs(def); relay.book.accept(q);
    for (let k = 0; k < def.objectives.length - 1 && st(q) === ACTIVE; k++) doObjective(def, def.objectives[k], noopFail);
    if (!relay.book.canAbandon(q)) rec(q, 'R8', true, 'abandon not allowed for this quest (canAbandon false)');
    else {
      if (!relay.book.abandon(q)) e.push('abandon refused');
      if (st(q) !== AVAILABLE) e.push('status after abandon ' + STATUS_NAMES[st(q)] + ' (expected available)');
      if (giver && markState('avail', giver) === 'none') e.push("'!' did not come back over " + giver);
      if (relay.book.tracked() === idx(q)) e.push('still tracked after abandon');
      relay.book.accept(q); if (st(q) !== ACTIVE && st(q) !== READY) e.push('cannot re-accept after abandon');
      rec(q, 'R8', !e.length, e.join('; '));
    }
  }
}

for (const def of defs) { try { audit(def); } catch (err) { rec(def.id, 'R9', false, 'crash: ' + String((err && err.stack) || err).split('\n').slice(0, 2).join(' | ')); } }
for (const id of onDisk) if (!loadedIds.has(id)) rec(id, 'R9', false, 'quest file on disk is not loaded');

// ---------------------------------------------------------------- report
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log(pad('quest', 28) + pad('rule', 5) + pad('res', 5) + 'detail');
for (const r of rows) if (SHOW_ALL || r.res !== 'PASS') console.log(pad(r.q, 28) + pad(r.rule, 5) + pad(r.res, 5) + String(r.detail).slice(0, 230));
const per = {}; for (const r of rows) { const p = per[r.rule] || (per[r.rule] = { PASS: 0, FAIL: 0, todo: 0 }); p[r.res]++; }
console.log('\nQUEST-RULES summary (' + defs.length + ' quests, ' + (Date.now() - T0) + ' ms): ' + Object.keys(per).sort().map((k) => k + ' pass ' + per[k].PASS + ' fail ' + per[k].FAIL + (per[k].todo ? ' todo ' + per[k].todo : '')).join(' | '));
const failed = rows.filter((r) => r.res === 'FAIL');
assert.equal(failed.length, 0, failed.length + ' rule failures (listed above)');
console.log('questRules.e2e ok');
