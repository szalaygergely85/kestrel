// game/js/quest/sim/swimFeed.js (SWIM-03b, docs/architecture.md 38.54 items 1+4, D-070). Feeds the water to the player body before
// `integrate`: body.waterZ (live surface, NaN = none) and body.waterFloorZ (surface - depth) for every region kind (rect / circle /
// river / sea), plus the current while swimming: pushX/Y = flow * 0.7 capped at 3 m/s (wading.before owns the push while wading).
// Call order per step: wading.before(...) -> swimFeed.feed(entity) -> integrate. Rule 15: no random/trig, 0 alloc.
export const SWIM_FEED_CFG = Object.freeze({ pushK: 0.7, pushMax: 3 });

export function createSwimFeed(world, cfg = SWIM_FEED_CFG) {
  const w = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 };
  const flow = [0, 0];
  return {
    cfg,
    /** @param {any} entity player entity (transform + components.body) */
    feed(entity) {
      const body = entity.components.body, t = entity.transform;
      if (typeof world.waterAt !== 'function' || !world.waterAt(t.x, t.y, w)) { body.waterZ = NaN; body.waterFloorZ = NaN; return; }
      body.waterZ = w.surfaceZ;
      body.waterFloorZ = w.surfaceZ - w.depth;
      if (body.swimming && world.flowAt(t.x, t.y, flow)) {
        let px = flow[0] * cfg.pushK, py = flow[1] * cfg.pushK;
        const m = Math.sqrt(px * px + py * py);
        if (m > cfg.pushMax) { px *= cfg.pushMax / m; py *= cfg.pushMax / m; }
        body.pushX = px; body.pushY = py;
      }
    },
  };
}
