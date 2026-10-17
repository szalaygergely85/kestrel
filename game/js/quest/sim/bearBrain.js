// game/js/quest/sim/bearBrain.js (BEAR-01, D-069). Black bear numbers for the beast sim. A bear is a beast entity
// (brain.kind 'beast', brain.species 'bear'); beastSim runs the boar state machine with BEAR overrides per slot.
// Mapping: chase -> windup (= the 0.8 s all-fours BLUFF, no rear-up, clip `windup`) -> charge (straight line, clip
// `charge`) -> recover. Contact = the swipe (2 hearts, absolute: not scaled by the band tier). A light hit (arrow) does
// NOT cancel the windup (beastSim.reactToHit); a heavy hit still staggers; a shield block = blockStaggerSec 0.4.
// Rule 15 (sim/**): no Math.random, no trig, no clock.
import { BEAST_DEFAULTS } from './beastConfig.js';

/** The ONE place the bear model id lives (design/models/voxel_bear_black.js, BEAR-D1/D2). */
export const BEAR_MODEL = 'bearBlack';
export const BEAR_ANCHOR_IDS = Object.freeze(['blackBear1', 'blackBear2', 'blackBear3']);

export const BEAR_TUNING = Object.freeze({
  hpMul: 3,          // HP = 3x boar (before the band-tier hp multiplier, applied once at create)
  swipeHearts: 2,    // contact damage in hearts (payload damage 1 = 1 heart = 5 HP); fixed, tier damage not applied
  walk: 1.0,         // m/s slow wander (blackBearFx.speeds.walk)
  chase: 4.0,        // m/s approach before the telegraph
  noticeR: 12,       // m, unprovoked aggro
  hitAggroR: 25,     // m, once hit it keeps/regains the chase out to here (loseR)
  leashR: 30,        // m, never chases past this from home
  windupR: 6,        // m, bluff starts here
  windupSec: 0.8,    // s, telegraph (>= 0.8)
  charge: 6.0,       // m/s (blackBearFx.speeds.charge)
  chargeMaxSec: 1.4, // s -> up to 8.4 m, a straight line
  recoverSec: 1.5,
  recoverWallSec: 2.0,
  // BEAR-BITE: close-range lunge-bite, mirrors blackBearFx.bite (design/models/voxel_bear_black.js; the test pins equality)
  biteReachR: 1.6,   // m (centre to centre) the bear may start a bite from
  biteMs: 550,       // clip `attack` length
  biteHitMs: 200,    // jaws snap = the ONE damage moment
  biteCdSec: 3.0,    // s between bites
});

/** Deterministic bite-vs-swipe pick: n-th decision of slot i (no rng draw, so other traces never shift). */
export function bearPicksBite(i, n) {
  let h = Math.imul((i + 1) * 0x9e3779b1 ^ n, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h & 1) === 1;
}

export function bearOverrides(base = BEAST_DEFAULTS) {
  const T = BEAR_TUNING;
  return {
    hp: Math.max(1, Math.round(base.hp * T.hpMul)),
    walk: T.walk, returnSpeed: T.walk, chase: T.chase,
    noticeR: T.noticeR, loseR: T.hitAggroR, leashR: T.leashR,
    windupR: T.windupR, windupSec: T.windupSec,
    charge: T.charge, chargeMaxSec: T.chargeMaxSec,
    recoverSec: T.recoverSec, recoverWallSec: T.recoverWallSec,
  };
}

export function isBearEntity(e) {
  return !!(e && e.components && e.components.brain && e.components.brain.species === 'bear');
}

/** World helper (call BEFORE createBeastSim): turns each existing anchor blackBear1..3 into a bear beast. */
export function ensureBears(world, ids = BEAR_ANCHOR_IDS) {
  let n = 0;
  for (const id of ids) {
    const e = world.entity ? world.entity(id) : null;
    if (!e) continue;
    const c = e.components || (e.components = {});
    const t = e.transform;
    c.brain = { ...(c.brain || {}), kind: 'beast', species: 'bear', home: [t.x, t.y] };
    c.targetable = c.targetable || { height: 1.1, radius: 0.7 };
    c.voxel = { t: 0, frame: 0, speed: 1, playing: true, anim: 'idle', loop: true, ...(c.voxel || {}), model: BEAR_MODEL };
    n++;
  }
  return n;
}
