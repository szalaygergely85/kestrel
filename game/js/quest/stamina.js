// game/js/quest/stamina.js (SWIM-02, D-070). Pure swim/dive stamina + drowning logic: no engine, no DOM, 0 alloc per step.
// D-070 amendment (2026-10-13): surface swimming is unlimited (no drain, no drowning); only diving (eye under water) uses breath.
// Wiring (controller, HUD ring, vitals.applyDamage) is SWIM-05. Every tunable number lives in STAMINA_CONFIG.
export const STAMINA_CONFIG = {
  max: 100,            // stamina units
  diveDrainSec: 6,     // seconds to empty while diving
  refillPerSec: 25,    // units/s on land and at the surface (not diving)
  drownTickSec: 1.5,   // seconds between drowning ticks at 0 stamina
  drownDamage: 1,      // hearts lost per tick
  hearts: 3,           // standalone heart count for createStaminaState (the real hp lives in vitals)
};

export function createStaminaState(cfg = STAMINA_CONFIG) {
  return { stamina: cfg.max, hearts: cfg.hearts, drownTimer: 0, drowning: false, dead: false, cause: null };
}

/**
 * Advance one step. state is mutated in place. input = {diving} (swimming is ignored: surface swim = refill).
 * hooks (optional) = {onDamage(amount, 'drown') -> true if that killed the player (e.g. vitals), onDeath('drown')}.
 * Refill (surface/land) cancels drowning. Returns state.dead.
 */
export function stepStamina(state, dt, input, cfg = STAMINA_CONFIG, hooks = null) {
  if (state.dead) return true;
  const diving = !!input.diving;
  if (diving) state.stamina = Math.max(0, state.stamina - (cfg.max / cfg.diveDrainSec) * dt);
  else state.stamina = Math.min(cfg.max, state.stamina + cfg.refillPerSec * dt);
  if (state.stamina > 0) { state.drowning = false; state.drownTimer = 0; return false; }
  if (!diving) return false; // cannot happen with refill>0, kept for refillPerSec=0 configs
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
