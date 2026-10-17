// CUR-01: wallet unit + hand-in reward (pays once) + quest format coin validation. Run: node game/js/quest/sim/wallet.test.js
import assert from 'node:assert/strict';
import { createWallet, coinText, MAX_COIN } from './wallet.js';
import { createQuestPickups } from '../../questPickups.js';
import { validateGiverQuest } from './questBook.js';
import { createSaveRelay } from '../../saveRelay.js';
import { readFileSync } from 'node:fs';
import { World, AssetRegistry } from '../../../../engine/index.js';
import { ensureInventory } from './inventory.js';

const ch = []; const w = createWallet(5, (v, d) => ch.push([v, d]));
assert.equal(w.get(), 5); assert.equal(w.add(20), 20); assert.equal(w.value, 25);
assert.equal(w.spend(30), false); assert.equal(w.value, 25, 'spend refuses below 0, no change');
assert.equal(w.spend(25), true); assert.equal(w.value, 0);
assert.equal(w.spend(1), false); assert.equal(w.add(-3), 0); assert.equal(w.add(1.5), 0); assert.equal(w.spend(0), false);
assert.deepEqual(ch, [[25, 20], [0, -25]], 'onChange only on real changes');
assert.equal(createWallet(-4).get(), 0); assert.equal(createWallet(1e9).get(), MAX_COIN);
const c = createWallet(MAX_COIN - 1); assert.equal(c.add(10), 1, 'clamped at max');
assert.equal(coinText(1), '+1 coin'); assert.equal(coinText(20), '+20 coins');

// Run the production drop hook with its host dependencies; no browser bootstrap needed.
{
  const source = readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
  const hook = source.split('\n').find(line => line.trim().startsWith("engine.events.on('coin:drop',"));
  assert.ok(hook, 'production coin drop hook exists');
  const bind = new Function('engine', 'saveRelay', 'lootToast', 'coinText', hook);
  const wallet = createWallet(MAX_COIN - 1), messages = [];
  let drop;
  const engine = { events: { on(name, fn) { assert.equal(name, 'coin:drop'); drop = fn; } } };
  bind(engine, {wallet}, {say(text) {messages.push(text);}}, coinText);
  drop({n:20});
  assert.equal(wallet.get(), MAX_COIN);
  assert.deepEqual(messages, ['+1 coin'], 'capped drop toast reports actual gain');
  drop({n:20}); drop({n:-1}); drop({n:1.5}); drop(null);
  assert.deepEqual(messages, ['+1 coin'], 'full wallet/invalid drop has no toast');
  wallet.set(0);
  bind(engine, {wallet}, null, coinText);
  drop({n:20}); assert.equal(wallet.get(),20,'missing toast view still receives coin');
}

// grantReward pays coin once per call, items unchanged, emits coin:got
{
  const ev = []; const wl = createWallet(0);
  const qp = createQuestPickups({ getBook: () => null, feed() {}, defs: { rock: { name: 'Rock', stackMax: 9 } }, wallet: wl });
  qp.onBoot({ world: { forEachEntity() {}, addInteractable() {}, removeInteractable() {} }, events: { emit: (n, d) => ev.push([n, d]) }, state: {}, inventory: ensureInventory({}, null), player: { transform: { x: 0, y: 0, z: 0 } } });
  assert.equal(qp.grantReward({ items: [{ id: 'rock', n: 2 }], coin: 20 }), 1);
  assert.equal(wl.get(), 20); assert.ok(ev.some(([n, d]) => n === 'coin:got' && d.n === 20));
  qp.grantReward({ items: [] }); assert.equal(wl.get(), 20, 'no coin field -> no change');
}

// quest format: rewards.coin survives the normaliser; bad coin throws
{
  const base = JSON.parse(readFileSync(new URL('../../../../content/quests/under.graves.quest.json', import.meta.url)));
  const def = (coin) => ({ ...base, rewards: { ...base.rewards, coin } });
  assert.throws(() => validateGiverQuest(def(-3)), /invalid reward coin/);
  assert.throws(() => validateGiverQuest(def(2.5)), /invalid reward coin/);
  assert.equal(validateGiverQuest(def(20)).reward.coin, 20);
}

// save relay: wallet persists through the slot, a fresh/old slot loads 0, a world reload keeps it
{
  const mem = new Map(); const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const assets = new AssetRegistry({ palette: {} });
  const mk = () => World.load({ name: 'w', terrain: null, structures: [], entities: [], state: {} }, assets, {});
  const questDef = JSON.parse(readFileSync(new URL('../../../../content/quests/m1.quest.json', import.meta.url)));
  const bus = []; const events = { on: () => () => {}, emit: (n, d) => bus.push([n, d]) };
  const A = createSaveRelay({ storage, questDef, giverDefs: [] });
  A.bindEvents(events); A.onWorldLoaded();
  const world = mk(); world.spawn('unit', { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 }, { health: { hp: 3, max: 5, invuln: 0 } }, 'player');
  assert.equal(A.wallet.get(), 0);
  A.wallet.add(42); assert.deepEqual(bus.at(-1), ['wallet:changed', { value: 42, delta: 42 }]);
  A.onWorldLoaded(); assert.equal(A.wallet.get(), 42, 'world reload / death restart keeps coin');
  assert.ok(A.save(world)); 
  const B = createSaveRelay({ storage, questDef, giverDefs: [] }); B.bindEvents(events);
  const w2 = B.load(assets, {}); assert.ok(w2); B.onWorldLoaded(); assert.equal(B.wallet.get(), 42, 'save round trip');
  const raw = JSON.parse(mem.get([...mem.keys()][0])); delete raw.game.coin; mem.set([...mem.keys()][0], JSON.stringify(raw));
  const C = createSaveRelay({ storage, questDef, giverDefs: [] }); C.wallet.add(7);
  assert.ok(C.load(assets, {})); C.onWorldLoaded(); assert.equal(C.wallet.get(), 0, 'old save -> 0');
}
console.log('wallet: ok');
