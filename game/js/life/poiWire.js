// game/js/life/poiWire.js (POI-02, OB-141, D-088): puts the generated POIs (poiSites.js) into the live world and remembers their state.
//   const pw = createPoiWire({ world, defs, state: world.state, terrain });   per sim step: pw.step(px, py, dayIndex);   on exit: pw.dispose();
// - Dormancy (farCamps rule): a POI's props exist only while the player is within ACTIVE_R m (hysteresis +20 m); outside they are removed.
// - Save (`state['poi.v1']`, plain JSON in the world state the save relay already persists): per POI {done, guardianDead, fightClearedAtDay}.
//   done = chest opened / note read (never resets). guardianDead = the chest guard / alpha (never respawns).
//   fightClearedAtDay = the small fight (boar group, mini camp) was cleared that in-game day; it is active again after RESPAWN_DAYS (camp rule).
// - No discovery counter and no totals anywhere (D-088).
import { forwardOf } from '../../../engine/index.js';
import { generatePois, authoredPoints } from './poiSites.js';
import { CHEST_DEFAULTS as C } from '../quest/sim/lootConfig.js';

export const ACTIVE_R = 200, HYST = 20, RESPAWN_DAYS = 3, SAVE_KEY = 'poi.v1';

export function propId(def, k) { return `${def.id}.p${k}`; }

/** Entity records for one POI's props (pure). `chestDone` shows the chest open. */
export function propEntities(def, groundAt, chestDone) {
  const out = [];
  def.props.forEach((p, k) => {
    const x = def.at[0] + p.at[0], y = def.at[1] + p.at[1], z = groundAt ? groundAt(x, y) : 0;
    const components = {};
    if (p.model) components.voxel = { model: p.model, anim: p.chest && chestDone ? 'opened' : p.anim || 'idle', loop: !p.chest };
    if (p.light) { components.light = { offset: { down: -0.7 }, on: true, preset: p.light }; }
    if (p.smoke) components.emitters = [{ offset: { up: 0.5 }, on: true, preset: p.smoke }];
    out.push({ id: propId(def, k), type: 'prop', transform: { x, y, z, yaw: p.chest ? 180 : 0 }, components });
  });
  return out;
}

/**
 * @param {{world:{addEntity:Function, removeEntity:Function}, defs:any[], state:object, terrain?:{groundAt:Function}}} o
 */
export function createPoiWire({ world, defs, state, terrain }) {
  const saved = (state[SAVE_KEY] && typeof state[SAVE_KEY] === 'object') ? state[SAVE_KEY] : (state[SAVE_KEY] = {});
  const live = new Set(); // POI ids whose props exist now
  const byId = new Map(defs.map((d) => [d.id, d]));
  const groundAt = terrain && terrain.groundAt ? (x, y) => terrain.groundAt(x, y) : null;
  const rec = (id) => saved[id] || (saved[id] = { done: false, guardianDead: false, fightClearedAtDay: -1 });
  const activate = (d) => { for (const e of propEntities(d, groundAt, !!(saved[d.id] && saved[d.id].done))) world.addEntity(e); live.add(d.id); };
  const deactivate = (d) => { d.props.forEach((p, k) => world.removeEntity(propId(d, k))); live.delete(d.id); };
  const pw = {
    defs,
    /** Call per sim step (cheap: one distance test per POI). Returns the number of live POIs. */
    step(px, py) {
      for (const d of defs) {
        const dist = Math.hypot(d.at[0] - px, d.at[1] - py), on = live.has(d.id);
        if (!on && dist <= ACTIVE_R) activate(d);
        else if (on && dist > ACTIVE_R + HYST) deactivate(d);
      }
      return live.size;
    },
    isLive(id) { return live.has(id); },
    get liveCount() { return live.size; },
    isDone(id) { return !!(saved[id] && saved[id].done); },
    markDone(id) { if (byId.has(id)) rec(id).done = true; },
    guardianDead(id) { return !!(saved[id] && saved[id].guardianDead); },
    markGuardianDead(id) { if (byId.has(id)) rec(id).guardianDead = true; },
    /** The small fight at this POI is on: never cleared, or cleared long enough ago (guardians never come back). */
    fightActive(id, day) {
      const d = byId.get(id), r = saved[id];
      if (!d || !d.fight) return false;
      if (r && r.guardianDead) return false;
      if (!r || r.fightClearedAtDay < 0) return true;
      return day - r.fightClearedAtDay >= RESPAWN_DAYS;
    },
    markFightCleared(id, day) { if (byId.has(id)) rec(id).fightClearedAtDay = day; },
    /** Chest defs (chestDefs.js shape) for every POI chest prop, for the chest hook. */
    chestDefs() {
      const out = [], f = [0, 0];
      for (const d of defs) {
        d.props.forEach((p, k) => {
          if (!p.chest) return;
          const x = d.at[0] + p.at[0], y = d.at[1] + p.at[1];
          forwardOf(180, f);
          out.push({ id: propId(d, k), x, y, z: groundAt ? groundAt(x, y) : 0, frontX: f[0], frontY: f[1], propId: propId(d, k), needsBottom: false,
            interact: { radius: C.radius, facingDeg: C.facingDeg, facingCos: C.facingCos }, table: d.table });
        });
      }
      return out;
    },
    dispose() { for (const d of defs) if (live.has(d.id)) deactivate(d); },
  };
  return pw;
}

/** main.js helper: generate the POIs for a loaded world and wire them (null when the world has no geo / terrain grid). */
export function bootPoiWire(world, geo, worldDef, seed = 12) {
  if (!geo || !world.terrain) return null;
  const defs = generatePois({ geo, terrain: world.terrain, seed, avoid: authoredPoints(worldDef.entities) });
  return defs.length ? createPoiWire({ world, defs, state: world.state, terrain: world.terrain }) : null;
}
