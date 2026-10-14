// EQ-10: the five real world_m1 chests (anchors from tools/gen-poi-props.mjs) -> createChests defs -> contents.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../../../design/palette.js';
import '../../../../design/items.js';
import { createChests } from './chest.js';
import { buildChestDefs, CHEST_TABLES } from './chestDefs.js';
import { ensureInventory, countOf } from './inventory.js';

const items = globalThis.ASSETS.items.defs;
const world = JSON.parse(readFileSync(new URL('../../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const byId = new Map(world.entities.map((e) => [e.id, e]));
// fake world: entity(id) -> transform; "ground" anchors get z 0 (the real z is resolved at World.load)
const fake = { entity: (id) => { const e = byId.get(id); return e && { transform: { x: e.x, y: e.y, z: typeof e.z === 'number' ? e.z : 0, yawDeg: e.yawDeg || 0 } }; } };

const defs = buildChestDefs(fake);
assert.deepEqual(defs.map((d) => d.id).sort(), Object.keys(CHEST_TABLES).sort(), 'all anchors become chests');
for (const d of defs) {
  assert.equal(byId.get(d.id).components.voxel.model, 'chestSmall', d.id + ' carries the chest model');
  if (!d.id.startsWith('secret')) assert.ok(Math.abs(d.frontY - 1) < 1e-9 && Math.abs(d.frontX) < 1e-9, 'yaw 180 -> front +y');
}

function openAll(seed) {
  const out = {};
  for (const d of defs) {
    const player = { transform: {}, components: {} };
    const inv = ensureInventory(player, { pack: [], left: null, right: null });
    const events = { emit() {} };
    const sim = createChests([d], { items, inventoryOf: () => inv, events, seed });
    const pose = { x: d.x + d.frontX, y: d.y + d.frontY, z: d.z, forwardX: -d.frontX, forwardY: -d.frontY, onBottom: true }; // SWIM-04d: onBottom only matters for chestBed; 1 m in front of the chest, facing it
    if (d.needsBottom) assert.equal(sim.canOpen(d.id, { ...pose, onBottom: false }), false, d.id + ' needs onBottom');
    assert.equal(sim.open(d.id, pose), true, d.id + ' opens');
    sim.step(1);
    assert.equal(sim.stateOf(d.id), 'open');
    out[d.id] = inv.slots.filter((s) => s.id).map((s) => s.id + 'x' + s.n);
  }
  return out;
}
const a = openAll(5), b = openAll(5), c = openAll(6);
assert.deepEqual(a, b, 'deterministic for a seed');
for (const id of ['chestMeadow', 'chestBend', 'chestCrossroads']) assert.deepEqual(a[id], ['heart.piecex1'], id + ' = 1 heart piece');
assert.equal(a.chestRook.length, 2);
assert.ok(a.chestRook.includes('arrowx15'), 'Rook: 15 arrows');
const rookGear = a.chestRook.find((s) => s.startsWith('gear.'));
assert.equal(items[rookGear.replace(/x1$/, '')].equip.tier, 'sturdy', 'Rook: a sturdy gear piece');
assert.equal(a.chestHidden.length, 1);
assert.equal(items[a.chestHidden[0].replace(/x1$/, '')].equip.tier, 'fine', 'hidden: a fine gear piece');
// the slot roll varies with the seed over a few seeds (not a constant)
const slots = new Set();
for (let s = 1; s <= 12; s++) slots.add(items[openAll(s).chestHidden[0].replace(/x1$/, '')].equip.slot);
assert.ok(slots.size > 1, 'hidden chest slot varies with the seed: ' + [...slots]);
// OB-179: merged secrets: secretRook = 16 arrows + a sturdy gear piece; secretOw2 = 12 arrows + a fine gear piece (both guaranteed)
for (let s = 1; s <= 20; s++) {
  const r = openAll(s);
  assert.ok(r.secretRook.includes('arrowx16'), 'secretRook: 16 arrows');
  assert.equal(items[r.secretRook.find((x) => x.startsWith('gear.')).replace(/x1$/, '')].equip.tier, 'sturdy', 'secretRook: sturdy gear');
  assert.ok(r.secretOw2.includes('arrowx12'), 'secretOw2: 12 arrows');
  assert.equal(items[r.secretOw2.find((x) => x.startsWith('gear.')).replace(/x1$/, '')].equip.tier, 'fine', 'secretOw2: fine gear');
}
assert.deepEqual(Object.keys(CHEST_TABLES).filter((k) => k.startsWith('secret')).sort(), ['secretOw2', 'secretRook'], 'only the 2 merged secrets remain');
void c; void countOf;
console.log('chestDefs.test: ALL PASS');
