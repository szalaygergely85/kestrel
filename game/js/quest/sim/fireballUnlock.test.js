// FB-01 (docs/architecture.md 38.53): fireball unlock path. Run: node game/js/quest/sim/fireballUnlock.test.js (re-runs itself with --expose-gc).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { World, AssetRegistry } from '../../../../engine/index.js';
import { featuresFromParams, fireballOn, unlockFireball } from '../features.js';
import { createFireballSim } from './fireball.js';
import { FIREBALL_CFG as FB_NOW } from '../spellConfig.js';
// ITEM-04: the live cfg is x10 (tap 25-35, charged 45-60); these behaviour asserts keep the old 3 / 5 scale
const FIREBALL_CFG = { ...FB_NOW, tap: { ...FB_NOW.tap, damage: 3 }, charged: { ...FB_NOW.charged, damage: 5 } };
import { createTargetables } from './targetables.js';
import { collectSave, applySave, stringifyGameSave, parseGameSave } from '../save/saveState.js';

if (typeof global.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const assets = new AssetRegistry({ palette: {} });
const mkWorld = () => World.load({ name: 'fb_fixture', terrain: null, structures: [], entities: [] }, assets, {});
const world = mkWorld();
const player = world.spawn('unit', { x: 0, y: 0, z: 0, yawDeg: 90 }, { health: { hp: 3, max: 5, invuln: 0 }, mana: { mp: 50, max: 100 }, body: { grounded: true, vx: 0, vy: 0, vz: 0, eyeH: 1.6 } }, 'player');
const LOCKED = featuresFromParams(new URLSearchParams(''));

let emitted = 0;
const events = { on() { return () => {}; }, emit(n) { if (n === 'magic.unlocked') emitted++; else if (n === 'fireball:cast') casts++; } };
let casts = 0, mp = 100, spent = 0;
const tg = createTargetables({ state: {}, forEachEntity() {}, raySegmentRay() { return false; } }, events);
const sim = createFireballSim({ state: {}, forEachEntity() {}, raySegmentRay() { return false; } }, events, FIREBALL_CFG, tg, {
  spendMana: (n) => { if (mp < n) return false; mp -= n; spent += n; return true; },
  isEnabled: () => fireballOn(world, LOCKED),
});
const pl = { id: 'player', transform: { x: 0, y: 0, z: 0, yawDeg: 90 }, components: { body: { grounded: true, vx: 0, vy: 0, vz: 0, eyeH: 1.6 } } };
const stepFor = (down, n) => { for (let i = 0; i < n; i++) sim.step(pl, down, 1, 0, 1, 0, 0); };
const tapCast = () => { stepFor(true, 3); stepFor(false, 1); };

// (1) locked: tap + charged do nothing
assert.equal(fireballOn(world, LOCKED), false, 'new world is locked');
tapCast(); stepFor(true, 40); stepFor(false, 1);
assert.equal(sim.alive, 0, 'locked: no projectile'); assert.equal(mp, 100, 'locked: 0 MP'); assert.equal(casts, 0);
stepFor(false, 40);
// (2) unlock: one event, second call no-op, then cast works
assert.equal(unlockFireball(world, events), true); assert.equal(emitted, 1);
assert.equal(unlockFireball(world, events), false); assert.equal(emitted, 1, 'second call emits nothing');
assert.equal(world.state['magic.fireball'], true); assert.equal(fireballOn(world, LOCKED), true, 'live read, no reload');
tapCast();
assert.equal(casts, 1, 'unlocked: cast'); assert.equal(mp, 95, 'tap spends 5 MP'); assert.ok(sim.alive >= 1);
// flag must be exactly true
const w2 = { state: { 'magic.fireball': 1 } }; assert.equal(fireballOn(w2, LOCKED), false); w2.state['magic.fireball'] = 'true'; assert.equal(fireballOn(w2, LOCKED), false);
assert.equal(fireballOn({ state: {} }, { fireball: 1 }), false, 'override must be exactly true');
// (3) save round-trip keeps the flag; missing key = locked
const text = stringifyGameSave(collectSave(world, {}));
const back = applySave(parseGameSave(text), assets, {});
assert.equal(fireballOn(back.world, LOCKED), true, 'flag survives save/load');
assert.equal(back.world.get('player').data.components.mana.mp, 50, 'MP saved');
const fresh = mkWorld(); fresh.spawn('unit', { x: 0, y: 0, z: 0, yawDeg: 0 }, {}, 'player');
const old = applySave(parseGameSave(stringifyGameSave(collectSave(fresh, {}))), assets, {});
assert.equal(fireballOn(old.world, LOCKED), false, 'old save without the key is locked');
// (4) dev override
assert.equal(fireballOn(fresh, featuresFromParams(new URLSearchParams('fireball=1'))), true, '?fireball=1 on without the flag');
// (5) 0 alloc: 1000 locked step + fireballOn calls
const lw = mkWorld(), lsim = createFireballSim({ state: {}, forEachEntity() {}, raySegmentRay() { return false; } }, events, FIREBALL_CFG, tg, { spendMana: () => true, isEnabled: () => fireballOn(lw, LOCKED) });
for (let i = 0; i < 200; i++) { lsim.step(pl, i % 5 === 0, 1, 0, 1, 0, 0); fireballOn(lw, LOCKED); }
global.gc(); const h0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 1000; i++) { lsim.step(pl, i % 5 === 0, 1, 0, 1, 0, 0); fireballOn(lw, LOCKED); }
global.gc(); const d = process.memoryUsage().heapUsed - h0;
assert.ok(d < 20000, 'locked path heap delta ' + d);
console.log('fireballUnlock: locked cast, unlock once, no-op repeat, save round-trip, old save, override, 0 alloc PASS');
