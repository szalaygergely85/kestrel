// game/js/quest/sim/beastSim.js (US-079a, architecture.md 29.1). The beast brain: a flat SoA state machine
// (wander/notice/chase/windup/charge/recover/return) driven over an RE-05 NavGrid + A* path and RE-09 steering.
// Rule 15 (this whole sim/** tree): no Math.random, no trig (sin/cos/atan2), no wall clock, no Map iteration inside
// `step()`, integer step-count timers only (seconds are converted once at create via `beastConfig.toSteps`). Facing
// is a stored unit vector (fx, fy) derived by vector-normalise (sqrt, not trig); turning that into a yaw angle for
// rendering is `beastView.js`'s job, the one place trig is allowed (29.1).
//
// Position lives in the RE-09 steer SoA (steer.x/steer.y), not duplicated here - this file only adds the fields
// the state machine itself needs (29.1's field list). z is written straight into `entity.transform.z` every step
// from `world.supportAt` (the beast always stands on the ground/mesh, no vertical physics).
import { createAStar, findPath, findPathCells, smoothPath, createSteer, PHYSICS, SIM_STEP } from '../../../../engine/index.js';
import { BEAST_DEFAULTS, toSteps } from './beastConfig.js';
import { tierMult } from './band.js';
import { levelScale, LEVEL_TABLE, kindFactors } from './beastLevels.js';
import { resolveDifficulty, DIFFICULTY, WINDUP_FLOOR_SEC } from './difficulty.js'; // DIFF-MENU
import { hashU } from '../../life/schedule.js';
import { canSee } from './sight.js';
import { BEAR_TUNING, BEAR_MODEL, bearOverrides, bearPicksBite, isBearEntity } from './bearBrain.js'; // BEAR-01, BEAR-BITE
import { WOLF_TUNING, wolfOverrides, isWolfEntity, circleTarget, awayTarget } from './wolfBrain.js'; // WOLF-01
import { GOBLIN_TUNING, goblinOverrides, isGoblinEntity } from './goblinBrain.js'; // GOB-01
import { KINDS, KIND_NAMES, kindIndex, kindOfEntity } from './beastKinds.js'; // BEAST-03a
import { ARCHETYPES } from "./archetypes.js";
import { createWaterBrain, stepWaterBrain, grabMash as wbGrabMash, waterBlocks, waterHit, waterFreeze } from './brains/waterBrain.js'; // BEAST-08b
import { LAYERS } from './brains/layers.js'; // BEAST-03b: LAYERS[archIdx](sim, i, ctx)
import { createTactics, tacticsSync, tacticsSteer, tacticsBand, tacticsAllies, TACT_MELEE, TACT_RANGED, TACT_CASTER, TACT_SWARM, TOK_M, TOK_R, TOK_S } from './tactics.js'; // BEAST-04
import { archIndex, ARCH_NAMES } from './archetypes.js';
import { validateArchetype } from './archetypeRules.js';
import { perceive, leashState, returnTarget, LEASH_HOME, LEASH_ENGAGE, LEASH_RETURN, LEASH_GIVEUP } from '../../../../engine/index.js';

export const POOL = 128; // BEAST-POOL-b: live (bound) slots; records beyond it sleep unbound
export const MAX_RECORDS = 1024; // BEAST-POOL-a (37.16.5): the public slot IS the record index 0..MAX_RECORDS-1 (stable for the run); loot.js imports this
export const ELITE_HP_MUL = 1.5; // BH2-G1 (spec): an elite beast has x1.5 HP
export const MAX_BEASTS = MAX_RECORDS; // legacy alias of MAX_RECORDS (tests / tools still import it)
const PATH_SLOTS = 64; // waypoints kept per beast path (truncated, final = the exact goal - see `storePath`)

// ---- states -----------------------------------------------------------------------------------------------------
export const STATE_WANDER = 0;
export const STATE_NOTICE = 1;
export const STATE_CHASE = 2;
export const STATE_WINDUP = 3;
export const STATE_CHARGE = 4;
export const STATE_RECOVER = 5;
export const STATE_RETURN = 6;
export const STATE_STAGGER = 7; // US-078d amendment (D-034) "Stagger (beastSim, heavy only)"
export const STATE_FLINCH = 8;   // US-079b (37.16.2): no-movement pause after a damaging non-heavy hit
export const STATE_DYING = 9;    // US-079b: hp <= 0, tip-over clip, no perception/path/steer
export const STATE_CORPSE = 10;  // US-079b: lies at the death point, lootable, until despawn/timeout
export const STATE_SINK = 11;    // US-079b: sinks into the ground (z = deathZ - sinkM*k/30)
export const STATE_GONE = 12;    // US-079b: hidden, skipped everywhere, back via resetAll

export const STATE_EAT = 13; // LIFE-07: a wolf/bear eating its kill (counts as wander for perception)
// BEAST-03a (arch 38.64 (2)): states for the new archetype layers. Numbers only - nothing sets them yet (03b+). Never renumber 0-23.
export const STATE_GRAZE = 14;     // grazer/skittish idle feed
export const STATE_PATROL = 15;    // roaming route leg
export const STATE_FLEE = 16;      // run away (skittish, routed pack)
export const STATE_STUCK = 17;     // sidestep / replan
export const STATE_CIRCLE = 18;    // waiting for an attack token on a flank slot
export const STATE_HIDDEN = 19;    // ambush: no drift, near bubble only
export const STATE_SUBMERGED = 20; // water: eyes-only approach
export const STATE_GRAB = 21;      // croc hold + roll
export const STATE_AIRBORNE = 22;  // flyer cruise / circle
export const STATE_BITE = 24;      // BEAR-BITE: black bear lunge-bite (clip attack); damage once at biteHitMs
export const STATE_CAST = 23;      // caster / healer cast (a hit cancels)
const TACT_ROLE_OF = Object.freeze({ melee: TACT_MELEE, ranged: TACT_RANGED, caster: TACT_CASTER, swarm: TACT_SWARM }); // archetype role -> tactical role (BEAST-04)
const ARCH_AGGRO_IDX = Object.freeze({ hostile: 0, whenHit: 1, never: 2, near: 3 });
const FIRST_DEAD_STATE = STATE_DYING;
const deadSt = (st) => st >= FIRST_DEAD_STATE && st <= STATE_GONE; // EAT (13) is alive
export const isBeastDeadState = deadSt; // R6-FIX C: game-side living counts use the sim's own semantics
const HUNT_PREY = { wolf: ['rabbit', 'deer'], bear: ['deer'] }; // LIFE-07: species-filtered prey (38.56 c)
const GOAL_ARRIVE_R = 3, ALT_R = 14, ALT_HIT_R = 1.4, ALT_COOLDOWN_S = 6, MAX_ALT = 8; // LIFE-08 (38.56 d): raid goal + villager alt targets
const HUNT_R = 18, HUNT_CATCH_R = 1.2, HUNT_MAX_S = 6, EAT_S = 8; // states >= this skip perception/path/steer and run stepDead instead

// US-079b: the 2-entry cause table for the `beast:died` payload's `cause` string (sim stores a Uint8 index).
const CAUSE_STR = ['sword', 'fire'];

const WALKING = -1; // sentinel for `timer` in STATE_WANDER: "currently walking to a chosen point" (not pausing)

// Tuning not in the AC's numbered list (architect note 29.1 does not pin these down - see the programmer's report
// "deviations" for why they exist): a default steer accel for everything except the charge sprint, and the A*
// `maxNodes` split between a short wander hop and a full chase/return path.
const DEFAULT_ACCEL = 12;   // m/s^2
const CHARGE_ACCEL = 70;    // m/s^2 (29.1 "Charge: waypoint pos + cd*20, accel 70")
const WANDER_MAX_NODES = 500;
const TRAVEL_MAX_NODES = 3000;
const WAYPOINT_ARRIVE = 0.5;     // m, setWaypoint's slow-down radius (29.1 step 4)
const WAYPOINT_ADVANCE_D2 = 0.36; // m^2 (0.6 m, 29.1 step 4 "advance to the next one within 0.6 m")
const CONTACT_PAD = 0.1;         // m (29.1 step 6 "dist2D <= radius + PHYSICS.radius + 0.1")
const WALL_SPEED_FRAC = 0.35;    // 29.1 step 6 "moved < 0.35*charge*STEP on 2 steps in a row = wall"
const WALL_STREAK = 2;

// US-079c (design/models/voxel_beast.js `boarFx.scrape`): the windup kick steps (150/300/450 ms) at which the sim
// emits one `beast:scrape` for particleHooks, and the forefeet offset (mount `forefeet` ~0.45 m in front, z + 0.03).
const SCRAPE_KICKS = [9, 18, 27];
const SCRAPE_FORE_M = 0.45;

/**
 * @param {any} world engine World (terrain + structures; also the LOS/supportAt surface)
 * @param {{nav: {grid:any, astar:any}, rng: any, events: any, cfg?: Partial<typeof BEAST_DEFAULTS>}} opts
 * @returns {null | ReturnType<typeof buildSim>} `null` if no entity in `world` has `components.brain.kind === 'beast'`
 */
/** LIFE-07: species names -> fauna species-index bitmask (0 when none of them exists). */
function preyMaskOf(fauna, names) {
  let m = 0;
  const sps = fauna.def.species;
  for (let k = 0; k < sps.length; k++) if (names.indexOf(sps[k].name) >= 0 && k < 31) m |= (1 << k);
  return m;
}

const TILE_DORMANT_R = 200; // WM-04: grid worlds - home farther than this from the player (or outside the live nav tile) = dormant
/** WM-04: one A* per sim; a same-size nav tile swap only rebinds `astar.grid` (stamps/heap are per-cell scratch, valid for any grid of that size). */
function astarFor(cur, grid) {
  if (cur && cur.grid && cur.grid.w === grid.w && cur.grid.h === grid.h) { cur.grid = grid; return cur; }
  return createAStar(grid);
}

