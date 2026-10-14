// game/js/quest/sim/wading.js (RIVER-01b / OB-019, docs/architecture.md 38.45 (3)). River wading, game side of the physics:
//   before(entity, other) - each step BEFORE integrate: speedScale = min(other, 1 - 0.5k), body.pushX/pushY = flow * 0.7k (|push| <= 3),
//                           k = clamp(imm / 0.9, 0, 1), imm = surfaceZ - FEET z (not floor depth: a stone above the surface stays dry).
//   after(entity)         - SWIM-03b (D-070): no-op kept for main.js until SWIM-03c. The deep-water wall and the 3 s wadeRescue are gone:
//                           deep water is swum (engine/physics/swim.js, fed by swimFeed.js). While `body.swimming` before() backs off.
// Only `river` shapes (water kind 3) wade; rect/circle regions keep today's behaviour (world blocks / sea). Rule 15: no random/trig, 0 alloc.
const kindScratch = { lat: 0, hw: 0, tx: 0, ty: 0, v: 0, z: 0, fx: 0, fy: 0 };
export const WADE_CFG = Object.freeze({ deepM: 1.0, fullM: 0.9, slow: 0.5, pushK: 0.7, pushMax: 3 });

/**
 * River water at (x, y)? Fills `out` as World#waterAt does and returns true only for a river-kind region.
 * @param {any} world @param {number} x @param {number} y @param {any} out
 */
export function riverWaterAt(world, x, y, out) {
  if (typeof world.riverAt !== 'function' || !world.riverAt(x, y, kindScratch)) return false; // river-kind only (World#riverAt), checked first
  return world.waterAt(x, y, out);
}

export function createWading(world, cfg = WADE_CFG) {
  const rq = { lat: 0, hw: 0, tx: 0, ty: 0, v: 0, z: 0, fx: 0, fy: 0 }; // ONE riverAt per step (river z = surface, no waves; fx/fy = flow)

  const api = {
    cfg,
    before(entity, other = 1) {
      const body = entity.components.body, t = entity.transform;
      body.pushX = 0; body.pushY = 0;
      if (typeof body.wadeImm !== 'number') body.wadeImm = 0;
      if (body.swimming || !world.riverAt(t.x, t.y, rq)) { body.speedScale = other; body.wadeImm = 0; return; } // swimFeed owns the current while swimming
      const imm = rq.z - t.z;
      body.wadeImm = imm;
      const k = imm <= 0 ? 0 : imm >= cfg.fullM ? 1 : imm / cfg.fullM;
      body.speedScale = Math.min(other, 1 - cfg.slow * k);
      if (k > 0) {
        let px = rq.fx * cfg.pushK * k, py = rq.fy * cfg.pushK * k;
        const m = Math.sqrt(px * px + py * py);
        if (m > cfg.pushMax) { px *= cfg.pushMax / m; py *= cfg.pushMax / m; }
        body.pushX = px; body.pushY = py;
      }
    },
    after() {}, // SWIM-03b: the deep wall is removed (swim anywhere)
  };
  return api;
}
