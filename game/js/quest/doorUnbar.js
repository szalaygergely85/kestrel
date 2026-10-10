// CH1-D1a `door.unbar` (tower interactable "door", requires tower.sword.taken): pries the bar off the ground-floor
// south-west door. Plays the doorBar `open` clip (variant 'open'), drops the prop collider (props.doorBar
// `colliderOffVariant: 'open'`) by rebuilding the static prop BVH, and sets `tower.door.open`. Minimal body: the
// `unbar` clip / thud sound / toast.door.open text belong to the CH1-02/WRITER follow-up.
export function doorUnbar(ctx) {
  const { world, entity } = ctx;
  if (!entity) return false;
  entity.play('open');
  const compName = entity.getComponent('voxel') ? 'voxel' : 'sprite';
  entity.setComponent(compName, { ...entity.getComponent(compName), variant: 'open' });
  if (world.rebuildPropColliders) world.rebuildPropColliders();
  world.state['tower.door.open'] = true;
  return true;
}
