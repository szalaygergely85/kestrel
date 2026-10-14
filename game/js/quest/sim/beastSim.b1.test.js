// game/js/quest/sim/beastSim.b1.test.js (stagger). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

// ---------------------------------------------------------------------------------------------------------------
// 9. US-078d amendment (D-034) "Stagger (beastSim, heavy only)": a heavy sword `combat:hit` on the beast's own id
//    enters STATE_STAGGER from ANY state, for 36 steps (0.6 s), with no contact hit possible during it (contact
//    only fires from STATE_CHARGE, which the stagger left), a knockback displacement of ~0.6-0.7 m, then chase
//    (if still seen) or return. A light hit has no beast-side effect in this story.
// ---------------------------------------------------------------------------------------------------------------

{
  // Heavy hit while the beast is in WINDUP -> stagger immediately (interrupts windup).
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_WINDUP;
  sim.timer[0] = sim.cfgSteps.windup;
  emitHeavyHit(events, 'b1', 1, 0); // knock east
  ok('heavy hit in windup -> STATE_STAGGER', sim.state[0] === STATE_STAGGER, `state=${sim.state[0]}`);
  ok('stagger timer = cfgSteps.stagger (36 steps / 0.6 s)', sim.timer[0] === sim.cfgSteps.stagger, `timer=${sim.timer[0]}`);
}

{
  // Heavy hit while CHARGING -> stagger interrupts the charge; no contact hit lands during the stagger, and the
  // beast displaces ~0.6-0.7 m (per the amendment's own worked number: staggerKnock 4 m/s decaying by accel 12).
  const bx = 1461, by = 1031, px = bx, py = by - 0.5; // would otherwise be a contact hit next step (1f precedent)
  const { sim, hits, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE;
  sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.cdx[0] = 0; sim.cdy[0] = -1; // straight toward the (otherwise contact-range) player
  emitHeavyHit(events, 'b1', 0, 1); // knock south (away from the player) - this is the test's own input, not a beast contact
  ok('heavy hit in charge -> STATE_STAGGER (interrupts the charge)', sim.state[0] === STATE_STAGGER, `state=${sim.state[0]}`);
  const startX = sim.steer.x[0], startY = sim.steer.y[0];
  for (let i = 0; i < sim.cfgSteps.stagger; i++) sim.step(px, py, 0);
  const beastContacts = hits.filter((h) => h.source === 'b1');
  ok('no contact hit (beast-initiated) during the stagger (charge contact is impossible while staggered)',
    beastContacts.length === 0, `hits=${JSON.stringify(hits)}`);
  const dx = sim.steer.x[0] - startX, dy = sim.steer.y[0] - startY;
  const disp = Math.sqrt(dx * dx + dy * dy);
  ok('stagger displaces roughly 0.6-0.7 m before decaying to a stop', disp > 0.4 && disp < 1.0, `disp=${disp.toFixed(3)}`);
  ok('stagger ends -> chase or return (not idle/wander)', sim.state[0] === STATE_CHASE || sim.state[0] === STATE_RETURN, `state=${sim.state[0]}`);
}

{
  // The charge wall-slow streak counter (the reused `unseen` field) is cleared on entering stagger.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_CHARGE;
  sim.timer[0] = sim.cfgSteps.chargeMax;
  sim.unseen[0] = 1; // one slow-charge step already counted toward the wall-recover streak
  emitHeavyHit(events, 'b1', 1, 0);
  ok('entering stagger clears the reused wall-streak counter (unseen)', sim.unseen[0] === 0, `unseen=${sim.unseen[0]}`);
}

{
  // Facing frozen while staggered: a notice-style facing update (toward the player) must NOT happen.
  const bx = 1461, by = 1031, px = bx + 5, py = by; // player to the east
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.fx[0] = 0; sim.fy[0] = -1; // facing north
  sim.state[0] = STATE_WINDUP;
  sim.timer[0] = sim.cfgSteps.windup;
  emitHeavyHit(events, 'b1', 0, 1); // knock south
  sim.step(px, py, 0);
  ok('facing stays frozen while staggered', sim.fx[0] === 0 && sim.fy[0] === -1, `fx=${sim.fx[0]} fy=${sim.fy[0]}`);
}

{
  // US-079b: a damaging light hit flinches the beast (stagger is heavy-only), deals 1 HP, and aggroes.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_WANDER;
  events.emit('combat:hit', { source: 'player', target: 'b1', damage: 1, heavy: 0, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  ok('a light hit flinches the beast (not a stagger)', sim.state[0] === STATE_FLINCH && sim.timer[0] === sim.cfgSteps.flinch, `state=${sim.state[0]}`);
  ok('a light hit deals 1 HP and aggroes', sim.entities[0].components.health.hp === 3
    && sim.seen[0] === 1 && sim.unseen[0] === 0 && sim.dmgCd[0] === sim.cfgSteps.dmgCooldown && sim.hurtT[0] === 0);
}

{
  // resetAll clears stagger back to wander/home.
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.steer.x[0] = bx; sim.steer.y[0] = by;
  sim.state[0] = STATE_WANDER;
  emitHeavyHit(events, 'b1', 1, 0);
  ok('staggered before resetAll', sim.state[0] === STATE_STAGGER);
  sim.resetAll();
  ok('resetAll clears stagger -> wander at home', sim.state[0] === STATE_WANDER, `state=${sim.state[0]}`);
}

{
  // dispose() drops the combat:hit listener (no leak across a world reload - the same precedent as
  // targeting.dispose()/vitals.dispose(); main.js must call this before the next createBeastSim, see the report).
  const bx = 1461, by = 1031;
  const { sim, events } = freshSim([beastEntity('b1', bx, by)]);
  sim.dispose();
  sim.state[0] = STATE_WANDER;
  emitHeavyHit(events, 'b1', 1, 0);
  ok('dispose() drops the combat:hit listener', sim.state[0] === STATE_WANDER, `state=${sim.state[0]}`);
}


finish();
