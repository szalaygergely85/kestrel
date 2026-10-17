// CHARGEN-16: handLook.retintHand + save round-trip of player.look.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../../../design/palette.js';
import '../../../../design/detail-pass.js';
import '../../../../design/models/particles.js';
await import('../../../../design/models/hand.js');
import { validateRecipe } from '../../../../engine/index.js';
import { retintHand, lookRemap, SKIN_KEYS, LOOK_SUFFIX, lookOrDefault } from './handLook.js';
import { World, AssetRegistry } from '../../../../engine/index.js';
import { collectSave, applySave, validateSave, stringifyGameSave, parseGameSave } from '../save/saveState.js';

const kit = JSON.parse(readFileSync(new URL('../../../../content/chargen/human.charkit.json', import.meta.url)));
const A = globalThis.ASSETS, def = A.viewModels.hand, models = A.voxelModels;
const def0 = lookOrDefault(kit, null);
assert.deepEqual(validateRecipe(kit, def0).errors, [], 'kit default recipe valid');
const before = JSON.stringify([def, Object.fromEntries(Object.values(def.variants).map(n => [n, models[n].voxel.mats]))]);

// golden: default recipe -> every mat key identical to today's hand
const dflt = retintHand(def, def0, kit, models);
const names = Object.values(def.variants);
assert.equal(Object.keys(dflt.models).length, new Set(names).size);
for (const n of names) assert.deepEqual(dflt.models[n + LOOK_SUFFIX].voxel.mats, models[n].voxel.mats, n);
assert.equal(dflt.def.model, def.model + LOOK_SUFFIX);
for (const k of Object.keys(def.variants)) assert.equal(dflt.def.variants[k], def.variants[k] + LOOK_SUFFIX);
assert.equal(JSON.stringify(retintHand(def, def0, kit, models)), JSON.stringify(dflt), 'deterministic');

// other tone: only skin keys change, all 8 per tone; fire keys untouched
const dark = { ...def0, skin: 'dark' };
const r = retintHand(def, dark, kit, models);
const FIRE = new Set(['ember_core', 'flame_mid', 'ember_glow', 'flame_tip', 'skin_char', 'leather', 'rope', 'linen', 'linen_dark']);
let changed = 0;
for (const n of names) {
  const a = models[n].voxel.mats, b = r.models[n + LOOK_SUFFIX].voxel.mats;
  for (const ch of Object.keys(a)) {
    if (SKIN_KEYS.includes(a[ch])) { assert.equal(b[ch], kit.handTint.dark[a[ch]]); assert.notEqual(b[ch], a[ch]); changed++; }
    else assert.equal(b[ch], a[ch], `${n}.${ch} non-skin untouched`);
  }
}
assert.ok(changed >= names.length * 6, 'skin keys retinted');
assert.equal(Object.keys(lookRemap(dark, kit)).length, 8);
// top dye -> sleeve
const dyed = lookRemap({ ...def0, top: { id: 'x', ramp: 'woad' } }, kit);
assert.equal(dyed.linen, 'dye_woad'); assert.equal(dyed.linen_dark, 'dye_woad_dark');
for (const k of Object.keys(dyed)) assert.ok(!FIRE.has('x') && !['ember_core', 'flame_mid', 'ember_glow', 'flame_tip', 'leather'].includes(k));
// no mutation of inputs
assert.equal(JSON.stringify([def, Object.fromEntries(Object.values(def.variants).map(n => [n, models[n].voxel.mats]))]), before, 'inputs untouched');
assert.throws(() => retintHand(def, { ...def0, skin: 'nope' }, kit, models), /handTint/);

// save: round trip, old save -> default, malformed rejected
const assets = new AssetRegistry({ palette: {} });
const world = World.load({ name: 'f', terrain: null, structures: [], entities: [] }, assets, {});
world.spawn('unit', { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 }, { health: { hp: 3, max: 5, invuln: 0 } }, 'player');
const look = { ...def0, skin: 'brown', top: { id: 'tunic', ramp: 'woad' } };
const save = collectSave(world, { look });
const back = applySave(parseGameSave(stringifyGameSave(save)), assets, { defaultLook: def0 });
assert.deepEqual(back.look, look, 'look round-trips');
const old = collectSave(world, {});
assert.equal(old.player, undefined);
assert.deepEqual(applySave(old, assets, { defaultLook: def0 }).look, def0, 'old save -> kit default');
const mal = structuredClone(save); mal.player.look.height = 99;
assert.throws(() => validateSave(mal), /player\.look\.height/);
const mal2 = structuredClone(save); mal2.player.look.top = { id: 3 };
assert.throws(() => validateSave(mal2), /player\.look\.top/);
console.log('handLook: ok');
