// US-089w + US-096w: save relay round trip (fake storage) and the quest event hook, in Node.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, AssetRegistry } from '../../engine/index.js';
// minimal event bus (engine/dev.js Events is off limits for game/js outside dev/)
class Events { constructor() { this.m = {}; } on(n, f) { (this.m[n] ||= []).push(f); return () => { this.m[n] = this.m[n].filter((g) => g !== f); }; } emit(n, p) { for (const f of this.m[n] || []) f(p); } }
import { ensureInventory } from './quest/sim/inventory.js';
import { createSaveRelay } from './saveRelay.js';
import { createGameHooks, bridgeEngineEvents } from './gameHooks.js';
import { DONE_TEXT } from './questRelay.js';

const questDef = JSON.parse(readFileSync(new URL('../../content/quests/m1.quest.json', import.meta.url)));
// objective texts come from the content (writer pass may change them), not from this test
const OBJ = Object.fromEntries(questDef.objectives.map((o) => [o.id, o.text]));
const assets = new AssetRegistry({ palette: {} });
const mkWorld = () => World.load({ name: 'relay_fixture', terrain: null, structures: [], entities: [], state: { 'tower.lantern.taken': false, 'quest.wakeT': 0 } }, assets, {});
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

// ---- A: a run with scripted events ----
const world = mkWorld();
const player = world.spawn('unit', { x: 12.25, y: -3.5, z: 2, yawDeg: 123, pitchDeg: -9 }, { health: { hp: 3, max: 5, invuln: 0 }, mana: { mp: 7, max: 10 } }, 'player');
ensureInventory(player.data, { pack: [{ id: 'lantern', n: 1 }, { id: 'sword', n: 1 }], left: 'lantern', right: 'sword' });
world.state['tower.lantern.taken'] = true; world.state['tower.sword.taken'] = true; world.state['quest.wakeT'] = 99;

const events = new Events();
const A = createSaveRelay({ storage, questDef });
A.onWorldLoaded();
A.bindEvents(events);
const H = createGameHooks(); // the seam: engine events -> bridge -> relay handlers
H.register(A.handlers());
bridgeEngineEvents(events, H);
A.quest.onPoll = (n, a, b) => H.emitSimple(n, a, b);
const breach = { x: 100, y: 50, z: 6 };
const facts = (o) => ({ wakeDone: false, lanternTaken: false, swordTaken: false, endStarted: false, x: 0, y: 0, z: 0, ...o });
assert.equal(A.quest.objectiveText(), OBJ.wake);
A.quest.poll(facts({ wakeDone: true }), breach);
assert.equal(A.quest.objectiveText(), OBJ.lantern);
A.quest.poll(facts({ wakeDone: true, lanternTaken: true }), breach);
assert.equal(A.quest.objectiveText(), OBJ.breach);
A.quest.poll(facts({ wakeDone: true, lanternTaken: true, x: 120, y: 50, z: 6 }), breach); // too far
assert.equal(A.quest.objectiveText(), OBJ.breach);
A.quest.poll(facts({ wakeDone: true, lanternTaken: true, x: 101, y: 51, z: 6.2 }), breach);
assert.equal(A.quest.objectiveText(), OBJ.sword);
A.quest.poll(facts({ swordTaken: true }), breach);
assert.equal(A.quest.objectiveText(), OBJ.beasts);
events.emit('beast:died', { id: 'boar1' });
events.emit('beast:died', { id: 'boar1' }); // duplicate counts once
events.emit('chest:opened', { id: 'chestA' });
events.emit('inventory:added', { id: 'boar_meat', n: 1 });
assert.equal(A.quest.objectiveText(), OBJ.beasts);
events.emit('beast:died', { id: 'boar2' });
assert.equal(A.quest.objectiveText(), OBJ.beasts, 'QUEST-CHAIN-02c: 5 boars needed');
for (const id of ['boar3', 'boar4', 'boar5']) events.emit('beast:died', { id });
assert.equal(A.quest.objectiveText(), OBJ.waystone);
A.quest.poll(facts({ endStarted: true }), breach);
assert.equal(A.quest.done, true, 'scripted sequence completes the demo quest');
assert.equal(A.quest.objectiveText(), DONE_TEXT);
assert.equal(DONE_TEXT, 'The pencil line runs on.');

