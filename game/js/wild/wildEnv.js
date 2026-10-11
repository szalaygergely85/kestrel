// WILD-06 (architecture.md 38.31): game-side FaunaEnv adapter + the one-call wiring object for the ambient fauna.
//   const env = createWildEnv(world, { trunkR? });   // FaunaEnv: groundAt, slopeZ, habitatAt, blocked, moveCircle, perchNear
//   const wild = createWild({ world, pool, fx, seed }); engine.feedVoxels = wild.feed; wild.step(dt, px, py, run, yawDeg);
// Zero allocation on the query path (module scratch). Fauna is ambient: never hashed, never saved (38.31 item 10).
import { createFauna, createFaunaFeed, compileFaunaDef, forwardOf } from '../../../engine/index.js';

export const TRUNK_CELL_M = 16;
const T_GRASS = 0, T_FOREST = 1, T_WATER = 2;            // terrain type ids (engine/world/terrain.js TYPE_NAMES); water 2, rock 3, path 4 = never
const EDGE_PROBE_M = 6;
const WATER_PROBE_M = 5;                    // meadow within 5 m of water = riverbank (habitat bit 8)
const GROUND_START = { songbird: 0.35, crow: 0.85 }; // share of the flyers that start on the ground (hop / peck / walk)
const TELEPORT_M = 25;                      // a one-step player jump this big = waystone / respawn: fauna.reset()
const nrm = { x: 0, y: 0, z: 1 };

/** Static trunk bucket grid: 16 m cells, counting-sorted Int32 index arrays (built once at load). */
export function buildTrunkGrid(scatter, trunkR) {
  const n = scatter && scatter.count ? scatter.count : 0;
  if (!n) return { n: 0, x0: 0, y0: 0, w: 0, h: 0, start: new Int32Array(1), idx: new Int32Array(0), px: null, py: null, pr: null, sp: null, src: scatter || null };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = scatter.x[i], y = scatter.y[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const w = Math.floor((x1 - x0) / TRUNK_CELL_M) + 1, h = Math.floor((y1 - y0) / TRUNK_CELL_M) + 1;
  const cellOf = new Int32Array(n), start = new Int32Array(w * h + 1), idx = new Int32Array(n);
  const pr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.floor((scatter.y[i] - y0) / TRUNK_CELL_M) * w + Math.floor((scatter.x[i] - x0) / TRUNK_CELL_M);
    cellOf[i] = c; start[c + 1]++; pr[i] = trunkR[scatter.species[i]] || 0.5;
  }
  for (let c = 0; c < w * h; c++) start[c + 1] += start[c];
  const fill = start.slice(0, w * h);
  for (let i = 0; i < n; i++) idx[fill[cellOf[i]]++] = i;
  return { n, x0, y0, w, h, start, idx, px: scatter.x, py: scatter.y, pr, sp: scatter.species, src: scatter };
}

function trunkHit(g, x, y, r) {
  if (!g.n) return false;
  const cx0 = Math.floor((x - r - g.x0) / TRUNK_CELL_M), cx1 = Math.floor((x + r - g.x0) / TRUNK_CELL_M);
  const cy0 = Math.floor((y - r - g.y0) / TRUNK_CELL_M), cy1 = Math.floor((y + r - g.y0) / TRUNK_CELL_M);
  for (let cy = cy0 < 0 ? 0 : cy0; cy <= cy1 && cy < g.h; cy++) {
    for (let cx = cx0 < 0 ? 0 : cx0; cx <= cx1 && cx < g.w; cx++) {
      const c = cy * g.w + cx;
      for (let k = g.start[c]; k < g.start[c + 1]; k++) {
        const i = g.idx[k], dx = g.px[i] - x, dy = g.py[i] - y, rr = g.pr[i] + r;
        if (dx * dx + dy * dy < rr * rr) return true;
      }
    }
  }
  return false;
}

