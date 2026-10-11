// Data-driven look-at texts (content/dialogue/inspect.json) wired by errands.js: generic qi.<id> anchors, again variant, nest gating.
// Run: node game/js/quest/errandsInspect.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createErrands } from './errands.js';

const texts = JSON.parse(readFileSync(new URL('../../../content/dialogue/inspect.json', import.meta.url), 'utf8'));
// table limits (story.md): title <= 28, lines <= 56, prompt <= 24, ASCII
for (const [k, t] of Object.entries(texts.texts)) {
  if (t.prompt) assert.ok(t.prompt.length <= 24 && /^\[E\] /.test(t.prompt), k + ' prompt');
  assert.ok(t.title.length <= 28, k + ' title');
  for (const l of t.lines) assert.ok(l.length <= 56 && /^[\x20-\x7e]*$/.test(l), k + ' line: ' + l);
}
const tr = (x) => ({ x, y: 1, z: 0 });
const ents = {
  rsInspectWagon: { components: { inspect: { text: 'inspect.wagon' } }, transform: tr(1) },
  rsInspectWell: { components: { inspect: { text: 'inspect.well' } }, transform: tr(2) },
  rsInspectShrine: { components: { inspect: { text: 'inspect.shrine' } }, transform: tr(3) },
  rsInspectWoodpile: { components: { inspect: { text: 'inspect.woodpile' } }, transform: tr(4) },
  hiddenScrawl: { components: { inspect: { text: 'scrawl.hiddenChest' } }, transform: tr(5) }, // not in the table: untouched
  tradeLamp: { components: {}, transform: tr(6) },
  knot: { components: { inspect: { text: 'note.knot' } }, transform: tr(7) },
  sealedGate: { components: { inspect: { text: 'note.sealedGate' } }, transform: tr(8) },
  nest: { components: { questPickup: { item: 'relay.mirror', n: 1 } }, transform: tr(9) },
};
const world = { state: {}, interactables: [], get: (id) => (ents[id] ? { data: ents[id] } : null), addInteractable(s) { this.interactables.push(s); return s; },
  forEachEntity(fn) { for (const id of Object.keys(ents)) fn(ents[id], id); } };
let mirror = 0; const banners = [], flags = [], inspected = [];
const book = { count: 1, statusOf: () => 0, packOps: { count: () => mirror } };
const er = createErrands({ getBook: () => book, questFlag: (k) => flags.push(k), inspect: (id) => inspected.push(id), note: (t, l) => banners.push([t, l]), texts });
er.load(world); er.mainSync(0);
const keys = world.interactables.map((r) => r.key).sort();
assert.deepEqual(keys, ['qi.knot', 'qi.rsInspectShrine', 'qi.rsInspectWagon', 'qi.rsInspectWell', 'qi.rsInspectWoodpile', 'qi.sealedGate', 'qi.tradeLamp'], keys.join());
assert.equal(world.interactables.find((r) => r.key === 'qi.rsInspectWell').prompt, '[E] Look at the well');
assert.equal(world.interactables.find((r) => r.key === 'qi.sealedGate').radius, 3.2);
assert.equal(er.load(world) , 0, 'idempotent'); // second world:loaded: no duplicates
// look: banner = title + lines, never throws / locks, book hook still called
er.inspected('rsInspectWagon');
assert.deepEqual(banners.at(-1), ['A cart off the road', texts.texts['inspect.wagon'].lines]);
er.inspected('knot'); assert.ok(flags.includes('lore.knot.read')); assert.equal(banners.at(-1)[0], 'A knot on the brass');
// gate: first look = text + locked hint; second look = the `again` variant, hint again
banners.length = 0; er.inspected('sealedGate');
assert.deepEqual(banners.map((b) => b[0]), ['A gate across the pass', 'The Sealed Gate']);
banners.length = 0; er.inspected('sealedGate');
assert.deepEqual(banners[0][1], texts.texts['note.sealedGate.again'].lines); assert.equal(banners[1][1][0], 'Locked. The bars do not even rattle.');
assert.ok(!inspected.includes('sealedGate'), 'gate: no book action');
// nest: no anchor while the glass is there (no clash with the pickup prompt); appears once the mirror was taken
assert.ok(!world.interactables.some((r) => r.key === 'qi.nest'));
mirror = 1; er.mainSync(0); const nest = world.interactables.find((r) => r.key === 'qi.nest');
assert.ok(nest && nest.prompt === '[E] Look at the nest');
banners.length = 0; er.inspected('nest'); assert.equal(banners[0][0], "A crow's nest"); assert.equal(banners[0][1].length, 3);
// no texts table: nothing added, nothing breaks
const w2 = { interactables: [], get: world.get, addInteractable: world.addInteractable, forEachEntity: world.forEachEntity };
const e2 = createErrands({ getBook: () => book, questFlag() {}, inspect() {}, note() {} }); assert.equal(e2.load(w2), 0); e2.inspected('knot');
console.log('errandsInspect.test.js: OK');
