// game/js/wild/wildFauna.js - WILD-06: the game side of the ambient wildlife (architecture.md 38.31). One call per
// world load: `createWildFauna(world, wildlifeFx, pool, opts)` -> { step(dt, px, py, running, yawDeg), feed(pool, cam),
// reset(), fauna }. Not combat, not saved, not hashed: it owns its RNG and nothing reads it back. Zero allocation per
// step/frame (scratch objects below).
import { compileFaunaDef, createFauna, createFaunaFeed } from '../../../engine/index.js';
import { createWildEnv } from './wildEnv.js';

const HFOV_RAD = 75 * Math.PI / 180; // the render FOV (feed.js default)
const TELEPORT_M = 30;               // a one-step jump this big (waystone, respawn, dev pose) = reset the fauna

/**
 * @param {object} world   loaded World (terrain, scatter, colliders)
 * @param {object} wildlifeFx  window.ASSETS.wildlifeFx
 * @param {{models: Map}} pool  the game VoxelPool (models are resolved from its bound registry)
 * @param {{seed?: number}} [opts]
 */
export function createWildFauna(world, wildlifeFx, pool, opts) {
  const seed = (opts && opts.seed) || 1;
  const models = (name) => pool.models.get(name) || null;
  const def = compileFaunaDef(wildlifeFx, models);
  const env = createWildEnv(world);
  const fauna = createFauna(def, env, { seed, models });
  const feeder = createFaunaFeed(def, fauna.slots);
  const player = { x: 0, y: 0, sprinting: false };
  const cam = { x: 0, y: 0, fx: 0, fy: -1, hfovRad: HFOV_RAD };
  let lastX = NaN, lastY = NaN;

  function step(dt, px, py, running, yawDeg) {
    if (lastX === lastX && Math.abs(px - lastX) + Math.abs(py - lastY) > TELEPORT_M) fauna.reset();
    lastX = px; lastY = py;
    const yaw = yawDeg * Math.PI / 180;
    player.x = px; player.y = py; player.sprinting = !!running;
    cam.x = px; cam.y = py; cam.fx = Math.sin(yaw); cam.fy = -Math.cos(yaw);
    fauna.update(dt, player, cam);
  }
  function reset() { fauna.reset(); lastX = NaN; lastY = NaN; }
  return { step, feed: feeder.feed, reset, fauna, feeder, env, def };
}
