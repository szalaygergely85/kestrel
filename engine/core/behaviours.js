// Named behaviours (US-024, docs/architecture.md section 5): the game
// registers functions by name; content (interactables/triggers) refers to
// them by that name, so level/world data never imports game code (D-006 -
// "the engine has no idea what a tower, lantern or beacon is").
//
// BehaviourFn = (ctx: {world, engine, entity?, def}) => void

const registry = new Map();

export function registerBehaviour(name, fn) {
  registry.set(name, fn);
}

/** Test/editor support (US-010): drop one registration; unknown names are a no-op. */
export function unregisterBehaviour(name) {
  registry.delete(name);
}

export const registerInteraction = registerBehaviour; // D-006 wording
export const registerTrigger = registerBehaviour;

const warned = new Set();

/** @returns {Function|undefined} unknown name -> console.error once, no throw */
export function getBehaviour(name) {
  const fn = registry.get(name);
  if (!fn && !warned.has(name)) {
    warned.add(name);
    console.error(`[behaviours] unknown behaviour "${name}"`);
  }
  return fn;
}

/**
 * (US-010 tech note 2) Every behaviour NAME the placed structures' level
 * data refers to (`def.interactables[].interact`, `def.triggers[].trigger`)
 * that has no registration yet - unique, sorted. The engine never knows the
 * names themselves; it only checks that data and registrations agree.
 * `World.load` warns with this list once; `main.js` in `?strict=1` and the
 * tests throw on a non-empty result.
 * @param {{structures: Array<{level: {def?: Object}}>}} world
 * @returns {string[]}
 */
export function validateBehaviours(world) {
  const missing = new Set();
  for (const s of (world && world.structures) || []) {
    const def = s.level && s.level.def;
    if (!def) continue;
    for (const it of def.interactables || []) {
      if (typeof it.interact === 'string' && !registry.has(it.interact)) missing.add(it.interact);
    }
    for (const tr of def.triggers || []) {
      if (typeof tr.trigger === 'string' && !registry.has(tr.trigger)) missing.add(tr.trigger);
    }
  }
  return Array.from(missing).sort();
}
