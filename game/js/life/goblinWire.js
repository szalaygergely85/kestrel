// game/js/life/goblinWire.js (GOB-07a, architecture.md 38.57 GOB-07): one helper that bundles the goblin game wiring so main.js
// (GOB-07b) is a few lines:
//   const gw = createGoblinWire({ world, events, state, json, terrain, groundAt, nav? });   // BEFORE createBeastSim (adds the members)
//   const sim = createBeastSim(world, {...});
//   gw.attach(sim, { onClank });          // camps + enemy spear sim + spear view + listeners
//   createLifeWire({ ..., campDefs: gw.campDefs });
//   per sim step:  gw.step(dayIndex, px, py);     per frame: gw.update();     on exit: gw.dispose();
// Presentation + wiring only; the sims it drives are GOB-01..04 (no new behaviour).
import { activeCamps, ensureGoblinCamps, createGoblinCamps } from './goblinCamps.js';
import { createArrowSim, createPlayerTarget, lobVelocity } from '../quest/sim/arrows.js';
import { GOBLIN_SPEAR_CFG } from '../quest/bowConfig.js';
import { createSpearView } from '../quest/spearView.js';

const _lob = { vx: 0, vy: 0, vz: 0 };

/**
 * @param {{world:any, events:any, state:object, json:object, terrain?:any, groundAt?:(x:number,y:number)=>number}} o
 *   json = content/life/goblinCamps.json (parsed). `state` = world.state (the saved camp keys live there).
 */
export function createGoblinWire({ world, events, state, json, terrain, groundAt }) {
  const campDefs = activeCamps(json);
  const added = ensureGoblinCamps(world, campDefs, terrain);
  let allDefs = campDefs; // authored camps; WMP-02 far camps are appended by addFarCamps (after the regional beasts, so their slots come last)
  let camps = null, spears = null, view = null, offThrow = null, offBlocked = null;
  const gw = {
    campDefs, added,
    /** WMP-02: far camps (farCamps.generateFarCamps); call after bootRegionalBeasts and BEFORE createBeastSim. campDefs (raids) stays authored-only. */
    addFarCamps(farDefs) { if (!farDefs || !farDefs.length) return 0; allDefs = campDefs.concat(farDefs); const n = ensureGoblinCamps(world, farDefs, terrain); gw.added += n; return n; },
    get camps() { return camps; }, get spears() { return spears; }, get view() { return view; },
    /** after createBeastSim(world, ...) */
    attach(sim, opts = {}) {
      camps = createGoblinCamps({ defs: allDefs, sim, events, state });
      spears = createArrowSim(world, events, GOBLIN_SPEAR_CFG, createPlayerTarget(world), null, { owner: 'enemy' });
      view = createSpearView({ world, sim: spears, groundAt: groundAt || (terrain && terrain.groundAt ? (x, y) => terrain.groundAt(x, y) : undefined) });
      const g = GOBLIN_SPEAR_CFG.g, sp = GOBLIN_SPEAR_CFG.speedH;
      offThrow = events.on('beast:throw', (p) => { // payload is reused by the sim: read the numbers now
        lobVelocity(p.x, p.y, p.z, p.tx, p.ty, p.tz, sp, g, _lob);
        spears.fireVel(p.x, p.y, p.z, _lob.vx, _lob.vy, _lob.vz, 1, p.id);
      });
      offBlocked = events.on('beast:spearBlocked', (p) => {
        if (opts.onClank) opts.onClank(p);
        events.emit('spear:clank', p);
      });
      return gw;
    },
    /** once per sim step */
    step(dayIndex, px, py) {
      if (!camps) return;
      camps.step(dayIndex, px, py);
      spears.step();
    },
    /** once per frame, after the step */
    update() { if (view) view.update(); },
    dispose() {
      if (offThrow) offThrow(); if (offBlocked) offBlocked();
      if (camps) camps.dispose(); if (view) view.dispose();
      camps = spears = view = offThrow = offBlocked = null;
    },
  };
  return gw;
}