const EMPTY_SLOTS = Object.freeze([]);
export function createBeastSim(world, opts) {
  const { nav, rng, events } = opts;
  const band = opts.band || null; // US-129a: optional createBand() result; absent = every beast tier 1 (x1)
  const cfg = opts.cfg ? { ...BEAST_DEFAULTS, ...opts.cfg } : BEAST_DEFAULTS;

  /** @type {any[]} plain entity data objects, gathered once (rule 15: no Map iteration inside step()). */
  const beastEntities = [];
  world.forEachEntity((e) => {
    if (e.components && e.components.brain && e.components.brain.kind === 'beast') beastEntities.push(e);
  });
  if (beastEntities.length === 0) return null;

  const count = Math.min(beastEntities.length, MAX_RECORDS);
  if (beastEntities.length > MAX_RECORDS) {
    console.warn(`createBeastSim: ${beastEntities.length} beast entities, only the first ${MAX_RECORDS} get a brain.`);
  }

  // Q9 item 4 nit: a world with beast entities but no `nav` block (main.js only builds one when `worldDef.nav`
  // exists) used to throw on `nav.grid` below instead of just skipping the brain, same "no brain = no beasts in
  // this world" precedent as the `beastEntities.length === 0` early return above.
  if (!nav || !nav.grid) {
    console.warn('createBeastSim: beast entities present but no nav grid - skipping (no brain for this world).');
    return null;
  }

  const grid = nav.grid;
  const astar = nav.astar || createAStar(grid);
  const steer = createSteer({
    maxAgents: MAX_RECORDS,
    bounds: { x0: grid.x0, y0: grid.y0, w: grid.w * grid.cell, h: grid.h * grid.cell },
  });

  const sim = {
    world, grid, astar, steer, rng, events, cfg,
    cfgSteps: {
      pauseMin: toSteps(cfg.pauseMin),
      pauseMax: toSteps(cfg.pauseMax),
      notice: toSteps(cfg.noticeSec),
      windup: toSteps(cfg.windupSec),
      chargeMax: toSteps(cfg.chargeMaxSec),
      recover: toSteps(cfg.recoverSec),
      recoverWall: toSteps(cfg.recoverWallSec),
      loseSight: toSteps(cfg.loseSightSec),
      repath: toSteps(cfg.repathSec),
      blockStagger: toSteps(cfg.blockStaggerSec || 0.4),
      stagger: toSteps(cfg.staggerSec), // US-078d amendment (D-034)
      dmgCooldown: toSteps(cfg.dmgCooldownSec), // US-079b (37.16.2)
      flash: toSteps(cfg.flashSec),
      flinch: toSteps(cfg.flinchSec),
      die: toSteps(cfg.dieSec),
      corpse: toSteps(cfg.corpseSec),
      sink: toSteps(cfg.sinkSec),
    },
    count,
    pool: createPool(count),
    noise: 1, // BEAST-PERCEIVE-01w: hearing multiplier of the player this step (1 walk, NOISE_SPRINT, NOISE_SWING); caller sets it
    // preallocated adapter scratch for engine/nav perceive + leash (zero alloc per step)
    _slot: 0,
    _pa: { x: 0, y: 0, fx: 0, fy: 0, coneCos: cfg.coneCos, range: cfg.noticeR, hearR: cfg.nearR, homeX: 0, homeY: 0, homeR: 0 },
    _sc: { // scratch objects folded into one key (SIMSHAPE-01: keeps the top-level key count in V8's fast-properties budget)
      pt: { x: 0, y: 0, noise: 1 },
      po: { sees: false, hears: false, dist: 0, returnHome: false },
      lt: { x: 0, y: 0 },
      lret: { x: 0, y: 0, speed: 0 },
      def: { homeX: 0, homeY: 0, homeR: cfg.homeArriveR, leashR: cfg.leashR, aggroR: cfg.loseR / cfg.loseScale,
             loseScale: cfg.loseScale, returnSpeed: cfg.returnSpeed, giveUpT: cfg.giveUpSec },
      ctx: { px: 0, py: 0 },
      losFn: null,
    },
    _lagents: null,
    entities: beastEntities.slice(0, count),
    ids: beastEntities.slice(0, count).map((e) => e.id),
    grp: beastEntities.slice(0, count).map((e) => (e.components.brain && typeof e.components.brain.group === 'string' ? e.components.brain.group : '')), // ED-LOGIC-01c: logic group name per slot ('' = none)

    spdMul: new Float64Array(MAX_RECORDS).fill(1), // US-129a: per-slot tier speed multiplier (set once at create)
    tier: new Uint8Array(MAX_RECORDS),
    state: new Uint8Array(MAX_RECORDS),
    timer: new Int32Array(MAX_RECORDS),
    wuTot: new Int32Array(MAX_RECORDS), // BH2-G1: the difficulty-scaled windup length of the current windup (for the scrape-kick clock)
    dm: diffMults(opts && opts.difficulty), // BH2-G1: live difficulty ratios (windup / noticeR / noticeSec / leash), read at use so a live change applies to existing beasts
    unseen: new Int32Array(MAX_RECORDS), // also reused as the charge wall-slow streak counter (charge never needs "unseen")
    repathT: new Int32Array(MAX_RECORDS),
    homeX: new Float64Array(MAX_RECORDS),
    homeY: new Float64Array(MAX_RECORDS),
    homeZ: new Float64Array(MAX_RECORDS), // US-079b ARCH: the respawn z (restored by resetAll; a sunk corpse respawns 0.3 m low otherwise)
    fx: new Float64Array(MAX_RECORDS),
    fy: new Float64Array(MAX_RECORDS),
    cdx: new Float64Array(MAX_RECORDS),
    cdy: new Float64Array(MAX_RECORDS),
    goalX: new Float64Array(MAX_RECORDS),
    goalY: new Float64Array(MAX_RECORDS),
    mv: new Float32Array(MAX_RECORDS),       // BEAST-01: smoothed measured ground speed (m/s), view + stuck rule (not hashed)
    moving: new Uint8Array(MAX_RECORDS),     // BEAST-01: hysteresis flag (on > 0.15 m/s, off < 0.05 m/s)
    // BITE-ALLOC: per-feature clusters are sub-objects so the sim object stays <= ~140 top-level keys (V8 goes dictionary-mode near 160 -> boxed doubles)
    stk: { // BEAST-01: stuck rule: t = steps spent wanting to move without leaving the anchor, ax/ay = anchor, fail = failed re-plans in a row, st
      t: new Int32Array(MAX_RECORDS), ax: new Float64Array(MAX_RECORDS), ay: new Float64Array(MAX_RECORDS),
      fail: new Uint8Array(MAX_RECORDS), st: new Uint8Array(MAX_RECORDS),
      wall: new Uint8Array(MAX_RECORDS), // BH-A3: charge wall-slow streak (was aliased onto `unseen`, which perceiveOne rewrites)
      lv: new Uint8Array(MAX_RECORDS),   // SPELL-05: zone level (OB-150) per slot, read by the Light Orb keep-out
      cf: new Int32Array(MAX_RECORDS),   // SPELL-05: steps of calm-flee left (Light Orb Lv3), 0 = none
      calm: { on: 0, x: 0, y: 0, r2: 0, lv: 0 }, // SPELL-05: Light Orb zone; beasts of level <= lv inside it do not START aggro
    },
    chargeLen: new Uint16Array(MAX_RECORDS), // OB-150: steps this charge may last (nominal chargeMax, longer when the player already backs away)
    bankT: new Int32Array(MAX_RECORDS),      // NAV-REACH-01: steps a chaser has held at the nearest reachable cell (partial path) before giving up
    bankHold: new Uint8Array(MAX_RECORDS),   // 1 while holding at that cell (speed 0, faces the player)
    partialGoal: new Uint8Array(MAX_RECORDS),// last A* for this slot was partial (goal unreachable)
    prevX: new Float64Array(MAX_RECORDS),
    prevY: new Float64Array(MAX_RECORDS),
    path: new Float64Array(Math.min(count, POOL) * PATH_SLOTS * 2), // BEAST-POOL: indexed by the pool index lv[i]
    pathLen: new Int32Array(MAX_RECORDS),
    pathIdx: new Int32Array(MAX_RECORDS),
    wary: new Uint8Array(MAX_RECORDS),        // DRESS-01b: brain.temperament==='wary' (ambient boars: short notice + leash until hit)
    provoked: new Uint8Array(MAX_RECORDS),    // DRESS-01b: a wary beast that took damage fights normally until it is back in wander
    seen: new Uint8Array(MAX_RECORDS),
    pathReq: new Uint8Array(MAX_RECORDS),
    dmgCd: new Int32Array(MAX_RECORDS),       // US-079b (37.16.2): steps left in the damage cooldown
    hurtT: new Int32Array(MAX_RECORDS),       // US-079b: steps since the last damage (view flash window, saturating)
    deathZ: new Float64Array(MAX_RECORDS),    // US-079b: the z the beast died at (corpse/sink anchor)
    pendingDied: new Uint8Array(MAX_RECORDS), // US-079b: beast:died is deferred to the next step's start
    despawnReq: new Uint8Array(MAX_RECORDS),  // US-079b: looted -> sink at the next CORPSE entry
    cause: new Uint8Array(MAX_RECORDS),       // US-079b: 0 sword, 1 fire (indexes CAUSE_STR)
    knockV: new Float64Array(MAX_RECORDS),    // US-079b: per-slot stagger clamp speed (replaces shared cfg.staggerKnock)
    wolf: new Uint8Array(MAX_RECORDS),        // WOLF-01: brain.species==='wolf' (per-slot cfg below, pack token, circle, flee)
    elite: new Uint8Array(MAX_RECORDS),       // BH2-G1: 1 = rolled elite at create (difficulty.eliteChance); name-tag hook, not hashed
    wat: new Uint8Array(MAX_RECORDS),         // BEAST-08b: 1 = water slot, run by brains/waterBrain.js (live() skips it)
    wb: null,
    kindIdx: new Uint8Array(MAX_RECORDS),     // BEAST-03a: index into KIND_NAMES (beastKinds.js); data only so far
    pNear: new Float64Array(MAX_RECORDS).fill(cfg.nearR), pCone: new Float64Array(MAX_RECORDS).fill(cfg.coneCos), // BEAST-03b per-slot perception
    pAggro: new Uint8Array(MAX_RECORDS),      // 0 hostile 1 whenHit 2 never 3 near (ARCH_AGGRO order)
    tactOn: new Uint8Array(MAX_RECORDS), tactRole: new Uint8Array(MAX_RECORDS), tactBand: new Float64Array(MAX_RECORDS * 3), // BEAST-04 (tactics.js)
    tactics: createTactics(MAX_RECORDS, (opts && opts.seed) || 0x9e3779b1), 
    sc: { allyN: 0, allyX: 0, allyY: 0, tS: { CHASE: STATE_CHASE, WINDUP: STATE_WINDUP, CHARGE: STATE_CHARGE, RECOVER: STATE_RECOVER }, prey: { x: 0, y: 0 }, thrX: new Float64Array(16), thrY: new Float64Array(16), tmp: { x: 0, y: 0 } }, // scratch
    ap: { slot: new Uint8Array(MAX_RECORDS), tab: Object.fromEntries(Object.keys(ARCHETYPES).map((k) => [k, { ...ARCHETYPES[k] }])), q: [], n: 0 }, // ED-AI-02: slot = 1 where config comes from the archetype row; tab = per-sim mutable copy of the frozen table; q/n = pending patches ({arch, fields}), applied before the next step
    archIdx: new Uint8Array(MAX_RECORDS),     // BEAST-03a: index into ARCH_NAMES (archetypes.js)
    bite: { cd: new Uint16Array(MAX_RECORDS), n: new Uint16Array(MAX_RECORDS), done: new Uint8Array(MAX_RECORDS) }, // BEAR-BITE
    bear: new Uint8Array(MAX_RECORDS),        // BEAR-01: brain.species==='bear' (per-slot cfg, fixed 2-heart swipe, light hits don't cancel windup)
    goblin: new Uint8Array(MAX_RECORDS),      // GOB-01: brain.species==='goblin'
    group: new Uint8Array(MAX_RECORDS),       // GOB-01: attack-token group 0 boar/bear, 1 wolf, 2 goblin
    ranged: new Uint8Array(MAX_RECORDS),      // GOB-02: goblin role 'thrower' (distance band, windup -> beast:throw, reload = RECOVER)
    backT: new Uint16Array(MAX_RECORDS),      // GOB-02: steps a thrower has spent backing off inside cornerR
    packer: new Uint8Array(MAX_RECORDS),      // GOB-01: wolf or melee goblin (circle while waiting, retreat after the strike)
    down: new Uint8Array(MAX_RECORDS),        // GOB-01b: setDown(slot, true) -> STATE_GONE until setDown(slot, false) (not hashed/saved)
    dormCamp: new Uint8Array(MAX_RECORDS), dormTile: new Uint8Array(MAX_RECORDS), tileMode: false, // WM-04 reasons
    dormant: new Uint8Array(MAX_RECORDS),     // GOB-01: setDormant(slot, true) -> skipped like GONE, state kept
    fleeing: new Uint8Array(MAX_RECORDS),     // WOLF-01: STATE_RETURN that runs away from the player first
    spell: { blindT: new Uint16Array(MAX_RECORDS) }, // SPELL-R4 (38.80/38.81): ONE key for all spell per-slot data; blindT = steps a beast cannot perceive (Teleport lv3)
    hunt: new Uint8Array(MAX_RECORDS),        // LIFE-07: 1 = STATE_WANDER leg chasing a fauna prey slot (huntSlot)
    huntSlot: new Int32Array(MAX_RECORDS), huntT: new Int32Array(MAX_RECORDS), preyMask: new Int32Array(MAX_RECORDS),
    goal: { on: new Uint8Array(MAX_RECORDS), tx: new Float64Array(MAX_RECORDS), ty: new Float64Array(MAX_RECORDS) }, // LIFE-08: setGoal override
    alt: { tgt: new Int32Array(MAX_RECORDS).fill(-1), cd: new Int32Array(MAX_RECORDS), n: 0, x: new Float64Array(MAX_ALT), y: new Float64Array(MAX_ALT) }, // LIFE-08: alt chase index / re-hit cooldown (steps) / targets
    fauna: opts.fauna || null,
    scfg: [], ssteps: [],                    // WOLF-01: per-slot cfg / cfgSteps (the shared objects for boars)
    _pz: 0, _px: 0, _py: 0,
    waiting: new Uint8Array(MAX_RECORDS),     // US-079c: CHASE boar holding while another boar is the charger (derived, not saved)

    tick: 0,
    lastServed: -1,
    stats: { astar: 0, astarNodes: 0 },

    // Scratch (zero allocation after create): findPath's `outPath` must hold >= grid.w*grid.h entries (astar.js
    // contract); smoothPath's output is at most that many waypoints before truncation to PATH_SLOTS.
    _cellPath: new Int32Array(grid.totalCells || grid.w * grid.h), // NAV-LAYERS-01d: sheet cells count too (totalCells = w*h without layers)
    _xy: new Float64Array((grid.totalCells || grid.w * grid.h) * 2),
    // US-079c: a charge contact emits `damage: 1`; vitals scales it by `beastDamageScale` (5) -> 5 HP per charge
    // hit (the AC's "6 hits from 30 HP kill"). Verified end-to-end in beastSim.test.js.
    _hitPayload: beastEntities.slice(0, count).map((e) => ({ source: e.id, target: 'player', damage: 1, blocked: 0 })),
    // US-079b: preallocated emit payloads (one per slot, never reallocated). `beast:died` carries the cause string
    // resolved from the 2-entry CAUSE_STR table; `beast:sink` the dust-burst position for particleHooks.
    // US-079c: preallocated windup scrape emit payload (forefeet position + backward kick direction).
    pl: {
      died: beastEntities.slice(0, count).map((e) => ({ id: e.id, x: 0, y: 0, z: 0, cause: 'sword' })),
      sink: beastEntities.slice(0, count).map((e) => ({ id: e.id, x: 0, y: 0, z: 0 })),
      scrape: beastEntities.slice(0, count).map((e) => ({ id: e.id, x: 0, y: 0, z: 0, dirX: 0, dirY: 0, dirZ: 0 })),
      throw: { id: '', slot: 0, dmgF: 1, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }, // GOB-02: ONE preallocated beast:throw payload (reused)
      alt: beastEntities.slice(0, count).map((e, k) => ({ slot: k, alt: 0, id: e.id })),
    },
  };

  sim._lagents = [];
  for (let i = 0; i < count; i++) sim._lagents.push({ x: 0, y: 0, leashMode: LEASH_HOME, leashT: 0 });
  sim._sc.losFn = () => sim.seen[sim._slot] === 1; // cached periodic LOS (sampled in perceiveOne), not a fresh ray

  for (let i = 0; i < count; i++) {
    const e = sim.entities[i];
    const home = (e.components.brain && e.components.brain.home) || [e.transform.x, e.transform.y];
    sim.homeX[i] = home[0];
    sim.homeY[i] = home[1];
    sim.pool.lastX[i] = home[0]; sim.pool.lastY[i] = home[1];
    { const kn = kindOfEntity(e); sim.kindIdx[i] = kindIndex(kn); sim.archIdx[i] = archIndex(KINDS[kn].arch); } // BEAST-03a
    if (isWolfEntity(e)) { // WOLF-01: wolf slot = boar defaults + overrides, own step counts
      sim.wolf[i] = 1; sim.group[i] = 1; sim.packer[i] = 1;
      const wc = { ...cfg, ...wolfOverrides(cfg) };
      sim.scfg.push(wc);
      sim.ssteps.push({ ...sim.cfgSteps, windup: toSteps(wc.windupSec), chargeMax: toSteps(wc.chargeMaxSec), recover: toSteps(wc.recoverSec), recoverWall: toSteps(wc.recoverWallSec) });
    } else if (isGoblinEntity(e)) { // GOB-01: goblin slot = boar defaults + overrides (+ the camp's leashR)
      sim.goblin[i] = 1; sim.group[i] = 2;
      sim.ranged[i] = e.components.brain.role === 'thrower' ? 1 : 0;
      sim.packer[i] = sim.ranged[i] ? 0 : 1;
      const gc = { ...cfg, ...goblinOverrides(cfg, e.components.brain.role) };
      if (typeof e.components.brain.leashR === 'number') gc.leashR = e.components.brain.leashR;
      sim.scfg.push(gc);
      sim.ssteps.push({ ...sim.cfgSteps, windup: toSteps(gc.windupSec), chargeMax: toSteps(gc.chargeMaxSec), recover: toSteps(gc.recoverSec), recoverWall: toSteps(gc.recoverWallSec) });
    } else if (isBearEntity(e)) { // BEAR-01: bear slot = boar defaults + overrides
      sim.bear[i] = 1;
      const bc = { ...cfg, ...bearOverrides(cfg) };
      sim.scfg.push(bc);
      sim.ssteps.push({ ...sim.cfgSteps, windup: toSteps(bc.windupSec), chargeMax: toSteps(bc.chargeMaxSec), recover: toSteps(bc.recoverSec), recoverWall: toSteps(bc.recoverWallSec) });
    } else if (typeof e.components.brain.beastKind === 'string' && KINDS[e.components.brain.beastKind] && e.components.brain.beastKind !== 'boar') {
      // BEAST-03b: any other explicit kind takes perception/leash/speeds from its archetype row (boar + the 3 legacy species keep today's numbers)
      const A = sim.ap.tab[KINDS[e.components.brain.beastKind].arch];
      sim.scfg.push({ ...cfg });
      { const kd = KINDS[e.components.brain.beastKind], ts = kd.telegraphSec, va = kd.arch === 'ranged' && kd.attacks && kd.attacks[0] && kd.attacks[0].type === 'projectile' ? kd.attacks[0] : null;
        if (va) { const w = toSteps(va.windupSec); sim.ssteps.push({ ...sim.cfgSteps, windup: w, recover: Math.max(1, toSteps(va.cooldownSec) - w), volley: true, dmgF: va.dmgF }); } // SKEL-ARCHER-CADENCE-01: shot-to-shot gap = the kind's cooldownSec (windup + recover)
        else sim.ssteps.push(ts > 0 ? { ...sim.cfgSteps, windup: toSteps(ts) } : { ...sim.cfgSteps }); } // UNDER-SKEL-VARIETY-01: brute telegraph 0.8 s
      sim.ap.slot[i] = 1;
      deriveArchSlot(sim, i, A);
    } else { sim.scfg.push(cfg); sim.ssteps.push(sim.cfgSteps); }
    if (sim.fauna && (sim.wolf[i] || sim.bear[i])) sim.preyMask[i] = preyMaskOf(sim.fauna, HUNT_PREY[sim.wolf[i] ? 'wolf' : 'bear']);
    sim.wary[i] = e.components.brain && e.components.brain.temperament === 'wary' ? 1 : 0;
    sim.homeZ[i] = e.transform.z; // US-079b ARCH: the authored spawn z (restored on resetAll)
    sim.fx[i] = 0; sim.fy[i] = -1; // facing north by default
    sim.state[i] = STATE_WANDER;
    sim.timer[i] = sim.cfgSteps.pauseMin; // short initial pause before the first wander leg
    sim.hurtT[i] = 9999; // US-079b: "never damaged" sentinel - the view shows `hurt` only while hurtT < 10
    // US-079b (37.16.2): a FRESH health component on create, overwriting any serialized one - boars always come
    // back alive on load/restart. US-128's bar / sword.js's dead skip / targeting.isAlive all read this.
    // US-129a: tier from `components.brain.tier` (placed override) or the zone band; multipliers applied ONCE here from the
    // base cfg, so a respawn (resetAll restores hp = max) never stacks.
    const br = e.components.brain;
    const tier = band ? band.beastTierAt(e.transform.x, e.transform.y, br && br.tier) : ((br && br.tier >= 1 && br.tier <= 3) ? br.tier | 0 : 1);
    const m = tierMult(tier);
    // OB-150: hp/damage scale with the zone LEVEL (band 1-10, placed tier override -> representative level) and difficulty (beastLevels.js)
    const lv = (br && br.tier >= 1 && br.tier <= 3) ? LEVEL_TABLE.tierLevel[br.tier | 0] : (band ? band.bandAt(e.transform.x, e.transform.y) : 1);
    // BH2-G1 eliteChance: no elite concept existed, so the simplest one: a seeded per-slot roll (Normal 0 = never) -> x1.5 HP (ELITE_HP_MUL); sim.elite[i] is the name-tag hook.
    const ec = resolveDifficulty(opts.difficulty).eliteChance;
    sim.elite[i] = (ec > 0 && !sim.wat[i] && (hashU(((opts && opts.seed) || 0) >>> 0, i, 0xE11E) % 10000) < ec * 10000) ? 1 : 0;
    const ls = levelScale(lv, opts.difficulty);
    // KINDS-F (OB-153): kinds.json hpF/dmgF (x boar, missing = 1) multiply the level result. Wolf/bear slots already carry their own
    // tuning (WOLF_TUNING/BEAR_TUNING hpMul, swipe hearts) so they are skipped here to avoid double counting.
    const kf = kindFactors(e, sim.wolf[i] || sim.bear[i]);
    sim.stk.lv[i] = lv > 255 ? 255 : lv < 0 ? 0 : lv | 0;
    sim.tier[i] = tier; sim.spdMul[i] = m.speed * kf.spd; sim._hitPayload[i].damage = (sim.bear[i] ? BEAR_TUNING.swipeHearts : 1) * ls.damage * kf.dmg; // BEAR-01: swipe base is 2 hearts
    const maxHp = Math.max(1, Math.round(sim.scfg[i].hp * ls.hp * kf.hp * (sim.elite[i] ? ELITE_HP_MUL : 1)));
    e.components.health = { hp: maxHp, max: maxHp, invuln: 0 };
    steer.addAgent(e.transform.x, e.transform.y, cfg.radius, 0, DEFAULT_ACCEL);
  }

  if (opts.waterNav) { // BEAST-08b: water kinds swim over the water-mask grids (opts.waterNav = beastNav.buildWaterNav result)
    sim.wb = createWaterBrain(sim, opts.waterNav, { seed: opts.seed, playerMaxHp: opts.playerMaxHp, hpPerDamage: opts.hpPerDamage });
    sim.grabMash = function grabMash(slot) { if (sim.wb) wbGrabMash(sim.wb, slot); };
    sim.grabSlot = function grabSlot() { return sim.wb ? sim.wb.grabSlot : -1; };
  }
  // US-078d amendment (D-034) + US-079b (37.16.2): one `combat:hit` listener registered at create, id -> slot via
  // a prebuilt plain-object lookup (no Map iteration in step()). US-079b widens it to every hit on a boar id (not
  // just heavy): damage + cooldown + hurt/flinch/stagger + death. `events` is one persistent instance for the
  // whole run (main.js never recreates it on a world reload, unlike `world`) - so, same precedent as
  // `targeting.dispose()`/`vitals.dispose()`, this sim exposes `dispose()` and the caller MUST drop the old sim's
  // listener before creating the next one on a world reload (flagged in the programmer report's main.js wiring
  // section - this file alone cannot add that line).
  const idSlot = {};
  for (let i = 0; i < count; i++) idSlot[sim.ids[i]] = i;
  function onCombatHit(p) {
    if (!p) return;
    const i = idSlot[p.target];
    if (i === undefined) return;
    if (deadSt(sim.state[i])) return; // 37.16.2 item 1: dead/corpse/sink/gone -> ignore
    if (sim.pool.lv[i] < 0 && !bindNow(sim, i)) return; // BEAST-POOL-c: a hit on an unbound record binds it first
    if (sim.wat[i] === 1 && waterBlocks(sim.wb, sim, i, p)) return; // BEAST-08b: turtle front block
    const health = sim.entities[i].components.health;
    if (sim.dmgCd[i] > 0) { // 37.16.2 item 2: ignore damage, still flash/flinch; heavy knockback still applies
      reactToHit(sim, i, p);
      return;
    }
    if (p.damage > 0) { // 37.16.2 item 3: damage + cooldown + hurt + cause + aggro
      health.hp -= p.damage * blockMul(sim, i); // UNDER-SKEL-VARIETY-01: kinds.json blockF (skeleton warrior shield) cuts frontal hits
      sim.dmgCd[i] = sim.cfgSteps.dmgCooldown;
      sim.hurtT[i] = 0;
      sim.cause[i] = p.cause === 'fire' ? 1 : 0;
      sim.provoked[i] = 1;
      sim.seen[i] = 1; sim.unseen[i] = 0; // aggro: a hit from behind leads to chase, not return
    }
    if (health.hp <= 0) { enterDying(sim, i); return; } // 37.16.2 item 4 (no emit inside the listener)
    reactToHit(sim, i, p); // 37.16.2 item 5
  }
  const offCombatHit = events.on('combat:hit', onCombatHit);

  sim.step = function step(px, py, pz) { if (sim.ap.n > 0) applyArchPatches(sim); stepSim(sim, px, py, pz); };
  /** ED-AI-02: queue a live archetype patch (cold path; may allocate). Applied between steps. Returns { ok, errors } - invalid = refused, nothing changes. */
  sim.patchArchetype = function patchArchetype(id, fields) {
    if (!Object.prototype.hasOwnProperty.call(sim.ap.tab, id)) return { ok: false, errors: [`Archetype "${id}" does not exist.`] };
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { ok: false, errors: ['The patch must be an object of fields.'] };
    const errors = [];
    for (const k of Object.keys(fields)) if (!Object.prototype.hasOwnProperty.call(sim.ap.tab[id], k)) errors.push(`Archetype "${id}": "${k}" is not an archetype field.`);
    if (errors.length) return { ok: false, errors };
    // validate against the row AS IT WILL BE after every earlier pending patch of the same archetype
    let base = { ...sim.ap.tab[id] };
    for (let q = 0; q < sim.ap.n; q++) if (sim.ap.q[q].arch === id) base = { ...base, ...sim.ap.q[q].fields };
    const v = validateArchetype({ ...base, ...fields }, id);
    if (v.length) return { ok: false, errors: v };
    sim.ap.q[sim.ap.n++] = { arch: id, fields: { ...fields } };
    return { ok: true, errors: [] };
  };
  sim.dispose = function dispose() { offCombatHit(); };
  sim.hashInto = function hashInto(h) { hashSim(sim, h); };
  sim.save = function save() { return saveSim(sim); };
  sim.load = function load(obj) { loadSim(sim, obj); };
  /** US-080a1: every slot back to home, state wander, timers/paths cleared, steer positions reset. */
  sim.resetAll = function resetAll() { resetAllSim(sim); };
  /** BEAST-06a (arch 38.64 answer c): documented API - reset ONE slot from its home spawn, alive, id kept (the spawn director's respawn). */
  sim.resetSlot = function resetSlot(slot) { if (slot < 0 || slot >= sim.count) return; if (sim.down && sim.down[slot] && sim.setDown) { sim.setDown(slot, false); return; } resetSlotSim(sim, slot); }; // a parked/GONE slot goes through setDown(false)
  /** OB-077: true if any live beast in an aggro state (notice, chase, windup, charge, recover, stagger, flinch) is within `r` m (2D). */
  sim.aggroNear = function aggroNear(x, y, r) {
    const r2 = r * r;
    for (let i = 0; i < sim.entities.length; i++) {
      const st = sim.state[i];
      if (st === STATE_WANDER || st === STATE_EAT || st === STATE_RETURN || deadSt(st)) continue;
      const t = sim.entities[i].transform;
      if (!t) continue;
      const dx = t.x - x, dy = t.y - y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  };
  /** LIFE-08 (38.56 d): while set, a WANDER beast travels to (x, y) (A* up to TRAVEL_MAX_NODES) and holds there instead of wandering. Player notice and combat work as usual. */
  sim.setGoal = function setGoal(slot, x, y) {
    if (slot < 0 || slot >= sim.count) return;
    sim.goal.on[slot] = 1; sim.goal.tx[slot] = x; sim.goal.ty[slot] = y;
    sim.alt.tgt[slot] = -1; sim.alt.cd[slot] = 0;
    sim.hunt[slot] = 0; // BH-A2: a raid goal ends any hunt (goalStep pre-empts huntStep, which would never clear it)
    if (sim.state[slot] === STATE_WANDER) { sim.timer[slot] = sim.cfgSteps.pauseMin; sim.pathLen[slot] = 0; sim.pathIdx[slot] = 0; sim.pathReq[slot] = 0; }
  };
  /** GOB-01: a dormant slot is skipped like GONE (no perceive/path/steer/post, steer agent parked) but keeps its state.
   *  WM-04: two independent reasons (camp distance, nav tile / player distance); a slot is dormant while either is set. */
  function applyDormant(slot) {
    const d = (sim.dormCamp[slot] | sim.dormTile[slot]) ? 1 : 0;
    if (sim.dormant[slot] === d || deadSt(sim.state[slot])) return;
    sim.dormant[slot] = d;
    sim.steer.vx[slot] = 0; sim.steer.vy[slot] = 0;
    sim.steer.active[slot] = d ? 0 : 1; // parked agents are skipped by steer.step and deOverlap
    sim.seen[slot] = 0; sim.pathReq[slot] = 0;
  }
  sim.setDormant = function setDormant(slot, on) {
    if (slot < 0 || slot >= sim.count) return;
    sim.dormCamp[slot] = on ? 1 : 0;
    applyDormant(slot);
    if (!on) markHot(sim, slot);
  };
  /** WM-04: nav-tile / 200 m dormancy (separate reason from the camp's, so a camp wake never wakes a tile-dormant beast). */
  sim.setTileDormant = function setTileDormant(slot, on) { // BEAST-POOL-b shim: on = unbind now (binding is the binder's job)
    if (slot < 0 || slot >= sim.count) return;
    if (on && sim.pool.lv[slot] >= 0) unbindRec(sim, slot);
  };
  /** WM-04: the live nav tile swapped (`world:band` ev.nav). Rebinds grid, A-star and steer bounds, clears paths so live ones re-plan
   *  on the new tile (hunters/travellers request a path at once), then re-evaluates tile dormancy. */
  sim.rebindNav = function rebindNav(navGrid, px, py) {
    if (!navGrid || navGrid === sim.grid) return;
    sim.tileMode = true;
    sim.grid = navGrid;
    sim.astar = astarFor(sim.astar, navGrid);
    if (sim._cellPath.length < (navGrid.totalCells || navGrid.w * navGrid.h)) { sim._cellPath = new Int32Array(navGrid.totalCells || navGrid.w * navGrid.h); sim._xy = new Float64Array((navGrid.totalCells || navGrid.w * navGrid.h) * 2); }
    sim.steer.bounds.x0 = navGrid.x0; sim.steer.bounds.y0 = navGrid.y0;
    for (let i = 0; i < sim.count; i++) {
      if (deadSt(sim.state[i])) continue;
      sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
      // an agent with a goal (chase / travel / goal override) asks for a fresh path on the new tile
      if (sim.dormant[i] === 0 && (sim.goal.on[i] || sim.state[i] === STATE_CHASE || sim.state[i] === STATE_RETURN)) sim.pathReq[i] = 1; else sim.pathReq[i] = 0;
    }
    sim.updateTileDormancy(px, py);
  };
  /** WM-04 -> BEAST-POOL-b: the binder (bind < 150 m, unbind > 180 m or off the nav tile). Cheap; stepSim also runs it every 30 steps. */
  sim.updateTileDormancy = function updateTileDormancy(px, py) { poolUpdate(sim, px, py); };
  /** GOB-01b: on -> slot goes to STATE_GONE (steer agent dropped, hidden, skipped); off -> back alive at home, hp max. */
  // DIFF-MENU (D-083): live difficulty change from the Settings screen. Rescales live beasts' damage by the dmg ratio only;
  // hp / spawn tuning apply to the next created beast (opts.difficulty is read at create).
  if (opts && opts.difficulty) sim.tactics.setDifficulty(resolveDifficulty(opts.difficulty).name); // BH2-G1: tokM + flank follow the create-time difficulty too
  sim.difficulty = resolveDifficulty(opts && opts.difficulty); // resolved row, read by the game for playerDmg (kept current by setDifficulty)
  sim.setDifficulty = function setDifficulty(name) {
    const was = resolveDifficulty(opts.difficulty).dmg, now = resolveDifficulty(name);
    opts.difficulty = now.name;
    // BH2-G1: windup/noticeR/noticeSec/leash are read live from sim.dm; tokM (attack tokens) follows; hp applies to the next created beast.
    const dm = diffMults(now.name); sim.dm.windup = dm.windup; sim.dm.noticeR = dm.noticeR; sim.dm.noticeSec = dm.noticeSec; sim.dm.leash = dm.leash;
    sim.difficulty = now; if (sim.tactics.setDifficulty) sim.tactics.setDifficulty(now.name);
    const r = was > 0 ? now.dmg / was : 1;
    if (r !== 1) for (let i = 0; i < sim._hitPayload.length; i++) if (sim._hitPayload[i]) sim._hitPayload[i].damage *= r;
    return now.name;
  };
  sim.setDown = function setDown(slot, on) {
    if (slot < 0 || slot >= sim.count) return;
    if (on) {
      if (sim.down[slot]) return;
      sim.down[slot] = 1; sim.dormant[slot] = 0; sim.dormCamp[slot] = 0; sim.dormTile[slot] = 0;
      // park (not remove) a live agent: removeAgent/addAgent hands out the lowest free slot, parking keeps slot ids stable
      if (sim.steer.active[slot]) { sim.steer.vx[slot] = 0; sim.steer.vy[slot] = 0; sim.steer.active[slot] = 0; sim.down[slot] = 2; }
      sim.state[slot] = STATE_GONE; sim.pendingDied[slot] = 0; sim.despawnReq[slot] = 0;
      sim.pathLen[slot] = 0; sim.pathIdx[slot] = 0; sim.pathReq[slot] = 0; sim.seen[slot] = 0; sim.goal.on[slot] = 0;
    } else if (sim.down[slot]) {
      if (sim.down[slot] === 2 && sim.pool.lv[slot] >= 0) sim.steer.active[slot] = 1;
      sim.down[slot] = 0; sim.dormant[slot] = 0; sim.dormCamp[slot] = 0; sim.dormTile[slot] = 0;
      resetSlotSim(sim, slot);
      markHot(sim, slot);
      resyncLeash(sim);
    }
    if (sim.pool.lv[slot] < 0 && !sim.down[slot]) { sim.dormTile[slot] = 1; sim.dormant[slot] = 1; } // unbound records read as tile-dormant
  };
  sim.isDown = function isDown(slot) { return slot >= 0 && slot < sim.count && sim.down[slot] === 1; };
  /** GOB-01b: a live slot runs away from the player (last stepped position) like a low-hp wolf/goblin flee. */
  sim.flee = function flee(slot) {
    if (slot < 0 || slot >= sim.count || sim.down[slot] || sim.dormant[slot] || deadSt(sim.state[slot])) return;
    enterFlee(sim, slot, sim._px, sim._py);
  };
  /** SPELL-05: Light Orb zone (x,y,r metres, beasts of level <= lv keep out); on=false clears it. */
  sim.setCalm = function setCalm(on, x, y, r, lv) { const c = sim.stk.calm; c.on = on ? 1 : 0; c.x = x; c.y = y; c.r2 = r * r; c.lv = lv; };
  /** SPELL-05: live beasts of level <= lv within r (2D) of (x,y) run away from the player for `steps` steps. Returns how many. */
  sim.calmFlee = function calmFlee(x, y, r, lv, steps) {
    let n = 0;
    for (let i = 0; i < sim.count; i++) {
      if (sim.down[i] || sim.dormant[i] || deadSt(sim.state[i]) || sim.stk.lv[i] > lv || sim.fleeing[i]) continue;
      const dx = sim.steer.x[i] - x, dy = sim.steer.y[i] - y;
      if (dx * dx + dy * dy > r * r) continue;
      sim.flee(i); if (sim.fleeing[i]) { sim.stk.cf[i] = steps; n++; }
    }
    return n;
  };
  sim.isDormant = function isDormant(slot) { return slot >= 0 && slot < sim.count && sim.dormant[slot] === 1; };
  /** LIFE-08: drop the goal override; a wandering beast walks back home (STATE_RETURN). */
  sim.clearGoal = function clearGoal(slot) {
    if (slot < 0 || slot >= sim.count || !sim.goal.on[slot]) return;
    sim.goal.on[slot] = 0; sim.alt.tgt[slot] = -1;
    if (sim.state[slot] === STATE_WANDER) enterReturn(sim, slot);
  };
  sim.hasGoal = function hasGoal(slot) { return slot >= 0 && slot < sim.count && sim.goal.on[slot] === 1; };
  /** LIFE-08: true once a goal beast stands within GOAL_ARRIVE_R of its goal. */
  sim.atGoal = function atGoal(slot) {
    if (!sim.hasGoal(slot)) return false;
    const dx = sim.goal.tx[slot] - sim.steer.x[slot], dy = sim.goal.ty[slot] - sim.steer.y[slot];
    return dx * dx + dy * dy <= GOAL_ARRIVE_R * GOAL_ARRIVE_R;
  };
  /** LIFE-08: up to 8 extra targets (villager points). A goal beast that finds one nearer than the player chases it; reaching it emits `beast:altHit {slot, alt, id}`. n = 0 clears. */
  sim.setAltTargets = function setAltTargets(n, xs, ys) {
    n = Math.min(n | 0, MAX_ALT);
    for (let k = 0; k < n; k++) { sim.alt.x[k] = xs[k]; sim.alt.y[k] = ys[k]; }
    sim.alt.n = n > 0 ? n : 0;
  };
  /** US-079b: request a corpse sink (loot emptied the body). True if the slot was DYING/CORPSE (sets despawnReq). */
  sim.despawnCorpse = function despawnCorpse(id) {
    const i = idSlot[id];
    if (i === undefined) return false;
    if (sim.state[i] === STATE_DYING || sim.state[i] === STATE_CORPSE) { sim.despawnReq[i] = 1; return true; }
    return false;
  };
  /** US-079b: true once `slot` is dead (DYING/CORPSE/SINK/GONE). */
  sim.isDead = function isDead(slot) { return deadSt(sim.state[slot]); };
  /** US-079b: the slot index for a boar id, or -1 when not tracked. */
  sim.slotOf = function slotOf(id) { const i = idSlot[id]; return i === undefined ? -1 : i; };

  // ED-LOGIC-01c: logic groups. brain.group = name, brain.reserve = true -> the slot starts down (STATE_GONE) until a logic block spawns the group.
  /** @type {Object<string, number[]>} group name -> slots in slot order */
  sim.groups = {};
  for (let i = 0; i < count; i++) { const g = sim.grp[i]; if (g) (sim.groups[g] || (sim.groups[g] = [])).push(i); }
  /** Slots of a group (slot order), [] when unknown. */
  sim.groupSlots = function groupSlots(name) { return sim.groups[name] || EMPTY_SLOTS; };
  /** Group name of a slot ('' none). */
  sim.groupOf = function groupOf(slot) { return slot >= 0 && slot < count ? sim.grp[slot] : ''; };
  /** Reserve group -> alive at the authored home (setDown off for every slot, slot order). Returns slots touched. */
  sim.spawnGroup = function spawnGroup(name) { const l = sim.groupSlots(name); for (let k = 0; k < l.length; k++) sim.setDown(l[k], false); return l.length; };
  /** Group back into reserve (down). */
  sim.despawnGroup = function despawnGroup(name) { const l = sim.groupSlots(name); for (let k = 0; k < l.length; k++) sim.setDown(l[k], true); return l.length; };
  /** True when the group has slots and every one is dead or down. */
  sim.groupDead = function groupDead(name) { const l = sim.groupSlots(name); if (!l.length) return false; for (let k = 0; k < l.length; k++) if (!sim.down[l[k]] && !deadSt(sim.state[l[k]])) return false; return true; };
  /** Number of live (not dead, not down) slots in a group. */
  sim.groupAlive = function groupAlive(name) { const l = sim.groupSlots(name); let n = 0; for (let k = 0; k < l.length; k++) if (!sim.down[l[k]] && !deadSt(sim.state[l[k]])) n++; return n; };
  for (let i = 0; i < count; i++) { const b = sim.entities[i].components.brain; if (b && b.reserve === true && sim.grp[i]) sim.setDown(i, true); }

  for (let i = sim.pool.n; i < count; i++) { // BEAST-POOL-b: records beyond the pool start unbound (parked, tile-dormant)
    sim.steer.active[i] = 0; sim.steer.vx[i] = 0; sim.steer.vy[i] = 0; sim.dormTile[i] = 1; sim.dormant[i] = 1;
  }
  // arch fix (WM-04): a grid world's nav IS a tile -> tile dormancy applies from creation, not only after the first swap (opts.spawn optional: without it only the out-of-tile rule runs)
  if (opts.tileNav) { sim.tileMode = true; sim.updateTileDormancy(opts.spawn ? opts.spawn.x : NaN, opts.spawn ? opts.spawn.y : NaN); }

  return sim;
}

// ---- step pipeline (29.1 "Fixed-step order inside step") ----------------------------------------------------

/** UNDER-SKEL-VARIETY-01: damage multiplier of a kind with `blockF` (shield) when the beast faces the player; else 1. No alloc. */
function blockMul(sim, i) {
  const bf = KINDS[KIND_NAMES[sim.kindIdx[i]]].blockF;
  if (!(bf > 0)) return 1;
  const dx = _pp[0] - sim.steer.x[i], dy = _pp[1] - sim.steer.y[i];
  return dx * sim.fx[i] + dy * sim.fy[i] > 0 ? 1 - bf : 1;
}

/** GOB-01: a slot that perceives, paths, steers and posts (not dead/GONE, not dormant). */
const live = (sim, i) => !deadSt(sim.state[i]) && sim.dormant[i] === 0 && sim.wat[i] === 0;

/** ED-AI-02 (shared by create and patch): perception / leash / speeds / tactical role+band of one archetype-driven slot, written in place (no alloc). */
function deriveArchSlot(sim, i, A) {
  const ac = sim.scfg[i], st = sim.ssteps[i];
  ac.noticeR = A.noticeR; ac.nearR = A.nearR; ac.coneCos = A.coneCos; ac.noticeSec = A.noticeSec; ac.loseR = A.loseR;
  ac.loseSightSec = A.loseSightSec; ac.leashR = A.leashR; ac.walk = A.walk; ac.chase = A.run;
  st.notice = toSteps(A.noticeSec); st.loseSight = toSteps(A.loseSightSec);
  sim.pNear[i] = A.nearR; sim.pCone[i] = A.coneCos; sim.pAggro[i] = ARCH_AGGRO_IDX[A.aggro];
  const tr = TACT_ROLE_OF[A.role]; // BEAST-04: tactical roles (melee pack / swarm / ranged / caster); others stay on the ground layer
  if (tr !== undefined) {
    const kk = KINDS[sim.entities[i].components.brain.beastKind];
    if (!sim.tactOn[i]) sim.tactics.tg[i] = 0;
    sim.tactOn[i] = 1; sim.tactRole[i] = tr;
    sim.tactBand[i * 3] = kk.keepMin !== undefined ? kk.keepMin : A.keepMin; sim.tactBand[i * 3 + 1] = kk.keepMax !== undefined ? kk.keepMax : A.keepMax; sim.tactBand[i * 3 + 2] = A.backOffR;
  } else sim.tactOn[i] = 0;
}

/** ED-AI-02: apply every queued patch, then re-derive each archetype-driven slot of the touched archetypes. Only runs when something is queued. */
function applyArchPatches(sim) {
  const pn = sim.ap.n;
  for (let q = 0; q < pn; q++) {
    const p = sim.ap.q[q], row = sim.ap.tab[p.arch], ai = ARCH_NAMES.indexOf(p.arch);
    for (const k in p.fields) row[k] = p.fields[k];
    for (let i = 0; i < sim.count; i++) if (sim.ap.slot[i] === 1 && sim.archIdx[i] === ai) deriveArchSlot(sim, i, row);
    sim.ap.q[q] = null;
  }
  sim.ap.n = 0;
}

/** BEAST-POOL-a (37.16.5): live-slot pool. Story a binds every record (identity), story b adds the binder. */
function createPool(count) {
  const pn = Math.min(count, POOL), lv = new Int16Array(MAX_RECORDS).fill(-1), rec = new Int16Array(Math.max(1, pn)), free = new Int16Array(Math.max(1, pn));
  for (let i = 0; i < pn; i++) { lv[i] = i; rec[i] = i; } // the first POOL records start bound (identity); the binder swaps from the first update on
  return {
    lv, rec, n: pn, free, freeN: 0, cand: new Int16Array(MAX_RECORDS), candD: new Float64Array(MAX_RECORDS),
    rIn: 150, rOut: 180, every: 30, hot: new Int16Array(64), hotN: 0, nc: 0, phase: 0, primed: false, maxBind: 8, full: 0, evictGap: 20,
    lastX: new Float64Array(MAX_RECORDS), lastY: new Float64Array(MAX_RECORDS), // last position of an unbound record (BEAST-POOL-b)
  };
}

// ---- BEAST-POOL-b (37.16.5): binder ------------------------------------------------------------------------------
// States that may be unbound by distance: WANDER, EAT, GRAZE, PATROL, HIDDEN, SUBMERGED, AIRBORNE. Everything else (notice..recover, return,
// flee, circle, grab, bite, cast, dead timelines, ...) is "in combat" and keeps its slot.
const FREE_ST = new Uint8Array(32);
for (const st of [STATE_WANDER, STATE_EAT, STATE_GRAZE, STATE_PATROL, STATE_HIDDEN, STATE_SUBMERGED, STATE_AIRBORNE]) FREE_ST[st] = 1;
const UNBIND_SNAP_M = 30;

/** Protected = never unbound by distance, never evicted. */
function protectedRec(sim, i) {
  return FREE_ST[sim.state[i]] === 0 || sim.hunt[i] === 1 || sim.fleeing[i] === 1 || sim.goal.on[i] === 1 || sim.tactics.held[i] !== 0;
}

/** Unbind carry (no rec edit): WANDER, hp/dead kept, snap home when > 30 m away, steer parked, tokens released, pool index freed. */
function dropRec(sim, i) {
  const P = sim.pool, steer = sim.steer, t = sim.entities[i].transform;
  sim.tactics.release(i); sim.tactics.flank[i] = -1;
  const dead = deadSt(sim.state[i]);
  if (!dead) {
    sim.state[i] = sim.wat[i] ? STATE_SUBMERGED : STATE_WANDER; sim.timer[i] = sim.cfgSteps.pauseMin;
    sim.hunt[i] = 0; sim.fleeing[i] = 0; sim.waiting[i] = 0;
    const dx = t.x - sim.homeX[i], dy = t.y - sim.homeY[i];
    if (dx * dx + dy * dy > UNBIND_SNAP_M * UNBIND_SNAP_M) { t.x = sim.homeX[i]; t.y = sim.homeY[i]; t.z = sim.homeZ[i]; }
  }
  P.lastX[i] = t.x; P.lastY[i] = t.y; steer.x[i] = t.x; steer.y[i] = t.y;
  steer.active[i] = 0; steer.vx[i] = 0; steer.vy[i] = 0;
  sim.seen[i] = 0; sim.pathReq[i] = 0; sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.dormTile[i] = 1; sim.dormant[i] = 1; // unbound reads as tile-dormant for every consumer
  P.free[P.freeN++] = P.lv[i]; P.lv[i] = -1;
}
/** GONE / down records give their pool index back without touching their state. */
function releaseRec(sim, i) { const P = sim.pool; P.free[P.freeN++] = P.lv[i]; P.lv[i] = -1; }
function removeFromList(P, i) {
  const rec = P.rec; let k = 0; while (k < P.n && rec[k] !== i) k++;
  if (k === P.n) return;
  for (; k < P.n - 1; k++) rec[k] = rec[k + 1];
  P.n--;
}
function unbindRec(sim, i) { dropRec(sim, i); removeFromList(sim.pool, i); }
function bindRec(sim, i, pi) {
  const P = sim.pool, steer = sim.steer, rec = P.rec;
  P.lv[i] = pi;
  let k = P.n++; while (k > 0 && rec[k - 1] > i) { rec[k] = rec[k - 1]; k--; } rec[k] = i; // list stays sorted by record index
  sim.dormTile[i] = 0; sim.dormant[i] = sim.dormCamp[i];
  sim.pathReq[i] = 0; sim.pathLen[i] = 0; sim.pathIdx[i] = 0; sim.seen[i] = 0;
  sim.entities[i].transform.x = P.lastX[i]; sim.entities[i].transform.y = P.lastY[i];
  if (!sim.wat[i]) {
    if (!sim.dormant[i]) steer.activateAgent(i, P.lastX[i], P.lastY[i], steer.radius[i], steer.maxSpeed[i], steer.accel[i]);
    else { steer.x[i] = P.lastX[i]; steer.y[i] = P.lastY[i]; }
  }
  const ag = sim._lagents[i]; ag.leashT = 0; ag.leashMode = LEASH_HOME;
}

/** BEAST-POOL-c: a record that takes damage while unbound (arrow/spell/script at range) must be live to run its death timeline: bind it now,
 *  evicting the farthest unprotected record when the pool is full. False = no slot (the hit is ignored). */
function bindNow(sim, i) {
  const P = sim.pool;
  if (P.lv[i] >= 0) return true;
  if (sim.down[i] || deadSt(sim.state[i])) return false;
  if (P.n >= P.rec.length) {
    let far = -1, fd = -1;
    for (let k = 0; k < P.n; k++) {
      const j = P.rec[k]; if (protectedRec(sim, j)) continue;
      const t = sim.entities[j].transform, dx = t.x - sim._px, dy = t.y - sim._py, d = dx * dx + dy * dy;
      if (d > fd) { fd = d; far = j; }
    }
    if (far < 0) return false;
    unbindRec(sim, far);
  }
  bindRec(sim, i, P.free[--P.freeN]);
  return true;
}

/** Binder, 3 phases (SIM-SPIKE-01: the O(records) candidate scan is sliced over the pool.every steps, no rng, deterministic):
 *  1) unbind > rOut or off the nav tile (protected ones only for the tile); 2) scan records [from,to) for candidates; 3) bind nearest-first
 *  < rIn (max maxBind), evict when full. Candidates are re-validated + re-measured at bind time (the scan may be up to pool.every steps old). */
function poolUnbind(sim, px, py) {
  const P = sim.pool, rec = P.rec, g = sim.grid, tile = sim.tileMode === true;
  const x0 = tile ? g.x0 : 0, y0 = tile ? g.y0 : 0, x1 = tile ? x0 + g.w * g.cell : 0, y1 = tile ? y0 + g.h * g.cell : 0;
  const hasP = px === px && py === py, rOut2 = P.rOut * P.rOut;
  let w = 0;
  for (let k = 0; k < P.n; k++) { // stable compaction
    const i = rec[k], st = sim.state[i];
    if (sim.down[i] || st === STATE_GONE) { releaseRec(sim, i); continue; }
    if (deadSt(st) || sim.pendingDied[i] === 1 || sim.despawnReq[i] === 1) { rec[w++] = i; continue; } // 37.16.5: dying/corpse/sink + pending death keep their slot until GONE (any reason)
    const hx = sim.homeX[i], hy = sim.homeY[i];
    let out = tile && (hx < x0 || hy < y0 || hx >= x1 || hy >= y1);
    if (!out && hasP && !protectedRec(sim, i)) {
      const t = sim.entities[i].transform, dx = t.x - px, dy = t.y - py;
      out = dx * dx + dy * dy > rOut2;
    }
    if (out) { dropRec(sim, i); continue; }
    rec[w++] = i;
  }
  P.n = w;
}
/** BIND-LATE-01: a record that wakes/respawns is queued here and bound at the next step (not at the next sliced scan, up to ~59 steps later). */
function markHot(sim, r) {
  const P = sim.pool;
  if (P.lv[r] >= 0 || P.hotN >= P.hot.length) return; // bound already, or queue full (the sliced scan still catches it)
  for (let k = 0; k < P.hotN; k++) if (P.hot[k] === r) return;
  P.hot[P.hotN++] = r;
}
/** Bind the queued hot records that are alive, in the tile and < rIn, while a slot is free (no eviction: the sliced pass handles a full pool). */
function poolHot(sim, px, py) {
  const P = sim.pool, g = sim.grid, tile = sim.tileMode === true, rIn2 = P.rIn * P.rIn;
  const x0 = tile ? g.x0 : 0, y0 = tile ? g.y0 : 0, x1 = tile ? x0 + g.w * g.cell : 0, y1 = tile ? y0 + g.h * g.cell : 0;
  for (let k = 0; k < P.hotN; k++) {
    const r = P.hot[k];
    if (P.lv[r] >= 0 || sim.down[r] || sim.dormCamp[r] || deadSt(sim.state[r])) continue;
    if (tile) { const hx = sim.homeX[r], hy = sim.homeY[r]; if (hx < x0 || hy < y0 || hx >= x1 || hy >= y1) continue; }
    const dx = P.lastX[r] - px, dy = P.lastY[r] - py;
    if (dx * dx + dy * dy >= rIn2) continue;
    if (P.freeN > 0) bindRec(sim, r, P.free[--P.freeN]);
  }
  P.hotN = 0;
}
/** Append candidates (unbound, alive, in the tile, close or with a goal) among records [from, to). */
function poolScan(sim, from, to, px, py) {
  const P = sim.pool, lv = P.lv, g = sim.grid, tile = sim.tileMode === true, rIn2 = P.rIn * P.rIn;
  const x0 = tile ? g.x0 : 0, y0 = tile ? g.y0 : 0, x1 = tile ? x0 + g.w * g.cell : 0, y1 = tile ? y0 + g.h * g.cell : 0;
  let nc = P.nc;
  for (let r = from; r < to; r++) {
    if (lv[r] >= 0 || sim.down[r] || sim.dormCamp[r] || deadSt(sim.state[r])) continue;
    if (tile) { const hx = sim.homeX[r], hy = sim.homeY[r]; if (hx < x0 || hy < y0 || hx >= x1 || hy >= y1) continue; }
    const dx = P.lastX[r] - px, dy = P.lastY[r] - py;
    if (sim.goal.on[r] !== 1 && dx * dx + dy * dy >= rIn2) continue;
    P.cand[nc++] = r;
  }
  P.nc = nc;
}
function poolBind(sim, px, py) {
  const P = sim.pool, rec = P.rec, lv = P.lv, cap = rec.length, g = sim.grid, tile = sim.tileMode === true;
  const x0 = tile ? g.x0 : 0, y0 = tile ? g.y0 : 0, x1 = tile ? x0 + g.w * g.cell : 0, y1 = tile ? y0 + g.h * g.cell : 0, rIn2 = P.rIn * P.rIn;
  let nc = 0; // re-validate + re-measure the scanned candidates
  for (let c = 0; c < P.nc; c++) {
    const r = P.cand[c];
    if (lv[r] >= 0 || sim.down[r] || sim.dormCamp[r] || deadSt(sim.state[r])) continue;
    if (tile) { const hx = sim.homeX[r], hy = sim.homeY[r]; if (hx < x0 || hy < y0 || hx >= x1 || hy >= y1) continue; }
    const dx = P.lastX[r] - px, dy = P.lastY[r] - py, d2 = dx * dx + dy * dy, pri = sim.goal.on[r] === 1;
    if (!pri && d2 >= rIn2) continue;
    P.cand[nc] = r; P.candD[nc] = pri ? -1 : Math.sqrt(d2); nc++;
  }
  P.nc = 0;
  for (let m = 0; m < P.maxBind && nc > 0; m++) { // nearest first, lower record on a tie (partial selection, no sort)
    let b = 0;
    for (let c = 1; c < nc; c++) if (P.candD[c] < P.candD[b] || (P.candD[c] === P.candD[b] && P.cand[c] < P.cand[b])) b = c;
    const r = P.cand[b], cd = P.candD[b];
    P.cand[b] = P.cand[nc - 1]; P.candD[b] = P.candD[nc - 1]; nc--;
    if (P.n >= cap) { // full: evict the farthest unprotected if >= evictGap farther than the candidate
      let far = -1, fd = -1;
      for (let k = 0; k < P.n; k++) {
        const i = rec[k]; if (protectedRec(sim, i)) continue;
        const t = sim.entities[i].transform, dx = t.x - px, dy = t.y - py, d = Math.sqrt(dx * dx + dy * dy);
        if (d > fd) { fd = d; far = i; }
      }
      if (far < 0 || fd < cd + P.evictGap) { P.full++; break; }
      unbindRec(sim, far);
    }
    bindRec(sim, r, P.free[--P.freeN]);
  }
}
/** Synchronous full binder pass (tile load, first step, tests). */
function poolUpdate(sim, px, py) {
  poolUnbind(sim, px, py);
  if (!(px === px && py === py)) return;
  sim.pool.nc = 0; poolScan(sim, 0, sim.count, px, py); poolBind(sim, px, py);
  sim.pool.phase = 0;
}
/** Per-step binder: phases 0..every-2 scan a record slice each, the last phase unbinds + binds (all work <= 1/every of the full pass). */
function poolStep(sim, px, py) {
  const P = sim.pool, e = P.every;
  if (!P.primed) { P.primed = true; poolUpdate(sim, px, py); return; } // the first step stays synchronous (records are bound before they act)
  if (!(px === px && py === py)) { poolUnbind(sim, px, py); return; }
  if (P.hotN > 0) poolHot(sim, px, py);
  const ph = P.phase, chunk = Math.ceil(sim.count / (e - 1));
  if (ph === 0) P.nc = 0;
  if (ph < e - 1) { const from = ph * chunk; poolScan(sim, from, Math.min(sim.count, from + chunk), px, py); P.phase = ph + 1; return; }
  poolUnbind(sim, px, py); poolBind(sim, px, py); P.phase = 0;
}

function stepSim(sim, px, py, pz) {
  const pool = sim.pool;
  sim._px = px; sim._py = py; sim._pz = pz;
  if (sim.tileMode || sim.count > POOL) poolStep(sim, px, py); // BEAST-POOL-b: binder, staggered by the step counter
  // US-079b (37.16.2): `beast:died` goes out at the START of the step after the kill (exactly once), so the sword
  // is never mid-iteration when a loot spawn would rebuild its target list.
  let rec = pool.rec, n = pool.n; // re-read after poolUpdate
  for (let k = 0; k < n; k++) emitPendingDied(sim, rec[k]);
  // US-079b: cooldown/hurt timers tick for every slot; dead slots run their own timeline (stepDead).
  for (let k = 0; k < n; k++) {
    const i = rec[k];
    if (sim.dmgCd[i] > 0) sim.dmgCd[i]--;
    if (sim.hurtT[i] < 9999) sim.hurtT[i]++;
    if (deadSt(sim.state[i])) stepDead(sim, i);
  }
  if (sim.fauna) huntPass(sim);
  for (let k = 0; k < n; k++) { const i = rec[k]; if (live(sim, i)) { perceiveOne(sim, i, px, py, pz); leashOne(sim, i, px, py); } }
  sim._sc.ctx.px = px; sim._sc.ctx.py = py;
  tacticsSync(sim, sim.sc.tS); // BEAST-04: token release + flank re-assign
  for (let k = 0; k < n; k++) { const i = rec[k]; if (live(sim, i)) { if (!LAYERS[sim.archIdx[i]](sim, i, sim._sc.ctx)) transitionOne(sim, i, px, py); } }
  if (sim.wb) stepWaterBrain(sim.wb, px, py); // BEAST-08b: water slots (own grid, own movement)
  updatePathRequests(sim, px, py);
  servePathRequest(sim, px, py);
  for (let k = 0; k < n; k++) { const i = rec[k]; if (live(sim, i)) setSteerTarget(sim, i) }
  sim.steer.step(SIM_STEP, sim.grid);
  deOverlap(sim); // US-079c (BUG-BOAR-OVERLAP): hard pairwise push-apart, after the soft steer step, before post
  _pp[0] = px; _pp[1] = py; _pp[2] = pz; // BEAST-ALLOC-01: player pos via scratch (double args box per non-inlined call)
  for (let k = 0; k < n; k++) { const i = rec[k]; if (live(sim, i)) postOne(sim, i) }
  sim.tick++;
}

/** LIFE-07: feed live beast positions to fauna as threat points; end hunts that left STATE_WANDER. Only runs with fauna. */
function huntPass(sim) {
  const n = sim.pool.n, rec = sim.pool.rec, steer = sim.steer;
  let t = 0;
  for (let k = 0; k < n; k++) {
    const i = rec[k];
    if (sim.hunt[i] && sim.state[i] !== STATE_WANDER) sim.hunt[i] = 0;
    if (!deadSt(sim.state[i]) && t < 16) { sim.sc.thrX[t] = steer.x[i]; sim.sc.thrY[t] = steer.y[i]; t++; }
  }
  sim.fauna.setThreats(t, sim.sc.thrX, sim.sc.thrY);
}

/** LIFE-07: a wandering (not walking-to-a-point-noticed) predator looks for prey once a second (staggered). */
function huntLook(sim, i) {
  if (!sim.preyMask[i] || sim.tick % 60 !== i % 60) return;
  const k = sim.fauna.nearestPrey(sim.steer.x[i], sim.steer.y[i], HUNT_R, sim.sc.prey, sim.preyMask[i]);
  if (k < 0) return;
  sim.hunt[i] = 1; sim.huntSlot[i] = k; sim.huntT[i] = toSteps(HUNT_MAX_S);
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0; sim.pathReq[i] = 0;
  sim.timer[i] = sim.cfgSteps.pauseMin; // not WALKING: no A* request while hunting
}

/** LIFE-07: chase step (in STATE_WANDER): the player notice pre-empts; catch -> kill + STATE_EAT; timeout -> give up. */
function huntStep(sim, i, px, py) {
  if (noticedOf(sim, i, px, py)) { sim.hunt[i] = 0; enterNotice(sim, i); return; }
  const s = sim.fauna.slots[sim.huntSlot[i]];
  if (!s || !s.alive || --sim.huntT[i] <= 0) { sim.hunt[i] = 0; enterWander(sim, i); return; }
  const dx = s.x - sim.steer.x[i], dy = s.y - sim.steer.y[i];
  if (dx * dx + dy * dy <= HUNT_CATCH_R * HUNT_CATCH_R) {
    sim.fauna.kill(sim.huntSlot[i]);
    sim.hunt[i] = 0; sim.state[i] = STATE_EAT; sim.timer[i] = toSteps(EAT_S);
    sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  }
}

function perceiveOne(sim, i, px, py, pz) {
  const steer = sim.steer, cfg = sim.cfg;
  if (sim.spell.blindT[i] > 0) { sim.spell.blindT[i]--; sim.seen[i] = 0; sim.unseen[i] = 0; return; } // SPELL-R4: blinded (lost track)
  const dx = px - steer.x[i], dy = py - steer.y[i];
  const d2 = dx * dx + dy * dy;
  const loseR2 = sim.scfg[i].loseR * sim.scfg[i].loseR; // BEAR-01: per-slot (same as cfg for boars/wolves)
  if (d2 > loseR2) {
    sim.seen[i] = 0;
  } else if (sim.tick % cfg.losEvery === i % cfg.losEvery) {
    const bz = pz; // ground z of the player is close enough to feet; targetZ offset below is what matters
    const ok = canSee(
      sim.world,
      steer.x[i], steer.y[i], zOf(sim, i) + cfg.eyeZ,
      px, py, bz + cfg.targetZ,
    ) ? 1 : 0;
    sim.seen[i] = ok;
    sim.unseen[i] = ok ? 0 : sim.unseen[i] + cfg.losEvery;
  }
}

/** The beast's current rendered z (read back from its entity transform - the sim's own authoritative z store). */
function zOf(sim, i) {
  return sim.entities[i].transform.z;
}

function noticedOf(sim, i, px, py) {
  if (sim.spell.blindT[i] > 0) return false; // SPELL-R4
  const cz = sim.stk.calm; // SPELL-05: Light Orb keep-out (the 'woken waystone light' rule): no aggro START inside the light
  if (cz.on === 1 && sim.stk.lv[i] <= cz.lv) { const cx = sim.steer.x[i] - cz.x, cy = sim.steer.y[i] - cz.y; if (cx * cx + cy * cy <= cz.r2) return false; }
  // BEAST-PERCEIVE-01w: engine/nav/perceive through a thin adapter. hearing = the "nearR" any-direction bubble
  // (scaled by the player's noise), sight = noticeR + cone + the cached LOS flag. Same numbers as before at noise 1.
  const steer = sim.steer, a = sim._pa, t = sim._sc.pt;
  a.x = steer.x[i]; a.y = steer.y[i]; a.fx = sim.fx[i]; a.fy = sim.fy[i];
  t.x = px; t.y = py; t.noise = sim.noise;
  const calm = sim.wary[i] === 1 && sim.provoked[i] === 0; // DRESS-01b: unprovoked ambient boar = short notice only
  a.range = calm ? sim.cfg.calmNoticeR : sim.scfg[i].noticeR * sim.dm.noticeR; // BH2-G1: difficulty scales sight range (BEAR-01: per-slot)
  a.hearR = calm ? sim.cfg.calmNearR : sim.pNear[i];
  a.coneCos = sim.pCone[i];
  sim._slot = i;
  const o = perceive(a, t, sim._sc.losFn, sim._sc.po);
  const ag = sim.pAggro[i]; // BEAST-03b: aggro mode (0 hostile = today's behaviour)
  if (ag === 0) return o.hears || o.sees;
  if (ag === 1) return sim.provoked[i] === 1 && (o.hears || o.sees);
  if (ag === 3) return o.hears;
  return false;
}

/** BEAST-PERCEIVE-01w: keep the engine leash mode in step with the brain state, then advance it (engaged states only). */
function leashOne(sim, i, px, py) {
  const ag = sim._lagents[i], def = sim._sc.def, st = sim.state[i];
  if (st === STATE_WANDER || st === STATE_EAT) { ag.leashMode = LEASH_HOME; ag.leashT = 0; return; }
  if (st === STATE_RETURN) { if (ag.leashMode !== LEASH_GIVEUP) ag.leashMode = LEASH_RETURN; return; }
  if (ag.leashMode === LEASH_HOME || ag.leashMode === LEASH_RETURN) { ag.leashMode = LEASH_ENGAGE; ag.leashT = 0; }
  if (ag.leashMode === LEASH_GIVEUP) return; // stays given-up until the beast is home (wander resets it)
  ag.x = sim.steer.x[i]; ag.y = sim.steer.y[i];
  def.homeX = sim.homeX[i]; def.homeY = sim.homeY[i];
  def.aggroR = sim.scfg[i].loseR / sim.cfg.loseScale; // BEAR-01: per-slot (identical for boars/wolves)
  def.leashR = sim.wary[i] === 1 && sim.provoked[i] === 0 ? sim.cfg.calmLeashR : sim.scfg[i].leashR * sim.dm.leash; // BH2-G1
  const t = sim._sc.lt; t.x = px; t.y = py;
  leashState(ag, def, t, SIM_STEP);
}

function transitionOne(sim, i, px, py) {
  if (sim.bite.cd[i] > 0) sim.bite.cd[i]--;
  switch (sim.state[i]) {
    case STATE_WANDER: wanderStep(sim, i, px, py); break;
    case STATE_EAT: eatStep(sim, i, px, py); break;
    case STATE_NOTICE: noticeStep(sim, i); break;
    case STATE_CHASE: checkChaseExit(sim, i, px, py); break;
    case STATE_WINDUP: windupStep(sim, i, px, py); break;
    case STATE_CHARGE: /* handled in postOne (needs the post-steer position) */ break;
    case STATE_RECOVER: recoverStep(sim, i, px, py); break;
    case STATE_BITE: biteStep(sim, i, px, py); break;
    case STATE_RETURN: returnStep(sim, i, px, py); break;
    case STATE_STAGGER: staggerStep(sim, i); break;
    case STATE_FLINCH: flinchStep(sim, i); break;
    default: break;
  }
}

function staggerStep(sim, i) {
  sim.timer[i]--;
  if (sim.timer[i] <= 0) { if (sim.seen[i]) enterChase(sim, i); else enterReturn(sim, i); }
}

// US-079b (37.16.2): STATE_FLINCH is a fixed no-movement pause (the view's hurt->flinch follow-through); it always
// exits to chase (the aggro on damage sets seen, so a hit from behind turns the boar around rather than returning).
function flinchStep(sim, i) {
  sim.timer[i]--;
  if (sim.timer[i] <= 0) enterChase(sim, i);
}

function eatStep(sim, i, px, py) {
  if (noticedOf(sim, i, px, py)) { enterNotice(sim, i); return; } // the player can still interrupt the meal
  if (--sim.timer[i] <= 0) enterWander(sim, i);
}

function wanderStep(sim, i, px, py) {
  if (sim.goal.on[i]) { goalStep(sim, i, px, py); return; }
  if (sim.hunt[i]) { huntStep(sim, i, px, py); return; }
  if (noticedOf(sim, i, px, py)) { enterNotice(sim, i); return; }
  if (sim.fauna && sim.timer[i] !== WALKING) { huntLook(sim, i); if (sim.hunt[i]) return; }
  if (sim.timer[i] === WALKING) return; // following a path; arrival is handled by updatePathRequests/postOne
  sim.timer[i]--;
  if (sim.timer[i] <= 0) pickWanderTarget(sim, i);
}

/** LIFE-08: raid leg of STATE_WANDER: nearer-than-player alt target -> chase + hit; else player notice; else travel to / hold at the goal. */
function goalStep(sim, i, px, py) {
  const steer = sim.steer, sx = steer.x[i], sy = steer.y[i];
  if (sim.alt.cd[i] > 0) sim.alt.cd[i]--;
  sim.alt.tgt[i] = -1;
  if (sim.alt.cd[i] <= 0 && sim.alt.n > 0) {
    let best = -1, bd = ALT_R * ALT_R;
    for (let k = 0; k < sim.alt.n; k++) {
      const dx = sim.alt.x[k] - sx, dy = sim.alt.y[k] - sy, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = k; }
    }
    const pdx = px - sx, pdy = py - sy;
    if (best >= 0 && bd < pdx * pdx + pdy * pdy) {
      if (bd <= ALT_HIT_R * ALT_HIT_R) {
        sim.alt.cd[i] = toSteps(ALT_COOLDOWN_S);
        sim.timer[i] = sim.cfgSteps.pauseMin; sim.pathLen[i] = 0; sim.pathIdx[i] = 0; sim.pathReq[i] = 0;
        const pl = sim.pl.alt[i]; pl.alt = best;
        sim.events.emit('beast:altHit', pl);
      } else sim.alt.tgt[i] = best;
      return;
    }
  }
  if (noticedOf(sim, i, px, py)) { enterNotice(sim, i); return; }
  if (sim.atGoal(i)) { sim.timer[i] = sim.cfgSteps.pauseMin; sim.pathLen[i] = 0; return; } // hold at the goal
  if (sim.timer[i] !== WALKING) {
    sim.goalX[i] = sim.goal.tx[i]; sim.goalY[i] = sim.goal.ty[i];
    sim.pathLen[i] = 0; sim.pathIdx[i] = 0; sim.pathReq[i] = 1; sim.timer[i] = WALKING;
  }
}

