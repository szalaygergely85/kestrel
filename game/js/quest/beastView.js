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
import { STATE_CHARGE, STATE_WANDER, STATE_EAT, STATE_WINDUP, STATE_RECOVER, STATE_BITE, STATE_NOTICE, STATE_RETURN, STATE_CHASE, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_STAGGER } from './sim/beastSim.js';

const STEP_MS = 1000 / 60; // one fixed sim step in ms (die/sink clip t is derived from sim step counters)
const HURT_STEPS = 10;     // 37.16.2: the view shows `hurt` while hurtT < 10 (the flash + follow-through window)
const NOTICE_UP_M = 1.1;    // US-079c (boarFx.notice.noticeUpM): the `!` glyph 0.4 m over the ears
const NOTICE_POP_STEPS = 6; // US-079c (boarFx.notice.popSteps): white-hot pop style for the first 6 steps

// State -> clip for the alive, non-hurt/non-flinch fallback, mirroring boarFx.clipFor.state (wander/notice/recover/
// return -> idle, chase/charge -> charge, windup -> windup, stagger -> flinch).
// WOLF-D1: boar clip names/states -> the wolf clips via ASSETS.wolfFx.clipFor.state (windup->crouch, charge->leap,
// chase/recover/flee->run, wander/return->walk when fleeing). Falls back to the built-in names without ASSETS.
const WOLF_STATE_NAMES = ['wander', 'notice', 'chase', 'windup', 'leap', 'recover', 'return', 'stagger'];
function wolfClip(clip, st, fleeing) {
  if (clip === 'hurt' || clip === 'flinch') return clip;
  const fx = globalThis.ASSETS && globalThis.ASSETS.wolfFx;
  const m = fx && fx.clipFor && fx.clipFor.state;
  if (st === STATE_RETURN) return fleeing ? 'run' : 'walk';
  const name = WOLF_STATE_NAMES[st];
  if (m && name && m[name]) return m[name];
  return clip === 'charge' ? 'run' : clip === 'windup' ? 'crouch' : clip;
}
// CLIP-WIRE (OB-153): ASSETS.beastClipsFx models (deer/fox/goat/tortoise) - CHARGE (melee active window) -> attack, chase / charge /
// fleeing (return or any alive moving state) -> charge, via beastClipsFx.clipFor.state (fallbacks: attack / charge). Other kinds untouched.
export function beastClipsClip(model, clip, st, fleeing, moving) {
  const fx = globalThis.ASSETS && globalThis.ASSETS.beastClipsFx;
  if (!fx || !fx.models || fx.models.indexOf(model) < 0 || clip === 'hurt' || clip === 'flinch') return clip;
  const m = (fx.clipFor && fx.clipFor.state) || {};
  if (st === STATE_CHARGE) return m.attack || 'attack';
  if (fleeing && (st === STATE_RETURN || st === STATE_CHASE || st === STATE_WANDER) && moving !== false) return m.flee || 'charge';
  if (st === STATE_CHASE && clip !== 'idle') return m.chase || 'charge';
  return clip;
}
// SWIM-ASSETS-01: ASSETS.eatFx.models (fox/wolf/bear/bearBlack) carry an appended 'eat' clip; other models keep idle.
function eatClip(model) {
  const fx = globalThis.ASSETS && globalThis.ASSETS.eatFx;
  return fx && fx.models && fx.models.indexOf(model) >= 0 ? fx.clip : 'idle';
}
// GOB-07a: goblin / goblinTorch clips via ASSETS.goblinFx.clipFor (state map, windupThrower for ranged goblins, torchState for the
// torch bearers). The thrower keeps showing `throw` for holdIntoRecoverMs into RECOVER (the held javelin must not pop back the
// frame the thrown one spawns): holdT counts the remaining view steps per slot (grown once, 0 alloc per frame).
const GOBLIN_STATE_NAMES = ['wander', 'notice', 'chase', 'windup', 'charge', 'recover', 'return', 'stagger'];
let holdT = new Int32Array(64);
function goblinClip(clip, st, i, sim, v) {
  if (clip === 'hurt' || clip === 'flinch') return clip;
  const fx = globalThis.ASSETS && globalThis.ASSETS.goblinFx;
  const cf = fx && fx.clipFor;
  if (!cf) return clip;
  if (i >= holdT.length) { const n = new Int32Array(Math.max(i + 1, holdT.length * 2)); n.set(holdT); holdT = n; }
  const thrower = sim.ranged && sim.ranged[i] === 1;
  if (thrower && st === STATE_WINDUP) { holdT[i] = Math.round((fx.throw.holdIntoRecoverMs || 400) / STEP_MS); return cf.state.windupThrower; }
  if (thrower && st === STATE_RECOVER && holdT[i] > 0) { holdT[i]--; return cf.state.windupThrower; }
  holdT[i] = 0;
  let name = st === STATE_RETURN && sim.fleeing && sim.fleeing[i] ? 'flee' : GOBLIN_STATE_NAMES[st];
  if (st === STATE_EAT) name = 'idle';
  if (!name) return clip;
  if (v.model === 'goblinTorch' && cf.torchState && cf.torchState[name]) return cf.torchState[name];
  return cf.state[name] || clip;
}
// UNDER-01 (OB-191): skeleton / skeletonArcher clips via ASSETS.skeletonFx.clipFor (state map, archerState for windup / charge / recover). `rise`
// (1.2 s, 7 keys) is played on spawn from sim.riseMs[slot] (set by underSkeletons.createUnderSpawner) and driven manually like die / sink.
export const RISE_DURATIONS = [150, 150, 200, 200, 200, 150, 150];
const RISE_TOTAL_MS = 1200;
export function skeletonClip(clip, st, archer) {
  if (clip === 'hurt' || clip === 'flinch') return clip;
  const fx = globalThis.ASSETS && globalThis.ASSETS.skeletonFx, cf = fx && fx.clipFor;
  if (!cf) return clip;
  const name = GOBLIN_STATE_NAMES[st];
  if (archer && cf.archerState && cf.archerState[name]) return cf.archerState[name];
  return (name && cf.state[name]) || clip;
}
// BEAST-09a: waterBrain state ids (ST_WINDUP 3, ST_CHARGE 4, ST_RECOVER 5, ST_FLINCH 8, ST_SUB 20, ST_GRAB 21) -> crocFx.clipFor.state key
const CROC_STATE_NAME = { 3: 'windup', 4: 'lunge', 5: 'recover', 8: 'stagger', 20: 'swim', 21: 'grab' };
const CROC_STATE_FALLBACK = { windup: 'idle', lunge: 'attack', recover: 'recover', stagger: 'flinch', swim: 'swim', grab: 'grab' };
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

