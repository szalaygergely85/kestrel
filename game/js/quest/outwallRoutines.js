// game/js/quest/outwallRoutines.js (OUT-02). Data-driven idle routines for the Outwall exiles (D-069: Hesk, Dorrin, Sorrel, Pell, Tam).
// Logic only: stepRoutine() decides a target position + pose; the movement itself is the caller's (npcWalk.js / a kinematic mover).
// Time = game hour 0..24 from worldClock.clockHour(state) (2 real hours per day, D-064). Windows may wrap midnight (from > to).
// Stops are checked against the collision query in outwallRoutines.test.js. Spawn wiring = NEEDS B1-main (see docs/lanes/pc-b2.md).

export const ARRIVE_R = 0.4;
export const POSES = Object.freeze({ IDLE: 'idle', WALK: 'walk', WORK: 'work' });

/** Anchors (tools/gen-outwall.mjs, MAP-26): owGate (942,925.3) owBoard (921,945) owForge (912,935) relay plaza (912,952). */
export const ROUTINES = {
  hesk: { mesh: 'char.kit', stops: [ // exile elder: gate watch by day, board at midday, home by the fire at night
    { name: 'gate', x: 938, y: 930, from: 7, to: 12, dwell: 90, pose: 'idle' },
    { name: 'board', x: 922, y: 943, from: 7, to: 18, dwell: 60, pose: 'idle' },
    { name: 'plaza', x: 912, y: 948, from: 12, to: 20, dwell: 75, pose: 'idle' },
    { name: 'home', x: 924.4, y: 961.4, from: 20, to: 7, dwell: 60, pose: 'idle' },
  ] },
  dorrin: { mesh: 'char.kit', stops: [ // smith: anvil work at the forge all day, short plaza break, sleeps near the forge
    { name: 'anvil', x: 910, y: 939.1, from: 7, to: 19, dwell: 120, pose: 'work' },
    { name: 'plaza', x: 914, y: 946, from: 11, to: 14, dwell: 40, pose: 'idle' },
    { name: 'home', x: 906, y: 942, from: 19, to: 7, dwell: 60, pose: 'idle' },
  ] },
  sorrel: { mesh: 'NEEDS DESIGNER', meshNote: 'herb-woman: recolour of char.kit with herb basket', stops: [
    { name: 'herbs', x: 930, y: 962, from: 7, to: 17, dwell: 100, pose: 'work' },
    { name: 'board', x: 921, y: 942, from: 9, to: 17, dwell: 40, pose: 'idle' },
    { name: 'home', x: 932, y: 958, from: 17, to: 7, dwell: 60, pose: 'idle' },
  ] },
  pell: { mesh: 'NEEDS DESIGNER', meshNote: 'child: small char.kit (scale/recolour)', stops: [
    { name: 'gate', x: 936, y: 932, from: 8, to: 13, dwell: 30, pose: 'idle' },
    { name: 'plaza', x: 916, y: 952, from: 8, to: 19, dwell: 20, pose: 'idle' },
    { name: 'board', x: 920, y: 944, from: 13, to: 19, dwell: 30, pose: 'idle' },
    { name: 'home', x: 928, y: 956, from: 19, to: 8, dwell: 60, pose: 'idle' },
  ] },
  tam: { mesh: 'NEEDS DESIGNER', meshNote: 'old singer: elder recolour of char.kit', stops: [
    { name: 'plaza', x: 908, y: 954, from: 9, to: 21, dwell: 150, pose: 'idle' },
    { name: 'board', x: 918, y: 946, from: 14, to: 17, dwell: 45, pose: 'idle' },
    { name: 'home', x: 904, y: 958, from: 21, to: 9, dwell: 60, pose: 'idle' },
  ] },
};

export function inWindow(hour, from, to) { return from <= to ? hour >= from && hour < to : hour >= from || hour < to; }

/** Creates the per-NPC state. `id` = key of ROUTINES; (x,y) = where it stands now. */
export function createRoutineNpc(id, x, y, table = ROUTINES) {
  const r = table[id];
  if (!r) return null;
  return { id, routine: r, x, y, stop: -1, dwellLeft: 0, talking: false, out: { x, y, pose: POSES.IDLE, stop: '' } };
}

/** Player starts / ends a conversation: the NPC stands still, then resumes. */
export function setTalking(npc, on) { npc.talking = !!on; }

function pickNext(npc, hour) {
  const s = npc.routine.stops, n = s.length;
  for (let k = 1; k <= n; k++) { // the next stop (round robin) whose window is open
    const i = (npc.stop + k + n) % n;
    if (inWindow(hour, s[i].from, s[i].to)) return i;
  }
  return -1;
}

/**
 * Fixed step. (npc.x, npc.y) must be updated by the caller to where the NPC really is. Returns npc.out {x,y,pose,stop}:
 * the current target and pose ('walk' while travelling, else the stop's pose). Talking: target = current position, pose idle, dwell paused.
 */
export function stepRoutine(npc, clock, dt) {
  const o = npc.out, s = npc.routine.stops;
  if (npc.talking) { o.x = npc.x; o.y = npc.y; o.pose = POSES.IDLE; return o; }
  const hour = typeof clock === 'number' ? clock : clock.hour;
  const cur = npc.stop >= 0 ? s[npc.stop] : null;
  const closed = !cur || !inWindow(hour, cur.from, cur.to);
  const dx = cur ? cur.x - npc.x : 0, dy = cur ? cur.y - npc.y : 0;
  const arrived = cur && dx * dx + dy * dy <= ARRIVE_R * ARRIVE_R;
  if (!closed && arrived) npc.dwellLeft -= dt;
  if (closed || (arrived && npc.dwellLeft <= 0)) {
    const n = pickNext(npc, hour);
    if (n >= 0 && (n !== npc.stop || closed)) { npc.stop = n; npc.dwellLeft = s[n].dwell; }
    else if (n >= 0) npc.dwellLeft = s[n].dwell;
  }
  const t = npc.stop >= 0 ? s[npc.stop] : null;
  if (!t) { o.x = npc.x; o.y = npc.y; o.pose = POSES.IDLE; o.stop = ''; return o; }
  const ex = t.x - npc.x, ey = t.y - npc.y;
  o.x = t.x; o.y = t.y; o.stop = t.name;
  o.pose = ex * ex + ey * ey > ARRIVE_R * ARRIVE_R ? POSES.WALK : t.pose;
  return o;
}
