// BH-S7: errands' offered/looked Sets are reset on world:loaded (Load / R in the same page session).
// Run: node game/js/quest/errandsReload.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createErrands } from './errands.js';

const texts = JSON.parse(readFileSync(new URL('../../../content/dialogue/inspect.json', import.meta.url), 'utf8'));
const ents = { sealedGate: { components: { inspect: { text: 'note.sealedGate' } }, transform: { x: 1, y: 1, z: 0 } } };
const world = { state: {}, interactables: [], get: (id) => (ents[id] ? { data: ents[id] } : null), addInteractable(s) { this.interactables.push(s); return s; },
  forEachEntity(fn) { for (const id of Object.keys(ents)) fn(ents[id], id); } };
const banners = [], book = { count: 1, statusOf: () => 0, packOps: { count: () => 0 } };
const er = createErrands({ getBook: () => book, questFlag() {}, inspect() {}, note: (t, l) => banners.push([t, l]), texts });
er.load(world);
er.inspected('sealedGate'); er.inspected('sealedGate');
assert.deepEqual(banners.at(-2)[1], texts.texts['note.sealedGate.again'].lines, 'second look = again variant');
banners.length = 0;
er.load(world); // Load / R: fresh world, fresh "looked"
er.inspected('sealedGate');
assert.deepEqual(banners[0][1], texts.texts['note.sealedGate'].lines, 'after load the first look is the first-look text');
console.log('errandsReload: ok');
