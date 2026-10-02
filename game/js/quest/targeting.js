// game/js/quest/targeting.js (US-128b, architecture.md 29.2). Z-targeting: pick the best visible
// `components.targetable` entity, keep the camera turned to it via `PlayerLook.setLockPoint`, cycle between
// candidates, and present the ring/bar/"no target" tick on `engine.overlay`. A plain sim object with a `step()`
// method, zero per-frame allocation after `createTargeting` (same convention as beastSim.js/vitals.js).
//
// Trig note (29.2's explicit exception): this file is not under `sim/**`, and the architect note allows one
// sin/cos pair for the forward vector and the (rare, event-driven, not per-candidate) yaw-offset math in
// selection/cycling - unlike `sim/**`'s hard "no trig" rule. The one place trig actually runs *per candidate* is
// avoided: the field-of-view test below is a horizontal dot product against a `cos(hfovDeg/2)` threshold computed
// once at create time, not an atan2 per candidate per step.
import { canSee } from './sim/sight.js';
import {
  forwardOf, yawFromDelta, shortestArcDeg, DEG2RAD, PHYSICS, SIM_STEP, HFOV_DEG,
} from '../../../engine/index.js';

const MAX_TARGETS_HARD_CAP = 16; // 29.2 cfg default `maxTargets: 16`; also the Int32Array(16) rank buffer size

const DEFAULTS = Object.freeze({
  range: 15,
  breakRange: 20,
  losLostSec: 1.0,
  fadeSec: 0.2,
  noTargetSec: 0.3,
  maxTargets: 16,
  losEvery: 6,
  hfovDeg: HFOV_DEG,
});

function toSteps(sec) {
  return Math.round(sec / SIM_STEP);
}

/**
 * @param {any} world engine World (forEachEntity, get(id), also passed through to `canSee`)
 * @param {any} events engine.events (Events instance) - listens for `entity:added`/`entity:removed`
 * @param {Partial<typeof DEFAULTS>} [cfg]
 */
