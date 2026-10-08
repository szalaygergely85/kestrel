// engine/content/schema.js (US-027a, docs/architecture.md section 21.1).
// Data tables only - no logic, no functions. Every other engine/content/*
// module reads these instead of hard-coding shapes twice.

/** Highest schema version this engine understands, per file kind. */
export const LATEST_SCHEMA = { manifest: 1, level: 1, world: 1, mesh: 1, terrainEdits: 1, mask: 1 };

/** Envelope keys every content file carries (21.2), first in `KEY_ORDER`. */
export const ENVELOPE_KEYS = ['kind', 'schema', 'id', 'nextId'];

/**
 * Per-kind collections whose items need a unique `id` (21.3). A local id is
 * unique WITHIN one collection, not across the whole file (deviation from
 * the AC text - the tower reuses `brazier`/`lantern`/`beacon`/`lever`
 * across lights/props/interactables on purpose).
 */
export const ID_COLLECTIONS = {
  mesh: [],
  terrainEdits: [],
  level: ['props', 'lights', 'interactables', 'triggers'],
  // US-026a (architecture.md 23.2/23.7 S2): world-level triggers (circle/
  // terrain/bounds shapes, `structId: null`) are their own id collection,
  // same convention as a level's `triggers`.
  world: ['structures', 'entities', 'horizon', 'triggers'],
};

/**
 * Reference fields the loader resolves inside the SAME file (21.3). Cross-
 * file references (`structures[].level`, `world.terrain`) are checked later
 * by `World.load`/`AssetRegistry`, which already throw on a missing name.
 */
export const REF_FIELDS = {
  level: [
    { field: 'interactables[].prop', collection: 'props' },
    { field: 'interactables[].light', collection: 'lights' },
    { field: 'interactables[].flameProp', collection: 'props' },
  ],
  world: [
    { field: 'entities[].spawn.structure', collection: 'structures' },
  ],
};

/**
 * Canonical top-level key order per kind (21.6), for `stringify.js`.
 * `ENVELOPE_KEYS` always comes first; these are the item-2 keys that follow
 * it, in order. Any other key present in the object is unknown and sorted
 * alphabetically after these.
 */
export const KEY_ORDER = {
  manifest: [...ENVELOPE_KEYS, 'contentVersion', 'files', 'masks'],
  // ALPHA-01a (37.17): alpha mask file (no nextId, no id collections)
  mask: ['kind', 'schema', 'id', 'w', 'h', 'cutoffDefault', 'data'],
  mesh: [...ENVELOPE_KEYS, 'version', 'layout', 'bin', 'pos', 'uv', 'uvMask', 'nrm', 'flat', 'aux', 'idx', 'triCount', 'bbox', 'ranges', 'matKeys', 'mats', 'matsResolved', 'meshVersion', 'collide', 'collider', 'colliderB64', 'castShadow', 'colliderParts'],
  level: [...ENVELOPE_KEYS, 'name', 'title', 'version', 'cellSize', 'size', 'rows', 'legend', 'layers', 'tilt', 'start', 'sun', 'ambient', 'lights', 'props', 'interactables', 'triggers', 'markers', 'route', 'routeNotes'],
  // US-026a (architecture.md 23.2): `bounds`/`triggers` are additive
  // optional keys - schema stays 1, a world file without them still loads.
  // CO-8 (docs/coordinates.md section 8): `sun` is a world property (moved
  // out of the level file in this same content commit) - additive, schema
  // stays 1.
  world: [...ENVELOPE_KEYS, 'name', 'version', 'title', 'terrain', 'time', 'sun', 'structures', 'entities', 'horizon', 'state', 'bounds', 'triggers'],
  // CO-5 (docs/coordinates.md section 8): `WorldState` (engine/world/
  // serialize.js), not a content file - `stringifySave` tags it
  // `kind: 'save'` only to select this order, it is not an envelope key.
  // RE-11b (architecture.md 28.3): `visibility` is additive/optional, same
  // treatment as `horizon`/`bounds`/`triggers` above it - listed explicitly
  // (not left to the alphabetical "rest" fallback) so its position stays a
  // deliberate choice rather than an accident of where "visibility" sorts.
  // ED-TERRAIN-1a (arch 37.12): no nextId/collections (a sparse grid, not an id-bearing file).
  terrainEdits: ['kind', 'schema', 'id', 'cell', 'chunkSize', 'chunks'],
  save: ['kind', 'version', 'world', 'contentVersion', 'terrain', 'structures', 'entities', 'state', 'nextId', 'time', 'removed', 'horizon', 'bounds', 'triggers', 'visibility'],
};

/**
 * Object-valued fields that keep insertion order rather than being sorted
 * as a plain object's keys would be (21.6). Keyed by kind.
 */
export const ORDERED_MAPS = {
  level: ['legend', 'markers', 'layers', 'routeNotes'],
  world: ['state'],
  save: ['state'],
};