function pickWanderTarget(sim, i) {
  const cfg = sim.cfg, grid = sim.grid, rng = sim.rng;
  const hx = sim.homeX[i], hy = sim.homeY[i];
  let gx = hx, gy = hy;
  for (let draw = 0; draw < 8; draw++) {
    const cx = hx + (rng.nextFloat() * 2 - 1) * cfg.wanderR;
    const cy = hy + (rng.nextFloat() * 2 - 1) * cfg.wanderR;
    const ddx = cx - hx, ddy = cy - hy;
    if (ddx * ddx + ddy * ddy > cfg.wanderR * cfg.wanderR) continue;
    const gcx = grid.cellX(cx), gcy = grid.cellY(cy);
    if (!grid.inBounds(gcx, gcy) || grid.cost[grid.index(gcx, gcy)] === 0) continue;
    gx = cx; gy = cy;
    break;
  }
  sim.goalX[i] = gx; sim.goalY[i] = gy;
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.pathReq[i] = 1;
  sim.timer[i] = WALKING;
}

function noticeStep(sim, i) {
  sim.timer[i]--;
  if (sim.timer[i] <= 0) enterChase(sim, i);
}

function checkChaseExit(sim, i, px, py) {
  const cfg = sim.cfg, steer = sim.steer;
  const dx = px - steer.x[i], dy = py - steer.y[i];
  const d2 = dx * dx + dy * dy;
  const lm = sim._lagents[i].leashMode; // leash/give-up wins over everything (even a boar in windup range)
  if (lm === LEASH_RETURN || lm === LEASH_GIVEUP) { sim.waiting[i] = 0; enterReturn(sim, i); return; }
  if ((sim.wolf[i] || sim.goblin[i]) && shouldFlee(sim, i)) { enterFlee(sim, i, px, py); return; } // WOLF-01
  if (sim.ranged[i] && rangedChase(sim, i, px, py, d2)) return; // GOB-02
  if (sim.tactOn[i] && (sim.tactRole[i] === TACT_RANGED || sim.tactRole[i] === TACT_CASTER) && tacticsBand(sim, i, d2)) { if (sim.ssteps[i].volley && sim.waiting[i] === 1) enterWindup(sim, i); return; } // BEAST-04; SKEL-ARCHER-CADENCE-01: in the band with LOS -> volley
  if (sim.bear[i] && sim.seen[i] && sim.bite.cd[i] === 0 && sim.entities[i].components.voxel.model === BEAR_MODEL
      && d2 <= BEAR_TUNING.biteReachR * BEAR_TUNING.biteReachR && bearPicksBite(i, sim.bite.n[i])) { enterBite(sim, i); return; } // BEAR-BITE
  const wr = sim.scfg[i].windupR;
  if (!sim.ranged[i] && d2 <= wr * wr && sim.seen[i]) {
    // US-079c: only one boar winds up/charges at a time - the first eligible (lowest slot) wins; the rest hold.
    if (hasActiveCharger(sim, i)) sim.waiting[i] = 1;
    else { sim.waiting[i] = 0; enterWindup(sim, i); }
    return;
  }
  sim.waiting[i] = 0;
  const lr = sim.scfg[i].loseR; // BEAR-01
  if (d2 > lr * lr || sim.unseen[i] >= sim.ssteps[i].loseSight) enterReturn(sim, i);
}

