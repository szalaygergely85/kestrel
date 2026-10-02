// game/js/quest/sim/beastConfig.js (US-079a, architecture.md 29.1). Pure data: every number here is a metre, a
// metres/second speed, or a SECOND (never a step count - steps are derived once, at createBeastSim time, via
// `toSteps`). Rule 15 (engine/nav/** + game/js/quest/sim/**): no Math.random, no trig, no wall clock in this file
// or anything under sim/ that reads it.
import { SIM_STEP } from '../../../../engine/index.js';

/** @type {Readonly<Record<string, number>>} */
export const BEAST_DEFAULTS = Object.freeze({
  wanderR: 6,          // m, wander radius from home
  pauseMin: 2,         // s, wander pause (min)
  pauseMax: 4,         // s, wander pause (max)
  walk: 1.5,           // m/s, wander + return speed
  noticeR: 12,         // m, notice range (cone)
  coneCos: 0.5,        // cos(60 deg): dot(forward, dirToPlayer) >= this = within a 120 deg total notice cone
  nearR: 3,            // m, notice range (any direction, no cone/LOS needed)
  noticeSec: 0.6,      // s, notice pause before chase
  chase: 4.5,          // m/s, chase speed
  windupR: 5,          // m, distance at which chase -> windup
  windupSec: 0.5,      // s, windup pause before charge
  charge: 7,           // m/s, charge speed
  chargeMaxSec: 1.2,   // s, charge gives up (-> recover) after this long
  recoverSec: 1.0,     // s, recover after a normal charge end (timeout/contact)
  recoverWallSec: 2.0, // s, recover after hitting a wall while charging
  loseR: 20,           // m, beyond this -> return (too far)
  loseSightSec: 5,     // s, unseen this long (within loseR) -> return
  repathSec: 0.5,      // s, minimum time between path requests
  repathMoveM: 2,       // m, player must move this far from the last path goal to force a repath
  returnSpeed: 1.5,    // m/s, return-home speed (PO 2026-10-01: same as wander's walk)
  homeArriveR: 1,       // m, return -> wander once this close to home
  radius: 0.45,         // m, beast collision/steer radius
  eyeZ: 0.5,            // m, beast eye height above its feet (sight ray origin)
  targetZ: 1.0,         // m, target point above the player's feet (sight ray destination)
  losEvery: 6,          // steps between LOS samples per slot (round-robin by slot % losEvery)
  staggerSec: 0.6,      // s, US-078d amendment (D-034): heavy-hit stagger duration
  staggerKnock: 4,       // m/s, the stagger shove speed (steer.maxSpeed while staggered; decays by accel)
});

/** `toSteps(sec) = Math.round(sec / SIM_STEP)` - the ONE place seconds become an integer step count (architecture.md
 * 29.1). Call once per config value at `createBeastSim` time; never call this inside `step()`. */
export function toSteps(sec) {
  return Math.round(sec / SIM_STEP);
}
