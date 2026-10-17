// npcWalk.test.js (CH1-07): lead wait/resume, barks once, hideAtEnd, ground z, collider follows, 0 alloc.
import assert from 'node:assert/strict';
import { createNpcWalk, WALK_SPEED } from './npcWalk.js';

export function mkWorld(extraComps) {
  const colls = [], hidden = [];
  const ent = { transform: { x: 0, y: 0, z: 0, yawDeg: 0 }, components: Object.assign({
    voxel: { anim: 'idle', hidden: false }, collider: { h: 1.6, r: 0.7, kinematic: true },
    walks: { a: [[0, 0], [10, 0], [20, 0], [30, 0]] }, walkBarks: { a: { 1: 'b1', 3: 'b3' } } }, extraComps) };
  const world = { terrain: { groundAt: (x, y) => 1 + x * 0.1 }, get: (id) => (id === 'n' ? { data: ent } : null),
    setEntityCollider: (id, x, y, z) => { colls.push([x, y, z]); return true; } };
  return { world, ent, colls, hidden };
}
const DT = 1 / 60;
const run = (w, sec, px, py) => { for (let i = 0; i < Math.round(sec * 60); i++) w.step(DT, typeof px === 'function' ? px() : px, py); };

// 0 allocation per step (first: later tests make the step sites polymorphic and box doubles)
{
  const { world } = mkWorld(); world.setEntityCollider = () => true; // the recording mock itself allocates
  const w = createNpcWalk(world, 'n', { barks: { play: () => true } });
  w.start('a', { lead: true });
  w.start('a', { lead: false, speed: 0.001 });
  for (let i = 0; i < 30000; i++) w.step(DT, 3, 0); // warm up the JIT (double fields box until optimised)
  if (global.gc) { // best of 3 rounds (a round can catch JIT boxing of doubles; a real per-step allocation shows in all three)
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      global.gc(); const m1 = process.memoryUsage().heapUsed;
      for (let i = 0; i < 20000; i++) w.step(DT, 3, 0);
      best = Math.min(best, process.memoryUsage().heapUsed - m1);
    }
    assert.ok(best < 100000, 'heap flat: ' + best);
  }
}
// lead: waits when far, resumes only when near
{
  const { world, ent, colls } = mkWorld();
  const played = [];
  const w = createNpcWalk(world, 'n', { barks: { play: (id) => { played.push(id); return true; } } });
  assert.ok(w.start('a', { lead: true }));
  run(w, 2, 0, 0);
  assert.ok(ent.transform.x > 2.5 && ent.transform.x < 4, 'walked ' + ent.transform.x);
  assert.equal(ent.components.voxel.anim, 'walk');
  assert.ok(Math.abs(ent.transform.z - (1 + ent.transform.x * 0.1)) < 1e-9, 'ground z');
  assert.deepEqual(colls[colls.length - 1].map((v) => +v.toFixed(3)), [+ent.transform.x.toFixed(3), 0, +(ent.transform.z).toFixed(3)], 'collider follows');
  // player stays at 0: Burl is > 10 m ahead soon -> waits
  run(w, 10, 0, 0);
  assert.ok(w.waiting && ent.transform.x > 10 && ent.transform.x < 11.5, 'waited at ' + ent.transform.x);
  assert.equal(ent.components.voxel.anim, 'idle');
  const x0 = ent.transform.x; run(w, 3, 0, 0); assert.equal(ent.transform.x, x0, 'stays put');
  run(w, 1, 3, 0); assert.ok(w.waiting, 'still waiting between 6 and 10 m (hysteresis)');
  run(w, 1, 5.5, 0); assert.ok(!w.waiting && ent.transform.x > x0, 'resumes under 6 m');
}
// barks once, hideAtEnd, onArrive
{
  const { world, ent, colls } = mkWorld();
  const played = [], gone = [];
  const w = createNpcWalk(world, 'n', { barks: { play: (id) => { played.push(id); return true; } }, removeInteractable: (id) => gone.push(id) });
  let arrived = 0;
  w.start('a', { lead: false, hideAtEnd: true, onArrive: () => arrived++ });
  run(w, 30, 0, 0); // player far away (30 m behind at the end) -> barks only near
  assert.ok(w.done && !w.active && arrived === 1);
  assert.equal(ent.components.voxel.hidden, true); assert.deepEqual(gone, ['n']);
  assert.ok(colls[colls.length - 1][2] < -100, 'collider parked');
  assert.equal(WALK_SPEED, 1.6);
}
{
  const { world, ent } = mkWorld();
  const played = [];
  const w = createNpcWalk(world, 'n', { barks: { play: (id) => { played.push(id); return true; } } });
  w.start('a', { lead: false });
  run(w, 30, () => ent.transform.x, 0);
  assert.deepEqual(played, ['b1', 'b3'], 'each bark once, in order');
  assert.equal(ent.components.voxel.hidden, false, 'no hideAtEnd -> stays visible');
}
// bark pending until the player is within 8 m; fromWp skips passed barks
{
  const { world, ent } = mkWorld();
  const played = [];
  const w = createNpcWalk(world, 'n', { barks: { play: (id) => { played.push(id); return true; } } });
  w.start('a', { lead: false });
  run(w, 8, -50, 0); assert.deepEqual(played, [], 'player far: pending');
  run(w, 0.2, ent.transform.x, 0); assert.deepEqual(played, ['b1']);
  const w2 = createNpcWalk(world, 'n', { barks: { play: (id) => { played.push(id); return true; } } });
  played.length = 0; w2.start('a', { lead: false, fromWp: 2 });
  assert.equal(w2.wp, 2); assert.equal(ent.transform.x, 20);
  run(w2, 10, () => ent.transform.x, 0); assert.deepEqual(played, ['b3'], 'passed barks never replay');
}
// place / hide / missing walk
{
  const { world, ent } = mkWorld();
  const w = createNpcWalk(world, 'n');
  assert.equal(w.start('nope'), false); assert.equal(createNpcWalk(world, 'zz'), null);
  w.place('a'); assert.equal(ent.transform.x, 30); assert.ok(!w.active);
  w.hide(); assert.equal(ent.components.voxel.hidden, true);
}
console.log('npcWalk ALL PASS');

// BURL-WALK-ANIM-01: the clip goes through EntityHandle.play (walk while moving, idle when waiting/arrived)
{
  const { world, ent } = mkWorld(); const base = world.get;
  const plays = [];
  world.get = (id) => { const h = base(id); return h && { data: h.data, play(a) { plays.push(a); h.data.components.voxel.anim = a; h.data.components.voxel.playing = true; return this; } }; };
  const w = createNpcWalk(world, 'n', {});
  w.start('a', { lead: true, waitFar: 10, resumeNear: 6 });
  run(w, 1, 0, 0);
  assert.equal(ent.components.voxel.anim, 'walk'); assert.equal(plays.at(-1), 'walk');
  run(w, 3, 0, 100); // player far: Burl waits
  assert.equal(w.waiting, true); assert.equal(plays.at(-1), 'idle'); assert.equal(ent.components.voxel.anim, 'idle');
  run(w, 8, () => ent.transform.x, 0); // player at his side: walks on
  assert.equal(plays.at(-1) === 'walk' || w.done, true);
  const n = plays.length; run(w, 0.5, () => ent.transform.x, 0);
  assert.ok(plays.length - n <= 1, 'play is not spammed every step');
}
