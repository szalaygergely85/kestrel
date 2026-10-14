// game/js/quest/sim/aiTest.js (ED-AI-06 sim part, owner D-102). Pure, no DOM: live AI test helpers.
//   dropPack(sim, {kind, count, x, y, seed})  wakes `count` reserve slots of `kind` on walkable cells around (x,y).
//   stateLabels(sim, out)                     fills a reused [{slot,label}] for a debug overlay, 0 alloc.
//   runScenario(simFactory, script)           headless run -> FNV trace hash (same script = same hash).
// Test creatures use reserve slots (brain.reserve=true, down) because the sim has a fixed slot table; they are
// tagged group `test.<n>`, never touch the save, and clearTest() parks them again.
import { KINDS, kindIndex } from './beastKinds.js';
import * as S from './beastSim.js';

/** Plain player-facing name per state id 0..23 (a test fails on an unnamed id). */
export const STATE_LABELS = Object.freeze([
  'Wandering', 'Noticing', 'Chasing', 'Winding up', 'Striking', 'Recovering', 'Going home', 'Staggered', 'Flinching',
  'Dying', 'Corpse', 'Sinking', 'Gone', 'Eating', 'Grazing', 'Patrolling', 'Fleeing', 'Unstuck', 'Circling', 'Hidden',
  'Submerged', 'Grabbing', 'Flying', 'Casting',
]);

function walkable(grid, x, y) {
  const cx = grid.cellX(x), cy = grid.cellY(y);
  return grid.inBounds(cx, cy) && grid.cost[grid.index(cx, cy)] !== 0;
}

let _packN = 0;
/** Wake up to `count` (default = kind group min, 1..12) down slots of `kind` around (x,y). Deterministic from `seed`.
 * Returns the woken slots (new array, cold path). Group tag `test.<n>`. */
export function dropPack(sim, { kind, count, x, y, seed }) {
  const k = KINDS[kind];
  if (!k) return [];
  const want = Math.max(1, Math.min(12, (count | 0) || k.group[0] || 1));
  const ki = kindIndex(kind);
  let r = ((seed | 0) ^ 0x9e3779b9) >>> 0 || 1;
  const rnd = () => { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296; };
  const tag = 'test.' + (++_packN);
  const out = [];
  for (let slot = 0; slot < sim.count && out.length < want; slot++) {
    if (sim.kindIdx[slot] !== ki || !sim.down[slot]) continue;
    let px = x, py = y, found = out.length === 0 && walkable(sim.grid, x, y);
    for (let a = 0; a < 40 && !found; a++) { // spiral outwards: radius grows with the attempt
      const ang = rnd() * Math.PI * 2, rad = 1.2 + a * 0.35 + rnd();
      px = x + Math.cos(ang) * rad; py = y + Math.sin(ang) * rad;
      found = walkable(sim.grid, px, py);
    }
    if (!found) continue;
    sim.homeX[slot] = px; sim.homeY[slot] = py;
    sim.grp[slot] = tag;
    sim.setDown(slot, false);
    out.push(slot);
  }
  if (out.length) sim.groups[tag] = out;
  return out;
}

/** Park every test creature (group `test.*`) back in reserve. Returns the count. */
export function clearTest(sim) {
  let n = 0;
  for (let i = 0; i < sim.count; i++) {
    const g = sim.grp[i];
    if (typeof g === 'string' && g.startsWith('test.')) { sim.setDown(i, true); sim.grp[i] = ''; n++; }
  }
  for (const g of Object.keys(sim.groups)) if (g.startsWith('test.')) delete sim.groups[g];
  return n;
}

/** Fill `out` ([{slot,label}], grown lazily, reused) with the live slots' state names. Returns the count. 0 alloc once warm. */
export function stateLabels(sim, out) {
  let n = 0;
  for (let i = 0; i < sim.count; i++) {
    const st = sim.state[i];
    if (sim.down[i] === 1 || st === S.STATE_GONE) continue;
    let e = out[n];
    if (!e) { e = { slot: 0, label: '' }; out[n] = e; }
    e.slot = i; e.label = STATE_LABELS[st] || ('State ' + st);
    n++;
  }
  return n;
}

/** Headless scenario. simFactory() -> {sim, ...} (fresh each call). script: {ticks, player:[x,y] | path:[[x,y]..],
 * drops:[{tick, kind, count, x, y, seed}], patches:[{tick, id, fields}]}. Returns {hash, states} (hash = FNV-1a over
 * state + quantised position of every live slot, every tick; states = set of state ids seen). */
export function runScenario(simFactory, script) {
  const made = simFactory();
  const sim = made.sim || made;
  const path = script.path || [script.player || [0, 0]];
  let px = path[0][0], py = path[0][1], leg = 1;
  let h = 0x811c9dc5 >>> 0;
  const mix = (v) => { h = Math.imul(h ^ (v & 0xff), 0x01000193) >>> 0; h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193) >>> 0; h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193) >>> 0; };
  const seen = new Uint8Array(32);
  for (let t = 0; t < script.ticks; t++) {
    if (script.drops) for (const d of script.drops) if (d.tick === t) dropPack(sim, d);
    if (script.patches) for (const p of script.patches) if (p.tick === t) sim.patchArchetype(p.id, p.fields);
    if (leg < path.length) { // walk toward the next waypoint at 0.1 m/tick
      const dx = path[leg][0] - px, dy = path[leg][1] - py, d = Math.sqrt(dx * dx + dy * dy);
      if (d <= 0.1) { px = path[leg][0]; py = path[leg][1]; leg++; } else { px += dx / d * 0.1; py += dy / d * 0.1; }
    }
    sim.step(px, py, 0);
    for (let i = 0; i < sim.count; i++) {
      const st = sim.state[i];
      mix(st); if (st < 32) seen[st] = 1;
      mix(Math.round(sim.steer.x[i] * 100)); mix(Math.round(sim.steer.y[i] * 100));
    }
  }
  const states = []; for (let s = 0; s < 32; s++) if (seen[s]) states.push(s);
  return { hash: h.toString(16).padStart(8, '0'), states };
}
