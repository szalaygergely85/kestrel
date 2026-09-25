// engine/world/serialize.js (US-025, docs/architecture.md section 10).
// `serialize(world)` -> JSON-safe `WorldState`; `deserialize(state, assets,
// opts?)` -> a brand-new `World` (old handles report `alive === false` -
// D-006: class instances are rebuilt from content by key, never stored).
import { World } from './World.js';

const VERSION = 1;

// Item 5c (architect review #1): `integrate.js`'s `ensureScratch` stashes
// per-body scratch (`_move`, `_collideOpts`) directly on `components.body`
// (architecture.md 9: no per-step allocation) - harmless in memory, but it
// must not travel into a saved file. Strips any key starting with `_`, at
// every level of a (already-cloned) components tree, rather than naming
// `body._move`/`_collideOpts` specifically, so a future scratch field is
// covered by the same convention automatically.
function stripScratch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = {};
  for (const k of Object.keys(value)) {
    if (k.charCodeAt(0) === 95 /* '_' */) continue;
    out[k] = stripScratch(value[k]);
  }
  return out;
}

/** @returns {Object} JSON-safe WorldState (docs/architecture.md section 10) */
export function serialize(world) {
  // US-027a (architecture.md 21.8): additive only, and only written when
  // the world came from content (`contentVersion != null`) - a save built
  // with `fromGlobals` assets (or the `R` restart state) stays byte-
  // identical to before this story.
  const fromContent = world.contentVersion != null;
  const contentIds = world._contentIds || new Set();

  return {
    version: VERSION,
    world: (world.def && world.def.name) || null,
    terrain: world.terrain ? {
      recipe: world.terrainKey,
      seed: world.terrain.recipe.seed,
      overrides: structuredClone(world.terrain.recipe.overrides || {}),
    } : null,
    // US-016 (architecture.md 14.4 item 13): content, not state, but still
    // round-tripped (never mutated at runtime, so this is a pure copy).
    horizon: structuredClone(world.horizon || []),
    // US-026a (23.2, 23.7 S2): same "content, not state" treatment -
    // `world.bounds` is already a plain validated copy; `world.def.triggers`
    // is the world-level trigger DEFS (buildTriggers reads them fresh on
    // every load, same as a structure's `def.triggers`).
    bounds: world.bounds ? { ...world.bounds } : null,
    triggers: structuredClone((world.def && world.def.triggers) || []),
    structures: world.structures.map((s) => ({
      id: s.id,
      level: s.level.name,
      origin: { x: s.origin.x, y: s.origin.y, z: s.origin.z },
      yawSteps: s.yawSteps,
      dynamics: structuredClone(s.dynamics || {}),
    })),
    entities: Array.from(world._entities.values()).map((e) => {
      const out = {
        id: e.id,
        type: e.type,
        transform: { x: e.transform.x, y: e.transform.y, z: e.transform.z, yawDeg: e.transform.yawDeg, pitchDeg: e.transform.pitchDeg },
        components: stripScratch(structuredClone(e.components)),
      };
      if (fromContent && contentIds.has(e.id)) out.fromContent = true;
      return out;
    }),
    state: structuredClone(world.state),
    nextId: world.nextId,
    time: { timeOfDay: (world.def && world.def.time) || null },
    ...(fromContent ? {
      contentVersion: world.contentVersion,
      removed: Array.from(world._removedContent || []).sort(),
    } : {}),
  };
}

/**
 * @param {Object} state - a `WorldState` (typically round-tripped through JSON).
 * @param {import('../core/assets.js').AssetRegistry} assets
 * @param {{events?: import('../core/events.js').Events}} [opts]
 * @returns {World}
 */