// ---- HUD: the current objective is drawn into the UI layer, top-left ----
{
  const C = new Relay0();
  function Relay0() { this.cols = 160; this.cells = new Map(); this.setCellRGB = (x, y, g) => { this.cells.set(y * 1000 + x, String.fromCharCode(g + 32)); }; }
  const R = createSaveRelay({ storage: null, questDef });
  R.quest.draw(C);
  let row = ''; for (let x = 0; x < 40; x++) row += C.cells.get(1000 + x) ?? '';
  assert.equal(row.trim(), ('> ' + OBJ.wake).slice(0, 40).trim(), 'objective line at row 1');
  A.quest.draw(C); // done quest: plain line
  row = ''; for (let x = 0; x < 40; x++) row += C.cells.get(1000 + x) ?? '';
  assert.ok(row.includes(DONE_TEXT));
}

// ---- save, reload into a fresh relay + world, save again: byte-stable ----
assert.equal(A.tick(10, world, false), false, 'no autosave when canSave is false');
assert.equal(A.tick(55, world, true), true, 'autosave after 60 s');
const text1 = mem.get([...mem.keys()][0]);
const B = createSaveRelay({ storage, questDef });
B.onWorldLoaded(); // boot: fresh world first (as main.js does), then the restore swap
const w2 = B.load(assets, {});
assert.ok(w2, 'slot exists -> world restored');
B.onWorldLoaded();
const p2 = w2.get('player').data;
assert.ok(Math.abs(p2.transform.x - 12.25) < 0.01 && Math.abs(p2.transform.y + 3.5) < 0.01 && p2.transform.z === 2);
assert.equal(p2.components.health.hp, 3); assert.equal(p2.components.mana.mp, 7);
assert.equal(p2.components.inventory.right, 'sword');
assert.equal(w2.state['tower.lantern.taken'], true);
assert.equal(B.quest.done, true, 'quest state survives reload');
assert.deepEqual(B.deadBeasts.sort(), ['boar1', 'boar2', 'boar3', 'boar4', 'boar5']); assert.deepEqual(B.openedChests, ['chestA']);
assert.equal(B.playTimeSec, 65);
assert.equal(B.save(w2), true);
const text2 = mem.get([...mem.keys()][0]);
const stripT = (t) => { const o = JSON.parse(t); assert.ok(Number.isFinite(o.meta.savedAt) && o.meta.savedAt > 0, 'written save carries finite savedAt (SAVE-TIME-01)'); delete o.meta.savedAt; return JSON.stringify(o); };
assert.equal(stripT(text2), stripT(text1), 'relay round trip is byte-stable (apart from savedAt)');

// ---- restart without a pending restore resets game data ----
B.onWorldLoaded();
assert.equal(B.quest.done, false); assert.deepEqual(B.deadBeasts, []);

// ---- dead beasts stay gone after the sim reset them alive ----
const beasts = { slotOf: (id) => ({ boar1: 0, boar2: 1 }[id] ?? -1), state: [0, 0], steer: { removed: [], removeAgent(i) { this.removed.push(i); } },
  entities: [{ components: { health: { hp: 3 } } }, { components: { health: { hp: 3 } } }] };
A.applyDeadToBeasts(beasts);
assert.deepEqual(beasts.state, [12, 12]); assert.equal(beasts.entities[0].components.health.hp, 0); assert.deepEqual(beasts.steer.removed, [0, 1]);

// ---- ending: saved with the end trigger un-started ----
world.state['quest.endT'] = 0;
A.save(world, { ending: true });
assert.equal(JSON.parse(mem.get([...mem.keys()][0])).world.state['quest.endT'], -1);
assert.equal(world.state['quest.endT'], 0, 'live world untouched');

// ---- disabled / no storage never writes ----
const mem2 = new Map();
const off = createSaveRelay({ storage: { getItem: (k) => mem2.get(k) ?? null, setItem: (k, v) => mem2.set(k, v), removeItem: (k) => mem2.delete(k) }, questDef, enabled: false });
assert.equal(off.save(world), false); assert.equal(off.tick(999, world, true), false); assert.equal(off.load(assets, {}), null); assert.equal(mem2.size, 0);
assert.equal(createSaveRelay({ storage: null, questDef }).save(world), false);
// corrupt slot -> no crash, no restore
mem.set([...mem.keys()][0], '{bad'); assert.equal(createSaveRelay({ storage, questDef }).load(assets, {}), null);

console.log('saveRelay: event-driven quest to done, byte-stable relay round trip, restart reset, dead beasts, disabled/corrupt slots PASS');