export function createTargeting(world, events, cfg) {
  const C = { ...DEFAULTS, ...cfg };
  const maxC = Math.min(C.maxTargets > 0 ? C.maxTargets : DEFAULTS.maxTargets, MAX_TARGETS_HARD_CAP);
  const rangeSq = C.range * C.range;
  const breakRangeSq = C.breakRange * C.breakRange;
  const losLostSteps = toSteps(C.losLostSec);
  const fadeSteps = toSteps(C.fadeSec);
  const noTargetStepsCfg = toSteps(C.noTargetSec);
  const losEvery = Math.max(1, C.losEvery | 0);
  const cosHalfHfov = Math.cos((C.hfovDeg / 2) * DEG2RAD); // the only hfov-related trig call (once, at create)

  /** @type {any[]} plain entity data objects with `components.targetable`, rebuilt on load/add/remove, never per step. */
  let entities = [];

  function rebuild() {
    const all = [];
    world.forEachEntity((e) => { if (e.components && e.components.targetable) all.push(e); });
    if (all.length > maxC) {
      console.warn(`createTargeting: ${all.length} targetable entities, only the first ${maxC} are tracked.`);
    }
    const next = [];
    for (let i = 0; i < all.length && i < maxC; i++) next.push(all[i]);
    entities = next;
  }
  rebuild();
  const offAdded = events.on('entity:added', rebuild);
  const offRemoved = events.on('entity:removed', rebuild);

  // ---- per-step scratch (zero allocation after create) ------------------------------------------------------
  const fwdH = new Float64Array(2); // forwardOf's horizontal (sinYaw, -cosYaw) output, pitch-independent
  let eyeX = 0, eyeY = 0, eyeZ = 0;
  let fwdX = 0, fwdY = 0, fwdZ = 0; // full 3D forward (fwdH scaled by cos(pitch), plus sin(pitch))
  const rankIdx = new Int32Array(maxC);
  const rankScore = new Float64Array(maxC);
  const rankDist2 = new Float64Array(maxC);
  let rankCount = 0;

  let targetEntity = null;
  let lockActive = false;
  let lockSteps = 0;   // steps since this lock started (0-based; the 1st maintainLock call makes it 1)
  let lostSteps = 0;   // LOS-hidden step count while locked (29.2: += losEvery when hidden, 0 when seen)
  let fadeT = 0;        // steps left showing the fading ring at the last locked position
  let fadeX = 0, fadeY = 0, fadeZ = 0, fadeR = 0;
  let noTargetT = 0;    // steps left showing the "no target" crosshair tick
  let lookRef = null;   // last `look` seen by step(), so clear() can release it without a fresh reference

  // ---- geometry helpers ---------------------------------------------------------------------------------------

  function computeEye(player) {
    const t = player.transform;
    const body = player.components && player.components.body;
    const eyeH = body && typeof body.eyeH === 'number' ? body.eyeH : PHYSICS.eyeHeight;
    eyeX = t.x; eyeY = t.y; eyeZ = t.z + eyeH;
  }

  function computeForward(look) {
    forwardOf(look.yawDeg, fwdH); // (sinYaw, -cosYaw): the one sin/cos pair "per step" the architect note allows
    const pitchRad = look.pitchDeg * DEG2RAD;
    const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad);
    fwdX = fwdH[0] * cp; fwdY = fwdH[1] * cp; fwdZ = sp;
  }

  /** `components.targetable` world centre: feet x/y, z + height/2 (29.2). */
  function centreZ(e) { return e.transform.z + e.components.targetable.height / 2; }

  function isAlive(e) {
    const health = e.components.health;
    return !health || health.hp > 0;
  }

  /** Range + horizontal FOV + alive (29.2 selection validity). No LOS here (that's `canSee`, checked separately). */
  function isValidCandidate(e) {
    if (!isAlive(e)) return false;
    const tgb = e.components.targetable;
    const cx = e.transform.x, cy = e.transform.y, cz = e.transform.z + tgb.height / 2;
    const dx = cx - eyeX, dy = cy - eyeY, dz = cz - eyeZ;
    if (dx * dx + dy * dy + dz * dz > rangeSq) return false;
    const h2 = dx * dx + dy * dy;
    if (h2 > 1e-9) {
      const hInv = 1 / Math.sqrt(h2);
      const dot = dx * hInv * fwdH[0] + dy * hInv * fwdH[1];
      if (dot < cosHalfHfov) return false;
    }
    return true;
  }

  // ---- selection (Q while unlocked) ---------------------------------------------------------------------------

  function insertRank(entIdx, score, dist2) {
    let pos = rankCount;
    while (pos > 0) {
      const pScore = rankScore[pos - 1], pDist = rankDist2[pos - 1], pIdx = rankIdx[pos - 1];
      if (pScore < score) break;
      if (pScore === score && pDist < dist2) break;
      if (pScore === score && pDist === dist2 && pIdx < entIdx) break;
      rankIdx[pos] = pIdx; rankScore[pos] = pScore; rankDist2[pos] = pDist;
      pos--;
    }
    rankIdx[pos] = entIdx; rankScore[pos] = score; rankDist2[pos] = dist2;
    rankCount++;
  }

  /** Builds `rankIdx[0..rankCount)` = valid candidates sorted by (score, dist, list order). Zero allocation. */
  function buildRanks() {
    rankCount = 0;
    const n = entities.length;
    for (let i = 0; i < n; i++) {
      const e = entities[i];
      if (!isValidCandidate(e)) continue;
      const tgb = e.components.targetable;
      const cx = e.transform.x, cy = e.transform.y, cz = e.transform.z + tgb.height / 2;
      const dx = cx - eyeX, dy = cy - eyeY, dz = cz - eyeZ;
      const dist2 = dx * dx + dy * dy + dz * dz;
      const inv = dist2 > 1e-9 ? 1 / Math.sqrt(dist2) : 0;
      const dot = dx * inv * fwdX + dy * inv * fwdY + dz * inv * fwdZ;
      if (rankCount < maxC) insertRank(i, 1 - dot, dist2);
    }
  }

  function lockOnto(e) {
    targetEntity = e;
    lockActive = true;
    lockSteps = 0;
    lostSteps = 0;
    fadeT = 0;
  }

  function trySelect() {
    buildRanks();
    for (let k = 0; k < rankCount; k++) {
      const e = entities[rankIdx[k]];
      const tgb = e.components.targetable;
      const cx = e.transform.x, cy = e.transform.y, cz = e.transform.z + tgb.height / 2;
      if (canSee(world, eyeX, eyeY, eyeZ, cx, cy, cz)) { lockOnto(e); return; }
    }
    noTargetT = noTargetStepsCfg; // 29.2: "None found: noTargetT = noTargetSec"
  }

  // ---- cycle (Tab/Shift+Tab/wheel while locked) ---------------------------------------------------------------

  /** dir > 0 = right (Tab, wheel down); dir < 0 = left (Shift+Tab, wheel up). Not perf-critical: Tab is rare. */
  function cycleTarget(dir) {
    const cur = targetEntity;
    if (!cur) return;
    const curDx = cur.transform.x - eyeX, curDy = cur.transform.y - eyeY;
    const curYaw = yawFromDelta(curDx, curDy);

    let bestIdx = -1, bestOffset = Infinity;     // right: smallest positive offset
    let wrapIdx = -1, wrapOffset = Infinity;     // right wrap: smallest offset overall
    let bestIdxL = -1, bestOffsetL = -Infinity;  // left: largest negative offset
    let wrapIdxL = -1, wrapOffsetL = -Infinity;  // left wrap: largest offset overall

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e === cur || !isValidCandidate(e)) continue;
      const tgb = e.components.targetable;
      const cx = e.transform.x, cy = e.transform.y, cz = e.transform.z + tgb.height / 2;
      if (!canSee(world, eyeX, eyeY, eyeZ, cx, cy, cz)) continue;
      const yaw = yawFromDelta(cx - eyeX, cy - eyeY);
      const offset = shortestArcDeg(curYaw, yaw);
      if (dir > 0) {
        if (offset > 0 && offset < bestOffset) { bestOffset = offset; bestIdx = i; }
        if (offset < wrapOffset) { wrapOffset = offset; wrapIdx = i; }
      } else {
        if (offset < 0 && offset > bestOffsetL) { bestOffsetL = offset; bestIdxL = i; }
        if (offset > wrapOffsetL) { wrapOffsetL = offset; wrapIdxL = i; }
      }
    }

    const chosen = dir > 0 ? (bestIdx >= 0 ? bestIdx : wrapIdx) : (bestIdxL >= 0 ? bestIdxL : wrapIdxL);
    if (chosen >= 0) { targetEntity = entities[chosen]; lockSteps = 0; lostSteps = 0; }
  }

  // ---- per-step lock maintenance -------------------------------------------------------------------------------

  function captureFade() {
    const e = targetEntity;
    if (e && e.transform && e.components.targetable) {
      fadeX = e.transform.x; fadeY = e.transform.y; fadeZ = e.transform.z;
      fadeR = e.components.targetable.radius + 0.2;
      fadeT = fadeSteps;
    }
  }

  function breakLock(look) {
    captureFade();
    lockActive = false;
    targetEntity = null;
    if (look) look.clearLock();
  }

  function maintainLock(look) {
    const e = targetEntity;
    if (!e || world.get(e.id) === null || !isAlive(e)) { breakLock(look); return; }
    const tgb = e.components.targetable;
    const cx = e.transform.x, cy = e.transform.y, cz = e.transform.z + tgb.height / 2;
    const dx = cx - eyeX, dy = cy - eyeY, dz = cz - eyeZ;
    if (dx * dx + dy * dy + dz * dz > breakRangeSq) { breakLock(look); return; }
    if (lockSteps % losEvery === 0) {
      if (canSee(world, eyeX, eyeY, eyeZ, cx, cy, cz)) lostSteps = 0;
      else lostSteps += losEvery;
    }
    if (lostSteps >= losLostSteps) { breakLock(look); return; }
    look.setLockPoint(eyeX, eyeY, eyeZ, cx, cy, cz);
  }

  // ---- public surface -------------------------------------------------------------------------------------------

  const sim = {};
  Object.defineProperty(sim, 'locked', { enumerable: true, get: () => lockActive });
  Object.defineProperty(sim, 'targetId', { enumerable: true, get: () => (targetEntity ? targetEntity.id : null) });
  Object.defineProperty(sim, 'noTargetT', { enumerable: true, get: () => noTargetT });
  Object.defineProperty(sim, 'fadeT', { enumerable: true, get: () => fadeT });

  /**
   * @param {number} dt seconds (unused: timers here are integer step counts, not wall-clock seconds - rule 15's
   *   "no wall clock" spirit even though this file is not under sim/**; kept in the signature for the main.js
   *   call site architecture.md 29.2 describes).
   * @param {boolean} qPressed `input.pressed('KeyQ')` this step
   * @param {number} cycleDir >0 = right (Tab/wheel down), <0 = left (Shift+Tab/wheel up), 0 = no cycle
   * @param {any} player `playerHandle.data`
   * @param {any} look the engine `PlayerLook` instance
   */
  sim.step = function step(dt, qPressed, cycleDir, player, look) {
    void dt;
    lookRef = look;
    computeEye(player);
    computeForward(look);

    if (qPressed) {
      if (lockActive) breakLock(look); // 29.2: "Q while locked unlocks (toggle)"
      else trySelect();
    } else if (lockActive && cycleDir) {
      cycleTarget(cycleDir);
    }

    if (lockActive) {
      lockSteps++;
      maintainLock(look);
    }

    if (fadeT > 0) fadeT--;
    if (noTargetT > 0) noTargetT--;
  };

  /** @param {any} overlay engine.overlay @param {{target:number, targetFade:number, targetNone:number, targetBarFill:number, targetBarEmpty:number}} ids */
  sim.present = function present(overlay, ids) {
    if (lockActive && targetEntity) {
      const t = targetEntity.transform, tgb = targetEntity.components.targetable;
      overlay.ring(t.x, t.y, t.z, tgb.radius + 0.2, ids.target);
      const health = targetEntity.components.health;
      const hpFrac = health && health.max > 0 ? Math.max(0, Math.min(1, health.hp / health.max)) : 1;
      overlay.bar(t.x, t.y, t.z + tgb.height + 0.3, hpFrac, 5, ids.targetBarFill, ids.targetBarEmpty);
    } else if (fadeT > 0) {
      overlay.ring(fadeX, fadeY, fadeZ, fadeR, ids.targetFade);
    } else if (noTargetT > 0) {
      const cc = overlay.cols >> 1, cr = overlay.rows >> 1;
      overlay.rect(cc - 2, cr, cc - 2, cr, ids.targetNone);
      overlay.rect(cc + 2, cr, cc + 2, cr, ids.targetNone);
    }
  };

  /** US-080a1 respawn hook: drop the lock (if any) with no fade, no "no target" tick. */
  sim.clear = function clear() {
    if (lockActive) {
      lockActive = false;
      targetEntity = null;
      if (lookRef) lookRef.clearLock();
    }
    fadeT = 0;
    noTargetT = 0;
  };

  /** Drops the `entity:added`/`entity:removed` listeners - call before creating the next targeting on a world reload. */
  sim.dispose = function dispose() { offAdded(); offRemoved(); };

  return sim;
}
