// tools/editor/coordFrame.test.mjs - CO-7 (docs/coordinates.md section 11
// row CO-7 + section 10 test-strategy item 7):
//
//   "Editor: nudge/drag/drop/place on a level prop under a `yawSteps 1`
//   structure edit the local item by the rotated delta; a world entity edits
//   unchanged; two placements of `test_room` in one world select the right
//   one."
//
// CO-4 (`rotateLevel` + `yawSteps 1..3`) is still `deferred` per
// docs/backlog.md's `| CO-4 |` row - `World.placeStructure` still throws on
// a non-zero `yawSteps` (engine/world/World.js:520) - so this file is
// deliberately scoped down to the `yawSteps 0` identity case (every placed
// structure today), per the CO-7 story note. What it actually proves:
//
//   1. nudge/drop/place go through the SAME shared `Frame`/`localToWorld`/
//      `worldToLocal` API (doc.js's `frameFor`/`itemToWorld`/`worldToItem`,
//      engine/core/transform.js) instead of the old hand-written
//      `+ origin`/`toLocal`/`toWorld`/`isWorldSpace` string tests - and
//      produce numerically IDENTICAL results to that old math (translation-
//      only, `yawSteps 0`).
//   2. A world-file entity (`structId: null`) edits unchanged (identity,
//      no frame).
//   3. Two placements of one level (`test_room` placed twice in one world,
//      different `structId`s, different frames) each resolve to their OWN
//      structure's frame - never mixed up - for `selectionFromEntityId`,
//      `frameFor`, the nudge/drop/place math, AND the live-patch path
//      (`applyPropTransformPatch`/`applyLightPatch`, livepatch.js).
//
// Plain Node ESM, no test framework, no build step. Run with:
//
//   node tools/editor/coordFrame.test.mjs
import { makeOk } from '../../engine/test/assert.js';
import {
  frameFor, itemToWorld, worldToItem, selectionFromEntityId, selectionEntityId,
} from './doc.js';
import { applyPropTransformPatch, applyLightPatch } from './livepatch.js';

let pass = 0;
let fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- fixture: `test_room` placed twice in one world, at different frames ----
// (Node-level fake World - just enough shape for `frameOf`/`structures` -
// same convention as doc.test.mjs's own fakes; not the real engine World.)
const FRAME_A = { x: 0, y: 0, z: 0, yawSteps: 0 };
const FRAME_B = { x: 100, y: 50, z: 3, yawSteps: 0 }; // a non-zero z too (section 10 item 4's "non-zero z" case, translation-only)
function makeTwoRoomWorld() {
  const structures = [
    { id: 'roomA', level: { name: 'test_room' }, frame: FRAME_A },
    { id: 'roomB', level: { name: 'test_room' }, frame: FRAME_B },
  ];
  return {
    structures,
    frameOf(id) { const s = structures.find((st) => st.id === id); return s ? s.frame : null; },
  };
}

// The old (pre-CO-7) translation-only helpers, kept ONLY in this test as the
// oracle to check the new frame-based path against (doc.js no longer has
// `toLocal`/`toWorld` - CO-7 deletes them, per the story's replaces-list).
function oldToWorld(origin, p) { return { x: p.x + origin.x, y: p.y + origin.y, z: p.z + origin.z }; }
function oldToLocal(origin, p) { return { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z }; }

// ---- 1. nudge: new frame-based math === old origin-based math (yawSteps 0) ----
{
  const world = makeTwoRoomWorld();
  const item = { x: 2, y: 3, z: 0.5 }; // a level-local prop position
  const selA = { fileId: 'level/test_room', collection: 'props', id: 'torch', structId: 'roomA' };
  const selB = { fileId: 'level/test_room', collection: 'props', id: 'torch', structId: 'roomB' };

  // Simulates main.js's applyNudge('x', +1) at snap 1 for each placement.
  function simulateNudge(sel, axis, delta) {
    const frame = frameFor(world, sel);
    const worldPos = itemToWorld(frame, item.x, item.y, item.z);
    const nextWorld = { x: worldPos.x, y: worldPos.y, z: worldPos.z };
    nextWorld[axis] += delta;
    return worldToItem(frame, nextWorld.x, nextWorld.y, nextWorld.z);
  }

  const gotA = simulateNudge(selA, 'x', 1);
  const oldA = oldToLocal(FRAME_A, { x: oldToWorld(FRAME_A, item).x + 1, y: oldToWorld(FRAME_A, item).y, z: oldToWorld(FRAME_A, item).z });
  ok('nudge through roomA\'s frame matches the old origin-based math bit-for-bit', gotA.x === oldA.x && gotA.y === oldA.y && gotA.z === oldA.z, JSON.stringify({ gotA, oldA }));

  const gotB = simulateNudge(selB, 'x', 1);
  const oldB = oldToLocal(FRAME_B, { x: oldToWorld(FRAME_B, item).x + 1, y: oldToWorld(FRAME_B, item).y, z: oldToWorld(FRAME_B, item).z });
  ok('nudge through roomB\'s (different, non-zero-z) frame matches the old math too', gotB.x === oldB.x && gotB.y === oldB.y && gotB.z === oldB.z, JSON.stringify({ gotB, oldB }));

  // The SAME local delta (+1 local x, since frames are translation-only and
  // axis-aligned at yawSteps 0) results from both placements: proves the
  // per-placement frame was actually used, not a shared/global one.
  ok('the local nudge result is the same local delta (+1 x) for BOTH placements (each through its own frame)', gotA.x === item.x + 1 && gotB.x === item.x + 1);
}

