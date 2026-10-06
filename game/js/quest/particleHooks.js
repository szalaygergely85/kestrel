// game/js/quest/particleHooks.js (US-053c, design/models/particles.js's `mounts` hints,
// docs/architecture.md 32.1 particles API). Two independent jobs, following the
// `practiceTarget.js` precedent exactly (a `combat:hit` listener + a per-fixed-step
// function, created/disposed once per 'world:loaded' alongside beasts/sword/vitals):
//
//   1. Sword sparks: on `combat:hit` from the player's sword, `burstAt(sparks, hit point)`.
//      The sword payload (sim/sword.js) carries `dirX, dirY` = the horizontal
//      attacker->target direction, NOT a true surface normal (there is no surface-normal
//      field on the payload at all) - so "cone along the hit normal when available"
//      (AC4) resolves to "there is nothing better available"; this hook passes that
//      horizontal direction straight to `setEmitterDir` with dz 0 and lets the preset's
//      wide 50 deg cone + its own gravity (accelZ -9.8) do the rest. **Flagged deviation**:
//      a true hit normal would need the sword's raycast to report one - out of scope here.
//
//   2. Landing dust: no landing EVENT exists (engine/physics/integrate.js just flips
//      `body.landed` true for exactly the one step the body touches down, already reset
//      to false every other step - see vitals.js's own `checkFall`, same precedent), so
//      this hook's `step(playerData)` reads `body.landed` the same way, once per fixed
//      step. The body's `vz` is already zeroed by integrate.js by the time `landed` is
//      set (line order: `vz = 0; grounded = true; landed = true;`), so there is no
//      "fall speed" field left to read directly. **Flagged deviation**: the landing
//      speed is reconstructed from `body.fallDistance` (peakZ - floor) via free-fall
//      kinematics, v = sqrt(2 * gravity * fallDistance) - exact for this integrator
//      (vertical motion while airborne is plain `vz -= gravity*dt`, no drag/terminal cap),
//      using the same `gravity` the physics step itself ran with (`engine.physics.gravity`,
//      passed in as `cfg.gravity`).
//
// Neither hook calls Math.random() or any other RNG - only `particles.burstAt`/
// `setEmitterDir`, per AC1 "never draws from the sim RNG" (burstAt's own spawn jitter
// draws from the particle sim's own seeded RNG, engine-side, not this file).

/**
 * @param {any} world engine World (unused directly here, kept for the practiceTarget-shaped
 *   signature + future use - e.g. a later "burst only if the floor material supports dust")
 * @param {any} events engine.events (Events instance) - listens `combat:hit`
 * @param {any} particles engine.particles (`defIdOf`, `burstAt`, `setEmitterDir`)
 * @param {{mounts:{sparks:{n:number,nHeavy:number}, dust:{n:number}}, LANDING_DUST_SPEED:number}} cfg
 *   `window.ASSETS.particles` (design/models/particles.js) - only `mounts.sparks.n/nHeavy`,
 *   `mounts.dust.n` and `LANDING_DUST_SPEED` are read.
 * @param {number} [gravity] m/s^2, for the landing-speed reconstruction (default 20, the
 *   engine/physics/config.js `PHYSICS_DEFAULTS.gravity` - pass `engine.physics.gravity`)
 */