export function deserialize(state, assets, opts = {}) {
  if (state.version !== VERSION) {
    throw new Error(`deserialize: unknown WorldState version ${state.version} (expected ${VERSION})`);
  }

  // US-027a (architecture.md 21.8): the content-id migration only applies
  // to a save that was itself content-backed, against a registry that
  // still knows this world (an ephemeral/JS-only world, or one dropped
  // from content entirely, loads exactly as before this story).
  const useContentRule = state.contentVersion != null && assets && typeof assets.has === 'function' && assets.has('world', state.world);
  let keptSavedEntities = state.entities; // state shape: {id,type,transform,components,fromContent?}
  let appendedContentEntities = []; // raw content shape (may use x/y/z or spawn, not transform)
  const removedSet = new Set(state.removed || []);

  if (useContentRule) {
    if (state.contentVersion !== assets.contentVersion) {
      console.info(`[World] deserialize: content version changed (${state.contentVersion} -> ${assets.contentVersion}) for world "${state.world}"`);
    }

    // Canonical content id set, per the SAME rule `World.load` uses (21.8):
    // level props (by placement) + this world's own `entities[].id`, read
    // from `assets`, never from `state` (a stale save must not decide
    // what's "current content").
    const currentContentIds = new Set();
    for (const s of state.structures) {
      if (!assets.has('level', s.level)) continue;
      for (const p of assets.level(s.level).props || []) {
        if (typeof p.model === 'string' && p.model.indexOf('decal:') === 0) continue;
        if (p.from || p.to) continue;
        currentContentIds.add(`${s.id}.${p.id}`);
      }
    }
    for (const ce of assets.world(state.world).entities || []) {
      if (ce && ce.id) currentContentIds.add(ce.id);
    }

    // Rule 1: drop a saved `fromContent` entity whose id is no longer
    // current content, warning ONCE for the whole load.
    const dropped = [];
    keptSavedEntities = state.entities.filter((e) => {
      if (e.fromContent && !currentContentIds.has(e.id)) { dropped.push(e.id); return false; }
      return true; // rule 3: a runtime-spawned entity (no fromContent) is always kept
    });
    if (dropped.length) {
      console.warn(`[World] deserialize: dropped ${dropped.length} saved entit${dropped.length === 1 ? 'y' : 'ies'} no longer in content: ${dropped.slice(0, 5).join(', ')}`);
    }

    // Rule 2: a content id missing from the save and not `removed` spawns
    // from content. Props are handled by `World.load`'s own spawn loop
    // (via `opts.skipIds` below - it already skips ids present in
    // `def.entities`/saved); world entities need appending here, in their
    // ORIGINAL content shape (World.load's entities loop already knows how
    // to read `spawn`/inline x,y,z/`transform`), since re-mapping them to
    // the saved-entity shape below would drop those fields.
    const keptIds = new Set(keptSavedEntities.map((e) => e.id));
    for (const ce of assets.world(state.world).entities || []) {
      if (!ce || !ce.id) continue;
      if (keptIds.has(ce.id) || removedSet.has(ce.id)) continue;
      appendedContentEntities.push(ce);
    }
  }

  const def = {
    name: state.world,
    terrain: state.terrain ? state.terrain.recipe : null,
    horizon: state.horizon || [],
    bounds: state.bounds || null,
    triggers: state.triggers || [],
    time: state.time && state.time.timeOfDay,
    structures: state.structures.map((s) => ({ id: s.id, level: s.level, origin: s.origin, yawSteps: s.yawSteps })),
    entities: [
      ...keptSavedEntities.map((e) => ({ id: e.id, type: e.type, transform: e.transform, components: e.components })),
      ...appendedContentEntities,
    ],
    state: state.state,
  };

  const world = World.load(def, assets, { ...opts, skipIds: useContentRule ? removedSet : opts.skipIds });
  if (useContentRule) world._removedContent = new Set(removedSet);

  // Re-apply dynamics AFTER load (World.load's own structures[].dynamics
  // handling already does this from `def.structures[i].dynamics`, but that
  // field isn't part of `def` above - restated explicitly here so
  // deserialize doesn't depend on that undocumented side channel). Restores
  // `target`/`delay` too (US-014 tech note 6), not just `t`, so a save mid-
  // open resumes and finishes exactly like an uninterrupted run.
  for (const s of state.structures) {
    if (!s.dynamics) continue;
    const placed = world.structures.find((p) => p.id === s.id);
    if (!placed) continue;
    for (const tag of Object.keys(s.dynamics)) {
      world._restoreDynamics(placed, tag, s.dynamics[tag]);
    }
  }

  // Terrain overrides: copied into the def's recipe already carries the
  // asset's own baked-in overrides; a future editor mutating them per-save
  // is a US-016b/M5 extension (Terrain.applyOverride) - out of scope here,
  // the round trip only needs the copy itself to be independent of the
  // source (already true: `structuredClone` in `serialize`).

  world.nextId = state.nextId;
  return world;
}
