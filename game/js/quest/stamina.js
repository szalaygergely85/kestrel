// game/js/quest/stamina.js (SWIM-02, D-070). Pure swim/dive stamina + drowning logic: no engine, no DOM, 0 alloc per step.
// Wiring (controller, HUD ring, vitals.applyDamage) is SWIM-05. Every tunable number lives in STAMINA_CONFIG.
export const STAMINA_CONFIG = {
  max: 100,            // stamina units
  swimDrainSec: 12,    // seconds to empty while swimming
  diveDrainSec: 6,     // seconds to empty while diving
  refillPerSec: 25,    // units/s on land (not swimming/diving)
  drownTickSec: 1.5,   // seconds between drowning ticks at 0 stamina
  drownDamage: 1,      // hearts lost per tick
  hearts: 3,           // standalone heart count for createStaminaState (the real hp lives in vitals)
};

export function createStaminaState(cfg = STAMINA_CONFIG) {
  return { stamina: cfg.max, hearts: cfg.hearts, drownTimer: 0, drowning: false, dead: false, cause: null };
}

/**
 * Advance one step. state is mutated in place. input = {swimming, diving} (diving implies in-water).
 * hooks (optional) = {onDamage(amount, 'drown') -> true if that killed the player (e.g. vitals), onDeath('drown')}.
 * Refill (not in water) cancels drowning. Returns state.dead.
 */
export function stepStamina(state, dt, input, cfg = STAMINA_CONFIG, hooks = null) {
  if (state.dead) return true;
  const inWater = input.swimming || input.diving;
  if (inWater) {
    const sec = input.diving ? cfg.diveDrainSec : cfg.swimDrainSec;
    state.stamina = Math.max(0, state.stamina - (cfg.max / sec) * dt);
  } else {
    state.stamina = Math.min(cfg.max, state.stamina + cfg.refillPerSec * dt);
  }
  if (state.stamina > 0) { state.drowning = false; state.drownTimer = 0; return false; }
  if (!inWater) return false; // cannot happen with refill>0, kept for refillPerSec=0 configs
  state.drowning = true;
  state.drownTimer += dt;
  while (state.drownTimer >= cfg.drownTickSec && !state.dead) {
    state.drownTimer -= cfg.drownTickSec;
    state.hearts -= cfg.drownDamage;
    const killed = hooks && hooks.onDamage ? hooks.onDamage(cfg.drownDamage, 'drown') === true : false;
    if (killed || state.hearts <= 0) {
      state.dead = true; state.cause = 'drown';
      if (hooks && hooks.onDeath) hooks.onDeath('drown');
    }
  }
  return state.dead;
}