export function createParticleHooks(world, events, particles, cfg, gravity = 20) {
  const sparksDefId = particles.defIdOf('sparks');
  const dustDefId = particles.defIdOf('dust');
  const corpseDustDefId = particles.defIdOf('corpseDust'); // US-079b (design/models/voxel_beast.js boarFx.attach)
  const sparksN = (cfg.mounts && cfg.mounts.sparks && cfg.mounts.sparks.n) || 10;
  const sparksNHeavy = (cfg.mounts && cfg.mounts.sparks && cfg.mounts.sparks.nHeavy) || sparksN;
  const dustN = (cfg.mounts && cfg.mounts.dust && cfg.mounts.dust.n) || 10;
  const landingDustSpeed = typeof cfg.LANDING_DUST_SPEED === 'number' ? cfg.LANDING_DUST_SPEED : 6;
  const twoG = 2 * gravity;
  // US-079b: the corpse "turns to dust" as it sinks - boarFx.death.sink.dust wants two bursts (8 at sink step 0 +
  // 6 at step 15 = 14). The sim emits one `beast:sink` at the CORPSE->SINK transition and this hook is stateless, so
  // the two designer bursts collapse into a single 14-dust burst at the sink start (same total, noted deviation).
  const corpseDustN = 14;

  function onHit(p) {
    if (!p || p.source !== 'player' || sparksDefId < 0) return;
    const n = p.heavy ? sparksNHeavy : sparksN;
    particles.burstAt(sparksDefId, p.px, p.py, p.pz, n, p.dirX || 0, p.dirY || 0, 0);
  }
  const off = events.on('combat:hit', onHit);

  function onSink(p) {
    if (!p || corpseDustDefId < 0) return; // no-op unless boarFx.attach() added the preset before create
    particles.burstAt(corpseDustDefId, p.x, p.y, p.z, corpseDustN, 0, 0, 1);
  }
  const offSink = events.on('beast:sink', onSink);

  /**
   * Per fixed step (main.js: alongside vitals.step's slot, after integrate/resolveBodyContacts
   * so `body.landed`/`fallDistance` are this step's values). Cheap: one object read, no-op when
   * the body hasn't just landed.
   * @param {{components:{body?:{landed?:boolean, fallDistance?:number}}, transform:{x:number,y:number,z:number}}} playerData
   */
  function step(playerData) {
    if (dustDefId < 0 || !playerData) return;
    const body = playerData.components && playerData.components.body;
    if (!body || !body.landed) return;
    const dist = body.fallDistance || 0;
    if (dist <= 0) return;
    const speed = Math.sqrt(twoG * dist); // free-fall v from the fall height (see header comment)
    if (speed <= landingDustSpeed) return;
    const t = playerData.transform;
    particles.burstAt(dustDefId, t.x, t.y, t.z + 0.03, dustN); // feet + a touch above the floor
  }

  return { step, dispose: () => { off(); offSink(); } };
}

/**
 * US-053c AC3: `World.js` level props have no generic `components` passthrough (every
 * field is read by name, same situation `applyPropTargetables` (practiceTarget.js)
 * found for `targetable` - the architect's "do not touch World.js" ruling stands, so
 * this is the same game-side mapper shape). Any placed prop entity whose content def
 * carries `emitters: [{preset, offset, on}]` (content/levels/*.json; see
 * `content/levels/tower.level.json`'s `brazier` prop) gets that array copied onto
 * `components.emitters` here - `engine/world/entityEmitters.js`'s own `sync()` already
 * discovers it from there (it reads `e.components.emitters` generically; no further
 * engine-side wiring was needed). Call once per 'world:loaded' (main.js), same
 * "rebuilt fresh every load, before any sim snapshots entity state" precedent as
 * `applyPropTargetables`, and before `entityEmitters`'s own first `sync()` of the load
 * (entityEmitters rebuilds lazily on its own `dirty` flag, so ordering relative to this
 * call only matters relative to the FIRST `sync()`/`step()` call of the frame, not to
 * `entityEmitters`'s creation itself).
 * @param {any} world engine World (`structures`, `get(id)`)
 */
export function applyPropEmitters(world) {
  for (const s of world.structures) {
    const props = s.level && s.level.def && s.level.def.props;
    if (!props) continue;
    for (const p of props) {
      if (!Array.isArray(p.emitters)) continue;
      const handle = world.get(`${s.id}.${p.id}`);
      if (!handle) continue; // taken/removed props stay skipped, same as applyPropTargetables
      handle.data.components.emitters = p.emitters;
    }
  }
}
