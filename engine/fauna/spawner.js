// engine/fauna/spawner.js - WILD-03 (docs/architecture.md 38.31 item 3).
// Hash-driven ambient spawning on a 64 m cell grid. Nothing is stored: a cell's content (which species, where) is a
// pure function of (cell, seed, species), so the same meadow always holds the same rabbits. Only live runtime
// state is kept: the animal slots, a fixed 7 x 7 ring table (typed arrays, no Map) and per-cell cooldowns.
//
// Imports only engine/fauna/** and engine/core/** (check-deps rule 19). The world is reached through the injected
// FaunaEnv (groundAt, habitatAt, blocked ...). No Math.random: the owned RNG is createRng(seed ^ 0x57494C44).
// Zero allocation per update (the spawn path only writes into preallocated slots).

import { createRng } from '../core/rng.js';

export const CELL_M = 64;               // fauna cell size
export const RING = 7;                  // active ring is RING x RING cells around the player
export const FAUNA_MAX = 40;            // global slot count
export const CHECK_DT = 0.2;            // spawn/despawn pass period (s)
export const VIEW_MARGIN_RAD = 15 * Math.PI / 180; // extra cone margin on top of hfov/2
export const COOLDOWN_MIN = 60, COOLDOWN_MAX = 120; // s, per cell + species after the last member despawned
const RING_HALF = (RING - 1) >> 1;
const RNG_SALT = 0x57494C44;
const TRIES = 4;                        // hash-chosen spawn points tried per cell + species

const ST_NONE = 1, ST_CANDIDATE = 2;

/** Pure 32-bit hash of three ints -> u32 (murmur-style finaliser chained over the inputs). */
export function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h ^ (b | 0), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h ^ (c | 0), 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
/** hash3 mapped to [0,1). */
export function hash01(a, b, c) { return (hash3(a, b, c) >>> 8) / 16777216; }

function pmod(a, n) { const r = a % n; return r < 0 ? r + n : r; }

/** One preallocated animal slot. Brain fields (WILD-04+) are declared up front so the shape never changes. */
function makeSlot(i) {
  return {
    id: i, alive: false, species: -1, model: 0, group: 0, k: -1,
    cellIx: 0, cellIy: 0,
    x: 0, y: 0, z: 0, yaw: 0, homeX: 0, homeY: 0, homeR: 0,
    fx: 0, fy: 1, coneCos: -0.5, range: 0, hearR: 0,
    leashMode: 0, leashT: 0, state: 0, stateT: 0, speed: 0, gait: 0, age: 0,
  };
}

/**
 * @param {object} def  compileFaunaDef result
 * @param {object} env  FaunaEnv (groundAt, habitatAt, blocked used here)
 * @param {{seed?:number, maxAlive?:number}} [opts]
 */
