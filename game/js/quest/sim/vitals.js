// game/js/quest/sim/vitals.js (US-080a1, architecture.md 30.2). Player vitals: HP, damage (beast hits + falls),
// invuln window, death timeline, respawn at the save point. Rule 15 (this file, game/js/quest/sim/**): no
// Math.random, no trig (sin/cos/atan2/tan/pow/hypot - direction vectors are normalised with Math.sqrt, same
// convention as beastSim.js), no wall clock, integer step timers only.
//
// `components.health {hp, max, invuln}` is a documented game component shape living directly on the player
// entity (not a separate engine module - same reasoning as the beast brain, 29.1/30.2): plain data, so it
// round-trips through the engine's existing `serialize`/`deserialize` with no engine change. This file lazily
// creates it on the player entity the first time `step()` sees that entity if it is not already there.
//
// `dead`/`deathStep`/`cardReady`/`hurtTick` are transient presentation/flow state, kept on the returned sim object
// only (not serialized - a reload always comes back alive, same as the "respawn never touches world.state" rule).

/** @param {any} player plain entity data (`world.get('player').data`-shaped: `{transform, components}`) */
function ensureHealth(player, cfg) {
  const c = player.components || (player.components = {});
  if (!c.health) c.health = { hp: cfg.startHp, max: cfg.maxHp, invuln: 0 };
  return c.health;
}

// `components.mana {mp, max, regen, pause}` (US-080b): same lazy-create-on-the-player-entity convention as
// `components.health` above - plain data, round-trips through serialize/deserialize with no engine change.
function ensureMana(player, cfg) {
  const c = player.components || (player.components = {});
  if (!c.mana) c.mana = { mp: cfg.startMp, max: cfg.maxMp, regen: 0, pause: 0 };
  return c.mana;
}

/**
 * @param {any} world engine World (used only to resolve a `combat:hit`'s `source` entity for knockback direction)
 * @param {any} events engine.events (Events instance) - listens for `combat:hit`
 * @param {typeof import('./vitalsConfig.js').VITALS_DEFAULTS} cfg
 * @param {{beasts?: {resetAll: Function}, targeting?: {clear: Function}, syncFacing?: Function} | undefined} hooks
 *   null-safe; `syncFacing(transform)` keeps the camera's look source aligned after restoring the body.
 */
