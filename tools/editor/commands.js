// tools/editor/commands.js - US-032 (docs/architecture.md 24.8). Pure edit
// records over `doc` (no DOM, no World, no GPU) - Node-tested
// (commands.test.mjs). `main.js` is the one mutation path: `commit(rec)`
// calls `applyEdit`, pushes onto the `undo.js` stack, then rebuilds the
// World (24.8's own note - that glue lives in main.js, not here).
//
// Imports only engine/index.js (the editor boundary rule).
import { REF_FIELDS } from '../../engine/index.js';

/**
 * @typedef {{ label:string, fileId:string, collection:string, id:string,
 *   index:number|null, before:Object|null, after:Object|null }} EditRecord
 * `before==null` -> insert `after` at `index` (append when `index` is null).
 * `after==null` -> remove (the item's index, remembered so undo reinserts at
 * the same place). Otherwise: replace the item's fields in place.
 */

/** Builds an `EditRecord`, `structuredClone`-ing `before`/`after` once (24.8). */
export function makeRecord(label, fileId, collection, id, index, before, after) {
  return {
    label,
    fileId,
    collection,
    id,
    index: index == null ? null : index,
    before: before == null ? null : structuredClone(before),
    after: after == null ? null : structuredClone(after),
  };
}

/** `invert(rec)` swaps before/after (undo) - same shape, same index. */
export function invert(rec) {
  return { ...rec, before: rec.after, after: rec.before };
}

function findIndexById(arr, id, hintIndex) {
  if (hintIndex != null && arr[hintIndex] && arr[hintIndex].id === id) return hintIndex;
  return arr.findIndex((it) => it && it.id === id);
}

/**
 * Applies one `EditRecord` to `doc` in place (24.8). `doc.files.get(fileId)`
 * must exist; `file.def[collection]` is created as `[]` on first use (a
 * level/world with no `props`/`lights`/etc yet). Sets `file.dirty = true`.
 */
export function applyEdit(doc, rec) {
  const file = doc.files.get(rec.fileId);
  if (!file) throw new Error(`applyEdit: unknown file "${rec.fileId}"`);
  const def = file.def;
  if (!Array.isArray(def[rec.collection])) def[rec.collection] = [];
  const arr = def[rec.collection];

  if (rec.before == null && rec.after != null) {
    const idx = rec.index == null ? arr.length : Math.min(rec.index, arr.length);
    arr.splice(idx, 0, structuredClone(rec.after));
  } else if (rec.after == null && rec.before != null) {
    const idx = findIndexById(arr, rec.id, rec.index);
    if (idx !== -1) arr.splice(idx, 1);
  } else if (rec.after != null) {
    const idx = findIndexById(arr, rec.id, rec.index);
    if (idx !== -1) arr[idx] = structuredClone(rec.after);
  }
  file.dirty = true;
}

/**
 * Referrers of `id` (in collection `collection`) inside `def`, per
 * `REF_FIELDS[kind]` (engine/content/schema.js - same table the content
 * loader itself uses). Delete is refused when this is non-empty (24.8).
 * @returns {string[]} `${collection}.${id}` of every referring item
 */
export function findReferrers(def, kind, collection, id) {
  const out = [];
  for (const rf of REF_FIELDS[kind] || []) {
    if (rf.collection !== collection) continue;
    const m = /^(\w+)\[\]\.(\w+(?:\.\w+)*)$/.exec(rf.field);
    if (!m) continue;
    const [, coll, path] = m;
    const parts = path.split('.');
    for (const item of def[coll] || []) {
      let v = item;
      for (const p of parts) v = v && v[p];
      if (v === id) out.push(`${coll}.${item.id}`);
    }
  }
  return out;
}

/** Nudge/drag/yaw/drop share this: before = clone(item), after = item with `patch` merged in. */
export function makeFieldEditRecord(label, fileId, collection, item, index, patch) {
  return makeRecord(label, fileId, collection, item.id, index, item, { ...item, ...patch });
}

/** Delete: `after: null`, `index` remembered so undo reinserts at the same place. */
export function makeDeleteRecord(fileId, collection, item, index) {
  return makeRecord('delete', fileId, collection, item.id, index, item, null);
}

/** Insert (place): `before: null`. `index: null` appends. */
export function makeInsertRecord(fileId, collection, item, index = null) {
  return makeRecord('place', fileId, collection, item.id, index, null, item);
}
