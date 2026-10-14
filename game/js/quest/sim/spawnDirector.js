// BEAST-06a (arch 38.64 items 8, 10, 11): spawn director. Deterministic group list from the regional rules, per-group respawn
// timers in GAME seconds (the caller passes dt only while unpaused), never-in-view rule, own save key 'spawnDirector.v1' keyed by gid (never by slot, not inside 'beast.v1').
// Rule 15 in step: no Math.random / trig / wall clock / Map iteration, integer step counters, 0 alloc (typed arrays + callbacks).
// Not wired yet: regionalBeasts/goblinCamps keep their own respawn until BEAST-06b/13 (NEEDS B1-main: see lanes/pc-b2.md).
import { KINDS } from './beastKinds.js';
import { hashU } from '../../life/schedule.js';
import { SPAWN_AREAS, areaGid, areaGroupSpecs } from './spawnAreas.js';

export const RESPAWN_SEC = Object.freeze({ grazer: 180, common: 360, pack: 480, swarm: 480, elite: 1200 }); // camp/boss handled apart
export const CAMP_DAYS = 3, DEFAULT_DAY_SEC = 1200; // dayLenSec is an option: pass the game's real day length
export const SPAWN_MIN_DIST = 60, VIEW_MARGIN_RAD = 0.2617993877991494 /* 15 deg */, RETRY_STEPS = 300, CHECK_STEPS = 30;
const DIRS = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]]; // literal table: no trig
export const SAVE_KEY = 'spawnDirector.v1';
const R_BOSS = 0, R_TIMED = 1, R_CAMP = 2;

function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** BEAST-06a-WIRE: generateRegionalBeasts() output -> buildGroups members. kind = KINDS name of the species, key = region, slot = sim slot of
 * the spawned entity (`slotOf(id)`, e.g. sim.slotOf). Members the sim does not track (-1) are dropped. Cold path. */
export const SPECIES_KIND = Object.freeze({ boar: 'boar', wolf: 'grey_wolf', bear: 'black_bear' });
export function regionalMembers(list, slotOf) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i], slot = slotOf(b.id); if (slot < 0) continue;
    out.push({ id: b.id, kind: SPECIES_KIND[b.species] || b.species, key: b.region, group: b.group, x: b.x, y: b.y, slot });
  }
  return out;
}

/**
 * Pure, deterministic. `members`: [{ kind|species, key (region), group (index), x, y, slot? }] (generateRegionalBeasts output order).
 * Returns groups [{ gid '<region>/<group>', kind, region, cls, slots[], members[], home:[x,y], route:[[x,y]x3..6] }]. Same seed + members -> same list.
 * `walkable(x,y)` optional (route points fall back to home when blocked).
 */
