// game/js/quest/sim/wolfBrain.js (WOLF-01). Wolf-specific numbers + pure helpers for the beast sim. A wolf is a beast
// entity (brain.kind 'beast', brain.species 'wolf'): beastSim runs the same state machine and swaps in WOLF_OVERRIDES
// per slot. Mapping: chase -> windup (= the 0.5 s CROUCH) -> charge (= the 5 m LEAP) -> recover (= RETREAT 1.5 s).
// A chasing wolf that is inside the windup range while another wolf holds the attack TOKEN (WINDUP/CHARGE) circles at
// 4-6 m instead of waiting. A lone wolf under 25 % HP flees 30 m. Rule 15 (sim/**): no Math.random, no trig, no clock.
import { BEAST_DEFAULTS } from './beastConfig.js';

/** The ONE place the wolf model id lives (boar stand-in until WOLF-D1's voxel_wolf lands: set this to its key). */
export const WOLF_MODEL = 'wolf';
export const WOLF_ANCHOR_IDS = Object.freeze(['wolf1', 'wolf2', 'wolf3', 'wolf4', 'wolf5']);

/** Tier-1 multipliers vs the boar (US-129a scales them later). */
export const WOLF_TUNING = Object.freeze({
  attack: 'melee',   // OB-220: 'melee' = close in, 0.4 s snap, short bite lunge, step back; 'charge' = the old 5 m leap (legacy numbers below)
  biteR: 1.8, biteSec: 0.4, biteM: 2.0, biteLungeSec: 0.25, biteRetreatSec: 0.8, biteRetreatM: 2, // melee numbers (= kinds.json grey_wolf `bite`)
  hpMul: 0.75,       // HP 0.75x boar
  speedMul: 1.3,     // run speed 1.3x boar
  crouchSec: 0.5,    // telegraph: crouch before the leap (>= 0.5 s)
  leapM: 5,          // leap distance
  leapSec: 0.5,      // leap duration -> leap speed = leapM / leapSec
  retreatSec: 1.5,   // retreat after a bite
  circleMin: 2.4, circleMax: 3.4, // circling band (m) while another wolf holds the token
  circleSpeedMul: 0.7,        // circling speed as a share of the wolf's chase speed
  fleeHpFrac: 0.25,  // a LONE wolf below this share of max HP flees
  fleeM: 30,         // flee distance
  packR: 25,         // m, another living wolf within this = "not lone"
  retreatM: 2,       // m, retreat waypoint distance (melee step back; charge mode used 4)
});

/** Per-slot cfg overrides for a wolf (merged over the boar defaults at createBeastSim). */
export function wolfOverrides(base = BEAST_DEFAULTS, attack = WOLF_TUNING.attack) {
  const T = WOLF_TUNING;
  const melee = attack === 'melee';
  return {
    hp: Math.max(1, Math.round(base.hp * T.hpMul)),
    chase: base.chase * T.speedMul,
    walk: base.walk * T.speedMul,
    windupR: melee ? T.biteR : T.leapM,                 // snap/crouch starts at bite (1.8 m) or leap (5 m) range
    windupSec: melee ? T.biteSec : T.crouchSec,
    charge: melee ? T.biteM / T.biteLungeSec : T.leapM / T.leapSec,
    chargeMaxSec: melee ? T.biteLungeSec : T.leapSec,
    recoverSec: melee ? T.biteRetreatSec : T.retreatSec,
    recoverWallSec: melee ? T.biteRetreatSec : T.retreatSec,
  };
}

export function isWolfEntity(e) {
  return !!(e && e.components && e.components.brain && e.components.brain.species === 'wolf');
}

/** Tangent point on the circle of radius `r` around (px,py), seen from the wolf at (wx,wy); dir = +1/-1. Trig-free.
 * Writes {x,y} into `out` (zero alloc). Closer than r pushes outward, farther pulls inward (radial + tangent step). */
export function circleTarget(wx, wy, px, py, r, dir, out) {
  let rx = wx - px, ry = wy - py;
  let d = Math.sqrt(rx * rx + ry * ry);
  if (d < 1e-6) { rx = 1; ry = 0; d = 1; }
  const ux = rx / d, uy = ry / d;
  out.x = px + ux * r + (-uy * dir) * 2;
  out.y = py + uy * r + (ux * dir) * 2;
  return out;
}

/** Point `m` metres from (wx,wy) directly away from (px,py). */
export function awayTarget(wx, wy, px, py, m, out) {
  let rx = wx - px, ry = wy - py;
  let d = Math.sqrt(rx * rx + ry * ry);
  if (d < 1e-6) { rx = 1; ry = 0; d = 1; }
  out.x = wx + (rx / d) * m;
  out.y = wy + (ry / d) * m;
  return out;
}

/** World helper (call BEFORE createBeastSim): turns each existing anchor entity wolf1..5 into a wolf beast. An absent
 * anchor is skipped, so with no MAP-26 data this does nothing. Returns the number converted. */
export function ensureWolves(world, ids = WOLF_ANCHOR_IDS) {
  let n = 0;
  for (const id of ids) {
    const e = world.entity ? world.entity(id) : null;
    if (!e) continue;
    const c = e.components || (e.components = {});
    const t = e.transform;
    c.brain = { ...(c.brain || {}), kind: 'beast', species: 'wolf', home: [t.x, t.y] };
    c.targetable = c.targetable || { height: 0.7, radius: 0.45 };
    c.voxel = { t: 0, frame: 0, speed: 1, playing: true, anim: 'idle', loop: true, ...(c.voxel || {}), model: WOLF_MODEL };
    n++;
  }
  return n;
}
