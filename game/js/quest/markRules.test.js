// OB-155h/i/j/k + OB-164: quest marker rules over the REAL quest content (all giver quests) and the real world file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createQuestBook } from './sim/questBook.js';
import { modelTop, markHeight, structureTop, MARK_MARGIN } from './markTop.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';

const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const m1 = all.find(d => d.id === 'm1');
const book = createQuestBook(m1, all.filter(d => d.id !== 'm1'));
const world = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../content/worlds/world_m1.world.json', import.meta.url)), 'utf8'));
const ents = new Map(world.entities.map(e => [e.id, e]));
const structs = new Map(world.structures.map(s => [s.id, s]));
const A = { voxelModels: assets.voxelModels, models: assets.models, meshes: assets.meshes };

// OB-155k: main/side rule is transitive over `requires`
for (const id of ['tower.blade', 'burl.boars', 'mq.river.road', 'mq.ford.stones']) { if (book.index(id) !== undefined && book.index(id) > 0) assert.equal(book.isMain(book.index(id)), true, id + ' must be main'); }
assert.equal(book.isMain(book.index('tower.blade')), true, 'tower.blade (prerequisite of the main chain) is gold');

// OB-155h / OB-164: every marker anchor (giver + hand-in) that is a world entity hangs above its model top, never inside it
let nQuests = 0, nAnch = 0; const anchors = new Set();
for (let i = 1; ; i++) {
  let d; try { d = book.def(i); } catch { break; } if (!d) break; nQuests++;
  const g = d.giver; if (!g) continue;
  for (const id of [g.entity || g.npc, g.turnInEntity || g.turnIn].filter(Boolean)) anchors.add(id);
}
for (const id of anchors) {
  const eid = book.entityFor(id), e = ents.get(eid);
  if (!e) continue; // anchor lives in a pack / is a mesh placement
  const data = { components: e.components, transform: { scale: e.scale || (e.transform && e.transform.scale) || 1 } };
  const top = modelTop(data, A); nAnch++;
  if (top === null) continue; // no model bounds known: falls back to the default height
  const h = markHeight(data, A);
  assert.ok(h >= top + MARK_MARGIN - 1e-9, id + ': marker ' + h + ' must clear model top ' + top);
  if (e.components.voxel && e.components.voxel.model === 'waystone') assert.ok(h > 2.6, id + ': waystone marker above its 2.6 m stone, got ' + h);
}
assert.ok(nQuests >= 60 && nAnch >= 10, 'real content walked: ' + nQuests + ' quests, ' + nAnch + ' anchors');
assert.equal(markHeight({ components: { voxel: { model: 'nope' } } }, A), 1.55, 'unknown model -> fallback');
assert.equal(markHeight({ components: {} }, A, 0.14), 0.14, 'table override wins');

// model-less anchor next to a mesh placement (Outwall board, top 2.45 m): the marker uses the placement bbox; huge slabs are ignored
assert.equal(structureTop([{ bbox: { x0: 920, x1: 922, y0: 944, y1: 946, z0: -0.1, z1: 2.45 } }, { bbox: { x0: 0, x1: 500, y0: 0, y1: 500, z0: 0, z1: 9 } }], 921, 945, 0), 2.45);
assert.equal(structureTop([], 1, 1, 0), null);

// OB-155j: ONE marker per entity, priority ? > gold ! > blue !, over the real book at the start state and a synthetic pile-up
{
  const gA = [], gR = [], sA = [], sR = [];
  book.giverMarks(gA, gR, sA, sR); book.chainMarks(gA, gR); book.dedupeMarks(gA, gR, sA, sR);
  const keys = [...gA, ...gR, ...sA, ...sR].map(id => book.entityFor(id));
  assert.equal(new Set(keys).size, keys.length, 'one marker per entity at start: ' + keys.join(','));
  const a = ['bear', 'x'], r = ['y'], sa = ['bear', 'y', 'z'], sr = ['x'];
  book.dedupeMarks(a, r, sa, sr, id => id);
  assert.deepEqual([a, r, sa, sr], [['bear'], ['y'], ['z'], ['x']], 'blue ? beats gold ! beats blue !; gold ? beats everything');
}

// OB-155i: the main chain never shows a '?' waypoint, and the road '!' clears once the talk happened (OB-163), through every step
{
  const b = createQuestBook(m1, all.filter(d => d.id !== 'm1'));
  const steps = m1.objectives.map(o => o.id);
  for (let k = 0; k < steps.length; k++) {
    const a = [], r = []; b.chainMarks(a, r); assert.deepEqual(r, [], 'step ' + steps[k] + ': no chain ?');
    const o = m1.objectives[k];
    if (o.mark && o.mark.taken) { b.feed({ type: 'flag:set', key: o.mark.taken, value: true }); const a2 = []; b.chainMarks(a2, []); assert.deepEqual(a2, [], o.id + ': ! gone after the talk'); }
    const w = o.when; // advance to the next step
    if (w.type === 'flag') b.feed({ type: 'flag:set', key: w.id, value: w.equals !== undefined ? w.equals : true });
    else if (w.type === 'area') b.feed({ type: 'area:entered', id: w.id });
    else if (w.type === 'item') b.feed({ type: 'item:got', id: w.id });
  }
}
console.log('markRules ok: ' + nQuests + ' quests, ' + nAnch + ' anchors checked');