/** GOB-02: thrower distance band. waiting 2 = backing off (< bandMin), 1 = holding in the band (faces the player).
 * Returns true when it handled the tick (back-off, flee, hold, windup); false = approach (path to the player) and
 * the normal lose checks. WINDUP needs LOS (cached `seen`), a done reload (it only reaches CHASE after RECOVER) and
 * fewer than maxWinding throwers already winding up. */
function rangedChase(sim, i, px, py, d2) {
  const T = GOBLIN_TUNING;
  if (d2 < T.bandMin * T.bandMin) {
    sim.waiting[i] = 2;
    if (d2 < T.cornerR * T.cornerR) {
      if (++sim.backT[i] >= T.cornerSec * 60) { sim.backT[i] = 0; sim.waiting[i] = 0; enterFlee(sim, i, px, py); } // cornered: flee
    } else sim.backT[i] = 0;
    return true;
  }
  sim.backT[i] = 0;
  if (d2 <= T.bandMax * T.bandMax && sim.seen[i]) {
    let winding = 0;
    for (let q = 0, pr = sim.pool.rec, pn = sim.pool.n; q < pn; q++) { const k = pr[q]; if (k !== i && sim.ranged[k] && sim.state[k] === STATE_WINDUP) winding++; }
    if (winding < T.maxWinding) { sim.waiting[i] = 0; enterWindup(sim, i); } else sim.waiting[i] = 1;
    return true;
  }
  sim.waiting[i] = 0;
  return false;
}