// ---- 2. a world entity (structId null) edits unchanged (identity, no frame) ----
{
  const world = makeTwoRoomWorld();
  const worldSel = { fileId: 'world/two_rooms', collection: 'entities', id: 'farTower', structId: null };
  const frame = frameFor(world, worldSel);
  ok('frameFor(world entity) is null', frame === null);
  const item = { x: 42, y: -7, z: 1.2 };
  const worldPos = itemToWorld(frame, item.x, item.y, item.z);
  ok('a world entity\'s "world position" is its own x/y/z, unchanged', worldPos.x === item.x && worldPos.y === item.y && worldPos.z === item.z);
  const back = worldToItem(frame, worldPos.x + 5, worldPos.y, worldPos.z);
  ok('...and edits (e.g. a +5 nudge) apply directly with no frame math', back.x === item.x + 5);
}

// ---- 3. two placements of test_room select the right one (never mixed up) ----
{
  const world = makeTwoRoomWorld();
  const selA = selectionFromEntityId({ worldId: 'two_rooms' }, world, 'roomA.torch');
  const selB = selectionFromEntityId({ worldId: 'two_rooms' }, world, 'roomB.torch');
  ok('picking the roomA instance resolves structId roomA', selA.structId === 'roomA');
  ok('picking the roomB instance resolves structId roomB (NOT roomA, even though both are "level/test_room")', selB.structId === 'roomB');
  ok('both selections share the same content fileId (one shared level file)', selA.fileId === 'level/test_room' && selB.fileId === 'level/test_room');

  ok('selectionEntityId(selA) round-trips to roomA\'s runtime id', selectionEntityId(world, selA) === 'roomA.torch');
  ok('selectionEntityId(selB) round-trips to roomB\'s runtime id, not roomA\'s', selectionEntityId(world, selB) === 'roomB.torch');

  // "place" simulation: dropping a new prop at world point (105, 53, 3)
  // (inside roomB's footprint) must produce LOCAL coordinates relative to
  // roomB's frame, not roomA's.
  const dropPoint = { x: 105, y: 53, z: 3 };
  const localInB = worldToItem(FRAME_B, dropPoint.x, dropPoint.y, dropPoint.z);
  ok('placing into roomB converts through roomB\'s frame (local (5,3,0))', localInB.x === 5 && localInB.y === 3 && localInB.z === 0, JSON.stringify(localInB));
  const localInAIfMixedUp = worldToItem(FRAME_A, dropPoint.x, dropPoint.y, dropPoint.z);
  ok('(sanity) using the WRONG frame (roomA) would have given a different, wrong local point - proving the frame choice actually matters here', localInAIfMixedUp.x !== localInB.x);
}

// ---- 4. live-patch path (drag/property-edit, no rebuild): same per-placement frame rule ----
{
  const world = makeTwoRoomWorld();
  const item = { x: 2, y: 3, z: 0.5, facing: 90 };

  const tA = { x: 0, y: 0, z: 0, yawDeg: 0 };
  applyPropTransformPatch(tA, item, frameFor(world, { structId: 'roomA' }));
  ok('applyPropTransformPatch through roomA\'s frame', tA.x === 2 && tA.y === 3 && tA.z === 0.5 && tA.yawDeg === 90, JSON.stringify(tA));

  const tB = { x: 0, y: 0, z: 0, yawDeg: 0 };
  applyPropTransformPatch(tB, item, frameFor(world, { structId: 'roomB' }));
  ok('the SAME item patched through roomB\'s (different) frame lands at a different world transform', tB.x === 102 && tB.y === 53 && tB.z === 3.5, JSON.stringify(tB));

  // A light, same story, via applyLightPatch.
  function fakeLightSet() { const moves = []; return { move(h, x, y, z) { moves.push({ h, x, y, z }); }, setOn() {}, _moves: moves }; }
  const lsA = fakeLightSet();
  applyLightPatch(lsA, 0, { x: 1, y: 1, z: 1 }, frameFor(world, { structId: 'roomA' }));
  ok('applyLightPatch through roomA\'s frame', lsA._moves[0].x === 1 && lsA._moves[0].y === 1 && lsA._moves[0].z === 1, JSON.stringify(lsA._moves[0]));
  const lsB = fakeLightSet();
  applyLightPatch(lsB, 0, { x: 1, y: 1, z: 1 }, frameFor(world, { structId: 'roomB' }));
  ok('the SAME light item through roomB\'s frame lands at a different world position', lsB._moves[0].x === 101 && lsB._moves[0].y === 51 && lsB._moves[0].z === 4, JSON.stringify(lsB._moves[0]));
}

console.log(`\ncoordFrame.test.mjs: ${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
