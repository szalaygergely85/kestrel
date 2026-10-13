// S8-B1-04: the glue only (chest.test.js already covers the sim itself, itemGetCard.test.js the card itself).
// Fakes the gameHooks ctx (world.get, player.transform, events, inventory, state) the way saveRelay.test.js does,
// and checks: interact opens the chest once, the item is added once, the clip is driven, and the right events
// reach the shared bus (chest:opened for saveRelay, inventory:added for the seam/toastView) without the card
// itself appearing on that shared bus (so boar loot - which uses the same bus - never opens the card).
import assert from 'node:assert/strict';
import '../../design/palette.js';
import '../../design/items.js';
import '../../design/models/title.js';
import '../../design/models/inventory_ui.js';
import '../../design/models/menu_ui.js';
import { createChestHook, CLIP_FOR } from './chestHook.js';
import { ensureInventory, countOf } from './quest/sim/inventory.js';
import { CHEST_DEFAULTS as C } from './quest/sim/lootConfig.js';

const A = globalThis.ASSETS;
const rgb = Object.fromEntries(Object.entries(A.palette.colors).map(([k, h]) => [k, [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))]));
const table = { fixed: [{ item: 'brass.scrap', n: 2 }], weighted: [] };
const def = {
  id: 'fixtureChest', x: 0, y: 0, z: 0, frontX: 0, frontY: -1,
  interact: { radius: C.radius, facingDeg: C.facingDeg, facingCos: C.facingCos },
  table, propId: 'chestEntity1',
};

function rig(defs = [def], openedChests = []) {
  const playerData = { transform: { x: 0, y: -1, z: 0 }, components: {} };
  const inv = ensureInventory(playerData, { pack: [], left: null, right: null });
  const log = [];
  const chestEntity = { anim: 'closed', plays: [], play(clip) { this.anim = clip; this.plays.push(clip); } };
  const world = { get(id) { return id === 'chestEntity1' ? chestEntity : null; } };
  const state = { interactPressed: false, interactRaw: false, playerYawDeg: 0 };
  const events = { emit(name, p) { log.push({ name, ...p }); } };
  const hook = createChestHook({ defs, items: A.items, style: A.uiStyle.itemGetCard, rgb, openedChestsOf: () => openedChests, seed: 7 });
  hook.onBoot({ world, player: playerData, events, inventory: inv, state });
  return { hook, state, inv, log, chestEntity, tick(dt) { hook.stepUi(dt, state.interactRaw); if (!hook.card.isOpen) hook.onTick(dt); } }; // main.js shape: stepUi every frame, onTick only while unpaused (an open card pauses)
}

// Facing the chest (frontY = -1, player at y=-1 facing +y / yaw 180) and pressing E opens it exactly once.
const r = rig();
r.state.playerYawDeg = 180; // forwardOf(180) = (0, 1): matches `pose` the chest fixture expects (chest.test.js)
r.state.interactPressed = true; r.state.interactRaw = true;
r.tick(1 / 60);
assert.equal(r.chestEntity.anim, 'open', 'opening clip starts on the E edge');
assert.equal(r.log.filter((e) => e.name === 'chest:opening').length, 1);
r.state.interactPressed = false; r.state.interactRaw = false; // E released - does not reopen/re-fire
r.tick(C.openSeconds + 0.01);
assert.equal(countOf(r.inv, 'brass.scrap'), 2, 'item granted exactly once');
assert.equal(r.chestEntity.anim, CLIP_FOR.open, 'opened clip after the grant');
assert.equal(r.log.filter((e) => e.name === 'chest:opened').length, 1, 'chest:opened reaches the shared bus once (saveRelay.bindEvents)');
assert.equal(r.log.filter((e) => e.name === 'inventory:added').length, 1, 'inventory:added reaches the shared bus once (seam item:got / toastView)');
assert.equal(r.hook.card.isOpen, true, 'item-get card opened from the grant');
assert.equal(r.hook.card.snapshot().id, 'brass.scrap');
for (let i = 0; i < 60; i++) r.tick(1 / 60); // pressing E again does nothing further (already open, card still showing)
r.state.interactPressed = true; r.state.interactRaw = true; r.tick(1 / 60);
assert.equal(r.log.filter((e) => e.name === 'chest:opened').length, 1, 'opens only once even if E is pressed again');
assert.equal(countOf(r.inv, 'brass.scrap'), 2, 'item added only once');