/** GOB-02: the one `beast:throw` at windup end: hand = eye + handUp, target = the player's chest now (no lead). */
function emitThrow(sim, i, px, py, ev = 'beast:throw') {
  const p = sim.pl.throw, steer = sim.steer;
  p.id = sim.ids[i]; p.slot = i; p.dmgF = ev === 'beast:shoot' && sim.ssteps[i].dmgF > 0 ? sim.ssteps[i].dmgF : 1; // archer volley carries the kind's dmgF
  p.x = steer.x[i]; p.y = steer.y[i]; p.z = zOf(sim, i) + sim.cfg.eyeZ + GOBLIN_TUNING.handUp;
  p.tx = px; p.ty = py; p.tz = sim._pz + sim.cfg.targetZ;
  sim.events.emit(ev, p);
}

/** US-079c: true while any slot is in WINDUP or CHARGE (the single active charger). */
function hasActiveCharger(sim, me) {
  if (sim.tactOn[me]) return !sim.tactics.request(me, sim.tactRole[me] === TACT_SWARM ? TOK_S : TOK_M); // BEAST-04: token pools replace the single-charger rule
  let held = 0;
  for (let q = 0, pr = sim.pool.rec, pn = sim.pool.n; q < pn; q++) {
    const k = pr[q];
    if (k === me || sim.group[k] !== sim.group[me]) continue; // WOLF-01/GOB-01: the token is per group (wolves never block boars)
    if (sim.state[k] === STATE_WINDUP || sim.state[k] === STATE_CHARGE) held++;
  }
  return held >= (sim.group[me] >= 1 ? 2 : 1); // GOB-01 / OB-150: melee goblins AND wolves share 2 tokens (the rest circle)
}

function windupStep(sim, i, px, py) {
  void px; void py;
  sim.timer[i]--;
  // US-079c: kick a dust burst at the forefeet at 150/300/450 ms into the windup (boarFx.scrape.kickSteps).
  const elapsed = (sim.wuTot[i] || sim.ssteps[i].windup) - sim.timer[i];
  if (!sim.goblin[i] && (!sim.wolf[i] && elapsed === SCRAPE_KICKS[0] || elapsed === SCRAPE_KICKS[1] || elapsed === SCRAPE_KICKS[2])) emitScrape(sim, i);
  if (sim.timer[i] <= 0) {
    if (sim.ranged[i]) { emitThrow(sim, i, px, py); enterRecover(sim, i, false); } // GOB-02: release, then the reload
    else if (sim.ssteps[i].volley) { emitThrow(sim, i, px, py, 'beast:shoot'); enterRecover(sim, i, false); } // SKEL-ARCHER-CADENCE-01: skeleton archer volley (goblinWire fires the arrow)
    else enterCharge(sim, i, px, py);
  }
}

/** US-079c: emits one preallocated `beast:scrape` at the forefeet (z + 0.03), thrown backward - particleHooks
 * bursts the scrapeDust clods (design/models/voxel_beast.js `boarFx.scrape`). Zero allocation. */
function emitScrape(sim, i) {
  const p = sim.pl.scrape[i];
  const steer = sim.steer;
  const fx = sim.fx[i], fy = sim.fy[i];
  p.id = sim.ids[i];
  p.x = steer.x[i] + fx * SCRAPE_FORE_M;
  p.y = steer.y[i] + fy * SCRAPE_FORE_M;
  p.z = sim.entities[i].transform.z + 0.03;
  p.dirX = -fx * 0.8;
  p.dirY = -fy * 0.8;
  p.dirZ = 0.6;
  sim.events.emit('beast:scrape', p);
}

const BITE_STEPS = Math.round(BEAR_TUNING.biteMs / 1000 * 60), BITE_HIT_STEP = Math.round(BEAR_TUNING.biteHitMs / 1000 * 60);
function enterBite(sim, i) {
  sim.bite.n[i]++; sim.bite.done[i] = 0;
  sim.state[i] = STATE_BITE; sim.timer[i] = 0; // timer = steps elapsed in the bite
  sim.waiting[i] = 0; sim.steer.accel[i] = DEFAULT_ACCEL;
}