export function createVitals(world, events, cfg, hooks) {
  const h = hooks || {};

  let player = null;      // last entity passed to step() (same object every call in practice)
  let health = null;      // player.components.health (same reference as the live entity's)
  let mana = null;        // player.components.mana (same reference as the live entity's), US-080b
  let spawnDefault = null; // player's transform at the very first step() call, used when no save point is set
  let eyeHStart = 1.6;     // standing eyeH captured the instant death starts, for eyeH()'s sink lerp
  let lastSafe = null;     // VOID-RESPAWN-01: the last grounded, not-falling spot {x,y,z,yawDeg,tick}
  let tick = 0;

  const sim = {
    dead: false,
    deathStep: 0,
    cardReady: false,
    hurtTick: 0,
    manaFlashTick: 0, // US-080b: set to `tick` on a spendMana() that was too short, same pattern as hurtTick
    inputLocked: false,
    godMode: false, // dev (`?debug=1`): applyDamage no-ops while true
  };

  // hp/max/invuln read through to the live component, so tests/view code can read `vitals.hp` without reaching
  // into `player.components.health` themselves, but there is exactly one source of truth (the component).
  Object.defineProperty(sim, 'hp', { enumerable: true, get: () => (health ? health.hp : cfg.startHp) });
  Object.defineProperty(sim, 'max', { enumerable: true, get: () => (health ? health.max : cfg.maxHp) });
  Object.defineProperty(sim, 'invuln', { enumerable: true, get: () => (health ? health.invuln : 0) });
  // Same read-through pattern for mana (US-080b): one source of truth (player.components.mana).
  Object.defineProperty(sim, 'mp', { enumerable: true, get: () => (mana ? mana.mp : cfg.startMp) });
  Object.defineProperty(sim, 'mpMax', { enumerable: true, get: () => (mana ? mana.max : cfg.maxMp) });
  // Q9 item 2a: the current step count, read-through so vitalsView.js can age `hurtTick` against it
  // (`(vitals.tick - vitals.hurtTick) / 60`) instead of a continuous `simTime` that keeps running across a
  // restart while `tick` resets to 0 - comparing a step count to boot-time seconds never showed the hurt
  // edge/kick after a restart.
  Object.defineProperty(sim, 'tick', { enumerable: true, get: () => tick });

  /** `n` hp, `dirX/dirY` an optional unit knockback direction (absent = no source = no knockback). */
  function applyDamage(n, dirX, dirY) {
    if (sim.godMode || sim.dead || !health) return;
    if (health.invuln > 0) return;
    if (!(n > 0)) return;
    health.hp = Math.max(0, health.hp - n);
    health.invuln = cfg.invulnSteps;
    sim.hurtTick = tick;
    if (player && typeof dirX === 'number' && typeof dirY === 'number') {
      const body = player.components && player.components.body;
      if (body) {
        body.vx = (body.vx || 0) + dirX * cfg.knockbackSpeed;
        body.vy = (body.vy || 0) + dirY * cfg.knockbackSpeed;
      }
    }
  }

  /**
   * US-080b. `n` mp: returns false and records `manaFlashTick` (same pattern as `hurtTick`) without changing
   * mp/pause when short; else spends it and starts the regen pause. Nothing calls this yet (D-021 spells later) -
   * exposed on the sim object for that future use, covered by tests here.
   */
  function spendMana(n) {
    if (!mana) return false;
    if (mana.mp < n) { sim.manaFlashTick = tick; return false; }
    mana.mp -= n;
    mana.pause = cfg.manaPauseSteps;
    return true;
  }

  function onHit(p) {
    if (!p || p.target !== 'player' || !player || !health) return;
    const scale = p.source !== 'player' ? cfg.beastDamageScale : 1;
    const n = Math.round((p.damage || 0) * scale);
    let dirX, dirY;
    if (p.source != null) {
      const srcHandle = world.get(p.source);
      const srcData = srcHandle && srcHandle.data;
      if (srcData && srcData.transform && player.transform) {
        const dx = player.transform.x - srcData.transform.x;
        const dy = player.transform.y - srcData.transform.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1e-9) { dirX = dx / d; dirY = dy / d; }
      }
    }
    applyDamage(n, dirX, dirY);
  }
  const offCombatHit = events.on('combat:hit', onHit);

  function checkFall(p) {
    const body = p.components && p.components.body;
    if (!body || !body.landed) return;
    const dist = body.fallDistance || 0;
    let n = 0;
    if (dist > cfg.fallThreshold10m) n = cfg.fallDamage10m;
    else if (dist > cfg.fallThreshold6m) n = cfg.fallDamage6m;
    if (n > 0) applyDamage(n); // no source -> no knockback
  }

  function enterDead() {
    sim.dead = true;
    sim.deathStep = 0;
    sim.cardReady = false;
    const body = player.components && player.components.body;
    eyeHStart = body && typeof body.eyeH === 'number' ? body.eyeH : 1.6;
  }

  function respawn() {
    if (!player || !health) return;
    const state = world.state || {};
    const sx = state['save.x'], sy = state['save.y'], sz = state['save.z'], syaw = state['save.yaw'];
    const t = player.transform;
    if (typeof sx === 'number' && typeof sy === 'number' && typeof sz === 'number') {
      t.x = sx; t.y = sy; t.z = sz;
      if (typeof syaw === 'number') t.yawDeg = syaw;
    } else if (spawnDefault) {
      t.x = spawnDefault.x; t.y = spawnDefault.y; t.z = spawnDefault.z;
      if (typeof spawnDefault.yawDeg === 'number') t.yawDeg = spawnDefault.yawDeg;
    }
    const body = player.components && player.components.body;
    if (body) { body.vx = 0; body.vy = 0; body.vz = 0; }
    health.hp = health.max;
    health.invuln = cfg.invulnSteps;
    if (mana) mana.mp = mana.max; // US-080b: full mana on respawn, per the US-080 AC
    sim.dead = false;
    sim.deathStep = 0;
    sim.cardReady = false;
    lastSafe = null; // the save point may be >voidFallM below the old safe spot
    if (h.beasts && typeof h.beasts.resetAll === 'function') h.beasts.resetAll();
    if (h.targeting && typeof h.targeting.clear === 'function') h.targeting.clear();
    if (typeof h.syncFacing === 'function') h.syncFacing(t);
  }

  /** @param {any} p player entity data @param {boolean} usePressed [E] pressed this step */
  sim.step = function step(p, usePressed) {
    tick++;
    player = p;
    health = ensureHealth(player, cfg);
    mana = ensureMana(player, cfg);
    if (!spawnDefault && player.transform) {
      const t = player.transform;
      spawnDefault = { x: t.x, y: t.y, z: t.z, yawDeg: t.yawDeg };
    }

    if (!sim.dead) {
      if (health.invuln > 0) health.invuln--;
      checkFall(player);
      // VOID-RESPAWN-01: capture the last safe (grounded, not falling) spot, and if the player falls out of the
      // world (past lastSafe.z - voidFallM, e.g. the BUG-GONDOLA-FALL z=-1977), teleport back with no damage.
      const t = player.transform;
      const body = player.components && player.components.body;
      if (body && body.grounded && !body.fallDistance) {
        if (!lastSafe || tick - lastSafe.tick >= cfg.voidSafeIntervalSteps) {
          lastSafe = { x: t.x, y: t.y, z: t.z, yawDeg: t.yawDeg, tick };
        }
      }
      if (lastSafe && t.z < lastSafe.z - cfg.voidFallM) {
        t.x = lastSafe.x; t.y = lastSafe.y; t.z = lastSafe.z;
        if (typeof lastSafe.yawDeg === 'number') t.yawDeg = lastSafe.yawDeg;
        if (body) { body.vx = 0; body.vy = 0; body.vz = 0; body.grounded = true; body.fallDistance = 0; body.landed = false; } // no fall damage for the void drop
        health.invuln = cfg.invulnSteps; // no damage, just the invuln window
      }
      if (health.hp === 0) enterDead();
      // US-080b mana regen: paused `pause` steps after any spend, else +1 mp every `manaRegenSteps` steps.
      if (mana.pause > 0) mana.pause--;
      else {
        mana.regen++;
        if (mana.regen >= cfg.manaRegenSteps) { mana.mp = Math.min(mana.max, mana.mp + 1); mana.regen = 0; }
      }
    } else {
      sim.deathStep++;
      if (sim.deathStep >= cfg.sinkSteps + cfg.fadeSteps) sim.cardReady = true;
      if (sim.cardReady && usePressed) respawn();
    }
    sim.inputLocked = sim.dead;
  };

  /** `undefined` while alive; lerps from the standing eyeH toward 0.4 m over the sink phase while dead. */
  sim.eyeH = function eyeH() {
    if (!sim.dead) return undefined;
    const frac = Math.min(sim.deathStep, cfg.sinkSteps) / cfg.sinkSteps;
    return eyeHStart + (0.4 - eyeHStart) * frac;
  };

  sim.hashInto = function hashInto(hh) {
    hh.u32(health ? health.hp : 0);
    hh.u32(health ? health.invuln : 0);
    hh.u32(sim.dead ? 1 : 0);
    hh.u32(sim.deathStep);
    hh.u32(sim.cardReady ? 1 : 0);
    hh.u32(sim.hurtTick);
    hh.u32(mana ? mana.mp : 0);
    hh.u32(mana ? mana.pause : 0);
    hh.u32(mana ? mana.regen : 0);
  };

  // ---- dev (`?debug=1`, game side: main.js binds a free key to each of these - not this file's job) ----
  sim.setGodMode = function setGodMode(on) { sim.godMode = !!on; };
  sim.debugHit = function debugHit() { applyDamage(5); };
  sim.spendMana = spendMana; // US-080b: exposed for D-021 spells later; nothing calls it yet

  // Q9 item 1a: drops the `combat:hit` listener - main.js calls this right before creating the next sim on a
  // world load/restart, so listeners never pile up across restarts (one `events.on` per `createVitals` call,
  // same as the old unbounded behaviour, but now exactly one survives at a time).
  sim.dispose = function dispose() { offCombatHit(); };

  return sim;
}
