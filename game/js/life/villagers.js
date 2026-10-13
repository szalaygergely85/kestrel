// game/js/life/villagers.js (LIFE-03, architecture.md 38.56 a + e): drives the Outwall NPCs from schedule.js targets.
// Rule 15: no Math.random / wall clock / trig, 0 alloc per step, integer timers. Nothing is saved (positions derive from the clock).
//
//   const v = createVillagers({ life, nav: {grid, astar}, groundAt, hour, dayIndex, events, apply, isPaused });
//   v.step(hour, dayIndex, px, py);   // once per fixed 60 Hz step (px, py = player)
//   v.actors[i] = { id, x, y, z, yawDeg, anim, hidden, band }   // the host applies these (voxel + world.setEntityCollider; hidden -> HIDE_Z)
//
// life     = schedule.js life data (content/life/outwall.life.json); one actor per npc (<= MAX_VILLAGERS)
// apply(actor, i) = optional host callback after an actor changed (moved / hidden / anim)
// isPaused(id) = optional: true while npcWalk is scripting that NPC or the player talks to it (the OUT-01 seam); the villager freezes
// collide(x, y, out) = optional push-out query (world.collideCircle wrapper): writes out.x/out.y; the walk never ends inside a prop the 2 m nav cells miss
// events   = optional bus; `life:npcHit {npc}` (LIFE-08 raids) makes that villager flee home and park for FLEE_STEPS
// Bands (distance to the player): near < 60 m full 60 Hz; mid 60-150 m moves at 15 Hz (dt x4); far > 150 m: no walking, snaps to its spot.
import { createSchedule, step as schedStep, current, snap as schedSnap } from './schedule.js';
import { createMover, setGoal, planFor, stepMover, snapMover, nudgeMover, WALK_SPEED } from './npcMover.js';

export const MAX_VILLAGERS = 24;
export const NEAR_R = 60, MID_R = 150;
export const FLEE_SPEED = 3.4, FLEE_STEPS = 1200; // 20 s
export const BAND_NEAR = 0, BAND_MID = 1, BAND_FAR = 2;
const DT = 1 / 60, FLEE_SCALE = FLEE_SPEED / WALK_SPEED;