export function buildGroups(members, seed, walkable, areas = SPAWN_AREAS) {
  const order = [], byKey = {}; // insertion order = input order (no Map iteration)
  for (let i = 0; i < members.length; i++) {
    const m = members[i], kind = m.kind || m.species, region = m.key !== undefined ? m.key : m.region, k = kind + '|' + region + '|' + m.group;
    let g = byKey[k];
    if (!g) { g = byKey[k] = { kind, region, members: [], slots: [], gi: m.group }; order.push(g); }
    g.members.push(m); g.slots.push(m.slot === undefined ? i : m.slot);
  }
  const perRegion = {}, out = [], seenGid = Object.create(null);
  for (const g of order) {
    const rk = g.kind + '.' + g.region, n = (perRegion[rk] = (perRegion[rk] || 0) + 1);
    let cx = 0, cy = 0; for (const m of g.members) { cx += m.x; cy += m.y; } cx /= g.members.length; cy /= g.members.length;
    const spec = KINDS[g.kind], cls = (spec && spec.respawn) || 'common';
    const grazerLoop = cls === 'grazer', radius = grazerLoop ? 40 : 150; // epic section 3: grazers 40-120 m loop, packs 150-300 m patrol
    const h0 = hashU(seed, strHash(rk), n), np = 3 + (h0 % 4), route = [];
    for (let p = 0; p < np; p++) {
      const h = hashU(seed ^ 0x51ed, strHash(rk) + p, n), d = DIRS[h & 7], r = radius * (0.5 + ((h >>> 3) & 255) / 255);
      const x = Math.round((cx + d[0] * r) * 2) / 2, y = Math.round((cy + d[1] * r) * 2) / 2;
      route.push(!walkable || walkable(x, y) ? [x, y] : [cx, cy]);
    }
    let gid = `${g.region}/${g.gi}`; if (seenGid[gid]) gid += ':' + g.kind; seenGid[gid] = 1; // answer c: stable '<region>/<group>' from the generator data (kind suffix only when two kinds share a group index)
    out.push({ gid, kind: g.kind, region: g.region, cls, slots: g.slots, members: g.members, home: [cx, cy], route });
  }
  // ED-AI-04: painted spawn areas (content/beasts/spawnAreas.json) after the regional rules; none -> identical output.
  if (areas && areas.length) {
    for (const { area, members: am } of areaGroupSpecs(areas, seed, members.length, walkable)) {
      let cx = 0, cy = 0; for (const m of am) { cx += m.x; cy += m.y; } cx /= am.length; cy /= am.length;
      const spec = KINDS[area.kind], cls = (spec && spec.respawn) || 'common';
      out.push({ gid: areaGid(area), kind: area.kind, region: area.id, cls, slots: am.map((m) => m.slot), members: am, home: [cx, cy], route: [[cx, cy]], area: area.id, when: area.when, respawnSec: area.respawnSec });
    }
  }
  return out;
}

/**
 * opts: { groups, dayLenSec, viewHalfRad (hfov/2), los(px,py,hx,hy)->bool, onRespawn(groupIndex, group) }
 * Per group: alive count, diedAt (game sec), base timer secs. Respawn due when t >= diedAt + base * difficulty.respawn.
 */
/** Cosine by Taylor series (+,* only; trig is banned in sim code by rule 15). Accurate to ~1e-6 for |x| <= 1.5. */
function cosPoly(x) { const x2 = x * x; return 1 - x2 / 2 + x2 * x2 / 24 - x2 * x2 * x2 / 720 + x2 * x2 * x2 * x2 / 40320 - x2 * x2 * x2 * x2 * x2 / 3628800; }

