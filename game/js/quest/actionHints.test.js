// FS-01. Run: node game/js/quest/actionHints.test.js
import assert from 'node:assert/strict';
import { World, AssetRegistry } from '../../../engine/index.js';
import '../../../design/models/title.js'; // classic script: sets globalThis.ASSETS.uiStyle
import { stepHints, resetHints, currentHintId, setPaletteColors } from './hints.js';
import { stepActionHints, resetActionHints, keyLabel, formatHint } from './actionHints.js';
import { createBindings } from './input/bindings.js';
import { collectSave, applySave } from './save/saveState.js';

const uiStyle = globalThis.ASSETS.uiStyle;
setPaletteColors(uiStyle, new Proxy({}, { get: () => '#ffffff' }));
const assets = new AssetRegistry({ palette: {} });
const mkWorld = () => World.load({ name: 'h', terrain: null, structures: [], entities: [] }, assets, {});
const defs = { 'potion.hp': { kind: 'potion' }, sword: { kind: 'weapon' }, key: { kind: 'key' } };
const hsig = { walking: false, pointerUnlocked: false, moveOrLook: false, run: false, jump: false, pointerLocked: false, mPressed: false };
const mkSig = () => ({ invOpen: false, journalOpen: false, swing: false, block: false, shot: false, swap: false, slotKey: false, questAccepted: false });
const mkPlayer = () => ({ components: {
  inventory: { slots: Array.from({ length: 24 }, () => ({ id: null, n: 0 })) },
  equipment: { main: null, off: null, ranged: null, quiver: null, set: 'melee' } } });
const bind = createBindings();
function run(world, player, sig, secs = 0.1) { stepActionHints(world, uiStyle, bind, player, defs, sig); stepHints(world, uiStyle, secs, hsig); }
function fresh() { resetHints(); resetActionHints(); return { world: mkWorld(), player: mkPlayer(), sig: mkSig() }; }
const row = (id) => uiStyle.hints.find((h) => h.id === id);

// ---- AC1: each hint fires once on its trigger, never after its done action ----
{
  const { world, player, sig } = fresh();
  run(world, player, sig);
  assert.equal(currentHintId(), null, 'nothing yet');
  player.components.inventory.slots[0] = { id: 'key', n: 1 }; run(world, player, sig);
  assert.equal(currentHintId(), 'actItems', 'pickup -> Items hint');
  sig.invOpen = true; run(world, player, sig); sig.invOpen = false;
  for (let i = 0; i < 20; i++) run(world, player, sig, 0.1);
  assert.equal(currentHintId(), null, 'done: window opened fades it');
  player.components.inventory.slots[1] = { id: 'key', n: 1 }; for (let i = 0; i < 20; i++) run(world, player, sig);
  assert.equal(world.state['hints.shown'].filter((x) => x === 'actItems').length, 1, 'never again');

  // never two at once: everything in one step -> FIFO, one at a time, trigger order
  world.state['tower.sword.taken'] = true; player.components.equipment.off = 'shield'; player.components.equipment.main = 'sword';
  player.components.equipment.ranged = 'bow'; sig.questAccepted = true;
  const seen = [];
  for (let i = 0; i < 700; i++) { run(world, player, sig, 0.1); sig.questAccepted = false; const c = currentHintId(); if (c && seen[seen.length - 1] !== c) seen.push(c); }
  assert.deepEqual(seen, ['actJournal', 'actSwing', 'actBlock', 'actDraw', 'actSwap']);
}
// action came first: swing before the hint -> never shown
{
  const { world, player, sig } = fresh();
  sig.swing = true; world.state['tower.sword.taken'] = true; run(world, player, sig); sig.swing = false;
  for (let i = 0; i < 10; i++) run(world, player, sig);
  assert.equal(currentHintId(), null); assert.ok(!world.state['hints.shown'].includes('actSwing'));
}
// potion -> quick bar hint, done by a slot key; save round trip keeps shown/done
{
  const { world, player, sig } = fresh();
  run(world, player, sig); player.components.inventory.slots[3] = { id: 'potion.hp', n: 1 }; run(world, player, sig);
  assert.equal(currentHintId(), 'actItems');
  sig.invOpen = true; run(world, player, sig); sig.invOpen = false;
  for (let i = 0; i < 20; i++) run(world, player, sig);
  assert.equal(currentHintId(), 'actQuickbar');
  sig.slotKey = true; run(world, player, sig); sig.slotKey = false;
  for (let i = 0; i < 20; i++) run(world, player, sig);
  assert.equal(currentHintId(), null);
  assert.ok(world.state['hints.done'].includes('actQuickbar'));
  const loaded = applySave(JSON.parse(JSON.stringify(collectSave(world))), assets).world;
  assert.ok(loaded.state['hints.shown'].includes('actQuickbar') && loaded.state['hints.done'].includes('actQuickbar'));
  resetHints(); resetActionHints();
  const p2 = mkPlayer(), s2 = mkSig();
  run(loaded, p2, s2); p2.components.inventory.slots[1] = { id: 'potion.hp', n: 1 }; run(loaded, p2, s2);
  assert.equal(currentHintId(), null, 'not shown again after load');
}
// steady steps: no per-call allocation
{
  const { world, player, sig } = fresh();
  run(world, player, sig);
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) stepActionHints(world, uiStyle, bind, player, defs, sig);
  assert.ok(process.memoryUsage().heapUsed - before < 1.5e6, 'steady steps do not allocate per call');
}