export function createVillagers({ life, nav, groundAt = null, hour = 7, dayIndex = 0, events = null, apply = null, isPaused = null, collide = null }) {
  const n = Math.min(life.npcs.length, MAX_VILLAGERS);
  const sched = createSchedule(life, hour, dayIndex);
  sched.n = n;
  const movers = [], actors = [];
  const last = new Int16Array(n).fill(-2);   // last activity index seen per npc
  const flee = new Int32Array(n);            // steps of flee left
  const queue = new Int16Array(MAX_VILLAGERS * 2); let qh = 0, qt = 0, qn = 0; // FIFO of npc idx needing a path
  const queued = new Uint8Array(n);
  const idIndex = new Map();                 // load-time only
  const push = { x: 0, y: 0 };
  const stats = { astar: 0, maxPerStep: 0, steps: 0 };
  let tick = 0;

  const ground = (x, y) => (groundAt ? groundAt(x, y) : 0);
  function put(i, hidden) { // publish the mover state to the actor
    const a = actors[i], m = movers[i];
    a.x = m.x; a.y = m.y; a.yawDeg = m.yawDeg; a.hidden = hidden;
    a.z = ground(m.x, m.y);
    if (apply) apply(a, i);
  }
  function setAnim(i, anim) { const a = actors[i]; if (a.anim !== anim) { a.anim = anim; if (apply) apply(a, i); } }
  function enqueue(i) { if (queued[i]) return; queued[i] = 1; queue[qt] = i; qt = (qt + 1) % queue.length; qn++; }
  function goalOf(i, c) { return flee[i] > 0 || c.kind === 'sleep' ? life.npcs[i].home : null; }
  /** Target for npc i: its sleep/flee home, else the activity spot. Writes through setGoal; queues a plan when needed. */
  function retarget(i) {
    const c = current(sched, i), home = goalOf(i, c);
    const gx = home ? home[0] : c.x, gy = home ? home[1] : c.y;
    if (setGoal(movers[i], gx, gy)) enqueue(i);
  }
  /** Far / reload snap: stand on the spot (hidden when asleep or fleeing-parked). */
  function snapTo(i) {
    const c = current(sched, i), home = goalOf(i, c), m = movers[i];
    snapMover(m, home ? home[0] : c.x, home ? home[1] : c.y);
    actors[i].anim = 'idle';
    put(i, c.kind === 'sleep' || flee[i] > 0);
    last[i] = sched.act[i];
  }
  for (let i = 0; i < n; i++) {
    const npc = life.npcs[i];
    idIndex.set(npc.id, i);
    movers.push(createMover(npc.home[0], npc.home[1]));
    actors.push({ id: npc.id, x: 0, y: 0, z: 0, yawDeg: 0, anim: 'idle', hidden: false, band: BAND_FAR });
    snapTo(i);
  }
  const unsub = events ? events.on('life:npcHit', (p) => {
    const i = idIndex.get(p && p.npc);
    if (i !== undefined) { flee[i] = FLEE_STEPS; last[i] = -2; }
  }) : null;

  function step(hr, day, px, py) {
    tick++; stats.steps++;
    schedStep(sched, hr, day);
    // at most ONE A* request per step (FIFO)
    let reqs = 0;
    if (qn > 0) {
      const i = queue[qh]; qh = (qh + 1) % queue.length; qn--; queued[i] = 0;
      const m = movers[i];
      if (m.pending && !actors[i].hidden) { planFor(m, nav.grid, nav.astar); stats.astar++; reqs = 1; }
    }
    if (reqs > stats.maxPerStep) stats.maxPerStep = reqs;
    for (let i = 0; i < n; i++) {
      const a = actors[i], m = movers[i];
      const dx = m.x - px, dy = m.y - py, d2 = dx * dx + dy * dy;
      const band = d2 < NEAR_R * NEAR_R ? BAND_NEAR : d2 < MID_R * MID_R ? BAND_MID : BAND_FAR;
      a.band = band;
      if (flee[i] > 0 && --flee[i] === 0) last[i] = -2;       // flee over: wake up at home, resume the schedule
      if (isPaused && isPaused(a.id)) continue;                // scripted walk / player talk owns it
      if (band === BAND_FAR) {                                 // abstract: no walking, parked on the current spot
        if (last[i] !== sched.act[i] || !m.arrived || a.hidden !== (current(sched, i).kind === 'sleep' || flee[i] > 0)) snapTo(i);
        continue;
      }
      if (last[i] !== sched.act[i]) {                          // activity changed (decision tick) or flee start/end
        last[i] = sched.act[i];
        if (a.hidden && flee[i] === 0 && current(sched, i).kind !== 'sleep') put(i, false); // wake: reappear at the door
        else if (!a.hidden && flee[i] > 0) { /* running home */ }
        retarget(i);
      }
      if (a.hidden) continue;
      if (band === BAND_MID && ((tick + i) & 3) !== 0) continue;
      const moved = stepMover(m, band === BAND_NEAR ? DT : DT * 4, flee[i] > 0 ? FLEE_SCALE : 1);
      if (moved) {
        if (collide) { collide(m.x, m.y, push); if (push.x !== m.x || push.y !== m.y) nudgeMover(m, push.x, push.y); }
        put(i, false);
      }
      if (m.arrived) {
        const c = current(sched, i);
        if ((c.kind === 'sleep' || flee[i] > 0) && m.gx === life.npcs[i].home[0] && m.gy === life.npcs[i].home[1]) put(i, true); // park inside the house
        else setAnim(i, c.pose === 'work' ? 'work' : 'idle');
      } else if (m.walking) setAnim(i, 'walk');
    }
  }

  /** Load / teleport: reset the schedule from the clock and put everyone on their spot. */
  function snapAll(hr, day) { schedSnap(sched, hr, day); for (let i = 0; i < n; i++) { flee[i] = 0; snapTo(i); } }
  return { n, actors, movers, sched, stats, step, snapAll, dispose() { if (unsub) unsub(); } };
}
