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
// presets + URL round trip through the game's parser
const opts = presetOptions(q); assert.equal(opts[0].value, 'notStarted'); assert.equal(opts.at(-1).value, 'readyToReturn');
for (const o of opts) {
  const url = playUrl('../../game/index.html', { x: 1.234, y: 5, z: 2 }, q.id, o.value);
  assert.ok(url.includes('at=1.23,5,2,0,0'));
  const raw = new URLSearchParams(url.slice(url.indexOf('?'))).get('qstate'); assert.equal(raw, q.id + ':' + o.value); // game parseQstateParam format (<questId>:<preset>)
}
console.log('wire.test ok');
