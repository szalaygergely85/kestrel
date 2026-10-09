// S8-B1-16 MAP-01d wiring: mapFogHook.js is the ONLY new game-side code this story adds (mapFog.js/mapCard.js,
// S8-C-15, are untouched). Fakes the gameHooks ctx the way chestHook.test.js/saveRelay.test.js do, and proves:
// (1) the per-tick feed reveals the player's cell and keeps `world.state['ui.mapFog']` in sync only when the
// mask actually changes (no redundant save-field writes every frame); (2) that byte array is byte-stable through
// the REAL game save envelope (collectSave/stringifyGameSave/parseGameSave/applySave, US-089a - the save relay
// itself needs no new plumbing); (3) a save with no `ui.mapFog` key (old save) or an incompatible one (bounds/
// grid mismatch, corrupt bytes) still loads, falling back to a blank mask instead of throwing out of onBoot.
import assert from 'node:assert/strict';
import '../../design/palette.js';
import { World, AssetRegistry } from '../../engine/index.js';
import { createMapFogHook, MAP_FOG_SAVE_KEY } from './mapFogHook.js';
import { collectSave, applySave, stringifyGameSave, parseGameSave } from './quest/save/saveState.js';

const bounds = { x0: 0, y0: 0, x1: 100, y1: 100 };

function rig() {
  const world = { state: {} };
  const playerData = { transform: { x: 5, y: 5, z: 0 } };
  const hook = createMapFogHook(bounds, { cols: 10, rows: 10 });
  hook.onBoot({ world, player: playerData });
  return { hook, world, playerData };
}

// Boot: a fresh fog, and the save field present from frame zero (so an old save gains the key on its very
// next write even if the player never moves).
const r = rig();
assert.ok(Array.isArray(r.world.state[MAP_FOG_SAVE_KEY]), 'save field present after onBoot');
assert.deepEqual(r.world.state[MAP_FOG_SAVE_KEY], Array.from(r.hook.fog.save()));
assert.equal(r.hook.fog.isExplored(5, 5), false, 'nothing explored before the first tick');

// First tick reveals the player's own cell and writes the save field.
r.hook.onTick(1 / 60);
assert.equal(r.hook.fog.isExplored(5, 5), true, 'player cell revealed on tick');
assert.deepEqual(r.world.state[MAP_FOG_SAVE_KEY], Array.from(r.hook.fog.save()), 'save field matches after a real change');
const afterFirstTick = r.world.state[MAP_FOG_SAVE_KEY];

// No movement -> visit() reports no change -> the save field is NOT rewritten (perf: no alloc on a static tick).
r.world.state[MAP_FOG_SAVE_KEY] = 'sentinel';
r.hook.onTick(1 / 60);
assert.equal(r.world.state[MAP_FOG_SAVE_KEY], 'sentinel', 'unchanged tick does not touch the save field');
r.world.state[MAP_FOG_SAVE_KEY] = afterFirstTick;

// Walking reveals new cells and grows the save field.
r.playerData.transform.x = 95; r.playerData.transform.y = 95;
r.hook.onTick(1 / 60);
assert.equal(r.hook.fog.isExplored(95, 95), true, 'far cell revealed after moving');
assert.notDeepEqual(r.world.state[MAP_FOG_SAVE_KEY], afterFirstTick, 'save field grows with the mask');
const fedBytes = r.hook.fog.save();

// Byte-stable round trip through the REAL game save envelope (US-089a) - no saveRelay/saveState.js edits needed.
const engineAssets = new AssetRegistry({ palette: {} });
const world = World.load({ name: 'fog_hook_fixture', terrain: null, structures: [], entities: [] }, engineAssets, {});
world.state[MAP_FOG_SAVE_KEY] = Array.from(fedBytes);
const text = stringifyGameSave(collectSave(world));
const loaded = applySave(parseGameSave(text), engineAssets).world;
const hook2 = createMapFogHook(bounds, { cols: 10, rows: 10 });
hook2.onBoot({ world: loaded, player: { transform: { x: 95, y: 95, z: 0 } } });
assert.deepEqual(hook2.fog.save(), fedBytes, 'fog mask byte-stable through the save/load round trip');

// Old save (no key at all) loads fine with a blank mask.
const bareWorld = { state: {} };
const hook3 = createMapFogHook(bounds, { cols: 10, rows: 10 });
hook3.onBoot({ world: bareWorld, player: { transform: { x: 0, y: 0, z: 0 } } });
assert.equal(hook3.fog.isExplored(5, 5), false, 'no prior save -> blank mask, not a throw');
assert.ok(Array.isArray(bareWorld.state[MAP_FOG_SAVE_KEY]), 'blank mask still gets the field so the next save carries it');

// Incompatible bytes (wrong grid/bounds, or corrupt/truncated) load fine too, falling back to blank.
for (const bad of [[1, 2, 3], Array(999).fill(0), null, 'not-an-array', 42]) {
  const badWorld = { state: { [MAP_FOG_SAVE_KEY]: bad } };
  const hook4 = createMapFogHook(bounds, { cols: 10, rows: 10 });
  assert.doesNotThrow(() => hook4.onBoot({ world: badWorld, player: { transform: { x: 0, y: 0, z: 0 } } }), 'incompatible/corrupt bytes: ' + JSON.stringify(bad));
  assert.equal(hook4.fog.isExplored(1, 1), false, 'corrupt save falls back to blank: ' + JSON.stringify(bad));
}

// No player on ctx yet (gameHooks.boot order edge case) - onTick must not throw.
const hook5 = createMapFogHook(bounds, { cols: 10, rows: 10 });
hook5.onBoot({ world: { state: {} }, player: null });
assert.doesNotThrow(() => hook5.onTick(1 / 60));
// onTick before any onBoot at all (hook just registered, world not loaded yet) must not throw either.
assert.doesNotThrow(() => createMapFogHook(bounds, { cols: 10, rows: 10 }).onTick(1 / 60));

console.log('mapFogHook: per-tick feed, save-field sync on change only, byte-stable save round trip, old/incompatible saves fall back to blank PASS');
