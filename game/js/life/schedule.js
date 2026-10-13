// game/js/life/schedule.js (LIFE-02, arch 38.56 a). Villager schedules with needs. LOGIC ONLY: no movement (LIFE-03), no main.js (LIFE-04), no save.
// Rule 15: no Math.random, no wall clock, no trig, no Map iteration, 0 alloc per step (struct-of-arrays state, the output is a reused object).
// Time = game hour 0..24 (worldClock.clockHour, 300 s real per game hour). Windows may wrap midnight (from > to).
import { ROUTINES, inWindow } from '../quest/outwallRoutines.js';

export const KINDS = Object.freeze(['sleep', 'work', 'eat', 'walk', 'idle', 'chat']);
export const DECISION_PERIOD = 60;         // fixed steps (60 Hz) between decisions = 1 s, staggered by idx % 60
export const HOURS_PER_SECOND = 24 / 7200; // 2 real hours per day (D-064)
// Default priorities per kind; activities may override with `prio`.
export const PRIO = Object.freeze({ sleep: 1, work: 0.5, eat: 0.1, chat: 0.1, idle: 0.2, walk: 0.15 });
// Needs drift per GAME hour (arch 38.56 a); eat / chat refill rates are per game hour while that activity runs.
export const RATE = Object.freeze({ energyAwake: -0.06, energyAsleep: 0.15, hunger: 0.08, social: 0.05, eat: -1.5, chat: -0.8 });

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Small integer hash (deterministic, in the spirit of hashFastU(npcIdx, dayIndex, salt)). */
export function hashU(a, b, c) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Converts the OUT-02 ROUTINES table into the life data format (content/life/outwall.life.json):
 * {version, needs:{energy,hunger,social}, npcs:[{id, mesh, home:[x,y], activities:[{kind, name, at:[x,y], from, to, dwell, pose, need?, prio?}]}]}.
 * The 'home' stop becomes `sleep`; work-pose stops `work`; other stops `idle`; plus two `eat` and one `chat` activity at the plaza (or board) stop.
 */
export function lifeFromRoutines(table = ROUTINES) {
  const npcs = [];
  for (const id of Object.keys(table)) {
    const r = table[id], acts = [];
    let home = null, spot = null;
    for (const s of r.stops) {
      const kind = s.name === 'home' ? 'sleep' : s.pose === 'work' ? 'work' : 'idle';
      acts.push({ kind, name: s.name, at: [s.x, s.y], from: s.from, to: s.to, dwell: s.dwell, pose: s.pose });
      if (kind === 'sleep') home = [s.x, s.y];
      else if (s.name === 'plaza' || (!spot && s.name === 'board')) spot = s;
    }
    spot = spot || r.stops[0];
    acts.push({ kind: 'eat', name: 'meal', at: [spot.x, spot.y], from: 12, to: 14, dwell: 60, pose: 'idle', need: 'hunger' });
    acts.push({ kind: 'eat', name: 'supper', at: [spot.x, spot.y], from: 18, to: 20, dwell: 60, pose: 'idle', need: 'hunger' });
    acts.push({ kind: 'chat', name: 'gossip', at: [spot.x, spot.y], from: 15, to: 18, dwell: 60, pose: 'idle', need: 'social' });
    npcs.push({ id, mesh: r.mesh, home: home || [r.stops[0].x, r.stops[0].y], activities: acts });
  }
  return { version: 1, needs: { energy: 0.8, hunger: 0.3, social: 0.3 }, npcs };
}

function sleepIndex(npc, hour) {
  const a = npc.activities;
  for (let i = 0; i < a.length; i++) if (a[i].kind === 'sleep' && inWindow(hour, a[i].from, a[i].to)) return i;
  return -1;
}

/**
 * The choice: a sleep window is forced; else the open activity with the highest prio + needBonus
 * (eat -> hunger, chat -> social), ties broken by hash(npcIdx, dayIndex, activityIdx). Returns the index, or -1 (nothing open: idle at home).
 */
export function choose(npc, idx, hour, dayIndex, hunger, social) {
  const s = sleepIndex(npc, hour);
  if (s >= 0) return s;
  const a = npc.activities;
  let best = -1, bs = -1e9, bh = 0;
  for (let i = 0; i < a.length; i++) {
    const act = a[i];
    if (!inWindow(hour, act.from, act.to)) continue;
    let sc = (act.prio !== undefined ? act.prio : PRIO[act.kind]);
    if (act.kind === 'eat') sc += hunger; else if (act.kind === 'chat') sc += social;
    const h = hashU(idx, dayIndex, i);
    if (sc > bs || (sc === bs && h > bh)) { best = i; bs = sc; bh = h; }
  }
  return best;
}

