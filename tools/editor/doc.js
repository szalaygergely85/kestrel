// tools/editor/doc.js - US-031 (docs/architecture.md 24.7, boot slice per
// 24.3). The document model: one entry per content file the editor can see
// (a level or a world), wrapping the registry's OWN object (never a copy -
// architecture.md 24.1 decision 1 "the document is the content JSON").
//
// This story (US-031, viewer only) only needs enough of 24.7 for `main.js`'s
// boot (24.3: `createDoc(assets, bundle, { worldId })`) and for the Node
// test below; selection/highlight/markers/edits are US-032+ (24.7-24.9) and
// are NOT implemented here.
//
// Imports only engine/index.js (check-deps rule 3; no `game/` import, per
// the editor boundary rule).
import { ID_COLLECTIONS, LATEST_SCHEMA, localToWorld, worldToLocal, localYawToWorld } from '../../engine/index.js';

/** `fileKey('level', 'tower') -> 'level/tower'` (24.7). */
export function fileKey(kind, id) {
  return `${kind}/${id}`;
}

/**
 * US-027a 21.9's `nextId` rule, replayed locally for a def that has no
 * envelope of its own (the `fromGlobals`/no-bundle fallback, 24.3 "US-027b
 * not merged" path): 1 + the highest `_N` suffix minted in any of the kind's
 * id collections, or 1 if none are minted yet.
 */
export function computeNextId(kind, def) {
  let maxMinted = 0;
  for (const coll of ID_COLLECTIONS[kind] || []) {
    const items = def && def[coll];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item.id !== 'string') continue;
      const m = /_(\d+)$/.exec(item.id);
      if (m) maxMinted = Math.max(maxMinted, parseInt(m[1], 10));
    }
  }
  return maxMinted + 1;
}

/**
 * Builds the document: one `{ kind, id, def, meta, dirty, handle }` entry per
 * level/world the registry knows about (24.7's `doc.files` shape, trimmed to
 * what US-031 needs - no selection/edit fields yet).
 * @param {import('../../engine/index.js').AssetRegistry} assets
 * @param {Object|null} bundle - the `ContentBundle` from `loadContentPack`
 *   (has `.meta.level`/`.meta.world`), or `null` on the "content/ not found"
 *   fallback (24.3) - every file then gets a freshly-computed envelope
 *   instead of one read off a real JSON file.
 * @param {{worldId?: string}} [opts]
 */
export function createDoc(assets, bundle, opts = {}) {
  const worldId = opts.worldId || 'world_m1';
  const files = new Map();
  const kinds = [
    ['level', assets.keys('level')],
    ['world', assets.keys('world')],
  ];
  for (const [kind, ids] of kinds) {
    for (const id of ids) {
      const def = kind === 'level' ? assets.level(id) : assets.world(id);
      const metaSrc = bundle && bundle.meta && bundle.meta[kind] && bundle.meta[kind][id];
      const meta = metaSrc
        ? { schema: metaSrc.schema, nextId: metaSrc.nextId, url: metaSrc.url }
        : { schema: LATEST_SCHEMA[kind], nextId: computeNextId(kind, def), url: null };
      files.set(fileKey(kind, id), { kind, id, def, meta, dirty: false, handle: null });
    }
  }
  // 24.3 "US-027b not merged yet": no bundle -> read-only, download-only
  // saves (nothing else differs for the viewer story - saving is US-034).
  return { worldId, files, readOnly: !bundle };
}

/** `mintId(file, 'prop') -> 'prop_7'`, `file.meta.nextId` written back (24.1 decision 3 / 21.3). Never reused. */
export function mintId(file, type) {
  return `${type}_${file.meta.nextId++}`;
}

// ---- CO-7 (docs/coordinates.md 7/11): the shared Frame API replaces the
// old translation-only `toLocal`/`toWorld` (24.1 decision 4). A selection
// carries `structId` (never a level-name lookup, never an `isWorldSpace`
// string test - do-not-list items 2/3): `frameFor` resolves it to the
// structure's authored `Frame` (or `null` = the item is already in `W`,
// a world-file entity). `itemToWorld`/`worldToItem` wrap `localToWorld`/
// `worldToLocal` from engine/core/transform.js with the `frame === null`
// identity case the editor needs (plain small objects - edit-time only,
// never a per-frame hot path, so no caller-owned `out` here).

/**
 * `frameFor(selection) = structId ? world.frameOf(structId) : null` (CO-7,
 * docs/coordinates.md section 7). `null` means the item's own x/y/z are
 * already world metres (a world-file entity, or a selection with no
 * `structId`).
 * @param {import('../../engine/index.js').World} world
 * @param {{structId?: string|null}|null} selection
 * @returns {import('../../engine/index.js').Frame|null}
 */
export function frameFor(world, selection) {
  return selection && selection.structId != null ? world.frameOf(selection.structId) : null;
}

/** Local point (structure frame) -> world point. `frame = null` = identity (already world-space). */
export function itemToWorld(frame, lx, ly, lz) {
  return frame ? localToWorld(frame, lx, ly, lz, { x: 0, y: 0, z: 0 }) : { x: lx, y: ly, z: lz };
}

