// WMP-01 wiring: wake ws_downs -> questFlag -> book offers sq.reg.downs -> relay touch -> errands.inspected -> book.inspect accepts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRelayWake, FLAG_ATTUNED } from './relayWake.js';
import { createErrands } from './errands.js';
import { createQuestBook, ACTIVE, AVAILABLE } from './sim/questBook.js';
import { loadDesignAssets, loadPackQuests } from '../../../tools/validate-content.mjs';

const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const packs = await loadPackQuests(dir, assets.items?.defs);
const m1 = JSON.parse(fs.readFileSync(dir + '/m1.quest.json', 'utf8'));
const book = createQuestBook(m1, packs.quests.map((q) => q.def).filter((d) => d.id === 'sq.reg.downs'));
const state = { [FLAG_ATTUNED]: true, 'waystone.waystone.woken': true };
const ent = { id: 'relay_downs', transform: { x: 5, y: 6, z: 1 }, components: { voxel: { model: 'relay', anim: 'dead' }, light: { preset: 'relay', on: false }, waystone: { id: 'ws_downs', kind: 'relay' } } };
const world = { state, assets: { has: () => false }, forEachEntity: (fn) => fn(ent, ent.id), get: (id) => (id === ent.id ? { data: ent, play() {} } : null), addInteractable: (s) => s, interactables: [] };
const flag = (k, v = true) => { state[k] = v; book.feed({ type: 'flag:set', key: k, value: v }); };
const er = createErrands({ getBook: () => book, questFlag: flag, inspect: (id) => book.inspect(id) });
er.load(world);
const rw = createRelayWake({ world, questFlag: (k) => flag(k), emit: (id, kind) => er.onEvent('prop:touched', { id, kind }), hum() {} });
assert.notEqual(book.statusOf('sq.reg.downs'), AVAILABLE, 'not offered before the wake');
assert.equal(rw.interact('ws_downs'), true);
assert.equal(state['waystone.ws_downs.woken'], true, 'quest flag set through questFlag');
assert.equal(book.statusOf('sq.reg.downs'), AVAILABLE, 'OB-126: the wake touch only OFFERS the errand');
for (let i = 0; i < 600; i++) rw.step(0.05, null); // let the wake finish
assert.equal(rw.interact('ws_downs'), true); // second E on the awake relay = explicit accept
assert.equal(book.statusOf('sq.reg.downs'), ACTIVE, 'second touch -> inspect(relay_downs) -> errand accepted');
console.log('regionRelayWire OK');
