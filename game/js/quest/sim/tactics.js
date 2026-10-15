// game/js/quest/sim/tactics.js (BEAST-04, architecture.md 38.64 item 4). One preallocated instance per sim: attack-token pools
// (melee tokM, ranged 2, swarm 2 per swarm group), flank slots (6 ring slots 60 deg apart: a pack uses 0/2/4 or 1/3/5 =
// exactly 120 deg apart), ranged keep/back-off band, caster/healer "stay behind allies" point. Applies to slots with
// sim.tactOn[i] = 1 (explicit non-legacy kinds of the packHunter / swarm / ranged / caster archetypes); the legacy boar /
// wolf / goblin / bear paths keep their golden numbers. Rule 15: no Math.random / trig / clock / Map; per-step picks via
// hashU(seed, slot, tick). No allocation per step (typed arrays + one shared out object).
import { hashU } from '../../life/schedule.js';

export const TACT_MELEE = 0, TACT_RANGED = 1, TACT_CASTER = 2, TACT_SWARM = 3; // sim.tactRole values
export const TOK_NONE = 0, TOK_M = 1, TOK_R = 2, TOK_S = 3;                       // token class held by a slot
export const TACT_TUNING = Object.freeze({ tokR: 2, tokS: 2, tokMByDifficulty: Object.freeze({ easy: 1, normal: 2, hard: 3 }),
  holderTimeout: 180, reassignEvery: 30, flankR: 5, flankRHard: 4.5, flankREasy: 8, flankByDifficulty: Object.freeze({ easy: 0, normal: 1, hard: 2 }), swarmR: 2, strafeM: 2, strafeEvery: 120, casterBehindM: 6, allyR: 18 });
// 6 unit vectors, 60 deg apart (literal table, no trig). Slot k sits at angle 60*k.
export const FLANK_X = Object.freeze([1, 0.5, -0.5, -1, -0.5, 0.5]);
export const FLANK_Y = Object.freeze([0, 0.8660254037844386, 0.8660254037844386, 0, -0.8660254037844386, -0.8660254037844386]);

export function createTactics(maxSlots, seed) {
  const T = {
    seed: seed >>> 0, tick: 0, tokM: TACT_TUNING.tokMByDifficulty.normal, flankLv: 1, // Normal until difficulty.js exists
    held: new Uint8Array(maxSlots), heldT: new Uint16Array(maxSlots), tg: new Uint8Array(maxSlots), // tg = swarm group id
    flank: new Int8Array(maxSlots).fill(-1), strafeDir: new Int8Array(maxSlots).fill(1),
    nM: 0, nR: 0, nS: new Uint8Array(256), maxMelee: 0, out: { x: 0, y: 0, speed: 1 },
  };
  T.setDifficulty = (d) => { T.tokM = TACT_TUNING.tokMByDifficulty[d] || 2; const f = TACT_TUNING.flankByDifficulty[d]; T.flankLv = f === undefined ? 1 : f; }; // flankLv 0 = packs do not flank, 1 = ring r 5, 2 = tighter ring (flankRHard)
  /** true if slot i holds (or just got) a token of class cls */
  T.request = (i, cls) => {
    if (T.held[i]) return true;
    if (cls === TOK_M) { if (T.nM >= T.tokM) return false; T.nM++; if (T.nM > T.maxMelee) T.maxMelee = T.nM; }
    else if (cls === TOK_R) { if (T.nR >= TACT_TUNING.tokR) return false; T.nR++; }
    else { if (T.nS[T.tg[i]] >= TACT_TUNING.tokS) return false; T.nS[T.tg[i]]++; }
    T.held[i] = cls; T.heldT[i] = 0;
    return true;
  };
  T.release = (i) => {
    const c = T.held[i]; if (!c) return;
    if (c === TOK_M) T.nM--; else if (c === TOK_R) T.nR--; else T.nS[T.tg[i]]--;
    T.held[i] = 0; T.heldT[i] = 0;
  };
  return T;
}

/** Once per step, before the layers: release tokens whose holder left WINDUP/CHARGE/RECOVER (RECOVER end, death, STAGGER,
 *  dormancy, RETURN, ...) or held one > holderTimeout steps (leak guard); every 30 steps re-assign flank slots.
 *  S = { WINDUP, CHARGE, RECOVER, CHASE } state numbers (passed in: beastSim imports this file, not the reverse). */
export function tacticsSync(sim, S) {
  const T = sim.tactics; T.tick++;
  for (let k = 0, rec = sim.pool.rec, pn = sim.pool.n; k < pn; k++) {
    const i = rec[k];
    if (!T.held[i]) continue;
    const st = sim.state[i];
    if (sim.dormant[i] || sim.down[i] || (st !== S.WINDUP && st !== S.CHARGE && st !== S.RECOVER) || (st !== S.WINDUP && ++T.heldT[i] > TACT_TUNING.holderTimeout)) T.release(i);
  }
  if (T.tick % TACT_TUNING.reassignEvery === 1) assignFlanks(sim, S);
}

/** Waiting (token-less) melee/swarm slots take flank slots: the first waiter the free slot nearest to it, the next ones
 *  anchor+2, anchor+4 (120 deg apart), then the interleaved triple. Deterministic by slot order. */
