// engine/world/migrateState.js (CO-5, docs/coordinates.md section 8).
// Pure `WorldState` schema migration - same shape as `content/migrate.js`'s
// `migrateContent`: a `MIGRATIONS` chain, `structuredClone` once, an older
// version is migrated step by step, a newer/unknown one throws a clear
// error rather than a silent best-effort pass.

/** Highest `WorldState.version` this engine writes/understands. */
export const LATEST_VERSION = 2;

/**
 * Best-effort `parent` for an entity id, from the `<structId>.` id-prefix
 * convention against a save's own `structures[]` list (coordinates.md
 * section 8: "add `parent` (from the `<structId>.` id prefix against
 * `structures[]`)"). This is a save-format RECORD, not a live coordinate
 * frame decision (do-not list item 2 is about frames) - CO-2 has not yet
 * given entities a tracked `parent` at runtime, so both the v1->v2
 * migration below and `serialize()` itself use this same heuristic until
 * it does; CO-2 does not need to touch this file when it lands.
 * @param {string} id
 * @param {Array<{id:string}>} structures
 * @returns {string|null}
 */
export function parentFromId(id, structures) {
  const dot = typeof id === 'string' ? id.indexOf('.') : -1;
  if (dot <= 0) return null;
  const prefix = id.slice(0, dot);
  return (structures || []).some((s) => s.id === prefix) ? prefix : null;
}

/** Entry `i` takes a `WorldState` at version `i+1` and returns one at `i+2`. */
export const MIGRATIONS = [
  // v1 -> v2: world coordinates only (already true of v1 - nothing to
  // convert there) + add `entities[].parent`.
  (state) => {
    const structIds = state.structures || [];
    state.entities = (state.entities || []).map((e) => ({
      ...e,
      parent: parentFromId(e.id, structIds),
    }));
    return state;
  },
];

/**
 * @param {Object} state - a `WorldState`, any version this chain covers.
 * @param {{migrations?: Array<Function>, latest?: number}} [opts]
 * @returns {Object} a `WorldState` at `opts.latest` (default `LATEST_VERSION`)
 */
export function migrateState(state, opts = {}) {
  const migrations = opts.migrations || MIGRATIONS;
  const target = opts.latest || LATEST_VERSION;
  const version = state && state.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(`migrateState: invalid WorldState version ${JSON.stringify(version)}`);
  }
  if (version > target) {
    throw new Error(`migrateState: WorldState version ${version} is newer than this engine supports (max ${target})`);
  }
  if (version === target) return state;

  let cur = structuredClone(state);
  for (let v = version; v < target; v++) {
    const step = migrations[v - 1];
    if (typeof step !== 'function') {
      throw new Error(`migrateState: no migration from WorldState version ${v} to ${v + 1}`);
    }
    cur = step(cur);
  }
  cur.version = target;
  return cur;
}
