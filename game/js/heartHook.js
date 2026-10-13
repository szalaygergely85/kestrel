// game/js/heartHook.js (QL-08). gameHooks handler: heart pieces from any source (chest, quest reward, loot, pickup) arrive
// in the pack as `heart.piece`; every 10 ticks they are turned into the counter (sim/heartPieces.js), the item-get card
// shows "Heart piece (n/4)" and the 4th one adds a heart. State is saved by world.state + components.health.
import { collect, reconcile } from './quest/sim/heartPieces.js';
import { VITALS_DEFAULTS } from './quest/sim/vitalsConfig.js';

export const POLL_STEPS = 10;

/** @param {{getCard?: () => any}} o card = the item-get card (chestHook.card) */
export function createHeartHook({ getCard = () => null, notify = null } = {}) {
  let ctx = null, tick = 0;
  return {
    onBoot(c) {
      ctx = c; tick = 0;
      const h = c.player && c.player.components && c.player.components.health;
      if (h) reconcile(h, c.world.state, VITALS_DEFAULTS.maxHp);
    },
    onTick() {
      if (!ctx || ++tick % POLL_STEPS !== 0 || !ctx.inventory || !ctx.player) return;
      const health = ctx.player.components && ctx.player.components.health;
      const r = collect(ctx.inventory, health, ctx.world.state);
      if (!r) return;
      // OB-105: with `notify` (main.js toasts.say) a one-line toast, never the item-get card (no pause).
      if (notify) notify('Looted: Heart piece (' + r.count + '/4)');
      else { const card = getCard(); if (card) card.push('heart.piece', r.n, { count: r.count }); }
      if (ctx.events) ctx.events.emit('heart:gained', { pieces: r.total, hearts: r.hearts });
    },
  };
}
