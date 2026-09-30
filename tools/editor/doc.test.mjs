import { makeOk } from '../../engine/test/assert.js';
// tools/editor/doc.test.mjs - US-031 (docs/architecture.md 24.13 S1).
// Plain Node ESM, no test framework, no build step - matches
// engine/core/playerLook.test.js / engine/core/loop.test.js. Run with:
//
//   node tools/editor/doc.test.mjs

import {
  createDoc, fileKey, mintId, frameFor, itemToWorld, worldToItem, computeNextId,
  selectionFromEntityId, selectionEntityId, selectionItemData, selectionItemIndex, listOutlinerItems,
} from './doc.js';

let pass = 0;
let fail = 0;
const failures = [];

const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// A minimal fake AssetRegistry: only `keys('level'|'world')`/`level(id)`/
// `world(id)` are used by `createDoc` - this test exercises doc.js's own
// logic, not the real AssetRegistry (that's engine/core/assets.test.js).
function fakeAssets({ levels = {}, worlds = {} }) {
  return {
    keys: (kind) => Object.keys(kind === 'level' ? levels : worlds),
    level: (id) => levels[id],
    world: (id) => worlds[id],
  };
}

// ---- fileKey mapping (24.7) -------------------------------------------------
{
  ok("fileKey('level','tower') -> 'level/tower'", fileKey('level', 'tower') === 'level/tower');
  ok("fileKey('world','world_m1') -> 'world/world_m1'", fileKey('world', 'world_m1') === 'world/world_m1');
}

// ---- computeNextId / envelope from a fromGlobals (no-bundle) def (21.9) ----
{
  // No `props`/`lights`/etc ids end in `_N` -> nextId is 1 (21.9's rule),
  // matching this story's AC note "nextId 1 for the tower today".
  const towerLikeDef = {
    props: [{ id: 'brazier' }, { id: 'lantern' }],
    lights: [{ id: 'brazier' }],
    interactables: [{ id: 'lever' }],
    triggers: [],
  };
  ok('computeNextId: no minted ids -> nextId 1', computeNextId('level', towerLikeDef) === 1);

  const minted = { props: [{ id: 'prop_3' }, { id: 'prop_7' }], lights: [{ id: 'light_1' }] };
  ok('computeNextId: highest _N + 1', computeNextId('level', minted) === 8);
}

// ---- createDoc: fromGlobals fallback (bundle = null, 24.3's "before US-027b" path) ----
{
  const towerDef = { props: [{ id: 'brazier' }], lights: [], interactables: [], triggers: [] };
  const worldDef = { structures: [{ id: 'tower', level: 'tower' }], entities: [], horizon: [], triggers: [] };
  const assets = fakeAssets({ levels: { tower: towerDef }, worlds: { world_m1: worldDef } });

  const doc = createDoc(assets, null, { worldId: 'world_m1' });
  ok('doc.worldId defaults to the requested world', doc.worldId === 'world_m1');
  ok('doc.readOnly is true with no bundle (24.3 fallback)', doc.readOnly === true);
  ok('doc.files has an entry per level/world, keyed by fileKey', doc.files.has('level/tower') && doc.files.has('world/world_m1'));

  const towerFile = doc.files.get('level/tower');
  ok('doc.files entry def IS the registry object (no copy, 24.1 decision 1)', towerFile.def === towerDef);
  ok('doc.files entry nextId computed (no minted ids -> 1)', towerFile.meta.nextId === 1);
  ok('doc.files entry starts clean', towerFile.dirty === false && towerFile.handle === null);
}

// ---- createDoc: with a bundle (meta comes from loadContentPack) ------------
{
  const towerDef = { props: [] };
  const worldDef = { structures: [] };
  const assets = fakeAssets({ levels: { tower: towerDef }, worlds: { world_m1: worldDef } });
  const bundle = {
    meta: {
      level: { tower: { url: 'http://x/tower.level.json', schema: 1, nextId: 5 } },
      world: { world_m1: { url: 'http://x/world_m1.world.json', schema: 1, nextId: 2 } },
    },
  };
  const doc = createDoc(assets, bundle, { worldId: 'world_m1' });
  ok('doc.readOnly is false with a bundle', doc.readOnly === false);
  ok("doc.files meta.nextId comes from the bundle's meta, not recomputed", doc.files.get('level/tower').meta.nextId === 5);
  ok('doc.files meta.url comes from the bundle', doc.files.get('world/world_m1').meta.url === 'http://x/world_m1.world.json');
}

