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

  if (entity) {
    const sprite = (entity.getComponent && entity.getComponent('sprite')) || {};
    entity.setComponent('sprite', { ...sprite, variant: 'empty' });
  }

  world.state['tower.lantern.taken'] = true;
  return true;
}