/** OB-171: voxel-pool priority tier of a beast: 2 while engaged (notice..flinch), 1 if hostile (pAggro 0) within 25 m of the camera, else 0. */
export function beastVoxelPriority(st, aggro, t, cam) {
  if (st === STATE_NOTICE || st === STATE_CHASE || st === STATE_WINDUP || st === STATE_CHARGE || st === STATE_RECOVER || st === STATE_STAGGER || st === STATE_FLINCH || st === STATE_BITE) return 2;
  if (aggro !== 0 || !cam || st === STATE_DYING || st === STATE_CORPSE || st === STATE_SINK) return 0;
  const dx = t.x - cam.x, dy = t.y - cam.y;
  return dx * dx + dy * dy <= 625 ? 1 : 0;
}

/**
 * @param {ReturnType<import('./sim/beastSim.js').createBeastSim>} sim
 * @param {any} world
 * @param {any} overlay engine.overlay (RE-07)
 * @param {{beastNotice: number, beastNoticePop?: number}} styleIds resolved overlay style ids
 *   (overlay.styleId('beastNotice') and overlay.styleId('beastNoticePop'))
 * @param {ReturnType<import('./beastAnim.js').createBeastAnim>} [anim] ANIM-STATE-WIRE-01 (?beastanim=1): clip state adapter
 * @param {ReturnType<import('./beastLegs.js').createBeastLegs>} [legs] ANIM-C-05: leg IK wiring (omit = ?legik=0, today's behaviour)
 * @param {{x:number,y:number}} [cam] camera (driver LOD)
 * @param {ReturnType<import('./beastBlend.js').createBeastBlend>} [blend] ANIM-BLEND-03: clip blender (omit = ?animblend=0, today's behaviour)
 * @param {ReturnType<import('./beastLook.js').createBeastLook>} [look] ANIM-LOOKAT-01: head look-at at the player (omit = off, today's bytes)
 */
