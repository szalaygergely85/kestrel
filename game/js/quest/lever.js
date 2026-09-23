// game/js/quest/lever.js (US-014, D-006/D-008). The real body of the
// `lever.pull` behaviour named by design/levels/tower.js's `interactables`
// entry `{ id: 'lever', interact: 'lever.pull', once: true, target: { tag:
// 'grate' } }`. No literal coordinates here (US-010 tech note 1 rule) - the
// target sector is found by tag, through `world.animateSectorTo`.
//
// Tech notes (architect, 2026-09-23), docs/backlog.md US-014 item 3:
// `ctx.entity.play('pull')` plays the 5-frame / 0.4 s US-011 lever clip
// (which also drives the hub gear, D-011 reskin), `world.animateSectorTo`
// starts the grate's ceiling tween after that 0.4 s delay, and
// `world.state['tower.lever.pulled'] = true` is this quest's own record of
// the beat (separate from `structure.dynamics`, which is the ENGINE's truth
// for the grate itself - 7.4 "used flags" note). Returning `true` lets the
// generic `once` handling (updateInteraction, US-012) hide the prompt for
// good; the stub it replaces returned `false`, so it never consumed.
export function leverPull(ctx) {
  const { world, def, entity } = ctx;
  if (entity) entity.play('pull');

  const tag = def && def.target && def.target.tag;
  if (tag) world.animateSectorTo(tag, 1, { delay: 0.4 });

  world.state['tower.lever.pulled'] = true;
  return true;
}