/** BEAR-BITE: holds position facing the player; one combat:hit when the jaws snap (200 ms) if still in reach. */
function biteStep(sim, i, px, py) {
  const t = ++sim.timer[i];
  if (t === BITE_HIT_STEP && !sim.bite.done[i]) {
    sim.bite.done[i] = 1;
    const dx = px - sim.steer.x[i], dy = py - sim.steer.y[i], r = BEAR_TUNING.biteReachR + 0.3;
    if (dx * dx + dy * dy <= r * r) {
      const hp = sim._hitPayload[i];
      hp.blocked = 0;
      sim.events.emit('combat:hit', hp);
      if (hp.blocked) { enterBlocked(sim, i, -dx, -dy); sim.bite.cd[i] = Math.round(BEAR_TUNING.biteCdSec * 60); return; }
    }
  }
  if (t >= BITE_STEPS) { sim.bite.cd[i] = Math.round(BEAR_TUNING.biteCdSec * 60); enterRecover(sim, i, false); }
}

function recoverStep(sim, i, px, py) {
  void px; void py;
  sim.timer[i]--;
  if (sim.timer[i] <= 0) {
    enterChase(sim, i);
    checkChaseExit(sim, i, px, py); // 29.1: "chase's lose checks apply on its first step"
  }
}

function returnStep(sim, i, px, py) {
  if (sim.fleeing[i]) { // WOLF-01: keep running until 30 m from where it started / from the player, then walk home
    if (sim.stk.cf[i] > 0 && --sim.stk.cf[i] === 0) { sim.fleeing[i] = 0; enterReturn(sim, i); return; } // SPELL-05: Light Orb Lv3 flee ends after its seconds
    const dx = px - sim.steer.x[i], dy = py - sim.steer.y[i], gx = sim.goalX[i] - sim.steer.x[i], gy = sim.goalY[i] - sim.steer.y[i];
    if (dx * dx + dy * dy >= fleeMOf(sim, i) * fleeMOf(sim, i) || gx * gx + gy * gy <= 1) { sim.fleeing[i] = 0; enterReturn(sim, i); }
    return;
  }
  if (sim._lagents[i].leashMode !== LEASH_GIVEUP && noticedOf(sim, i, px, py)) { enterNotice(sim, i); return; }
  const dx = sim.homeX[i] - sim.steer.x[i], dy = sim.homeY[i] - sim.steer.y[i];
  if (dx * dx + dy * dy <= sim.cfg.homeArriveR * sim.cfg.homeArriveR) enterWander(sim, i);
}

// ---- state entry ------------------------------------------------------------------------------------------------

/** BH2-G1: difficulty.js row -> sim ratios relative to Normal (noticeSec is absolute in the table; Normal = 0.6 s = ratio 1). */
function diffMults(name) {
  const d = resolveDifficulty(name), n = DIFFICULTY.normal;
  return { windup: d.windup, noticeR: d.noticeR, noticeSec: d.noticeSec / n.noticeSec, leash: d.leash };
}

function enterNotice(sim, i) {
  sim.state[i] = STATE_NOTICE;
  sim.timer[i] = Math.max(1, Math.round(sim.ssteps[i].notice * sim.dm.noticeSec)); // BH2-G1
}

function enterChase(sim, i) {
  sim.state[i] = STATE_CHASE;
  sim.waiting[i] = 0; // US-079c: a fresh chase is not waiting for the charger
  sim.bankT[i] = 0; sim.partialGoal[i] = 0; sim.bankHold[i] = 0; // NAV-REACH-01
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.repathT[i] = 0;
  sim.unseen[i] = 0;
  sim.pathReq[i] = 0; // (re)requested by updatePathRequests this same tick, since pathLen === 0
}

function enterWindup(sim, i) {
  if (sim.bear[i]) sim.bite.n[i]++; // BEAR-BITE: the swipe (windup+charge) also consumes one bite-vs-swipe decision
  sim.state[i] = STATE_WINDUP;
  sim.waiting[i] = 0; // US-079c: it is the charger now, not a waiter
  const wu = sim.ssteps[i].windup; // BH2-G1: windup ratio (Easy longer / Hard shorter), floored at WINDUP_FLOOR_SEC
  sim.wuTot[i] = sim.dm.windup === 1 ? wu : Math.max(Math.min(wu, Math.round(WINDUP_FLOOR_SEC / SIM_STEP)), Math.round(wu * sim.dm.windup));
  sim.timer[i] = sim.wuTot[i];
}

/** OB-150: a boar/wolf charge is a straight line locked at the end of the wind-up. A player walking straight away (3.5 m/s) used
 * to outlast the nominal 1.2 s / 0.5 s: the beast stopped 3-6 m short ("they can't touch me"). Run long enough to close the
 * gap to a player jogging off at CHARGE_FLEE_MS (cap 2.5x nominal). Bears / goblins keep their short swipe / lunge. */
const CHARGE_FLEE_MS = 4.0;
const BEAR_CATCHUP = 1.3; // OB-150: bear chase 4.0 -> 5.2 m/s (< player run 6.0, > walk 3.5)
function chargeStepsFor(sim, i, d) {
  const nominal = sim.ssteps[i].chargeMax, v = sim.scfg[i].charge;
  if (v <= CHARGE_FLEE_MS + 1) return nominal;
  const need = Math.ceil(((d + 1) / (v - CHARGE_FLEE_MS)) / SIM_STEP);
  // OB-150: bear swipe-charge 6 m/s and goblin lunge 8.3 m/s also chase a jogger (goblin dash up to 4x its 0.3 s = 1.2 s);
  // a RUNNING player (6 m/s) still outpaces the bear and out-closes the goblin dash, and the wind-up stays readable.
  return Math.min(Math.max(nominal, need), Math.round(nominal * (sim.goblin[i] ? 4 : 2.5)));
}

function enterCharge(sim, i, px, py) {
  const steer = sim.steer;
  const dx = px - steer.x[i], dy = py - steer.y[i];
  const d = Math.sqrt(dx * dx + dy * dy);
  sim.cdx[i] = d > 1e-9 ? dx / d : sim.fx[i];
  sim.cdy[i] = d > 1e-9 ? dy / d : sim.fy[i];
  sim.state[i] = STATE_CHARGE;
  sim.timer[i] = sim.chargeLen[i] = chargeStepsFor(sim, i, d);
  sim.stk.wall[i] = 0; // BH-A3: charge wall-slow streak
  steer.accel[i] = CHARGE_ACCEL * (sim.scfg[i].charge / sim.cfg.charge); // WOLF-01: faster leap -> proportionally harder start (ratio 1 for boars)
}

function enterRecover(sim, i, wall) {
  sim.state[i] = STATE_RECOVER;
  sim.timer[i] = wall ? sim.ssteps[i].recoverWall : sim.ssteps[i].recover;
  sim.steer.accel[i] = DEFAULT_ACCEL;
  if (sim.goblin[i]) { sim.steer.vx[i] = 0; sim.steer.vy[i] = 0; } // GOB-01: the 8 m/s lunge must not carry it through the player
}

/** US-078d amendment (D-034) + US-079b (37.16.2): a heavy hit staggers the beast from ANY state (interrupts
 * windup/charge - the charge wall-slow streak counter, `unseen`, is reused and so must be cleared here too, same
 * field `enterCharge` resets). `steer.vx/vy` is ASSIGNED (not added) to the knockback direction * `knock`
 * (per-slot `knockV`, US-079b replaces the shared `cfg.staggerKnock` in `setSteerTarget`); `setSteerTarget`'s
 * STAGGER branch gives `maxSpeed = knockV` so the steer clamp keeps the shove, which then decays by `DEFAULT_ACCEL`.
 * `dirX/dirY` fall back to the beast's current facing if the hit carried no direction (defensive; `sword.js` always
 * sets one). */
function enterStagger(sim, i, dirX, dirY, knock) {
  const steer = sim.steer;
  const dx = typeof dirX === 'number' ? dirX : sim.fx[i];
  const dy = typeof dirY === 'number' ? dirY : sim.fy[i];
  sim.state[i] = STATE_STAGGER;
  sim.timer[i] = sim.cfgSteps.stagger;
  sim.stk.wall[i] = 0; // BH-A3: clears the charge wall-slow streak
  sim.knockV[i] = knock;
  steer.vx[i] = dx * knock;
  steer.vy[i] = dy * knock;
  steer.accel[i] = DEFAULT_ACCEL;
}

/** EQ-06: the player's shield blocked this charge: stagger for cfgSteps.blockStagger, shoved away from the player. */
function enterBlocked(sim, i, awayX, awayY) {
  const d = Math.sqrt(awayX * awayX + awayY * awayY);
  const k = sim.cfg.blockKnock !== undefined ? sim.cfg.blockKnock : 2;
  enterStagger(sim, i, d > 1e-9 ? awayX / d : sim.fx[i] * -1, d > 1e-9 ? awayY / d : sim.fy[i] * -1, k);
  sim.timer[i] = sim.cfgSteps.blockStagger;
}

function enterReturn(sim, i) {
  sim.state[i] = STATE_RETURN;
  sim.fleeing[i] = 0;
  sim._sc.def.homeX = sim.homeX[i]; sim._sc.def.homeY = sim.homeY[i];
  const rt = returnTarget(sim._sc.def, sim._sc.lret);
  sim.goalX[i] = rt.x; sim.goalY[i] = rt.y;
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.pathReq[i] = 0;
}

/** WOLF-01: a wolf with no other living wolf within packR. */
function isLone(sim, i) {
  const st = sim.steer, pr = sim.goblin[i] ? GOBLIN_TUNING.packR : WOLF_TUNING.packR, r2 = pr * pr;
  for (let q = 0, pr = sim.pool.rec, pn = sim.pool.n; q < pn; q++) {
    const k = pr[q];
    if (k === i || sim.group[k] !== sim.group[i] || deadSt(sim.state[k])) continue; // same pack species (group 1 wolf, 2 goblin)
    const dx = st.x[k] - st.x[i], dy = st.y[k] - st.y[i];
    if (dx * dx + dy * dy <= r2) return false;
  }
  return true;
}
/** GOB-01: flee distance per species. */
const fleeMOf = (sim, i) => (sim.goblin[i] ? GOBLIN_TUNING.fleeM : WOLF_TUNING.fleeM);
function shouldFlee(sim, i) {
  const h = sim.entities[i].components.health;
  return h.hp > 0 && h.hp < h.max * (sim.goblin[i] ? GOBLIN_TUNING.fleeHpFrac : WOLF_TUNING.fleeHpFrac) && isLone(sim, i);
}
/** WOLF-01: run WOLF_TUNING.fleeM straight away from the player (falls back to going home if that spot is a wall). */
function enterFlee(sim, i, px, py) {
  sim.stk.cf[i] = 0; // SPELL-ARCH8: a stale calm-flee count must not cut a later flee short (calmFlee re-sets it after sim.flee)
  const steer = sim.steer, t = sim.sc.tmp, S = 0.7071067811865476;
  awayTarget(steer.x[i], steer.y[i], px, py, fleeMOf(sim, i), t);
  // try straight away, then +-45 deg (vector rotation, no trig), then half distance; else just go home
  const ax = t.x - steer.x[i], ay = t.y - steer.y[i];
  let found = false, gx = 0, gy = 0;
  for (let k = 0; k < 6 && !found; k++) {
    const sc = k < 3 ? 1 : 0.5, rx = k % 3 === 0 ? ax : (k % 3 === 1 ? (ax - ay) * S : (ax + ay) * S), ry = k % 3 === 0 ? ay : (k % 3 === 1 ? (ax + ay) * S : (ay - ax) * S);
    gx = steer.x[i] + rx * sc; gy = steer.y[i] + ry * sc;
    found = walkable(sim.grid, gx, gy, steer.z[i]);
  }
  enterReturn(sim, i);
  if (!found) return;
  sim.fleeing[i] = 1; sim.goalX[i] = gx; sim.goalY[i] = gy;
}

function enterWander(sim, i) {
  sim.fleeing[i] = 0;
  sim.state[i] = STATE_WANDER;
  sim.provoked[i] = 0;
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.timer[i] = sim.cfgSteps.pauseMin + sim.rng.int(sim.cfgSteps.pauseMax - sim.cfgSteps.pauseMin + 1);
}

// ---- US-079b (37.16.2) hurt / death / corpse ---------------------------------------------------------------

/** The reaction a hit provokes in a still-alive beast (37.16.2 item 5; also called from the dmgCd>0 item-2 branch,
 * where the damage step was skipped but the physical/visual reaction still applies). `hurtT` was already reset for
 * a damaging hit, so "flash only" below is just "no state change" - the view flashes off `hurtT`. */
function reactToHit(sim, i, p) {
  if (p.freezeSec > 0) { applyFreeze(sim, i, p.freezeSec); return; } // SPELL-R2
  if (sim.wat[i] === 1) { waterHit(sim.wb, sim, i, p); return; } // BEAST-08b
  const st = sim.state[i];
  if (p.heavy) {
    const knock = p.knock > 0 ? p.knock : sim.cfg.staggerKnock;
    if (knock >= 1) { enterStagger(sim, i, p.dirX, p.dirY, Math.min(knock, 12)); if (p.stunSec > 0) sim.timer[i] = Math.round(p.stunSec * 60); return; } // SPELL-05: Spark sets its own stun time
    enterFlinch(sim, i); // fire with a tiny falloff (knock < 1) -> flinch
    return;
  }
  if (sim.goblin[i] && st !== STATE_STAGGER) { enterRecover(sim, i, false); return; } // GOB-01: scatter - a damaging hit enters the retreat
  if (st === STATE_WINDUP && !sim.bear[i]) { enterRecover(sim, i, false); return; } // AC: a light hit cancels the charge
  if (st === STATE_CHARGE || st === STATE_STAGGER || ((st === STATE_WINDUP || st === STATE_BITE) && sim.bear[i])) return; // BEAR-01: an arrow doesn't break the bluff          // D-034: only a hard hit stops a charge
  enterFlinch(sim, i);
}

/** SPELL-R2 Freeze: stagger with zero knock = no move, no attack, for `sec` s (re-freeze refreshes, never stacks); level > 7 = half time. A croc releases its grab. */
function applyFreeze(sim, i, sec) {
  const steps = Math.max(1, Math.round(sec * 60 * (sim.stk.lv[i] > 7 ? 0.5 : 1)));
  if (sim.wat[i] === 1) { waterFreeze(sim.wb, sim, i, steps); return; }
  enterStagger(sim, i, 0, 0, 0);
  sim.timer[i] = steps;
  sim.steer.vx[i] = 0; sim.steer.vy[i] = 0;
}

function enterFlinch(sim, i) {
  sim.state[i] = STATE_FLINCH;
  sim.timer[i] = sim.cfgSteps.flinch;
  sim.steer.vx[i] = 0; sim.steer.vy[i] = 0; // a clean stop: the flinch is a no-movement pause
}

function enterDying(sim, i) {
  const steer = sim.steer;
  sim.state[i] = STATE_DYING;
  sim.timer[i] = sim.cfgSteps.die;
  sim.deathZ[i] = sim.entities[i].transform.z;
  // No separation, not stepped: drop the steer agent. transform.x/y keep the last postOne write (the death spot),
  // and postOne is skipped for dead states, so the corpse freezes in place.
  steer.vx[i] = 0; steer.vy[i] = 0;
  steer.removeAgent(i);
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0; sim.pathReq[i] = 0; // nothing left to serve for a dead slot
  sim.pendingDied[i] = 1; // `beast:died` emits at the START of the next step (never inside this listener)
}

function enterCorpse(sim, i) {
  sim.state[i] = STATE_CORPSE;
  sim.timer[i] = sim.cfgSteps.corpse;
}

function enterSink(sim, i) {
  sim.state[i] = STATE_SINK;
  sim.timer[i] = sim.cfgSteps.sink;
  sim.entities[i].transform.z = sim.deathZ[i]; // k = 0
  const p = sim.pl.sink[i];
  p.x = sim.entities[i].transform.x;
  p.y = sim.entities[i].transform.y;
  p.z = sim.deathZ[i];
  sim.events.emit('beast:sink', p); // particleHooks bursts the corpse dust here
}

/** Deferred `beast:died` (37.16.2): exactly once, at the start of the step AFTER the kill. */
function emitPendingDied(sim, i) {
  if (!sim.pendingDied[i]) return;
  sim.pendingDied[i] = 0;
  const p = sim.pl.died[i];
  p.x = sim.entities[i].transform.x;
  p.y = sim.entities[i].transform.y;
  p.z = sim.deathZ[i];
  p.cause = CAUSE_STR[sim.cause[i]];
  sim.events.emit('beast:died', p);
}

/** Runs the dead-state timeline in place of perception/path/steer/post (37.16.2). */
function stepDead(sim, i) {
  const st = sim.state[i];
  if (st === STATE_DYING) {
    sim.timer[i]--;
    if (sim.timer[i] <= 0) {
      // despawnReq set during DYING (looted the instant it died) is honoured at CORPSE entry: no minimum lie time.
      if (sim.despawnReq[i]) enterSink(sim, i); else enterCorpse(sim, i);
    }
  } else if (st === STATE_CORPSE) {
    sim.timer[i]--;
    if (sim.despawnReq[i] || sim.timer[i] <= 0) enterSink(sim, i);
  } else if (st === STATE_SINK) {
    sim.timer[i]--;
    if (sim.timer[i] < 0) sim.timer[i] = 0;
    const k = sim.cfgSteps.sink - sim.timer[i]; // 1..30
    sim.entities[i].transform.z = sim.deathZ[i] - sim.cfg.sinkM * (k / sim.cfgSteps.sink);
    if (sim.timer[i] <= 0) sim.state[i] = STATE_GONE;
  }
  // STATE_GONE: nothing.
}

// ---- paths (29.1 step 3) -------------------------------------------------------------------------------------