export function presentBeasts(sim, world, overlay, styleIds, anim, legs, cam, blend, look) {
  if (!sim) return;
  for (let i = 0; i < sim.count; i++) {
    const e = sim.entities[i];
    const t = e.transform;
    t.yawDeg = yawFromDelta(sim.fx[i], sim.fy[i]);
    const st = sim.state[i];
    const v = e.components.voxel;
    if (!v) continue; // defensive: beast entities always carry a voxel component in the game

    if (st === STATE_GONE) { v.hidden = true; if (legs) legs.release(i, v); if (blend) blend.release(i, v); if (look) look.release(i, v); continue; } // US-079b: hidden at GONE (voxel-pool skip)
    v.hidden = false;
    // OB-171: when the voxel cap bites, an engaged beast (tier 2) or a hostile one within 25 m (tier 1) never loses its slot to ambient props/fauna.
    v.priority = beastVoxelPriority(st, sim.pAggro ? sim.pAggro[i] : 0, t, cam);

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
    else clip = st === STATE_EAT ? eatClip(v.model) : (STATE_CLIPS[st] || 'idle'); // LIFE-07: 'eat' where voxel_eat_clips.js extends the model
    // ANIM-BLEND-03: a blend model shows hurt as an ADDITIVE hit over its state clip (walk / run / windup keep playing), never the full `hurt` clip
    const blended = blend && blend.has(v) && st !== STATE_DYING && st !== STATE_CORPSE && st !== STATE_SINK;
    if (blended && clip === 'hurt') clip = st === STATE_EAT ? eatClip(v.model) : (STATE_CLIPS[st] || 'idle');
    // BEAST-01 (OB-149): gait follows the measured speed, never the intended state: a wander/chase/return beast that is
    // not actually moving shows idle (STATE_EAT = the clip-mapper's "idle" name, no notice overlay).
    let vst = st;
    if (sim.moving && !sim.moving[i] && (st === STATE_WANDER || st === STATE_CHASE || st === STATE_RETURN)
        && clip !== 'hurt' && clip !== 'flinch') { clip = 'idle'; vst = STATE_EAT; }
    if (v.model !== 'wolf') clip = beastClipsClip(v.model, clip, st, sim.fleeing && sim.fleeing[i], sim.moving ? !!sim.moving[i] : undefined); // CLIP-WIRE
    if (v.model === 'wolf') clip = wolfClip(clip, vst, sim.fleeing[i]); // WOLF-D1: wolfFx.clipFor names
    if (v.model === 'crocodile' && clip !== 'hurt' && clip !== 'die' && clip !== 'dead' && clip !== 'sink') { // BEAST-09a: water-slot states (waterBrain ST_*) -> crocFx.clipFor.state
      const cf = globalThis.ASSETS && globalThis.ASSETS.crocFx, nm = CROC_STATE_NAME[st];
      if (nm) clip = (cf && cf.clipFor.state[nm]) || CROC_STATE_FALLBACK[nm];
    }
    if (v.model === 'bearBlack' && st === STATE_BITE) { // BEAR-BITE: blackBearFx.clipFor.state.bite -> attack
      const bf = globalThis.ASSETS && globalThis.ASSETS.blackBearFx; clip = (bf && bf.clipFor.state.bite) || 'attack';
    }
    if (v.model === 'bearBlack' && st === STATE_RECOVER && clip !== 'hurt' && clip !== 'flinch') { // ANIM-BLEND-02b: blackBearFx.clipFor.state.recover
      const bf = globalThis.ASSETS && globalThis.ASSETS.blackBearFx; clip = (bf && bf.clipFor.state.recover) || clip; // bite/lunge: no such sim state yet
    }

    if (v.model === 'goblin' || v.model === 'goblinTorch') { // GOB-07a: goblinFx.clipFor (death / sink / dead stay as decided)
      if (st !== STATE_DYING && st !== STATE_CORPSE && st !== STATE_SINK) clip = goblinClip(clip, vst, i, sim, v);
      v.speed = v.model === 'goblinTorch' && (clip === 'carryTorch') && (st === STATE_CHASE || sim.fleeing && sim.fleeing[i] && st === STATE_RETURN) ? 1.6 : 1;
    }
    let riseMs = 0;
    if ((v.model === 'skeleton' || v.model === 'skeletonArcher') && st !== STATE_DYING && st !== STATE_CORPSE && st !== STATE_SINK) { // UNDER-01
      clip = skeletonClip(clip, vst, v.model === 'skeletonArcher');
      if (sim.riseMs && sim.riseMs[i] > 0) { riseMs = sim.riseMs[i]; clip = 'rise'; playing = false; }
    }
    if (blend && !blended) blend.release(i, v); // dying / corpse / sink / no blend block: today's manual clips
    if (!blended && clip !== v.anim) { v.anim = clip; v.frame = 0; v.t = 0; v.loop = undefined; }
    if (anim) { v.blendFrom = anim.prevClip[i]; v.blendW = anim.w[i]; } // cross-fade data; renderer does not consume it yet

    if (playing) {
      v.playing = true;
    } else if (riseMs > 0) {
      frameTFromElapsed(RISE_TOTAL_MS - riseMs, RISE_DURATIONS, v);
      v.playing = false;
    } else {
      const steps = (st === STATE_DYING) ? sim.cfgSteps.die : sim.cfgSteps.sink;
      const elapsed = (steps - sim.timer[i]) * STEP_MS;
      frameTFromElapsed(elapsed, (st === STATE_DYING) ? DIE_DURATIONS : SINK_DURATIONS, v);
      v.playing = false;
    }

    if (blended) blend.step(i, sim, e, v, clip, legs); // ANIM-BLEND-03: BEFORE legs.step (blender.update, then driver.update; sets v.animLayers, v.anim = dominant clip)

    if (look) { // ANIM-LOOKAT-01: head follows the player while aware; dead beasts release (record off)
      if (st === STATE_DYING || st === STATE_CORPSE || st === STATE_SINK) look.release(i, v); else look.step(i, sim, e, v);
    }

    if (legs) { // ANIM-C-05: leg driver (bear/black bear; models without a legRig stay inert); gait clip time from the phase
      if (st === STATE_DYING || st === STATE_CORPSE || st === STATE_SINK) legs.release(i, v);
      else legs.step(i, e, v, cam ? cam.x : 0, cam ? cam.y : 0, world && world.terrain);
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
