// game/js/quest/sim/brains/waterBrain.js (BEAST-08b + 08b-PIN + CROC-SOFT, architecture.md 38.64 item 5, D-096 option B, D-088).
// Water-medium beastSim slots (archetype medium 'water') live OUTSIDE the land pipeline: beastSim.live() skips them (sim.wat[i] = 1,
// steer agent parked) and stepWaterBrain() runs them over the water-mask swim/croc grids (brains/water.js pool, pool slot == beast slot).
// States reuse the beastSim enum: SUBMERGED 20 (wander / approach), WINDUP 3 (0.7 s tell), CHARGE 4 (lunge), GRAB 21, RECOVER 5, FLINCH 8.
// Croc: lunge 4 m after a 0.7 s tell, one attack per 4 s, GRAB 1.5 s = 3 ticks of 4 % player HP (12 % total, 15 % hard cap), the player
// escapes by mashing (sim.grabMash(i) counter, fed by the game), then 3 s retreat into deep water. A croc is never > 3 m from water.
// The grab is a MOVEMENT-ONLY pin (D-088): the sim only emits `beast:grab {slot,on}`; camera/attack/block/items stay free (D-064).
// Eel / turtle ('swimmer' arch) only aggro on a swimming player (mask 1 under the player). Turtle blocks hits from its front.
// Rule 15: no Math.random / trig / clock; integer timers; 0 allocation in step (all buffers made in create).
import { createSwimmers, initSwimmer, stepSwimmer, KIND_SWIMMER, KIND_CROC, SWIM_SUBMERGE_M } from './water.js';
import { ARCHETYPES } from '../archetypes.js';
import { KINDS, KIND_NAMES } from '../beastKinds.js';

const ST_WINDUP = 3, ST_CHARGE = 4, ST_RECOVER = 5, ST_FLINCH = 8, ST_SUB = 20, ST_GRAB = 21;
export const CROC = Object.freeze({
  lungeM: 4, tellSteps: 42, lungeSpd: 9 / 60, cycleSteps: 240, // one attack per 4 s (from lunge start)
  grabSteps: 90, tickEvery: 30, tickFrac: 0.04, capFrac: 0.15, mashNeed: 8, retreatSteps: 180, nearWaterM: 3, contactM: 1.3,
});
const HIT_FLINCH = 15;

function nearWater(s, x, y, r) {
  const g = s.nav.grid, cx = g.cellX(x), cy = g.cellY(y), R = Math.ceil(r / g.cell), r2 = r * r, c2 = g.cell * g.cell;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const ax = cx + dx, ay = cy + dy;
    if (ax < 0 || ay < 0 || ax >= g.w || ay >= g.h) continue;
    if (s.nav.mask[ay * g.w + ax] === 1 && (dx * dx + dy * dy) * c2 <= r2) return true;
  }
  return false;
}
/** Can slot i stand on (x,y)? Swimmers: mask 1 only (grid cost). Croc: croc grid AND within nearWaterM of deep water. */
function canStand(s, i, x, y) {
  const g = s.nav.grid, cx = g.cellX(x), cy = g.cellY(y);
  if (!g.inBounds(cx, cy)) return false;
  const m = s.nav.mask[cy * g.w + cx];
  if (s.kind[i] === KIND_CROC) return m === 1 || (m === 2 && nearWater(s, x, y, CROC.nearWaterM));
  return m === 1;
}
/** Move slot i by (dx,dy) (already speed-scaled); slides along one axis when blocked. */
function moveBy(s, i, dx, dy) {
  const x = s.x[i], y = s.y[i];
  if (canStand(s, i, x + dx, y + dy)) { s.x[i] = x + dx; s.y[i] = y + dy; return true; }
  if (dx !== 0 && canStand(s, i, x + dx, y)) { s.x[i] = x + dx; return true; }
  if (dy !== 0 && canStand(s, i, x, y + dy)) { s.y[i] = y + dy; return true; }
  return false;
}
/** Nearest mask-1 cell centre within 5 cells of (x,y) -> out[0..1]; false when none. */
function nearestDeep(s, x, y, out) {
  const g = s.nav.grid, cx = g.cellX(x), cy = g.cellY(y);
  let best = 1e9;
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
    const ax = cx + dx, ay = cy + dy, d = dx * dx + dy * dy;
    if (d >= best || ax < 0 || ay < 0 || ax >= g.w || ay >= g.h || s.nav.mask[ay * g.w + ax] !== 1) continue;
    best = d; out[0] = g.cellCenterX(ax); out[1] = g.cellCenterY(ay);
  }
  return best < 1e9;
}

