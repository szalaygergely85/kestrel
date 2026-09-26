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

/** `invert(rec)` swaps before/after (undo) - same shape, same index; a `batch` inverts every sub-record (US-033). */
export function invert(rec) {
  if (rec.batch) {
    const inv = { label: rec.label, batch: rec.batch.map(invert) };
    if (rec.renameFrom !== undefined) {
      inv.renameFrom = rec.renameTo;
      inv.renameTo = rec.renameFrom;
      inv.fileId = rec.fileId;
      inv.collection = rec.collection;
    }
    return inv;
  }
  return { ...rec, before: rec.after, after: rec.before };
}

function findIndexById(arr, id, hintIndex) {
  if (hintIndex != null && arr[hintIndex] && arr[hintIndex].id === id) return hintIndex;
  const idx = arr.findIndex((it) => it && it.id === id);
  if (idx !== -1) return idx;
  // US-033 rename fallback: an id-changing record's `id` field stays the
  // ORIGINAL id for the record's whole lifetime (24.9's rename note), so
  // inverting it (undo) looks up an id the array no longer has - the index
  // recorded at commit time is still correct within that one record's own
  // before/after pair, so fall back to it rather than reporting "not found".
  if (hintIndex != null && arr[hintIndex]) return hintIndex;
  return -1;
}

/**
 * Applies one `EditRecord` to `doc` in place (24.8). `doc.files.get(fileId)`
 * must exist; `file.def[collection]` is created as `[]` on first use (a
 * level/world with no `props`/`lights`/etc yet). Sets `file.dirty = true`.
 * US-033 (24.9): `rec.batch` (an array of plain `EditRecord`s, e.g. an id
 * rename + its rewritten referrers) is applied in order as one undo step -
 * `invert` below inverts every sub-record so the whole batch undoes/redoes
 * together.
 */
export function applyEdit(doc, rec) {
  if (rec.batch) {
    for (const sub of rec.batch) applyEdit(doc, sub);
    return;
  }
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
 * loader itself uses), WITH the referring field's name so a rename (24.9)
 * can rewrite it exactly. Only handles a plain (non-nested-path) top-level
 * field, e.g. `interactables[].prop`; a dotted path like `spawn.structure`
 * is read as before but never rewritten (main.js's world-entity rename does
 * not need it - `spawn.structure` names a structure id, and structures are
 * read-only in the editor, 24.12 item 7).
 * @returns {{collection:string, id:string, field:string}[]}
 */
export function findReferrersDetailed(def, kind, collection, id) {
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
      if (v === id) out.push({ collection: coll, id: item.id, field: path });
    }
  }
  return out;
}

/**
 * Referrers of `id` (in collection `collection`) inside `def` (24.8). Delete
 * is refused when this is non-empty.
 * @returns {string[]} `${collection}.${id}` of every referring item
 */
export function findReferrers(def, kind, collection, id) {
  return findReferrersDetailed(def, kind, collection, id).map((r) => `${r.collection}.${r.id}`);
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

function getPath(obj, path) {
  let v = obj;
  for (const p of path.split('.')) v = v && v[p];
  return v;
}

function withPath(obj, path, value) {
  const parts = path.split('.');
  if (parts.length === 1) return { ...obj, [parts[0]]: value };
  // Nested (e.g. `spawn.structure`) - shallow-clone every object on the path.
  const [head, ...rest] = parts;
  return { ...obj, [head]: withPath(obj[head] || {}, rest.join('.'), value) };
}

/**
 * An id rename as ONE undo step (24.9): the item itself plus every same-file
 * referrer `findReferrersDetailed` finds, each a `makeFieldEditRecord` on its
 * own field. `def` is the file's own def (read, not mutated - `applyEdit`
 * does the mutating). `renameFrom`/`renameTo`/`fileId`/`collection` ride
 * along on the batch record so `main.js` can keep the live `selection`
 * pointer in sync across undo/redo (a plain `EditRecord.id` never changes
 * once minted; a rename is the one edit that changes it, so the selection
 * has to be told explicitly which id it becomes).
 * @returns {{label:string, batch:Object[], renameFrom:string, renameTo:string, fileId:string, collection:string}}
 */
export function makeRenameBatch(fileId, kind, collection, item, index, newId, def) {
  const batch = [makeFieldEditRecord('rename', fileId, collection, item, index, { id: newId })];
  for (const ref of findReferrersDetailed(def, kind, collection, item.id)) {
    const arr = def[ref.collection] || [];
    const refIndex = arr.findIndex((it) => it && it.id === ref.id);
    const refItem = arr[refIndex];
    if (!refItem) continue;
    const patch = withPath({}, ref.field, newId);
    batch.push(makeFieldEditRecord('rename-ref', fileId, ref.collection, refItem, refIndex, patch));
  }
  return { label: `rename "${item.id}" -> "${newId}"`, batch, renameFrom: item.id, renameTo: newId, fileId, collection };
}

// Exported for panel.js/main.js's own use (path helpers, not just internal).
export { getPath, withPath };
