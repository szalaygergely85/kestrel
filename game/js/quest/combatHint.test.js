// COMBAT-HINT-01. Run: node game/js/quest/combatHint.test.js
import assert from 'node:assert/strict';
import { World, AssetRegistry } from '../../../engine/index.js';
import '../../../design/models/title.js'; // classic script: sets globalThis.ASSETS.uiStyle
import { request, stepHints, resetHints, currentHintId, setPaletteColors } from './hints.js';
import { stepCombatHint, beastEngaged, COMBAT_HINT_ID } from './combatHint.js';
import { collectSave, applySave } from './save/saveState.js';
import { STATE_WANDER, STATE_CHASE } from './sim/beastSim.js';

const uiStyle = globalThis.ASSETS.uiStyle;
const def = uiStyle.storyHints.find((h) => h.id === COMBAT_HINT_ID);
assert.ok(def, 'hint key exists in uiStyle.storyHints');
assert.ok(def.text.length <= 38, 'text <= 38 chars');
setPaletteColors(uiStyle, new Proxy({}, { get: () => '#ffffff' }));
const sig = { walking: false, pointerUnlocked: false, moveOrLook: false, run: false, jump: false, pointerLocked: false, mPressed: false };

const assets = new AssetRegistry({ palette: {} });
const mkWorld = () => World.load({ name: 'h', terrain: null, structures: [], entities: [] }, assets, {});
const sim = { count: 3, state: new Uint8Array(3) };

resetHints();
let world = mkWorld();
stepCombatHint(world, uiStyle, sim); stepHints(world, uiStyle, 0.016, sig);
assert.equal(currentHintId(), null, 'no beast engaged: nothing shown');
assert.equal(beastEngaged(sim), false);
sim.state[1] = STATE_CHASE;
stepCombatHint(world, uiStyle, sim); stepHints(world, uiStyle, 0.016, sig);
assert.equal(currentHintId(), COMBAT_HINT_ID, 'first engagement shows the hint');
for (let i = 0; i < 200; i++) { stepCombatHint(world, uiStyle, sim); stepHints(world, uiStyle, 0.1, sig); }
assert.equal(currentHintId(), null, 'dismissed/timed out, not repeated while still engaged');
assert.equal(world.state['hints.shown'].filter((x) => x === COMBAT_HINT_ID).length, 1, 'recorded once');

// save/load round trip: not shown again
const loaded = applySave(JSON.parse(JSON.stringify(collectSave(world))), assets).world;
assert.ok(loaded.state['hints.shown'].includes(COMBAT_HINT_ID), 'flag survives save/load');
resetHints();
stepCombatHint(loaded, uiStyle, sim); stepHints(loaded, uiStyle, 0.016, sig);
assert.equal(currentHintId(), null, 'not shown again after load');

// a fresh save does show it again
resetHints(); sim.state[1] = STATE_WANDER;
const fresh = mkWorld(); sim.state[2] = STATE_CHASE;
stepCombatHint(fresh, uiStyle, sim); stepHints(fresh, uiStyle, 0.016, sig);
assert.equal(currentHintId(), COMBAT_HINT_ID, 'new save shows it');
console.log('combatHint.test: PASS');
