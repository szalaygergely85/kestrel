// game/js/quest/sim/beastSim.c2.test.js (view). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

// ---- US-079b view (beastView.js) ------------------------------------------------------------------------------
{
  const overlay = { bar() {} };
  const styleIds = { beastNotice: 0 };

  // a fresh (never-hit) beast shows its state clip, not the hurt flash.
  const z = freshSim([beastEntity('b1', 1461, 1031)]);
  presentBeasts(z.sim, null, overlay, styleIds);
  ok('view: a fresh beast shows idle (not hurt)', z.sim.entities[0].components.voxel.anim === 'idle', `anim=${z.sim.entities[0].components.voxel.anim}`);

  // hurt clip for 10 steps after a hit.
  const a = freshSim([beastEntity('b1', 1461, 1031)]);
  a.events.emit('combat:hit', LIGHT_HIT('b1'));
  const vA = a.sim.entities[0].components.voxel;
  let hurtSteps = 0;
  for (let k = 0; k < 10; k++) {
    presentBeasts(a.sim, null, overlay, styleIds);
    if (vA.anim === 'hurt') hurtSteps++;
    a.sim.step(1e6, 1e6, 0);
  }
  ok('view: hurt clip for 10 steps after a hit', hurtSteps === 10, `hurtSteps=${hurtSteps}`);
  presentBeasts(a.sim, null, overlay, styleIds);
  ok('view: flinch clip after the 10-step hurt window', vA.anim === 'flinch', `anim=${vA.anim}`);

  // die (frame, t within frame) across DYING, converted through the clip durations (US-079b ARCH).
  const b = freshSim([beastEntity('b1', 1461, 1031)]);
  b.events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  const vB = b.sim.entities[0].components.voxel;
  presentBeasts(b.sim, null, overlay, styleIds);
  ok('view: die clip at DYING entry (frame 0, t 0)', vB.anim === 'die' && vB.frame === 0 && vB.t === 0, `anim=${vB.anim} frame=${vB.frame} t=${vB.t}`);
  let dieTracks = true;
  const expect = { frame: -1, t: -1 };
  for (let k = 0; k < b.sim.cfgSteps.die; k++) {
    b.sim.step(1e6, 1e6, 0);
    if (b.sim.state[0] === STATE_DYING) {
      presentBeasts(b.sim, null, overlay, styleIds);
      const elapsed = (b.sim.cfgSteps.die - b.sim.timer[0]) * (1000 / 60);
      frameTFromElapsed(elapsed, DIE_DURATIONS, expect);
      if (vB.anim !== 'die' || vB.frame !== expect.frame || Math.abs(vB.t - expect.t) > 1e-9) dieTracks = false;
    }
  }
  ok('view: die (frame, t) matches frameTFromElapsed across DYING', dieTracks);

  // hidden at GONE (and not hidden during SINK).
  const c = freshSim([beastEntity('b1', 1461, 1031)]);
  c.events.emit('combat:hit', { source: 'player', target: 'b1', damage: 4, heavy: 1, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0, cause: 'sword' });
  const vC = c.sim.entities[0].components.voxel;
  for (let k = 0; k < c.sim.cfgSteps.die; k++) c.sim.step(1e6, 1e6, 0);
  c.sim.despawnCorpse('b1');
  c.sim.step(1e6, 1e6, 0);
  presentBeasts(c.sim, null, overlay, styleIds);
  ok('view: not hidden during SINK', vC.hidden !== true);
  for (let k = 0; k < c.sim.cfgSteps.sink; k++) c.sim.step(1e6, 1e6, 0);
  presentBeasts(c.sim, null, overlay, styleIds);
  ok('view: hidden at GONE', vC.hidden === true);
}


finish();