// ---- mintId: never reused, writes back to file.meta.nextId (24.1 decision 3) ----
{
  const file = { meta: { nextId: 3 } };
  const a = mintId(file, 'prop');
  const b = mintId(file, 'prop');
  ok('mintId returns type_nextId', a === 'prop_3');
  ok('mintId advances nextId (never reused)', b === 'prop_4');
  ok('file.meta.nextId reflects the mint', file.meta.nextId === 5);
}

// ---- CO-7: frameFor / itemToWorld / worldToItem round trip (replaces the old translation-only toLocal/toWorld) ----
{
  const frame = { x: 1480, y: 1018, z: 0, yawSteps: 0 };
  const worldPoint = { x: 1497, y: 1027.5, z: 3.2 };
  const local = worldToItem(frame, worldPoint.x, worldPoint.y, worldPoint.z);
  ok('worldToItem subtracts the frame origin', local.x === 17 && local.y === 9.5 && local.z === 3.2, JSON.stringify(local));
  const back = itemToWorld(frame, local.x, local.y, local.z);
  ok('itemToWorld(worldToItem(p)) round-trips to p', back.x === worldPoint.x && back.y === worldPoint.y && back.z === worldPoint.z);

  ok('itemToWorld with frame=null is the identity (world-space item)', itemToWorld(null, 5, 6, 7).x === 5 && itemToWorld(null, 5, 6, 7).z === 7);
  ok('worldToItem with frame=null is the identity (world-space item)', worldToItem(null, 5, 6, 7).y === 6);

  // frameFor(selection) = structId ? world.frameOf(structId) : null (CO-7).
  const fakeWorld = { frameOf: (id) => (id === 'tower' ? frame : null) };
  ok('frameFor resolves through world.frameOf by structId', frameFor(fakeWorld, { structId: 'tower' }) === frame);
  ok('frameFor returns null for a selection with no structId (world-space item)', frameFor(fakeWorld, { structId: null }) === null);
  ok('frameFor returns null for a null selection', frameFor(fakeWorld, null) === null);
}

// ---- US-032 selection item <-> entity id mapping (24.7), CO-7's `structId` ----
{
  const towerDef = { name: 'tower', props: [{ id: 'brazier', model: 'brazier', x: 1, y: 1, z: 0 }] };
  const worldDef = { structures: [{ id: 'tower', level: 'tower' }], entities: [{ id: 'farTower', x: 1, y: 2, z: 3 }] };
  const assets = fakeAssets({ levels: { tower: towerDef }, worlds: { world_m1: worldDef } });
  const doc = createDoc(assets, null, { worldId: 'world_m1' });
  // A fake World: just enough shape for selectionFromEntityId/selectionEntityId (structures[].id/.level.name).
  const world = { structures: [{ id: 'tower', level: { name: 'tower' } }] };

  const propItem = selectionFromEntityId(doc, world, 'tower.brazier');
  ok('selectionFromEntityId: a prop entity id maps to level/props', propItem.fileId === 'level/tower' && propItem.collection === 'props' && propItem.id === 'brazier', JSON.stringify(propItem));
  ok('selectionFromEntityId: carries the owning structId (CO-7)', propItem.structId === 'tower', JSON.stringify(propItem));
  const backId = selectionEntityId(world, propItem);
  ok('selectionEntityId: round-trips back to the runtime id', backId === 'tower.brazier', backId);

  const worldEntItem = selectionFromEntityId(doc, world, 'farTower');
  ok('selectionFromEntityId: an unprefixed id maps to the world file entities', worldEntItem.fileId === 'world/world_m1' && worldEntItem.collection === 'entities' && worldEntItem.id === 'farTower');
  ok('selectionFromEntityId: a world entity has structId null (already world-space)', worldEntItem.structId === null);
  ok('selectionEntityId: world entity round-trips to its own id', selectionEntityId(world, worldEntItem) === 'farTower');

  const data = selectionItemData(doc, propItem);
  ok('selectionItemData: finds the prop object', data && data.model === 'brazier', JSON.stringify(data));
  ok('selectionItemIndex: finds its array index', selectionItemIndex(doc, propItem) === 0);
  ok('selectionItemIndex: -1 for an id that does not exist', selectionItemIndex(doc, { fileId: 'level/tower', collection: 'props', id: 'nope' }) === -1);

  const outlined = listOutlinerItems(doc);
  ok('listOutlinerItems: includes the prop and the world entity', outlined.some((o) => o.id === 'brazier' && o.collection === 'props') && outlined.some((o) => o.id === 'farTower' && o.collection === 'entities'), JSON.stringify(outlined));
  ok('listOutlinerItems: with no world arg, structId is null (back-compat)', outlined.every((o) => o.structId === null));

  const outlinedWithWorld = listOutlinerItems(doc, world);
  const propRow = outlinedWithWorld.find((o) => o.id === 'brazier');
  ok('listOutlinerItems(doc, world): resolves structId for a level-owned item', propRow && propRow.structId === 'tower', JSON.stringify(propRow));
}

