// game/js/wild/wildEnv.js - WILD-06 (architecture.md 38.31 item 1): builds the FaunaEnv the engine fauna system queries.
// Allocation-free after createWildEnv (module/closure scratch only). The engine never sees the World; it sees these
// six methods. Terrain type ids (engine/world/terrain.js TYPE_NAMES): 0 grass, 1 forest, 2 water, 3 rock, 4 path.
//   const env = createWildEnv(world);   // env.groundAt / slopeZ / habitatAt / blocked / moveCircle / perchNear

export const HAB_MEADOW = 1, HAB_EDGE = 2, HAB_FOREST = 4; // = engine/fauna/faunaDef.js (a game file may not need the engine copy)
const T_GRASS = 0, T_FOREST = 1;
const EDGE_RING_M = 12;
const TRUNK_CELL_M = 16;
const ANIMAL_H = 0.5, ANIMAL_STEP = 0.3, WALK_COS = Math.cos(50 * Math.PI / 180);
const _mvOpts = { height: ANIMAL_H, stepUpMax: ANIMAL_STEP, walkCos: WALK_COS };
const _CIRCLE = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };

/** Static bucket grid of tree trunks (counting sort, Int32 arrays). Returns { count, hit(x, y, r) }. */
export function buildTrunkGrid(scatter, trunkRBySpecies) {
  const n = scatter && scatter.count ? scatter.count : 0;
  if (!n) return { count: 0, hit: () => false };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = scatter.x[i], y = scatter.y[i];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const w = Math.floor((x1 - x0) / TRUNK_CELL_M) + 1, h = Math.floor((y1 - y0) / TRUNK_CELL_M) + 1;
  const start = new Int32Array(w * h + 1), items = new Int32Array(n);
  const cellOf = (i) => Math.floor((scatter.x[i] - x0) / TRUNK_CELL_M) + Math.floor((scatter.y[i] - y0) / TRUNK_CELL_M) * w;
  for (let i = 0; i < n; i++) start[cellOf(i) + 1]++;
  for (let c = 0; c < w * h; c++) start[c + 1] += start[c];
  const fill = new Int32Array(w * h);
  for (let i = 0; i < n; i++) { const c = cellOf(i); items[start[c] + fill[c]++] = i; }
  const trunkR = new Float32Array(n);
  for (let i = 0; i < n; i++) trunkR[i] = trunkRBySpecies[scatter.species[i]] || 0.5;
  function hit(x, y, r) {
    const cx = Math.floor((x - x0) / TRUNK_CELL_M), cy = Math.floor((y - y0) / TRUNK_CELL_M);
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      if (gy < 0 || gy >= h) continue;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gx >= w) continue;
        const c = gx + gy * w;
        for (let k = start[c]; k < start[c + 1]; k++) {
          const i = items[k], dx = scatter.x[i] - x, dy = scatter.y[i] - y, rr = trunkR[i] + r;
          if (dx * dx + dy * dy < rr * rr) return true;
        }
      }
    }
    return false;
  }
  return { count: n, hit };
}

/** @param {import('../../../engine/world/World.js').World} world */
export function createWildEnv(world) {
  const terrain = world.terrain;
  const nrm = { x: 0, y: 0, z: 1 };
  const water = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: 0, look: 0 };
  const species = terrain && terrain.recipe && terrain.recipe.recipe && terrain.recipe.recipe.forest && terrain.recipe.recipe.forest.trees
    ? terrain.recipe.recipe.forest.trees.species : null;
  const trunks = buildTrunkGrid(world.scatter, species ? species.map((s) => s.trunkR) : []);
  const meshPhys = world.physicsMode === 'mesh' && world.colliders && world.colliders.length > 0;

  const groundAt = (x, y) => (terrain ? terrain.groundAt(x, y) : 0);
  const slopeZ = (x, y) => (terrain ? terrain.groundNormalAt(x, y, nrm).z : 1);

  function habitatAt(x, y) {
    if (!terrain || world.structureAt(x, y)) return 0;
    const t = terrain.typeAt(x, y);
    if (t === T_FOREST) return HAB_FOREST;
    if (t !== T_GRASS) return 0; // water, rock, path (road): never
    // meadow cell touching forest within 12 m = edge
    if (terrain.typeAt(x + EDGE_RING_M, y) === T_FOREST || terrain.typeAt(x - EDGE_RING_M, y) === T_FOREST
      || terrain.typeAt(x, y + EDGE_RING_M) === T_FOREST || terrain.typeAt(x, y - EDGE_RING_M) === T_FOREST) return HAB_EDGE;
    return HAB_MEADOW;
  }

  function colliderHit(x, y, r) {
    const gz = groundAt(x, y);
    const o = world.collideCircle(x, y, 0, 0, r, gz + 0.05, true, _mvOpts, _CIRCLE);
    return Math.abs(o.x - x) + Math.abs(o.y - y) > 1e-3;
  }

  function blocked(x, y, r) {
    if (trunks.hit(x, y, r)) return true;
    if (world.structureAt(x, y)) return true;
    if (world.water && world.waterAt(x, y, water)) return true;
    return meshPhys ? colliderHit(x, y, r) : false;
  }

  function moveCircle(x, y, dx, dy, r, out) {
    if (meshPhys) {
      const o = world.collideCircle(x, y, dx, dy, r, groundAt(x, y) + 0.05, true, _mvOpts, _CIRCLE);
      out.x = o.x; out.y = o.y;
      return;
    }
    // grid / no colliders: slide per axis against the trunk grid + structures + water
    out.x = x; out.y = y;
    if (!blocked(x + dx, y + dy, r)) { out.x = x + dx; out.y = y + dy; return; }
    if (!blocked(x + dx, y, r)) out.x = x + dx;
    else if (!blocked(x, y + dy, r)) out.y = y + dy;
  }

  return { groundAt, slopeZ, habitatAt, blocked, moveCircle, perchNear: () => false, trunks };
}
