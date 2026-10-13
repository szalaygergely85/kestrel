// game/js/quest/swimWire.js (SWIM-03c, docs/architecture.md 38.54, D-070): the small main.js glue for swimming.
// Per step: wading.before(p, other) -> wire.before(p) (= swimFeed.feed) -> integrate. While `body.swimming` the hands gate is shut
// (hands.step(.., gate=false) disarms: no swing / bow / shield) and the gear views are hidden by the render code via `wire.active`.
import { createSwimFeed } from './sim/swimFeed.js';

/** Clip names for the player body while swimming. Placeholder: the idle clip until the designer's swim/tread clips land. */
export const SWIM_CLIPS = Object.freeze({ swim: 'idle', tread: 'idle' });

export function createSwimWire(world) {
  const feed = createSwimFeed(world);
  return {
    feed,
    /** Feed the water into the body (before integrate). */
    before(entity) { feed.feed(entity); },
    /** True while the player swims (gear stowed). */
    active(entity) { return !!(entity && entity.components.body && entity.components.body.swimming); },
    /** Hands gate: the caller's gate AND not swimming. */
    gate(open, entity) { return open && !this.active(entity); },
    /** Clip for the swim state: moving = swim, still = tread (both idle for now). */
    clipFor(entity, moving) { return moving ? SWIM_CLIPS.swim : SWIM_CLIPS.tread; },
  };
}