/** Needs as a pure function of the clock (no save: load / teleport / > 120 m snap). Hours awake counted from the end of the sleep window. */
export function needsFromHour(npc, hour, start, out) {
  let wake = 7, sleepLen = 10;
  for (const a of npc.activities) if (a.kind === 'sleep') { wake = a.to; sleepLen = (a.to - a.from + 24) % 24; break; }
  const asleep = sleepIndex(npc, hour) >= 0;
  const awakeH = (hour - wake + 24) % 24;
  out.energy = clamp01(asleep ? 0.2 + RATE.energyAsleep * ((hour - (wake - sleepLen) + 48) % 24) : start.energy + RATE.energyAwake * awakeH);
  out.hunger = clamp01(start.hunger * 0.5 + RATE.hunger * (asleep ? 0 : awakeH % 6));
  out.social = clamp01(start.social + RATE.social * (asleep ? 0 : awakeH));
  return out;
}

const _n = { energy: 0, hunger: 0, social: 0 };
/** Where an NPC is at `hour` (derived, not stepped): {act, kind, x, y, pose}. Fresh object; for load / teleport only (not per step). */
export function resolveAt(life, idx, hour, dayIndex = 0) {
  const npc = life.npcs[idx];
  needsFromHour(npc, hour, life.needs, _n);
  const i = choose(npc, idx, hour, dayIndex, _n.hunger, _n.social);
  if (i < 0) return { act: -1, kind: 'idle', x: npc.home[0], y: npc.home[1], pose: 'idle' };
  const a = npc.activities[i];
  return { act: i, kind: a.kind, x: a.at[0], y: a.at[1], pose: a.pose };
}

/** Runtime state (struct of arrays). `hour` seeds the needs and the first activity (the no-save snap). */
export function createSchedule(life, hour = 7, dayIndex = 0) {
  const n = life.npcs.length;
  const s = { life, n, tick: 0, energy: new Float32Array(n), hunger: new Float32Array(n), social: new Float32Array(n),
    act: new Int16Array(n).fill(-1), out: { act: -1, kind: 'idle', x: 0, y: 0, pose: 'idle' } };
  snap(s, hour, dayIndex);
  return s;
}

/** Resets needs + current activity from the clock (load, teleport, > 120 m). */
export function snap(s, hour, dayIndex = 0) {
  for (let i = 0; i < s.n; i++) {
    const npc = s.life.npcs[i];
    needsFromHour(npc, hour, s.life.needs, _n);
    s.energy[i] = _n.energy; s.hunger[i] = _n.hunger; s.social[i] = _n.social;
    s.act[i] = choose(npc, i, hour, dayIndex, _n.hunger, _n.social);
  }
}

/**
 * One fixed step (60 Hz). NPC i decides when tick % 60 === i % 60 (staggered); at that moment its needs drift by 1 s of game time
 * and it picks again. Pass the current game `hour` and `dayIndex`. 0 alloc.
 */
export function step(s, hour, dayIndex) {
  const t = s.tick++, dtH = HOURS_PER_SECOND * (DECISION_PERIOD / 60);
  const phase = t % DECISION_PERIOD;
  for (let i = phase; i < s.n; i += DECISION_PERIOD) {
    const npc = s.life.npcs[i], cur = s.act[i];
    const kind = cur >= 0 ? npc.activities[cur].kind : 'idle';
    s.energy[i] = clamp01(s.energy[i] + (kind === 'sleep' ? RATE.energyAsleep : RATE.energyAwake) * dtH);
    s.hunger[i] = clamp01(s.hunger[i] + (RATE.hunger + (kind === 'eat' ? RATE.eat : 0)) * dtH);
    s.social[i] = clamp01(s.social[i] + (RATE.social + (kind === 'chat' ? RATE.chat : 0)) * dtH);
    s.act[i] = choose(npc, i, hour, dayIndex, s.hunger[i], s.social[i]);
  }
}

/** Current activity of NPC i as a reused object {act, kind, x, y, pose} (valid until the next call). */
export function current(s, i) {
  const npc = s.life.npcs[i], k = s.act[i], o = s.out;
  o.act = k;
  if (k < 0) { o.kind = 'idle'; o.x = npc.home[0]; o.y = npc.home[1]; o.pose = 'idle'; return o; }
  const a = npc.activities[k];
  o.kind = a.kind; o.x = a.at[0]; o.y = a.at[1]; o.pose = a.pose;
  return o;
}
