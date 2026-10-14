import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLogic, setArg, addBlock } from './model.js';
import { entries, entryOf, argLabel, parseType, defaultItem, itemText, refFromPick, buildRefs, lintLogic, KEY } from './view.js';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../../content/logic');
const schema = JSON.parse(readFileSync(join(dir, 'vocab.schema.json'), 'utf8'));
for (const sec of ['when', 'if', 'do']) for (const e of entries(schema, sec)) assert.ok(schema[{ when: 'events', if: 'conds', do: 'acts' }[sec]][e.name].label, 'label for ' + e.name);
assert.deepEqual(parseType('ref:area?'), { kind: 'ref', ref: 'area', optional: true });
assert.deepEqual(parseType('a|b').options, ['a', 'b']);
assert.equal(argLabel(schema, 'atLeast'), 'At least');
assert.deepEqual(defaultItem(schema, 'if', 'quest'), { is: 'quest', quest: '', state: 'available' });
assert.deepEqual(defaultItem(schema, 'when', 'beast.died'), { on: 'beast.died' });
assert.equal(KEY.do, 'act');
const names = { area: (v) => 'Rook yard' };
assert.equal(itemText(schema, 'when', { on: 'area.enter', area: 'rook.yard' }, names), 'Player enters an area: Area Rook yard');
assert.match(itemText(schema, 'do', { act: 'hint', text: 'h', after: 30 }), /Show hint.*after 30 steps/);
const world = { entities: [{ id: 'gate', x: 1, y: 1 }, { id: 'g1', x: 2, y: 2, group: 'rook.goblins' }, { id: 'p', x: 3, y: 3 }] };
assert.deepEqual(refFromPick('prop', { entityId: 'gate' }, world), { value: 'gate' });
assert.deepEqual(refFromPick('group', { entityId: 'g1' }, world), { value: 'rook.goblins' });
assert.ok(refFromPick('group', { entityId: 'gate' }, world).error);
assert.deepEqual(refFromPick('area', { point: { x: 10, y: 10 } }, world, { yard: { x: 11, y: 10, r: 3 } }), { value: 'yard' });
assert.ok(refFromPick('area', { point: { x: 50, y: 50 } }, world, { yard: { x: 11, y: 10 } }).error);
assert.ok(refFromPick('quest', {}, world).error);

const m = loadLogic(dir), f = m.files.get('example.logic.json');
assert.deepEqual(lintLogic(m, schema), []);
const refs = buildRefs({ world, areas: { yard: {} }, quests: ['q1'], itemDefs: {} });
const bad = lintLogic(m, schema, refs).filter((x) => x.target.file === 'example.logic.json'); // 01d: farm.logic.json is real content, not part of this fixture   // example ids do not exist -> R15 errors with a target
assert.ok(bad.length >= 3 && bad.every((x) => x.rule === 'R15' && x.target.id === 'example.ambush'), JSON.stringify(bad));
assert.ok(bad.some((x) => x.target.sec === 'do' && x.target.idx >= 0));
// spawn twice without once + flag loop
addBlock(f, { id: 'dup', name: 'd', when: { on: 'flag.set', flag: 'x' }, if: [], do: [{ act: 'flag.set', flag: 'x', value: true }, { act: 'beasts.spawn', group: 'example.goblins' }] }).apply();
const l2 = lintLogic(m, schema);
assert.ok(l2.some((x) => /spawned by 2 blocks/.test(x.text)) && l2.some((x) => /loop/.test(x.text)), JSON.stringify(l2));
console.log('logic view ok');
