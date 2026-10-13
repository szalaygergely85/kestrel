// CONTENT-LINT-01: one fixture per rule (finding fires) + a clean control (zero findings). Pure rule functions, no world load.
// Run: node tools/content-lint.test.mjs
import assert from 'node:assert/strict';
import { lint, RULES, LEVELS, line, rawIn } from './content-lint.mjs';

const S = (id, mesh, x, y) => ({ id, mesh, origin: { x, y, z: 0 } });
const E = (id, x, y, z, components = {}) => ({ id, x, y, z, components });
const labelOf = (id) => ({ post: 'trade basket' }[id] || String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase());
const clean = () => ({
  floating: [{ id: 'p1', kind: 'prop', x: 1, y: 1, gap: 0.1 }],
  entities: [E('rook', 10, 10, 1, { dialogue: 'rook' }), E('camp1', 50, 50, 0, { emitters: [{ preset: 'smoke' }] }), E('campFire1', 51, 50, 0, { light: { preset: 'fire' } }), E('chestA', 60, 55, 0, {})],
  structures: [S('c1', 'quaternius/Prop_Chimney2', 100, 100), S('w1', 'quaternius/Wall_A', 101, 100), S('w2', 'quaternius/Floor_A', 102, 100), S('w3', 'quaternius/Roof_A', 100, 102), S('tree1', 'quaternius/CommonTree_1', 5, 5)],
  texts: [{ where: 'rook', text: 'Go to the old waystone.' }],
  jsTexts: [{ where: 'js', text: 'Waystone woken.' }],
  quests: [{ id: 'q1', giver: { npc: 'rook', turnIn: 'rook' }, reward: { items: [{ id: 'arrow', n: 5 }] }, early: true, targets: [{ id: 'rook', x: 1300, y: 1000 }] }],
  itemDefs: { arrow: { id: 'arrow', name: 'Arrow' } }, labelOf,
  giverIds: new Set(['rook']), pos: (id) => (id === 'rook' ? { x: 10, y: 10, z: 1 } : null), groundAt: () => 0, walkable: () => true,
  characters: new Set(['rook']), chests: [{ id: 'chestA', x: 60, y: 55 }], guards: [{ x: 60, y: 60, kind: 'camp' }],
  riverX: () => 1030, riverHalf: 10,
});
const run = (c) => lint(c);
assert.deepEqual(run(clean()), [], 'clean control: no findings');

// each fixture breaks exactly one thing and must produce a finding of that rule only
const cases = {
  R1: (c) => { c.floating.push({ id: 'treeX', kind: 'tree', x: 3, y: 3, gap: 0.6 }); },
  R2: (c) => { c.entities.push(E('berry', 1, 1, 0, { sprite: { model: 'berrySprig' } })); },
  R3: (c) => { c.texts.push({ where: 'journal', text: 'Pick up signArm now' }); },
  R4: (c) => { c.jsTexts.push({ where: 'js', text: 'Wake the Relay.' }); },
  R5: (c) => { c.pos = () => ({ x: 10, y: 10, z: 9 }); },
  R6: (c) => { c.entities.push(E('smokeLone', 300, 300, 0, { emitters: [{ preset: 'farSmoke' }] })); },
  R7: (c) => { c.structures.push(S('c2', 'quaternius/Prop_Chimney2', 500, 500)); },
  R8: (c) => { c.guards = []; },
  R9: (c) => { c.quests[0].targets.push({ id: 'fordWest', x: 1010, y: 1072 }); },
  R10: (c) => { c.quests[0].giver = { npc: 'post' }; },
  R11: (c) => { c.structures.push(S('m1', 'quaternius/Mushroom_Laetiporus', 7, 7)); },
};
for (const [rule, mutate] of Object.entries(cases)) {
  const c = clean(); mutate(c);
  const found = run(c);
  assert.ok(found.length >= 1 && found.every((f) => f.rule === rule), `${rule}: expected only ${rule} findings, got ` + found.map(line).join(' | '));
  assert.equal(found[0].level, LEVELS[rule]);
}
// also: Prop_Support fires R11 (but strandStake* is exempt), unwalkable giver fires R5, raw giver/reward fire R3, relay in quest text fires R4
{ const c = clean(); c.structures.push(S('sup1', 'quaternius/Prop_Support', 1, 1), S('strandSup', 'quaternius/Prop_Support', 2, 2)); assert.equal(RULES.R11(c).length, 1); }
{ const c = clean(); c.walkable = () => false; assert.equal(RULES.R5(c).length, 1); }
{ const c = clean(); c.quests[0].giver = { npc: 'relayBend' }; c.quests[0].reward.items.push({ id: 'gear.feet.boots.sturdy', n: 1 }); assert.equal(RULES.R3(c).length, 2); }
{ const c = clean(); c.texts.push({ where: 'q', text: 'Light the relay at dusk' }); assert.equal(RULES.R4(c).length, 1); }
{ const c = clean(); c.quests[0].early = false; c.quests[0].targets.push({ id: 'x', x: 900, y: 1000 }); assert.equal(RULES.R9(c).length, 0, 'late quests may cross the river'); }
assert.equal(rawIn('Reward: gear.feet.boots.sturdy'), 'gear.feet.boots.sturdy'); assert.equal(rawIn('The well. Cold water.'), null); assert.equal(rawIn('signArm'), null);
assert.ok(Object.values(LEVELS).filter((l) => l === 'warn').length === 3, 'R8 R9 R10 are warn level');
console.log('content-lint.test: ok (' + Object.keys(cases).length + ' rules + clean control)');
