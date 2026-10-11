// QL-WIRE + QL-13: the game-side errand wiring against the REAL content/quests packs and a fake world (no browser).
// Run: node game/js/quest/errands.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadQuestFiles } from '../questBoot.js';
import { createQuestBook, AVAILABLE, ACTIVE, READY } from './sim/questBook.js';
import { compileDialogue, createDialogueRunner } from '../../../engine/index.js';
import { loadDesignAssets } from '../../../tools/validate-content.mjs';
import { createErrands, gateOnMeet, patchBearDialogue, isWorn, bannerLines, siteOf } from './errands.js';
import { wrapText } from './questInspect.js';

const ROOT = new URL('../../../', import.meta.url);
const rd = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const A = await loadDesignAssets();
const items = Object.values(A.items.defs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const files = await loadQuestFiles(async (u) => rd('game/' + u), { items, log: () => {} });
assert.deepEqual(files.errors, []);
const defs = gateOnMeet(files.giverDefs);
assert.notEqual(defs, files.giverDefs);

const pack = new Map(), eq = {};
function newBook() {
  pack.clear(); for (const k of Object.keys(eq)) delete eq[k];
  const b = createQuestBook(files.questDef, defs, null);
  b.packOps = { count: (id) => pack.get(id) || 0, remove: (id, n) => pack.set(id, (pack.get(id) || 0) - n), add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; }, equipped: (id) => isWorn(eq, id) };
  return b;
}
const book = newBook();
const feed = (e) => book.feed(e);
const flag = (key) => feed({ type: 'flag:set', key, value: true });

// 1. gateOnMeet: errands stay shut until Burl's first greeting
for (const o of files.questDef.objectives) { const w = o.when; if (w.type === 'flag') flag(w.id); else if (w.type === 'area') feed({ type: 'area:entered', id: w.id }); else if (w.type === 'beasts') for (const id of w.ids) feed({ type: 'beast:died', id }); }
flag('burl.home');
assert.notEqual(book.statusOf('sq.burl.stone'), AVAILABLE, 'gated until burl.home.met');
assert.ok(defs.find((d) => d.id === 'sq.burl.stone').requires.some((r) => r.flag === 'burl.home.met'));
assert.equal(gateOnMeet(defs).find((d) => d.id === 'sq.burl.stone').requires.filter((r) => r.flag === 'burl.home.met').length, 1, 'idempotent'); assert.equal(defs.find((d) => d.id === 'sq.burl.stone').requires.filter((r) => r.flag === 'burl.home.met').length, 1, 'idempotent');
for (const id of ['tower.blade', 'burl.boars']) { book.accept(id); for (const o of book.def(book.index(id)).objectives) { const w = o.when; if (w.type === 'beasts') for (const b of w.ids) feed({ type: 'beast:died', id: b }); else if (w.type === 'item') feed({ type: 'item:got', id: w.id }); else if (w.type === 'area') feed({ type: 'area:entered', id: w.id }); else if (w.type === 'flag') flag(w.id); } book.handIn(id); }
flag('burl.home.met');
assert.equal(book.statusOf('sq.burl.stone'), AVAILABLE);

