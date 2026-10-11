// game/js/quest/sim/wading.js (RIVER-01b / OB-019, docs/architecture.md 38.45 (3)). River wading, game side of the physics:
//   before(entity, other) - each step BEFORE integrate: speedScale = min(other, 1 - 0.5k), body.pushX/pushY = flow * 0.7k (|push| <= 3),
//                           k = clamp(imm / 0.9, 0, 1), imm = surfaceZ - FEET z (not floor depth: a stone above the surface stays dry).
//   after(entity)         - each step AFTER integrate: no swimming (D-064), water deeper than DEEP (1.0 m from the feet) is a wall:
//                           slide along it (keep X or Y), else restore the previous position. A body spawned/dropped into deep water is pushed
//                           toward the nearer bank at 2 m/s; after 3 s `body.wadeRescue` turns true (the OB-016 void rescue reads it).
// Only `river` shapes (water kind 3) wade; rect/circle regions keep today's behaviour (world blocks / sea). Rule 15: no random/trig, 0 alloc.
import { L_LAT, L_TX, L_TY } from '../../../../engine/index.js';

const KIND_RIVER = 3; // engine/world/water.js region kind
export const WADE_CFG = Object.freeze({ deepM: 1.0, fullM: 0.9, slow: 0.5, pushK: 0.7, pushMax: 3, bankPush: 2, rescueSteps: 180 });

/**
 * River water at (x, y)? Fills `out` as World#waterAt does and returns true only for a river-kind region.
 * @param {any} world @param {number} x @param {number} y @param {any} out
 */
export function riverWaterAt(world, x, y, out) {
  if (typeof world.waterAt !== 'function' || !world.waterAt(x, y, out)) return false;
  return world.water.kind[out.index] === KIND_RIVER;
}

export function createWading(world, cfg = WADE_CFG) {
  const w = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 };
  const flow = [0, 0];
  const mesh = world.physicsMode === 'mesh';

  /** Feet-relative immersion for a grounded body at (x, y) that stands near z: surface - floor. -1 = no river water. */
  function immAt(x, y, zRef, opts, outFloor) {
    const river = riverWaterAt(world, x, y, w), sz = w.surfaceZ;
    const fl = mesh ? world.supportAt(x, y, zRef, true, opts).floorH : world.floorAt(x, y);
    outFloor.z = fl === fl && fl !== null ? fl : zRef;
    return river ? sz - outFloor.z : -1;
  }
  const fz = { z: 0 };

  const api = {
    cfg,
    before(entity, other = 1) {
      const body = entity.components.body, t = entity.transform;
      body.wadePrevZ = t.z; body.pushX = 0; body.pushY = 0;
      if (typeof body.wadeDeep !== 'number') { body.wadeDeep = 0; body.wadeImm = 0; body.wadeRescue = false; }
      if (!riverWaterAt(world, t.x, t.y, w)) { body.speedScale = other; body.wadeImm = 0; body.wadeDeep = 0; body.wadeRescue = false; return; }
      const imm = w.surfaceZ - t.z;
      body.wadeImm = imm;
      const k = imm <= 0 ? 0 : imm >= cfg.fullM ? 1 : imm / cfg.fullM;
      body.speedScale = Math.min(other, 1 - cfg.slow * k);
      if (imm > cfg.deepM) { // dropped into deep water: shove toward the nearer bank, rescue after 3 s
        const rv = world.water.rivers[world.water.riv[w.index]], loc = rv.loc;
        const side = loc[L_LAT] >= 0 ? 1 : -1; // + = left of flow; left normal = (-ty, tx); toward the bank = side * left
        body.pushX = -loc[L_TY] * side * cfg.bankPush; body.pushY = loc[L_TX] * side * cfg.bankPush;
        if (++body.wadeDeep > cfg.rescueSteps) body.wadeRescue = true;
        return;
      }
      body.wadeDeep = 0; body.wadeRescue = false;
      if (k > 0 && world.flowAt(t.x, t.y, flow)) {
        let px = flow[0] * cfg.pushK * k, py = flow[1] * cfg.pushK * k;
        const m = Math.sqrt(px * px + py * py);
        if (m > cfg.pushMax) { px *= cfg.pushMax / m; py *= cfg.pushMax / m; }
        body.pushX = px; body.pushY = py;
      }
    },
    after(entity) {
      const body = entity.components.body, t = entity.transform;
      if (!body.grounded || typeof body.wadePrevZ !== 'number') return;
      if (body.wadeImm > cfg.deepM) return; // started deep: the bank push handles it
      const opts = body._collideOpts;
      const imm = immAt(t.x, t.y, t.z, opts, fz);
      if (imm <= cfg.deepM) return;
      const px = body.prevX, py = body.prevY, nx = t.x, ny = t.y;
      if (immAt(nx, py, body.wadePrevZ, opts, fz) <= cfg.deepM) { t.y = py; t.z = fz.z; body.vy = 0; return; }
      if (immAt(px, ny, body.wadePrevZ, opts, fz) <= cfg.deepM) { t.x = px; t.z = fz.z; body.vx = 0; return; }
      t.x = px; t.y = py; t.z = body.wadePrevZ; body.vx = 0; body.vy = 0;
    },
  };
  return api;
}
