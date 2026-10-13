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
import { createAStar, findPath, smoothPath, createSteer, PHYSICS, SIM_STEP } from '../../../../engine/index.js';
import { BEAST_DEFAULTS, toSteps } from './beastConfig.js';
import { tierMult } from './band.js';
import { canSee } from './sight.js';
import { BEAR_TUNING, bearOverrides, isBearEntity } from './bearBrain.js'; // BEAR-01
import { WOLF_TUNING, wolfOverrides, isWolfEntity, circleTarget, awayTarget } from './wolfBrain.js'; // WOLF-01
import { GOBLIN_TUNING, goblinOverrides, isGoblinEntity } from './goblinBrain.js'; // GOB-01
import { perceive, leashState, returnTarget, LEASH_HOME, LEASH_ENGAGE, LEASH_RETURN, LEASH_GIVEUP } from '../../../../engine/index.js';

export const MAX_BEASTS = 96; // GOB-01: boars + wolves + bears + goblin camps (was 32; loot.js MAX_SLOTS must match)
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
const FIRST_DEAD_STATE = STATE_DYING;
const deadSt = (st) => st >= FIRST_DEAD_STATE && st <= STATE_GONE; // EAT (13) is alive
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
const _astarCache = new WeakMap(); // WM-04: one A* per nav tile grid; WeakMap keyed by the grid -> freed when BandCache evicts the bundle (and rebindNav moved on), no extra eviction code
function astarFor(grid) { let a = _astarCache.get(grid); if (!a) { a = createAStar(grid); _astarCache.set(grid, a); } return a; }

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

  const count = Math.min(beastEntities.length, MAX_BEASTS);
  if (beastEntities.length > MAX_BEASTS) {
    console.warn(`createBeastSim: ${beastEntities.length} beast entities, only the first ${MAX_BEASTS} get a brain.`);
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
    maxAgents: MAX_BEASTS,
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
    noise: 1, // BEAST-PERCEIVE-01w: hearing multiplier of the player this step (1 walk, NOISE_SPRINT, NOISE_SWING); caller sets it
    // preallocated adapter scratch for engine/nav perceive + leash (zero alloc per step)
    _slot: 0,
    _pa: { x: 0, y: 0, fx: 0, fy: 0, coneCos: cfg.coneCos, range: cfg.noticeR, hearR: cfg.nearR, homeX: 0, homeY: 0, homeR: 0 },
    _pt: { x: 0, y: 0, noise: 1 },
    _po: { sees: false, hears: false, dist: 0, returnHome: false },
    _lt: { x: 0, y: 0 },
    _lret: { x: 0, y: 0, speed: 0 },
    _ldef: { homeX: 0, homeY: 0, homeR: cfg.homeArriveR, leashR: cfg.leashR, aggroR: cfg.loseR / cfg.loseScale,
             loseScale: cfg.loseScale, returnSpeed: cfg.returnSpeed, giveUpT: cfg.giveUpSec },
    _lagents: null,
    _losFn: null,
    entities: beastEntities.slice(0, count),
    ids: beastEntities.slice(0, count).map((e) => e.id),

    spdMul: new Float64Array(MAX_BEASTS).fill(1), // US-129a: per-slot tier speed multiplier (set once at create)
    tier: new Uint8Array(MAX_BEASTS),
    state: new Uint8Array(MAX_BEASTS),
    timer: new Int32Array(MAX_BEASTS),
    unseen: new Int32Array(MAX_BEASTS), // also reused as the charge wall-slow streak counter (charge never needs "unseen")
    repathT: new Int32Array(MAX_BEASTS),
    homeX: new Float64Array(MAX_BEASTS),
    homeY: new Float64Array(MAX_BEASTS),
    homeZ: new Float64Array(MAX_BEASTS), // US-079b ARCH: the respawn z (restored by resetAll; a sunk corpse respawns 0.3 m low otherwise)
    fx: new Float64Array(MAX_BEASTS),
    fy: new Float64Array(MAX_BEASTS),
    cdx: new Float64Array(MAX_BEASTS),
    cdy: new Float64Array(MAX_BEASTS),
    goalX: new Float64Array(MAX_BEASTS),
    goalY: new Float64Array(MAX_BEASTS),
    mv: new Float32Array(MAX_BEASTS),       // BEAST-01: smoothed measured ground speed (m/s), view + stuck rule (not hashed)
    moving: new Uint8Array(MAX_BEASTS),     // BEAST-01: hysteresis flag (on > 0.15 m/s, off < 0.05 m/s)
    stkT: new Int32Array(MAX_BEASTS),       // BEAST-01: steps spent wanting to move without leaving the anchor
    stkAx: new Float64Array(MAX_BEASTS), stkAy: new Float64Array(MAX_BEASTS),
    stkFail: new Uint8Array(MAX_BEASTS),    // failed re-plans in a row
    stkSt: new Uint8Array(MAX_BEASTS),
    prevX: new Float64Array(MAX_BEASTS),
    prevY: new Float64Array(MAX_BEASTS),
    path: new Float64Array(MAX_BEASTS * PATH_SLOTS * 2),
    pathLen: new Int32Array(MAX_BEASTS),
    pathIdx: new Int32Array(MAX_BEASTS),
    wary: new Uint8Array(MAX_BEASTS),        // DRESS-01b: brain.temperament==='wary' (ambient boars: short notice + leash until hit)
    provoked: new Uint8Array(MAX_BEASTS),    // DRESS-01b: a wary beast that took damage fights normally until it is back in wander
    seen: new Uint8Array(MAX_BEASTS),
    pathReq: new Uint8Array(MAX_BEASTS),
    dmgCd: new Int32Array(MAX_BEASTS),       // US-079b (37.16.2): steps left in the damage cooldown
    hurtT: new Int32Array(MAX_BEASTS),       // US-079b: steps since the last damage (view flash window, saturating)
    deathZ: new Float64Array(MAX_BEASTS),    // US-079b: the z the beast died at (corpse/sink anchor)
    pendingDied: new Uint8Array(MAX_BEASTS), // US-079b: beast:died is deferred to the next step's start
    despawnReq: new Uint8Array(MAX_BEASTS),  // US-079b: looted -> sink at the next CORPSE entry
    cause: new Uint8Array(MAX_BEASTS),       // US-079b: 0 sword, 1 fire (indexes CAUSE_STR)
    knockV: new Float64Array(MAX_BEASTS),    // US-079b: per-slot stagger clamp speed (replaces shared cfg.staggerKnock)
    wolf: new Uint8Array(MAX_BEASTS),        // WOLF-01: brain.species==='wolf' (per-slot cfg below, pack token, circle, flee)
    bear: new Uint8Array(MAX_BEASTS),        // BEAR-01: brain.species==='bear' (per-slot cfg, fixed 2-heart swipe, light hits don't cancel windup)
    goblin: new Uint8Array(MAX_BEASTS),      // GOB-01: brain.species==='goblin'
    group: new Uint8Array(MAX_BEASTS),       // GOB-01: attack-token group 0 boar/bear, 1 wolf, 2 goblin
    ranged: new Uint8Array(MAX_BEASTS),      // GOB-02: goblin role 'thrower' (distance band, windup -> beast:throw, reload = RECOVER)
    backT: new Uint16Array(MAX_BEASTS),      // GOB-02: steps a thrower has spent backing off inside cornerR
    packer: new Uint8Array(MAX_BEASTS),      // GOB-01: wolf or melee goblin (circle while waiting, retreat after the strike)
    down: new Uint8Array(MAX_BEASTS),        // GOB-01b: setDown(slot, true) -> STATE_GONE until setDown(slot, false) (not hashed/saved)
    dormCamp: new Uint8Array(MAX_BEASTS), dormTile: new Uint8Array(MAX_BEASTS), tileMode: false, // WM-04 reasons
    dormant: new Uint8Array(MAX_BEASTS),     // GOB-01: setDormant(slot, true) -> skipped like GONE, state kept
    fleeing: new Uint8Array(MAX_BEASTS),     // WOLF-01: STATE_RETURN that runs away from the player first
    hunt: new Uint8Array(MAX_BEASTS),        // LIFE-07: 1 = STATE_WANDER leg chasing a fauna prey slot (huntSlot)
    huntSlot: new Int32Array(MAX_BEASTS), huntT: new Int32Array(MAX_BEASTS), preyMask: new Int32Array(MAX_BEASTS),
    goalOn: new Uint8Array(MAX_BEASTS), goalTX: new Float64Array(MAX_BEASTS), goalTY: new Float64Array(MAX_BEASTS), // LIFE-08: setGoal override
    altTgt: new Int32Array(MAX_BEASTS).fill(-1), altCd: new Int32Array(MAX_BEASTS), // LIFE-08: alt chase index / re-hit cooldown (steps)
    altN: 0, altX: new Float64Array(MAX_ALT), altY: new Float64Array(MAX_ALT),
    _altPayload: beastEntities.slice(0, count).map((e, k) => ({ slot: k, alt: 0, id: e.id })),
    fauna: opts.fauna || null, _prey: { x: 0, y: 0 }, _thrX: new Float64Array(16), _thrY: new Float64Array(16),
    scfg: [], ssteps: [],                    // WOLF-01: per-slot cfg / cfgSteps (the shared objects for boars)
    _throwPayload: { id: '', slot: 0, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }, // GOB-02: ONE preallocated beast:throw payload (reused)
    _pz: 0, _px: 0, _py: 0, _tmp: { x: 0, y: 0 },
    waiting: new Uint8Array(MAX_BEASTS),     // US-079c: CHASE boar holding while another boar is the charger (derived, not saved)

    tick: 0,
    lastServed: -1,
    stats: { astar: 0, astarNodes: 0 },

    // Scratch (zero allocation after create): findPath's `outPath` must hold >= grid.w*grid.h entries (astar.js
    // contract); smoothPath's output is at most that many waypoints before truncation to PATH_SLOTS.
    _cellPath: new Int32Array(grid.w * grid.h),
    _xy: new Float64Array(grid.w * grid.h * 2),
    // US-079c: a charge contact emits `damage: 1`; vitals scales it by `beastDamageScale` (5) -> 5 HP per charge
    // hit (the AC's "6 hits from 30 HP kill"). Verified end-to-end in beastSim.test.js.
    _hitPayload: beastEntities.slice(0, count).map((e) => ({ source: e.id, target: 'player', damage: 1, blocked: 0 })),
    // US-079b: preallocated emit payloads (one per slot, never reallocated). `beast:died` carries the cause string
    // resolved from the 2-entry CAUSE_STR table; `beast:sink` the dust-burst position for particleHooks.
    _diedPayload: beastEntities.slice(0, count).map((e) => ({ id: e.id, x: 0, y: 0, z: 0, cause: 'sword' })),
    _sinkPayload: beastEntities.slice(0, count).map((e) => ({ id: e.id, x: 0, y: 0, z: 0 })),
    // US-079c: preallocated windup scrape emit payload (forefeet position + backward kick direction).
    _scrapePayload: beastEntities.slice(0, count).map((e) => ({ id: e.id, x: 0, y: 0, z: 0, dirX: 0, dirY: 0, dirZ: 0 })),
  };

  sim._lagents = [];
  for (let i = 0; i < count; i++) sim._lagents.push({ x: 0, y: 0, leashMode: LEASH_HOME, leashT: 0 });
  sim._losFn = () => sim.seen[sim._slot] === 1; // cached periodic LOS (sampled in perceiveOne), not a fresh ray

  for (let i = 0; i < count; i++) {
    const e = sim.entities[i];
    const home = (e.components.brain && e.components.brain.home) || [e.transform.x, e.transform.y];
    sim.homeX[i] = home[0];
    sim.homeY[i] = home[1];
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
    sim.tier[i] = tier; sim.spdMul[i] = m.speed; sim._hitPayload[i].damage = sim.bear[i] ? BEAR_TUNING.swipeHearts : m.damage; // BEAR-01: swipe is a fixed 2 hearts
    const maxHp = Math.round(sim.scfg[i].hp * m.hp);
    e.components.health = { hp: maxHp, max: maxHp, invuln: 0 };
    steer.addAgent(e.transform.x, e.transform.y, cfg.radius, 0, DEFAULT_ACCEL);
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
    const health = sim.entities[i].components.health;
    if (sim.dmgCd[i] > 0) { // 37.16.2 item 2: ignore damage, still flash/flinch; heavy knockback still applies
      reactToHit(sim, i, p);
      return;
    }
    if (p.damage > 0) { // 37.16.2 item 3: damage + cooldown + hurt + cause + aggro
      health.hp -= p.damage;
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

  sim.step = function step(px, py, pz) { stepSim(sim, px, py, pz); };
  sim.dispose = function dispose() { offCombatHit(); };
  sim.hashInto = function hashInto(h) { hashSim(sim, h); };
  sim.save = function save() { return saveSim(sim); };
  sim.load = function load(obj) { loadSim(sim, obj); };
  /** US-080a1: every slot back to home, state wander, timers/paths cleared, steer positions reset. */
  sim.resetAll = function resetAll() { resetAllSim(sim); };
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
    sim.goalOn[slot] = 1; sim.goalTX[slot] = x; sim.goalTY[slot] = y;
    sim.altTgt[slot] = -1; sim.altCd[slot] = 0;
    if (sim.state[slot] === STATE_WANDER && !sim.hunt[slot]) { sim.timer[slot] = sim.cfgSteps.pauseMin; sim.pathLen[slot] = 0; sim.pathIdx[slot] = 0; sim.pathReq[slot] = 0; }
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
  };
  /** WM-04: nav-tile / 200 m dormancy (separate reason from the camp's, so a camp wake never wakes a tile-dormant beast). */
  sim.setTileDormant = function setTileDormant(slot, on) {
    if (slot < 0 || slot >= sim.count) return;
    sim.dormTile[slot] = on ? 1 : 0;
    applyDormant(slot);
  };
  /** WM-04: the live nav tile swapped (`world:band` ev.nav). Rebinds grid, A-star and steer bounds, clears paths so live ones re-plan
   *  on the new tile (hunters/travellers request a path at once), then re-evaluates tile dormancy. */
  sim.rebindNav = function rebindNav(navGrid, px, py) {
    if (!navGrid || navGrid === sim.grid) return;
    sim.tileMode = true;
    sim.grid = navGrid;
    sim.astar = astarFor(navGrid);
    if (sim._cellPath.length < navGrid.w * navGrid.h) { sim._cellPath = new Int32Array(navGrid.w * navGrid.h); sim._xy = new Float64Array(navGrid.w * navGrid.h * 2); }
    sim.steer.bounds.x0 = navGrid.x0; sim.steer.bounds.y0 = navGrid.y0;
    for (let i = 0; i < sim.count; i++) {
      if (deadSt(sim.state[i])) continue;
      sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
      // an agent with a goal (chase / travel / goal override) asks for a fresh path on the new tile
      if (sim.dormant[i] === 0 && (sim.goalOn[i] || sim.state[i] === STATE_CHASE || sim.state[i] === STATE_RETURN)) sim.pathReq[i] = 1; else sim.pathReq[i] = 0;
    }
    sim.updateTileDormancy(px, py);
  };
  /** WM-04: dormant when the home is outside the live tile or > TILE_DORMANT_R from the player. Cheap (count <= MAX_BEASTS), call ~1 Hz. */
  sim.updateTileDormancy = function updateTileDormancy(px, py) {
    if (!sim.tileMode) return;
    const g = sim.grid, x1 = g.x0 + g.w * g.cell, y1 = g.y0 + g.h * g.cell, r2 = TILE_DORMANT_R * TILE_DORMANT_R;
    for (let i = 0; i < sim.count; i++) {
      const hx = sim.homeX[i], hy = sim.homeY[i], dx = hx - px, dy = hy - py;
      const out = hx < g.x0 || hy < g.y0 || hx >= x1 || hy >= y1 || dx * dx + dy * dy > r2;
      sim.setTileDormant(i, out);
    }
  };
  /** GOB-01b: on -> slot goes to STATE_GONE (steer agent dropped, hidden, skipped); off -> back alive at home, hp max. */
  sim.setDown = function setDown(slot, on) {
    if (slot < 0 || slot >= sim.count) return;
    if (on) {
      if (sim.down[slot]) return;
      sim.down[slot] = 1; sim.dormant[slot] = 0; sim.dormCamp[slot] = 0; sim.dormTile[slot] = 0;
      // park (not remove) a live agent: removeAgent/addAgent hands out the lowest free slot, parking keeps slot ids stable
      if (sim.steer.active[slot]) { sim.steer.vx[slot] = 0; sim.steer.vy[slot] = 0; sim.steer.active[slot] = 0; sim.down[slot] = 2; }
      sim.state[slot] = STATE_GONE; sim.pendingDied[slot] = 0; sim.despawnReq[slot] = 0;
      sim.pathLen[slot] = 0; sim.pathIdx[slot] = 0; sim.pathReq[slot] = 0; sim.seen[slot] = 0; sim.goalOn[slot] = 0;
    } else if (sim.down[slot]) {
      if (sim.down[slot] === 2) sim.steer.active[slot] = 1;
      sim.down[slot] = 0; sim.dormant[slot] = 0; sim.dormCamp[slot] = 0; sim.dormTile[slot] = 0;
      resetSlotSim(sim, slot);
      resyncLeash(sim);
    }
  };
  sim.isDown = function isDown(slot) { return slot >= 0 && slot < sim.count && sim.down[slot] === 1; };
  /** GOB-01b: a live slot runs away from the player (last stepped position) like a low-hp wolf/goblin flee. */
  sim.flee = function flee(slot) {
    if (slot < 0 || slot >= sim.count || sim.down[slot] || sim.dormant[slot] || deadSt(sim.state[slot])) return;
    enterFlee(sim, slot, sim._px, sim._py);
  };
  sim.isDormant = function isDormant(slot) { return slot >= 0 && slot < sim.count && sim.dormant[slot] === 1; };
  /** LIFE-08: drop the goal override; a wandering beast walks back home (STATE_RETURN). */
  sim.clearGoal = function clearGoal(slot) {
    if (slot < 0 || slot >= sim.count || !sim.goalOn[slot]) return;
    sim.goalOn[slot] = 0; sim.altTgt[slot] = -1;
    if (sim.state[slot] === STATE_WANDER) enterReturn(sim, slot);
  };
  sim.hasGoal = function hasGoal(slot) { return slot >= 0 && slot < sim.count && sim.goalOn[slot] === 1; };
  /** LIFE-08: true once a goal beast stands within GOAL_ARRIVE_R of its goal. */
  sim.atGoal = function atGoal(slot) {
    if (!sim.hasGoal(slot)) return false;
    const dx = sim.goalTX[slot] - sim.steer.x[slot], dy = sim.goalTY[slot] - sim.steer.y[slot];
    return dx * dx + dy * dy <= GOAL_ARRIVE_R * GOAL_ARRIVE_R;
  };
  /** LIFE-08: up to 8 extra targets (villager points). A goal beast that finds one nearer than the player chases it; reaching it emits `beast:altHit {slot, alt, id}`. n = 0 clears. */
  sim.setAltTargets = function setAltTargets(n, xs, ys) {
    n = Math.min(n | 0, MAX_ALT);
    for (let k = 0; k < n; k++) { sim.altX[k] = xs[k]; sim.altY[k] = ys[k]; }
    sim.altN = n > 0 ? n : 0;
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

  // arch fix (WM-04): a grid world's nav IS a tile -> tile dormancy applies from creation, not only after the first swap (opts.spawn optional: without it only the out-of-tile rule runs)
  if (opts.tileNav) { sim.tileMode = true; sim.updateTileDormancy(opts.spawn ? opts.spawn.x : NaN, opts.spawn ? opts.spawn.y : NaN); }

  return sim;
}

// ---- step pipeline (29.1 "Fixed-step order inside step") ----------------------------------------------------

/** GOB-01: a slot that perceives, paths, steers and posts (not dead/GONE, not dormant). */
const live = (sim, i) => !deadSt(sim.state[i]) && sim.dormant[i] === 0;

function stepSim(sim, px, py, pz) {
  const n = sim.count;
  sim._px = px; sim._py = py; sim._pz = pz;
  // US-079b (37.16.2): `beast:died` goes out at the START of the step after the kill (exactly once), so the sword
  // is never mid-iteration when a loot spawn would rebuild its target list.
  for (let i = 0; i < n; i++) emitPendingDied(sim, i);
  // US-079b: cooldown/hurt timers tick for every slot; dead slots run their own timeline (stepDead).
  for (let i = 0; i < n; i++) {
    if (sim.dmgCd[i] > 0) sim.dmgCd[i]--;
    if (sim.hurtT[i] < 9999) sim.hurtT[i]++;
    if (deadSt(sim.state[i])) stepDead(sim, i);
  }
  if (sim.fauna) huntPass(sim);
  for (let i = 0; i < n; i++) if (live(sim, i)) { perceiveOne(sim, i, px, py, pz); leashOne(sim, i, px, py); }
  for (let i = 0; i < n; i++) if (live(sim, i)) transitionOne(sim, i, px, py);
  updatePathRequests(sim, px, py);
  servePathRequest(sim, px, py);
  for (let i = 0; i < n; i++) if (live(sim, i)) setSteerTarget(sim, i);
  sim.steer.step(SIM_STEP, sim.grid);
  deOverlap(sim); // US-079c (BUG-BOAR-OVERLAP): hard pairwise push-apart, after the soft steer step, before post
  for (let i = 0; i < n; i++) if (live(sim, i)) postOne(sim, i, px, py, pz);
  sim.tick++;
}

/** LIFE-07: feed live beast positions to fauna as threat points; end hunts that left STATE_WANDER. Only runs with fauna. */
function huntPass(sim) {
  const n = sim.count, steer = sim.steer;
  let t = 0;
  for (let i = 0; i < n; i++) {
    if (sim.hunt[i] && sim.state[i] !== STATE_WANDER) sim.hunt[i] = 0;
    if (!deadSt(sim.state[i]) && t < 16) { sim._thrX[t] = steer.x[i]; sim._thrY[t] = steer.y[i]; t++; }
  }
  sim.fauna.setThreats(t, sim._thrX, sim._thrY);
}

/** LIFE-07: a wandering (not walking-to-a-point-noticed) predator looks for prey once a second (staggered). */
function huntLook(sim, i) {
  if (!sim.preyMask[i] || sim.tick % 60 !== i % 60) return;
  const k = sim.fauna.nearestPrey(sim.steer.x[i], sim.steer.y[i], HUNT_R, sim._prey, sim.preyMask[i]);
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
  // BEAST-PERCEIVE-01w: engine/nav/perceive through a thin adapter. hearing = the "nearR" any-direction bubble
  // (scaled by the player's noise), sight = noticeR + cone + the cached LOS flag. Same numbers as before at noise 1.
  const steer = sim.steer, a = sim._pa, t = sim._pt;
  a.x = steer.x[i]; a.y = steer.y[i]; a.fx = sim.fx[i]; a.fy = sim.fy[i];
  t.x = px; t.y = py; t.noise = sim.noise;
  const calm = sim.wary[i] === 1 && sim.provoked[i] === 0; // DRESS-01b: unprovoked ambient boar = short notice only
  a.range = calm ? sim.cfg.calmNoticeR : sim.scfg[i].noticeR; /* BEAR-01: per-slot */ a.hearR = calm ? sim.cfg.calmNearR : sim.cfg.nearR;
  sim._slot = i;
  const o = perceive(a, t, sim._losFn, sim._po);
  return o.hears || o.sees;
}

/** BEAST-PERCEIVE-01w: keep the engine leash mode in step with the brain state, then advance it (engaged states only). */
function leashOne(sim, i, px, py) {
  const ag = sim._lagents[i], def = sim._ldef, st = sim.state[i];
  if (st === STATE_WANDER || st === STATE_EAT) { ag.leashMode = LEASH_HOME; ag.leashT = 0; return; }
  if (st === STATE_RETURN) { if (ag.leashMode !== LEASH_GIVEUP) ag.leashMode = LEASH_RETURN; return; }
  if (ag.leashMode === LEASH_HOME || ag.leashMode === LEASH_RETURN) { ag.leashMode = LEASH_ENGAGE; ag.leashT = 0; }
  if (ag.leashMode === LEASH_GIVEUP) return; // stays given-up until the beast is home (wander resets it)
  ag.x = sim.steer.x[i]; ag.y = sim.steer.y[i];
  def.homeX = sim.homeX[i]; def.homeY = sim.homeY[i];
  def.aggroR = sim.scfg[i].loseR / sim.cfg.loseScale; // BEAR-01: per-slot (identical for boars/wolves)
  def.leashR = sim.wary[i] === 1 && sim.provoked[i] === 0 ? sim.cfg.calmLeashR : sim.scfg[i].leashR;
  const t = sim._lt; t.x = px; t.y = py;
  leashState(ag, def, t, SIM_STEP);
}

function transitionOne(sim, i, px, py) {
  switch (sim.state[i]) {
    case STATE_WANDER: wanderStep(sim, i, px, py); break;
    case STATE_EAT: eatStep(sim, i, px, py); break;
    case STATE_NOTICE: noticeStep(sim, i); break;
    case STATE_CHASE: checkChaseExit(sim, i, px, py); break;
    case STATE_WINDUP: windupStep(sim, i, px, py); break;
    case STATE_CHARGE: /* handled in postOne (needs the post-steer position) */ break;
    case STATE_RECOVER: recoverStep(sim, i, px, py); break;
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
  if (sim.goalOn[i]) { goalStep(sim, i, px, py); return; }
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
  if (sim.altCd[i] > 0) sim.altCd[i]--;
  sim.altTgt[i] = -1;
  if (sim.altCd[i] <= 0 && sim.altN > 0) {
    let best = -1, bd = ALT_R * ALT_R;
    for (let k = 0; k < sim.altN; k++) {
      const dx = sim.altX[k] - sx, dy = sim.altY[k] - sy, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = k; }
    }
    const pdx = px - sx, pdy = py - sy;
    if (best >= 0 && bd < pdx * pdx + pdy * pdy) {
      if (bd <= ALT_HIT_R * ALT_HIT_R) {
        sim.altCd[i] = toSteps(ALT_COOLDOWN_S);
        sim.timer[i] = sim.cfgSteps.pauseMin; sim.pathLen[i] = 0; sim.pathIdx[i] = 0; sim.pathReq[i] = 0;
        const pl = sim._altPayload[i]; pl.alt = best;
        sim.events.emit('beast:altHit', pl);
      } else sim.altTgt[i] = best;
      return;
    }
  }
  if (noticedOf(sim, i, px, py)) { enterNotice(sim, i); return; }
  if (sim.atGoal(i)) { sim.timer[i] = sim.cfgSteps.pauseMin; sim.pathLen[i] = 0; return; } // hold at the goal
  if (sim.timer[i] !== WALKING) {
    sim.goalX[i] = sim.goalTX[i]; sim.goalY[i] = sim.goalTY[i];
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
  const wr = sim.scfg[i].windupR;
  if (!sim.ranged[i] && d2 <= wr * wr && sim.seen[i]) {
    // US-079c: only one boar winds up/charges at a time - the first eligible (lowest slot) wins; the rest hold.
    if (hasActiveCharger(sim, i)) sim.waiting[i] = 1;
    else { sim.waiting[i] = 0; enterWindup(sim, i); }
    return;
  }
  sim.waiting[i] = 0;
  const lr = sim.scfg[i].loseR; // BEAR-01
  if (d2 > lr * lr || sim.unseen[i] >= sim.cfgSteps.loseSight) enterReturn(sim, i);
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
    for (let k = 0; k < sim.count; k++) if (k !== i && sim.ranged[k] && sim.state[k] === STATE_WINDUP) winding++;
    if (winding < T.maxWinding) { sim.waiting[i] = 0; enterWindup(sim, i); } else sim.waiting[i] = 1;
    return true;
  }
  sim.waiting[i] = 0;
  return false;
}

/** GOB-02: the one `beast:throw` at windup end: hand = eye + handUp, target = the player's chest now (no lead). */
function emitThrow(sim, i, px, py) {
  const p = sim._throwPayload, steer = sim.steer;
  p.id = sim.ids[i]; p.slot = i;
  p.x = steer.x[i]; p.y = steer.y[i]; p.z = zOf(sim, i) + sim.cfg.eyeZ + GOBLIN_TUNING.handUp;
  p.tx = px; p.ty = py; p.tz = sim._pz + sim.cfg.targetZ;
  sim.events.emit('beast:throw', p);
}

/** US-079c: true while any slot is in WINDUP or CHARGE (the single active charger). */
function hasActiveCharger(sim, me) {
  let held = 0;
  for (let k = 0; k < sim.count; k++) {
    if (k === me || sim.group[k] !== sim.group[me]) continue; // WOLF-01/GOB-01: the token is per group (wolves never block boars)
    if (sim.state[k] === STATE_WINDUP || sim.state[k] === STATE_CHARGE) held++;
  }
  return held >= (sim.group[me] === 2 ? GOBLIN_TUNING.tokens : 1); // GOB-01: melee goblins share 2 tokens
}

function windupStep(sim, i, px, py) {
  void px; void py;
  sim.timer[i]--;
  // US-079c: kick a dust burst at the forefeet at 150/300/450 ms into the windup (boarFx.scrape.kickSteps).
  const elapsed = sim.ssteps[i].windup - sim.timer[i];
  if (!sim.goblin[i] && (!sim.wolf[i] && elapsed === SCRAPE_KICKS[0] || elapsed === SCRAPE_KICKS[1] || elapsed === SCRAPE_KICKS[2])) emitScrape(sim, i);
  if (sim.timer[i] <= 0) {
    if (sim.ranged[i]) { emitThrow(sim, i, px, py); enterRecover(sim, i, false); } // GOB-02: release, then the reload
    else enterCharge(sim, i, px, py);
  }
}

/** US-079c: emits one preallocated `beast:scrape` at the forefeet (z + 0.03), thrown backward - particleHooks
 * bursts the scrapeDust clods (design/models/voxel_beast.js `boarFx.scrape`). Zero allocation. */
function emitScrape(sim, i) {
  const p = sim._scrapePayload[i];
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
    const dx = px - sim.steer.x[i], dy = py - sim.steer.y[i], gx = sim.goalX[i] - sim.steer.x[i], gy = sim.goalY[i] - sim.steer.y[i];
    if (dx * dx + dy * dy >= fleeMOf(sim, i) * fleeMOf(sim, i) || gx * gx + gy * gy <= 1) { sim.fleeing[i] = 0; enterReturn(sim, i); }
    return;
  }
  if (sim._lagents[i].leashMode !== LEASH_GIVEUP && noticedOf(sim, i, px, py)) { enterNotice(sim, i); return; }
  const dx = sim.homeX[i] - sim.steer.x[i], dy = sim.homeY[i] - sim.steer.y[i];
  if (dx * dx + dy * dy <= sim.cfg.homeArriveR * sim.cfg.homeArriveR) enterWander(sim, i);
}

