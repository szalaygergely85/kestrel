// tools/editor/dnd.test.mjs - ED-DND-01 (docs/backlog.md). Plain Node ESM,
// no DOM: the pure snap/decision helpers the asset drag-and-drop uses
// (`resolveDropPoint`, `resolveAssetDrop`) plus the commit/undo round trip a
// drop's `placeAt` produces through the existing commands.js/undo.js.
import { resolveDropPoint, resolveAssetDrop, snappedWorldPos, worldGroundZ } from './panel.js';
import { makeInsertRecord, applyEdit, invert } from './commands.js';
import { createStack } from './undo.js';
import { makeOk } from '../../engine/test/assert.js';

let pass = 0;
let fail = 0;
const failures = [];

const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

/** A one-file world doc with an empty `entities` collection (the collection `placeAt`'s world-prop drop inserts into). */
function worldDoc() {
  const def = { entities: [] };
  const files = new Map();
  files.set('world/w', { kind: 'world', def, dirty: false });
  return { worldId: 'w', files };
}

// ---- resolveDropPoint: a terrain point (outside every structure) ---------
{
  const terrainWorld = {
    structureAt: () => null,
    sectorAt: () => null,
    floorAt: (x, y) => 2.5, // terrain ground at any x/y
  };
  const pt = { x: 10, y: 20, z: 99 }; // raw pick z well above the ground (canopy)
  const drop = resolveDropPoint(terrainWorld, pt);
  ok('terrain drop keeps x/y, snaps z to floorAt', drop.x === 10 && drop.y === 20 && drop.z === 2.5, JSON.stringify(drop));
  const clickSnap = snappedWorldPos(pt, worldGroundZ(terrainWorld, 10, 20));
  ok('terrain drop equals the click-placement snap (worldGroundZ/floorAt)',
    drop.x === clickSnap.x && drop.y === clickSnap.y && drop.z === clickSnap.z, JSON.stringify({ drop, clickSnap }));
}

// ---- resolveDropPoint: a point inside the tower (a structure) ------------
{
  const towerWorld = {
    structureAt: (x, y) => (x >= 0 && x < 10 && y >= 0 && y < 10) ? { id: 'tower' } : null,
    sectorAt: () => ({ floorH: 1, solid: false }),
    floorAt: (x, y) => 1, // structure floor z
  };
  const pt = { x: 2, y: 3, z: 1 }; // a floor pick: z == the structure floor
  const drop = resolveDropPoint(towerWorld, pt);
  ok('tower drop keeps the raw pick point (structure branch, same as placeAt)', drop.x === 2 && drop.y === 3 && drop.z === 1, JSON.stringify(drop));
  ok('tower drop lands on the snapped floor z (== floorAt)', drop.z === towerWorld.floorAt(2, 3), JSON.stringify(drop));

  // A wall pick (z above the floor) keeps the raw z - exactly what placeAt's
  // structure branch does (`worldToItem(s.frame, pt)`), NOT a floorAt re-snap.
  // Click and drag land identically, wall picks included.
  const wallDrop = resolveDropPoint(towerWorld, { x: 2, y: 3, z: 3.2 });
  ok('tower wall pick keeps the raw z (same as click placement, no floorAt re-snap)', wallDrop.z === 3.2, JSON.stringify(wallDrop));
}

// ---- resolveDropPoint: a courtyard gap (no floor) ------------------------
{
  const gapWorld = {
    structureAt: () => ({ id: 'tower' }),
    sectorAt: () => null, // a gap cell inside the structure bbox
    floorAt: () => null,
  };
  ok('gap drop returns null (refused, no floor)', resolveDropPoint(gapWorld, { x: 5, y: 5, z: 0 }) === null);
}

// ---- resolveAssetDrop: the pure drop decision ----------------------------
ok('drop decision: over the view, no Esc -> place', resolveAssetDrop(true, false) === 'place');
ok('drop decision: outside the view -> cancel', resolveAssetDrop(false, false) === 'cancel');
ok('drop decision: Esc -> cancel (even over the view)', resolveAssetDrop(true, true) === 'cancel');

// ---- cancel leaves the scene unchanged -----------------------------------
{
  const doc = worldDoc();
  const before = JSON.stringify(doc.files.get('world/w').def);
  // A cancelled drag (Esc, or dropping outside the view) decides 'cancel' ->
  // main.js never calls placeAt/commit -> no record -> the doc is unchanged.
  for (const [overView, esc] of [[false, false], [true, true], [false, true]]) {
    if (resolveAssetDrop(overView, esc) === 'cancel') continue; // main.js: no placeAt, no applyEdit
    applyEdit(doc, makeInsertRecord('world/w', 'entities', { id: 'ghost' }));
  }
  ok('cancel leaves the doc unchanged (no record applied)', JSON.stringify(doc.files.get('world/w').def) === before, JSON.stringify(doc.files.get('world/w').def));
}

// ---- a drop places exactly one item; one undo removes it -----------------
{
  const doc = worldDoc();
  const stack = createStack(50);
  const item = { id: 'prop_1', type: 'prop', components: { voxel: { model: 'waystone' } }, x: 1, y: 2, z: 0, yawDeg: 0 };
  const rec = makeInsertRecord('world/w', 'entities', item);
  applyEdit(doc, rec);
  stack.push(rec);
  ok('drop places exactly one item (entities.length 1)', doc.files.get('world/w').def.entities.length === 1);
  ok('drop produces exactly one undo record', stack.size === 1);
  const popped = stack.undo();
  ok('undo pops the drop record', popped === rec);
  applyEdit(doc, invert(popped));
  ok('one undo removes the placed item (entities.length 0)', doc.files.get('world/w').def.entities.length === 0);
}

console.log(`dnd.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
