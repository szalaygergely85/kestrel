// game/js/quest/spellHandView.js (HANDS-01c + SPELL-01b, architecture.md 37.8a / 37.14 + D-042 item 1).
// The spell hand as a view-model handle (second handle next to the sword). Presentation only: shown whenever the spell
// item is in a hand (`hands.handOf(ITEM) !== null`), on that hand's side via `vm.setHand` (authored LEFT; the engine
// mirrors it for the right hand - never mirror data), hidden otherwise.
// SPELL-01b: with a fireball sim it also plays the designer clips: idle / charge (holdSteps 0..36) / chargeHold (ready,
// held) / cast or castHard (after a release that spent mana) / fizzle (released, nothing cast), and returns the coal
// glow multiplier (`def.glow`) for the carried `spellEmber` light. No allocation per frame.
import { FB_IDLE, FB_CHARGE } from './sim/fireball.js';

export const SPELL_HAND_ITEM = 'spell.fireball';

const STEP_MS = 1000 / 60;
const K_IDLE = 0, K_CHARGE = 1, K_HOLD = 2, K_CAST = 3, K_HARD = 4, K_FIZZLE = 5;

/**
 * Resolves the handle once (boot). `def` = `ASSETS.viewModels.spellHand`; its model `spellHandL` must be in `pool`.
 */
export function loadSpellHandView(vm, def, pool) {
  const h = vm.load('spellHand', def, pool);
  vm.setHand(h, 'left'); // authored hand = no mirror until the router says otherwise
  vm.hide(h);
  const c = (n) => vm.clipId(h, n);
  const dur = (n) => { const k = def.clips[n].keys; return k[k.length - 1].t; };
  return {
    vm, h, def,
    clip: { idle: c('idle'), charge: c('charge'), chargeHold: c('chargeHold'), cast: c('cast'), castHard: c('castHard'), fizzle: c('fizzle') },
    dur: { cast: dur('cast'), castHard: dur('castHard'), fizzle: dur('fizzle') },
    kind: K_IDLE, prevState: FB_IDLE, prevCastTick: -1, fizzleTick: -1e9, glow: 1,
  };
}

/** Linear sample of `[[t, mul], ...]` (clamped), no allocation. */
function sampleKeys(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) { const a = keys[i - 1], b = keys[i]; return a[1] + (b[1] - a[1]) * ((t - a[0]) / (b[0] - a[0])); }
  }
  return keys[keys.length - 1][1];
}

/**
 * Per frame. `hand` = `hands.handOf('spell.fireball')` ('left' | 'right' | null). `sim` = the fireball sim (optional:
 * without it only `idle` plays, the HANDS-01c behaviour).
 * @returns {number} the coal glow multiplier for this frame (1 when idle / hidden)
 */
export function presentSpellHand(vmh, hand, simTime, bobPhase, moving, sim) {
  if (!vmh) return 1;
  const { vm, h, clip } = vmh;
  if (hand !== 'left' && hand !== 'right') { vm.hide(h); vmh.glow = 1; return 1; }
  if (vm.handOf(h) !== hand) vm.setHand(h, hand);
  let kind = K_IDLE, tMs = simTime * 1000, bob = moving ? 1 : 0, cid = clip.idle;
  if (sim) {
    const state = sim.state, tick = sim.tick;
    if (state !== FB_IDLE) {
      if (state === FB_CHARGE) { kind = K_HOLD; cid = clip.chargeHold; tMs = (sim.holdSteps - 36) * STEP_MS; }
      else { kind = K_CHARGE; cid = clip.charge; tMs = Math.min(sim.holdSteps, 36) * STEP_MS; }
      bob = 0.2;
    } else {
      if (vmh.prevState !== FB_IDLE && sim.castTick === vmh.prevCastTick) vmh.fizzleTick = tick; // released, nothing cast
      const castMs = (tick - sim.castTick) * STEP_MS, fizMs = (tick - vmh.fizzleTick) * STEP_MS;
      const hard = sim.lastCharged === 1;
      if (castMs >= 0 && castMs < (hard ? vmh.dur.castHard : vmh.dur.cast)) { kind = hard ? K_HARD : K_CAST; cid = hard ? clip.castHard : clip.cast; tMs = castMs; bob = 0.3; }
      else if (fizMs >= 0 && fizMs < vmh.dur.fizzle) { kind = K_FIZZLE; cid = clip.fizzle; tMs = fizMs; bob = 0.3; }
    }
    vmh.prevState = state; vmh.prevCastTick = sim.castTick;
  }
  const cast = kind === K_CAST || kind === K_HARD;
  if (kind !== vmh.kind) { if (cast) vm.capture(h); vmh.kind = kind; } // chain from the pose last shown
  vm.show(h, cid, tMs, cast);
  vm.setBob(bobPhase, bob, h);

  const g = vmh.def.glow;
  let glow = 1;
  switch (kind) {
    case K_CHARGE: glow = g.charge.from + (g.charge.to - g.charge.from) * Math.min(tMs / 600, 1); break;
    case K_HOLD: glow = g.chargeHold.mul + g.chargeHold.pulse.amp * Math.sin(Math.PI * 2 * g.chargeHold.pulse.hz * tMs / 1000); break;
    case K_CAST: glow = sampleKeys(g.cast.keys, tMs); break;
    case K_HARD: glow = sampleKeys(g.castHard.keys, tMs); break;
    case K_FIZZLE: glow = sampleKeys(g.fizzle.keys, tMs); break;
    default: glow = g.idle.mul;
  }
  vmh.glow = glow;
  return glow;
}
