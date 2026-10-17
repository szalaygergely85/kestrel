// game/js/quest/sim/trade.test.js (CUR-03). Run: node game/js/quest/sim/trade.test.js
import { readFileSync } from 'node:fs';
import { makeOk } from '../../../../engine/test/assert.js';
import itemsMod from '../../../../design/items.js'; // classic script: side effect on globalThis.ASSETS.items
import { ensureInventory, countOf, addItem, SLOTS } from './inventory.js';
import { buy, sell, sellPrice, availableStock, createTradeState, loadTradeState } from './trade.js';

itemsMod;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const defs = globalThis.ASSETS.items.defs;
const trade = JSON.parse(readFileSync(new URL('../../../../content/economy/trade.json', import.meta.url), 'utf8'));
const row = (id) => trade.stock.find((r) => r.item === id);
const fresh = () => ensureInventory({}, { pack: [], left: null, right: null });

ok(trade.stock.every((r) => defs[r.item] && r.price > 0), 'every stock id exists, price > 0');
ok(row('potion.hp').price === 20 && row('arrow').price === 10 && row('arrow').n === 10 && row('bomb').price === 15, 'consumable prices');
ok(trade.stock.filter((r) => r.once).map((r) => r.price).join() === '80,100,120', 'three once-only gear 80/100/120');

// buy
{
  const pack = fresh(), st = createTradeState();
  let r = buy(50, pack, defs, st, row('potion.hp'));
  ok(r.ok && r.wallet === 30 && countOf(pack, 'potion.hp') === 1, 'buy potion: -20, +1');
  r = buy(10, pack, defs, st, row('arrow'));
  ok(r.ok && r.wallet === 0 && countOf(pack, 'arrow') === 10, 'arrows x10 for 10');
  r = buy(5, pack, defs, st, row('bomb'));
  ok(!r.ok && r.reason === 'Not enough coin' && r.wallet === 5 && countOf(pack, 'bomb') === 0, 'short of coin: refused, no change');
  const full = fresh();
  for (let i = 0; i < SLOTS; i++) { full.slots[i].id = 'boar.tusk'; full.slots[i].n = 20; }
  r = buy(99, full, defs, st, row('bomb'));
  ok(!r.ok && r.reason === 'Your pack is full' && r.wallet === 99 && countOf(full, 'bomb') === 0, 'full pack: refused');
  const near = fresh();
  for (let i = 0; i < SLOTS; i++) { near.slots[i].id = 'boar.tusk'; near.slots[i].n = 20; }
  near.slots[0].id = 'arrow'; near.slots[0].n = 25; // room for 5 only, no empty slot
  r = buy(99, near, defs, st, row('arrow'));
  ok(!r.ok && countOf(near, 'arrow') === 25, 'partial fit rolls back');
}
// once-only gear + save round trip
{
  const pack = fresh(), st = createTradeState(), g = row('gear.body.jerkin.sturdy');
  ok(availableStock(trade, st).length === 6, '6 rows at start');
  let r = buy(500, pack, defs, st, g);
  ok(r.ok && r.wallet === 420 && countOf(pack, g.item) === 1, 'buy gear');
  r = buy(r.wallet, pack, defs, st, g);
  ok(!r.ok && r.reason === 'Sold out' && countOf(pack, g.item) === 1, 'once-only: second buy refused');
  ok(availableStock(trade, st).length === 5, 'gear leaves the stock');
  const st2 = loadTradeState(JSON.parse(JSON.stringify(st)));
  ok(!buy(500, fresh(), defs, st2, g).ok && availableStock(trade, st2).length === 5, 'sold-out survives save/load');
  ok(Object.keys(loadTradeState('x').sold).length === 0 && Object.keys(loadTradeState(null).sold).length === 0, 'bad save -> fresh state');
}
// sell
{
  const pack = fresh();
  addItem(pack, defs, 'boar.hide', 2); addItem(pack, defs, 'berry.blue', 1);
  ok(sellPrice(defs, 'boar.hide') === 3 && sellPrice(defs, 'boar.tusk') === 4 && sellPrice(defs, 'goblin.trinket') === 5 &&
     sellPrice(defs, 'berry.blue') === 1 && sellPrice(defs, 'redcap') === 2 && sellPrice(defs, 'boar.meat') === 2, 'material/food sell prices');
  ok(sellPrice(defs, 'gear.head.hood.worn') === 5 && sellPrice(defs, 'gear.body.jerkin.sturdy') === 15 && sellPrice(defs, 'gear.legs.pants.fine') === 40, 'gear 5/15/40');
  let r = sell(0, pack, defs, 'boar.hide', 2);
  ok(r.ok && r.wallet === 6 && countOf(pack, 'boar.hide') === 0, 'sell 2 hides = 6');
  r = sell(6, pack, defs, 'berry.blue');
  ok(r.ok && r.wallet === 7, 'sprig min 1');
  r = sell(6, pack, defs, 'boar.hide');
  ok(!r.ok && r.wallet === 6, 'cannot sell what you lack');
}
// refused kinds
{
  const pack = fresh();
  for (const id of ['key.small', 'heart.piece', 'spell.fireball', 'sword', 'torch', 'bomb', 'signArm', 'cog']) {
    addItem(pack, defs, id, 1);
    const r = sell(10, pack, defs, id);
    ok(!r.ok && r.wallet === 10 && countOf(pack, id) === 1 && /cannot be sold/.test(r.reason), 'refuse sell ' + id);
  }
}
console.log(`trade: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