// ---- state entry ------------------------------------------------------------------------------------------------

function enterNotice(sim, i) {
  sim.state[i] = STATE_NOTICE;
  sim.timer[i] = sim.cfgSteps.notice;
}

function enterChase(sim, i) {
  sim.state[i] = STATE_CHASE;
  sim.waiting[i] = 0; // US-079c: a fresh chase is not waiting for the charger
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.repathT[i] = 0;
  sim.unseen[i] = 0;
  sim.pathReq[i] = 0; // (re)requested by updatePathRequests this same tick, since pathLen === 0
}

function enterWindup(sim, i) {
  sim.state[i] = STATE_WINDUP;
  sim.waiting[i] = 0; // US-079c: it is the charger now, not a waiter
  sim.timer[i] = sim.ssteps[i].windup;
}

function enterCharge(sim, i, px, py) {
  const steer = sim.steer;
  const dx = px - steer.x[i], dy = py - steer.y[i];
  const d = Math.sqrt(dx * dx + dy * dy);
  sim.cdx[i] = d > 1e-9 ? dx / d : sim.fx[i];
  sim.cdy[i] = d > 1e-9 ? dy / d : sim.fy[i];
  sim.state[i] = STATE_CHARGE;
  sim.timer[i] = sim.ssteps[i].chargeMax;
  sim.unseen[i] = 0; // reused as the wall-slow streak counter for the duration of the charge
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
  sim.unseen[i] = 0; // clears the charge wall-slow streak counter (reused field)
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
  sim._ldef.homeX = sim.homeX[i]; sim._ldef.homeY = sim.homeY[i];
  const rt = returnTarget(sim._ldef, sim._lret);
  sim.goalX[i] = rt.x; sim.goalY[i] = rt.y;
  sim.pathLen[i] = 0; sim.pathIdx[i] = 0;
  sim.pathReq[i] = 0;
}

