// UNDER-02 / OB-191: cemetery crypt (real world_m1, mesh physics). Run: node game/js/quest/under/crypt.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateUnder } from '../../../../engine/index.js';
import { loadM1 } from './loadM1.mjs';
import { CRYPT, cryptDoorAction, applyCryptDoor, cryptCleared, bindCryptFlags, syncCryptFlags, chestKey, DOOR_FLAG } from './crypt.js';
import { buildChestDefs } from '../sim/chestDefs.js';
import { UNDER_SITES, createUnderSpawner } from '../sim/underSkeletons.js';
import { STATE_DYING } from '../sim/beastSim.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const { world, groundAt } = await loadM1('mesh');
const st = world.structures.find((s) => s.id === 'crypt');
ok(st && st.keepMask, 'site crypt placed (keepTerrain)');
const errs = validateUnder(world);
ok(errs.length === 0, 'validateUnder: ' + errs.slice(0, 2).join('; '));
const lv = JSON.parse(fs.readFileSync(new URL('../../../../content/levels/crypt.level.json', import.meta.url), 'utf8'));
ok(lv.ambience === 'crypt', 'ambience crypt');
ok(lv.lights.length >= 6 && lv.lights.length <= 8, 'lights per site <= 8: ' + lv.lights.length);
for (const r0 of [23, 13, 3]) { const c = lv.lights.filter((l) => l.x >= 21 && l.y >= r0 && l.y < r0 + 7).length; ok(c >= 2 && c <= 4, `room rows ${r0}..${r0 + 6}: ${c} torches`); }

// support: inside = crypt floor (terrain never lifts the player), above = terrain; the stair path is continuous
const opts = { height: 1.6, stepUpMax: 0.5, walkCos: 0.7 };
for (const [x, y] of [[1674.5, 1372.5], [1674.5, 1362.5], [1674.5, 1352.5]]) {
  const s = world.supportAt(x, y, -56.7, true, opts);
  ok(Math.abs(s.floorH + 56.8) < 0.05 && !s.terrain, `room (${x},${y}) support = crypt floor (${s.floorH})`);
  ok(world.supportAt(x, y, groundAt(x, y) + 0.2, false, opts).terrain, 'surface above the room is terrain');
}
let prev = null;
for (let x = 1651.2; x <= 1670.2; x += 0.25) { // stair line down the middle (y 1373), feet follow the floor
  const s = world.supportAt(x, 1373, prev === null ? -50.4 : prev + 0.05, true, opts);
  ok(Number.isFinite(s.floorH), 'stair support at x=' + x);
  if (prev !== null) ok(s.floorH - prev <= 0.5 && prev - s.floorH <= 0.6, `stair step ${(s.floorH - prev).toFixed(2)} at x=${x}`);
  prev = s.floorH;
}
ok(prev < -56.3 && prev > -56.9, 'stair ends at the room 1 floor: ' + prev.toFixed(2));
for (let y = 1372; y >= 1350; y -= 0.5) { const s = world.supportAt(1675, y, -56.75, true, opts); ok(Math.abs(s.floorH + 56.8) < 0.05, `column x=1675 y=${y} floor ${s.floorH}`); } // rooms 1-3 + corridors

// door: shut without the key, opens with it (flag saved), re-applied after Continue
const door = world.structures.find((s) => s.id === CRYPT.doorMesh), z0 = door.origin.z;
ok(world.state[DOOR_FLAG] === false, 'door flag default false');
ok(cryptDoorAction(world, () => false) === 'sealed' && world.state[DOOR_FLAG] === false && door.origin.z === z0, 'no key: sealed, door unchanged');
ok(cryptDoorAction(world, (id) => id === 'key.crypt') === 'open' && world.state[DOOR_FLAG] === true && door.origin.z < z0 - 2.9, 'key: door opens, flag set');
ok(cryptDoorAction(world, () => false) === 'already', 'open stays open');
world.setMeshPlacement(CRYPT.doorMesh, { x: door.origin.x, y: door.origin.y, z: z0, yawDeg: 278 }); door.baseZ = undefined;
applyCryptDoor(world); ok(door.origin.z < z0 - 2.9, 'applyCryptDoor re-syncs after Continue');