export function createSpawner(def, env, opts) {
  const o = opts || {};
  const seed = (o.seed || 0) >>> 0;
  const maxAlive = Math.min(o.maxAlive || FAUNA_MAX, FAUNA_MAX);
  const sps = def.species;
  const S = sps.length;
  const N = RING * RING;

  const slots = new Array(maxAlive);
  for (let i = 0; i < maxAlive; i++) slots[i] = makeSlot(i);

  // ring table (index = pmod(ix) * RING + pmod(iy)) + per cell/species state (index = ringSlot * S + k)
  const keyX = new Int32Array(N), keyY = new Int32Array(N);
  const stat = new Uint8Array(N * S);
  const ptX = new Float64Array(N * S), ptY = new Float64Array(N * S);
  const cool = new Float32Array(N * S);
  const cnt = new Uint8Array(N * S);       // live members spawned from this cell + species
  const aliveBySp = new Int32Array(S);

  let rng = createRng(seed ^ RNG_SALT);
  let cx = 0, cy = 0, haveCenter = false;
  let acc = CHECK_DT;                       // first update checks immediately
  let groupSeq = 0;
  let aliveTotal = 0;
  // view-cone test state (set per update; module-free so several spawners can coexist)
  let vCamX = 0, vCamY = 0, vFx = 0, vFy = 1, vCos = 0, vPx = 0, vPy = 0;

  const sp = {
    slots, stats: { alive: 0, bySpecies: aliveBySp }, cellSize: CELL_M,
    /** Optional hook (slot, speciesDef) called after a slot is filled; the brain initialises itself here. */
    onSpawn: null,
    /** Optional hook (slot) called just before a slot is freed. */
    onDespawn: null,
  };

  function ringSlot(ix, iy) { return pmod(ix, RING) * RING + pmod(iy, RING); }

  // Fixed spawn point for (cell, species): first of TRIES hash points that is habitat-valid and not blocked.
  function evalCell(rs, ix, iy, k) {
    const spc = sps[k], idx = rs * S + k;
    stat[idx] = ST_NONE; cnt[idx] = 0; cool[idx] = 0;
    if (hash01(ix, iy, (seed + k * 7919) | 0) >= spc.cellChance) return;
    for (let t = 0; t < TRIES; t++) {
      const x = (ix + hash01(ix, iy, (seed + k * 7919 + 1 + 2 * t) | 0)) * CELL_M;
      const y = (iy + hash01(ix, iy, (seed + k * 7919 + 2 + 2 * t) | 0)) * CELL_M;
      if ((env.habitatAt(x, y) & spc.habitatMask) === 0) continue;
      if (env.blocked(x, y, spc.bodyR)) continue;
      ptX[idx] = x; ptY[idx] = y; stat[idx] = ST_CANDIDATE;
      return;
    }
  }

  // Re-centre the ring: only cells whose key changed are re-evaluated. Runs only when the player crosses a cell edge.
  function recentre(ncx, ncy) {
    for (let dx = -RING_HALF; dx <= RING_HALF; dx++) {
      for (let dy = -RING_HALF; dy <= RING_HALF; dy++) {
        const ix = ncx + dx, iy = ncy + dy, rs = ringSlot(ix, iy);
        if (haveCenter && keyX[rs] === ix && keyY[rs] === iy) continue;
        keyX[rs] = ix; keyY[rs] = iy;
        for (let k = 0; k < S; k++) evalCell(rs, ix, iy, k);
      }
    }
    cx = ncx; cy = ncy; haveCenter = true;
  }

  // In view = inside the camera cone (hfov/2 + margin) of the camera. vCos is cos of that half angle.
  function inCone(x, y) {
    const dx = x - vCamX, dy = y - vCamY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) return true;
    return (dx * vFx + dy * vFy) / d >= vCos;
  }

  // A point may appear if it is outside the cone, or farther than the species' drawM from the player.
  function mayAppear(x, y, spc) {
    const dx = x - vPx, dy = y - vPy;
    const d2 = dx * dx + dy * dy;
    if (d2 > spc.drawM * spc.drawM) return true;
    return !inCone(x, y);
  }

  function freeSlot() {
    for (let i = 0; i < maxAlive; i++) if (!slots[i].alive) return slots[i];
    return null;
  }

  function fill(slot, spc, k, x, y, homeX, homeY, group, ix, iy, model) {
    slot.alive = true; slot.species = spc.index; slot.k = k; slot.model = model; slot.group = group;
    slot.cellIx = ix; slot.cellIy = iy;
    slot.x = x; slot.y = y; slot.z = env.groundAt(x, y);
    slot.homeX = homeX; slot.homeY = homeY;
    slot.yaw = rng.nextFloat() * 360;
    slot.fx = 0; slot.fy = 1; slot.leashMode = 0; slot.leashT = 0; slot.state = 0; slot.stateT = 0;
    slot.speed = 0; slot.gait = 0; slot.age = 0;
    aliveBySp[spc.index]++; aliveTotal++; sp.stats.alive = aliveTotal;
    if (sp.onSpawn) sp.onSpawn(slot, spc);
  }

  function spawnGroup(rs, ix, iy, k) {
    const spc = sps[k], idx = rs * S + k;
    const x0 = ptX[idx], y0 = ptY[idx];
    const gmin = spc.groupSize[0], gmax = spc.groupSize[1];
    const want = gmin + (gmax > gmin ? rng.int(gmax - gmin + 1) : 0);
    const room = Math.min(want, spc.cap - aliveBySp[spc.index], maxAlive - aliveTotal);
    if (room <= 0) return 0;
    const group = ++groupSeq;
    const buck = spc.buckChance > 0 && spc.models.length > 1 && rng.nextFloat() < spc.buckChance ? 1 + rng.int(spc.models.length - 1) : -1;
    let made = 0;
    for (let m = 0; m < room; m++) {
      let x = x0, y = y0;
      if (m > 0) {                                  // 1-4 m around the anchor; fall back to the anchor itself
        const ang = rng.nextFloat() * 6.283185307179586, r = 1 + rng.nextFloat() * 3;
        const tx = x0 + Math.cos(ang) * r, ty = y0 + Math.sin(ang) * r;
        if ((env.habitatAt(tx, ty) & spc.habitatMask) !== 0 && !env.blocked(tx, ty, spc.bodyR) && mayAppear(tx, ty, spc)) { x = tx; y = ty; }
        else if (!mayAppear(x0, y0, spc)) break;
      }
      const slot = freeSlot();
      if (!slot) break;
      fill(slot, spc, k, x, y, x0, y0, group, ix, iy, m === 0 && buck >= 0 ? buck : 0);
      made++;
    }
    cnt[idx] = made;
    return made;
  }

  /** Free a slot. `cooldown` (default true) starts the cell cooldown once the last member of its group is gone. */
  sp.despawn = function despawn(slot, cooldown) {
    if (!slot.alive) return;
    if (sp.onDespawn) sp.onDespawn(slot);
    slot.alive = false;
    aliveBySp[slot.species]--; aliveTotal--; sp.stats.alive = aliveTotal;
    const rs = ringSlot(slot.cellIx, slot.cellIy);
    if (keyX[rs] === slot.cellIx && keyY[rs] === slot.cellIy) { // cell still in the ring
      const idx = rs * S + slot.k;
      if (cnt[idx] > 0 && --cnt[idx] === 0 && cooldown !== false) {
        cool[idx] = COOLDOWN_MIN + rng.nextFloat() * (COOLDOWN_MAX - COOLDOWN_MIN);
      }
    }
  };

  /**
   * Once per fixed step. Spawn/despawn passes run every CHECK_DT seconds, not every step.
   * camX/camY/camFx/camFy: camera position + unit forward in the ground plane; hfovRad: horizontal field of view.
   */
  sp.update = function update(dt, px, py, camX, camY, camFx, camFy, hfovRad) {
    acc += dt;
    const ncx = Math.floor(px / CELL_M), ncy = Math.floor(py / CELL_M);
    if (!haveCenter || ncx !== cx || ncy !== cy) recentre(ncx, ncy);
    if (acc < CHECK_DT) return;
    const dtc = acc; acc = 0;
    vPx = px; vPy = py; vCamX = camX; vCamY = camY; vFx = camFx; vFy = camFy;
    let half = hfovRad * 0.5 + VIEW_MARGIN_RAD;
    if (half > Math.PI) half = Math.PI;
    vCos = Math.cos(half);

    // despawn pass: past despawnM
    for (let i = 0; i < maxAlive; i++) {
      const s = slots[i];
      if (!s.alive) continue;
      s.age += dtc;
      const dx = s.x - px, dy = s.y - py, lim = sps[s.k].despawnM;
      if (dx * dx + dy * dy > lim * lim) sp.despawn(s, true);
    }
    // cooldowns + spawn pass over the ring
    for (let dx = -RING_HALF; dx <= RING_HALF; dx++) {
      for (let dy = -RING_HALF; dy <= RING_HALF; dy++) {
        const ix = cx + dx, iy = cy + dy, rs = ringSlot(ix, iy), base = rs * S;
        for (let k = 0; k < S; k++) {
          const idx = base + k;
          if (stat[idx] !== ST_CANDIDATE) continue;
          if (cool[idx] > 0) { cool[idx] -= dtc; if (cool[idx] > 0) continue; cool[idx] = 0; }
          if (cnt[idx] > 0) continue;
          const spc = sps[k];
          const ex = ptX[idx] - px, ey = ptY[idx] - py;
          const d2 = ex * ex + ey * ey;
          if (d2 < spc.spawnMinM * spc.spawnMinM || d2 > spc.spawnMaxM * spc.spawnMaxM) continue;
          if (!mayAppear(ptX[idx], ptY[idx], spc)) continue;
          if (aliveBySp[k] >= spc.cap || aliveTotal >= maxAlive) continue; // full: skip, never steal
          spawnGroup(rs, ix, iy, k);
        }
      }
    }
    sp.stats.alive = aliveTotal;
  };

  /** Clear every slot and the ring (load, new game, teleport) and re-seed the RNG. Cells repopulate by hash. */
  sp.reset = function reset() {
    for (let i = 0; i < maxAlive; i++) {
      const s = slots[i];
      if (s.alive && sp.onDespawn) sp.onDespawn(s);
      s.alive = false; s.species = -1; s.k = -1;
    }
    aliveBySp.fill(0); aliveTotal = 0; sp.stats.alive = 0;
    keyX.fill(0); keyY.fill(0); stat.fill(0); cool.fill(0); cnt.fill(0);
    rng = createRng(seed ^ RNG_SALT);
    haveCenter = false; acc = CHECK_DT; groupSeq = 0;
  };

  sp._ring = { keyX, keyY, stat, cool, cnt }; // for tests
  sp.ringCenter = function ringCenter() { return haveCenter ? [cx, cy] : null; };
  return sp;
}
