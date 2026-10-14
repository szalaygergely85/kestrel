// Ch3 mq.ow.names -> mq.ow.relay -> mq.ow.board on the real pack + errands bridge + Hesk / Dorrin dialogue.
// Run: node game/js/quest/ch3names.test.js
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createQuestBook } from './sim/questBook.js';
import { createErrands } from './errands.js';
import { loadContentPack, createDialogueRunner } from '../../../engine/index.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';

const ROOT = new URL('../../../', import.meta.url);
const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('content/quests', ROOT));
const all = [...loadQuestFiles(dir).quests, ...(await loadPackQuests(dir, assets.items?.defs)).quests].map((q) => q.def);
const get = (id) => all.find((d) => d.id === id);
const state = {}, pack = new Map();
const smoke = { ...get('mq.smoke') }; delete smoke.requires;
const defs = [get('m1'), smoke, get('mq.ow.path'), get('mq.ow.fence'), get('mq.ow.names'), get('mq.ow.relay'), get('mq.ow.board')];
const book = createQuestBook(defs[0], defs.slice(1));
book.packOps = { count: (id) => pack.get(id) || 0, remove() {}, add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; }, equipped: () => false };
const questFlag = (k, v = true) => { state[k] = v; book.feed({ type: 'flag:set', key: k, value: v }); };
const er = createErrands({ getBook: () => book, questFlag, inspect(id) { book.feed({ type: 'inspect', id }); }, note() {}, texts: {} });
er.load({ state, get: () => null, interactables: [], addInteractable() {} });
const small = { kind: 'manifest', schema: 1, id: 't', contentVersion: 1, files: ['dialogue/hesk.dialogue.json', 'dialogue/dorrin.dialogue.json'] };
const bundle = await loadContentPack(new URL('content/manifest.json', ROOT).href, { fetchText: async (u) => (u.endsWith('manifest.json') ? JSON.stringify(small) : readFileSync(new URL(u), 'utf8')) });
const talk = (npc) => {
  er.mainSync(0); const said = [], r = createDialogueRunner({ pageLines: 1 });
  r.open(bundle.dialogues[npc], { has: (k) => (k.startsWith('s.') ? !!state[k.slice(2)] : state['dlg.' + k] === true), set: (k) => { if (k.startsWith('s.')) questFlag(k.slice(2)); else state['dlg.' + k] = true; } });
  for (let g = 0; g < 40 && r.state !== 'ended'; g++) { if (r.state === 'typing') { said.push(r.line); r.press(); } else if (r.state === 'choosing') r.choose(); else r.press(); }
  er.talked(npc); return said;
};
const st = (id) => book.statusOf(id);
book.feed({ type: 'flag:set', key: 'lore.fordMark.read', value: true }); book.feed({ type: 'area:entered', id: 'northLook' });
// path + fence are Hesk's main quests now: Accept at Hesk, do, hand in at Hesk
assert.equal(st('mq.ow.path'), 1); assert.match(talk('hesk')[0], /Smoke on the wind/); assert.equal(st('mq.ow.path'), 2, 'path accepted at Hesk');
book.feed({ type: 'area:entered', id: 'owPath' }); er.mainSync(0); assert.equal(st('mq.ow.path'), 3); talk('hesk'); assert.equal(st('mq.ow.path'), 4, 'path handed in at Hesk');
assert.equal(st('mq.ow.fence'), 1); talk('hesk'); assert.equal(st('mq.ow.fence'), 2, 'fence accepted at Hesk');
for (const id of ['wolf1', 'wolf2', 'wolf3', 'wolf4', 'wolf5']) book.feed({ type: 'beast:died', id });
er.mainSync(0); assert.equal(st('mq.ow.fence'), 3); talk('hesk'); assert.equal(st('mq.ow.fence'), 4, 'fence handed in at Hesk'); assert.equal(st('mq.ow.names'), 1, 'names open after the fence');
assert.match(talk('hesk')[0], /Hands where I can see them/);
assert.equal(st('mq.ow.names'), 3, 'accept + talk in ONE conversation = READY, no auto hand-in'); assert.match(talk('hesk')[0], /^Wick./); assert.equal(st('mq.ow.names'), 4, 'handed in by talking to Hesk again');
assert.ok(book.lastReward.items.some((i) => /^gear\./.test(i.id)), 'gear T3 reward');
assert.equal(st('mq.ow.relay'), 1); talk('hesk'); assert.equal(st('mq.ow.relay'), 2, 'Hesk gives the relay job');
assert.match(talk('dorrin')[0], /brass collar off it/);
book.packOps.add('relay.brass', 1); book.feed({ type: 'item:got', id: 'relay.brass' });
questFlag('waystone.ws_outwall.woken'); er.mainSync(0);
assert.equal(st('mq.ow.relay'), 3, 'relay READY once the Outwall relay wakes'); talk('hesk'); assert.equal(st('mq.ow.relay'), 4, 'handed in at Hesk'); assert.equal(st('mq.ow.board'), 1);
talk('hesk'); assert.equal(st('mq.ow.board'), 2, 'board accepted at Hesk'); er.inspected('owBoard'); assert.equal(st('mq.ow.board'), 3, 'reading the board readies it');
talk('hesk'); assert.equal(st('mq.ow.board'), 4, 'board handed in at Hesk'); assert.deepEqual(book.lastReward.items, [{ id: 'chart.westFells', n: 1 }]);
book.packOps.add('chart.westFells', 1); er.mainSync(0); assert.equal(state['chart.westFells'], true, 'chart piece flag from the pack');
console.log('ch3 names/relay/board: pass');
