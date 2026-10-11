// Rook's main quests (mq.bend.call, mq.ford.mirror) on the REAL content + the errands.mainSync flag bridge + Rook's dialogue.
// Run: node game/js/quest/rookQuests.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadQuestFiles } from '../questBoot.js';
import { createQuestBook } from './sim/questBook.js';
import { loadContentPack, createDialogueRunner } from '../../../engine/index.js';
import { loadDesignAssets } from '../../../tools/validate-content.mjs';
import { createErrands } from './errands.js';

const ROOT = new URL('../../../', import.meta.url);
const rd = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const A = await loadDesignAssets();
assert.ok(A.items.defs['chart.river'] && A.items.defs['relay.mirror'], 'item defs');
const items = Object.values(A.items.defs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const files = await loadQuestFiles(async (u) => rd('game/' + u), { items, log: () => {} });
assert.deepEqual(files.errors, []);
for (const id of ['mq.bend.call', 'mq.ford.mirror']) assert.ok(files.giverDefs.some((d) => d.id === id && d.giver.npc === 'rook'), id + ' loaded');

const pack = new Map(), state = {};
const book = createQuestBook(files.questDef, files.giverDefs, null);
book.packOps = { count: (id) => pack.get(id) || 0, remove() {}, add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; }, equipped: () => false };
const questFlag = (k, v = true) => { state[k] = v; book.feed({ type: 'flag:set', key: k, value: v }); };
const world = { state, get: () => null, interactables: [], addInteractable() {} };
const er = createErrands({ getBook: () => book, questFlag, inspect() {} });
er.load(world);

// Rook's real dialogue, driven by the bridge flags
const small = { kind: 'manifest', schema: 1, id: 'rook-test', contentVersion: 1, files: ['dialogue/rook.dialogue.json'] };
const bundle = await loadContentPack(new URL('content/manifest.json', ROOT).href, { fetchText: async (u) => (u.endsWith('manifest.json') ? JSON.stringify(small) : readFileSync(new URL(u), 'utf8')) });
const talk = () => { // like dialogueCtl: s.<k> reads world.state, sets go through questFlag
  const said = [], r = createDialogueRunner({});
  r.open(bundle.dialogues.rook, { has: (k) => (k.startsWith('s.') ? !!state[k.slice(2)] : state['dlg.' + k] === true), set: (k) => { if (k.startsWith('s.')) questFlag(k.slice(2)); else state['dlg.' + k] = true; } });
  for (let g = 0; g < 60 && r.state !== 'ended'; g++) { if (r.state === 'typing') { said.push(r.line); r.press(); } else if (r.state === 'choosing') r.choose(); else r.press(); }
  er.talked('rook'); return said;
};
const st = (id) => book.statusOf(id);

// before the Bend relay wakes: talk is harmless, the accept flag is dropped
assert.equal(st('mq.bend.call'), 0);
talk(); assert.equal(st('mq.bend.call'), 0); assert.ok(!state['mq.bend.call.accept'], 'stale accept dropped');

// m1 step relay1 (the Bend relay) -> available; pulse flag 4 s after the wake
for (const o of files.questDef.objectives) { const w = o.when; if (w.type === 'flag') questFlag(w.id); else if (w.type === 'area') book.feed({ type: 'area:entered', id: w.id }); else if (w.type === 'item') book.feed({ type: 'item:got', id: w.id }); else if (w.type === 'beasts') for (const id of w.ids) book.feed({ type: 'beast:died', id }); if (o.id === 'relay1') break; }
questFlag('waystone.ws_roadBend.woken');
er.mainSync(0); assert.equal(st('mq.bend.call'), 1); assert.ok(state['mq.bend.call.available']);
er.mainSync(3); assert.ok(!state['relay.bend.pulseSeen']); er.mainSync(1.5); assert.ok(state['relay.bend.pulseSeen'], 'pulse seen');
const meet = talk(); assert.equal(meet.length, 8); assert.equal(st('mq.bend.call'), 2, 'accepted via dialogue'); assert.ok(state['mq.bend.call.active']);
assert.match(talk()[0], /Count the blinks/);
er.inspected('knot'); er.mainSync(0);
assert.equal(st('mq.bend.call'), 3); assert.ok(state['mq.bend.call.ready']);
const ready = talk(); assert.equal(ready.length, 6);
assert.equal(st('mq.bend.call'), 4, 'handed in via dialogue'); assert.deepEqual(book.lastReward.items, [{ id: 'chart.river', n: 1 }]);
assert.ok(state['mq.bend.call.done']); assert.match(talk()[0], /Do not drown/);

// Ch2: stones crossed -> mirror available; relay gate flag follows the pack; auto hand-in once the relay wakes
assert.equal(st('mq.ford.mirror'), 0);
book.feed({ type: 'area:entered', id: 'riverBank' }); book.feed({ type: 'area:entered', id: 'fordWest' }); er.mainSync(0);
assert.equal(st('mq.ford.mirror'), 1);
assert.match(talk()[0], /Wet boots/); assert.equal(st('mq.ford.mirror'), 2);
assert.match(talk()[0], /Climb/);
assert.ok(!state['mq.ford.mirror.glass']);
pack.set('relay.mirror', 1); book.feed({ type: 'item:got', id: 'relay.mirror' }); er.mainSync(0);
assert.ok(state['mq.ford.mirror.glass'], 'gate flag follows the pack');
questFlag('waystone.ws_ford.woken'); er.mainSync(0);
assert.equal(st('mq.ford.mirror'), 4, 'auto handed in'); assert.ok(state['mq.ford.mirror.done']);
assert.equal(talk().length, 2); // rook.mirror.done
console.log('rookQuests: PASS');