/**
 * @param {any} sim the beastSim object (state/timer/fx/fy/steer/entities/events/_hitPayload/count/kindIdx)
 * @param {any} nav buildWaterNav result
 * @param {{playerMaxHp?:number, hpPerDamage?:number, seed?:number}} [o]
 * @returns the brain (null when no slot is a water kind)
 */
export function createWaterBrain(sim, nav, o = {}) {
  const n = sim.count, kindOf = new Uint8Array(n);
  let any = 0;
  for (let i = 0; i < n; i++) {
    const kn = KIND_NAMES[sim.kindIdx[i]], K = KINDS[kn], A = K && ARCHETYPES[K.arch];
    if (!A || A.medium !== 'water') continue;
    any++; sim.wat[i] = 1; kindOf[i] = 1;
  }
  if (!any) return null;
  const s = createSwimmers(nav, { max: n, seed: o.seed ?? 1 });
  const wb = {
    s, sim, n, tick: 0, out: new Float64Array(2), grabSlot: -1,
    croc: new Uint8Array(n), swimmerOnly: new Uint8Array(n), block: new Uint8Array(n),
    noticeR: new Float64Array(n), atkR: new Float64Array(n), atkWind: new Int32Array(n), atkRec: new Int32Array(n),
    cd: new Int32Array(n), mash: new Int32Array(n), ticks: new Uint8Array(n), tgX: new Float64Array(n), tgY: new Float64Array(n), spent: new Float64Array(n),
    maxHp: o.playerMaxHp ?? 30, hpPerDamage: o.hpPerDamage ?? 5,
    grabPayload: { slot: 0, on: 0, x: 0, y: 0 },
  };
  for (let i = 0; i < n; i++) {
    if (!kindOf[i]) continue;
    const kn = KIND_NAMES[sim.kindIdx[i]], K = KINDS[kn], A = ARCHETYPES[K.arch], at = K.attacks && K.attacks[0];
    const isCroc = at && at.type === 'lunge' ? 1 : 0;
    wb.croc[i] = isCroc; wb.swimmerOnly[i] = K.arch === 'swimmer' ? 1 : 0; wb.block[i] = kn === 'snapping_turtle' ? 1 : 0;
    wb.noticeR[i] = A.noticeR; wb.atkR[i] = at ? at.range : 1.8;
    wb.atkWind[i] = at ? Math.max(1, Math.round(at.windupSec * 60)) : 36; wb.atkRec[i] = at ? Math.round(at.recoverSec * 60) : 90;
    const t = sim.entities[i].transform;
    s.sp[i] = (K.walk || A.walk) / 60;
    if (!initSwimmer(s, i, isCroc ? KIND_CROC : KIND_SWIMMER, t.x, t.y)) { sim.wat[i] = 0; wb.croc[i] = 0; continue; } // not on water: stays a land slot
    sim.steer.active[i] = 0; sim.steer.vx[i] = 0; sim.steer.vy[i] = 0;
    sim.state[i] = ST_SUB;
  }
  return wb;
}

/** Player escape input: the game calls this once per mash press while `beast:grab` is on. */
export function grabMash(wb, i) { if (wb.sim.state[i] === ST_GRAB) wb.mash[i]++; }

