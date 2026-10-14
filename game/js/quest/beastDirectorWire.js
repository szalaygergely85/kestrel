// BEAST-WIRE-01 (D-083/D-087): wires BEAST-06a (spawnDirector + difficulty) into the running game.
// Builds the groups from generateRegionalBeasts output, respawns a dead group's members at home when the director says so,
// keeps state['beast.v1'] in world.state (the save blob already carries world.state) and owns the Settings difficulty applier.
import { buildGroups, createSpawnDirector } from './sim/spawnDirector.js';
import { applyDifficulty, resolveDifficulty } from './sim/difficulty.js';
import { setDifficultyApplier, difficultyName } from '../ui/difficultyFlag.js';

const EYE = 1.7, LOS_STEP = 4, SAVE_STEPS = 300;

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
 * o: { sim, members (generateRegionalBeasts output: {id,species,region,x,y,group}), seed, state (world.state), events, terrain,
 *      dayLenSec (the game's real day length), hfovRad?, los? }
 * Returns { dir, step(dt, px, py, fx, fy), save(), setDifficulty(name)->bool, dispose() }.
 */
export function createBeastDirectorWire(o) {
  const { sim, state } = o, ms = [];
  for (const m of o.members) { const slot = sim.slotOf(m.id); if (slot >= 0) ms.push({ ...m, kind: m.species, key: m.region, slot }); }
  const groups = buildGroups(ms, o.seed || 12, null), gOfSlot = Object.create(null);
  for (let g = 0; g < groups.length; g++) for (const s of groups[g].slots) gOfSlot[s] = g;
  const dir = createSpawnDirector({
    groups, dayLenSec: o.dayLenSec, viewHalfRad: o.hfovRad || 0.6, los: o.los || (o.terrain ? terrainLos(o.terrain) : null),
    onRespawn: (g, gr) => { for (const s of gr.slots) sim.respawnSlot(s); wire.save(); },
  });
  dir.setDifficulty(resolveDifficulty(difficultyName()));
  if (sim.tactics && sim.tactics.setDifficulty) applyDifficulty(sim, difficultyName(), dir);
  dir.load(state);
  const off = o.events ? o.events.on('beast:died', (p) => {
    const slot = p && sim.slotOf(p.id), g = slot >= 0 ? gOfSlot[slot] : undefined;
    if (g !== undefined) { dir.memberDied(g); wire.save(); }
  }) : null;
  let saveTick = 0;
  const wire = {
    dir, groups,
    step: (dt, px, py, fx, fy) => { dir.step(dt, px, py, fx, fy); if (++saveTick % SAVE_STEPS === 0) wire.save(); }, // t drifts <= 5 s between saves
    save: () => dir.save(state),
    setDifficulty: (name) => applyDifficulty(sim, name, dir),
    dispose() { if (typeof off === 'function') off(); setDifficultyApplier(null); },
  };
  setDifficultyApplier(wire.setDifficulty);
  return wire;
}
