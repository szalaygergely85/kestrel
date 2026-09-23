// engine/entities/handle.test.js (US-025, docs/architecture.md 10.1).
// Headless Node ESM, no framework. Run: node engine/entities/handle.test.js
import { World } from '../world/World.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

function freshWorld() {
  const w = new World();
  w.terrain = null;
  w.state = {};
  return w;
}

// --- cache identity: the same handle object for the same id until remove ---
{
  const w = freshWorld();
  const h1 = w.spawn('npc', { x: 0, y: 0, z: 0 }, {}, 'guard1');
  const h2 = w.get('guard1');
  ok('get(id) returns the SAME handle object as spawn()', h1 === h2);
}

// --- chaining ----------------------------------------------------------------
{
  const w = freshWorld();
  const h = w.spawn('npc', { x: 0, y: 0, z: 0 }, {}, 'guard2');
  const ret = h.setComponent('tags', ['a']).lookAt(1, 0);
  ok('mutators return `this` (chainable)', ret === h);
}

// --- lookAt compass: N/E/S/W = 0/90/180/270 -----------------------------------
{
  const w = freshWorld();
  const h = w.spawn('npc', { x: 0, y: 0, z: 0 }, {}, 'compass');
  h.lookAt(0, -10); // north
  ok('lookAt north == 0 deg', Math.abs(h.data.transform.yawDeg - 0) < 1e-6, h.data.transform.yawDeg);
  h.lookAt(10, 0); // east
  ok('lookAt east == 90 deg', Math.abs(h.data.transform.yawDeg - 90) < 1e-6, h.data.transform.yawDeg);
  h.lookAt(0, 10); // south
  ok('lookAt south == 180 deg', Math.abs(h.data.transform.yawDeg - 180) < 1e-6, h.data.transform.yawDeg);
  h.lookAt(-10, 0); // west
  ok('lookAt west == 270 deg', Math.abs(h.data.transform.yawDeg - 270) < 1e-6, h.data.transform.yawDeg);
}

// --- dead handle: no-op + exactly one warn ------------------------------------
{
  const w = freshWorld();
  const h = w.spawn('npc', { x: 0, y: 0, z: 0 }, {}, 'ghost');
  h.remove();
  ok('handle is dead after remove()', h.alive === false);
  ok('world.get(id) is null after remove()', w.get('ghost') === null);

  let warnCount = 0;
  const origWarn = console.warn;
  console.warn = (...args) => { warnCount++; origWarn(...args); };
  h.setComponent('x', 1);
  h.lookAt(1, 1);
  h.moveTo(1, 1);
  console.warn = origWarn;
  ok('dead handle: calls are no-ops (no throw) and warn exactly once total', warnCount === 1, `warnCount=${warnCount}`);
}

// --- ring overflow drops + counts ---------------------------------------------
{
  const w = freshWorld();
  const h = w.spawn('npc', { x: 0, y: 0, z: 0 }, {}, 'ringtest');
  let received = 0;
  h.on('interact', () => { received++; });
  for (let i = 0; i < 300; i++) w._emit('ringtest', 'interact', i);
  w.flushEvents();
  ok('ring overflow: dropped count is tracked', w._eventRing.dropped === 300 - 256, `dropped=${w._eventRing.dropped}`);
  ok('ring overflow: exactly the retained events were dispatched', received === 256, `received=${received}`);
}

// --- a listener that spawns/removes during flush is safe ----------------------
{
  const w = freshWorld();
  const h1 = w.spawn('npc', { x: 0, y: 0, z: 0 }, {}, 'a');
  let spawned = null;
  let threw = false;
  h1.on('interact', () => {
    try {
      spawned = w.spawn('npc', { x: 1, y: 1, z: 0 }, {}, 'b');
      h1.remove();
    } catch (err) { threw = true; }
  });
  w._emit('a', 'interact', null);
  w.flushEvents();
  ok('a listener spawning/removing during flush does not throw', !threw);
  ok('the spawned entity exists after the flush', spawned && w.get('b') !== null);
  ok('the removed entity is gone after the flush', w.get('a') === null);
}

// --- deterministic ids ---------------------------------------------------------
{
  const w = freshWorld();
  const h1 = w.spawn('npc', { x: 0, y: 0, z: 0 }, {});
  const h2 = w.spawn('npc', { x: 0, y: 0, z: 0 }, {});
  ok('auto ids are deterministic (type_0, type_1, ...)', h1.id === 'npc_0' && h2.id === 'npc_1', `${h1.id}, ${h2.id}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
