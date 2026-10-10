// QL-08 heart pieces. Run: node game/js/quest/sim/heartPieces.test.js
import assert from 'node:assert/strict';
import { collect, reconcile, quarters, PIECE_ID, HEART_HP } from './heartPieces.js';
import { ensureInventory, addItem, countOf } from './inventory.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import itemsMod from '../../../../design/items.js';

await loadTestAssets(); itemsMod;
const defs = globalThis.ASSETS.items.defs;
const pl = () => ({ components: {} }), inv = () => ensureInventory(pl(), null);
const give = (i, n) => assert.equal(addItem(i, defs, PIECE_ID, n), n);

{ // pieces 1-3 count, never stay in the pack; the 4th raises max once and fills
  const i = inv(), h = { hp: 12, max: 30 }, st = {};
  give(i, 1); let r = collect(i, h, st);
  assert.deepEqual([r.n, r.count, r.hearts, h.max, countOf(i, PIECE_ID)], [1, 1, 0, 30, 0]);
  give(i, 2); r = collect(i, h, st);
  assert.deepEqual([r.count, r.hearts, h.max, h.hp, quarters(st)], [3, 0, 30, 12, 3]);
  give(i, 1); r = collect(i, h, st);
  assert.deepEqual([r.count, r.hearts, h.max, h.hp, quarters(st)], [4, 1, 30 + HEART_HP, 40, 0]);
  assert.equal(collect(i, h, st), null);
}
{ // 8 pieces = +2 hearts; pickup of 5 at once = +1 and 1 left over
  const i = inv(), h = { hp: 30, max: 30 }, st = {};
  for (let k = 0; k < 8; k++) { give(i, 1); collect(i, h, st); }
  assert.equal(h.max, 30 + 2 * HEART_HP);
  const h2 = { hp: 30, max: 30 }, st2 = {}; const i2 = inv();
  give(i2, 3); collect(i2, h2, st2); give(i2, 2); const r = collect(i2, h2, st2);
  assert.deepEqual([r.hearts, r.count, h2.max, quarters(st2)], [1, 1, 40, 1]);
}
{ // reconcile never lowers, restores a missing bonus
  const h = { hp: 30, max: 30 }; reconcile(h, { 'hearts.bonus': 2 }, 30); assert.equal(h.max, 50);
  reconcile(h, { 'hearts.bonus': 1 }, 30); assert.equal(h.max, 50);
}
console.log('heartPieces.test OK');
