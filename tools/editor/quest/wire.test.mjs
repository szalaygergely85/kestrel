import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests } from './model.js';
import { makeNames } from './flow.js';
import { buildLintCtx, liveLint, presetOptions, playUrl } from './wire.js';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content/quests');
const m = loadQuests(dir);
const q = m.quests.find((x) => x.id === 'sq.burl.blue');
const world = { entities: [{ id: 'bear', type: 'npc', x: 10, y: 20, components: { dialogue: {} } }, { id: 'crate', type: 'prop', x: 12, y: 20 }] };
const ctx = buildLintCtx({ world, itemDefs: {}, names: makeNames({ npcNames: { bear: 'Burl' } }), floorAt: () => 3 });
assert.ok(ctx.characters.has('bear') && !ctx.characters.has('crate'));
assert.deepEqual(ctx.pos('crate'), { x: 12, y: 20, z: 3 }); assert.equal(ctx.pos('nobody'), null); assert.equal(ctx.labelOf('bear'), 'Burl');
const t0 = performance.now(); const r = liveLint(m, q, ctx); const ms = performance.now() - t0;
assert.ok(Array.isArray(r) && ms < 50, 'live lint < 50 ms: ' + ms);
for (const x of r) assert.ok(x.text && x.target && x.target.kind, 'every message has a Go-to target');
assert.deepEqual(liveLint(m, null, ctx), []);
// a giver that is an object is flagged with a giver target
const bad = { ...q, raw: { ...q.raw, giver: { ...q.raw.giver, npc: 'crate' } }, giver: 'crate' };
assert.ok(liveLint({ quests: [bad] }, bad, ctx).some((x) => x.target.kind === 'giver'));
// ED-QUEST-05-FIX: R5/R12 live from floorAt + structure tops + slope walkable. Fixture: flat ground z=0, a roof mesh (top z=2.6) over x 20..24.
const roofMesh = { pos: [0, 0, 0, 4, 0, 2.6, 4, 4, 2.6, 0, 4, 0] };
const rworld = { entities: [{ id: 'hutman', type: 'npc', x: 22, y: 22, z: 2.2, components: { dialogue: {} } }, { id: 'sky', type: 'npc', x: 40, y: 40, z: 3, components: { dialogue: {} } }, { id: 'okman', type: 'npc', x: 60, y: 60, z: 0, components: { dialogue: {} } }], structures: [{ id: 'hut', mesh: 'hutRoof', origin: { x: 20, y: 20, z: 0 } }] };
const rctx = buildLintCtx({ world: rworld, itemDefs: {}, names: makeNames({}), floorAt: () => 0, getMesh: (k) => (k === 'hutRoof' ? roofMesh : null) });
assert.equal(typeof rctx.walkable, 'function'); assert.equal(typeof rctx.support, 'function');
assert.ok(rctx.support('hutman').floorAbove > 0, 'roof top lies above the base'); assert.equal(rctx.support('okman').floorAbove, null);
const withGiver = (id) => ({ ...q, raw: { ...q.raw, giver: { ...q.raw.giver, npc: id, turnIn: id } }, giver: id });
const msgs = (id) => { const b = withGiver(id); return liveLint({ quests: [b] }, b, rctx); };
assert.ok(msgs('hutman').some((x) => x.rule === 'R12'), 'roof target: R12 in the panel list: ' + JSON.stringify(msgs('hutman').map((x) => x.rule)));
assert.ok(msgs('sky').some((x) => x.rule === 'R5' || x.rule === 'R12'), 'floating giver flagged');
assert.ok(!msgs('okman').some((x) => x.rule === 'R5' || x.rule === 'R12'), 'ground giver clean');
// presets + URL round trip through the game's parser
const opts = presetOptions(q); assert.equal(opts[0].value, 'notStarted'); assert.equal(opts.at(-1).value, 'readyToReturn');
for (const o of opts) {
  const url = playUrl('../../game/index.html', { x: 1.234, y: 5, z: 2 }, q.id, o.value);
  assert.ok(url.includes('at=1.23,5,2,0,0'));
  const raw = new URLSearchParams(url.slice(url.indexOf('?'))).get('qstate'); assert.equal(raw, q.id + ':' + o.value); // game parseQstateParam format (<questId>:<preset>)
}
console.log('wire.test ok');