function emitGrab(wb, i, on) {
  const p = wb.grabPayload, s = wb.s;
  p.slot = i; p.on = on; p.x = s.x[i]; p.y = s.y[i];
  wb.grabSlot = on ? i : -1;
  wb.sim.events.emit('beast:grab', p);
}
function hitPlayer(wb, i, frac) {
  const hp = wb.sim._hitPayload[i];
  hp.damage = frac * wb.maxHp / wb.hpPerDamage; hp.blocked = 0;
  wb.sim.events.emit('combat:hit', hp);
}
function setTarget(wb, i, x, y) { wb.tgX[i] = x; wb.tgY[i] = y; }

/** Hits on a water slot: turtle front block (before damage, returns true = blocked), tell cancel, grab ignores. */
export function waterBlocks(wb, sim, i, p) {
  if (!wb.block[i] || typeof p.dirX !== 'number') return false;
  // dir = knock direction (away from the attacker): the attacker is in front when the beast faces against it
  return -(p.dirX * sim.fx[i] + p.dirY * sim.fy[i]) > 0.5;
}
export function waterHit(wb, sim, i, p) {
  const st = sim.state[i];
  if (st === ST_GRAB || st === ST_CHARGE) return;
  if (st === ST_WINDUP) { sim.state[i] = ST_SUB; wb.cd[i] = Math.max(wb.cd[i], 120); return; } // arrow / hit cancels the tell
  sim.state[i] = ST_FLINCH; sim.timer[i] = HIT_FLINCH;
}

/** SPELL-R2 Freeze: a frozen croc lets go of the player (emits beast:grab off) and holds still `steps` steps (flinch = no movement). */
export function waterFreeze(wb, sim, i, steps) {
  if (sim.state[i] === ST_GRAB && wb.grabSlot === i) emitGrab(wb, i, 0);
  sim.state[i] = ST_FLINCH; sim.timer[i] = steps; wb.mash[i] = 0;
}

function release(wb, i) {
  const sim = wb.sim;
  if (wb.grabSlot === i) emitGrab(wb, i, 0);
  sim.state[i] = ST_RECOVER; sim.timer[i] = CROC.retreatSteps; wb.mash[i] = 0;
}

