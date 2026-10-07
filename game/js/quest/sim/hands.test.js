// game/js/quest/sim/hands.test.js (HANDS-01b, 37.8a). Headless Node ESM. Run: node --expose-gc game/js/quest/sim/hands.test.js
import { World, serialize, deserialize, createHasher } from '../../../../engine/index.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import itemsMod from '../../../../design/items.js'; // classic script: globalThis.ASSETS.items
import { SWORD_CFG } from '../swordConfig.js';
import { START_DEMO, START_FULL } from '../startConfig.js';
import { createHands, createStubItemSim } from './hands.js';
import { createSwordSim, ST_IDLE, ST_HOLD } from './sword.js';
import { ensureInventory, swapHands, assignHand, addItem } from './inventory.js';

const { assets } = await loadTestAssets();
itemsMod;
const defs = globalThis.ASSETS.items.defs;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function bus() {
  const log = [];
  return { log, emit(n, p) { if (n === 'hands:changed') log.push([n, p.left, p.right]); }, on() { return () => {}; } };
}
function mkPlayer(start) {
  const p = { id: 'player', transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: { body: { grounded: true, speedScale: 1, vx: 0, vy: 0, vz: 0, eyeH: 1.6 } } };
  ensureInventory(p, start);
  return p;
}
const PACK2 = { pack: [{ id: 'sword', n: 1 }, { id: 'spell.fireball', n: 1 }], left: 'sword', right: 'spell.fireball' };
// a recording item sim: counts cancels, remembers its hand, derives tap/hold like the real ones (threshold in steps)
function recItem(threshold) {
  const it = { hand: null, cancels: 0, taps: 0, holds: 0, prev: 0, hold: 0, cancelled: false };
  it.cancel = () => { it.cancels++; it.cancelled = true; };
  it.setHand = (h) => { it.hand = h; };
  it.step = (down) => {
    if (it.cancelled) { it.cancelled = false; it.prev = 0; it.hold = 0; }
    if (down) it.hold++;
    else if (it.prev) { if (it.hold >= threshold) it.holds++; else it.taps++; it.hold = 0; }
    it.prev = down ? 1 : 0;
  };
  return it;
}
function stepAll(hands, items, p, l, r, gate) {
  hands.step(p, l, r, gate);
  for (const id in items) items[id].step(hands.downOf(id));
}

