// SPELL-07: Fire Ring. A burst centred on the caster using the fireball burst (fireballSim.burstAt): the player is never damaged or knocked.
// Numbers: spellDefs.js only. 0 allocation per cast/step. Cooldown starts at cast.
import { SPELL_DEFS } from '../spellDefs.js';
import { SIM_STEP } from '../../../../engine/index.js';

const BODY_MID = 0.9; // m above the feet: burst centre (LOS to beasts at chest height)
/** @param {{burstAt:Function}} fireball @param {{spendMana?:(n:number)=>boolean, tier?:()=>number, damageMul?:()=>number}} [hooks] */
export function createFireRingSim(fireball, hooks) {
  const tiers = SPELL_DEFS.fireRing.tiers;
  let cooldown = 0, castTick = -1000000, tick = 0;
  return {
    get cooldown() { return cooldown; },
    get castTick() { return castTick; },
    /** -> 'cast' | 'busy' | 'nomana' */
    cast(player) {
      if (cooldown > 0) return 'busy';
      const t = hooks && typeof hooks.tier === 'function' ? hooks.tier() | 0 : 1;
      const r = tiers[(t < 1 ? 1 : t > 3 ? 3 : t) - 1];
      if (!(hooks && typeof hooks.spendMana === 'function' ? hooks.spendMana(r.mana) : true)) return 'nomana';
      cooldown = Math.round(r.cd / SIM_STEP); castTick = tick;
      const m = hooks && typeof hooks.damageMul === 'function' ? hooks.damageMul() : 1, tr = player.transform;
      fireball.burstAt(tr.x, tr.y, tr.z + BODY_MID, r.r, r.dmg * (m > 0 ? m : 1), r.knock);
      return 'cast';
    },
    step() { tick++; if (cooldown > 0) cooldown--; },
    hashInto(h) { h.u32(cooldown); h.u32(castTick & 0x7fffffff); },
  };
}