// skeletons: crypt members are in rooms 2/3; the surface cemetery spawner ignores a player inside (dz rule), and vice versa
const site = UNDER_SITES.find((s) => s.id === 'crypt');
ok(site && site.members.length >= 4 && site.members.length <= 5 && !site.night && site.z === -56.8, 'crypt site: 4-5 skeletons, any time of day, at the crypt floor');
const pos = (m) => [site.anchor[0] + m[2], site.anchor[1] + m[3]];
ok(site.members.every((m) => { const [x, y] = pos(m); return x > 1671 && x < 1678 && ((y > 1359 && y < 1366) || (y > 1349 && y < 1356)); }), 'every member home is inside room 2 or 3');
ok(site.members.filter((m) => pos(m)[1] > 1357.5).length === 2, '2 skeletons in room 2, the rest in room 3');
const fake = (z) => ({ count: 1, down: [0], state: [0], entities: [{ transform: { z } }], slotOf: () => 0, riseMs: new Float32Array(1), cfgSteps: {}, steer: {}, setDown() {} });
const cem = UNDER_SITES.find((s) => s.id === 'cemetery');
const sp = createUnderSpawner({ sim: fake(groundAt(1644, 1372)), site: cem, state: {} });
ok(!sp.inRange(1674.5, 1360, -56.8, 1641, 1373), 'cemetery spawner: a player in the crypt (dz > 3 m) is out of range');
ok(sp.inRange(1650, 1373, groundAt(1650, 1373), 1641, 1373), 'cemetery spawner: a surface player is in range');
const sp2 = createUnderSpawner({ sim: fake(-56.8), site, state: {} });
ok(!sp2.inRange(1650, 1373, groundAt(1650, 1373), 1674.5, 1362), 'crypt spawner: a surface player does not reach crypt homes');

// chest: a def on the room 3 floor, earned when the room 3 guards are dead, flag saved
const cd = buildChestDefs(world).find((d) => d.id === 'chestCrypt');
ok(cd && Math.abs(cd.z + 56.8) < 0.05, 'chestCrypt def on the room 3 floor');
const live = { slotOf: (id) => CRYPT.guards.indexOf(id), down: [0, 0, 0], state: [0, 0, 0] };
ok(cryptCleared(world, live) === false && world.state['under.crypt.cleared'] === false, 'chest not earned while a guard lives');
live.state[1] = STATE_DYING; live.down[0] = 1; live.state[2] = STATE_DYING;
ok(cryptCleared(world, live) === true && world.state['under.crypt.cleared'] === true, 'room 3 guards dead: earned');
const handlers = {}; bindCryptFlags(world, { on(k, f) { handlers[k] = f; return () => {}; } });
handlers['chest:opened']({ id: 'chestCrypt' }); handlers['chest:opened']({ id: 'chestMeadow' });
ok(world.state[chestKey('chestCrypt')] === true && !world.state['under.crypt.chest.chestMeadow'], 'looted flag saved, others ignored');
world.state[chestKey('chestCrypt')] = false; syncCryptFlags(world, ['chestCrypt']); ok(world.state[chestKey('chestCrypt')] === true, 'flag restored from the opened-chest list');
const insp = JSON.parse(fs.readFileSync(new URL('../../../../content/dialogue/inspect.json', import.meta.url), 'utf8')), T = insp.texts || insp;
for (const k of ['walls', 'coffin', 'banner', 'chest']) { const t = T['note.crypt.' + k]; ok(t && t.lines.length === 2 && t.lines.every((l) => l.length <= 56), 'inspect note.crypt.' + k); }
console.log(`crypt.test: ${n} checks ok`);
