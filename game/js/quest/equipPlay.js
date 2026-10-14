// game/js/quest/equipPlay.js (EQ-07 + EQ-09, architecture 38.41). Glue between the input, the equipment component, the shield
// sim (EQ-06), the bow draw and the arrow sim (EQ-08). Buttons (owner default, equipment epic OQ2): LMB = main hand
// (sword attack / bow draw, release shoots), hold RMB = raise the shield, Q = swap weapon set (0.3 s, never locks the player).
// hands.step(player, rawLeftHand, rawRightHand, gate): the LEFT hand (main: sword / bow) follows LMB, the RIGHT hand (off: shield) RMB (OB-017).
// No Math.random, no trig (the host passes the unit look vector), no allocation per step.
import { swapSet } from './sim/equipment.js';
import { createBowDraw, BOW_SHOT, BOW_DRY } from './sim/bowDraw.js';
import { arrowDamage } from './sim/arrows.js';
import { combatMods, refreshCombat, rollBow } from './sim/combatMods.js'; // ITEM-04
import { createStatsCache } from './sim/itemInst.js';

export const SWAP_STEPS = 18;       // 0.3 s lower/raise
export const PICKUP_RADIUS = 1.1;   // walk-over reach (m)
export const PICKUP_REACH_E = 3.0;  // E key reach (m)
const EYE_FWD = 0.5;                // arrows leave 0.5 m in front of the eye

/** Registers a no-op item sim for every off-hand / ranged item def so the hands router arms them (`downOf(id)`). */
export function registerGearItems(hands, defs, stub) {
  for (const id of Object.keys(defs)) {
    const e = defs[id].equip;
    if (e && (e.slot === 'off' || e.slot === 'ranged' || (e.slot === 'main' && id !== 'sword'))) hands.register(id, stub()); // EQ-20: main-slot tier swords are armed by id too
  }
}

/**
 * @param {{hands:any, shield:any, arrows:any, defs:any, say:(text:string)=>void, swordDamage:number}} o
 */
export function createEquipPlay(o) {
  const { hands, shield, arrows, defs } = o;
  const bow = createBowDraw(o.bowCfg), statsCache = o.statsCache || createStatsCache();
  const bag = { inv: null, eq: null, defs };
  let swapT = 0, pickTick = 0;
  const api = {
    shield, bow, arrows,
    get swapT() { return swapT; },
    /** 0..1 lower/raise progress of a set swap (1 = nothing happening) for the views */
    get swapFrac() { return swapT > 0 ? 1 - swapT / SWAP_STEPS : 1; },
    get speedScale() { return shield.speedScale; },
    swordDown: false,
    /** Before hands.step: Q swaps the weapon set. Returns whether the weapon buttons are held back (during the swap). */
    pre(player, swapPressed, gate) {
      const eq = player.components && player.components.equipment;
      if (swapT > 0) swapT--;
      if (gate && swapPressed && eq && swapT === 0 && !bow.drawing) {
        const before = eq.set;
        if (swapSet(eq) === before) o.say('No bow');
        else swapT = SWAP_STEPS;
      }
      return swapT > 0;
    },
    /** After hands.step. c = {gate, fx, fy, fz (unit look), ex, ey, ez (eye), px, py, pz (feet), interact} */
    post(player, c) {
      const comp = player.components, eq = comp && comp.equipment;
      if (!eq) { refreshCombat(statsCache, null, defs); shield.step(false, false, c.fx, c.fy); api.swordDown = hands.downOf('sword'); arrows.step(); return; }
      refreshCombat(statsCache, eq, defs); // ITEM-04: totals of what is worn (cached on eq.rev)
      bow.setDrawMul(combatMods.drawMul);
      const melee = eq.set === 'melee';
      const hasShield = melee && eq.off !== null && swapT === 0;
      const sDown = hasShield && c.gate && eq.off !== null && hands.downOf(eq.off);
      // unit 2D look for the block arc (fz tilts the vector; renormalise the horizontal part)
      const h = Math.sqrt(c.fx * c.fx + c.fy * c.fy) || 1;
      shield.step(sDown, hasShield, c.fx / h, c.fy / h);
      api.swordDown = melee && swapT === 0 && !shield.raised && hands.downOf(eq.main !== null && eq.main !== undefined ? eq.main : 'sword');

      const ranged = eq.set === 'ranged' && eq.ranged !== null && swapT === 0;
      if (!c.gate || swapT > 0) bow.cancel();
      const bDown = ranged && c.gate && hands.downOf(eq.ranged);
      const ev = bow.step(bDown, ranged && c.gate, eq.quiver ? eq.quiver.n : 0);
      if (ev === BOW_SHOT) {
        const r = combatMods.active ? rollBow() : null; // ITEM-04: rolled bow damage x draw factor
        const dmg = arrowDamage(r ? r.dmg : o.swordDamage, bow.shotFrac);
        arrows.shoot(eq, c.ex + c.fx * EYE_FWD, c.ey + c.fy * EYE_FWD, c.ez + c.fz * EYE_FWD, c.fx, c.fy, c.fz, bow.shotFrac, dmg, r ? r.crit : 0);
      } else if (ev === BOW_DRY) o.say('No arrows');

      arrows.step();
      // pick-up: walk-over every 6th step, E within reach (nearest first)
      bag.inv = comp.inventory; bag.eq = eq;
      if (bag.inv) {
        let n = 0;
        if (c.interact && c.gate) {
          const k = arrows.nearestPickable(c.px, c.py, c.pz + 0.8, PICKUP_REACH_E);
          if (k >= 0) n = arrows.pickup(arrows.stuck.x[k], arrows.stuck.y[k], arrows.stuck.z[k], 0.05, bag);
        }
        if (n === 0 && (++pickTick % 6) === 0) n = arrows.pickup(c.px, c.py, c.pz + 0.8, PICKUP_RADIUS, bag);
        if (n > 0) o.say(n > 1 ? '+' + n + ' arrows' : '+1 arrow');
      }
    },
  };
  return api;
}