/** World point -> local point of `frame`. `frame = null` = identity (already world-space). */
export function worldToItem(frame, wx, wy, wz) {
  return frame ? worldToLocal(frame, wx, wy, wz, { x: 0, y: 0, z: 0 }) : { x: wx, y: wy, z: wz };
}

/** Local compass yaw (a level prop's `facing`) -> world compass yaw. `frame = null` = identity. */
export function yawItemToWorld(frame, yawDeg) {
  return frame ? localYawToWorld(frame, yawDeg) : yawDeg;
}

// ---- US-032 additions: selection item <-> runtime mapping, outliner (24.7) ----
// Deliberately NOT part of US-031's `doc.files` shape (see the file banner
// above) - added here rather than reshaped, per the US-031 note that
// `doc.js`'s existing shapes were built with this in mind.

/**
 * `{ fileId, collection, id, structId }` for content items (`level/tower`/
 * `props`/`brazier`), or `{ fileId:'world/<id>', collection:'entities', id,
 * structId:null }` for a world entity (`player`, `farTower`). A picked
 * prop's runtime entity id is `${structId}.${propId}` (World.js) - matched
 * against every placed structure's id prefix, never against the level name
 * (CO-7 do-not-list item 3: two structures may share one level def).
 * `structId` is carried on the selection itself so `frameFor` can resolve
 * the RIGHT placement's `Frame` even when two placements share one level.
 * @param {ReturnType<typeof createDoc>} doc
 * @param {import('../../engine/index.js').World} world
 * @param {string} entityId
 */
export function selectionFromEntityId(doc, world, entityId) {
  for (const s of world.structures) {
    const prefix = `${s.id}.`;
    if (entityId.startsWith(prefix)) {
      return { fileId: fileKey('level', s.level.name), collection: 'props', id: entityId.slice(prefix.length), structId: s.id };
    }
  }
  return { fileId: fileKey('world', doc.worldId), collection: 'entities', id: entityId, structId: null };
}

/**
 * Reverse of `selectionFromEntityId`: a selection item -> the runtime entity
 * id, or `null` for a content item with no entity (lights, interactables,
 * triggers - addressed by content id alone, 24.7). Prefers `item.structId`
 * (CO-7: by id, never by level name); falls back to the old level-name match
 * only for a caller that has not been updated to carry `structId` yet.
 * @param {import('../../engine/index.js').World} world
 * @param {{fileId:string, collection:string, id:string, structId?:string|null}} item
 */
export function selectionEntityId(world, item) {
  if (item.collection === 'props' && item.fileId.startsWith('level/')) {
    const s = item.structId != null
      ? world.structures.find((st) => st.id === item.structId)
      : world.structures.find((st) => st.level.name === item.fileId.slice('level/'.length));
    return s ? `${s.id}.${item.id}` : null;
  }
  if (item.fileId.startsWith('world/') && item.collection === 'entities') {
    return item.id;
  }
  return null;
}

/** The item's plain data object out of `doc` (property panel / highlight source), or `null`. */
export function selectionItemData(doc, item) {
  const file = doc.files.get(item.fileId);
  if (!file) return null;
  const arr = file.def[item.collection];
  if (!Array.isArray(arr)) return null;
  return arr.find((it) => it && it.id === item.id) || null;
}

/** The item's current array index in `doc` (for `EditRecord.index` - delete/undo, 24.8), or `-1`. */
export function selectionItemIndex(doc, item) {
  const file = doc.files.get(item.fileId);
  if (!file) return -1;
  const arr = file.def[item.collection];
  if (!Array.isArray(arr)) return -1;
  return arr.findIndex((it) => it && it.id === item.id);
}

/** Every collection this kind of file carries an id-collection for (24.7's outliner grouping). */
const OUTLINER_COLLECTIONS = { level: ['props', 'lights', 'interactables', 'triggers'], world: ['entities'] };

/**
 * Flat `{fileId, collection, id, item, structId}[]` for every content item in
 * `doc` (the outliner's DOM list, 24.7). `world` is optional (back-compat for
 * callers/tests that only need the content listing); when given, a level
 * file's items get the `structId` of the (first) structure placing that
 * level - CO-7's documented outliner limitation: the outliner lists one row
 * per CONTENT item (the level file is shared data), not one per placement,
 * so with two placements of one level both share a row and the row's
 * `structId` picks one of them (matches this file's pre-existing
 * `structureForFile`-by-level-name convention for that one UI list; viewport
 * picks/markers always resolve the exact placement instead, see pick.js).
 */
export function listOutlinerItems(doc, world) {
  const out = [];
  for (const file of doc.files.values()) {
    for (const coll of OUTLINER_COLLECTIONS[file.kind] || []) {
      for (const it of file.def[coll] || []) {
        if (it && it.id) {
          const struct = file.kind === 'level' && world ? world.structures.find((st) => st.level.name === file.id) : null;
          out.push({ fileId: fileKey(file.kind, file.id), collection: coll, id: it.id, item: it, structId: struct ? struct.id : null });
        }
      }
    }
  }
  return out;
}
