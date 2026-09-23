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
  return {
    version: VERSION,
    world: (world.def && world.def.name) || null,
    terrain: world.terrain ? {
      recipe: world.terrainKey,
      seed: world.terrain.recipe.seed,
      overrides: structuredClone(world.terrain.recipe.overrides || {}),
    } : null,
    structures: world.structures.map((s) => ({
      id: s.id,
      level: s.level.name,
      origin: { x: s.origin.x, y: s.origin.y, z: s.origin.z },
      yawSteps: s.yawSteps,
      dynamics: structuredClone(s.dynamics || {}),
    })),
    entities: Array.from(world._entities.values()).map((e) => ({
      id: e.id,
      type: e.type,
      transform: { x: e.transform.x, y: e.transform.y, z: e.transform.z, yawDeg: e.transform.yawDeg, pitchDeg: e.transform.pitchDeg },
      components: stripScratch(structuredClone(e.components)),
    })),
    state: structuredClone(world.state),
    nextId: world.nextId,
    time: { timeOfDay: (world.def && world.def.time) || null },
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

  const def = {
    name: state.world,
    terrain: state.terrain ? state.terrain.recipe : null,
    time: state.time && state.time.timeOfDay,
    structures: state.structures.map((s) => ({ id: s.id, level: s.level, origin: s.origin, yawSteps: s.yawSteps })),
    entities: state.entities.map((e) => ({ id: e.id, type: e.type, transform: e.transform, components: e.components })),
    state: state.state,
  };

  const world = World.load(def, assets, opts);

  // Re-apply dynamics AFTER load (World.load's own structures[].dynamics
  // handling already does this from `def.structures[i].dynamics`, but that
  // field isn't part of `def` above - restated explicitly here so
  // deserialize doesn't depend on that undocumented side channel).
  for (const s of state.structures) {
    if (!s.dynamics) continue;
    for (const tag of Object.keys(s.dynamics)) {
      const d = s.dynamics[tag];
      if (typeof d.t === 'number') world.animateSector(tag, d.t);
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
