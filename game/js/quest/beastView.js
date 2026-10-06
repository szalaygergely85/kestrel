// game/js/quest/beastView.js (US-079a, architecture.md 29.1; US-079b, 37.16.2). Presentation only - the ONE place
// allowed to turn a beast's stored facing vector into a yaw angle (atan2 is trig, forbidden in sim/**). Reads the
// sim's state and writes only the entity's `transform.yawDeg` and `components.voxel.{anim,t,playing,hidden}` (the
// clip the voxel pool renders) - nothing else back into the sim.
//
// US-079b clip selection (design/models/voxel_beast.js `boarFx.clipFor`): death timeline > hurt/flinch timer >
// state clip. The `die`/`sink` clips are non-looping and driven MANUALLY from the sim's DYING/SINK timers (t in ms),
// so `playing` is false and the engine's `stepAnimations` never double-advances them; `hurt`/`flinch`/state clips
// are let to play normally (playing true). `hidden` hides the instance at STATE_GONE (the US-079b0 voxel-pool skip).
import { yawFromDelta } from '../../../engine/index.js';
import { STATE_NOTICE, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE } from './sim/beastSim.js';

const STEP_MS = 1000 / 60; // one fixed sim step in ms (die/sink clip t is derived from sim step counters)
const HURT_STEPS = 10;     // 37.16.2: the view shows `hurt` while hurtT < 10 (the flash + follow-through window)

// State -> clip for the alive, non-hurt/non-flinch fallback, mirroring boarFx.clipFor.state (wander/notice/recover/
// return -> idle, chase/charge -> charge, windup -> windup, stagger -> flinch).
const STATE_CLIPS = ['idle', 'idle', 'charge', 'windup', 'charge', 'idle', 'idle', 'flinch'];

/**
 * @param {ReturnType<import('./sim/beastSim.js').createBeastSim>} sim
 * @param {any} world
 * @param {any} overlay engine.overlay (RE-07)
 * @param {{beastNotice: number}} styleIds resolved overlay style ids (overlay.styleId('beastNotice'))
 */
export function presentBeasts(sim, world, overlay, styleIds) {
  if (!sim) return;
  for (let i = 0; i < sim.count; i++) {
    const e = sim.entities[i];
    const t = e.transform;
    t.yawDeg = yawFromDelta(sim.fx[i], sim.fy[i]);
    const st = sim.state[i];
    const v = e.components.voxel;
    if (!v) continue; // defensive: beast entities always carry a voxel component in the game

    if (st === STATE_GONE) { v.hidden = true; continue; } // US-079b: hidden at GONE (voxel-pool skip)
    v.hidden = false;

    if (st === STATE_DYING) { // death timeline wins over the hurt flash (37.16.2: die t = (dieSteps - timer)*16.7)
      v.anim = 'die';
      v.t = (sim.cfgSteps.die - sim.timer[i]) * STEP_MS;
      v.playing = false;
    } else if (st === STATE_CORPSE) {
      v.anim = 'dead';
      v.playing = true;
    } else if (st === STATE_SINK) {
      v.anim = 'sink';
      v.t = (sim.cfgSteps.sink - sim.timer[i]) * STEP_MS;
      v.playing = false;
    } else if (sim.hurtT[i] < HURT_STEPS) {
      v.anim = 'hurt';
      v.playing = true;
      if (sim.hurtT[i] === 0) { v.t = 0; v.frame = 0; } // restart the flash from key 0 on the damage step
    } else if (st === STATE_FLINCH) {
      v.anim = 'flinch';
      v.playing = true;
    } else {
      v.anim = STATE_CLIPS[st] || 'idle';
      v.playing = true;
    }

    if (st === STATE_NOTICE) {
      overlay.bar(t.x, t.y, t.z + 1.1, 1, 1, styleIds.beastNotice, styleIds.beastNotice);
    }
  }
  void world;
}
