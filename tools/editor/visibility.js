// tools/editor/visibility.js - US-067 (docs/backlog.md PC-B QUEUE 3 item 8).
// Scene-tree "eye"/"lock" state: a plain in-memory overlay over the editor's
// selection, deliberately NOT part of `doc` (doc.js's `files` map is the
// content JSON itself, US-031's own "the document is the content JSON"
// decision) - hidden/locked never touches a `doc.files` entry, so it can
// never leak into a save (io.js's `toFileObject`/`stringifyContent` only
// ever reads `file.def`, never this state) and is naturally session-only
// (a fresh `createVisibilityState()` on every page load - no localStorage).
//
// Split the same way as commands.js/livepatch.js: pure state + pure
// entity-mutation helpers here (Node-tested, visibility.test.mjs), the DOM
// (tree row icons) and the `frame.lightSet`/`world` wiring in main.js.
//
// No imports (plain data/duck-typed objects only, like livepatch.js).

/** A stable string key for a `{fileId, collection, id}` selection item (doc.js's shape). `\u0000` never appears in a fileId/collection/id (collection is a fixed enum, id matches panel.js's `ID_REGEX`, fileId is `kind/id`). */
export function itemKey(item) {
  return `${item.fileId}\u0000${item.collection}\u0000${item.id}`;
}

/** A fresh, empty hide/lock overlay (one per editor session/page load). */
export function createVisibilityState() {
  return { hidden: new Map(), locked: new Map() };
}

export function isHidden(state, item) { return state.hidden.has(itemKey(item)); }
export function isLocked(state, item) { return state.locked.has(itemKey(item)); }

/** Sets/clears an item's hidden flag in the overlay (does not touch live render state - see `applyHiddenToEntity`/main.js). */
export function setHiddenFlag(state, item, hidden) {
  const k = itemKey(item);
  if (hidden) state.hidden.set(k, item); else state.hidden.delete(k);
}

/** Sets/clears an item's locked flag in the overlay (pick/drag-time check only - no live render state to patch). */
export function setLockedFlag(state, item, locked) {
  const k = itemKey(item);
  if (locked) state.locked.set(k, item); else state.locked.delete(k);
}

// ---------------------------------------------------------------------------
// Live render-state application (pure functions over duck-typed live
// objects - Node-testable with plain fakes, same split as livepatch.js).
// ---------------------------------------------------------------------------

/**
 * Hides/restores a live entity's visual components in place. Hiding an
 * entity this way (rather than e.g. moving its transform) means it drops out
 * of `VoxelPool`/`SpritePool`'s own entity scan (`world.forEachEntity((e) =>
 * e.components.voxel/sprite`, engine/render/voxelPool.js + sprites.js) the
 * next time `world.renderVersion` changes - so it is both "not drawn" and,
 * as a natural side effect, no longer a candidate for the viewport's own
 * ray-cylinder/voxel-slot entity pick (pick.js's `collectEntities`/
 * `VoxelPool.list`) - never mutates `doc`, only the live entity object
 * `world.entity(id)` already returns to `patchLive`/drag.
 * @param {{components?: Object, _edHiddenStash?: Object}} entity
 * @param {boolean} hidden
 */
export function setEntityComponentsHidden(entity, hidden) {
  if (!entity || !entity.components) return;
  if (hidden) {
    if (entity._edHiddenStash) return; // already hidden - idempotent
    const stash = {};
    if ('voxel' in entity.components) { stash.voxel = entity.components.voxel; delete entity.components.voxel; }
    if ('sprite' in entity.components) { stash.sprite = entity.components.sprite; delete entity.components.sprite; }
    entity._edHiddenStash = stash;
  } else {
    const stash = entity._edHiddenStash;
    if (!stash) return; // not hidden - idempotent
    if ('voxel' in stash) entity.components.voxel = stash.voxel;
    if ('sprite' in stash) entity.components.sprite = stash.sprite;
    delete entity._edHiddenStash;
  }
}

/**
 * Hides/restores a live light: `LightSet.setOn` (US-069's own public
 * mutator, engine/render/lighting.js) turns its glow off without touching
 * the doc's real `on` value - restoring passes `realOn` (the item's actual
 * `on` field) back through, not a hardcoded `true`, so a light that was
 * already off in the doc stays off after unhiding.
 * @param {{setOn(h:number, on:boolean):void}} lightSet
 * @param {number} handle
 * @param {boolean} hidden
 * @param {boolean} realOn the doc item's real `on` value
 */
export function setLightHiddenLive(lightSet, handle, hidden, realOn) {
  if (!lightSet || handle < 0) return;
  lightSet.setOn(handle, hidden ? false : !!realOn);
}

/**
 * Locked items are "skipped by viewport pick and drag" (US-067): a viewport
 * click that resolves to a locked entity's id must not select or arm a drag
 * on it. Returns the selection item, or `null` when it is locked (the
 * caller then falls through to whatever picking a marker/nothing does -
 * exactly as if the click had missed).
 * @param {{locked: Map}} state
 * @param {{fileId:string, collection:string, id:string}} item a `selectionFromEntityId` result
 */
export function pickSelectionOrNull(state, item) {
  return isLocked(state, item) ? null : item;
}