// 2. Burl's dialogue: compiled, every errand reachable through its q.<id>.* routes; accept / hand-in act on the real book
const raw = rd('content/dialogue/bear.dialogue.json');
const patched = patchBearDialogue(raw, defs);
assert.ok(patched !== raw && raw.entry.length < patched.entry.length && !raw.nodes['bear.err.0.offer.1'], 'input untouched');
const dlg = compileDialogue(patched);
const burlErrands = defs.filter((d) => d.giver && d.giver.npc === 'bear' && d.lines && !d.main && d.region === 'ch12');
assert.ok(burlErrands.length >= 11, 'Burl errands: ' + burlErrands.length);
const flagsOut = [];
function talkBurl(pick = 0) { // run the real dialogue runner to its end; returns the spoken lines
  const said = [], st = { 'burl.home': true, 'burl.home.met': true };
  const run = createDialogueRunner({});
  run.open(dlg, { has: (k) => (k.startsWith('q.') ? book.hasKey(k) : !!st[k.replace(/^s./, '')]), set: (k) => { flagsOut.push(k); if (k.startsWith('q.')) book.actKey(k); } });
  for (let guard = 0; guard < 80 && run.state !== 'ended'; guard++) {
    if (run.state === 'choosing') { for (let i = 0; i < pick; i++) run.move(1); run.choose(); continue; }
    if (run.line && said.at(-1) !== run.line) said.push(run.line);
    run.press();
  }
  assert.equal(run.state, 'ended');
  return said;
}
// Burl offers the first available errand (sq.tm.nub needs burl.boars done = yes) and accepts it by the choice
const said = talkBurl(0);
assert.ok(said.length >= 2 && flagsOut.some((k) => /^q.sq..*.accept$/.test(k)), 'offer + accept by talking: ' + flagsOut.join(','));
assert.ok(said.some((l) => /Nub|slope|boar|sky-cub/i.test(l)), 'writer lines are spoken');
const acceptedId = flagsOut.find((k) => /.accept$/.test(k)).slice(2, -7);
assert.equal(book.statusOf(acceptedId), ACTIVE);
const again = talkBurl(0); assert.ok(again.length, 'next talk offers the next errand or repeats active');
// the routes themselves (compile gate): ready < offer < active, each errand has all three
const ent = patched.entry.map((e) => e.requires || '');
for (const d of burlErrands) for (const s of ['ready', 'available', 'active']) assert.ok(ent.includes('q.' + d.id + '.' + s), d.id + ' ' + s);
assert.ok(patched.entry.findIndex((e) => e.node === 'bear.err.0.ready') < patched.entry.findIndex((e) => e.node === 'bear.err.0.offer.1'));
assert.ok(patched.entry.findIndex((e) => e.node === 'bear.err.0.active') < patched.entry.findIndex((e) => e.node === 'bear.home.again'));

// 3. object givers on a fake world: post / notePost get [E] Inspect, relays map by waystone id, entity without transform skipped
const ents = {
  post: { components: { inspect: { text: 'post.basket' } }, transform: { x: 998, y: 1060, z: 3 } },
  notePost: { components: { inspect: { text: 'note.straw' } }, transform: { x: 966, y: 1086, z: 2 } },
  relayBend: { components: { waystone: { id: 'ws_roadBend', kind: 'relay' } }, transform: { x: 1262, y: 1033, z: -31 } },
  relayFord: { components: { waystone: { id: 'ws_ford', kind: 'relay' } }, transform: { x: 992, y: 1079, z: -86 } },
  bear: { components: { dialogue: 'bear' }, transform: { x: 1400, y: 1040, z: 0 } },
};
const fw = { interactables: [], get: (id) => (ents[id] ? { data: ents[id] } : null), addInteractable(s) { this.interactables.push(s); return s; } };
const inspected = [], flags = {};
const er = createErrands({ getBook: () => book, questFlag: (k, v = true) => { flags[k] = v; return flag(k); }, inspect: (id) => inspected.push(id) });
assert.equal(er.load(fw), 2, 'post + notePost only');
assert.deepEqual(fw.interactables.map((r) => [r.key, r.name, r.def.objectId]).sort(), [['qi.notePost', 'quest.inspect', 'notePost'], ['qi.post', 'quest.inspect', 'post']]);
assert.equal(er.load(fw), 0, 'idempotent: no duplicates'); // second world:loaded on the same fake list
er.onEvent('prop:touched', { id: 'ws_roadBend', kind: 'relay' }); er.onEvent('prop:touched', { id: 'ws_roadBend', kind: 'waystone' }); er.onEvent('prop:touched', { id: 'nope', kind: 'relay' });
assert.deepEqual(inspected, ['relayBend'], 'relay touch -> inspect(relayBend) only');

// 4. real inspect flow: shield at the Bend relay (giveOnTalk), requireEquipped hand-in at the Ford relay
assert.equal(book.statusOf('sq.rb.shield'), AVAILABLE);
const acc = book.inspect('relayBend'); assert.equal(acc.action, 'accept'); assert.equal(pack.get('shield'), 1, 'shield given on accept');
feed({ type: 'area:entered', id: 'fordWest' });
assert.equal(book.statusOf('sq.rb.shield'), READY);
assert.equal(book.inspect('relayFord').action, 'refuse', 'shield not worn -> refused');
eq.off = 'shield'; assert.equal(isWorn(eq, 'shield'), true); assert.equal(isWorn({ off: { id: 'shield' } }, 'shield'), true); assert.equal(isWorn(null, 'x'), false);
const hi = book.inspect('relayFord'); assert.equal(hi.action, 'handin'); assert.deepEqual(hi.reward.items, [{ id: 'potion.hp', n: 1 }]);
// banner rows from the writer lines
const d = book.def(book.index('sq.rb.shield'));
const rows = bannerLines(d, 'accept', wrapText); assert.ok(rows && rows.length && rows.every((r) => r.length <= 38), 'wrapped offer rows');
assert.deepEqual(bannerLines(d, 'handin', wrapText), bannerLines(d, 'handin', wrapText));
assert.equal(bannerLines({}, 'accept', wrapText), null); assert.equal(bannerLines(d, 'nonsense', wrapText), null);
assert.ok(bannerLines(d, 'refuse', wrapText, 1).length <= 1);

