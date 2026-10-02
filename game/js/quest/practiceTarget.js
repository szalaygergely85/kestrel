// game/js/quest/practiceTarget.js (US-078d, docs/architecture.md 30.1; design/models/m3_props.js's
// `voxelModels.practiceTarget.voxel.animations.onHit`: `{ clip: 'flash', steps: 6, then: 'wobble', thenSteps: 32,
// rest: 'idle' }`). Listener on `combat:hit`: the old sword pell flashes white for `cfg.flash` (6) steps, then
// wobbles back for 32 steps (the model's own follow-through clip), then rests at `idle`. A hit during `wobble`
// restarts `flash`. Never destroyed (a practice post has no HP) - this file only drives the voxel clip.
//
// Entity id match: `World.spawn`'s own convention is `id = '${structId}.${propId}'` (same idiom `swordTake.js`'s
// `removeSwordIfTaken`/`lantern.js`/`beacon.js` already use for their own fixed prop id) - so any hit whose
// `target` ends in `.practiceTarget` is this prop, regardless of which structure placed it.

const SUFFIX = '.practiceTarget';

/**
 * @param {any} world engine World (`get(id)`)
 * @param {any} events engine.events (Events instance) - listens `combat:hit`
 * @param {{flash:number}} cfg `SWORD_CFG` (only `flash` is read; `wobble`'s 32 steps is the model's own data, not
 *   duplicated into swordConfig.js - this file is the one place that reads `onHit.thenSteps`)
 */
export function createPracticeTarget(world, events, cfg) {
  const WOBBLE_STEPS = 32; // design/models/m3_props.js `onHit.thenSteps`
  /** @type {Map<string, {phase:'flash'|'wobble', left:number}>} at most a couple of live targets in a level */
  const timers = new Map();

  function onHit(p) {
    if (!p || typeof p.target !== 'string' || !p.target.endsWith(SUFFIX)) return;
    const handle = world.get(p.target);
    if (!handle) return;
    handle.play('flash');
    timers.set(p.target, { phase: 'flash', left: cfg.flash });
  }
  const off = events.on('combat:hit', onHit);

  /** Per fixed step (main.js: alongside stepLantern/stepBeacon's slot) - cheap no-op while no target is mid-clip. */
  function step() {
    if (timers.size === 0) return;
    for (const [id, t] of timers) {
      t.left--;
      if (t.left > 0) continue;
      const handle = world.get(id);
      if (t.phase === 'flash') {
        if (handle) handle.play('wobble');
        timers.set(id, { phase: 'wobble', left: WOBBLE_STEPS });
      } else {
        if (handle) handle.play('idle');
        timers.delete(id);
      }
    }
  }

  return { step, dispose: () => off() };
}
