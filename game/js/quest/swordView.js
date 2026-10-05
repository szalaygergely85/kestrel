// game/js/quest/swordView.js (US-078d, docs/architecture.md 30.1 + the amendment's "View" paragraph).
// Presentation only - picks the view-model clip for the sword sim's current state, sets the walk-bob amount, and
// draws the swing trail (engine.viewModel's `mountEye` + `eyeToWorld`, both pure, sampled at several past tMs -
// no history buffer needed here) and the sim's 4-slot spark ring via `engine.overlay`'s existing primitives
// (`segment`, `bar`, `rect` - no engine change, per the story's "Do not" list). Not under `sim/**` (rule 15 only
// binds `game/js/quest/sim/**`): trig and a continuous `simTime` are fine here.
//
// Deviation (flagged in the programmer report): the designer's `sparks.hit/hitHeavy` data (design/models/sword.js)
// is a multi-row glyph-grid burst (several cells, several frames) - `engine.overlay` only exposes `ring`/`bar`/
// `rect`/`segment`, no "paint an arbitrary glyph grid at a world point" primitive. This file approximates each
// spark with `overlay.bar` (clink: `overlay.rect`'s 1-cell form via a 0-width bar), not the full burst grid - a
// new overlay primitive (or a particle burst, EP-ELEMENTS) would be needed for the exact art; out of scope here
// (no engine change allowed by this story).
import {
  ST_IDLE, ST_HOLD, ST_CHARGE, ST_LIGHT, ST_HARD, ST_REST, SPARK_CLINK, SPARK_HIT, SPARK_HIT_HEAVY,
} from './sim/sword.js';

const STEP_MS = 1000 / 60;

// Module-scoped scratch (avoid per-frame allocation in the render path).
const _a = new Float64Array(3), _b = new Float64Array(3);
const _pw = new Float64Array(3);
const _gm = new Float64Array(3), _gt = new Float64Array(3);
const _gmW = new Float64Array(3), _gtW = new Float64Array(3);

/**
 * @typedef {Object} SwordVmHandle   resolved once at load (main.js boot)
 * @property {any} vm   engine.viewModel
 * @property {number} h   `vm.load('sword', ...)`'s handle
 * @property {{idle:number, charge:number, swingLR:number, swingHard:number}} clip   `vm.clipId(h, name)` per clip
 * @property {{tip:number, mid:number}} mount   `vm.mountId(h, name)` per mount
 * @property {{light:{samples:number,stepMs:number}, hard:{samples:number,stepMs:number}}} trail   from
 *   `ASSETS.viewModels.sword.trail`/`trailHard` (samples/stepMs only - glyph/colour picking is the overlay style's job)
 * @property {{light:{windup:number,active:number}, hard:{windup:number,active:number}}} windows   SWORD_CFG's
 *   light/hard windup+active step counts (so the trail only draws during the active window)
 */

/**
 * @param {ReturnType<typeof import('./sim/sword.js').createSwordSim>} sim
 * @param {SwordVmHandle} vmh
 * @param {any} overlay engine.overlay
 * @param {any} cam render camera `{x,y,z,yawDeg,pitchDeg}`
 * @param {{trail0:number, trail1:number, trail2:number, trailHead:number, ghost:number, sparkHit:number,
 *   sparkHitEmpty:number, sparkHeavy:number, sparkHeavyEmpty:number, sparkClink:number}} ids resolved style ids
 * @param {number} simTime seconds, continuous - idle breathing only (never read inside sim/**)
 * @param {number} bobPhase the eyeFeel walk-bob phase (same one the body/camera bob uses)
 * @param {boolean} moving player is moving this frame (walk-bob amount while idle)
 */
