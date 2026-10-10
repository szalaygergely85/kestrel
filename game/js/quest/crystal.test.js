// CH1-03 crystal grant. Run: node game/js/quest/crystal.test.js
import assert from 'node:assert/strict';
import { createCrystalGrant } from './crystal.js';

function mk(opts = {}) {
  const world = { state: {} }, log = [];
  const g = createCrystalGrant({ world,
    addItem: (id) => { log.push(['add', id]); return opts.full ? false : true; },
    questFlag: (n) => { log.push(['flag', n]); world.state[n] = true; },
    burst: (x, y, z) => log.push(['burst', x, y, z]), toast: (k) => log.push(['toast', k]) });
  return { world, log, g };
}

{ const { g, log } = mk(); // no grant before ready
  assert.equal(g.check('active'), false); assert.equal(g.check({ status: 2 }), false); assert.equal(log.length, 0); }

{ const { g, log, world } = mk(); // granted once, burst at last boar
  g.noteBoar(1, 2, 3); g.noteBoar(4, 5, 6);
  assert.equal(g.check('ready'), true);
  assert.deepEqual(log, [['add', 'aetherCrystal'], ['flag', 'aether.attuned'], ['burst', 4, 5, 6], ['toast', 'toast.crystal.found']]);
  assert.equal(g.check('ready'), false); assert.equal(g.check({ status: 'done' }), false); assert.equal(log.length, 4);
  assert.equal(world.state['aether.attuned'], true); }

{ const { g, log } = mk({ full: true }); // full pack: still attuned
  g.check(3); assert.ok(log.some((e) => e[0] === 'flag')); }

{ const { g, log } = mk(); // self-heal: old save past boars, no corpse known -> no burst
  assert.equal(g.check('done'), true);
  assert.deepEqual(log.map((e) => e[0]), ['add', 'flag', 'toast']); }

{ const { g, world, log } = mk(); world.state['aether.attuned'] = true; // already attuned (saved)
  assert.equal(g.check('ready'), false); assert.equal(log.length, 0); }

{ const { g } = mk(); g.noteBoar(1, 1, 1); g.check('ready'); // 0 alloc per steady-state check
  if (global.gc) { const a = process.memoryUsage().heapUsed; for (let i = 0; i < 1e5; i++) g.check('ready');
    assert.ok(process.memoryUsage().heapUsed - a < 200000); } }

console.log('crystal.test.js OK');
