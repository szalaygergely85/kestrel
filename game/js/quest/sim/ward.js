// SPELL-06: Ward. Absorbs incoming player damage (vitals `absorb` hook, BEFORE armour) up to the tier amount, until used up or timed out.
// Numbers live in spellDefs.js only. Rule 15 (sim/**): integer step timers, no Math.random/trig/wall clock, 0 allocation in step/cast/absorb.
import { SPELL_DEFS } from '../spellDefs.js';
import { SIM_STEP } from '../../../../engine/index.js';

const STEPS = (sec) => Math.round(sec / SIM_STEP);
/** @param {{spendMana?:(n:number)=>boolean, tier?:()=>number}} [hooks] */
export function createWardSim(hooks) {
  const tiers = SPELL_DEFS.ward.tiers;
  let left = 0, timer = 0, cooldown = 0, maxAbs = 1;
  const tierRow = () => { const t = hooks && typeof hooks.tier === 'function' ? hooks.tier() | 0 : 1; return tiers[(t < 1 ? 1 : t > 3 ? 3 : t) - 1]; };
  return {
    get active() { return timer > 0 && left > 0; },
    get absorbLeft() { return left; },
    get fraction() { return timer > 0 && left > 0 ? left / maxAbs : 0; }, // HUD ring strength 0..1
    get cooldown() { return cooldown; },
    get timer() { return timer; },
    /** -> 'cast' | 'busy' (cooldown, no mana spent) | 'nomana'. Cooldown starts at cast. */
    cast() {
      if (cooldown > 0) return 'busy';
      const r = tierRow();
      if (!(hooks && typeof hooks.spendMana === 'function' ? hooks.spendMana(r.mana) : true)) return 'nomana';
      left = r.absorb; maxAbs = r.absorb; timer = STEPS(r.dur); cooldown = STEPS(r.cd);
      return 'cast';
    },
    /** vitals hook: damage n in, damage still to be applied out (overflow passes). Only called for combat hits, never drowning/instant kills. */
    absorb(n) {
      if (!(timer > 0) || !(left > 0) || !(n > 0)) return n;
      if (n <= left) { left -= n; return 0; }
      const over = n - left; left = 0; return over;
    },
    step() { if (cooldown > 0) cooldown--; if (timer > 0) { timer--; if (timer === 0) left = 0; } },
    reset() { left = 0; timer = 0; cooldown = 0; },
    hashInto(h) { h.f64(left); h.u32(timer); h.u32(cooldown); },
  };
}
