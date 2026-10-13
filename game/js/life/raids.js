// game/js/life/raids.js (LIFE-08, architecture.md 38.56 d): wolf pack raids on a target anchor (goose farm / Outwall edge).
// Rule 15 of sim/**: no Math.random, no wall clock, no trig, 0 allocation per step. The roll is a pure hash of (night, raid).
//
//   const raids = createRaids({ defs, sim, events, state, anchors, npcPos });
//   raids.step(dayIndex, hour);   // once per game step (cheap: one comparison unless a raid is active / the night starts)
//
// defs[i] = { id, pack: [beast ids], target: 'gooseFarm', from: 21, to: 5, chancePerNight: 0.35, requires?: flagKey,
//             cooldownDays: 2, alt?: [npc ids] }   (alt = villager ids that count as alt targets, <= 8; a raid has only these)
// sim     = beastSim (slotOf, isDead, setGoal, clearGoal, setAltTargets; 'beast:altHit' on `events`)
// state   = world.state (plain object, saved with the world): `life.raid.<id>.lastDay` (night index) + `life.raid.<id>.defended`
// anchors = { name: [x, y] }   npcPos(id, out) -> true and fills out.x/out.y, or false when the npc is not out and about
//
// GOB-06 (38.57 (4)): a def may carry `campId` (+ `torches` 0..3) instead of `pack`: the pack is that camp's member ids (opts.campDefs =
// goblinCamps defs) and there is no raid while the camp is down (state 'life.camp.<id>.down'). The first `torches` living members swap to
// the goblinTorch model (sim.entities[slot].components.voxel.model) at start; back at raid end or when that member dies.
//
// Events: life:raid:start {id}, life:npcHit {npc}, life:raid:defended {id}, life:raid:lost {id}.
// Villagers never die: `life:npcHit` is the villagers module's cue to switch that npc to its flee activity.
// A raid in progress at save is not resumed (the lastDay key makes that night used up); `lost` has no permanent cost (owner has not decided).

export const MAX_ALT = 8;
export const MAX_TORCHES = 3;
const TORCH_MODEL = 'goblinTorch'; // keep equal to goblinBrain.GOBLIN_TORCH_MODEL (game/js/quest/sim/goblinBrain.js)
const downStateKey = (id) => 'life.camp.' + id + '.down'; // keep equal to goblinCamps.downKey