function updatePathRequests(sim, px, py) {
  const rec = sim.pool.rec, n = sim.pool.n, cfg = sim.cfg;
  for (let k = 0; k < n; k++) {
    const i = rec[k];
    if (deadSt(sim.state[i])) continue; // US-079b: dead slots don't path
    if (sim.repathT[i] > 0) sim.repathT[i]--;
    if (sim.pathReq[i]) continue;
    const st = sim.state[i];
    sim.bankHold[i] = 0;
    if (st === STATE_CHASE) {
      if (sim.waiting[i]) continue; // US-079c: a waiter holds position (no path into the player)
      // NAV-REACH-01: target unreachable -> walk to the nearest reachable cell, hold there facing it, give up after REACH_GIVEUP_STEPS
      if (sim.partialGoal[i] && sim.pathLen[i] > 0 && sim.pathIdx[i] >= sim.pathLen[i] - 1) {
        const b = sim.pool.lv[i] * PATH_SLOTS * 2 + (sim.pathLen[i] - 1) * 2;
        const ex = sim.path[b] - sim.steer.x[i], ey = sim.path[b + 1] - sim.steer.y[i];
        if (ex * ex + ey * ey < 1) {
          if (++sim.bankT[i] >= REACH_GIVEUP_STEPS) { sim.bankT[i] = 0; sim.partialGoal[i] = 0; enterReturn(sim, i); continue; }
          sim.bankHold[i] = 1;
          if (sim.repathT[i] <= 0) {
            const dx = px - sim.goalX[i], dy = py - sim.goalY[i];
            if (dx * dx + dy * dy > cfg.repathMoveM * cfg.repathMoveM) { sim.goalX[i] = px; sim.goalY[i] = py; sim.pathReq[i] = 1; }
          }
          continue;
        }
      }
      if (sim.pathLen[i] === 0 || sim.pathIdx[i] >= sim.pathLen[i]) {
        sim.goalX[i] = px; sim.goalY[i] = py; sim.pathReq[i] = 1;
      } else if (sim.repathT[i] <= 0) {
        const dx = px - sim.goalX[i], dy = py - sim.goalY[i];
        if (dx * dx + dy * dy > cfg.repathMoveM * cfg.repathMoveM) {
          sim.goalX[i] = px; sim.goalY[i] = py; sim.pathReq[i] = 1;
        }
      }
    } else if (st === STATE_RETURN) {
      if (sim.pathLen[i] === 0 || sim.pathIdx[i] >= sim.pathLen[i]) sim.pathReq[i] = 1;
    } else if (st === STATE_WANDER && sim.timer[i] === WALKING) {
      if (sim.pathLen[i] === 0 || sim.pathIdx[i] >= sim.pathLen[i]) sim.pathReq[i] = 1;
    }
  }
}

/** At most one `findPath` per tick, round robin from the slot after the last one served (29.1 step 3). */
function servePathRequest(sim, px, py) {
  void px; void py;
  const n = sim.pool.n, pr = sim.pool.rec;
  if (n === 0) return;
  let s0 = 0; while (s0 < n && pr[s0] <= sim.lastServed) s0++; // pool list is sorted by record index: start after the last served record
  for (let k = 0; k < n; k++) {
    const i = pr[(s0 + k) % n];
    if (sim.pathReq[i] && !deadSt(sim.state[i])) {
      computePath(sim, i);
      sim.pathReq[i] = 0;
      sim.repathT[i] = sim.cfgSteps.repath;
      sim.lastServed = i;
      return;
    }
  }
}

function computePath(sim, i) {
  const grid = sim.grid, astar = sim.astar, steer = sim.steer;
  const sx = grid.cellX(steer.x[i]), sy = grid.cellY(steer.y[i]);
  const gx = grid.cellX(sim.goalX[i]), gy = grid.cellY(sim.goalY[i]);
  const maxNodes = sim.state[i] === STATE_WANDER && !sim.goal.on[i] ? WANDER_MAX_NODES : TRAVEL_MAX_NODES;
  // NAV-LAYERS-01d: with sheets the start/goal are located by z (goal z = sim.goalZ[i] when a caller provides one, else the ground cell); ground-only grids take the unchanged path
  const len = grid.layers
    ? findPathCells(astar, grid.locate(steer.x[i], steer.y[i], zOf(sim, i)), grid.locate(sim.goalX[i], sim.goalY[i], sim.goalZ ? sim.goalZ[i] : NaN), sim._cellPath, { maxNodes })
    : findPath(astar, sx, sy, gx, gy, sim._cellPath, { maxNodes });
  sim.stats.astar++;
  sim.partialGoal[i] = sim.state[i] === STATE_CHASE && astar.partial ? 1 : 0;
  if (!sim.partialGoal[i]) sim.bankT[i] = 0;
  sim.stats.astarNodes += len; // approximation: findPath does not expose expanded-node count (see report deviations)
  const wn = len > 0 ? smoothPath(grid, sim._cellPath, len, sim._xy) : 0;
  storePath(sim, i, wn);
}

function storePath(sim, i, wn) {
  const base = sim.pool.lv[i] * PATH_SLOTS * 2;
  if (wn === 0) { sim.pathLen[i] = 0; sim.pathIdx[i] = 0; return; }
  let m = wn;
  if (m > PATH_SLOTS) {
    for (let w = 0; w < PATH_SLOTS - 1; w++) {
      sim.path[base + w * 2] = sim._xy[w * 2];
      sim.path[base + w * 2 + 1] = sim._xy[w * 2 + 1];
    }
    sim.path[base + (PATH_SLOTS - 1) * 2] = sim.goalX[i];
    sim.path[base + (PATH_SLOTS - 1) * 2 + 1] = sim.goalY[i];
    m = PATH_SLOTS;
  } else {
    for (let w = 0; w < m; w++) {
      sim.path[base + w * 2] = sim._xy[w * 2];
      sim.path[base + w * 2 + 1] = sim._xy[w * 2 + 1];
    }
  }
  sim.pathLen[i] = m;
  sim.pathIdx[i] = 0;
}

// ---- steer targets (29.1 step 4) -----------------------------------------------------------------------------

const REACH_GIVEUP_STEPS = 180; // NAV-REACH-01: 3 s holding at the bank, then RETURN
const STUCK_STEPS = 90;      // BEAST-01: 1.5 s
const STUCK_MOVE_M = 0.1;
/** BEAST-01: measured speed (displacement of the last step, EMA) + stuck rule. Runs before prevX is overwritten. */
function measureAndUnstick(sim, i, st) {
  const steer = sim.steer;
  const dx = steer.x[i] - sim.prevX[i], dy = steer.y[i] - sim.prevY[i];
  const inst = Math.sqrt(dx * dx + dy * dy) * 60;
  const m = sim.mv[i] += (Math.min(inst, 30) - sim.mv[i]) * 0.2;
  if (m > 0.15) sim.moving[i] = 1; else if (m < 0.05) sim.moving[i] = 0;
  if (sim.stk.st[i] !== st) { sim.stk.st[i] = st; sim.stk.fail[i] = 0; sim.stk.t[i] = 0; }
  if (m > 0.5) sim.stk.fail[i] = 0;
  // wants to move: walking wander / chase not waiting / return, and not already at its goal
  let want = (st === STATE_WANDER && sim.timer[i] === WALKING) || st === STATE_RETURN || (st === STATE_CHASE && !sim.waiting[i]);
  if (sim.bankHold[i]) want = false; // NAV-REACH-01: deliberate hold at the bank
  if (want) {
    const gx = st === STATE_CHASE ? sim._px : sim.goalX[i], gy = st === STATE_CHASE ? sim._py : sim.goalY[i];
    const ex = gx - steer.x[i], ey = gy - steer.y[i];
    if (ex * ex + ey * ey < (st === STATE_CHASE ? 6 : 1)) want = false; // arrived / in melee range
  }
  if (!want) { sim.stk.t[i] = 0; return; }
  const ax = steer.x[i] - sim.stk.ax[i], ay = steer.y[i] - sim.stk.ay[i];
  if (sim.stk.t[i] === 0 || ax * ax + ay * ay >= STUCK_MOVE_M * STUCK_MOVE_M) { sim.stk.ax[i] = steer.x[i]; sim.stk.ay[i] = steer.y[i]; sim.stk.t[i] = 1; return; }
  if (++sim.stk.t[i] < STUCK_STEPS) return;
  sim.stk.t[i] = 0;
  if (sim.stk.fail[i] < 2) { // re-plan (fresh A* to the same goal; chase re-targets the player)
    sim.stk.fail[i]++;
    sim.pathLen[i] = 0; sim.pathIdx[i] = 0; sim.pathReq[i] = 1;
    if (st === STATE_CHASE) { sim.goalX[i] = sim._px; sim.goalY[i] = sim._py; }
    return;
  }
  sim.stk.fail[i] = 0; // give up this target
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0; sim.pathReq[i] = 0;
  if (st === STATE_CHASE) enterReturn(sim, i);
  else enterWander(sim, i);
}

function setSteerTarget(sim, i) {
  const steer = sim.steer, cfg = sim.cfg;
  measureAndUnstick(sim, i, sim.state[i]);
  const st = sim.state[i];
  sim.prevX[i] = steer.x[i];
  sim.prevY[i] = steer.y[i];

  if (st === STATE_CHARGE) {
    const wx = steer.x[i] + sim.cdx[i] * 20, wy = steer.y[i] + sim.cdy[i] * 20;
    steer.setWaypoint(i, wx, wy, 0);
    steer.maxSpeed[i] = sim.scfg[i].charge * sim.spdMul[i];
    return;
  }

  if (st === STATE_WANDER && sim.hunt[i]) { // LIFE-07: direct steer at the prey (no A*; the NavGrid still blocks)
    const ps = sim.fauna.slots[sim.huntSlot[i]];
    steer.setWaypoint(i, ps.x, ps.y, 0);
    steer.maxSpeed[i] = sim.scfg[i].chase * sim.spdMul[i];
    return;
  }

  if (st === STATE_WANDER && sim.goal.on[i] && sim.alt.tgt[i] >= 0) { // LIFE-08: direct steer at the villager point
    steer.setWaypoint(i, sim.alt.x[sim.alt.tgt[i]], sim.alt.y[sim.alt.tgt[i]], 0);
    steer.maxSpeed[i] = sim.scfg[i].chase * sim.spdMul[i];
    return;
  }

  if (sim.tactOn[i] && st === STATE_CHASE) { // BEAST-04: flank slot / band / behind-allies waypoint
    if (sim.tactRole[i] === TACT_CASTER) tacticsAllies(sim, i);
    if (tacticsSteer(sim, i, sim.sc.tS)) { const o = sim.tactics.out; steer.setWaypoint(i, o.x, o.y, 0); steer.maxSpeed[i] = sim.scfg[i].chase * o.speed * sim.spdMul[i]; return; }
  }
  if (sim.ranged[i] && st === STATE_CHASE && sim.waiting[i] === 2) { // GOB-02: back off from the player
    awayTarget(steer.x[i], steer.y[i], sim._px, sim._py, GOBLIN_TUNING.backoffM, sim.sc.tmp);
    steer.setWaypoint(i, sim.sc.tmp.x, sim.sc.tmp.y, 0); steer.maxSpeed[i] = sim.scfg[i].chase * GOBLIN_TUNING.backoffSpeedMul * sim.spdMul[i]; return;
  }

  if (sim.packer[i]) { // WOLF-01/GOB-01: retreat after the leap, circle while another wolf holds the token
    const wc = sim.scfg[i], tmp = sim.sc.tmp;
    if (st === STATE_RECOVER) {
      awayTarget(steer.x[i], steer.y[i], sim._px, sim._py, sim.goblin[i] ? GOBLIN_TUNING.retreatM : WOLF_TUNING.retreatM, tmp);
      steer.setWaypoint(i, tmp.x, tmp.y, 0); steer.maxSpeed[i] = wc.chase; return;
    }
    if (st === STATE_CHASE && sim.waiting[i]) {
      const CT = sim.goblin[i] ? GOBLIN_TUNING : WOLF_TUNING;
      if (!flankTarget(sim, i, 3.5, tmp)) circleTarget(steer.x[i], steer.y[i], sim._px, sim._py, (CT.circleMin + CT.circleMax) / 2, (i & 1) ? 1 : -1, tmp);
      steer.setWaypoint(i, tmp.x, tmp.y, 0); steer.maxSpeed[i] = wc.chase * CT.circleSpeedMul; return;
    }
  }

  // US-078d amendment + US-079b: waypoint = own position (arrive 0), maxSpeed = knockV (per-slot, replaces the
  // shared cfg.staggerKnock) - the steer clamp then keeps the knockback velocity `enterStagger` assigned, decaying
  // it by `accel` (DEFAULT_ACCEL) toward 0.
  if (st === STATE_STAGGER) {
    steer.setWaypoint(i, steer.x[i], steer.y[i], 0);
    steer.maxSpeed[i] = sim.knockV[i];
    return;
  }

  // US-079c: a CHASE boar waiting its turn (another boar is the charger) holds position at ~windup range.
  if (st === STATE_CHASE && (sim.waiting[i] || sim.bankHold[i])) {
    steer.setWaypoint(i, steer.x[i], steer.y[i], 0);
    steer.maxSpeed[i] = 0;
    return;
  }

  // OB-150: a bear/goblin that SEES the player within 10 m steers straight at them instead of at the (up to 3.5 m stale) A* goal,
  // so a player walking away no longer leaves the chaser stalling at the old waypoint. Near-field only; the NavGrid still blocks.
  if (st === STATE_CHASE && !sim.ranged[i] && !sim.tactOn[i] && sim.seen[i] && !sim.partialGoal[i]) {
    const ddx = sim._px - steer.x[i], ddy = sim._py - steer.y[i];
    if (ddx * ddx + ddy * ddy < 256 && straightWalkable(sim, steer.x[i], steer.y[i], ddx, ddy)) {
      steer.setWaypoint(i, sim._px, sim._py, 0);
      steer.maxSpeed[i] = sim.scfg[i].chase * (sim.bear[i] ? BEAR_CATCHUP : 1) * sim.spdMul[i];
      return;
    }
  }

  let speed = 0;
  if ((st === STATE_WANDER && sim.timer[i] === WALKING) || st === STATE_CHASE || st === STATE_RETURN) {
    advanceWaypoint(sim, i);
    const base = sim.pool.lv[i] * PATH_SLOTS * 2, idx = Math.min(sim.pathIdx[i], Math.max(0, sim.pathLen[i] - 1));
    const wx = sim.pathLen[i] > 0 ? sim.path[base + idx * 2] : steer.x[i];
    const wy = sim.pathLen[i] > 0 ? sim.path[base + idx * 2 + 1] : steer.y[i];
    steer.setWaypoint(i, wx, wy, WAYPOINT_ARRIVE);
    speed = (st === STATE_CHASE ? sim.scfg[i].chase * (sim.bear[i] ? BEAR_CATCHUP : 1) : (st === STATE_RETURN ? (sim.fleeing[i] ? sim.scfg[i].chase : cfg.returnSpeed) : sim.scfg[i].walk)) * sim.spdMul[i];
  } else {
    steer.setWaypoint(i, steer.x[i], steer.y[i], 0);
  }
  steer.maxSpeed[i] = speed;
}

/** OB-150: true when every ~1 m sample along (x,y)+(dx,dy) is a walkable nav cell (so steering straight at the player cannot run into a wall/water). */
function straightWalkable(sim, x, y, dx, dy) {
  const g = sim.grid; if (!g || !g.cost) return false;
  const d = Math.sqrt(dx * dx + dy * dy), n = Math.ceil(d);
  for (let k = 1; k <= n; k++) {
    const f = k / n, cx = g.cellX(x + dx * f), cy = g.cellY(y + dy * f);
    if (!g.inBounds(cx, cy) || g.cost[cy * g.w + cx] === 0) return false;
  }
  return true;
}

/** OB-150 group pressure: a waiting wolf/goblin takes a flank spot around the player instead of queueing behind the pack.
 * The lowest live slot of the group is the lead (its bearing is the reference); the others sit at +-120 deg (3+) or 180 deg (2)
 * from it, `r` m out. Trig-free (fixed sin/cos of 120 deg). Returns false when `i` is the lead / alone (-> plain circle). */
const FL_C = -0.5, FL_S = 0.8660254;
function flankTarget(sim, i, r, out) {
  const g = sim.group[i], n = sim.pool.n, pr = sim.pool.rec;
  let lead = -1, alive = 0, rank = 0;
  for (let q = 0; q < n; q++) {
    const k = pr[q];
    if (sim.group[k] !== g || sim.down[k] || deadSt(sim.state[k]) || sim.state[k] === STATE_GONE) continue;
    const dx = sim.steer.x[k] - sim._px, dy = sim.steer.y[k] - sim._py;
    if (dx * dx + dy * dy > 625) continue; // packR
    if (lead < 0) lead = k;
    alive++; if (k < i) rank++;
  }
  if (lead < 0 || lead === i || alive < 2) return false;
  let ux = sim.steer.x[lead] - sim._px, uy = sim.steer.y[lead] - sim._py; const d = Math.sqrt(ux * ux + uy * uy) || 1;
  ux /= d; uy /= d;
  let c = -1, sn = 0; // 2 members: opposite side
  if (alive >= 3) { c = FL_C; sn = (rank & 1) ? FL_S : -FL_S; }
  out.x = sim._px + (ux * c - uy * sn) * r; out.y = sim._py + (ux * sn + uy * c) * r;
  return true;
}

function advanceWaypoint(sim, i) {
  const steer = sim.steer, base = sim.pool.lv[i] * PATH_SLOTS * 2;
  while (sim.pathIdx[i] < sim.pathLen[i] - 1) {
    const idx = sim.pathIdx[i];
    const dx = sim.path[base + idx * 2] - steer.x[i], dy = sim.path[base + idx * 2 + 1] - steer.y[i];
    if (dx * dx + dy * dy >= WAYPOINT_ADVANCE_D2) break;
    sim.pathIdx[i]++;
  }
}

// ---- post (29.1 step 6) ----------------------------------------------------------------------------------------

