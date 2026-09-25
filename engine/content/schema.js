// engine/content/schema.js (US-027a, docs/architecture.md section 21.1).
// Data tables only - no logic, no functions. Every other engine/content/*
// module reads these instead of hard-coding shapes twice.

/** Highest schema version this engine understands, per file kind. */
export const LATEST_SCHEMA = { manifest: 1, level: 1, world: 1 };

/** Envelope keys every content file carries (21.2), first in `KEY_ORDER`. */
export const ENVELOPE_KEYS = ['kind', 'schema', 'id', 'nextId'];

/**
 * Per-kind collections whose items need a unique `id` (21.3). A local id is
 * unique WITHIN one collection, not across the whole file (deviation from
 * the AC text - the tower reuses `brazier`/`lantern`/`beacon`/`lever`
 * across lights/props/interactables on purpose).
 */
export const ID_COLLECTIONS = {
  level: ['props', 'lights', 'interactables', 'triggers'],
  world: ['structures', 'entities', 'horizon'],
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
  manifest: [...ENVELOPE_KEYS, 'contentVersion', 'files'],
  level: [...ENVELOPE_KEYS, 'name', 'title', 'version', 'cellSize', 'size', 'rows', 'legend', 'layers', 'tilt', 'start', 'sun', 'ambient', 'lights', 'props', 'interactables', 'triggers', 'markers', 'route', 'routeNotes'],
  world: [...ENVELOPE_KEYS, 'name', 'version', 'title', 'terrain', 'time', 'structures', 'entities', 'horizon', 'state'],
};

/**
 * Object-valued fields that keep insertion order rather than being sorted
 * as a plain object's keys would be (21.6). Keyed by kind.
 */
export const ORDERED_MAPS = {
  level: ['legend', 'markers', 'layers', 'routeNotes'],
  world: ['state'],
};