// Facing away: no open.
const away = rig();
away.state.playerYawDeg = 0; away.state.interactPressed = true; away.state.interactRaw = true;
for (let i = 0; i < 60; i++) away.tick(1 / 60);
assert.equal(away.log.filter((e) => e.name === 'chest:opened').length, 0, 'facing away never opens the chest');
assert.equal(away.chestEntity.anim, 'closed');

// Restored `openedChests` (reload): already open at boot, no grant, no re-emit.
const restored = rig([def], ['fixtureChest']);
restored.tick(1 / 60);
assert.equal(restored.log.length, 0, 'a restored-open chest emits nothing at boot');
restored.state.playerYawDeg = 180; restored.state.interactPressed = true; restored.state.interactRaw = true;
restored.tick(1 / 60);
assert.equal(restored.log.filter((e) => e.name === 'chest:opened').length, 0, 'a restored-open chest cannot be re-opened');
assert.equal(countOf(restored.inv, 'brass.scrap'), 0, 'no double grant on reload');

// The card's own dismiss key (`interactRaw`) works even though `interactPressed` is false while it is open
// (uiLocked while the card is up, main.js) - and the ungated edge never re-opens a chest on its own.
const dismiss = rig();
dismiss.state.playerYawDeg = 180; dismiss.state.interactPressed = true; dismiss.state.interactRaw = true;
dismiss.tick(1 / 60);
dismiss.state.interactPressed = false; dismiss.state.interactRaw = false;
dismiss.tick(C.openSeconds + 0.01);
assert.equal(dismiss.hook.card.isOpen, true);
dismiss.tick(0.3); // past itemGetCard's own keyLockSec (0.25s) guard, still showing
dismiss.state.interactRaw = true; // ungated: dismisses the card (keyLockSec guard inside itemGetCard itself)
dismiss.tick(2); // large dt: drains the fade/gap phases fully closed, same precedent as itemGetCard.test.js's `step(2)`
assert.equal(dismiss.hook.card.isOpen, false, 'interactRaw dismisses the open card');

// Soft-lock regression: with the card open the sim is paused (no onTick); stepUi alone must still dismiss it.
const lock = rig();
lock.state.playerYawDeg = 180; lock.state.interactPressed = true; lock.state.interactRaw = true;
lock.tick(1 / 60);
lock.state.interactPressed = false; lock.state.interactRaw = false;
lock.tick(C.openSeconds + 0.01);
assert.equal(lock.hook.card.isOpen, true);
lock.hook.stepUi(0.3, false);
lock.hook.stepUi(2, true); // no onTick at all, as in main.js while paused
for (let i = 0; i < 10 && lock.hook.card.isOpen; i++) lock.hook.stepUi(2, false);
assert.equal(lock.hook.card.isOpen, false, 'card dismisses with stepUi alone (no soft-lock while paused)');

// No defs at all (today's real game: no content/chests/*.json yet) - the hook is a harmless no-op.
const empty = rig([]);
empty.state.interactPressed = true; empty.state.interactRaw = true;
for (let i = 0; i < 10; i++) empty.tick(1 / 60);
assert.deepEqual(empty.log, []);
assert.equal(empty.hook.card.isOpen, false);

if (typeof global.gc === 'function') {
  const warm = rig();
  for (let i = 0; i < 1000; i++) warm.tick(1 / 60);
  global.gc(); const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200000; i++) warm.tick(1 / 60);
  global.gc(); assert.ok(process.memoryUsage().heapUsed - before < 65536, 'idle hook does not allocate per tick');
}

