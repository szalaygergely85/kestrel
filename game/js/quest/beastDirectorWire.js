// BEAST-WIRE-01 (D-083/D-087): wires BEAST-06a (spawnDirector + difficulty) into the running game.
// Builds the groups from generateRegionalBeasts output, respawns a dead group's members at home when the director says so,
// keeps state['beast.v1'] in world.state (the save blob already carries world.state) and owns the Settings difficulty applier.
import { buildGroups, createSpawnDirector, VIEW_MARGIN_RAD } from './sim/spawnDirector.js';
import { applyDifficulty, resolveDifficulty } from './sim/difficulty.js';
import { assignRoutes, walkableFor, regionRectOf, reachFor, createRouteFollower, isNightHour } from './beastRoutes.js'; // BEAST-07
import { setDifficultyApplier, difficultyName } from '../ui/difficultyFlag.js';

const EYE = 1.7, LOS_STEP = 4, SAVE_STEPS = 300;
const ENGAGED = new Set([2, 3, 4, 5, 18]); // STATE_CHASE/WINDUP/CHARGE/RECOVER/CIRCLE (beastSim.js)
/** Never-in-view cone cosine for a full horizontal fov (rad) + the director's margin; lives here so sim code stays Math.cos-free. */
export const viewCosFor = (hfovRad) => Math.cos(hfovRad / 2 + VIEW_MARGIN_RAD);
// TODO (BEAST-06b/c): switch to sim.engagedCount once beastSim has it.
function anyEngaged(sim) {
  if (typeof sim.engagedCount === 'number') return sim.engagedCount > 0;
  if (typeof sim.engagedCount === 'function') return sim.engagedCount() > 0;
  if (!sim.state) return false;
  for (let i = 0; i < sim.count; i++) if (ENGAGED.has(sim.state[i])) return true;
  return false;
}

/** Terrain line of sight (player eye -> point 1 m above home): false when the ground rises above the ray. */
export function terrainLos(terrain) {
  return (px, py, hx, hy) => {
    const dx = hx - px, dy = hy - py, n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / LOS_STEP));
    const z0 = terrain.heightAt(px, py) + EYE, z1 = terrain.heightAt(hx, hy) + 1;
    for (let i = 1; i < n; i++) { const t = i / n; if (terrain.heightAt(px + dx * t, py + dy * t) > z0 + (z1 - z0) * t) return false; }
    return true;
  };
}

/**
 * o: { sim, extraGroups? (POI-05b: ready groups; `park` groups respawn as parked and poiFights unparks them), members (generateRegionalBeasts output: {id,species,region,x,y,group}), seed, state (world.state), events, terrain,
 *      dayLenSec (the game's real day length), hfovRad? (full camera hfov, rad; default 1.2), los? }
 * Returns { dir, step(dt, px, py, fx, fy), save(), setDifficulty(name)->bool, dispose() }.
 */
export function createBeastDirectorWire(o) {
  const { sim, state } = o, ms = [];
  for (const m of o.members) { const slot = sim.slotOf(m.id); if (slot >= 0) ms.push({ ...m, kind: m.species, key: m.region, slot }); }
  const groups = buildGroups(ms, o.seed || 12, null).concat(o.extraGroups || []), gOfSlot = Object.create(null);
  for (let g = 0; g < groups.length; g++) for (const s of groups[g].slots) gOfSlot[s] = g;
  for (const gr of groups) if (gr.when === undefined && gr.members && gr.members[0] && gr.members[0].when) gr.when = gr.members[0].when; // BEAST-07: night set
  assignRoutes(groups, o.seed || 12, o.walkable || walkableFor(o.terrain), { rectOf: o.geo ? regionRectOf(o.geo) : null, reach: reachFor(o.nav) }); // BEAST-07b: clamp to the region rect + legs reachable on the real nav // BEAST-07: seeded walkable 3-6 waypoint loops
  const hourNow = () => (o.hour ? o.hour() : ((o.startHour === undefined ? 8 : o.startHour) + (dir.t / (o.dayLenSec || 1200)) * 24) % 24);
  const dir = createSpawnDirector({
    groups, dayLenSec: o.dayLenSec, viewCos: viewCosFor(o.hfovRad || 1.2), los: o.los || (o.terrain ? terrainLos(o.terrain) : null),
    onRespawn: (g, gr) => { if (gr.park || (gr.when === 'night' && !isNightHour(hourNow()))) { for (const s of gr.slots) sim.setDown(s, true); wire.save(); return; } for (const s of gr.slots) { if (sim.isDown && sim.isDown(s)) sim.setDown(s, false); else sim.respawnSlot(s); } wire.save(); },
  });
  const routes = createRouteFollower({ sim, groups, dir, hour: hourNow });
  dir.setDifficulty(resolveDifficulty(difficultyName()));
  if (sim.tactics && sim.tactics.setDifficulty) applyDifficulty(sim, difficultyName(), dir);
  dir.load(state);
  // dead groups stay dead after a load and after resetAll (travel/Unstuck): park their members until the timer says so
  const keepDown = () => { if (!sim.setDown) return; for (let g = 0; g < groups.length; g++) if (dir.dead[g]) for (const s of groups[g].slots) sim.setDown(s, true); };
  keepDown(); routes.init();
  const offReset = o.events ? o.events.on('beasts:reset', keepDown) : null;
  const off = o.events ? o.events.on('beast:died', (p) => {
    const slot = p && sim.slotOf(p.id), g = slot >= 0 ? gOfSlot[slot] : undefined;
    if (g !== undefined) { dir.memberDied(g); wire.save(); }
  }) : null;
  let saveTick = 0;
  const wire = {
    dir, groups, routes,
    step: (dt, px, py, fx, fy) => { dir.step(dt, px, py, fx, fy); routes.step(px, py, fx, fy); if (++saveTick % SAVE_STEPS === 0) wire.save(); }, // t drifts <= 5 s between saves
    save: () => dir.save(state),
    setDifficulty: (name) => (anyEngaged(sim) ? false : applyDifficulty(sim, name, dir)), // refused while ANY slot is engaged
    setHfov: (rad) => { dir.viewCos = viewCosFor(rad); },
    dispose() { if (typeof off === 'function') off(); if (typeof offReset === 'function') offReset(); setDifficultyApplier(null); },
  };
  setDifficultyApplier(wire.setDifficulty);
  return wire;
}
