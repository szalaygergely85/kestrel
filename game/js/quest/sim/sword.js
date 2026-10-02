// game/js/quest/sim/sword.js (US-078d, docs/architecture.md 30.1 + the normative "30.1 amendment (D-034)"). The
// sword state machine: idle -> hold -> charge -> light/hard -> rest (light can chain twice), hit detection
// (engine's `World.raySegment` world gate + `engine/world/meleeArc.js`'s `arcHits`, both from US-078b), the
// `combat:hit` event, mana spend (once, on release), knockback on heavy hits (`applyImpulse`, US-136). Rule 15
// (this file, sim/**): no Math.random, no trig (sin/cos/atan2 - the arc geometry itself is precomputed in
// swordConfig.js, outside sim/**; this file only rotates two already-unit vectors by (fx, fy), a plain 2D
// rotation = multiply/add, no trig call), no wall clock, integer step counters only, zero allocation after create.
import { arcHits, applyImpulse, PHYSICS } from '../../../../engine/index.js';
import { ARC_BOUNDS } from '../swordConfig.js';

export const ST_IDLE = 0;
export const ST_HOLD = 1;
export const ST_CHARGE = 2;
export const ST_LIGHT = 3;
export const ST_HARD = 4;
export const ST_REST = 5;

// body.speedScale multiplier per state (amendment's state table, "speedScale x" column). Applied by
// MULTIPLYING body.speedScale (never assigning) - integrate.js's resolveBodyContacts resets it to 1 every step,
// and main.js calls `sword.step()` after that reset (same slot the amendment's main.js line uses).
const SPEED_SCALE = [1, 1, 0.3, 0.6, 0.3, 0.6]; // idle, hold, charge, light, hard, rest

const MAX_TARGETS = 16; // same cap as targeting.js's MAX_TARGETS_HARD_CAP
const RING_SIZE = 4;    // "Sparks from a 4-slot ring in the sim" (30.1 View paragraph)
export const SPARK_CLINK = 0;
export const SPARK_HIT = 1;
export const SPARK_HIT_HEAVY = 2;
const AGE_NONE = 1 << 30; // "never fired yet" sentinel for a ring slot's age

/**
 * @param {any} world engine World (`raySegment`, `forEachEntity`, `state`)
 * @param {any} events engine.events (Events instance) - emits `combat:hit`, listens `entity:added`/`entity:removed`
 * @param {typeof import('../swordConfig.js').SWORD_CFG} cfg
 * @param {{spendMana?: (n:number)=>boolean}} [hooks] `spendMana` missing = hard swings are free (tests)
 */
