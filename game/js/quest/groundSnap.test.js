// OB-155 runtime: floorZ uses the mesh/structure floor, createResnap re-seats late-streamed ground, marks keep their offset.
import { floorZ, createResnap, nearStamp, createNpcSeat } from './groundSnap.js';
import { spawnLeftoverDrop, resetPickups } from './sim/pickups.js';
import { markZ, MARK_MARGIN } from './markTop.js';
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.error('FAIL', m); } };

// bridge at z 6 over a river bed at 2; supportAt returns the highest surface at or below footZ
const mk = (nearReady, groundZ) => ({
  terrain: { nearReady, near: nearReady ? { version: 1 } : null, groundAt: () => groundZ },
  colliders: [1], supportAt: (x, y, footZ) => ({ floorH: x > 10 && footZ >= 6 ? 6 : groundZ }),
  floorAt: () => groundZ,
});
const w = mk(true, 2);
ok(Math.abs(floorZ(w, 12, 0, 6.2) - 6) <= 0.3, 'drop on bridge deck sits on it');
ok(floorZ(w, 0, 0, 2.2) === 2, 'terrain floor elsewhere');
ok(floorZ({ terrain: null }, 0, 0) === null, 'nothing known -> null');

// leftover drop on the bridge
const drops = []; const world = { entity: () => null, spawn: (t, tr, c, id) => { drops.push({ tr, c, id }); } };
resetPickups();
const wid = world; world.entity = (id) => { const d = drops.find((q) => q.id === id); return d ? { components: d.c, transform: d.tr } : null; };
spawnLeftoverDrop(world, 'x', 2, 20, 0, 6.1, true, (x, y) => floorZ(w, x, y, 6.1));
ok(drops.length === 1 && Math.abs(drops[0].c.pickup.baseZ - 6) <= 0.3, 'leftover on bridge keeps deck z, got ' + (drops[0] && drops[0].c.pickup.baseZ));

// late near terrain: world starts with analytic ground 1.0, near band arrives with 1.6
const lw = { terrain: { nearReady: false, near: null, g: 1.0, groundAt() { return this.g; } }, floorAt() { return this.terrain.g; } };
const e = { transform: { x: 0, y: 0, z: 1.3 } };
const rs = createResnap(lw); rs.track(() => e.transform, (z) => { e.transform.z = z; });
ok(rs.step() === 0, 'no change before near');
lw.terrain.g = 1.6; lw.terrain.nearReady = true; lw.terrain.near = { version: 1 };
ok(nearStamp(lw) === 1 && rs.step() === 1, 're-snap runs when near arrives');
ok(Math.abs(e.transform.z - 1.9) < 1e-9, 'offset 0.3 above floor kept, z=' + e.transform.z);
ok(rs.step() === 0, 'idempotent');
const hi = { transform: { x: 0, y: 0, z: 9 } }; // deliberate height (shelf/tree) is left alone
const rs2 = createResnap({ ...lw, terrain: { ...lw.terrain, nearReady: false, near: null } });
ok(rs2.size === 0 && hi.transform.z === 9, 'sanity');

// marker keeps fixed offset above the giver head
const t = { z: 5 }; ok(Math.abs(markZ(t, 1.8) - (5 + 1.8 + MARK_MARGIN)) < 1e-9, 'mark offset');
t.z = 5.6; ok(Math.abs(markZ(t, 1.8) - (5.6 + 1.8 + MARK_MARGIN)) < 1e-9, 'mark follows re-snapped giver');

// OB-155 follow-up: NPC seat (late near, structure floor, stale saved z, deliberate height)
{
  const ents = { a: { x: 0, y: 0, z: 1.3 }, tower: { x: 12, y: 0, z: 6 }, stale: { x: 0, y: 0, z: 2.4 }, tree: { x: 0, y: 0, z: 9 } };
  const colls = [];
  const sw = { terrain: { nearReady: false, near: null, g: 1.0, groundAt() { return this.g; } }, floorAt() { return this.terrain.g; },
    colliders: [1], supportAt: (x, y, footZ) => ({ floorH: x > 10 && footZ >= 6 ? 6 : sw.terrain.g }),
    get: (id) => (ents[id] ? { data: { transform: ents[id], components: { collider: { kinematic: true } } } } : null),
    setEntityCollider: (id, x, y, z) => colls.push([id, z]), interactables: [{ key: 'npc.a', z: 2.3 }] };
  const seat = createNpcSeat(sw);
  for (const id of ['a', 'tower', 'stale', 'tree']) seat.add(id);
  ok(Math.abs(ents.a.z - 1.0) < 1e-9, 'NPC offset kept? snapped to floor before near, z=' + ents.a.z);
  ok(ents.tower.z === 6, 'NPC on a tower floor stays on it, z=' + ents.tower.z);
  ok(Math.abs(ents.stale.z - 1.0) < 1e-9, 'stale saved z -> floor, z=' + ents.stale.z);
  ok(ents.tree.z === 9, 'deliberate height untouched');
  sw.terrain.g = 1.6; sw.terrain.nearReady = true; sw.terrain.near = { version: 1 };
  ok(seat.step() === 2, 'near arrival re-seats');
  ok(Math.abs(ents.a.z - 1.6) < 1e-9 && Math.abs(ents.stale.z - 1.6) < 1e-9, 'NPC on arrived near terrain, z=' + ents.a.z);
  ok(ents.tower.z === 6, 'tower NPC still on the tower');
  ok(ents.tree.z === 9, 'tree NPC still up');
  ok(colls.length > 0 && Math.abs(sw.interactables[0].z - 2.6) < 1e-9, 'collider + talk record follow');
}
console.log(fail ? 'groundSnap FAIL ' + fail : 'groundSnap ok');
process.exit(fail ? 1 : 0);