export function presentSword(sim, vmh, overlay, cam, ids, simTime, bobPhase, moving) {
  if (!vmh) return;
  const { vm, h, clip } = vmh;
  if (!sim || sim.state === undefined) { if (vm) vm.hide(h); return; }

  if (sim.justEntered && sim.blend) vm.capture(h);
  let clipId, tMs, bobAmount;
  switch (sim.state) {
    case ST_HOLD:
    case ST_CHARGE:
      clipId = clip.charge; tMs = Math.min(sim.holdSteps * STEP_MS, 400); bobAmount = 0.2; break;
    case ST_LIGHT:
      clipId = clip.swingLR; tMs = sim.stateStep * STEP_MS; bobAmount = 0.4; break;
    case ST_HARD:
      clipId = clip.swingHard; tMs = sim.stateStep * STEP_MS; bobAmount = 0.2; break;
    case ST_REST:
    case ST_IDLE:
    default:
      clipId = clip.idle; tMs = simTime * 1000; bobAmount = moving ? 1 : 0; break;
  }

  const blendNow = sim.blend && (sim.state === ST_LIGHT || sim.state === ST_HARD);
  vm.show(h, clipId, tMs, blendNow);
  vm.setBob(bobPhase, bobAmount, h);

  drawTrail(sim, vmh, cam, tMs, ids, overlay);
  drawSparks(sim, overlay, ids);
}

function drawTrail(sim, vmh, cam, tMs, ids, overlay) {
  const { vm, h, clip, mount, trail, windows } = vmh;
  let clipId, cfgT, win;
  if (sim.state === ST_LIGHT) { clipId = clip.swingLR; cfgT = trail.light; win = windows.light; }
  else if (sim.state === ST_HARD) { clipId = clip.swingHard; cfgT = trail.hard; win = windows.hard; }
  else return;
  const activeStart = win.windup, activeEnd = win.windup + win.active - 1;
  if (sim.stateStep < activeStart || sim.stateStep > activeEnd) return;

  let havePrev = false;
  for (let s = 0; s < cfgT.samples; s++) {
    const t = Math.max(activeStart * STEP_MS, tMs - s * cfgT.stepMs);
    vm.mountEye(h, clipId, t, mount.tip, _a);
    vm.eyeToWorld(cam, _a, _b);
    if (havePrev) {
      const style = s <= 1 ? ids.trailHead : (s <= cfgT.samples / 3 ? ids.trail0 : (s <= (2 * cfgT.samples) / 3 ? ids.trail1 : ids.trail2));
      overlay.segment(_pw[0], _pw[1], _pw[2], _b[0], _b[1], _b[2], style);
    }
    _pw[0] = _b[0]; _pw[1] = _b[1]; _pw[2] = _b[2];
    havePrev = true;
  }

  // Ghost: blade line mid -> tip at -50 ms.
  const gt = Math.max(activeStart * STEP_MS, tMs - 50);
  vm.mountEye(h, clipId, gt, mount.mid, _gm);
  vm.mountEye(h, clipId, gt, mount.tip, _gt);
  vm.eyeToWorld(cam, _gm, _gmW);
  vm.eyeToWorld(cam, _gt, _gtW);
  overlay.segment(_gmW[0], _gmW[1], _gmW[2], _gtW[0], _gtW[1], _gtW[2], ids.ghost);
}

function drawSparks(sim, overlay, ids) {
  const r = sim.sparks;
  for (let i = 0; i < r.size; i++) {
    const ageSteps = r.age[i];
    if (ageSteps >= r.AGE_NONE) continue;
    const ageMs = ageSteps * STEP_MS;
    const x = r.x[i], y = r.y[i], z = r.z[i];
    switch (r.kind[i]) {
      case SPARK_CLINK:
        if (ageMs <= 100) overlay.bar(x, y, z, 1, 1, ids.sparkClink, ids.sparkClink); // 1 world-space cell
        break;
      case SPARK_HIT:
        if (ageMs <= 50) overlay.bar(x, y, z, 1, 1, ids.sparkHit, ids.sparkHitEmpty);
        else if (ageMs <= 100) overlay.bar(x, y, z, 1, 3, ids.sparkHit, ids.sparkHitEmpty);
        break;
      case SPARK_HIT_HEAVY:
        if (ageMs <= 140) overlay.bar(x, y, z, 1, 5, ids.sparkHeavy, ids.sparkHeavyEmpty);
        break;
      default: break;
    }
  }
}