// ---- AC2: labels from the live bindings, no Esc, <= 38 chars ----
{
  const b2 = createBindings(); assert.ok(b2.rebind('keyboard', 'inventory', 'KeyB').ok);
  assert.deepEqual(formatHint(row('actItems'), b2), { text: '[B] Items', keys: ['[B]'] });
  const { world, player, sig } = fresh();
  run(world, player, sig); player.components.inventory.slots[0] = { id: 'key', n: 1 };
  stepActionHints(world, uiStyle, b2, player, defs, sig);
  assert.equal(row('actItems').text, '[B] Items', 'rebind changes the live row text');
  assert.deepEqual(row('actItems').keys, ['[B]']);
}
assert.equal(keyLabel('Mouse0'), 'LMB'); assert.equal(keyLabel('Mouse2'), 'RMB'); assert.equal(keyLabel('KeyQ'), 'Q'); assert.equal(keyLabel(''), '?');
{
  const rows = uiStyle.hints.filter((h) => h.id.startsWith('act'));
  assert.equal(rows.length, 7);
  for (const r of rows) {
    assert.ok(!/esc/i.test(r.fmt), r.id + ' mentions Esc');
    const f = formatHint(r, bind);
    assert.ok(!/esc/i.test(f.text) && f.text.length <= 38, r.id + ' text: ' + f.text);
    assert.ok(r.fmt.length <= 38 + 12, r.id + ' fmt sane');
  }
  assert.equal(formatHint(row('actDraw'), bind).text, 'Hold [LMB] Draw, release to shoot');
  assert.equal(formatHint(row('actSwap'), bind).text, '[Q] Swap weapon');
  assert.equal(formatHint(row('actBlock'), bind).text, 'Hold [RMB] Block');
}

// ---- AC3: M1 hints unchanged (golden ids + order + text) ----
assert.deepEqual(uiStyle.hints.slice(0, 4).map((h) => h.id), ['move', 'run', 'jump', 'capture']);
assert.deepEqual(uiStyle.storyHints.map((h) => h.id), ['hint.farm.ambush', /* ED-LOGIC-01d logic-raised hint row, added first */ 'burner', 'climb', 'chart', 'grate', 'exit', 'stone', 'combatDodge', 'boundsEdge']);
assert.deepEqual(uiStyle.hints[0].keys, ['WASD', 'Mouse']); assert.equal(uiStyle.hints[2].text, '[Space] Jump');
console.log('actionHints.test: PASS');
