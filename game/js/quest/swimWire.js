// game/js/quest/swimWire.js (SWIM-03c, docs/architecture.md 38.54, D-070): the small main.js glue for swimming.
// Per step: wading.before(p, other) -> wire.before(p) (= swimFeed.feed) -> integrate. While `body.swimming` the hands gate is shut
// (hands.step(.., gate=false) disarms: no swing / bow / shield) and the gear views are hidden by the render code via `wire.active`.
import { createSwimFeed } from './sim/swimFeed.js';
import { createSwimVitals } from './swimVitals.js';
import { createSeaMonster } from './seaMonster.js';

/** Clip names for the player body while swimming. Placeholder: the idle clip until the designer's swim/tread clips land. */
export const SWIM_CLIPS = Object.freeze({ swim: 'idle', tread: 'idle' });

export function createSwimWire(world) {
  const feed = createSwimFeed(world);
  const wa = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 }, sp = { x: 0, y: 0, swimming: false, inSea: false, surfaceZ: 0 };
  return {
    feed, vitals: null, monster: null,
    /** SWIM-HOOKS-01: after createVitals. opts = { shore (createShore(coast), null = no monster), ripples, ent (monster entity data or null), seaTest(x,y) optional } */
    bindVitals(vitals, opts = {}) {
      this.vitals = createSwimVitals(vitals);
      this.monster = opts.shore ? createSeaMonster(vitals, opts.shore, { ent: opts.ent || null, ripples: opts.ripples || null }) : null;
      this.seaTest = opts.seaTest || null;
    },
    /** Once per fixed step after integrate: stamina/drown + sea monster. */
    afterStep(entity, simTime) {
      const b = entity.components.body, t = entity.transform;
      if (this.vitals) this.vitals.step(b, 1 / 60);
      if (!this.monster) return;
      const wet = !!world.waterAt(t.x, t.y, wa);
      sp.x = t.x; sp.y = t.y; sp.swimming = !!b.swimming; sp.surfaceZ = wet ? wa.surfaceZ : t.z;
      sp.inSea = this.seaTest ? this.seaTest(t.x, t.y, wet ? wa.region : '') : (wet && wa.region === 'sea');
      this.monster.step(sp, simTime);
    },
    /** Next to drawVitals. */
    draw(ui, style, entity, simTime) { if (this.vitals) this.vitals.draw(ui, style, entity.components.body, simTime); },
    /** Respawn / world load. */
    reset() { if (this.vitals) this.vitals.reset(); if (this.monster) this.monster.reset(); },
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
