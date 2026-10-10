// engine/fauna/fauna.js - WILD-04: createFauna = spawner + ground brains (architecture.md 38.31). The one object the
// game holds. Flyer / climber species are spawned but not yet stepped (WILD-07 / WILD-08).
// Imports engine/fauna/** and engine/core/** only (check-deps rule 19).
//   const fauna = createFauna(def, env, { seed, models });   // def = compileFaunaDef(...), env = FaunaEnv,
//                                                            // models = same resolver as compileFaunaDef
//   fauna.update(dt, { x, y, sprinting }, { x, y, fx, fy, hfovRad });   // once per 60 Hz step, after the player
//   fauna.slots (feed reads x, y, z, yaw (rad), model, species, clip), fauna.reset(), fauna.spawner

import { createRng } from '../core/rng.js';
import { createSpawner, VIEW_MARGIN_RAD } from './spawner.js';
import { extendGroundSlot, initGroundAnimal, groundStep } from './groundBrain.js';
import { extendFlyerSlot, initFlyerBird, flyerStep } from './flyerBrain.js';

export function createFauna(def, env, opts) {
  const o = opts || {};
  const seed = (o.seed || 0) >>> 0;
  const models = o.models;
  const spawner = createSpawner(def, env, { seed, maxAlive: o.maxAlive });
  const slots = spawner.slots;
  for (let i = 0; i < slots.length; i++) { extendGroundSlot(slots[i]); extendFlyerSlot(slots[i]); }
  const sps = def.species;
  const ctx = { env, player: null, rng: createRng(seed ^ 0x57494C45), slots, n: slots.length, tick: 0, dt: 1 / 60 };

  spawner.onSpawn = function onSpawn(slot, spc) {
    if (spc.kind !== 'ground' && spc.kind !== 'flyer') return;
    const name = spc.models[slot.model];
    const pm = typeof models === 'function' ? models(name) : (models ? models[name] : null);
    if (spc.kind === 'flyer') initFlyerBird(slot, spc, pm || null, env); else initGroundAnimal(slot, spc, pm || null);
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
      if (spc.kind === 'ground') groundStep(s, spc, ctx); else if (spc.kind === 'flyer') flyerStep(s, spc, ctx); else continue;
      if (s.despawnReq) { // hideOrDespawn: gone once out of view
        const dx = s.x - cam.x, dy = s.y - cam.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > spc.drawM || (dx * cam.fx + dy * cam.fy) / (d || 1) < cosHalf) spawner.despawn(s, true);
      }
    }
    ctx.tick++;
  };

  fauna.reset = function reset() {
    spawner.reset();
    ctx.rng = createRng(seed ^ 0x57494C45); ctx.tick = 0;
  };
  return fauna;
}
