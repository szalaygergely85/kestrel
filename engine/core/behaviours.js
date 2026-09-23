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
