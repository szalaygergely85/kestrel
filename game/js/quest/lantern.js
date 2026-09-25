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
export function lanternTake(ctx) {
  const { world, entity, actor } = ctx;

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

  world.state['tower.lantern.taken'] = true;
  return true;
}