// ---- CO-7: two placements of one level select the right structure's frame (section 10 item 7) ----
{
  const roomDef = { name: 'test_room', props: [{ id: 'torch', model: 'torch', x: 2, y: 3, z: 0 }] };
  const worldDef = { structures: [{ id: 'roomA', level: 'test_room' }, { id: 'roomB', level: 'test_room' }], entities: [] };
  const assets = fakeAssets({ levels: { test_room: roomDef }, worlds: { two_rooms: worldDef } });
  const doc = createDoc(assets, null, { worldId: 'two_rooms' });
  const frameA = { x: 0, y: 0, z: 0, yawSteps: 0 };
  const frameB = { x: 100, y: 50, z: 0, yawSteps: 0 };
  const world = {
    structures: [
      { id: 'roomA', level: { name: 'test_room' }, frame: frameA },
      { id: 'roomB', level: { name: 'test_room' }, frame: frameB },
    ],
    frameOf(id) { return (this.structures.find((s) => s.id === id) || {}).frame || null; },
  };

  const selA = selectionFromEntityId(doc, world, 'roomA.torch');
  const selB = selectionFromEntityId(doc, world, 'roomB.torch');
  ok('selectionFromEntityId picks roomA for a roomA-prefixed entity id (not the first structure sharing the level)', selA.structId === 'roomA', JSON.stringify(selA));
  ok('selectionFromEntityId picks roomB for a roomB-prefixed entity id', selB.structId === 'roomB', JSON.stringify(selB));

  ok('selectionEntityId (by structId) round-trips roomA', selectionEntityId(world, selA) === 'roomA.torch');
  ok('selectionEntityId (by structId) round-trips roomB, NOT roomA', selectionEntityId(world, selB) === 'roomB.torch');

  const item = selectionItemData(doc, selA); // the shared content item (x:2,y:3,z:0)
  const worldA = itemToWorld(frameFor(world, selA), item.x, item.y, item.z);
  const worldB = itemToWorld(frameFor(world, selB), item.x, item.y, item.z);
  ok('the SAME content item resolves to a DIFFERENT world position through each placement\'s own frame',
    worldA.x === 2 && worldA.y === 3 && worldB.x === 102 && worldB.y === 53, JSON.stringify({ worldA, worldB }));

  // Outliner: the level file is shared content (one row), but the row's
  // structId resolves to a placement - here the FIRST one, documented above.
  const outlined = listOutlinerItems(doc, world);
  const row = outlined.find((o) => o.id === 'torch');
  ok('listOutlinerItems documented limitation: one row for the shared content, structId = the first placement', row && row.structId === 'roomA', JSON.stringify(row));
}

// ---- US-063: `?world=<id>` opens another world -----------------------------
// No content/design world def wraps test_room today (only world_m1, which
// wraps tower) - this constructs a minimal one in-memory, the way the task
// note suggests, to prove `createDoc`'s `worldId` option (fed from
// `params.get('world')` in main.js) picks whichever world the registry
// actually has, not just the 'world_m1' default.
{
  const towerDef = { props: [] };
  const testRoomDef = { name: 'test_room', props: [], lights: [] };
  const worldM1 = { structures: [{ id: 'tower', level: 'tower' }], entities: [] };
  const testRoomWorld = { structures: [{ id: 'room', level: 'test_room' }], entities: [] };
  const assets = fakeAssets({
    levels: { tower: towerDef, test_room: testRoomDef },
    worlds: { world_m1: worldM1, test_room_world: testRoomWorld },
  });

  const defaultDoc = createDoc(assets, null, {});
  ok('createDoc: no worldId option -> defaults to world_m1', defaultDoc.worldId === 'world_m1');

  const otherDoc = createDoc(assets, null, { worldId: 'test_room_world' });
  ok('createDoc: an arbitrary ?world= id is honoured verbatim', otherDoc.worldId === 'test_room_world');
  ok('createDoc: still builds a doc.files entry for every level/world the registry has (both worlds coexist)',
    otherDoc.files.has('level/test_room') && otherDoc.files.has('world/test_room_world') && otherDoc.files.has('world/world_m1'));
  const roomFile = otherDoc.files.get('level/test_room');
  ok('createDoc: the test_room-wrapping world\'s own level file is the real registry object', roomFile.def === testRoomDef);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
