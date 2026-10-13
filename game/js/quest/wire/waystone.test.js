import assert from 'node:assert/strict';
import { World, AssetRegistry } from '../../../../engine/index.js';
import { createGameHooks } from '../../gameHooks.js';
import { createWaystoneWire } from './waystone.js';
const assets = new AssetRegistry({ palette: {} });
function rig(restored) {
  const world = restored || World.load({ name: 'ws_wire', terrain: null, structures: [], entities: [] }, assets, {});
  const player = world.spawn('unit', { x: 1, y: 2, z: 3, yawDeg: 90 }, { health: { hp: 2, max: 6, invuln: 0 }, body: { vx: 0, vy: 0, vz: 0, eyeH: 1.6, grounded: true } }, 'player').data;
  const hooks = createGameHooks(); let saves = 0;
  hooks.onSaveRequest(() => saves++);
  const wire = createWaystoneWire({ toastSec: 1 });
  hooks.register(wire);
  hooks.boot(world, player, null, null, null);
  return { world, player, hooks, wire, saves: () => saves };
}
const cells = [];
const ui = { cols: 80, setCellRGB(x, y, g) { cells.push([x, y, g]); } };
const r = rig();
assert.equal(r.hooks.respawn(), null, 'no touch -> today\'s spawn');
r.hooks.drawHud(ui); assert.equal(cells.length, 0, 'no toast before touch');
// touch at a new spot
r.player.transform.x = 20; r.player.transform.y = 30; r.player.transform.z = 4; r.hooks.ctx.state.playerYawDeg = 180;
r.hooks.emitSimple('prop:touched', 'waystone', 'waystone', { x: 21, y: 30, z: 4 });
assert.equal(r.player.components.health.hp, 6, 'healed'); assert.equal(r.saves(), 1, 'one save');
assert.equal(r.world.state['save.x'], 20);
r.hooks.drawHud(ui); assert.ok(cells.length > 40, 'toast drawn');
r.hooks.emitSimple('prop:touched', 'chest', 'chest'); assert.equal(r.saves(), 1, 'other props ignored');
r.hooks.tick(0.6); r.hooks.tick(0.6); cells.length = 0; r.hooks.drawHud(ui); assert.equal(cells.length, 0, 'toast expires');
// death respawn at the stone
r.player.transform.x = -50; r.player.components.health.hp = 0;
const pose = r.hooks.respawn(); assert.deepEqual(pose, { x: 20, y: 30, z: 4, yawDeg: 180 }); assert.equal(r.player.components.health.hp, 6);
// re-arm: the seam only fires again after leaving; a second event is a second touch (one more save), not a double within one event
r.hooks.emitSimple('prop:touched', 'waystone', 'waystone'); assert.equal(r.saves(), 2);
console.log('waystone wire: ok');
// WS1-06a: entity-driven points; relay id touches via the same wire; unknown ids ignored.
{
  const world = World.load({ name: 'ws_wire2', terrain: null, structures: [], entities: [] }, assets, {});
  world.spawn('unit', { x: 10, y: 10, z: 0 }, { waystone: { id: 'waystone', label: 'Meadow stone', kind: 'stone', order: 1 } }, 'endMarker');
  world.spawn('unit', { x: 90, y: 10, z: 0 }, { waystone: { id: 'ws_roadBend', label: 'Road-bend relay', kind: 'relay', order: 2 } }, 'relayBend');
  const r = rig(world);
  assert.deepEqual([r.wire.sim.has('waystone'), r.wire.sim.has('ws_roadBend')], [true, true]);
  r.player.transform.x = 89; r.player.transform.y = 11; r.player.transform.z = 0;
  r.hooks.emitSimple('prop:touched', 'ws_roadBend', 'relay', { x: 90, y: 10, z: 0 });
  assert.equal(r.saves(), 1); assert.deepEqual(r.world.state['waystone.points'].ws_roadBend, { x: 89, y: 11, z: 0, yawDeg: 0 });
  r.hooks.emitSimple('prop:touched', 'ghost', 'relay'); assert.equal(r.saves(), 1, 'unknown id ignored');
  { // WS1-06b follow-up: the wake (first touch) shows no wire toast; a later touch shows title + relay saved + healed
    const c = []; const u = { cols: 80, setCellRGB(x, y, g) { c.push([x, y, g]); } };
    r.hooks.drawHud(u); assert.equal(c.length, 0, 'wake: no second toast');
    r.hooks.emitSimple('prop:touched', 'ws_roadBend', 'relay', { x: 90, y: 10, z: 0 });
    r.hooks.drawHud(u); const rows = new Set(c.map((e) => e[1])); assert.equal(rows.size, 3, 'relay touch: 3 lines');
    assert.ok(c.some((e) => e[2] === 'B'.charCodeAt(0) - 32), 'title "Bend Relay" drawn'); assert.equal(r.saves(), 2);
  }
  assert.deepEqual(r.hooks.respawn(), { x: 89, y: 11, z: 0, yawDeg: 0 }, 'respawn at last touched');
  console.log('waystone wire points: ok');
}
// CH1-04b: a dormant stone's first touch (the wake) shows no wire toast; later touches do
{
  const world = World.load({ name: 'ws_wire3', terrain: null, structures: [], entities: [] }, assets, {});
  world.spawn('unit', { x: 10, y: 10, z: 0 }, { waystone: { id: 'waystone', label: 'Meadow stone', kind: 'stone', order: 1, dormant: true } }, 'endMarker');
  const r = rig(world), c = []; const u = { cols: 80, setCellRGB(x, y, g) { c.push([x, y, g]); } };
  r.player.transform.x = 9; r.player.transform.y = 10;
  r.hooks.emitSimple('prop:touched', 'waystone', 'waystone', { x: 10, y: 10, z: 0 });
  assert.equal(r.saves(), 1, 'wake still saves'); r.hooks.drawHud(u); assert.equal(c.length, 0, 'wake: notice only, no toast');
  r.hooks.emitSimple('prop:touched', 'waystone', 'waystone', { x: 10, y: 10, z: 0 });
  r.hooks.drawHud(u); assert.ok(c.length > 0, 'later touch: normal toast');
  console.log('waystone wire dormant: ok');
}