/** 32-bit integer mix -> [0,1). Deterministic stand-in for hashFastU(night, raidIdx, salt). */
export function raidRoll(night, idx) {
  let h = Math.imul(night | 0, 0x9e3779b1) ^ Math.imul((idx | 0) + 0x7f4a7c15, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The night index of (dayIndex, hour) when inside [from, to) (wraps midnight), else -1. A night belongs to the day it began. */
export function nightOf(dayIndex, hour, from, to) {
  if (from <= to) return hour >= from && hour < to ? dayIndex : -1;
  if (hour >= from) return dayIndex;
  if (hour < to) return dayIndex - 1;
  return -1;
}

export function lastDayKey(id) { return 'life.raid.' + id + '.lastDay'; }
export function defendedKey(id) { return 'life.raid.' + id + '.defended'; }

export function createRaids(opts) {
  const { sim, events, state, anchors, npcPos } = opts;
  const defs = opts.defs || [];
  const n = defs.length;
  const campDefs = opts.campDefs || [];
  const packIds = (d) => {
    if (d.pack) return d.pack;
    const c = campDefs.find((x) => x.id === d.campId);
    return c ? c.members.map((m) => m.id) : [];
  };
  const slots = defs.map((d) => packIds(d).map((id) => sim.slotOf(id)).filter((s) => s >= 0));
  const torchSlot = new Int32Array(n * MAX_TORCHES).fill(-1), torchOrig = defs.map(() => new Array(MAX_TORCHES).fill(''));
  const voxelOf = (s) => { const e = sim.entities && sim.entities[s]; return e && e.components ? e.components.voxel : null; };
  function dropTorch(r, j) {
    const s = torchSlot[r * MAX_TORCHES + j];
    if (s < 0) return;
    const v = voxelOf(s);
    if (v) v.model = torchOrig[r][j];
    torchSlot[r * MAX_TORCHES + j] = -1;
  }
  const active = new Uint8Array(n);
  const hitPayload = defs.map(() => ({ npc: '' }));
  const evPayload = defs.map((d) => ({ id: d.id }));
  const tmp = { x: 0, y: 0 };
  const ax = new Float64Array(MAX_ALT), ay = new Float64Array(MAX_ALT);
  const altMap = new Int32Array(MAX_ALT); // packed alt index -> index into def.alt
  let current = -1; // the raid that owns the sim's single alt-target set
  let curNight = -1;
  const rolled = new Int32Array(n).fill(-1 << 30); // last night rolled (a failed roll is deterministic: once per night is enough)

  const offHit = events.on('beast:altHit', (p) => {
    if (current < 0 || !defs[current].alt) return;
    const k = p.alt, id = k >= 0 && k < MAX_ALT ? defs[current].alt[altMap[k]] : undefined;
    if (id === undefined) return;
    hitPayload[current].npc = id;
    events.emit('life:npcHit', hitPayload[current]);
  });

  function packAlive(r) {
    let c = 0;
    for (let k = 0; k < slots[r].length; k++) if (!sim.isDead(slots[r][k])) c++;
    return c;
  }

  function start(r, night) {
    const d = defs[r], a = anchors[d.target];
    if (!a) return;
    state[lastDayKey(d.id)] = night;
    for (let k = 0; k < slots[r].length; k++) if (!sim.isDead(slots[r][k])) sim.setGoal(slots[r][k], a[0], a[1]);
    let t = 0; const want = Math.min(d.torches | 0, MAX_TORCHES);
    for (let k = 0; k < slots[r].length && t < want; k++) {
      const s = slots[r][k], v = sim.isDead(s) ? null : voxelOf(s);
      if (!v) continue;
      torchOrig[r][t] = v.model; torchSlot[r * MAX_TORCHES + t] = s; v.model = TORCH_MODEL; t++;
    }
    active[r] = 1; current = r;
    events.emit('life:raid:start', evPayload[r]);
  }

  function end(r, defended) {
    const d = defs[r];
    for (let k = 0; k < slots[r].length; k++) sim.clearGoal(slots[r][k]);
    sim.setAltTargets(0, ax, ay);
    for (let j = 0; j < MAX_TORCHES; j++) dropTorch(r, j);
    active[r] = 0; current = -1;
    if (defended) state[defendedKey(d.id)] = true;
    events.emit(defended ? 'life:raid:defended' : 'life:raid:lost', evPayload[r]);
  }

  /** Refresh the sim's alt targets from the villagers that are out and about (<= 8). */
  function pushAlts(r) {
    const alt = defs[r].alt;
    let m = 0;
    if (alt) for (let k = 0; k < alt.length && m < MAX_ALT; k++) {
      if (!npcPos(alt[k], tmp)) continue;
      ax[m] = tmp.x; ay[m] = tmp.y; altMap[m] = k; m++;
    }
    sim.setAltTargets(m, ax, ay);
  }

  function step(dayIndex, hour) {
    if (current >= 0) {
      const r = current, d = defs[r];
      if (nightOf(dayIndex, hour, d.from, d.to) !== curNight) { end(r, false); return; } // timeout at `to`
      if (packAlive(r) === 0) { end(r, true); return; }
      for (let j = 0; j < MAX_TORCHES; j++) { const ts = torchSlot[r * MAX_TORCHES + j]; if (ts >= 0 && sim.isDead(ts)) dropTorch(r, j); }
      pushAlts(r);
      return;
    }
    for (let r = 0; r < n; r++) {
      const d = defs[r];
      const night = nightOf(dayIndex, hour, d.from, d.to);
      if (night < 0 || slots[r].length === 0) continue;
      const last = state[lastDayKey(d.id)];
      if (last !== undefined && night - last < (d.cooldownDays || 1)) continue; // cooldown / this night already raided
      if (d.requires && !state[d.requires]) continue;
      if (d.campId && state[downStateKey(d.campId)]) continue; // camp cleared / down: no raid
      if (rolled[r] === night) continue;
      rolled[r] = night;
      if (raidRoll(night, r) >= d.chancePerNight) continue;
      if (packAlive(r) === 0) continue;
      curNight = night;
      start(r, night);
      return;
    }
  }

  return {
    step,
    isActive(r) { return active[r] === 1; },
    get current() { return current; },
    dispose() { offHit(); },
  };
}
