import assert from 'node:assert/strict';
import { enemyBarModel, createEnemyBars, makeBarResult, difficultyShift } from './enemyBar.js';
import { setDifficultyName } from './difficultyFlag.js';

const band = { bandAt: (x, y) => (x < 100 ? 3 : 8) };
const mk = (o = {}) => ({ id: 'b1', name: 'Boar', x: 1, y: 2, z: 3, spawnX: 10, spawnY: 10, hp: 5, maxHp: 10, dead: false, dist: 8, visible: true, engaged: true, targeted: false, hitAt: -Infinity, level: 0, bossName: '', ...o });

let r = enemyBarModel(mk(), band, 0, 3);
assert.ok(r.show); assert.equal(r.frac, 0.5); assert.equal(r.level, 3); assert.equal(r.name, 'Boar'); assert.equal(r.tint, 'gold');
// show rules
assert.ok(!enemyBarModel(mk({ engaged: false }), band, 0).show, 'idle hidden');
assert.ok(enemyBarModel(mk({ engaged: false, targeted: true }), band, 0).show, 'lock-on shows');
assert.ok(enemyBarModel(mk({ engaged: false, hitAt: 6 }), band, 10).show, 'hit 4 s ago shows');
assert.ok(!enemyBarModel(mk({ engaged: false, hitAt: 5.9 }), band, 10).show, 'hit 4.1 s ago hidden');
assert.ok(!enemyBarModel(mk({ hp: 0 }), band, 0).show); assert.ok(!enemyBarModel(mk({ dead: true }), band, 0).show);
assert.ok(!enemyBarModel(mk({ dist: 30.5 }), band, 0).show); assert.ok(enemyBarModel(mk({ dist: 30 }), band, 0).show);
assert.ok(!enemyBarModel(mk({ visible: false }), band, 0).show);
// frac clamp, level override, band from spawn
assert.equal(enemyBarModel(mk({ hp: 50 }), band, 0).frac, 1);
assert.equal(enemyBarModel(mk({ spawnX: 500 }), band, 0, 8).level, 8);
assert.equal(enemyBarModel(mk({ spawnX: 500, level: 2 }), band, 0, 8).level, 2);
assert.equal(enemyBarModel(mk({ level: 99 }), band, 0).level, 10);
// tint
assert.equal(enemyBarModel(mk({ level: 6 }), band, 0, 4).tint, 'danger');
assert.equal(enemyBarModel(mk({ level: 5 }), band, 0, 4).tint, 'gold');
assert.equal(enemyBarModel(mk({ level: 3 }), band, 0, 4).tint, 'gold');
assert.equal(enemyBarModel(mk({ level: 2 }), band, 0, 4).tint, 'uiDim');
// boss
r = enemyBarModel(mk({ bossName: 'The Warden' }), band, 0, 4);
assert.ok(r.boss); assert.equal(r.name, 'The Warden'); assert.equal(r.level, 0);
// determinism + shared object
const a = { ...enemyBarModel(mk(), band, 1, 3) }, b = { ...enemyBarModel(mk(), band, 1, 3) };
assert.deepEqual(a, b);
// select: max 3, engaged first, nearest, id tie-break
const beasts = [
  mk({ id: 'e', dist: 25 }), mk({ id: 'd', dist: 5, engaged: false, targeted: true }), mk({ id: 'c', dist: 9 }),
  mk({ id: 'b', dist: 9 }), mk({ id: 'a', dist: 2 }), mk({ id: 'z', dist: 40 }),
];
const bars = createEnemyBars({ band });
const n = bars.select(beasts.length, (i, rec) => Object.assign(rec, beasts[i]), 0, 3);
assert.equal(n, 3);
assert.deepEqual(bars.list.slice(0, n).map((x) => x.id), ['a', 'b', 'c']);
// every permutation gives the same set (determinism under order)
const rev = beasts.slice().reverse();
bars.select(rev.length, (i, rec) => Object.assign(rec, rev[i]), 0, 3);
assert.deepEqual(bars.list.slice(0, bars.count).map((x) => x.id), ['a', 'b', 'c']);
assert.equal(bars.select(0, () => {}, 0), 0);
// 0 alloc: heap stays flat over many calls
const rec0 = mk(), out = makeBarResult();
if (global.gc) { global.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 200000; i++) enemyBarModel(rec0, band, i, 3, out); global.gc(); assert.ok(process.memoryUsage().heapUsed - h0 < 200000, 'no per-call alloc'); }
console.log('enemyBar.test.js ok');

// HPBAR-03: shown level = band + difficulty shift (Easy -1, Normal 0, Hard +1), clamped 1..10
assert.equal(difficultyShift('easy'), -1); assert.equal(difficultyShift('normal'), 0); assert.equal(difficultyShift('hard'), 1); assert.equal(difficultyShift(undefined), 0);
const lv = (name, o) => { setDifficultyName(name); return enemyBarModel(mk(o), band, 1, 3).level; };
assert.equal(lv('normal', { spawnX: 0 }), 3); assert.equal(lv('easy', { spawnX: 0 }), 2); assert.equal(lv('hard', { spawnX: 0 }), 4);
assert.equal(lv('easy', { level: 1 }), 1); assert.equal(lv('hard', { level: 10 }), 10); assert.equal(lv('hard', { level: 9 }), 10); assert.equal(lv('easy', { level: 2 }), 1);
setDifficultyName('hard'); assert.equal(enemyBarModel(mk({ level: 4 }), band, 1, 3).tint, 'danger'); // 5 vs player 3 = +2 -> red
setDifficultyName('normal');
console.log('HPBAR-03 ok');
