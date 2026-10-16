// Run: node game/js/quest/offerToast.test.js
import assert from 'node:assert/strict';
import { createOfferToast } from './offerToast.js';
const book = { version: 1, offers: [{ id: 'q.a', giver: 'burl', from: 'x' }], nextOffers() { return this.offers; } };
const name = (g) => g.toUpperCase();
const t = createOfferToast(book, name);
t.seed();
assert.deepEqual(t.poll(), [], 'existing offer at load: no toast');
book.version++; // change that adds nothing
assert.deepEqual(t.poll(), [], 'unchanged offers: no toast');
book.offers = [...book.offers, { id: 'q.b', giver: 'mara', from: 'q.a' }]; // hand-in / main step derives a new offer
assert.deepEqual(t.poll(), [], 'same version (nothing changed in the book): no re-derive');
book.version++;
assert.deepEqual(t.poll(), ['New quest: MARA has work for you'], 'new derived offer toasts once');
book.version++;
assert.deepEqual(t.poll(), [], 'not again');
book.offers = []; book.version++; t.poll(); book.offers = [{ id: 'q.b', giver: 'mara', from: 'q.a' }]; book.version++;
assert.deepEqual(t.poll(), [], 'an offer that reappears does not re-toast');
t.seed(); book.offers = [{ id: 'q.c', giver: 'x', from: 'q' }]; book.version++;
assert.equal(t.poll().length, 1, 'after a reload seed, only truly new offers toast');
console.log('ALL PASS');
// allocProbe: unchanged-version polls return the one scratch array (no new [] per frame)
{ const b2 = { version: 1, nextOffers() { return []; } }, t2 = createOfferToast(b2, name); t2.seed();
  const a = t2.poll(); for (let i = 0; i < 1000; i++) assert.equal(t2.poll(), a, 'poll reuses one scratch array'); assert.equal(a.length, 0); }
