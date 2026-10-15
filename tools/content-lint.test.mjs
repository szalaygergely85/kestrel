// CONTENT-LINT-01: one fixture per rule (finding fires) + a clean control (zero findings). Pure rule functions, no world load.
// Run: node tools/content-lint.test.mjs
import assert from 'node:assert/strict';
import { lint, RULES, LEVELS, line, rawIn, meshTopAt, R17_LEGACY } from './content-lint.mjs';

import { LOGIC_VOCAB as LV } from '../game/js/logic/vocab.js';
const S = (id, mesh, x, y) => ({ id, mesh, origin: { x, y, z: 0 } });
const E = (id, x, y, z, components = {}) => ({ id, x, y, z, components });
const labelOf = (id) => ({ post: 'trade basket' }[id] || String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase());
const clean = () => ({
  floating: [{ id: 'p1', kind: 'prop', x: 1, y: 1, gap: 0.1 }],
  entities: [E('rook', 10, 10, 1, { dialogue: 'rook' }), E('camp1', 50, 50, 0, { emitters: [{ preset: 'smoke' }] }), E('campFire1', 51, 50, 0, { light: { preset: 'fire' } }), E('chestA', 60, 55, 0, {})],
  structures: [S('c1', 'quaternius/Prop_Chimney2', 100, 100), S('w1', 'quaternius/Wall_A', 101, 100), S('w2', 'quaternius/Floor_A', 102, 100), S('w3', 'quaternius/Roof_A', 100, 102), S('tree1', 'quaternius/CommonTree_1', 5, 5)],
  texts: [{ where: 'rook', text: 'Go to the old waystone.' }],
  jsTexts: [{ where: 'js', text: 'Waystone woken.' }],
  quests: [{ id: 'q1', giver: { npc: 'rook', turnIn: 'rook' }, reward: { items: [{ id: 'arrow', n: 5 }] }, early: true, accept: true, auto: false, objectGiver: false, targets: [{ id: 'rook', x: 1300, y: 1000 }] }],
  itemDefs: { arrow: { id: 'arrow', name: 'Arrow' } }, labelOf,
  giverIds: new Set(['rook']), pos: (id) => (id === 'rook' ? { x: 10, y: 10, z: 1 } : null), groundAt: () => 0, walkable: () => true,
  characters: new Set(['rook']), chests: [{ id: 'chestA', x: 60, y: 55 }], guards: [{ x: 60, y: 60, kind: 'camp' }],
  riverX: () => 1030, riverHalf: 10,
  entSupport: [{ id: 'chestA', x: 60, y: 55, base: 0.05, support: 0, floorAbove: null }, { id: 'tower.lantern', x: 1, y: 1, base: 4, support: 0, floorAbove: null }],
  logic: { vocab: LV, propStates: { gate: new Set(['open', 'closed']) }, refs: { area: new Set(['yard']), quest: new Set(['q1']), prop: new Set(['gate']), group: new Set(['gobs']) },
    blocks: [{ id: 'a.ambush', rev: 1, once: true, when: { on: 'area.enter', area: 'yard' }, if: [{ is: 'quest', quest: 'q1', state: 'active' }], do: [{ act: 'prop.state', prop: 'gate', state: 'closed' }, { act: 'beasts.spawn', group: 'gobs' }] }] },
  names: [{ where: 'arrow', kind: 'item', name: 'Arrow' }, { where: 'r1', kind: 'region', name: "Ferrum's Wall (off-limits)" }, { where: 'q1', kind: 'quest', name: 'The Old Waystone' }],
  anchors: [{ id: 'sign1', x: 2, y: 2, hasModel: true, nearVisual: false }, { id: 'knot', x: 3, y: 3, hasModel: false, nearVisual: true }],
});
const run = (c) => lint(c);
assert.deepEqual(run(clean()), [], 'clean control: no findings');
// OB-172/D-104: an fx:true billboard (fire) passes R2, a non-fx sprite is still flagged
{ const c = clean(); c.fxModels = new Set(['burnerFire']); c.entities.push(E('fire', 1, 1, 0, { sprite: { model: 'burnerFire' } }), E('berry', 2, 2, 0, { sprite: { model: 'berrySprig' } }));
  const f = run(c).filter((x) => x.rule === 'R2' || x.id); assert.equal(f.filter((x) => String(x.id || x.where).includes('berry')).length >= 1, true, 'non-fx sprite flagged');
  assert.equal(f.some((x) => String(x.id || x.where) === 'fire'), false, 'fx sprite allowed'); }

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
  R12: (c) => { c.entSupport.push({ id: 'pineChest', x: 1, y: 1, base: 0.8, support: 0, floorAbove: null }); },
  R13: (c) => { c.anchors.push({ id: 'notePost', x: 4, y: 4, hasModel: false, nearVisual: false }); },
  R14: (c) => { c.quests[0].accept = false; },
  R15: (c) => { c.logic.blocks[0].when.area = 'nowhere'; }, // missing ref
  R16: (c) => { c.names.push({ where: 'i1', kind: 'item', name: 'Gear_Boots' }); },
  R11: (c) => { c.structures.push(S('m1', 'quaternius/Mushroom_Laetiporus', 7, 7)); },
};
for (const [rule, mutate] of Object.entries(cases)) {
  const c = clean(); mutate(c);
  const found = run(c);
  assert.ok(found.length >= 1 && found.every((f) => f.rule === rule || (rule === 'R10' && f.rule === 'R14')), `${rule}: expected only ${rule} findings, got ` + found.map(line).join(' | '));
  assert.equal(found[0].level, LEVELS[rule]);
}
// also: Prop_Support fires R11 (but strandStake* is exempt), unwalkable giver fires R5, raw giver/reward fire R3, relay in quest text fires R4
{ const c = clean(); c.structures.push(S('sup1', 'quaternius/Prop_Support', 1, 1), S('strandSup', 'quaternius/Prop_Support', 2, 2)); assert.equal(RULES.R11(c).length, 1); }
{ const c = clean(); c.walkable = () => false; assert.equal(RULES.R5(c).length, 1); }
{ const c = clean(); c.quests[0].giver = { npc: 'relayBend' }; c.quests[0].reward.items.push({ id: 'gear.feet.boots.sturdy', n: 1 }); assert.equal(RULES.R3(c).length, 2); }
{ const c = clean(); c.texts.push({ where: 'q', text: 'Light the relay at dusk' }); assert.equal(RULES.R4(c).length, 1); }
{ const c = clean(); c.quests[0].early = false; c.quests[0].targets.push({ id: 'x', x: 900, y: 1000 }); assert.equal(RULES.R9(c).length, 0, 'late quests may cross the river'); }
{ const c = clean(); c.entSupport.push({ id: 'b1', x: 1, y: 1, base: 0, support: 0, floorAbove: 0.4 }); assert.equal(RULES.R12(c).length, 1, 'buried'); }
// R12 level floor: support = the level floor under the entity (tower interior): on floor = ok, floating above it = error
{ const c = clean(); c.entSupport.push({ id: 'tower.crate', x: 1, y: 1, base: 5.7, support: 5.7, floorAbove: null }); assert.equal(RULES.R12(c).length, 0, 'on the level floor'); }
{ const c = clean(); c.entSupport.push({ id: 'tower.crate', x: 1, y: 1, base: 6.4, support: 5.7, floorAbove: null }); assert.equal(RULES.R12(c).length, 1, 'floating above the level floor'); }
// meshTopAt: exact stair top (two steps: z 0.2 for x<1, z 0.4 for 1<=x<2), not the AABB top 0.4
{
  const q = (x0, x1, z) => [x0, 0, z, x1, 0, z, x1, 2, z, x0, 0, z, x1, 2, z, x0, 2, z];
  const stair = { pos: new Float32Array([...q(0, 1, 0.2), ...q(1, 2, 0.4)]), idx: null }, st = { origin: { x: 10, y: 20, z: 0 } };
  assert.ok(Math.abs(meshTopAt(stair, st, 10.5, 21, 9) - 0.2) < 1e-6, 'lower step top');
  assert.ok(Math.abs(meshTopAt(stair, st, 11.5, 21, 9) - 0.4) < 1e-6, 'upper step top');
  assert.equal(meshTopAt(stair, st, 15, 21, 9), null, 'outside the mesh');
}
{ const c = clean(); c.quests[0].giver = { npc: 'post' }; c.pos = () => ({ x: 1, y: 1, z: 0 }); assert.ok(RULES.R14(c).some((f) => /not a character/.test(f.msg))); c.quests[0].objectGiver = true; assert.equal(RULES.R14(c).length, 2, 'giver allowed; return is an object + share > 10 %'); assert.ok(RULES.R14(c).some((f) => f.id === '*' || /return/.test(f.msg))); }
{ const c = clean(); c.quests[0].giver = { npc: 'ghost' }; assert.ok(RULES.R14(c).some((f) => /does not resolve|not a character/.test(f.msg))); }
{ const c = clean(); c.quests[0].auto = true; assert.ok(RULES.R14(c).some((f) => /auto hand-in/.test(f.msg))); c.quests[0].auto = false; c.quests[0].giver = {}; assert.ok(RULES.R14(c).some((f) => /no giver/.test(f.msg))); }
{ const c = clean(); c.texts.push({ where: 'legacy.m1 lines[0]', text: 'Wake the Relay stone.' }); assert.equal(RULES.R4(c).length, 1, 'PLAYER-TEXT-RELAY-01: legacy quest text is scanned'); }
assert.equal(rawIn('Reward: gear.feet.boots.sturdy'), 'gear.feet.boots.sturdy'); assert.equal(rawIn('The well. Cold water.'), null); assert.equal(rawIn('signArm'), null);
// R15: the other hand-broken fixtures (each fires exactly R15)
for (const mut of [
  (L) => { L.blocks[0].do[1].group = 'ghosts'; },                                  // group ref missing
  (L) => { L.blocks[0].do[0].state = 'ajar'; },                                    // prop has no such state
  (L) => { L.blocks[0].once = false; L.blocks.push({ id: 'b.again', rev: 1, once: false, when: { on: 'area.enter', area: 'yard' }, do: [{ act: 'beasts.spawn', group: 'gobs' }] }); }, // two spawners, no once
  (L) => { L.blocks = [{ id: 'l1', rev: 1, when: { on: 'flag.set', flag: 'f1' }, do: [{ act: 'flag.set', flag: 'f2', value: true }] }, { id: 'l2', rev: 1, when: { on: 'flag.set', flag: 'f2' }, do: [{ act: 'flag.set', flag: 'f1', value: true }] }]; }, // loop
]) { const c = clean(); mut(c.logic); const found = run(c); assert.ok(found.length >= 1 && found.every((f) => f.rule === 'R15'), 'R15 fixture: ' + found.map(line).join(' | ')); }
{ const c = clean(); c.logic.blocks = [{ id: 'l1', rev: 1, once: true, when: { on: 'flag.set', flag: 'f1' }, do: [{ act: 'flag.set', flag: 'f1', value: true }] }]; assert.deepEqual(run(c), [], 'self-loop with once is allowed'); }
// R16: four more hand-broken names, each fires exactly R16 (warn); good names stay clean
for (const [kind, name] of [['quest', 'sq.burl.blue'], ['npc', 'wardenOrla'], ['item', 'Placeholder sword'], ['item', 'Iron Ring T4']]) { const c = clean(); c.names.push({ where: 'x', kind, name }); const f = run(c); assert.ok(f.length === 1 && f[0].rule === 'R16' && f[0].level === 'warn', 'R16 ' + name + ': ' + f.map(line).join(' | ')); }
assert.equal(RULES.R16({ names: [{ where: 'a', kind: 'item', name: 'Health Potion' }, { where: 'b', kind: 'npc', name: 'Burl' }, { where: 'c', kind: 'item', name: 'Tier T4 mark' }] }).length, 1, 'T4 only as a bare tag');
assert.ok(Object.values(LEVELS).filter((l) => l === 'warn').length === 4, 'R8 R9 R10 R16 are warn level (R12 R13 R14 R15 errors)');
console.log('content-lint.test: ok (' + Object.keys(cases).length + ' rules + clean control)');
// R17 (QUEST-FORMAT, D-106): a quest fails without begin/end/rewards, with > 3 objectives, unknown next/requires, or xp; legacy allow-list only WARNs
{
  const ok = { id: 'q.ok', begin: { npc: 'rook' }, end: { npc: 'rook' }, requires: { quests: [] }, objectives: [{}], rewards: { coin: 5 }, next: 'q.two' }, two = { ...ok, id: 'q.two', next: null, requires: { quests: ['q.ok'] } };
  const run17 = (...defs) => RULES.R17({ formatQuests: defs });
  assert.equal(run17(ok, two).length, 0);
  for (const [bad, re] of [[{ begin: undefined }, /no begin/], [{ end: undefined }, /no end/], [{ rewards: {} }, /empty rewards/], [{ objectives: [{}, {}, {}, {}] }, /4 objectives/], [{ next: 'q.nope' }, /next "q.nope"/], [{ requires: { quests: ['q.nope'] } }, /requires unknown/], [{ xp: 10 }, /xp/]]) {
    const f = run17({ ...ok, id: 'q.bad', ...bad }, two); assert.ok(f.some((x) => re.test(x.msg) && x.id === 'q.bad' && x.level === 'error'), 'R17 ' + JSON.stringify(bad) + ': ' + f.map((x) => x.msg));
  }
  const legacyId = [...R17_LEGACY][0], f = run17({ ...ok, id: legacyId, rewards: {} }, two).filter((x) => x.id === legacyId); assert.ok(f.length === 1 && f[0].level === 'warn', 'legacy allow-list warns'); assert.ok(R17_LEGACY.has('m1'));
  assert.equal(LEVELS.R17, 'error');
}
console.log('content-lint.test R17: ok');
// R19 (QUEST-TEXT-LINT-01): one hand-broken text per sub-check fires exactly R19; allow-list is shrink-only
{
  const R19_ALLOW_MAX = 4; // may only go DOWN: lower this number when the writer clears an entry
  const fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url');
  const allow = JSON.parse(fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'content-lint-r19-allow.json'), 'utf8')).allow;
  assert.ok(allow.length <= R19_ALLOW_MAX, 'R19 allow-list grew: ' + allow.length + ' > ' + R19_ALLOW_MAX);
  const long = 'x'.repeat(30) + ' ' + 'y'.repeat(30);
  for (const [text, isLine, check] of [['NEEDS WRITER: fill in', false, 'placeholder'], ['Talk to sq.burl.blue now', false, 'rawid'], ['Take the old_key home', false, 'rawid'], ['Open the gateKey door', false, 'rawid'], [long, true, 'long'], ['x'.repeat(19) + ' ' + 'y'.repeat(19), 'objective', 'objective'], ['Press Esc to close', false, 'esc']]) {
    const c = clean(); c.questTexts = [{ where: 'fx', text, line: isLine === true, objective: isLine === 'objective' }];
    const f = run(c); assert.ok(f.length === 1 && f[0].rule === 'R19' && f[0].msg.startsWith(check), 'R19 ' + check + ': ' + f.map(line_ => line(line_)).join('|'));
  }
  { const c = clean(); c.questTexts = [{ where: 'ok', text: 'Take the key to Burl. He waits by the well.', line: true }]; assert.deepEqual(run(c), [], 'R19 clean text'); }
  { const c = clean(); c.questTexts = [{ where: 'w', text: 'NEEDS WRITER' }]; c.r19Allow = new Set(['w|placeholder']); assert.deepEqual(run(c), [], 'allow-listed'); }
  { const c = clean(); c.questTexts = []; c.r19Allow = new Set(['gone|placeholder']); const f = run(c); assert.ok(f.length === 1 && /stale/.test(f[0].msg), 'stale allow entry is an error'); }
  assert.equal(LEVELS.R19, 'error');
}
console.log('content-lint.test R19: ok');
