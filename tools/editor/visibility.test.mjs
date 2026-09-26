// tools/editor/visibility.test.mjs - US-067. Plain Node ESM, no DOM (pure
// state + duck-typed live-object mutation, same split as livepatch.test.mjs).
import {
  itemKey, createVisibilityState, isHidden, isLocked, setHiddenFlag, setLockedFlag,
  setEntityComponentsHidden, setLightHiddenLive, pickSelectionOrNull,
} from './visibility.js';
import { selectionFromEntityId } from './doc.js';

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; } else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// ---- itemKey / state -----------------------------------------------------
{
  const a = { fileId: 'level/tower', collection: 'props', id: 'brazier' };
  const b = { fileId: 'level/tower', collection: 'lights', id: 'brazier' };
  ok('itemKey: distinguishes items that differ only by collection', itemKey(a) !== itemKey(b));

  const state = createVisibilityState();
  ok('createVisibilityState: starts empty', !isHidden(state, a) && !isLocked(state, a));
  setHiddenFlag(state, a, true);
  ok('setHiddenFlag(true): isHidden becomes true for that item only', isHidden(state, a) && !isHidden(state, b));
  setHiddenFlag(state, a, false);
  ok('setHiddenFlag(false): clears it', !isHidden(state, a));
  setLockedFlag(state, a, true);
  ok('setLockedFlag(true): isLocked becomes true', isLocked(state, a) && !isHidden(state, a));
  setLockedFlag(state, a, false);
  ok('setLockedFlag(false): clears it', !isLocked(state, a));
}

// ---- setEntityComponentsHidden: hide/restore a live entity's components ---
{
  const voxelComp = { model: 'lantern' };
  const ent = { id: 'e1', components: { voxel: voxelComp } };
  setEntityComponentsHidden(ent, true);
  ok('setEntityComponentsHidden(true): strips a voxel component off the live entity', ent.components.voxel === undefined);
  setEntityComponentsHidden(ent, true); // idempotent - a double-hide must not clobber the stash
  ok('setEntityComponentsHidden(true): idempotent (a second hide keeps the stash intact)', ent.components.voxel === undefined);
  setEntityComponentsHidden(ent, false);
  ok('setEntityComponentsHidden(false): restores the exact original component', ent.components.voxel === voxelComp);
  setEntityComponentsHidden(ent, false); // idempotent - a second restore is a no-op
  ok('setEntityComponentsHidden(false): idempotent (a second restore is a no-op)', ent.components.voxel === voxelComp);

  const spriteComp = { model: 'rubble0' };
  const ent2 = { id: 'e2', components: { sprite: spriteComp } };
  setEntityComponentsHidden(ent2, true);
  ok('setEntityComponentsHidden(true): strips a sprite component too', ent2.components.sprite === undefined);
  setEntityComponentsHidden(ent2, false);
  ok('setEntityComponentsHidden(false): restores it', ent2.components.sprite === spriteComp);

  // A no-op-safe call for a plain entity (e.g. the player, no visual components).
  const ent3 = { id: 'player', components: {} };
  setEntityComponentsHidden(ent3, true);
  setEntityComponentsHidden(ent3, false);
  ok('setEntityComponentsHidden: never throws for an entity with no voxel/sprite component', true);
}

// ---- hidden entities drop out of a VoxelPool/SpritePool-style entity scan --
// (engine/render/voxelPool.js's own `world.forEachEntity((e) => e.components
// && e.components.voxel)` filter, mirrored here without importing the engine.)
{
  const ent = { id: 'lamp', components: { voxel: { model: 'lantern' } } };
  const scan = () => !!(ent.components && ent.components.voxel);
  ok('a visible entity is picked up by the voxel-pool-style scan', scan());
  setEntityComponentsHidden(ent, true);
  ok('a hidden entity drops out of the voxel-pool-style scan (not drawn, and not a pick candidate)', !scan());
  setEntityComponentsHidden(ent, false);
  ok('unhiding restores it to the scan', scan());
}

// ---- setLightHiddenLive -----------------------------------------------------
{
  const calls = [];
  const ls = { setOn(h, on) { calls.push([h, on]); } };
  setLightHiddenLive(ls, 3, true, true); // hide a light that is really "on" in the doc
  ok('setLightHiddenLive(hidden=true): turns the live light off regardless of the doc value', JSON.stringify(calls.pop()) === JSON.stringify([3, false]));
  setLightHiddenLive(ls, 3, false, true); // unhide -> restores the REAL on-value
  ok('setLightHiddenLive(hidden=false): restores the light\'s real "on" value (true)', JSON.stringify(calls.pop()) === JSON.stringify([3, true]));
  setLightHiddenLive(ls, 3, false, false); // unhide a light that is really "off" in the doc
  ok('setLightHiddenLive(hidden=false): restores "off" too (not hardcoded true)', JSON.stringify(calls.pop()) === JSON.stringify([3, false]));
  setLightHiddenLive(ls, -1, true, true); // no live handle yet (not built/found) - must not throw
  ok('setLightHiddenLive: a missing handle (-1) is a safe no-op', calls.length === 0);
}

// ---- pickSelectionOrNull: locked items are skipped by viewport pick --------
{
  const world = { structures: [{ id: 'tower', level: { name: 'tower' } }] };
  const doc = { worldId: 'world_m1' };
  const propItem = selectionFromEntityId(doc, world, 'tower.brazier');
  const state = createVisibilityState();

  ok('pickSelectionOrNull: an unlocked item picks normally', pickSelectionOrNull(state, propItem) === propItem);

  setLockedFlag(state, propItem, true);
  ok('pickSelectionOrNull: a locked item is skipped by pick (returns null)', pickSelectionOrNull(state, propItem) === null);

  // Hidden (but not locked) is NOT skipped by this check - only lock affects
  // viewport pick per the US-067 AC ("locked = skipped by viewport pick and
  // drag"); a hidden entity is separately excluded from pick as a side
  // effect of `setEntityComponentsHidden` (its components are gone, so the
  // pool/pick candidate scans above never see it in the first place).
  setLockedFlag(state, propItem, false);
  setHiddenFlag(state, propItem, true);
  ok('pickSelectionOrNull: a hidden-but-unlocked item is NOT skipped by this check', pickSelectionOrNull(state, propItem) === propItem);
}

console.log(`visibility.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
