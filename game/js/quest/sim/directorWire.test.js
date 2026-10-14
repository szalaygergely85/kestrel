// BEAST-06a main hook, adapted to answer c: regional list -> groups -> wire(bind, slotDied, resetSlot, 'spawnDirector.v1').
import { createDirectorWire } from './directorWire.js';
import { createSpawnDirector, buildGroups, regionalMembers, SAVE_KEY } from './spawnDirector.js';
import assert from 'node:assert';
const list = [];
for (let i = 0; i < 3; i++) list.push({ id: `boar.north.${i}`, species: 'boar', region: 'north', group: 0, x: 100 + i, y: 100 });
const ids = list.map((b) => b.id), reset = [];
const sim = { count: 8, slotOf: (id) => ids.indexOf(id), resetSlot: (s) => reset.push(s) };
const handlers = {}; const events = { on: (n, f) => { handlers[n] = f; return () => { delete handlers[n]; }; } };
const groups = buildGroups(regionalMembers(list, sim.slotOf), 1);
let w = null;
const dir = createSpawnDirector({ groups, dayLenSec: 1200, los: () => false, onRespawn: (gi, g) => w.respawn(gi, g) });
w = createDirectorWire({ director: dir, sim, events });
assert.strictEqual(dir.groups.length, 1);
assert.deepStrictEqual([...dir.groupOfSlot.slice(0, 4)], [0, 0, 0, -1]);
for (const id of ids) handlers['beast:died']({ id });
assert.strictEqual(dir.dead[0], 1);
const st = {}; w.save(st); assert.ok(st[SAVE_KEY] && st[SAVE_KEY][dir.groups[0].gid]);
for (let i = 0; i < 600 * 60 * 2; i += 30) dir.step(1, 0, 0, -1, 0); // player far, facing away
assert.deepStrictEqual(reset.slice().sort(), [0, 1, 2]);
const dir2 = createSpawnDirector({ groups, dayLenSec: 1200 }); const w2 = createDirectorWire({ director: dir2, sim, events: null });
assert.ok(w2.load(st) && dir2.dead[0] === 1);
w.dispose(); assert.ok(!handlers['beast:died']);
console.log('directorWire ok');
