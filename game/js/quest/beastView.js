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
const NOTICE_UP_M = 1.1;    // US-079c (boarFx.notice.noticeUpM): the `!` glyph 0.4 m over the ears
const NOTICE_POP_STEPS = 6; // US-079c (boarFx.notice.popSteps): white-hot pop style for the first 6 steps

// State -> clip for the alive, non-hurt/non-flinch fallback, mirroring boarFx.clipFor.state (wander/notice/recover/
// return -> idle, chase/charge -> charge, windup -> windup, stagger -> flinch).
const STATE_CLIPS = ['idle', 'idle', 'charge', 'windup', 'charge', 'idle', 'idle', 'flinch'];

// US-079b ARCH (37.16.1 amendment): the manually-driven clips' keyframe durations (ms), matching
// design/models/voxel_beast.js `boarFx` (die: 90+110+120+80 = 400 ms tip-over + 100 ms held settle; sink: 500 ms
// into the ground + 100 ms held). The voxel pose is (frame, t within frame), so the elapsed sim time must be
// converted through these, not written straight into `v.t`.
export const DIE_DURATIONS = [90, 110, 120, 80, 100];
export const SINK_DURATIONS = [500, 100];

/**
 * US-079b ARCH: converts an elapsed clip time (ms) to (frame, t within frame) over a clip's keyframe durations.
 * @param {number} elapsed
 * @param {number[]} durations
 * @param {{frame:number, t:number}} out
 * @returns {{frame:number, t:number}} out
 */
export function frameTFromElapsed(elapsed, durations, out) {
  let rem = elapsed < 0 ? 0 : elapsed;
  let f = 0;
  while (f < durations.length - 1 && rem >= durations[f]) { rem -= durations[f]; f++; }
  out.frame = f;
  out.t = rem;
  return out;
}

/**
 * @param {ReturnType<import('./sim/beastSim.js').createBeastSim>} sim
 * @param {any} world
 * @param {any} overlay engine.overlay (RE-07)
 * @param {{beastNotice: number, beastNoticePop?: number}} styleIds resolved overlay style ids
 *   (overlay.styleId('beastNotice') and overlay.styleId('beastNoticePop'))
 * @param {ReturnType<import('./beastAnim.js').createBeastAnim>} [anim] ANIM-STATE-WIRE-01 (?beastanim=1): clip state adapter
 */
export function presentBeasts(sim, world, overlay, styleIds, anim) {
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

    // US-079b ARCH (37.16.1 amendment): decide the clip, then reset the pose on every clip change (a clip entered
    // with a stale frame >= count never advances), and drive die/sink by converting elapsed ms -> (frame, t).
    let clip;
    let playing = true;
    if (st === STATE_DYING) { clip = 'die'; playing = false; } // death timeline wins over the hurt flash
    else if (st === STATE_CORPSE) clip = 'dead';
    else if (st === STATE_SINK) { clip = 'sink'; playing = false; }
    else if (anim) clip = anim.update(sim, i, 1000 / 60);
    else if (sim.hurtT[i] < HURT_STEPS) clip = 'hurt';
    else if (st === STATE_FLINCH) clip = 'flinch';
    else clip = STATE_CLIPS[st] || 'idle';

    if (clip !== v.anim) { v.anim = clip; v.frame = 0; v.t = 0; v.loop = undefined; }
    if (anim) { v.blendFrom = anim.prevClip[i]; v.blendW = anim.weight(i); } // cross-fade data; renderer does not consume it yet

    if (playing) {
      v.playing = true;
    } else {
      const steps = (st === STATE_DYING) ? sim.cfgSteps.die : sim.cfgSteps.sink;
      const elapsed = (steps - sim.timer[i]) * STEP_MS;
      frameTFromElapsed(elapsed, (st === STATE_DYING) ? DIE_DURATIONS : SINK_DURATIONS, v);
      v.playing = false;
    }

    if (st === STATE_NOTICE) {
      // US-079c (boarFx.notice): white-hot `!` pop for the first 6 steps, then the alert yellow `!` (falls back to
      // beastNotice when main.js has not yet spread boarFx.overlay / resolved beastNoticePop).
      const elapsed = sim.cfgSteps.notice - sim.timer[i];
      const popStyle = styleIds.beastNoticePop !== undefined ? styleIds.beastNoticePop : styleIds.beastNotice;
      const style = elapsed < NOTICE_POP_STEPS ? popStyle : styleIds.beastNotice;
      overlay.bar(t.x, t.y, t.z + NOTICE_UP_M, 1, 1, style, style);
    }
  }
  void world;
}
