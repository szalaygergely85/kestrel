import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuests } from './model.js';
import { lintQuest } from './lintQuest.js';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content/quests');
const m = loadQuests(dir);
const names = { bear: 'Burl', crate: 'Crate', roofman: 'Roof Guy' };
const P = { bear: { x: 0, y: 0, z: 0 }, crate: { x: 5, y: 0, z: 0 }, roofman: { x: 9, y: 0, z: 6 } };
const ctx = {
  characters: new Set(['bear', 'roofman']), pos: (id) => P[id] || null, groundAt: () => 0, walkable: () => true,
  labelOf: (id) => names[id] || id, itemDefs: { 'gear.cloak.cloak.worn': { name: 'Worn Cloak' } },
  hasFlag: (f) => f === 'burl.home', flowOf: () => ({ accept: true, exit: true }),
};
const rules = (a) => [...new Set(a.map((x) => x.rule))].sort().join(',');
const base = m.quests.find((q) => q.id === 'sq.burl.blue');
assert.deepEqual(lintQuest(m, 'sq.burl.blue', ctx), [], 'unmodified quest: 0 messages');

// hand-broken copies: a model clone whose sq.burl.blue raw is mutated
const broken = (mut, c = ctx) => {
  const q = structuredClone(base.raw); mut(q);
  const nq = { ...base, raw: q, giver: q.giver?.npc || null, title: q.title, returnText: q.returnText, objectives: q.objectives, reward: q.reward, requires: q.requires, lines: q.lines ?? null };
  return lintQuest({ quests: m.quests.filter((x) => x !== base).concat(nq) }, 'sq.burl.blue', c);
};
let r = broken((q) => { q.giver = { npc: 'crate' }; q.objectives[1].when.to = 'crate'; });
assert.equal(rules(r), 'R10'); assert.equal(r[0].target.kind, 'giver'); assert.ok(r[0].text.includes('Crate') && !r[0].text.includes('crate'));
r = broken(() => {}, { ...ctx, flowOf: () => ({ accept: true, exit: false }) });
assert.equal(rules(r), 'R14'); assert.equal(r[0].target.id, 'bear');
r = broken((q) => { q.giver = { npc: 'bear', turnIn: 'roofman' }; q.objectives[1].when.to = 'roofman'; });
assert.equal(rules(r), 'R5'); assert.equal(r[0].target.kind, 'return'); assert.ok(r[0].text.includes('Roof Guy'));
r = broken((q) => { q.objectives[0].text = 'Pick six sq.burl.blue sprigs'; });
assert.equal(rules(r), 'R3'); assert.deepEqual(r[0].target, { kind: 'objective', id: 'sprigs' });
// requires + reward + empty title + placeholder
r = broken((q) => { q.requires = [{ quest: 'nope.q' }, { flag: 'ghost' }]; q.reward = { items: [{ id: 'x.y', n: 1 }] }; q.title = ''; q.returnText = 'Bring {n} to Burl'; });
assert.equal(rules(r), 'R15,R16,R3'); assert.equal(r.filter((x) => x.rule === 'R15').length, 2);
// every real quest: no throw, messages well-formed
for (const q of m.quests) for (const x of lintQuest(m, q.id, ctx)) assert.ok(x.rule && x.text && x.target && ['error', 'warn'].includes(x.severity));
// bench
const t0 = performance.now(); for (let i = 0; i < 200; i++) lintQuest(m, 'sq.burl.blue', ctx);
const per = (performance.now() - t0) / 200; assert.ok(per < 50, 'lintQuest ' + per.toFixed(3) + ' ms');
console.log('lintQuest.test OK (' + per.toFixed(3) + ' ms/quest)');
