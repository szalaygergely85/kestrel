// game/js/quest/lantern.js (US-012, D-006/D-008, D-011 reskin: the
// *Kestrel*'s brass lamp). The real body of `lantern.take`, named by
// `design/levels/tower.js`'s `interactables` entry `{ id: 'lantern', prop:
// 'lantern', interact: 'lantern.take', once: true }`. No literal coordinate
// here (US-010 tech note 1 rule) - the light is carried on the player, not
// placed by position.
//
// Tech notes (architect, 2026-09-23), docs/backlog.md US-012 item 2:
// `ctx.actor` (the player) gets the carried light component - US-006's
// `LightSet.syncEntityLights` picks up any entity with `components.light`
// and moves its slot every frame via `attachedLightPos`
// (engine/entities/attach.js). `ctx.entity` (the lamp prop, `world.get(
// '<struct>.lantern')`) gets its sprite swapped to the US-011 empty-bracket
// variant - hook stays, lamp gone. The pickup is also recorded as this
// quest's own state key, separate from the engine's `once` used-flag (7.4
// "used flags" note): `used.<struct>.lantern` is "don't offer this prompt
// again"; `tower.lantern.taken` is the fact US-022's `beacon` interactable
// (`requires`) and the "no drop action, the light stays for the rest of the
// run" rule read.
//
// OWN-REQ-006 (PC-B programmer, 2026-09-25): the lamp now hangs LIT by
// default (design/levels/tower.js `lights.lanternHook`, `props.lampFlame`),
// so `lantern.take` also has to turn the hook light OFF and remove the flame
// prop, in the same interaction as the carried light coming ON - never a
// frame with both lit, never a frame with neither. The carried-light and
// flame-removal halves are true "in this one call" (`actor.setComponent`
// and `world.removeEntity` both take effect immediately, read by
// `syncEntityLights`/`pool.collect` the same render as everything else this
// step). The hook light itself is a STRUCTURE light (`level.def.lights`),
// resolved at runtime against the live `LightSet` - `fireInteraction`'s ctx
// (`engine/world/interaction.js`) never carries that (same reason
// `beacon.js`'s `beaconLight` doesn't turn its own light on directly), so
// this only records which key to switch off; `stepLantern` below (called
// from main.js's fixed step right after `updateInteraction`, the same slot
// `stepBeacon` uses) does the actual `lights.setOn(handle, false)` - same
// fixed step, so it still lands in the SAME rendered frame as the carried
// light turning on and the flame prop disappearing.
export function lanternTake(ctx) {
  const { world, entity, actor, def } = ctx;

  if (actor) {
    actor.setComponent('light', {
      preset: 'lantern',
      on: true,
      attach: 'eye',
      offset: { right: 0.3, down: 0.3, fwd: 0.4 },
      sway: { amp: 0.02 },
    });
  }

  // US-011 (7.5 item 2): the clip player, not a raw setComponent - `variant`
  // is still written (readability / older callers), but `sprite.anim`/
  // `voxel.anim` is what the engine actually renders (`entity.play`).
  // US-041a (15.3 item 1): `sprite ?? voxel` - `design/models/voxel_props.js`'s
  // `attach()` already puts `.voxel` on the live `lantern` model (its
  // materials are merged), so this prop may spawn as either component;
  // writing `variant` onto a hard-coded `.sprite` key would create a SECOND
  // component on a voxel-bound entity (never both, World.spawn's own rule).
  if (entity) {
    entity.play('empty');
    const compName = entity.getComponent && entity.getComponent('voxel') ? 'voxel' : 'sprite';
    const comp = (entity.getComponent && entity.getComponent(compName)) || {};
    entity.setComponent(compName, { ...comp, variant: 'empty' });
  }

  // OWN-REQ-006: remove the flame prop (if this level names one via
  // `def.flameProp`, `design/levels/tower.js`'s `flameProp: 'lampFlame'`) and
  // queue the hook light's key for `stepLantern` to switch off - both
  // resolved against the SAME structId the lamp prop itself belongs to
  // (`entity.id` is always `${structId}.${def.prop}`, `World.spawn`'s own
  // convention, same derivation `beacon.js` uses), never a hard-coded level id.
  if (entity && def && def.prop && entity.id && entity.id.length > def.prop.length) {
    const structId = entity.id.slice(0, entity.id.length - def.prop.length - 1);
    if (def.flameProp) world.remove(`${structId}.${def.flameProp}`);
    if (def.light) world.state['tower.lantern.hookLightOff'] = `${structId}.${def.light}`;
  }

  world.state['tower.lantern.taken'] = true;
  return true;
}

/**
 * Per fixed step (main.js, right after `updateInteraction`, the same slot
 * `stepBeacon` uses): a cheap no-op (`typeof`-shaped check) every step before
 * `lantern.take` fires and every step after it has done its one-shot job.
 * Unlike `stepBeacon` there is no ramp - the hook light just needs to go off
 * the instant the lamp is taken, so this only ever runs its body once per
 * pickup. `lights` may be null (`?lights=0` or before the first
 * `buildLightSet`) - then the switch is simply skipped, same as `stepBeacon`.
 * @param {import('../../../engine/index.js').World} world
 * @param {import('../../../engine/render/lighting.js').LightSet|null} lights
 */
export function stepLantern(world, lights) {
  const key = world.state['tower.lantern.hookLightOff'];
  if (!key) return;
  if (lights) {
    const h = lights.key.indexOf(key);
    if (h >= 0) lights.setOn(h, false);
  }
  world.state['tower.lantern.hookLightOff'] = null;
}