// EQ-10: defs [] -> the hook builds chests from the world's chest* anchors; 'gear:got' opens the item-get card.
{
  const playerData = { transform: { x: 0, y: 0, z: 0 }, components: {} };
  const inv = ensureInventory(playerData, { pack: [], left: null, right: null });
  const ents = { chestMeadow: { transform: { x: 5, y: 5, z: 0, yawDeg: 180 } } };
  const handlers = new Map();
  const events = { emit(n, p) { for (const f of handlers.get(n) || []) f(p); }, on(n, f) { (handlers.get(n) || handlers.set(n, []).get(n)).push(f); return () => {}; } };
  const world = { entity: (id) => ents[id] || null, get: () => ({ play() {} }) };
  const hook = createChestHook({ defs: [], items: A.items, style: A.uiStyle.itemGetCard, rgb, seed: 3 });
  hook.onBoot({ world, player: playerData, events, inventory: inv, state: { interactPressed: false, playerYawDeg: 0 } });
  assert.equal(hook.card.isOpen, false);
  events.emit('gear:got', { id: 'gear.body.jerkin.sturdy', n: 1 });
  assert.equal(hook.card.isOpen, true, 'gear:got opens the item-get card');
  assert.equal(hook.card.snapshot().id, 'gear.body.jerkin.sturdy');
  // anchors drive a chest: standing in front (+y of it), facing it, E opens it and the heart piece lands in the pack
  const st = { interactPressed: true, playerYawDeg: 0 };
  playerData.transform.x = 5; playerData.transform.y = 6; // front is +y (yaw 180)
  st.playerYawDeg = 0; // forwardOf(0) = (0, -1): looking at the chest from its front
  const hook2 = createChestHook({ defs: [], items: A.items, style: A.uiStyle.itemGetCard, rgb, seed: 3 });
  hook2.onBoot({ world, player: playerData, events, inventory: inv, state: st });
  hook2.onTick(1 / 60); hook2.onTick(1);
  assert.equal(countOf(inv, 'heart.piece'), 1, 'anchor chest opened from the world entity');
}

// OB-075: with `notify` (main.js toasts.say) chest + gear loot is a one-line toast, never the item-get card.
{
  const msgs = [];
  const playerData = { transform: { x: 0, y: -1, z: 0 }, components: {} };
  const inv = ensureInventory(playerData, { pack: [], left: null, right: null });
  const handlers = new Map();
  const events = { emit(n, p) { for (const f of handlers.get(n) || []) f(p); }, on(n, f) { (handlers.get(n) || handlers.set(n, []).get(n)).push(f); return () => {}; } };
  const world = { get: () => ({ play() {} }) };
  const st = { interactPressed: true, playerYawDeg: 180 };
  const hook = createChestHook({ defs: [def], items: A.items, style: A.uiStyle.itemGetCard, rgb, seed: 7, notify: (t) => msgs.push(t) });
  hook.onBoot({ world, player: playerData, events, inventory: inv, state: st });
  hook.onTick(1 / 60); st.interactPressed = false; hook.onTick(C.openSeconds + 0.01);
  assert.equal(hook.card.isOpen, false, 'OB-075: chest loot opens no card');
  assert.equal(msgs.length, 1); assert.match(msgs[0], /^Looted: 2 /, 'chest loot toast "Looted: 2 <name>"');
  events.emit('gear:got', { id: 'gear.body.jerkin.sturdy', n: 1 });
  assert.equal(hook.card.isOpen, false, 'OB-075: gear pickup opens no card');
  assert.match(msgs[1], /^Looted: \S/); assert.ok(!/^Looted: 1 /.test(msgs[1]), 'single item has no count');
}

// OB-105: a heart piece in the pack (chest / quest reward / loot) is a toast via heartHook `notify`, never the card; a chest that
// holds a heart piece also only toasts.
{
  const { createHeartHook } = await import('./heartHook.js');
  const msgs = [];
  const playerData = { transform: { x: 0, y: 0, z: 0 }, components: { health: { hp: 3, maxHp: 3 } } };
  const inv = ensureInventory(playerData, { pack: [], left: null, right: null });
  const events = { emit() {} };
  const world = { state: {} };
  const chest = createChestHook({ defs: [], items: A.items, style: A.uiStyle.itemGetCard, rgb, seed: 3, notify: (t) => msgs.push(t) });
  const hh = createHeartHook({ getCard: () => chest.card, notify: (t) => msgs.push(t) });
  hh.onBoot({ world, player: playerData, events, inventory: inv });
  const { addItem } = await import('./quest/sim/inventory.js');
  addItem(inv, A.items.defs, 'heart.piece', 1); // e.g. a quest reward
  for (let i = 0; i < 10; i++) hh.onTick(1 / 60);
  assert.equal(msgs.length, 1); assert.match(msgs[0], /^Looted: Heart piece/);
  assert.equal(chest.card.isOpen, false, 'OB-105: heart piece opens no card');
  chest.onBoot({ world: { get: () => ({ play() {} }) }, player: playerData, events: { emit() {}, on() { return () => {}; } }, inventory: inv, state: {} });
}

console.log('chestHook: interact opens once, item added once, clip driven, save-relay/seam events forwarded, restored-open, card dismiss, no-defs, idle GC PASS');
