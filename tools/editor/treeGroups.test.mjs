// OB-028 / OB-029 pure-model tests: scene-tree grouping, user groups, fold state, doc round trip, asset reference scan.
import {
  categoryOf, subKeyOf, itemKey, buildTreeGroups, parseFold, serializeFold, toggleFold,
  addUserGroup, removeFromUserGroups, pruneUserGroups, writeUserGroups, readUserGroups, validateEditorGroups, revealKeys,
} from './treeGroups.js';
import { scanAssetRefs, findUnusedAssets, planAssetDelete, serializePendingDeletes } from './assetRefs.js';
import { stringifyContent } from '../../engine/index.js';
import { makeOk } from '../../engine/test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const row = (fileId, collection, id, item = {}) => ({ fileId, collection, id, item });
const items = [
  row('world/w', 'entities', 'npc1', { model: 'rook' }),
  row('world/w', 'structures', 'tree1', { mesh: 'quaternius/DeadTree_1' }),
  row('world/w', 'structures', 'tree2', { mesh: 'quaternius/DeadTree_2' }),
  row('world/w', 'structures', 'poi001p', { mesh: 'poi001_barrel' }),
  row('world/w', 'structures', 'riverW1', { mesh: 'river_water_1' }),
  row('level/tower', 'lights', 'torch', {}),
  row('level/tower', 'triggers', 'door', {}),
  row('level/tower', 'props', 'chest', { model: 'chest' }),
  row('world/w', 'levels', 'tower', {}),
];
ok('category: npc -> Entities', categoryOf(items[0]) === 'Entities');
ok('category: river mesh -> Water', categoryOf(items[4]) === 'Water');
ok('category: lights/triggers/levels', categoryOf(items[5]) === 'Lights' && categoryOf(items[6]) === 'Triggers' && categoryOf(items[8]) === 'Levels');
ok('subKey: trees share a prefix, poi -> poi###', subKeyOf(items[1]) === 'quaternius/DeadTree' && subKeyOf(items[2]) === 'quaternius/DeadTree' && subKeyOf(items[3]) === 'poi###');

let g = buildTreeGroups(items);
const byTitle = Object.fromEntries(g.map((x) => [x.title, x]));
ok('groups: counts in header model', byTitle.Entities.count === 2 && byTitle.Structures.count === 3 && byTitle.Lights.count === 1 && byTitle.Water.count === 1 && byTitle.Levels.count === 1, JSON.stringify(g.map((x) => [x.title, x.count])));
ok('groups: structures split into 2 subs, all open by default', byTitle.Structures.subs.length === 2 && byTitle.Structures.open);

const closed = toggleFold(new Set(), 'cat:Lights');
g = buildTreeGroups(items, { closed });
ok('fold: closed group reports open=false', g.find((x) => x.title === 'Lights').open === false);
ok('fold: round trip', [...parseFold(serializeFold(closed))].join() === 'cat:Lights' && parseFold('garbage').size === 0);
g = buildTreeGroups(items, { closed, query: 'tor' });
ok('search inside groups: matches only, closed group opens', g.length === 1 && g[0].title === 'Lights' && g[0].open && g[0].count === 1);
g = buildTreeGroups(items, { closed, forceOpen: revealKeys(items, items[5]) });
ok('reveal: selecting a row opens its group', g.find((x) => x.title === 'Lights').open);
ok('reveal keys include the sub-group for structures', revealKeys(items, items[3]).has('cat:Structures/poi###'));
g = buildTreeGroups(items, { filter: 'lights' });
ok('chip filter still works', g.length === 1 && g[0].title === 'Lights');

let ug = addUserGroup([], 'Camp', [itemKey(items[0]), itemKey(items[7])]);
g = buildTreeGroups(items, { userGroups: ug });
ok('user group listed first with its members, removed from category', g[0].title === 'Camp' && g[0].user && g[0].count === 2 && g.find((x) => x.title === 'Entities') === undefined);
ug = addUserGroup(ug, 'Other', [itemKey(items[0])]);
ok('a key lives in one group only', ug.length === 2 && ug.find((x) => x.name === 'Camp').ids.length === 1);
ug = removeFromUserGroups(ug, [itemKey(items[0])]);
ok('ungroup drops empty groups', ug.length === 1 && ug[0].name === 'Camp');
ok('prune removes deleted ids', pruneUserGroups(ug, [itemKey(items[0])]).length === 0);
ok('validate: good / bad', validateEditorGroups(ug).length === 0 && validateEditorGroups([{ name: '', ids: [1] }]).length === 2 && validateEditorGroups({}).length === 1 && validateEditorGroups(undefined).length === 0);

const world = { kind: 'world', schema: 1, id: 'w', nextId: 1, name: 'w', version: 1, structures: [], entities: [] };
const before = stringifyContent(world);
writeUserGroups(world, []);
ok('no groups: world file byte-stable', stringifyContent(world) === before && !('editorGroups' in world));
writeUserGroups(world, ug);
const withGroups = stringifyContent(world);
ok('groups round trip through canonical JSON', JSON.stringify(readUserGroups(JSON.parse(withGroups))) === JSON.stringify(ug) && withGroups !== before);
writeUserGroups(world, []);
ok('ungroup everything restores the original bytes', stringifyContent(world) === before);

const sources = {
  'world/w': { structures: [{ id: 'a', mesh: 'ruins/Wall' }], entities: [{ id: 'b', components: { mesh: { id: 'ruins/Arch' } } }, { id: 'ruins/Wall2', model: 'chest' }] },
  'level/t': { props: [{ id: 'p', model: 'lever' }] },
  'package/p': { entries: [{ prefab: 'ruins/Gate' }] },
};
ok('scan: finds mesh field, component id, model, package prefab', scanAssetRefs('ruins/Wall', sources).length === 1 && scanAssetRefs('ruins/Arch', sources).length === 1 && scanAssetRefs('lever', sources).length === 1 && scanAssetRefs('ruins/Gate', sources).length === 1);
ok('scan: an item id is not a reference', scanAssetRefs('ruins/Wall2', sources).length === 0);
ok('unused filter', findUnusedAssets(['ruins/Wall', 'ruins/Spare', 'ruins/Gate'], sources).join() === 'ruins/Spare');
let plan = planAssetDelete('mesh', 'ruins/Wall', sources);
ok('plan: referenced -> refused with users', !plan.ok && plan.refs[0].path === 'structures[0].mesh');
plan = planAssetDelete('mesh', 'ruins/Spare', sources);
ok('plan: unused -> files + manifest entry', plan.ok && plan.manifest === 'meshes/ruins/Spare.mesh.json' && plan.files.length === 2);
ok('plan: quaternius/synty protected', !planAssetDelete('mesh', 'quaternius/Rock', {}).ok && !planAssetDelete('mesh', 'synty/X', {}).ok);
ok('plan: models are code-defined', !planAssetDelete('model', 'lever', {}).ok);
const pd = serializePendingDeletes([plan, plan]);
ok('pending-deletes: deduped, stable', JSON.parse(pd).deleteFiles.length === 2 && pd.endsWith('\n'));

console.log(`treeGroups.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error(`  FAIL: ${f}`); process.exit(1); }
