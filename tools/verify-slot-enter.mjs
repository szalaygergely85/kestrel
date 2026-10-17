// OB-221: Node check (no browser) that ONE Enter on the New-game slot list starts the game, even when the tap is shorter
// than one sim step (keydown+keyup between steps), using the real Input + titleMenuHost + main.js's menu-step order
// (step -> consumePressed). Run: node tools/verify-slot-enter.mjs   (--port accepted for symmetry, unused: no server)
import assert from 'node:assert/strict';
import { Input } from '../engine/dev.js';
import { createTitleMenuHost } from '../game/js/titleMenuHost.js';

class T { constructor() { this.l = {}; } addEventListener(n, f) { (this.l[n] = this.l[n] || []).push(f); } removeEventListener() {} fire(n, e) { (this.l[n] || []).forEach((f) => f({ preventDefault() {}, ...e })); } }
globalThis.window = globalThis.window || new T();
const adapter = { listSlots: () => [0, 1, 2].map((slot) => ({ slot, ok: true, meta: null })), readSlot: () => ({ ok: false }), deleteSlot: () => ({ ok: true }) };
function fresh(quick) {
  const tt = new T(), inp = new Input(tt); let s = -1;
  const h = createTitleMenuHost({ adapter, onNewGame: (x) => { s = x; }, onContinue() {}, onSettings() {}, createIntro: null });
  const st = () => { const pk = (c) => inp.pressed(c); pk.any = () => inp.anyPressed(); h.step(pk, 1 / 60); inp.consumePressed(); };
  const tp = (code) => { tt.fire('keydown', { code }); if (quick) tt.fire('keyup', { code }); st(); if (!quick) { tt.fire('keyup', { code }); st(); } };
  tp('Enter'); tp('Enter'); return s;
}
assert.equal(fresh(true), 0, 'quick taps: one Enter on the slot starts the game');
assert.equal(fresh(false), 0, 'normal taps: one Enter on the slot starts the game');
console.log('verify-slot-enter OK');