export function createSwordSim(world, events, cfg, hooks) {
  const h = hooks || {};
  const spendMana = (n) => (typeof h.spendMana === 'function' ? h.spendMana(n) : true);

  // ---- per-swing phase tables (derived once from cfg; step counts, not seconds) ----------------------------------
  const LIGHT = {
    windup: cfg.light.windup, active: cfg.light.active, recover: cfg.light.recover,
    total: cfg.light.windup + cfg.light.active + cfg.light.recover,
    hitStart: cfg.light.windup, hitEnd: cfg.light.windup + cfg.light.active - 1,
    recoverStart: cfg.light.windup + cfg.light.active,
    damage: cfg.light.damage, reach: cfg.light.reach, heavy: 0, knock: 0,
  };
  const HARD = {
    windup: cfg.hard.windup, active: cfg.hard.active, recover: cfg.hard.recover,
    total: cfg.hard.windup + cfg.hard.active + cfg.hard.recover,
    hitStart: cfg.hard.windup, hitEnd: cfg.hard.windup + cfg.hard.active - 1,
    recoverStart: cfg.hard.windup + cfg.hard.active,
    damage: cfg.light.damage * cfg.hard.damageMul, reach: cfg.hard.reach, heavy: 1, knock: cfg.hard.knock,
  };

  // ---- targetables: this sim's OWN preallocated SoA list (NOT shared with US-128b's targeting.js - see the
  // programmer report: 128b already keeps its own internal list, so this is a second, independent copy, same
  // rebuild-on-load/add/remove convention as targeting.js). ------------------------------------------------------
  let tEntities = [];
  let tCount = 0;
  const tcx = new Float64Array(MAX_TARGETS), tcy = new Float64Array(MAX_TARGETS), tcz = new Float64Array(MAX_TARGETS);
  const tcr = new Float64Array(MAX_TARGETS), tch = new Float64Array(MAX_TARGETS);

  function rebuildTargetables() {
    const all = [];
    world.forEachEntity((e) => { if (e.components && e.components.targetable) all.push(e); });
    if (all.length > MAX_TARGETS) {
      console.warn(`createSwordSim: ${all.length} targetable entities, only the first ${MAX_TARGETS} can be hit.`);
    }
    tEntities = all.slice(0, MAX_TARGETS);
    tCount = tEntities.length;
  }
  rebuildTargetables();
  const offAdded = events.on('entity:added', rebuildTargetables);
  const offRemoved = events.on('entity:removed', rebuildTargetables);

  /** Refreshes the SoA cylinders from the live entities (feet z; cr = radius; ch = height). Cheap, <= 16 entries. */
  function refreshTargetables() {
    for (let i = 0; i < tCount; i++) {
      const e = tEntities[i], tg = e.components.targetable;
      tcx[i] = e.transform.x; tcy[i] = e.transform.y; tcz[i] = e.transform.z;
      tcr[i] = tg.radius; tch[i] = tg.height;
    }
  }

  // ---- state -------------------------------------------------------------------------------------------------
  let state = ST_IDLE;
  let stateStep = 0;
  let holdSteps = 0;
  let prevDown = 0;
  let chain = 0;
  let queued = false;
  let pressStep = 0;
  let frozen = 0;
  let blocking = false;
  let blend = false;       // current state's blend flag (view: capture() + show(..., blend) while this state lasts)
  let justEntered = false; // true only on the step a transition INTO a new state happened (reset every step)
  const hitMask = new Uint8Array(MAX_TARGETS);

  // Spark ring (view presentation data only; owned/hashed here per the amendment's "Save / hash" paragraph).
  const ringKind = new Int32Array(RING_SIZE);
  const ringX = new Float64Array(RING_SIZE), ringY = new Float64Array(RING_SIZE), ringZ = new Float64Array(RING_SIZE);
  const ringAge = new Int32Array(RING_SIZE).fill(AGE_NONE);
  let ringHead = 0;

  function pushSpark(kind, x, y, z) {
    ringKind[ringHead] = kind; ringX[ringHead] = x; ringY[ringHead] = y; ringZ[ringHead] = z; ringAge[ringHead] = 0;
    ringHead = (ringHead + 1) % RING_SIZE;
  }

  // ---- scratch (zero allocation after create) -----------------------------------------------------------------
  const _eye = { x: 0, y: 0, z: 0 };
  const _rayOut = { t: 0, x: 0, y: 0, z: 0 };
  const _losOut = { t: 0, x: 0, y: 0, z: 0 };
  const _outIdx = new Int32Array(MAX_TARGETS);
  const _outT = new Float64Array(MAX_TARGETS);
  const _arc = { ex: 0, ey: 0, zMin: 0, zMax: 0, ax: 0, ay: 0, bx: 0, by: 0, reach: 0 };
  const _hitPayload = { source: 'player', target: null, damage: 0, heavy: 0, dirX: 0, dirY: 0, px: 0, py: 0, pz: 0 };

  function eyeOf(player, out) {
    const t = player.transform, body = player.components && player.components.body;
    const eyeH = body && typeof body.eyeH === 'number' ? body.eyeH : PHYSICS.eyeHeight;
    out.x = t.x; out.y = t.y; out.z = t.z + eyeH;
    return out;
  }

  function gateOk(player) {
    if (!world.state['tower.sword.taken']) return false;
    const body = player.components && player.components.body;
    if (!body || !body.grounded) return false;
    if (blocking) return false;
    return true;
  }

  // ---- state entry helpers -------------------------------------------------------------------------------------
  function toIdle() { state = ST_IDLE; stateStep = 0; justEntered = true; blend = false; chain = 0; queued = false; }
  function toRest() { state = ST_REST; stateStep = 0; justEntered = true; blend = false; chain = 0; queued = false; }
  function enterHold() { state = ST_HOLD; stateStep = 0; justEntered = true; blend = false; }
  function enterCharge() { state = ST_CHARGE; stateStep = 0; justEntered = true; blend = false; }
  /** Covers both the first light and light #2 (and the mana-short release from charge): `chain` tracks "lights in
   * a row", so the light about to start is the 2nd exactly when `chain === 1` already (amendment: "blend on light
   * #2" - applies uniformly regardless of which path got here, including a mana-short release after a queue). */
  function enterLight() {
    const isSecond = chain === 1;
    state = ST_LIGHT; stateStep = 0; frozen = 0; queued = false;
    hitMask.fill(0, 0, tCount);
    chain += 1;
    blend = isSecond;
    justEntered = true;
  }
  function enterHard() {
    state = ST_HARD; stateStep = 0; frozen = 0; queued = false;
    hitMask.fill(0, 0, tCount);
    chain = 0; // "a hard resets chain to 0"
    blend = true; // key 0 = the captured charge pose, always
    justEntered = true;
  }

  // ---- per-state step handlers ---------------------------------------------------------------------------------
  function stepIdle(pressed, player) {
    if (pressed && gateOk(player)) enterHold();
  }

  function stepHold(released, player) {
    const body = player.components && player.components.body;
    const grounded = !!(body && body.grounded);
    if (released) {
      if (!grounded) { toIdle(); return; } // "a release while not grounded = cancel"
      enterLight();
      return;
    }
    if (!grounded || blocking) { toIdle(); return; } // leaving the ground / onBlockStart during hold -> idle
    stateStep++;
    if (holdSteps >= cfg.holdSteps) enterCharge();
  }

  function stepCharge(released, player) {
    const body = player.components && player.components.body;
    const grounded = !!(body && body.grounded);
    if (released) {
      if (!grounded) { toIdle(); return; }
      if (spendMana(cfg.hard.mana)) enterHard(); else enterLight();
      return;
    }
    if (!grounded || blocking) { toIdle(); return; }
    stateStep++;
  }

  function stepRest() {
    stateStep++;
    if (stateStep >= cfg.rest) toIdle();
  }

  /** Emits one `combat:hit` for entity `e` (slot `idx`'s cylinder already matched the arc), applies knockback on
   * heavy hits (bodies only - beasts have none, 30.1 amendment), hit-stops on a heavy entity hit, and records a
   * spark. `fx, fy` are the fallback direction when the entity sits exactly on the eye (dist ~ 0). */
  function emitHit(e, S, ex, ey, ez, fx, fy) {
    const dx = ex - _eye.x, dy = ey - _eye.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const dirX = d > 1e-9 ? dx / d : fx, dirY = d > 1e-9 ? dy / d : fy;
    const p = _hitPayload;
    p.source = 'player'; p.target = e.id; p.damage = S.damage; p.heavy = S.heavy;
    p.dirX = dirX; p.dirY = dirY; p.px = ex; p.py = ey; p.pz = ez;
    events.emit('combat:hit', p);
    if (S.heavy) {
      const body = e.components && e.components.body;
      if (body) applyImpulse(body, e.transform.z, dirX * S.knock, dirY * S.knock, 0);
      if (frozen < cfg.hitStopHard) frozen = cfg.hitStopHard; // freeze only - the swing continues
      pushSpark(SPARK_HIT_HEAVY, ex, ey, ez);
    } else {
      pushSpark(SPARK_HIT, ex, ey, ez); // light entity hit: no hit-stop (hitStop 0)
    }
  }

  /** One active-window step: world ray gate (`World.raySegment`) + `arcHits` over this sim's own targetables.
   * Returns true iff a WORLD hit happened with no qualifying (closer) entity hit this step - the caller jumps the
   * swing to recover and applies the wall hit-stop. */
  function doHitCheck(player, fx, fy, sliceIdx, S) {
    eyeOf(player, _eye);
    const bIdx = sliceIdx * 2;
    const alx = ARC_BOUNDS[bIdx], aly = ARC_BOUNDS[bIdx + 1];
    const blx = ARC_BOUNDS[bIdx + 2], bly = ARC_BOUNDS[bIdx + 3];
    // local (lx = right, ly = forward) -> world, right = (-fy, fx) for unit forward (fx, fy) - swordConfig.js header.
    const ax = alx * -fy + aly * fx, ay = alx * fx + aly * fy;
    const bx = blx * -fy + bly * fx, by = blx * fx + bly * fy;
    _arc.ex = _eye.x; _arc.ey = _eye.y;
    _arc.zMin = _eye.z + cfg.zBandLow; _arc.zMax = _eye.z + cfg.zBandHigh;
    _arc.ax = ax; _arc.ay = ay; _arc.bx = bx; _arc.by = by; _arc.reach = S.reach;

    // World ray along the slice's bisector (unit), from eye z - 0.35, over `reach` (30.1's "eye z - 0.35" rule).
    let mx = ax + bx, my = ay + by;
    const mlen = Math.sqrt(mx * mx + my * my);
    if (mlen > 1e-9) { mx /= mlen; my /= mlen; } else { mx = fx; my = fy; }
    const rayZ = _eye.z - 0.35;
    const bxw = _eye.x + mx * S.reach, byw = _eye.y + my * S.reach;
    const worldHit = world.raySegment(_eye.x, _eye.y, rayZ, bxw, byw, rayZ, _rayOut);
    const twM = worldHit ? _rayOut.t * S.reach : S.reach;

    refreshTargetables();
    const n = arcHits(_arc, tcx, tcy, tcz, tcr, tch, tCount, _outIdx, _outT);
    let anyEntity = false;
    for (let k = 0; k < n; k++) {
      const idx = _outIdx[k], tE = _outT[k];
      if (tE >= twM) break; // sorted ascending by t: nothing further qualifies (the wall is nearer) either
      if (hitMask[idx]) continue;
      const e = tEntities[idx];
      const ex = e.transform.x, ey = e.transform.y, ez = e.transform.z + tch[idx] * 0.5;
      if (world.raySegment(_eye.x, _eye.y, rayZ, ex, ey, ez, _losOut)) continue; // blocked LOS to this entity - skip
      hitMask[idx] = 1;
      anyEntity = true;
      emitHit(e, S, ex, ey, ez, fx, fy);
    }
    return !anyEntity && worldHit;
  }

  /** Shared light/hard swing step: the chain-queue press (light #1's recover only), the active-window hit check,
   * the queued chain trigger (deferred to `max(pressStep+1, chainStart)`), and the natural end-of-swing exit. */
  function stepSwing(pressed, down, player, fx, fy, S) {
    if (S === LIGHT && pressed && chain === 1 && !queued && stateStep >= S.recoverStart) {
      queued = true; pressStep = stateStep;
    }

    if (stateStep >= S.hitStart && stateStep <= S.hitEnd) {
      const hitWall = doHitCheck(player, fx, fy, stateStep - S.hitStart, S);
      if (hitWall) {
        pushSpark(SPARK_CLINK, _rayOut.x, _rayOut.y, _rayOut.z);
        stateStep = S.recoverStart;
        frozen = cfg.hitStop;
        return;
      }
    }

    if (S === LIGHT && queued && chain === 1) {
      const scheduled = Math.max(pressStep + 1, cfg.chainStart);
      if (stateStep === scheduled) {
        queued = false;
        if (down) enterHold(); else enterLight();
        return;
      }
    }

    stateStep++;
    if (stateStep >= S.total) {
      if (S === HARD || chain < 2) toIdle(); else toRest();
    }
  }

  // ---- public surface ------------------------------------------------------------------------------------------
  const sim = {};
  Object.defineProperty(sim, 'state', { enumerable: true, get: () => state });
  Object.defineProperty(sim, 'stateStep', { enumerable: true, get: () => stateStep });
  Object.defineProperty(sim, 'holdSteps', { enumerable: true, get: () => holdSteps });
  Object.defineProperty(sim, 'chain', { enumerable: true, get: () => chain });
  Object.defineProperty(sim, 'queued', { enumerable: true, get: () => queued });
  Object.defineProperty(sim, 'blend', { enumerable: true, get: () => blend });
  Object.defineProperty(sim, 'justEntered', { enumerable: true, get: () => justEntered });
  Object.defineProperty(sim, 'frozen', { enumerable: true, get: () => frozen });
  /** Read-only view of the 4-slot spark ring: index `i` in [0, RING_SIZE); `age === AGE_NONE` = never fired. */
  sim.sparks = { kind: ringKind, x: ringX, y: ringY, z: ringZ, age: ringAge, size: RING_SIZE, AGE_NONE };

  sim.step = function step(player, fx, fy, attackDown) {
    justEntered = false;
    const down = attackDown ? 1 : 0;
    const pressed = down && !prevDown;
    const released = !down && prevDown;
    if (pressed) holdSteps = 0;
    else if (down) holdSteps = holdSteps < 9999 ? holdSteps + 1 : 9999;
    prevDown = down;

    if (frozen > 0) {
      frozen--;
    } else {
      switch (state) {
        case ST_IDLE: stepIdle(pressed, player); break;
        case ST_HOLD: stepHold(released, player); break;
        case ST_CHARGE: stepCharge(released, player); break;
        case ST_LIGHT: stepSwing(pressed, down, player, fx, fy, LIGHT); break;
        case ST_HARD: stepSwing(pressed, down, player, fx, fy, HARD); break;
        case ST_REST: stepRest(); break;
        default: break;
      }
    }

    const body = player.components && player.components.body;
    if (body) body.speedScale *= SPEED_SCALE[state];

    for (let i = 0; i < RING_SIZE; i++) if (ringAge[i] < AGE_NONE) ringAge[i]++;
  };

  // ---- US-086 seams (no shield logic in this story) -----------------------------------------------------------
  sim.canSwing = function canSwing() { return state === ST_IDLE; };
  sim.cancel = function cancel() { if (state === ST_HOLD || state === ST_CHARGE) toIdle(); };
  sim.onBlockStart = function onBlockStart() {
    blocking = true;
    if (state === ST_HOLD || state === ST_CHARGE) toIdle();
  };
  sim.onBlockEnd = function onBlockEnd() { blocking = false; };

  // ---- hash (transient: not saved - a reload always comes back idle, chain 0) ----------------------------------
  sim.hashInto = function hashInto(hh) {
    hh.u32(state); hh.u32(stateStep); hh.u32(holdSteps); hh.u32(prevDown);
    hh.u32(chain); hh.u32(queued ? 1 : 0); hh.u32(pressStep); hh.u32(frozen);
    hh.u8Array(hitMask, 0, MAX_TARGETS);
    hh.u32(ringHead);
    for (let i = 0; i < RING_SIZE; i++) {
      hh.u32(ringKind[i]); hh.u32(Math.min(ringAge[i], AGE_NONE));
      hh.f64(ringX[i]); hh.f64(ringY[i]); hh.f64(ringZ[i]);
    }
  };

  /** Drops the `entity:added`/`entity:removed` listeners - call before creating the next sword sim on a world reload. */
  sim.dispose = function dispose() { offAdded(); offRemoved(); };

  return sim;
}
