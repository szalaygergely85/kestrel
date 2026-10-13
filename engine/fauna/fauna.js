// engine/fauna/fauna.js - WILD-04: createFauna = spawner + ground brains (architecture.md 38.31). The one object the
// game holds. Ground, flyer and climber (squirrel) brains.
// Imports engine/fauna/** and engine/core/** only (check-deps rule 19).
//   const fauna = createFauna(def, env, { seed, models });   // def = compileFaunaDef(...), env = FaunaEnv,
//                                                            // models = same resolver as compileFaunaDef
//   fauna.update(dt, { x, y, sprinting }, { x, y, fx, fy, hfovRad });   // once per 60 Hz step, after the player
//   fauna.slots (feed reads x, y, z, yaw (rad), model, species, clip), fauna.reset(), fauna.spawner

import { createRng } from '../core/rng.js';
import { createSpawner, VIEW_MARGIN_RAD } from './spawner.js';
import { extendGroundSlot, initGroundAnimal, groundStep } from './groundBrain.js';
import { extendFlyerSlot, initFlyerBird, flyerStep } from './flyerBrain.js';
import { extendClimberSlot, initClimberAnimal, climberStep } from './climberBrain.js';

export const MAX_THREATS = 16;

export function createFauna(def, env, opts) {
  const o = opts || {};
  const seed = (o.seed || 0) >>> 0;
  const models = o.models;
  const spawner = createSpawner(def, env, { seed, maxAlive: o.maxAlive });
  const slots = spawner.slots;
  for (let i = 0; i < slots.length; i++) { extendGroundSlot(slots[i]); extendFlyerSlot(slots[i]); extendClimberSlot(slots[i]); }
  const sps = def.species;
  const ctx = { env, player: null, rng: createRng(seed ^ 0x57494C45), slots, n: slots.length, tick: 0, dt: 1 / 60,
    // LIFE-06: species table, prey mask, external threat points (setThreats), kill hook
    sps, preyMask: def.preyMask | 0, thrN: 0, thrX: new Float64Array(MAX_THREATS), thrY: new Float64Array(MAX_THREATS), kill: null };
  ctx.kill = (s) => spawner.despawn(s, true);

  spawner.onSpawn = function onSpawn(slot, spc) {
    if (spc.kind !== 'ground' && spc.kind !== 'flyer' && spc.kind !== 'climber') return;
    const name = spc.models[slot.model];
    const pm = typeof models === 'function' ? models(name) : (models ? models[name] : null);
    if (spc.kind === 'flyer') initFlyerBird(slot, spc, pm || null, env);
    else if (spc.kind === 'climber') initClimberAnimal(slot, spc, pm || null, env);
    else initGroundAnimal(slot, spc, pm || null);
  };

  const fauna = { spawner, slots, def, ctx, stats: spawner.stats };

  fauna.update = function update(dt, player, cam) {
    ctx.player = player; ctx.dt = dt;
    spawner.update(dt, player.x, player.y, cam.x, cam.y, cam.fx, cam.fy, cam.hfovRad);
    const cosHalf = Math.cos(Math.min(Math.PI, cam.hfovRad * 0.5 + VIEW_MARGIN_RAD));
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.alive) continue;
      const spc = sps[s.species];
      if (spc.kind === 'ground') groundStep(s, spc, ctx); else if (spc.kind === 'flyer') flyerStep(s, spc, ctx); else if (spc.kind === 'climber') climberStep(s, spc, ctx); else continue;
      if (s.despawnReq) { // hideOrDespawn: gone once out of view
        const dx = s.x - cam.x, dy = s.y - cam.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > spc.drawM || (dx * cam.fx + dy * cam.fy) / (d || 1) < cosHalf) spawner.despawn(s, true);
      }
    }
    ctx.tick++;
  };

  /** External threat points (beasts, owned by the game): up to 16, copied. Animals flee them like the player. */
  fauna.setThreats = function setThreats(n, xs, ys) {
    const m = n < MAX_THREATS ? n : MAX_THREATS;
    for (let i = 0; i < m; i++) { ctx.thrX[i] = xs[i]; ctx.thrY[i] = ys[i]; }
    ctx.thrN = m > 0 ? m : 0;
  };

  /** Nearest live prey slot (a species some other species hunts, or `mask` = species-index bitmask) within r of
   *  (x, y): slot index or -1; out.x / out.y filled. No allocation. */
  fauna.nearestPrey = function nearestPrey(x, y, r, out, mask) {
    const mk = mask ? mask : ctx.preyMask;
    let best = -1, bd = r * r;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.alive || !((mk >> s.species) & 1)) continue;
      const dx = s.x - x, dy = s.y - y, d2 = dx * dx + dy * dy;
      if (d2 <= bd) { bd = d2; best = i; }
    }
    if (best >= 0 && out) { out.x = slots[best].x; out.y = slots[best].y; }
    return best;
  };

  /** A beast ate this slot: despawn with the cell cooldown. */
  fauna.kill = function kill(i) { const s = slots[i]; if (s && s.alive) spawner.despawn(s, true); };

  fauna.reset = function reset() {
    spawner.reset();
    ctx.rng = createRng(seed ^ 0x57494C45); ctx.tick = 0; ctx.thrN = 0;
  };
  return fauna;
}
