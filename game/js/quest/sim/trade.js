// game/js/quest/sim/trade.js (CUR-03, currency epic D-121). Pure, UI-free trade rules for Bram the post-keeper.
// No world, no events, no module state, no Math.random. The wallet is a plain number passed in (CUR-01 owns the real one);
// `pack` is the player's inventory component (inventory.js); `state` is the saved trade state `{sold: {id: true}}`
// (store it as `game.tradeSold`; plain JSON, so it round-trips through save/load).
import { addItem, removeItem, countOf } from './inventory.js';

/** Kinds Bram never buys, whatever the def says. Items without a positive `value` are unsellable too (quest materials). */
export const NEVER_SELL_KINDS = Object.freeze(['key', 'upgrade', 'spell', 'weapon', 'tool', 'currency', 'pickup']);

/** Fresh trade state. */
export function createTradeState() { return { sold: {} }; }

/** Restores state from saved JSON (unknown / malformed input gives a fresh state). */
export function loadTradeState(raw) {
  const s = createTradeState();
  if (raw && typeof raw === 'object' && raw.sold && typeof raw.sold === 'object') {
    for (const k of Object.keys(raw.sold)) if (raw.sold[k]) s.sold[k] = true;
  }
  return s;
}

/** What Bram pays for one `id`: floor(value / 4), min 1; 0 = he will not buy it. */
export function sellPrice(defs, id) {
  const d = defs[id];
  if (!d || NEVER_SELL_KINDS.includes(d.kind) || !(d.value > 0)) return 0;
  return Math.max(1, Math.floor(d.value / 4));
}

/** Stock rows still on offer (once-only rows that were bought are gone). */
export function availableStock(trade, state) {
  return trade.stock.filter((r) => !(r.once && state.sold[r.item]));
}

/**
 * Buys stock row `row` (an entry of trade.stock). On failure nothing changes.
 * @returns {{ok: true, wallet: number, spent: number} | {ok: false, wallet: number, reason: string}}
 */
export function buy(wallet, pack, defs, state, row) {
  const fail = (reason) => ({ ok: false, wallet, reason });
  if (!row || !defs[row.item]) return fail('Not for sale');
  if (row.once && state.sold[row.item]) return fail('Sold out');
  if (!(wallet >= row.price)) return fail('Not enough coin');
  const got = addItem(pack, defs, row.item, row.n);
  if (got < row.n) { if (got > 0) removeItem(pack, row.item, got); return fail('Your pack is full'); } // roll back a partial add
  if (row.once) state.sold[row.item] = true;
  return { ok: true, wallet: wallet - row.price, spent: row.price };
}

/**
 * Sells `n` (default 1) of item `id` from the pack. On failure nothing changes.
 * @returns {{ok: true, wallet: number, earned: number} | {ok: false, wallet: number, reason: string}}
 */
export function sell(wallet, pack, defs, id, n = 1) {
  const fail = (reason) => ({ ok: false, wallet, reason });
  const d = defs[id];
  if (!d) return fail('Not for sale');
  const each = sellPrice(defs, id);
  if (!each) return fail(d.name + ' cannot be sold');
  if (!(n >= 1) || countOf(pack, id) < n) return fail('You do not have that');
  removeItem(pack, id, n);
  return { ok: true, wallet: wallet + each * n, earned: each * n };
}