// WILD-06b: colliding placed meshes (rocks, dead trees, ruins) as a coarse occupancy grid. Plant meshes are
// `collide:false` walk-through and are skipped. Small meshes fill their world AABB; big ones (> BIG_M) only a
// 1-cell ring so a hollow building does not become a solid block. Built once, queried allocation-free.
export const MESH_CELL_M = 2;
const BIG_M = 12;
export function buildMeshBlockGrid(structures) {
  const list = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of structures || []) {
    const m = s && s.mesh;
    if (!m || typeof m !== 'object' || m.collide === false || s.collide === false || !s.bbox) continue;
    if (!((m.collider && m.collider.length >= 9) || m.triCount)) continue;
    list.push(s.bbox);
    if (s.bbox.x0 < x0) x0 = s.bbox.x0; if (s.bbox.y0 < y0) y0 = s.bbox.y0;
    if (s.bbox.x1 > x1) x1 = s.bbox.x1; if (s.bbox.y1 > y1) y1 = s.bbox.y1;
  }
  if (!list.length) return { n: 0, x0: 0, y0: 0, w: 0, h: 0, cells: new Uint8Array(0) };
  const w = Math.floor((x1 - x0) / MESH_CELL_M) + 1, h = Math.floor((y1 - y0) / MESH_CELL_M) + 1;
  const cells = new Uint8Array(w * h);
  for (const b of list) {
    const ax = Math.floor((b.x0 - x0) / MESH_CELL_M), bx = Math.floor((b.x1 - x0) / MESH_CELL_M);
    const ay = Math.floor((b.y0 - y0) / MESH_CELL_M), by = Math.floor((b.y1 - y0) / MESH_CELL_M);
    const big = b.x1 - b.x0 > BIG_M || b.y1 - b.y0 > BIG_M;
    for (let cy = ay; cy <= by; cy++) for (let cx = ax; cx <= bx; cx++) {
      if (big && cx > ax && cx < bx && cy > ay && cy < by) continue;
      cells[cy * w + cx] = 1;
    }
  }
  return { n: list.length, x0, y0, w, h, cells };
}

function meshHit(g, x, y, r) {
  if (!g.n) return false;
  const cx0 = Math.floor((x - r - g.x0) / MESH_CELL_M), cx1 = Math.floor((x + r - g.x0) / MESH_CELL_M);
  const cy0 = Math.floor((y - r - g.y0) / MESH_CELL_M), cy1 = Math.floor((y + r - g.y0) / MESH_CELL_M);
  for (let cy = cy0 < 0 ? 0 : cy0; cy <= cy1 && cy < g.h; cy++) {
    for (let cx = cx0 < 0 ? 0 : cx0; cx <= cx1 && cx < g.w; cx++) if (g.cells[cy * g.w + cx]) return true;
  }
  return false;
}

/** @returns {import('../../../engine/fauna/fauna.js').FaunaEnv-like} allocation-free FaunaEnv over a loaded world. */
/** perchByModel ring for a scatter species: pine / birch / oak (mesh CommonTree = oak), small or large by trunk radius. */
function perchRing(sp, rings) {
  const n = String(sp.model || sp.mesh || '').toLowerCase();
  const kind = n.includes('pine') ? 'Pine' : n.includes('birch') ? 'Birch' : 'Oak';
  const large = (sp.trunkR || 0) >= (kind === 'Pine' ? 0.38 : kind === 'Birch' ? 0.43 : 0.58);
  const r = rings['forest' + kind + (large ? 'Large' : 'Small')] || rings.forestOakSmall || { r: [1, 2], z: [3, 4] };
  const minZ = (sp.trunkH || 0) + 0.3;                  // never inside the trunk-only zone below the canopy
  return { r: r.r, z: [Math.max(r.z[0], minZ), Math.max(r.z[1], minZ + 1)] };
}

