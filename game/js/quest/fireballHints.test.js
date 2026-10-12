// FB-03. Run: node game/js/quest/fireballHints.test.js
import assert from 'node:assert/strict';
import { World, AssetRegistry } from '../../../engine/index.js';
import '../../../design/models/title.js';
import { stepHints, resetHints, request,currentHintId, setPaletteColors } from './hints.js';
import { stepFireballHints, resetFireballHints, fireText } from './fireballHints.js';
import { createBindings } from './input/bindings.js';
import { collectSave, applySave } from './save/saveState.js';

const uiStyle = globalThis.ASSETS.uiStyle;
setPaletteColors(uiStyle, new Proxy({}, { get: () => '#ffffff' }));
const assets = new AssetRegistry({ palette: {} });
const mkWorld = () => World.load({ name: 'h', terrain: null, structures: [], entities: [] }, assets, {});
const hsig = { walking: false, pointerUnlocked: false, moveOrLook: false, run: false, jump: false, pointerLocked: false, mPressed: false };
const bind = createBindings();
const s = { fbOn: false, hand: 'left', casting: false, manaFlashTick: 0 };
const run = (w, secs = 0.1) => { stepFireballHints(w, uiStyle, bind, s); stepHints(w, uiStyle, secs, hsig); };
const settle = (w) => { const seq = []; for (let i = 0; i < 400; i++) { run(w); const c = currentHintId(); if (c && seq[seq.length - 1] !== c) seq.push(c); } return seq; };

resetHints(); resetFireballHints();
const w = mkWorld();
run(w);
assert.equal(currentHintId(), null, 'locked: no hint');
s.fbOn = true;
assert.deepEqual(settle(w), ['fbCast', 'fbCost'], 'unlock: cast hint then cost hint, in order');
assert.ok(w.state['hints.shown'].includes('fbCast') && w.state['hints.shown'].includes('fbCost'), 'flag persisted in hints.shown');
assert.deepEqual(settle(w), [], 'never again');
// fizzle: needs a casting spell hand and a NEW manaFlashTick
s.manaFlashTick = 5; assert.deepEqual(settle(w), [], 'sword-style short mana (not casting) is ignored');
s.manaFlashTick = 9; s.casting = true;
assert.deepEqual(settle(w), ['fbNoMp'], 'first MP-short cast -> fizzle hint');
s.manaFlashTick = 12; assert.deepEqual(settle(w), [], 'once only');
// FB-HINT-01: another hint on screen at unlock delays fbCast by up to one full hint (<= 8.8 s), never drops it
{
  resetHints(); resetFireballHints(); s.fbOn = false;
  const w3 = mkWorld(); request(w3, uiStyle, 'move'); run(w3, 0.1); assert.equal(currentHintId(), 'move');
  s.fbOn = true; let t = 0, first = null;
  for (; t < 12 && first !== 'fbCast'; t += 0.1) { run(w3); first = currentHintId(); }
  assert.equal(first, 'fbCast', 'fbCast shown after the on-screen hint finished'); assert.ok(t < 9.5, 'within one hint lifetime (' + t.toFixed(1) + ' s)');
  assert.equal(w3.state['hints.shown'].filter((x) => x === 'fbCast').length, 1, 'shown once');
}
// save round trip: shown ids survive
const save = collectSave(w); resetHints(); resetFireballHints();
const w2 = applySave(JSON.parse(JSON.stringify(save)), assets).world;
assert.deepEqual(settle(w2), [], 'after load nothing repeats');
// real binding text, not hard-coded
assert.equal(fireText('[Hold {fire}] x', bind, 'left').text, '[Hold LMB] x');
assert.equal(fireText('[Hold {fire}] x', bind, 'right').text, '[Hold RMB] x');
assert.deepEqual(fireText('[Hold {fire}] x', bind, 'right').keys, ['[Hold RMB]']);
console.log('fireballHints.test.js ok');