/** WOLF-01: a wolf with no other living wolf within packR. */
function isLone(sim, i) {
  const st = sim.steer, pr = sim.goblin[i] ? GOBLIN_TUNING.packR : WOLF_TUNING.packR, r2 = pr * pr;
  for (let k = 0; k < sim.count; k++) {
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
  const steer = sim.steer, t = sim._tmp, S = 0.7071067811865476;
  awayTarget(steer.x[i], steer.y[i], px, py, fleeMOf(sim, i), t);
  // try straight away, then +-45 deg (vector rotation, no trig), then half distance; else just go home
  const ax = t.x - steer.x[i], ay = t.y - steer.y[i];
  let found = false, gx = 0, gy = 0;
  for (let k = 0; k < 6 && !found; k++) {
    const sc = k < 3 ? 1 : 0.5, rx = k % 3 === 0 ? ax : (k % 3 === 1 ? (ax - ay) * S : (ax + ay) * S), ry = k % 3 === 0 ? ay : (k % 3 === 1 ? (ax + ay) * S : (ay - ax) * S);
    gx = steer.x[i] + rx * sc; gy = steer.y[i] + ry * sc;
    found = walkable(sim.grid, gx, gy);
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
  const st = sim.state[i];
  if (p.heavy) {
    const knock = p.knock > 0 ? p.knock : sim.cfg.staggerKnock;
    if (knock >= 1) { enterStagger(sim, i, p.dirX, p.dirY, Math.min(knock, 12)); return; }
    enterFlinch(sim, i); // fire with a tiny falloff (knock < 1) -> flinch
    return;
  }
  if (sim.goblin[i] && st !== STATE_STAGGER) { enterRecover(sim, i, false); return; } // GOB-01: scatter - a damaging hit enters the retreat
  if (st === STATE_WINDUP && !sim.bear[i]) { enterRecover(sim, i, false); return; } // AC: a light hit cancels the charge
  if (st === STATE_CHARGE || st === STATE_STAGGER || (st === STATE_WINDUP && sim.bear[i])) return; // BEAR-01: an arrow doesn't break the bluff          // D-034: only a hard hit stops a charge
  enterFlinch(sim, i);
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
  const p = sim._sinkPayload[i];
  p.x = sim.entities[i].transform.x;
  p.y = sim.entities[i].transform.y;
  p.z = sim.deathZ[i];
  sim.events.emit('beast:sink', p); // particleHooks bursts the corpse dust here
}

/** Deferred `beast:died` (37.16.2): exactly once, at the start of the step AFTER the kill. */
function emitPendingDied(sim, i) {
  if (!sim.pendingDied[i]) return;
  sim.pendingDied[i] = 0;
  const p = sim._diedPayload[i];
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
  const n = sim.count, cfg = sim.cfg;
  for (let i = 0; i < n; i++) {
    if (deadSt(sim.state[i])) continue; // US-079b: dead slots don't path
    if (sim.repathT[i] > 0) sim.repathT[i]--;
    if (sim.pathReq[i]) continue;
    const st = sim.state[i];
    if (st === STATE_CHASE) {
      if (sim.waiting[i]) continue; // US-079c: a waiter holds position (no path into the player)
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
  const n = sim.count;
  if (n === 0) return;
  for (let k = 1; k <= n; k++) {
    const i = (sim.lastServed + k) % n;
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
  const maxNodes = sim.state[i] === STATE_WANDER && !sim.goalOn[i] ? WANDER_MAX_NODES : TRAVEL_MAX_NODES;
  const len = findPath(astar, sx, sy, gx, gy, sim._cellPath, { maxNodes });
  sim.stats.astar++;
  sim.stats.astarNodes += len; // approximation: findPath does not expose expanded-node count (see report deviations)
  const wn = len > 0 ? smoothPath(grid, sim._cellPath, len, sim._xy) : 0;
  storePath(sim, i, wn);
}

function storePath(sim, i, wn) {
  const base = i * PATH_SLOTS * 2;
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

const STUCK_STEPS = 90;      // BEAST-01: 1.5 s
const STUCK_MOVE_M = 0.1;
/** BEAST-01: measured speed (displacement of the last step, EMA) + stuck rule. Runs before prevX is overwritten. */
function measureAndUnstick(sim, i, st) {
  const steer = sim.steer;
  const dx = steer.x[i] - sim.prevX[i], dy = steer.y[i] - sim.prevY[i];
  const inst = Math.sqrt(dx * dx + dy * dy) * 60;
  const m = sim.mv[i] += (Math.min(inst, 30) - sim.mv[i]) * 0.2;
  if (m > 0.15) sim.moving[i] = 1; else if (m < 0.05) sim.moving[i] = 0;
  if (sim.stkSt[i] !== st) { sim.stkSt[i] = st; sim.stkFail[i] = 0; sim.stkT[i] = 0; }
  if (m > 0.5) sim.stkFail[i] = 0;
  // wants to move: walking wander / chase not waiting / return, and not already at its goal
  let want = (st === STATE_WANDER && sim.timer[i] === WALKING) || st === STATE_RETURN || (st === STATE_CHASE && !sim.waiting[i]);
  if (want) {
    const gx = st === STATE_CHASE ? sim._px : sim.goalX[i], gy = st === STATE_CHASE ? sim._py : sim.goalY[i];
    const ex = gx - steer.x[i], ey = gy - steer.y[i];
    if (ex * ex + ey * ey < (st === STATE_CHASE ? 6 : 1)) want = false; // arrived / in melee range
  }
  if (!want) { sim.stkT[i] = 0; return; }
  const ax = steer.x[i] - sim.stkAx[i], ay = steer.y[i] - sim.stkAy[i];
  if (sim.stkT[i] === 0 || ax * ax + ay * ay >= STUCK_MOVE_M * STUCK_MOVE_M) { sim.stkAx[i] = steer.x[i]; sim.stkAy[i] = steer.y[i]; sim.stkT[i] = 1; return; }
  if (++sim.stkT[i] < STUCK_STEPS) return;
  sim.stkT[i] = 0;
  if (sim.stkFail[i] < 2) { // re-plan (fresh A* to the same goal; chase re-targets the player)
    sim.stkFail[i]++;
    sim.pathLen[i] = 0; sim.pathIdx[i] = 0; sim.pathReq[i] = 1;
    if (st === STATE_CHASE) { sim.goalX[i] = sim._px; sim.goalY[i] = sim._py; }
    return;
  }
  sim.stkFail[i] = 0; // give up this target
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

  if (st === STATE_WANDER && sim.goalOn[i] && sim.altTgt[i] >= 0) { // LIFE-08: direct steer at the villager point
    steer.setWaypoint(i, sim.altX[sim.altTgt[i]], sim.altY[sim.altTgt[i]], 0);
    steer.maxSpeed[i] = sim.scfg[i].chase * sim.spdMul[i];
    return;
  }

  if (sim.ranged[i] && st === STATE_CHASE && sim.waiting[i] === 2) { // GOB-02: back off from the player
    awayTarget(steer.x[i], steer.y[i], sim._px, sim._py, GOBLIN_TUNING.backoffM, sim._tmp);
    steer.setWaypoint(i, sim._tmp.x, sim._tmp.y, 0); steer.maxSpeed[i] = sim.scfg[i].chase * GOBLIN_TUNING.backoffSpeedMul * sim.spdMul[i]; return;
  }

  if (sim.packer[i]) { // WOLF-01/GOB-01: retreat after the leap, circle while another wolf holds the token
    const wc = sim.scfg[i], tmp = sim._tmp;
    if (st === STATE_RECOVER) {
      awayTarget(steer.x[i], steer.y[i], sim._px, sim._py, sim.goblin[i] ? GOBLIN_TUNING.retreatM : WOLF_TUNING.retreatM, tmp);
      steer.setWaypoint(i, tmp.x, tmp.y, 0); steer.maxSpeed[i] = wc.chase; return;
    }
    if (st === STATE_CHASE && sim.waiting[i]) {
      const CT = sim.goblin[i] ? GOBLIN_TUNING : WOLF_TUNING;
      circleTarget(steer.x[i], steer.y[i], sim._px, sim._py, (CT.circleMin + CT.circleMax) / 2, (i & 1) ? 1 : -1, tmp);
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
  if (st === STATE_CHASE && sim.waiting[i]) {
    steer.setWaypoint(i, steer.x[i], steer.y[i], 0);
    steer.maxSpeed[i] = 0;
    return;
  }

  let speed = 0;
  if ((st === STATE_WANDER && sim.timer[i] === WALKING) || st === STATE_CHASE || st === STATE_RETURN) {
    advanceWaypoint(sim, i);
    const base = i * PATH_SLOTS * 2, idx = Math.min(sim.pathIdx[i], Math.max(0, sim.pathLen[i] - 1));
    const wx = sim.pathLen[i] > 0 ? sim.path[base + idx * 2] : steer.x[i];
    const wy = sim.pathLen[i] > 0 ? sim.path[base + idx * 2 + 1] : steer.y[i];
    steer.setWaypoint(i, wx, wy, WAYPOINT_ARRIVE);
    speed = (st === STATE_CHASE ? sim.scfg[i].chase : (st === STATE_RETURN ? (sim.fleeing[i] ? sim.scfg[i].chase : cfg.returnSpeed) : sim.scfg[i].walk)) * sim.spdMul[i];
  } else {
    steer.setWaypoint(i, steer.x[i], steer.y[i], 0);
  }
  steer.maxSpeed[i] = speed;
}

function advanceWaypoint(sim, i) {
  const steer = sim.steer, base = i * PATH_SLOTS * 2;
  while (sim.pathIdx[i] < sim.pathLen[i] - 1) {
    const idx = sim.pathIdx[i];
    const dx = sim.path[base + idx * 2] - steer.x[i], dy = sim.path[base + idx * 2 + 1] - steer.y[i];
    if (dx * dx + dy * dy >= WAYPOINT_ADVANCE_D2) break;
    sim.pathIdx[i]++;
  }
}

// ---- post (29.1 step 6) ----------------------------------------------------------------------------------------

function postOne(sim, i, px, py, pz) {
  const steer = sim.steer, cfg = sim.cfg, world = sim.world;

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
  } else if (sim.state[i] === STATE_NOTICE || sim.state[i] === STATE_WINDUP
             || (sim.state[i] === STATE_CHASE && sim.waiting[i])) {
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
  const support = world.supportAt(steer.x[i], steer.y[i], t.z + 0.6, true, _supportOpts);
  t.x = steer.x[i];
  t.y = steer.y[i];
  t.z = support.floorH;
}

const _supportOpts = { height: 0, stepUpMax: 1.0, walkCos: -1 };

function chargePost(sim, i, px, py) {
  void px; void py;
  const steer = sim.steer;
  const dx = steer.x[i] - sim.prevX[i], dy = steer.y[i] - sim.prevY[i];
  const moved2 = dx * dx + dy * dy;
  const chargeStep = sim.ssteps[i].chargeMax - sim.timer[i];
  const thresh = WALL_SPEED_FRAC * sim.scfg[i].charge * SIM_STEP;
  if (chargeStep >= 4) {
    if (moved2 < thresh * thresh) {
      sim.unseen[i]++;
      if (sim.unseen[i] >= WALL_STREAK) { enterRecover(sim, i, true); return; }
    } else {
      sim.unseen[i] = 0;
    }
  }
  sim.timer[i]--;
  if (sim.timer[i] <= 0 && sim.state[i] === STATE_CHARGE) enterRecover(sim, i, false);
}

// ---- US-079c (BUG-BOAR-OVERLAP) hard pairwise de-overlap ------------------------------------------------------

/** True if the centre point (x,y) lands in a walkable NavGrid cell - the exact check engine/nav/steer.js's step
 * uses for its axis-sliding wall clamp (`cellWalkable`), re-stated here so the de-overlap can reuse it (steer.js
 * does not export it). Zero allocation. */
function walkable(grid, x, y) {
  const cx = grid.cellX(x);
  const cy = grid.cellY(y);
  return grid.inBounds(cx, cy) && grid.cost[grid.index(cx, cy)] !== 0;
}

/** Applies a proposed (nx,ny) with the same axis-sliding wall clamp as steer.step: full move if walkable, else the
 * x or y axis alone if that stays walkable, else stay put (no tunnelling through a cost-0 cell). */
function applyPush(steer, grid, slot, nx, ny) {
  const ox = steer.x[slot], oy = steer.y[slot];
  if (walkable(grid, nx, ny)) { steer.x[slot] = nx; steer.y[slot] = ny; }
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
  const n = sim.count;
  for (let i = 0; i < n; i++) {
    if (!steer.active[i]) continue; // US-079c ARCH (37.16.2): skip inactive (dead) steer slots
    for (let j = i + 1; j < n; j++) {
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
      applyPush(steer, grid, i, steer.x[i] - ux * overlap * mj * inv, steer.y[i] - uy * overlap * mj * inv);
      applyPush(steer, grid, j, steer.x[j] + ux * overlap * mi * inv, steer.y[j] + uy * overlap * mi * inv);
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
    path: Array.from(sim.path.subarray(0, n * PATH_SLOTS * 2)),
    hp,
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

/** One slot back to home, alive, state wander (shared by resetAll and setDown(slot, false)). */
function resetSlotSim(sim, i) {
  // US-079b: dead steer slots are re-added in ascending order; addAgent hands out the lowest free slot, and the
  // live slots stay active (slots >= count are never used), so the lowest free slot is always the lowest dead one.
  if (!sim.steer.active[i] && !sim.dormant[i]) {
    const slot = sim.steer.addAgent(sim.homeX[i], sim.homeY[i], sim.cfg.radius, 0, DEFAULT_ACCEL);
    if (slot !== i) throw new Error(`beastSim.resetAll: re-added dead slot ${i} but addAgent returned ${slot}`);
  }
  const health = sim.entities[i].components.health;
  health.hp = health.max; // US-079b: boars come back alive
  sim.goalOn[i] = 0; sim.altTgt[i] = -1; sim.altCd[i] = 0; // LIFE-08: raids restart next night
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