export function createWildEnv(world, opts) {
  const terr = world.terrain;
  let trunkR = opts && opts.trunkR;
  if (!trunkR) {
    const sp = terr && terr.recipe && terr.recipe.recipe && terr.recipe.recipe.forest && terr.recipe.recipe.forest.trees && terr.recipe.recipe.forest.trees.species;
    trunkR = sp ? sp.map((s) => s.trunkR) : [];
  }
  let grid = buildTrunkGrid(world.scatter, trunkR);
  const treeSp = terr && terr.recipe && terr.recipe.recipe && terr.recipe.recipe.forest && terr.recipe.recipe.forest.trees && terr.recipe.recipe.forest.trees.species;
  const rings = opts && opts.perchRings;                 // { forestOakSmall: { r: [a, b], z: [a, b] }, ... } (songbird.perchByModel)
  const ringOf = treeSp && rings ? treeSp.map((s) => perchRing(s, rings)) : [];
  const _ensure = () => { if (world.scatter !== grid.src) { grid = buildTrunkGrid(world.scatter, trunkR); env.grid = grid; } }; // the near band re-bakes as the player moves
  const meshGrid = buildMeshBlockGrid(world.structures);
  function habitatAt(x, y) {
    if (world.structureAt(x, y)) return 0;
    const t = terr.typeAt(x, y);
    if (t === T_FOREST) return 4;
    if (t !== T_GRASS) return 0;                     // water, rock, path
    const e = EDGE_PROBE_M, w = WATER_PROBE_M;       // meadow next to forest = edge; next to water = + riverbank bit
    const bank = terr.typeAt(x + w, y) === T_WATER || terr.typeAt(x - w, y) === T_WATER || terr.typeAt(x, y + w) === T_WATER || terr.typeAt(x, y - w) === T_WATER ? 8 : 0;
    if (terr.typeAt(x + e, y) === T_FOREST || terr.typeAt(x - e, y) === T_FOREST || terr.typeAt(x, y + e) === T_FOREST || terr.typeAt(x, y - e) === T_FOREST) return 2 | bank;
    return 1 | bank;
  }
  function blocked(x, y, r) {
    _ensure();
    if (trunkHit(grid, x, y, r)) return true;
    if (world.structureAt(x, y)) return true;
    if (meshHit(meshGrid, x, y, r)) return true;
    const t = terr.typeAt(x, y);
    return t !== T_GRASS && t !== T_FOREST && t !== 4; // water / rock (path is walkable-through but not a habitat)
  }
  /** Nearest trunk within maxR of (x, y): out { x, y, r, tree }. Allocation-free. */
  function trunkNear(x, y, maxR, out) {
    _ensure();
    const g = grid;
    if (!g.n) return false;
    let best = maxR * maxR, bi = -1;
    const cx0 = Math.floor((x - maxR - g.x0) / TRUNK_CELL_M), cx1 = Math.floor((x + maxR - g.x0) / TRUNK_CELL_M);
    const cy0 = Math.floor((y - maxR - g.y0) / TRUNK_CELL_M), cy1 = Math.floor((y + maxR - g.y0) / TRUNK_CELL_M);
    for (let cy = cy0 < 0 ? 0 : cy0; cy <= cy1 && cy < g.h; cy++) for (let cx = cx0 < 0 ? 0 : cx0; cx <= cx1 && cx < g.w; cx++) {
      const c = cy * g.w + cx;
      for (let k = g.start[c]; k < g.start[c + 1]; k++) {
        const i = g.idx[k], dx = g.px[i] - x, dy = g.py[i] - y, d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; bi = i; }
      }
    }
    if (bi < 0) return false;
    out.x = g.px[bi]; out.y = g.py[bi]; out.r = g.pr[bi]; out.tree = bi;
    return true;
  }
  /** A perch spot on a tree whose trunk is minR..maxR from (x, y): a point on the species' perch ring (songbird.perchByModel,
   * derived numbers). The tree is picked by a position hash (deterministic, no rng). out { x, y, z, tree }. Allocation-free. */
  function perchNear(x, y, minR, maxR, out) {
    _ensure();
    const g = grid;
    if (!g.n || !ringOf.length) return false;
    const cx0 = Math.floor((x - maxR - g.x0) / TRUNK_CELL_M), cx1 = Math.floor((x + maxR - g.x0) / TRUNK_CELL_M);
    const cy0 = Math.floor((y - maxR - g.y0) / TRUNK_CELL_M), cy1 = Math.floor((y + maxR - g.y0) / TRUNK_CELL_M);
    const lo = minR * minR, hi = maxR * maxR;
    let hsh = (Math.imul(Math.floor(x * 4) | 0, 73856093) ^ Math.imul(Math.floor(y * 4) | 0, 19349663)) >>> 0;
    let count = 0, pick = -1;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) { if (!count) return false; pick = hsh % count; }
      let n = 0;
      for (let cy = cy0 < 0 ? 0 : cy0; cy <= cy1 && cy < g.h; cy++) for (let cx = cx0 < 0 ? 0 : cx0; cx <= cx1 && cx < g.w; cx++) {
        const c = cy * g.w + cx;
        for (let k = g.start[c]; k < g.start[c + 1]; k++) {
          const i = g.idx[k], dx = g.px[i] - x, dy = g.py[i] - y, d2 = dx * dx + dy * dy;
          if (d2 < lo || d2 > hi) continue;
          if (pass === 0) { count++; continue; }
          if (n++ !== pick) continue;
          const ring = ringOf[g.sp[i]] || ringOf[0];
          const h2 = (Math.imul(i + 1, 2654435761) ^ hsh) >>> 0, a = (h2 & 1023) / 1024 * 6.283185307179586, f = ((h2 >>> 10) & 1023) / 1023, f2 = ((h2 >>> 20) & 511) / 511;
          const r = g.pr[i] + ring.r[0] + (ring.r[1] - ring.r[0]) * f;
          out.x = g.px[i] + Math.cos(a) * r; out.y = g.py[i] + Math.sin(a) * r;
          out.z = terr.groundAt(g.px[i], g.py[i]) + ring.z[0] + (ring.z[1] - ring.z[0]) * f2;
          out.tree = i;
          return true;
        }
      }
    }
    return false;
  }
  const env = {
    grid, meshGrid, trunkNear,
    groundAt: (x, y) => terr.groundAt(x, y),
    slopeZ: (x, y) => terr.groundNormalAt(x, y, nrm).z,
    habitatAt,
    blocked,
    moveCircle(x, y, dx, dy, r, out) {               // slide: full move, else x-only, else y-only, else stay
      if (!blocked(x + dx, y + dy, r)) { out.x = x + dx; out.y = y + dy; return; }
      if (dx !== 0 && !blocked(x + dx, y, r)) { out.x = x + dx; out.y = y; return; }
      if (dy !== 0 && !blocked(x, y + dy, r)) { out.x = x; out.y = y + dy; return; }
      out.x = x; out.y = y;
    },
    perchNear,
  };
  return env;
}

