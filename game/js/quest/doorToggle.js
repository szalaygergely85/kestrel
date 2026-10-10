// DOOR-TOGGLE-01 `door.toggle` (tower interactable "door"): E opens/closes the ground-floor south-west door any time (no sword,
// no bar; the bar stays stowed). State = world.state['tower.door.open'] (saved). The collider follows the prop variant: variant
// 'closed' keeps the box collider, variant 'open' drops it (props.doorBar `colliderOffVariant: 'open'`); World.rebuildPropColliders
// rebuilds the static prop BVH. `applyDoorState` re-syncs prop + prompt on every 'world:loaded' (save load / restart).
export const DOOR_KEY = 'tower.door.open';
const PROP = 'doorBar';
const HALF_X = 0.5 + 0.35, Y0 = -0.35, Y1 = 0.4 + 0.35; // closing is refused while the player stands in the doorway (box + radius)

function doorEntities(world) {
  const out = [];
  for (const s of world.structures || []) {
    const e = world.get(`${s.id}.${PROP}`);
    if (e && world.get(`${s.id}.${PROP}`).getComponent('voxel')) out.push({ s, e });
  }
  return out;
}

function setVariant(e, variant) {
  const c = e.getComponent('voxel');
  e.setComponent('voxel', { ...c, variant });
}

function setPrompts(world, open) {
  for (const r of world.interactables || []) {
    if (r.name === 'door.toggle') r.prompt = open ? (r.def.closePrompt || '[E] Close') : (r.def.openPrompt || '[E] Open');
  }
}

function playerInDoorway(world, e) {
  const p = world.get('player');
  const pt = p && (p.transform || (p.data && p.data.transform));
  if (!pt) return false;
  const t = e.data ? e.data.transform : e.transform;
  const dx = Math.abs(pt.x - t.x), dy = pt.y - t.y, dz = pt.z - t.z;
  return dx < HALF_X && dy > Y0 && dy < Y1 && dz > -1.7 && dz < 2.4;
}

/** `door.toggle` behaviour body. Returns true when the door changed. */
export function doorToggle(ctx) {
  const { world } = ctx;
  const doors = doorEntities(world);
  if (!doors.length) return false;
  const open = !!world.state[DOOR_KEY];
  if (open && doors.some((d) => playerInDoorway(world, d.e))) return false; // never close the door on the player
  for (const { e } of doors) {
    e.play(open ? 'closing' : 'opening', { restart: true });
    setVariant(e, open ? 'closed' : 'open');
  }
  world.state[DOOR_KEY] = !open;
  if (world.rebuildPropColliders) world.rebuildPropColliders();
  setPrompts(world, !open);
  return true;
}

/** 'world:loaded': make the prop (variant, pose, collider) and the prompt match the saved state. */
export function applyDoorState(world) {
  if (!world) return;
  const open = !!world.state[DOOR_KEY], doors = doorEntities(world);
  for (const { e } of doors) {
    const c = e.getComponent('voxel');
    const want = open ? 'open' : 'closed';
    if (c.variant !== want) setVariant(e, want);
    if (c.anim !== want || !c.playing) e.play(want, { restart: true });
  }
  if (doors.length && world.rebuildPropColliders) world.rebuildPropColliders();
  setPrompts(world, open);
}