// 5. talk.<site> and straw-man flags only while an errand wants them
assert.equal(siteOf('bear'), 'burl'); assert.equal(siteOf('notePost'), 'notePost');
er.talked('bear'); assert.equal(flags['talk.burl'], undefined, 'no active talk errand yet');
for (const id of ['sq.burl.parcel', 'sq.burl.ask']) assert.ok(book.index(id) > 0);
function force(id) { // accept the quest and everything before it via events
  const dd = book.def(book.index(id));
  for (const r of dd.requires || []) if (r.quest && book.statusOf(r.quest) !== 4) force(r.quest);
  if (book.statusOf(id) === AVAILABLE) book.accept(id);
  if (book.statusOf(id) === ACTIVE) { for (const o of dd.objectives) { const w = o.when; if (w.type === 'area') feed({ type: 'area:entered', id: w.id }); else if (w.type === 'beasts') for (const b of w.ids) feed({ type: 'beast:died', id: b }); else if (w.type === 'item') feed({ type: 'item:got', id: w.id }); else if (w.type === 'deliver') feed({ type: 'item:count', id: w.id, n: w.count }); } }
  if (book.statusOf(id) === READY) { if (dd.requireItem) pack.set(dd.requireItem, 3); book.handIn(id); }
}
force('sq.burl.scout'); // ask requires scout; scout done
assert.equal(book.statusOf('sq.burl.ask'), AVAILABLE); book.accept('sq.burl.ask');
er.inspected('notePost'); assert.equal(flags['talk.notePost'], true, 'inspect notePost sets talk.notePost'); assert.equal(inspected.at(-1), 'notePost');
assert.equal(book.statusOf('sq.burl.ask'), READY);
force('sq.tm.nub');
assert.equal(book.statusOf('sq.straw'), AVAILABLE);
er.hit({ target: 'target1' }); assert.equal(flags['target1.hit'], undefined, 'hits before the errand is active do not count');
book.accept('sq.straw');
er.hit({ target: 'target2' }); er.hit({ target: 'target9' }); er.hit({ target: 'boar1' }); er.hit(null);
assert.deepEqual(Object.keys(flags).filter((k) => k.startsWith('target')), ['target2.hit']);
er.hit({ target: 'target1' }); er.hit({ target: 'target3' });
assert.equal(book.statusOf('sq.straw'), READY, 'three straw men -> ready; note post hands in');
assert.equal(book.inspect('notePost').action, 'handin'); assert.deepEqual(book.lastReward.items, [{ id: 'arrow', n: 20 }], 'Big Quiver: 20 arrows');

// 6. escort flag: only while sq.burl.walk is active and Burl is within 14 m of the Bend relay
assert.equal(er.escortTick(), false, 'quest not active');
force('sq.burl.walk'); // accept; objective is a flag, so it stays active
book.statusOf('sq.burl.walk') === AVAILABLE && book.accept('sq.burl.walk');
if (book.statusOf('sq.burl.walk') === ACTIVE) {
  assert.equal(er.escortTick(), false, 'Burl far from the relay');
  ents.bear.transform.x = 1255; ents.bear.transform.y = 1036;
  assert.equal(er.escortTick(), true); assert.equal(flags['escort.bear.relayBend'], true);
}

// 7. content: the hint stone is a plain area circle now (the terrain-shaped once-only zone could not fire reliably)
const w = rd('content/worlds/world_m1.world.json'), areas = rd('content/quests/areas.json');
const trig = w.triggers.find((t) => t.id === areas.areas.hintStone.trigger);
assert.ok(trig && trig.shape === 'circle', 'hintStone area -> circle trigger ' + areas.areas.hintStone.trigger);
console.log('errands.test.js: OK');