/** One object for main.js: fauna + feed over a world. Returns null when the world has no terrain. */
const WILD_POOL_RESERVE = 12; // collect() keeps the nearest (cap - 12) entities; animals draw into the rest
export function createWild({ world, pool, fx, seed = 1, hfovRad }) {
  if (!world || !world.terrain || !fx) return null;
  const models = (name) => pool.models.get(name);
  const def = compileFaunaDef(fx, models);
  const sbFx = fx.animals && fx.animals.songbird;
  const env = createWildEnv(world, { perchRings: sbFx && sbFx.perchByModel });
  for (const spc of def.species) if (GROUND_START[spc.name] !== undefined) spc.groundStart = GROUND_START[spc.name];
  const fauna = createFauna(def, env, { seed, models });
  const feeder = createFaunaFeed(def, fauna.slots, { hfovRad });
  if (pool.reserve !== undefined) pool.reserve = WILD_POOL_RESERVE; // static world props (47+ since the POI pass) filled the 48-slot pool: keep room for the animals
  const player = { x: 0, y: 0, sprinting: false }, cam = { x: 0, y: 0, fx: 0, fy: -1, hfovRad: hfovRad || 1.3089969389957472 /* 75 deg */ };
  const fwd = new Float64Array(2);
  let lx = NaN, ly = NaN;
  return {
    fauna, env, feed: feeder.feed, stats: fauna.stats, drawn: () => feeder.stats.drawn,
    /** once per fixed step, after the player moved. A jump > 25 m (waystone / respawn) resets the fauna. */
    step(dt, px, py, run, yawDeg) {
      if (lx === lx && (px - lx) * (px - lx) + (py - ly) * (py - ly) > TELEPORT_M * TELEPORT_M) fauna.reset();
      lx = px; ly = py;
      forwardOf(yawDeg, fwd);
      player.x = px; player.y = py; player.sprinting = !!run;
      cam.x = px; cam.y = py; cam.fx = fwd[0]; cam.fy = fwd[1];
      fauna.update(dt, player, cam);
    },
    reset() { fauna.reset(); lx = NaN; },
  };
}
