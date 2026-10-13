// game/js/quest/sim/goblinBrain.js (GOB-01, D-072, architecture.md 38.57). Goblin numbers + helpers for the beast sim.
// A goblin is a beast entity (brain.kind 'beast', brain.species 'goblin', brain.role 'melee' | 'thrower'). beastSim runs
// the wolf pack logic for melee goblins (circle at 3-5 m while waiting, retreat after the strike) with 2 attack tokens
// per group. Mapping: chase -> windup (= the 0.5 s raise, clip `attack`) -> charge (= the 2.5 m LUNGE, 0.3 s) ->
// recover (= RETREAT 3 m). A damaging hit also enters the retreat. A lone goblin under 30 % HP flees 20 m.
// Rule 15 (sim/**): no Math.random, no trig, no clock.
import { BEAST_DEFAULTS } from './beastConfig.js';

export const GOBLIN_MODEL = 'goblin';
export const GOBLIN_TORCH_MODEL = 'goblinTorch';

export const GOBLIN_TUNING = Object.freeze({
  hpMul: 0.6,        // HP 0.6x boar (before the band-tier multiplier)
  chaseMul: 1.15,    // run speed vs the boar
  walk: 1.6,         // m/s wander
  noticeR: 16,
  leashR: 25,        // default camp leash (brain.leashR overrides per camp)
  windupSec: 0.5,    // telegraph: the raise
  windupR: 3.5,      // m, the strike starts inside this
  lungeM: 2.5, lungeSec: 0.3, // charge = lunge distance / duration
  retreatM: 3,       // m, retreat waypoint distance after a strike or a hit
  retreatSec: 0.6,   // s of retreat (about 3 m at the run speed)
  circleMin: 3, circleMax: 5, circleSpeedMul: 0.7,
  fleeHpFrac: 0.3,   // a LONE goblin below this share of max HP flees
  fleeM: 20,
  packR: 25,         // m, another living goblin within this = "not lone"
  tokens: 2,         // melee goblins that may be in WINDUP/CHARGE at once, per group
});

/** Per-slot cfg overrides for a goblin (merged over the boar defaults at createBeastSim). */
export function goblinOverrides(base = BEAST_DEFAULTS) {
  const T = GOBLIN_TUNING;
  return {
    hp: Math.max(1, Math.round(base.hp * T.hpMul)),
    chase: base.chase * T.chaseMul,
    walk: T.walk,
    noticeR: T.noticeR, leashR: T.leashR,
    windupR: T.windupR, windupSec: T.windupSec,
    charge: T.lungeM / T.lungeSec,
    chargeMaxSec: T.lungeSec,
    recoverSec: T.retreatSec,
    recoverWallSec: T.retreatSec,
  };
}

export function isGoblinEntity(e) {
  return !!(e && e.components && e.components.brain && e.components.brain.species === 'goblin');
}

/** World helper (call BEFORE createBeastSim): turns anchor entities into goblin beasts. Returns the number converted. */
export function ensureGoblins(world, ids = []) {
  let n = 0;
  for (const id of ids) {
    const e = world.entity ? world.entity(id) : null;
    if (!e) continue;
    const c = e.components || (e.components = {});
    const t = e.transform;
    c.brain = { role: 'melee', ...(c.brain || {}), kind: 'beast', species: 'goblin', home: (c.brain && c.brain.home) || [t.x, t.y] };
    c.targetable = c.targetable || { height: 1.0, radius: 0.4 };
    c.voxel = { t: 0, frame: 0, speed: 1, playing: true, anim: 'idle', loop: true, ...(c.voxel || {}), model: GOBLIN_MODEL };
    n++;
  }
  return n;
}