export function createSpawnDirector(opts) {
  const groups = opts.groups, N = groups.length, dayLen = opts.dayLenSec || DEFAULT_DAY_SEC;
  const viewCos = cosPoly((opts.viewHalfRad || 0.5236) + VIEW_MARGIN_RAD); // create-time only
  const D = {
    groups, t: 0, tick: 0, mult: 1, diffName: 'normal',
    alive: new Int16Array(N), rule: new Uint8Array(N), base: new Float64Array(N), diedAt: new Float64Array(N), dead: new Uint8Array(N),
    nextTry: new Int32Array(N), idx: Object.create(null), respawns: 0, deferred: 0,
  };
  for (let g = 0; g < N; g++) {
    const gr = groups[g], cls = gr.cls;
    D.alive[g] = gr.slots.length; D.idx[gr.gid] = g;
    if (cls === 'boss') D.rule[g] = R_BOSS;
    else if (cls === 'camp') { D.rule[g] = R_CAMP; D.base[g] = CAMP_DAYS * dayLen; }
    else { D.rule[g] = R_TIMED; D.base[g] = gr.respawnSec || RESPAWN_SEC[cls] || RESPAWN_SEC.common; }
  }
  D.setDifficulty = (d) => { D.mult = d.respawn; D.diffName = d.name; };
  /** A member died: when the last one dies the group timer starts (bosses: dead for good). */
  D.memberDied = (g) => { if (D.dead[g] || D.alive[g] <= 0) return; if (--D.alive[g] === 0) { D.dead[g] = 1; D.diedAt[g] = D.t; D.nextTry[g] = 0; } };
  D.dueAt = (g) => D.diedAt[g] + D.base[g] * D.mult;
  /** Never-in-view rule: > 60 m from the player AND outside the view cone + 15 deg AND no LOS. (fx,fy) = unit facing. */
  D.canSpawnAt = (hx, hy, px, py, fx, fy) => {
    const dx = hx - px, dy = hy - py, d2 = dx * dx + dy * dy;
    if (d2 < SPAWN_MIN_DIST * SPAWN_MIN_DIST) return false;
    if ((dx * fx + dy * fy) > viewCos * Math.sqrt(d2)) return false; // inside the cone (cos larger = smaller angle)
    return !(opts.los && opts.los(px, py, hx, hy));
  };
  /** Advance by dt GAME seconds (0 while paused). Checks every CHECK_STEPS steps; a blocked respawn retries after RETRY_STEPS. */
  D.step = (dt, px, py, fx, fy) => {
    D.t += dt; const tick = ++D.tick;
    if (tick % CHECK_STEPS !== 0) return;
    for (let g = 0; g < N; g++) {
      if (!D.dead[g] || D.rule[g] === R_BOSS || tick < D.nextTry[g] || D.t < D.diedAt[g] + D.base[g] * D.mult) continue;
      const h = groups[g].home;
      if (!D.canSpawnAt(h[0], h[1], px, py, fx, fy)) { D.nextTry[g] = tick + RETRY_STEPS; D.deferred++; continue; }
      D.dead[g] = 0; D.alive[g] = groups[g].slots.length; D.respawns++;
      if (opts.onRespawn) opts.onRespawn(g, groups[g]); // caller resetSlot()s each member at home
    }
  };
  /** Slot -> group map, built ONCE at bind (answer c): sim.slotOf(member.id) (or member.slot) -> Int16Array -> group index. */
  D.groupOfSlot = new Int16Array(0);
  D.bind = (sim) => {
    let max = sim && sim.count ? sim.count : 0;
    for (let g = 0; g < N; g++) for (let k = 0; k < groups[g].slots.length; k++) if (groups[g].slots[k] + 1 > max) max = groups[g].slots[k] + 1;
    D.groupOfSlot = new Int16Array(max).fill(-1);
    for (let g = 0; g < N; g++) {
      const gr = groups[g];
      for (let k = 0; k < gr.slots.length; k++) {
        const m = gr.members[k], id = m && m.id, s = sim && id !== undefined && sim.slotOf ? sim.slotOf(id) : -1, slot = s >= 0 ? s : gr.slots[k];
        if (slot >= 0 && slot < max) D.groupOfSlot[slot] = g;
        gr.slots[k] = slot; // keep slots in step with the live sim
      }
    }
    return D;
  };
  /** beast:died by slot: 0 alloc. Returns the group index or -1. */
  D.slotDied = (slot) => { const g = slot >= 0 && slot < D.groupOfSlot.length ? D.groupOfSlot[slot] : -1; if (g >= 0) D.memberDied(g); return g; };
  /** Save (item 10) under the director's OWN key (answer c), keyed by gid: { [gid]: { dead, respawnAt } }; respawnAt = game seconds REMAINING at save time (director clock D.t restarts per session); bosses: -1 (never). */
  D.save = (state) => {
    const o = {};
    for (let i = 0; i < N; i++) if (D.dead[i]) o[groups[i].gid] = { dead: 1, respawnAt: D.rule[i] === R_BOSS ? -1 : Math.max(0, D.dueAt(i) - D.t) };
    state[SAVE_KEY] = o;
    return o;
  };
  /** Load; unknown gid ignored; a save without the key loads fine (returns false). respawnAt is seconds remaining, re-based on the current D.t and difficulty. */
  D.load = (state) => {
    const s = state && state[SAVE_KEY]; if (!s) return false;
    for (const gid of Object.keys(s)) {
      const i = D.idx[gid], e = s[gid]; if (i === undefined || !e || !e.dead) continue;
      D.dead[i] = 1; D.alive[i] = 0; D.nextTry[i] = 0;
      if (D.rule[i] !== R_BOSS) D.diedAt[i] = D.t + e.respawnAt - D.base[i] * D.mult;
    }
    return true;
  };
  return D;
}