function assignFlanks(sim, S) {
  const T = sim.tactics, st = sim.steer, px = sim._px, py = sim._py;
  let rank = 0, anchor = 0;
  for (let q = 0, rec = sim.pool.rec, pn = sim.pool.n; q < pn; q++) {
    const i = rec[q];
    const r = sim.tactRole[i];
    if (!sim.tactOn[i] || r === TACT_RANGED || r === TACT_CASTER || sim.state[i] !== S.CHASE || sim.waiting[i] !== 1) { T.flank[i] = -1; continue; }
    if (rank === 0) { // ring slot facing this beast (max dot with the table)
      const dx = st.x[i] - px, dy = st.y[i] - py;
      let best = -1e18;
      for (let k = 0; k < 6; k++) { const d = FLANK_X[k] * dx + FLANK_Y[k] * dy; if (d > best + 1e-9) { best = d; anchor = k; } }
    }
    if (T.flankLv === 0) { T.flank[i] = -1; continue; } // Easy (spec): no flank slots - waiters chase straight (see tacticsSteer)
    T.flank[i] = rank < 3 ? (anchor + 2 * rank) % 6 : (anchor + 2 * (rank - 3) + 1) % 6;
    rank = (rank + 1) % 6;
  }
}

/** Steer hook for a tactical slot (called from setSteerTarget). True = T.out holds the waypoint (x, y) + speed factor. */
export function tacticsSteer(sim, i, S) {
  const T = sim.tactics, st = sim.steer, o = T.out, px = sim._px, py = sim._py;
  if (sim.state[i] !== S.CHASE) return false;
  const role = sim.tactRole[i], w = sim.waiting[i];
  if (role === TACT_MELEE || role === TACT_SWARM) {
    if (T.flankLv === 0 && w === 1) { o.x = px; o.y = py; o.speed = 0.8; return true; } // Easy: straight chase, the token queue still gates who attacks
    if (w !== 1 || T.flank[i] < 0) return false;
    const k = T.flank[i], r = role === TACT_SWARM ? TACT_TUNING.swarmR : (T.flankLv === 2 ? TACT_TUNING.flankRHard : T.flankLv === 0 ? TACT_TUNING.flankREasy : TACT_TUNING.flankR);
    o.x = px + FLANK_X[k] * r; o.y = py + FLANK_Y[k] * r; o.speed = 0.8; return true;
  }
  const dx = st.x[i] - px, dy = st.y[i] - py, d = Math.sqrt(dx * dx + dy * dy) || 1;
  if (w === 2) { o.x = st.x[i] + (dx / d) * 4; o.y = st.y[i] + (dy / d) * 4; o.speed = 0.9; return true; } // back off
  if (w === 1) { // hold in the band, strafing 2 m between shots
    if (T.tick % TACT_TUNING.strafeEvery === 0) T.strafeDir[i] = (hashU(T.seed, i, T.tick) & 1) ? 1 : -1;
    o.x = st.x[i] + (-dy / d) * T.strafeDir[i] * TACT_TUNING.strafeM; o.y = st.y[i] + (dx / d) * T.strafeDir[i] * TACT_TUNING.strafeM; o.speed = 0.4; return true;
  }
  if (role === TACT_CASTER && sim.sc.allyN > 0) { // behind the allies: centroid + norm(centroid - player) * 6
    const cx = sim.sc.allyX / sim.sc.allyN, cy = sim.sc.allyY / sim.sc.allyN, ax = cx - px, ay = cy - py, al = Math.sqrt(ax * ax + ay * ay) || 1;
    o.x = cx + (ax / al) * TACT_TUNING.casterBehindM; o.y = cy + (ay / al) * TACT_TUNING.casterBehindM; o.speed = 0.8; return true;
  }
  return false;
}

/** Ranged / caster distance band inside checkChaseExit. True = handled (waiting 2 = backing off < backOffR, 1 = holding
 *  in/inside the band with LOS); false = approach. Band = sim.tactBand[3i..3i+2] = keepMin, keepMax, backOffR. Windup/shot
 *  itself arrives with the projectile attack story (this one only positions). */
export function tacticsBand(sim, i, d2) {
  const A = sim.tactBand, o = i * 3, bo = A[o + 2];
  if (d2 < bo * bo) { sim.waiting[i] = 2; return true; }
  if (d2 <= A[o + 1] * A[o + 1] && sim.seen[i]) { sim.waiting[i] = 1; return true; }
  sim.waiting[i] = 0; return false;
}

/** Ally centroid for the caster point: all live non-caster tactical slots within allyR of caster i. */
export function tacticsAllies(sim, i) {
  const st = sim.steer, r2 = TACT_TUNING.allyR * TACT_TUNING.allyR;
  let n = 0, sx = 0, sy = 0;
  for (let q = 0, rec = sim.pool.rec, pn = sim.pool.n; q < pn; q++) {
    const k = rec[q];
    if (k === i || !sim.tactOn[k] || sim.tactRole[k] === TACT_CASTER || sim.dormant[k] || sim.down[k]) continue;
    const dx = st.x[k] - st.x[i], dy = st.y[k] - st.y[i];
    if (dx * dx + dy * dy <= r2) { n++; sx += st.x[k]; sy += st.y[k]; }
  }
  sim.sc.allyN = n; sim.sc.allyX = sx; sim.sc.allyY = sy;
}