function stepSlot(wb, i, px, py, pDeep) {
  const sim = wb.sim, s = wb.s, st = sim.state[i];
  if (wb.cd[i] > 0) wb.cd[i]--;
  const dx = px - s.x[i], dy = py - s.y[i], d2 = dx * dx + dy * dy, d = Math.sqrt(d2), inv = d > 1e-9 ? 1 / d : 0;
  if (st === ST_FLINCH) { if (--sim.timer[i] <= 0) sim.state[i] = ST_SUB; return; }
  if (st === ST_GRAB) {
    sim.fx[i] = dx * inv; sim.fy[i] = dy * inv;
    const t = CROC.grabSteps - sim.timer[i]; // steps held
    if (--sim.timer[i] <= 0 || wb.mash[i] >= CROC.mashNeed) { release(wb, i); return; }
    if ((t + 1) % CROC.tickEvery === 0 && wb.ticks[i] < 3 && wb.spent[i] + CROC.tickFrac <= CROC.capFrac) { wb.ticks[i]++; wb.spent[i] += CROC.tickFrac; hitPlayer(wb, i, CROC.tickFrac); }
    return;
  }
  if (st === ST_RECOVER) { // retreat to deep water (croc) / short pause (others)
    if (wb.croc[i]) { if (nearestDeep(s, s.x[i], s.y[i], wb.out)) { const ex = wb.out[0] - s.x[i], ey = wb.out[1] - s.y[i], e = Math.sqrt(ex * ex + ey * ey); if (e > 0.05) moveBy(s, i, ex / e * 0.05, ey / e * 0.05); } }
    if (--sim.timer[i] <= 0) sim.state[i] = ST_SUB;
    return;
  }
  const aggroOk = wb.swimmerOnly[i] ? pDeep : (pDeep || nearWater(s, px, py, CROC.nearWaterM));
  if (st === ST_WINDUP) {
    sim.fx[i] = dx * inv; sim.fy[i] = dy * inv;
    if (--sim.timer[i] <= 0) {
      if (wb.croc[i]) { setTarget(wb, i, px, py); sim.state[i] = ST_CHARGE; wb.spent[i] = 0; }
      else { if (d <= wb.atkR[i] + 0.6) { const hp = sim._hitPayload[i]; hp.blocked = 0; sim.events.emit('combat:hit', hp); } wb.cd[i] = wb.atkRec[i] + 60; sim.state[i] = ST_RECOVER; sim.timer[i] = 30; }
    }
    return;
  }
  if (st === ST_CHARGE) { // lunge: straight at the frozen point, <= 4 m total, never off the croc grid / > 3 m from water
    const tx = wb.tgX[i] - s.x[i], ty = wb.tgY[i] - s.y[i], td = Math.sqrt(tx * tx + ty * ty);
    if (d <= CROC.contactM) { // bite: grab
      sim.state[i] = ST_GRAB; sim.timer[i] = CROC.grabSteps; wb.mash[i] = 0; wb.ticks[i] = 0; wb.spent[i] = 0;
      emitGrab(wb, i, 1); return;
    }
    const step = CROC.lungeSpd;
    if (td < 0.05 || wb.spent[i] + step > CROC.lungeM || !moveBy(s, i, tx / td * step, ty / td * step)) { sim.state[i] = ST_RECOVER; sim.timer[i] = wb.atkRec[i]; return; }
    wb.spent[i] += step; sim.fx[i] = tx / td; sim.fy[i] = ty / td;
    return;
  }
  // SUBMERGED: calm wander, or approach an eligible player
  if (aggroOk && d <= wb.noticeR[i]) {
    sim.fx[i] = dx * inv; sim.fy[i] = dy * inv;
    if (d <= wb.atkR[i] && wb.cd[i] === 0) {
      sim.state[i] = ST_WINDUP; sim.timer[i] = wb.croc[i] ? CROC.tellSteps : wb.atkWind[i];
      if (wb.croc[i]) wb.cd[i] = CROC.cycleSteps; // one attack per 4 s counted from the tell
      return;
    }
    if (d > wb.atkR[i] * 0.6) moveBy(s, i, dx * inv * s.sp[i] * 2, dy * inv * s.sp[i] * 2);
    return;
  }
  stepSwimmer(s, i);
}

/** One 60 Hz step for every live water slot; writes steer.x/y + transform (z = surface - 0.4, surface when attacking). */
export function stepWaterBrain(wb, px, py) {
  const sim = wb.sim, s = wb.s, g = s.nav.grid, st = sim.steer;
  s.tick++;
  const pc = g.inBounds(g.cellX(px), g.cellY(py)) ? s.nav.mask[g.cellY(py) * g.w + g.cellX(px)] : 0, pDeep = pc === 1;
  for (let q = 0, rec = sim.pool.rec, pn = sim.pool.n; q < pn; q++) {
    const i = rec[q];
    if (sim.wat[i] === 0 || sim.dormant[i] !== 0) continue;
    const state = sim.state[i];
    if (state >= 9 && state <= 12) { if (wb.grabSlot === i) emitGrab(wb, i, 0); continue; } // dying / dead: drop the pin
    if (state === 0) sim.state[i] = ST_SUB; // resetAll puts slots back in WANDER
    s.x[i] = st.x[i]; s.y[i] = st.y[i];
    stepSlot(wb, i, px, py, pDeep);
    st.active[i] = 0; st.x[i] = s.x[i]; st.y[i] = s.y[i];
    const t = sim.entities[i].transform, c = g.cellY(s.y[i]) * g.w + g.cellX(s.x[i]), a = sim.state[i];
    const surf = s.nav.surf[c];
    s.z[i] = surf - (a === ST_WINDUP || a === ST_CHARGE || a === ST_GRAB ? 0 : SWIM_SUBMERGE_M);
    t.x = s.x[i]; t.y = s.y[i]; t.z = s.z[i];
  }
}