// ---- mapping: LMB -> left, RMB -> right; tap vs hold per item threshold ---------------------------------------
{
  const sw = recItem(24), fb = recItem(36);
  const hands = createHands(bus());
  hands.register('sword', sw); hands.register('spell.fireball', fb);
  const items = { sword: sw, 'spell.fireball': fb };
  const p = mkPlayer(PACK2);
  stepAll(hands, items, p, false, false, true);
  ok('setHand bound on first step', sw.hand === 'left' && fb.hand === 'right', `${sw.hand}/${fb.hand}`);
  ok('handOf', hands.handOf('sword') === 'left' && hands.handOf('spell.fireball') === 'right' && hands.handOf('x') === null);
  stepAll(hands, items, p, true, false, true);
  ok('LMB -> sword only', hands.downOf('sword') && !hands.downOf('spell.fireball'));
  stepAll(hands, items, p, false, true, true);
  ok('RMB -> fireball only', !hands.downOf('sword') && hands.downOf('spell.fireball'));
  stepAll(hands, items, p, false, false, true);
  for (let i = 0; i < 10; i++) stepAll(hands, items, p, true, false, true);
  stepAll(hands, items, p, false, false, true);
  ok('sword 10 steps = tap', sw.taps >= 1 && sw.holds === 0, `${sw.taps}/${sw.holds}`);
  const t0 = sw.taps;
  for (let i = 0; i < 30; i++) stepAll(hands, items, p, true, false, true);
  stepAll(hands, items, p, false, false, true);
  ok('sword 30 steps = hold (24)', sw.holds === 1 && sw.taps === t0);
  const taps0 = fb.taps, holds0 = fb.holds;
  for (let i = 0; i < 30; i++) stepAll(hands, items, p, false, true, true);
  stepAll(hands, items, p, false, false, true);
  ok('fireball 30 steps = tap (36)', fb.taps === taps0 + 1 && fb.holds === holds0);
  for (let i = 0; i < 40; i++) stepAll(hands, items, p, false, true, true);
  stepAll(hands, items, p, false, false, true);
  ok('fireball 40 steps = hold', fb.holds === holds0 + 1);
}
// ---- empty hand does nothing ---------------------------------------------------------------------------------
{
  const sw = recItem(24);
  const hands = createHands(bus());
  hands.register('sword', sw);
  const p = mkPlayer(START_FULL);
  stepAll(hands, { sword: sw }, p, false, false, true);
  for (let i = 0; i < 5; i++) stepAll(hands, { sword: sw }, p, true, true, true);
  ok('empty hands: nothing down', !hands.downOf('sword') && sw.taps === 0 && sw.hand === null);
}
// ---- gate close cancels a held charge; re-arm only after button up -------------------------------------------
{
  const sw = recItem(24);
  const hands = createHands(bus());
  hands.register('sword', sw);
  const it = { sword: sw };
  const p = mkPlayer({ pack: [{ id: 'sword', n: 1 }], left: 'sword', right: null });
  stepAll(hands, it, p, false, false, true);
  for (let i = 0; i < 40; i++) stepAll(hands, it, p, true, false, true);
  const c0 = sw.cancels;
  stepAll(hands, it, p, true, false, false);
  ok('gate close cancels the item', sw.cancels > c0 && !hands.downOf('sword'));
  stepAll(hands, it, p, false, false, false);
  ok('no tap/hold on the closed-gate release', sw.holds === 0 && sw.taps === 0, `${sw.taps}/${sw.holds}`);
  stepAll(hands, it, p, true, false, true);
  stepAll(hands, it, p, true, false, true);
  ok('button held through the reopen: not armed', !hands.downOf('sword'));
  stepAll(hands, it, p, false, false, true); stepAll(hands, it, p, true, false, true);
  ok('armed after seeing the button up', hands.downOf('sword'));
  const c1 = sw.cancels;
  hands.disarm();
  ok('disarm() cancels', sw.cancels > c1);
}
// ---- swap / change: cancel + setHand + one event; one item never in both hands --------------------------------
{
  const sw = recItem(24), fb = recItem(36);
  const b = bus();
  const hands = createHands(b);
  hands.register('sword', sw); hands.register('spell.fireball', fb);
  const it = { sword: sw, 'spell.fireball': fb };
  const p = mkPlayer(PACK2);
  stepAll(hands, it, p, false, false, true);
  ok('first step emits hands:changed once', b.log.length === 1 && b.log[0][1] === 'sword' && b.log[0][2] === 'spell.fireball');
  stepAll(hands, it, p, false, false, true);
  ok('no change, no event', b.log.length === 1);
  const c0 = sw.cancels;
  hands.swap();
  stepAll(hands, it, p, false, false, true);
  ok('swap: event, setHand, cancel', b.log.length === 2 && b.log[1][1] === 'spell.fireball' && sw.hand === 'right' && fb.hand === 'left' && sw.cancels > c0);
  stepAll(hands, it, p, false, true, true);
  ok('after swap RMB drives the sword', hands.downOf('sword') && !hands.downOf('spell.fireball'));
  stepAll(hands, it, p, false, false, true);
  const inv = p.components.inventory;
  assignHand(inv, 'left', 'sword');
  stepAll(hands, it, p, false, false, true);
  ok('assignHand: sword left, never in both', hands.handOf('sword') === 'left' && inv.right !== 'sword');
  swapHands(inv); swapHands(inv);
  inv.left = 'sword'; inv.right = 'sword'; // corrupt data
  stepAll(hands, it, p, false, false, true);
  ok('corrupt both-hands data: the left one wins', hands.handOf('sword') === 'left' && hands.handOf('spell.fireball') === null);
}
// ---- real sword sim, either hand, through the router ----------------------------------------------------------
{
  function swingHits(slot) {
    const pl = mkPlayer({ pack: [{ id: 'sword', n: 1 }], left: slot === 'left' ? 'sword' : null, right: slot === 'right' ? 'sword' : null });
    const tr = { id: 't', transform: { x: 0, y: 1.0, z: 0.9 }, components: { targetable: { radius: 0.3, height: 1.6 } } };
    const entities = [pl, tr];
    const world = { state: { 'tower.sword.taken': true }, forEachEntity(fn) { entities.forEach(fn); }, raySegment() { return false; } };
    const hits = [];
    const ev = { on() { return () => {}; }, emit(n, p) { if (n === 'combat:hit') hits.push(p.target); } };
    const sim = createSwordSim(world, ev, SWORD_CFG);
    const hands = createHands(ev);
    hands.register('sword', sim);
    const left = slot === 'left';
    const tick = (l, r) => { hands.step(pl, l, r, true); sim.step(pl, 0, 1, hands.downOf('sword')); };
    for (let i = 0; i < 3; i++) tick(false, false);
    for (let i = 0; i < 3; i++) tick(left, !left);
    for (let i = 0; i < 40; i++) tick(false, false);
    return hits.length;
  }
  ok('sword in the LEFT hand: LMB swing hits', swingHits('left') === 1);
  ok('sword in the RIGHT hand: RMB swing hits', swingHits('right') === 1);

  const pl = mkPlayer({ pack: [{ id: 'sword', n: 1 }], left: 'sword', right: null });
  const world = { state: { 'tower.sword.taken': true }, forEachEntity() {}, raySegment() { return false; } };
  const ev = { on() { return () => {}; }, emit() {} };
  const sim = createSwordSim(world, ev, SWORD_CFG);
  const hands = createHands(ev); hands.register('sword', sim);
  const tick = (l, r) => { hands.step(pl, l, r, true); sim.step(pl, 0, 1, hands.downOf('sword')); };
  for (let i = 0; i < 5; i++) tick(false, true);
  ok('RMB with the sword in the left hand does nothing', sim.state === ST_IDLE);
  for (let i = 0; i < 3; i++) tick(false, false);
  for (let i = 0; i < 3; i++) tick(true, false);
  ok('LMB with the sword in the left hand enters hold', sim.state === ST_HOLD);
  hands.swap();
  tick(true, false);
  ok('swap mid-hold cancels the hold (no swing)', sim.state === ST_IDLE);
}
// ---- save/load round trip of the hands + start states ---------------------------------------------------------
{
  ok('START_DEMO shape', START_DEMO.right === 'spell.fireball' && START_DEMO.left === null && START_DEMO.pack.length === 1);
  ok('START_FULL empty', START_FULL.pack.length === 0 && START_FULL.left === null && START_FULL.right === null);
  const world = new World({ assets });
  world.addEntity({ id: 'player', transform: { x: 1, y: 1, z: 0, yawDeg: 0 }, components: {} });
  const pe = world.get('player').data;
  ensureInventory(pe, START_DEMO);
  addItem(pe.components.inventory, defs, 'sword', 1);
  assignHand(pe.components.inventory, 'left', 'sword');
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(world))), assets, {});
  const inv2 = w2.get('player').data.components.inventory;
  ok('hands round-trip', !!inv2 && inv2.left === 'sword' && inv2.right === 'spell.fireball', JSON.stringify(inv2 && [inv2.left, inv2.right]));
  const hands = createHands(bus()); const sw = recItem(24); hands.register('sword', sw);
  hands.step(w2.get('player').data, false, false, true);
  ok('router rebinds from the loaded inventory', hands.handOf('sword') === 'left' && sw.hand === 'left');
}
// ---- determinism + 0 alloc ------------------------------------------------------------------------------------
{
  function replay() {
    const sw = recItem(24), fb = recItem(36);
    const hands = createHands(bus());
    hands.register('sword', sw); hands.register('spell.fireball', fb);
    const p = mkPlayer(START_DEMO);
    addItem(p.components.inventory, defs, 'sword', 1);
    p.components.inventory.left = 'sword';
    const h = createHasher();
    for (let i = 0; i < 600; i++) {
      const l = (i % 97) < 40, r = (i % 61) < 20, g = (i % 211) < 190;
      if (i === 300) hands.swap();
      stepAll(hands, { sword: sw, 'spell.fireball': fb }, p, l, r, g);
      hands.hashInto(h); h.u32(sw.taps); h.u32(sw.holds); h.u32(fb.taps); h.u32(fb.holds);
    }
    return String(h.value());
  }
  const a = replay(), b = replay();
  ok('600-step L/R replay hash stable twice', a === b && a !== undefined, `${a} vs ${b}`);
  const hands = createHands({ emit() {}, on() { return () => {}; } });
  const s1 = createStubItemSim(), s2 = createStubItemSim();
  hands.register('sword', s1); hands.register('spell.fireball', s2);
  const p = mkPlayer(START_DEMO); p.components.inventory.left = 'sword';
  const run = (n) => { for (let i = 0; i < n; i++) { hands.step(p, (i & 7) < 4, (i & 15) < 8, (i & 255) < 240); s1.step(hands.downOf('sword')); } };
  run(2000);
  if (global.gc) global.gc();
  const m0 = process.memoryUsage().heapUsed;
  run(10000);
  if (global.gc) global.gc();
  const grow = process.memoryUsage().heapUsed - m0;
  ok('0 alloc over 10k steps', grow < 100000, `heap +${grow}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
