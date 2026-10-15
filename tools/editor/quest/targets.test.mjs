// ED-QUEST-03: classification, snap, rejection, undo over the real world_m1 + quest content.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests, makeStack } from './model.js';
import { classify, resolveTarget, groundTarget, applyPick, NOT_CHARACTER, AREA_RADIUS, siteFor, enemyKind } from './targets.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const world = JSON.parse(readFileSync(join(root, 'content/worlds/world_m1.world.json'), 'utf8'));
const m = loadQuests(join(root, 'content/quests'));
const sites = JSON.parse(readFileSync(join(root, 'content/quests/sites.json'), 'utf8')).sites;
const floorAt = (x, y) => 100 + x * 0.01 + y * 0.001;     // stand-in terrain: only "snapped, not ray z" matters
const ctx = { sites, floorAt, model: m };
const q = (id) => m.quests.find((x) => x.id === id);

// classification over every real entity: npcs with dialogue are characters, brains are enemies, rest objects
const tally = { character: 0, enemy: 0, object: 0 };
for (const e of world.entities) tally[classify(e)]++;
assert.equal(tally.character, 16); assert.ok(tally.enemy >= 20); assert.ok(tally.object >= 80);
assert.equal(resolveTarget(world, 'bear', ctx).kind, 'character');
assert.equal(resolveTarget(world, 'hesk', ctx).kind, 'character');
assert.equal(resolveTarget(world, 'notePost', ctx).kind, 'object');
assert.equal(resolveTarget(world, 'boar1', ctx).kind, 'enemy');
assert.equal(resolveTarget(world, 'burl', ctx).id, 'bear', 'site id resolves through sites.json');
assert.equal(resolveTarget(world, 'nope', ctx), null);
assert.equal(siteFor(sites, 'bear'), 'burl'); assert.equal(enemyKind(world.entities.find((e) => e.id === 'boar1')), 'boar');

// ground snap
const g = groundTarget({ x: 1000, y: 1000, z: 5 }, ctx);
assert.equal(g.kind, 'area'); assert.equal(g.z, +floorAt(1000, 1000).toFixed(2)); assert.equal(g.radius, AREA_RADIUS);

// giver: legacy quest -> giver.npc is the entity id (Burl = "bear"); pack quest -> site id
const stack = makeStack();
let r = applyPick(q('sq.burl.blue'), 'giver', { entityId: 'bear' }, world, ctx);
assert.equal(r.error, null); stack.run(r.cmd); assert.equal(q('sq.burl.blue').raw.giver.npc, 'bear');
const tm = q('sq.tm.nub'), before = JSON.stringify(tm.raw);
r = applyPick(tm, 'giver', { entityId: 'hesk' }, world, ctx); stack.run(r.cmd); assert.equal(tm.raw.site, 'hesk');
stack.undo(); assert.equal(JSON.stringify(tm.raw), before, 'one pick = one undo step');

// rejection: object for giver/return sets nothing (D-082); objectGiver quest may take the object as giver (D-087)
const bl = q('sq.burl.blue'), snap = JSON.stringify(bl.raw);
for (const slot of ['giver', 'return']) {
  r = applyPick(bl, slot, { entityId: 'notePost' }, world, ctx);
  assert.equal(r.cmd, null); assert.equal(r.error, NOT_CHARACTER);
}
assert.equal(JSON.stringify(bl.raw), snap);
const tb = q('tower.blade');
assert.equal(tb.raw.objectGiver, true);
r = applyPick(tb, 'giver', { entityId: 'notePost' }, world, ctx); assert.equal(r.error, null);
r = applyPick(tb, 'return', { entityId: 'notePost' }, world, ctx); assert.equal(r.error, NOT_CHARACTER);
r = applyPick(tb, 'return', { entityId: 'bear' }, world, ctx); stack.run(r.cmd); assert.equal(tb.raw.giver.turnIn, 'bear');
r = applyPick(bl, 'giver', { point: { x: 1, y: 2, z: 3 } }, world, ctx); assert.equal(r.error, NOT_CHARACTER, 'ground is not a character');

// objective target: area step <- ground (legacy when / pack params), snapped; character step <- npc only
r = applyPick(tb, { obj: 0 }, { point: { x: 1010, y: 1020, z: 0 } }, world, ctx); stack.run(r.cmd);
assert.deepEqual(tb.raw.objectives[0].when, { type: 'area', id: 'tower.blade.a1' }, 'legacy when keeps the game format (area id only)');
assert.deepEqual(m.files.get('areas.json').obj.areas['tower.blade.a1'], { world: 'world_m1', trigger: 'tower.blade.a1' });
assert.deepEqual(m.zones.find((z) => z.id === 'tower.blade.a1'), { id: 'tower.blade.a1', note: m.zones[0].note, r: 4, shape: 'circle', x: 1010, y: 1020 });
r = applyPick(tm, { obj: 0 }, { point: { x: 1010, y: 1020, z: 0 } }, world, ctx); stack.run(r.cmd);
assert.deepEqual(tm.raw.steps[0].params.areas, ['sq.tm.nub.a1']); assert.equal(tm.raw.steps[0].params.spot, undefined);
stack.undo(); assert.equal(m.files.get('areas.json').obj.areas['sq.tm.nub.a1'], undefined, 'undo removes the area too'); stack.redo();
r = applyPick(tm, { obj: 0 }, { entityId: 'bear' }, world, ctx); assert.equal(r.error, 'Click the ground for this step');
const dq = m.quests.find((x) => x.kind === 'pack' && x.raw.steps.some((s) => s.template === 'deliver'));
const di = dq.raw.steps.findIndex((s) => s.template === 'deliver');
r = applyPick(dq, { obj: di }, { entityId: 'notePost' }, world, ctx); assert.equal(r.error, NOT_CHARACTER);
r = applyPick(dq, { obj: di }, { entityId: 'hesk' }, world, ctx); stack.run(r.cmd); assert.equal(dq.raw.steps[di].params.to, 'hesk');
const kq = m.quests.find((x) => x.kind === 'pack' && x.raw.steps.some((s) => s.template === 'kill'));
const ki = kq.raw.steps.findIndex((s) => s.template === 'kill');
r = applyPick(kq, { obj: ki }, { entityId: 'boar1' }, world, ctx); stack.run(r.cmd);
assert.equal(kq.raw.steps[ki].params.kind, 'boar'); assert.equal(kq.raw.steps[ki].params.ids, undefined);
r = applyPick(kq, { obj: ki }, { entityId: 'bear' }, world, ctx); assert.equal(r.error, 'Pick an enemy');
while (stack.undo());
console.log('targets.test PASS');
