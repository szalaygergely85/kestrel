// ANIM-STATE-WIRE-01 (US-083 slice): adapter from the beast sim state to engine/entities/animState.js named clip states
// (idle / walk / windup / attack / hurt / die) with the 80 ms cross-fade weight. View side only: reads sim arrays,
// never writes the sim. Zero per-frame allocation (one animState per slot, built once; no literals/closures per call).
//
// Boar voxel clips (design/models/voxel_beast.js): idle walk windup charge hurt flinch die dead sink. There is no
// `attack` clip -> attack uses `charge`; chase also uses `charge` (today's gallop, boarFx.clipFor); hurt uses `hurt`
// for the first HURT_STEPS then `flinch` (nearest: the follow-through); dead/sink states are driven by beastView.
import { createAnimState, animBlend, ANIM_PRIORITY as P } from '../../../engine/index.js';
import { STATE_WANDER, STATE_CHASE, STATE_RETURN } from './sim/beastSim.js';

export const HURT_STEPS = 10;
const BIG = 1e9;
// Durations are nominal: the sim owns the timeline and the adapter releases a state when the sim leaves it.
export const BEAST_ANIM_DEF = {
  states: {
    idle: { clip: 'idle', frames: 1, frameMs: 1000, loop: true },
    walk: { clip: 'walk', frames: 1, frameMs: 1000, loop: true },
    windup: { clip: 'windup', frames: 1, frameMs: 500 },
    attack: { clip: 'charge', frames: 1, frameMs: 1200 },
    hurt: { clip: 'hurt', frames: 1, frameMs: 250 },
    die: { clip: 'die', frames: 1, frameMs: 400 },
  },
};

// Sim state (0..12) -> desired anim state. Dead states >= DYING all map to 'die' (view picks die/dead/sink).
const DESIRED = ['idle', 'idle', 'walk', 'windup', 'attack', 'idle', 'idle', 'hurt', 'hurt', 'die', 'die', 'die', 'die'];

export function createBeastAnim(maxSlots) {
  const anims = [];
  const clip = new Array(maxSlots).fill('idle');
  const prevClip = new Array(maxSlots).fill('idle');
  const lastName = new Array(maxSlots).fill('idle');
  const w = new Float64Array(maxSlots); // cross-fade weights: read api.w[i] (a double returned from a call would be boxed)
  for (let i = 0; i < maxSlots; i++) anims.push(createAnimState(BEAST_ANIM_DEF));
  const api = {
    anims, clip, prevClip, w,
    /** Advance slot i from the sim; returns the clip name to play (alive states). */
    update(sim, i, dtMs) {
      const a = anims[i];
      const st = sim.state[i];
      let want = DESIRED[st] || 'idle';
      if (want !== 'die' && sim.hurtT[i] < HURT_STEPS) want = 'hurt';
      if (want === 'idle' && st === STATE_WANDER && sim.timer[i] === -1) want = 'walk';
      if (want === 'idle' && st === STATE_RETURN) want = 'walk';
      if (want !== a.name) {
        // lower priority than the held state: release it (non-loop states finish into the base state)
        if (!a.dead && a.name !== 'idle' && a.name !== 'walk' && P[want] < P[a.name]) a.update(BIG, null);
        a.request(want);
      }
      a.update(dtMs, null);
      if (a.name !== lastName[i]) { prevClip[i] = clip[i]; lastName[i] = a.name; }
      let c = BEAST_ANIM_DEF.states[a.name].clip;
      if (a.name === 'walk' && st === STATE_CHASE) c = 'charge'; // today's chase gallop
      else if (a.name === 'hurt' && sim.hurtT[i] >= HURT_STEPS) c = 'flinch';
      clip[i] = c;
      w[i] = animBlend(a.sinceSwitchMs);
      return c;
    },
    /** Cross-fade weight (0..1) of the current clip over prevClip[i]; hot paths read api.w[i] (no boxing). */
    weight(i) { return w[i]; },
  };
  return api;
}