const _pp = new Float64Array(3);
function postOne(sim, i) {
  const steer = sim.steer, cfg = sim.cfg, world = sim.world, px = _pp[0], py = _pp[1];

  if (sim.state[i] === STATE_CHARGE) chargePost(sim, i, px, py);

  // Contact (any state, though only charge realistically reaches it): beast <-> player 2D distance.
  const dx = px - steer.x[i], dy = py - steer.y[i];
  const contactR = cfg.radius + PHYSICS.radius + CONTACT_PAD;
  if (sim.state[i] === STATE_CHARGE && dx * dx + dy * dy <= contactR * contactR) {
    const hp = sim._hitPayload[i];
    hp.blocked = 0;
    sim.events.emit('combat:hit', hp);
    if (hp.blocked) enterBlocked(sim, i, -dx, -dy); // EQ-06: shield block -> 0.4 s stagger instead of recover
    else enterRecover(sim, i, false);
  }

  // Facing: velocity direction when moving; the player's direction in notice/windup; frozen while staggered
  // (US-078d amendment: "Facing frozen" - a knockback slide must not spin the beast to face the shove).
  if (sim.state[i] === STATE_STAGGER) {
    // frozen
  } else if (sim.state[i] === STATE_NOTICE || sim.state[i] === STATE_WINDUP || sim.state[i] === STATE_BITE
             || (sim.state[i] === STATE_CHASE && (sim.waiting[i] || sim.bankHold[i]))) {
    // US-079c: a waiting boar faces the player while holding (so it reads as aware, like notice/windup).
    const ddx = px - steer.x[i], ddy = py - steer.y[i];
    const d = Math.sqrt(ddx * ddx + ddy * ddy);
    if (d > 1e-9) { sim.fx[i] = ddx / d; sim.fy[i] = ddy / d; }
  } else {
    const vx = steer.vx[i], vy = steer.vy[i];
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > 0.1) { sim.fx[i] = vx / speed; sim.fy[i] = vy / speed; }
  }

  // Ground: supportAt reads the floor under the beast (terrain or mesh collider); z never integrates gravity.
  const t = sim.entities[i].transform;
  _supportOut[0] = steer.x[i]; _supportOut[1] = steer.y[i]; _supportOut[2] = t.z + 0.6;
  world.supportAtOut(true, _supportOpts, _supportOut);
  t.x = steer.x[i];
  t.y = steer.y[i];
  t.z = _supportOut[3];
}

const _supportOut = new Float64Array(10); // BEAST-ALLOC-02: world.supportAtOut io (in x,y,footZ; floorH at [3])
const _supportOpts = { height: 0, stepUpMax: 1.0, walkCos: -1 };

function chargePost(sim, i, px, py) {
  void px; void py;
  const steer = sim.steer;
  const dx = steer.x[i] - sim.prevX[i], dy = steer.y[i] - sim.prevY[i];
  const moved2 = dx * dx + dy * dy;
  const chargeStep = Math.max(sim.chargeLen[i], sim.ssteps[i].chargeMax) - sim.timer[i]; // OB-150: chargeLen is 0 when a test forces STATE_CHARGE
  const thresh = WALL_SPEED_FRAC * sim.scfg[i].charge * SIM_STEP;
  if (chargeStep >= 4) {
    if (moved2 < thresh * thresh) {
      sim.stk.wall[i]++;
      if (sim.stk.wall[i] >= WALL_STREAK) { enterRecover(sim, i, true); return; }
    } else {
      sim.stk.wall[i] = 0;
    }
  }
  sim.timer[i]--;
  if (sim.timer[i] <= 0 && sim.state[i] === STATE_CHARGE) enterRecover(sim, i, false);
}

// ---- US-079c (BUG-BOAR-OVERLAP) hard pairwise de-overlap ------------------------------------------------------

/** True if the centre point (x,y) lands in a walkable NavGrid cell - the exact check engine/nav/steer.js's step
 * uses for its axis-sliding wall clamp (`cellWalkable`), re-stated here so the de-overlap can reuse it (steer.js
 * does not export it). Zero allocation. */
function walkable(grid, x, y, z) {
  if (grid.layers) { // BH-A4: sheets (ruin floors) count, like steer.walkableQ
    const li = grid.locate(x, y, z);
    if (li < 0) return false;
    return li >= grid.w * grid.h || grid.cost[li] !== 0;
  }
  const cx = grid.cellX(x);
  const cy = grid.cellY(y);
  return grid.inBounds(cx, cy) && grid.cost[grid.index(cx, cy)] !== 0;
}

// Proposed position handed to applyPush through a module scratch (BEAST-ALLOC-01: double args box at a non-inlined call).
const _push = new Float64Array(2);

/** Applies the proposed `_push` (nx,ny) with the same axis-sliding wall clamp as steer.step: full move if walkable, else the
 * x or y axis alone if that stays walkable, else stay put (no tunnelling through a cost-0 cell). */
function applyPush(steer, grid, slot) {
  const ox = steer.x[slot], oy = steer.y[slot], nx = _push[0], ny = _push[1];
  const z = steer.z[slot];
  if (walkable(grid, nx, ny, z)) { steer.x[slot] = nx; steer.y[slot] = ny; }
  else if (walkable(grid, nx, oy)) { steer.x[slot] = nx; }
  else if (walkable(grid, ox, ny)) { steer.y[slot] = ny; }
  // else: blocked on both axes -> stay.
}

/**
 * US-079c (BUG-BOAR-OVERLAP): after `steer.step`, push any two overlapping beasts apart to `rA + rB` with a
 * mass-split (each moves by the OTHER's mass share; equal radius = half each). Fixed ascending index order (i < j,
 * a Gauss-Seidel pass over the post-steer positions), deterministic, zero allocation, skips inactive (dead) steer
 * slots, and every push is wall-clamped by `applyPush` so it can never tunnel through a cost-0 cell.
 */
function deOverlap(sim) {
  const steer = sim.steer, grid = sim.grid;
  const rec = sim.pool.rec, n = sim.pool.n;
  for (let a = 0; a < n; a++) {
    const i = rec[a];
    if (!steer.active[i]) continue; // US-079c ARCH (37.16.2): skip inactive (dead) steer slots
    for (let b = a + 1; b < n; b++) {
      const j = rec[b];
      if (!steer.active[j]) continue;
      const dx = steer.x[j] - steer.x[i];
      const dy = steer.y[j] - steer.y[i];
      const rSum = steer.radius[i] + steer.radius[j];
      const d2 = dx * dx + dy * dy;
      if (d2 >= rSum * rSum) continue;
      const d = Math.sqrt(d2);
      let ux, uy;
      if (d > 1e-9) { ux = dx / d; uy = dy / d; }
      else { ux = 1; uy = 0; } // exactly coincident: fixed +x axis (deterministic)
      const overlap = rSum - d;
      const mi = steer.radius[i] * steer.radius[i];
      const mj = steer.radius[j] * steer.radius[j];
      const inv = 1 / (mi + mj);
      _push[0] = steer.x[i] - ux * overlap * mj * inv; _push[1] = steer.y[i] - uy * overlap * mj * inv; applyPush(steer, grid, i);
      _push[0] = steer.x[j] + ux * overlap * mi * inv; _push[1] = steer.y[j] + uy * overlap * mi * inv; applyPush(steer, grid, j);
    }
  }
}

// ---- hash / save / load / reset --------------------------------------------------------------------------------

function hashSim(sim, h) {
  const n = sim.count;
  h.u32(sim.tick);
  h.u8Array(sim.state, 0, n);
  h.u32Array(sim.timer, 0, n);
  h.u32Array(sim.dmgCd, 0, n);
  h.u32Array(sim.hurtT, 0, n);
  h.u32Array(sim.unseen, 0, n);
  h.u8Array(sim.stk.wall, 0, n);
  h.u32Array(sim.stk.cf, 0, n); // SPELL-ARCH8: calm-flee steps and the Light Orb zone change beast behaviour
  { const c = sim.stk.calm; h.i32(c.on); h.f64(c.x); h.f64(c.y); h.f64(c.r2); h.i32(c.lv); }
  h.u32Array(sim.repathT, 0, n);
  for (let i = 0; i < n; i++) {
    h.f64(sim.homeX[i]); h.f64(sim.homeY[i]); h.f64(sim.homeZ[i]);
    h.f64(sim.fx[i]); h.f64(sim.fy[i]);
    h.f64(sim.cdx[i]); h.f64(sim.cdy[i]);
    h.f64(sim.goalX[i]); h.f64(sim.goalY[i]);
    h.f64(sim.prevX[i]); h.f64(sim.prevY[i]);
    h.f64(sim.deathZ[i]); h.f64(sim.knockV[i]);
    h.u32(sim.entities[i].components.health.hp);
  }
  h.u32Array(sim.pathLen, 0, n);
  h.u32Array(sim.pathIdx, 0, n);
  for (let i = 0; i < n; i++) h.i32(sim.pool.lv[i]); // BEAST-POOL-b: binding state
  { const bt = sim.spell.blindT; let any = false; for (let i = 0; i < n; i++) if (bt[i]) { any = true; break; } if (any) h.u32Array(bt, 0, n); } // SPELL-R4: only while someone is blind (golden hash unchanged)
  h.u8Array(sim.seen, 0, n);
  h.u8Array(sim.pathReq, 0, n);
  h.u8Array(sim.pendingDied, 0, n);
  h.u8Array(sim.despawnReq, 0, n);
  h.u8Array(sim.cause, 0, n);
  if (sim.fauna) { h.u8Array(sim.hunt, 0, n); h.u32Array(sim.huntT, 0, n); }
  sim.steer.hashInto(h);
}

function saveSim(sim) {
  const n = sim.count;
  const slice = (a) => Array.from(a.subarray(0, n));
  const hp = new Array(n);
  for (let i = 0; i < n; i++) hp[i] = sim.entities[i].components.health.hp;
  return {
    tick: sim.tick,
    lastServed: sim.lastServed,
    state: slice(sim.state), timer: slice(sim.timer), unseen: slice(sim.unseen), repathT: slice(sim.repathT),
    dmgCd: slice(sim.dmgCd), hurtT: slice(sim.hurtT),
    homeX: slice(sim.homeX), homeY: slice(sim.homeY), homeZ: slice(sim.homeZ), fx: slice(sim.fx), fy: slice(sim.fy),
    cdx: slice(sim.cdx), cdy: slice(sim.cdy), goalX: slice(sim.goalX), goalY: slice(sim.goalY),
    prevX: slice(sim.prevX), prevY: slice(sim.prevY),
    deathZ: slice(sim.deathZ), knockV: slice(sim.knockV),
    pathLen: slice(sim.pathLen), pathIdx: slice(sim.pathIdx), seen: slice(sim.seen), pathReq: slice(sim.pathReq),
    pendingDied: slice(sim.pendingDied), despawnReq: slice(sim.despawnReq), cause: slice(sim.cause),
    path: Array.from(sim.path.subarray(0, Math.min(n * PATH_SLOTS * 2, sim.path.length))),
    hp,
    pool: { // in-memory/dev snapshot only (the persistent save is slot-free): the pool-indexed path/steer data needs its bindings back
      lv: slice(sim.pool.lv), lastX: slice(sim.pool.lastX), lastY: slice(sim.pool.lastY),
      rec: Array.from(sim.pool.rec.subarray(0, sim.pool.n)), n: sim.pool.n,
      free: Array.from(sim.pool.free.subarray(0, sim.pool.freeN)), freeN: sim.pool.freeN,
      dormTile: slice(sim.dormTile), dormant: slice(sim.dormant),
    },
    steer: {
      x: slice(sim.steer.x), y: slice(sim.steer.y), vx: slice(sim.steer.vx), vy: slice(sim.steer.vy),
      radius: slice(sim.steer.radius), mode: slice(sim.steer.mode), tx: slice(sim.steer.tx), ty: slice(sim.steer.ty),
      arriveR: slice(sim.steer.arriveR), maxSpeed: slice(sim.steer.maxSpeed), accel: slice(sim.steer.accel),
      active: slice(sim.steer.active),
    },
  };
}

function loadSim(sim, obj) {
  const n = sim.count;
  sim.tick = obj.tick;
  sim.lastServed = obj.lastServed;
  for (let i = 0; i < n; i++) {
    sim.state[i] = obj.state[i]; sim.timer[i] = obj.timer[i]; sim.unseen[i] = obj.unseen[i]; sim.repathT[i] = obj.repathT[i];
    sim.dmgCd[i] = obj.dmgCd[i]; sim.hurtT[i] = obj.hurtT[i];
    sim.homeX[i] = obj.homeX[i]; sim.homeY[i] = obj.homeY[i]; sim.homeZ[i] = obj.homeZ[i]; sim.fx[i] = obj.fx[i]; sim.fy[i] = obj.fy[i];
    sim.cdx[i] = obj.cdx[i]; sim.cdy[i] = obj.cdy[i]; sim.goalX[i] = obj.goalX[i]; sim.goalY[i] = obj.goalY[i];
    sim.prevX[i] = obj.prevX[i]; sim.prevY[i] = obj.prevY[i];
    sim.deathZ[i] = obj.deathZ[i]; sim.knockV[i] = obj.knockV[i];
    sim.pathLen[i] = obj.pathLen[i]; sim.pathIdx[i] = obj.pathIdx[i]; sim.seen[i] = obj.seen[i]; sim.pathReq[i] = obj.pathReq[i];
    sim.pendingDied[i] = obj.pendingDied[i]; sim.despawnReq[i] = obj.despawnReq[i]; sim.cause[i] = obj.cause[i];
    sim.entities[i].components.health.hp = obj.hp[i];
    sim.steer.x[i] = obj.steer.x[i]; sim.steer.y[i] = obj.steer.y[i]; sim.steer.vx[i] = obj.steer.vx[i]; sim.steer.vy[i] = obj.steer.vy[i];
    sim.steer.radius[i] = obj.steer.radius[i]; sim.steer.mode[i] = obj.steer.mode[i]; sim.steer.tx[i] = obj.steer.tx[i]; sim.steer.ty[i] = obj.steer.ty[i];
    sim.steer.arriveR[i] = obj.steer.arriveR[i]; sim.steer.maxSpeed[i] = obj.steer.maxSpeed[i]; sim.steer.accel[i] = obj.steer.accel[i];
    sim.steer.active[i] = obj.steer.active[i]; // US-079b: a dead slot must come back as inactive, not a ghost agent
    sim.entities[i].transform.x = sim.steer.x[i];
    sim.entities[i].transform.y = sim.steer.y[i];
  }
  sim.path.set(obj.path);
  if (obj.pool) {
    const P = sim.pool, o = obj.pool;
    for (let i = 0; i < n; i++) { P.lv[i] = o.lv[i]; P.lastX[i] = o.lastX[i]; P.lastY[i] = o.lastY[i]; sim.dormTile[i] = o.dormTile[i]; sim.dormant[i] = o.dormant[i]; }
    P.n = o.n; for (let k = 0; k < o.n; k++) P.rec[k] = o.rec[k];
    P.freeN = o.freeN; for (let k = 0; k < o.freeN; k++) P.free[k] = o.free[k];
  }
  resyncLeash(sim);
}

/** Leash mode/timer are derived from the brain state (not saved/hashed): engaged states resume ENGAGE with a fresh timer. */
function resyncLeash(sim) {
  for (let i = 0; i < sim.count; i++) {
    const st = sim.state[i], ag = sim._lagents[i];
    ag.leashT = 0;
    ag.leashMode = st === STATE_WANDER || st === STATE_EAT || deadSt(st) ? LEASH_HOME : (st === STATE_RETURN ? LEASH_RETURN : LEASH_ENGAGE);
  }
}

function resetAllSim(sim) {
  for (let i = 0; i < sim.count; i++) { sim.down[i] = 0; resetSlotSim(sim, i); }
  resyncLeash(sim);
  sim.events.emit('beasts:reset'); // US-079b: loot clears its corpse state on this
}

/** SPELL-R4 (38.80): Teleport lv3. Live beasts in an aggro state within r m (2D) of (x, y) go to STATE_WANDER and cannot perceive for `sec` s. -> count. Cold path. */
export function loseTrack(sim, x, y, r, sec) {
  const r2 = r * r, steps = Math.min(65535, Math.round(sec / SIM_STEP));
  let n = 0;
  for (let i = 0; i < sim.count; i++) {
    const st = sim.state[i];
    if (FREE_ST[st] || st === STATE_RETURN || deadSt(st) || st === STATE_GONE) continue;
    const dx = sim.steer.x[i] - x, dy = sim.steer.y[i] - y;
    if (dx * dx + dy * dy > r2) continue;
    sim.spell.blindT[i] = steps; sim.seen[i] = 0; sim.unseen[i] = 0; sim.fleeing[i] = 0;
    sim.state[i] = STATE_WANDER; sim.timer[i] = sim.cfgSteps.pauseMin; sim.pathLen[i] = 0; sim.pathIdx[i] = 0; sim.pathReq[i] = 0;
    sim.steer.setIdle(i); n++;
  }
  return n;
}

/** One slot back to home, alive, state wander (shared by resetAll and setDown(slot, false)). */
function resetSlotSim(sim, i) {
  sim.spell.blindT[i] = 0; // SPELL-R4
  sim.bite.cd[i] = 0; sim.bite.n[i] = 0; sim.bite.done[i] = 0; // BEAR-BITE
  // US-079b: dead steer slots are re-added in ascending order; addAgent hands out the lowest free slot, and the
  // live slots stay active (slots >= count are never used), so the lowest free slot is always the lowest dead one.
  if (sim.pool.lv[i] >= 0 && !sim.steer.active[i] && !sim.dormant[i]) { // BEAST-POOL-b: unbound records stay parked; the binder activates them
    sim.steer.activateAgent(i, sim.homeX[i], sim.homeY[i], sim.cfg.radius, 0, DEFAULT_ACCEL);
  }
  sim.pool.lastX[i] = sim.homeX[i]; sim.pool.lastY[i] = sim.homeY[i];
  const health = sim.entities[i].components.health;
  health.hp = health.max; // US-079b: boars come back alive
  sim.goal.on[i] = 0; sim.alt.tgt[i] = -1; sim.alt.cd[i] = 0; // LIFE-08: raids restart next night
  sim.hunt[i] = 0; sim.dmgCd[i] = 0; sim.hurtT[i] = 9999; sim.pendingDied[i] = 0; sim.despawnReq[i] = 0; sim.cause[i] = 0; sim.provoked[i] = 0;
  sim.steer.x[i] = sim.homeX[i]; sim.steer.y[i] = sim.homeY[i];
  sim.steer.vx[i] = 0; sim.steer.vy[i] = 0;
  sim.steer.setIdle(i);
  sim.steer.accel[i] = DEFAULT_ACCEL;
  sim.state[i] = STATE_WANDER;
  sim.timer[i] = sim.cfgSteps.pauseMin;
  sim.unseen[i] = 0; sim.repathT[i] = 0; sim.seen[i] = 0; sim.pathReq[i] = 0;
  sim.waiting[i] = 0; sim.fleeing[i] = 0; // US-079c / WOLF-01
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.entities[i].transform.x = sim.homeX[i];
  sim.entities[i].transform.y = sim.homeY[i];
  sim.entities[i].transform.z = sim.homeZ[i]; // US-079b ARCH: a sunk corpse respawns at the authored z, not 0.3 m low
}
