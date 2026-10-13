import assert from 'node:assert/strict';
import { STAMINA_CONFIG, createStaminaState, stepStamina } from './stamina.js';

const run = (s, sec, inp, cfg, hooks) => { for (let i = 0; i < Math.round(sec * 60); i++) stepStamina(s, 1 / 60, inp, cfg, hooks); };
const near = (a, b, e = 0.5) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

// drain: swim 12 s, dive 6 s
let s = createStaminaState(); run(s, 6, { swimming: true }); near(s.stamina, 50);
s = createStaminaState(); run(s, 3, { diving: true }); near(s.stamina, 50);
// refill 25/s on land
run(s, 1, {}); near(s.stamina, 75);
run(s, 5, {}); assert.equal(s.stamina, 100);
// drown ticks: empty at 12 s, then 1 heart per 1.5 s
s = createStaminaState(); run(s, 12.05, { swimming: true }); assert.equal(s.stamina, 0); assert.equal(s.drowning, true); assert.equal(s.hearts, 3);
run(s, 1.5, { swimming: true }); assert.equal(s.hearts, 2);
// refill cancels
run(s, 0.1, {}); assert.equal(s.drowning, false); assert.equal(s.drownTimer, 0); assert.ok(s.stamina > 0);
// death with cause + hooks
s = createStaminaState(); let deaths = [], dmg = 0;
const hooks = { onDamage: (n, c) => { dmg += n; assert.equal(c, 'drown'); }, onDeath: (c) => deaths.push(c) };
run(s, 12.05 + 4.6, { swimming: true }, STAMINA_CONFIG, hooks);
assert.equal(s.dead, true); assert.equal(s.cause, 'drown'); assert.deepEqual(deaths, ['drown']); assert.equal(dmg, 3);
run(s, 5, { swimming: true }, STAMINA_CONFIG, hooks); assert.equal(deaths.length, 1);
// onDamage returning true (vitals hp reached 0) kills at once
s = createStaminaState(); run(s, 12, { diving: true }, STAMINA_CONFIG); // dive: empty after 6 s
s = createStaminaState(); stepStamina(s, 6.01, { diving: true }); stepStamina(s, 1.5, { diving: true }, STAMINA_CONFIG, { onDamage: () => true, onDeath: (c) => deaths.push(c) });
assert.equal(s.dead, true);
// config override
const cfg = { ...STAMINA_CONFIG, swimDrainSec: 4, drownTickSec: 1, drownDamage: 2, hearts: 4 };
s = createStaminaState(cfg); run(s, 2, { swimming: true }, cfg); near(s.stamina, 50);
run(s, 2.02 + 1, { swimming: true }, cfg); assert.equal(s.hearts, 2); // one tick of 2 hearts
run(s, 1.0, { swimming: true }, cfg); assert.equal(s.dead, true);
console.log('stamina.test OK');
