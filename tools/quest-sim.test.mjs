// QL-T2: quest-sim on the real content (all OK) plus broken fixtures (each must FAIL with a reason).
import { fileURLToPath } from 'node:url';
import { makeOk } from '../engine/test/assert.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from './validate-content.mjs';
import { simulateQuests, worldFacts } from './quest-sim.mjs';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const world = worldFacts(assets);
for (const a of Object.keys(files.areas?.areas || {})) world.areas.add(a);
const defs = [...files.quests, ...packs.quests].map(q => q.def);
const real = simulateQuests(defs, world);
ok('real content loads without errors', files.errors.length + packs.errors.length === 0, JSON.stringify([...files.errors, ...packs.errors]));
ok('real content: every quest OK', real.rows.every(r => r.ok), JSON.stringify(real.rows.filter(r => !r.ok)));
ok('real content: all defs have a row', real.rows.length === defs.length, real.rows.length + ' vs ' + defs.length);

// fixtures on a tiny fake world
const W = () => ({ actors: new Set(['npc']), beasts: new Set(['b1', 'b2']), areas: new Set(['a1']), pickups: new Map([['berry', 3]]) });
const mk = (id, objectives, extra = {}) => ({ version: 1, id, title: id, giver: { npc: 'npc' }, objectives, ...extra });
const main = { version: 1, id: 'm1', title: 'main', objectives: [{ id: 'x', text: 'x', when: { type: 'flag', id: 'go', equals: true } }] };
const run = (...qs) => simulateQuests([main, ...qs], W());
const o = (id, when) => ({ id, text: id, when });
{
  const r = run(
    mk('q.a', [o('k', { type: 'beasts', ids: ['b1', 'b2'], count: 2 }), o('r', { type: 'area', id: 'a1' })], { reward: { items: [{ id: 'coin', n: 2 }] } }),
    mk('q.b', [o('c', { type: 'collect', id: 'berry', count: 3 })], { requires: [{ quest: 'q.a', done: true }] }),
    mk('q.c', [o('d', { type: 'deliver', id: 'letter', count: 1, to: 'npc' })], { giveOnAccept: [{ id: 'letter', n: 1 }] }));
  ok('fixture: good quests all OK', r.rows.every(x => x.ok), JSON.stringify(r.rows));
  ok('fixture: reward is granted and totalled', r.totals.rewards.coin === 2);
}
const failsWith = (name, q, text) => { const r = run(...q).rows.find(x => x.id === q[q.length - 1].id); ok(name, r && !r.ok && r.reason.includes(text), JSON.stringify(r)); };
failsWith('missing beast FAILs', [mk('q.z', [o('k', { type: 'beasts', ids: ['ghost'], count: 1 })])], 'ghost');
failsWith('missing area FAILs', [mk('q.z', [o('r', { type: 'area', id: 'nowhere' })])], 'nowhere');
failsWith('too few pickups FAILs', [mk('q.z', [o('c', { type: 'collect', id: 'berry', count: 9 })])], 'placed');
failsWith('never-opened (cyclic) quest FAILs', [mk('q.y', [o('r', { type: 'area', id: 'a1' })], { requires: [{ quest: 'q.z', done: true }] }), mk('q.z', [o('r', { type: 'area', id: 'a1' })], { requires: [{ quest: 'q.y', done: true }] })], 'never opened');
ok('unknown required quest FAILs the book build', run(mk('q.z', [o('r', { type: 'area', id: 'a1' })], { requires: [{ quest: 'q.none', done: true }] })).rows[0].reason.includes('q.none'));
ok('main quest stall is reported', (() => { const m = { ...main, objectives: [o('x', { type: 'area', id: 'nowhere' })] }; const r = simulateQuests([m], W()); return !r.rows[0].ok && r.rows[0].reason.includes('stalled'); })());

console.log(`quest-sim.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error(f); process.exit(1); }
