// WILD-07a tests: flyer brain with a fake FaunaEnv (no world) and a placeholder box model.
// Run: node --expose-gc engine/fauna/flyerBrain.test.js (the alloc check is skipped without --expose-gc).
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.js';
import { compileFaunaDef } from './faunaDef.js';
import { extendFlyerSlot, initFlyerBird, flyerStep, FS_PERCH, FS_TAKEOFF, FS_FLY, FS_FAR } from './flyerBrain.js';

// placeholder: one box part, clips perch/hop/takeoff/flap/glide/land (fixture only, no designer art)
const NAMES = ['perch', 'hop', 'takeoff', 'flap', 'glide', 'land'];
const box = {
  clipIndex: Object.fromEntries(NAMES.map((n, i) => [n, i])),
  clips: NAMES.map(() => ({ n: 2, durMs: new Float64Array([100, 100]) })),
};
const FX = { version: 1, animals: { bird: {
  models: ['box'],
  clipFor: { idle: 'perch', move: 'hop', flee: 'flap' },
  extra: { takeoff: 'takeoff', glide: 'glide', land: 'land' },
  speeds: { hop: 1.2 },
  dist: { notice: 20, alert: 14, flee: 8, fleeIfRunning: 14, safe: 40 },
  times: { hopM: 3 }, blendMs: 100, groupSize: [1, 4],
} } };
const def = compileFaunaDef(FX, { box });
const bird = def.species[0];
assert.equal(bird.kind, 'flyer');

// fake env: flat ground, trees (perch points) on a list; perchNear returns the first tree in the ring
function makeEnv(trees) {
  return {
    groundAt: () => 0, slopeZ: () => 1, habitatAt: () => 1, blocked: () => false,
    moveCircle: (x, y, dx, dy, r, out) => { out.x = x + dx; out.y = y + dy; },
    perchNear(x, y, minR, maxR, out) {
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i], d = Math.hypot(t.x - x, t.y - y);
        if (d >= minR && d <= maxR) { out.x = t.x; out.y = t.y; out.z = t.z; out.tree = i; return true; }
      }
      return false;
    },
  };
}
function mkctx(env, n, seed = 1) {
  const slots = [];
  for (let i = 0; i < n; i++) {
    slots.push(extendFlyerSlot({ id: i, alive: false, species: 0, group: 1, x: 0, y: 0, z: 0, yaw: 0, homeX: 0, homeY: 0,
      state: 0, stateT: 0, speed: 0, fx: 0, fy: 1 }));
  }
  return { env, player: { x: 100, y: 0, sprinting: false }, rng: createRng(seed), slots, n, tick: 0, dt: 1 / 60 };
}
function spawn(ctx, i, x, y, group = 1) {
  const s = ctx.slots[i];
  s.alive = true; s.group = group; s.x = x; s.y = y; s.homeX = x; s.homeY = y; s.yaw = 0;
  initFlyerBird(s, bird, box, ctx.env);
  return s;
}
function run(ctx, secs, fn) {
  const steps = Math.round(secs * 60);
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < ctx.n; k++) flyerStep(ctx.slots[k], bird, ctx);
    ctx.tick++;
    if (fn) fn(i);
  }
}

// trees: one at the bird (spawn perch), one 12 m behind the player side (too near), two far away
const TREES = [{ x: 0, y: 0, z: 9 }, { x: 10, y: 0, z: 8 }, { x: -45, y: 5, z: 10 }, { x: -52, y: -10, z: 7 }];

// 1. spawns perched on the near tree; stays while the player is away
{
  const ctx = mkctx(makeEnv(TREES), 1); const b = spawn(ctx, 0, 1, 1);
  assert.equal(b.state, FS_PERCH); assert.equal(b.tree, 0); assert.equal(b.z, 9);
  run(ctx, 5); assert.equal(b.state, FS_PERCH);
}

// 2. takeoff when the player is within dist.flee; new perch 30-70 m away and >= 15 m farther from the player; lands exactly
{
  const ctx = mkctx(makeEnv(TREES), 1); const b = spawn(ctx, 0, 0, 0);
  ctx.player.x = 6; ctx.player.y = 0;   // 6 m < flee 8
  const d0 = Math.hypot(b.x - ctx.player.x, b.y - ctx.player.y);
  const seen = new Set(); let tLand = -1, vSum = 0, vN = 0;
  run(ctx, 20, (i) => {
    seen.add(b.state);
    if (b.state === FS_FLY) { vSum += b.speed; vN++; }
    if (tLand < 0 && b.state === FS_PERCH && seen.has(FS_FLY)) tLand = i / 60;
  });
  assert.ok(seen.has(FS_TAKEOFF) && seen.has(FS_FLY), 'took off and flew');
  assert.equal(b.state, FS_PERCH); assert.ok(tLand > 0 && tLand < 20);
  const t = TREES[b.tree];
  assert.ok(b.tree === 2 || b.tree === 3);
  assert.ok(Math.hypot(b.x - t.x, b.y - t.y, b.z - t.z) < 0.05, 'landing error < 0.05 m');
  const dist = Math.hypot(t.x - 0, t.y - 0);
  assert.ok(dist >= 30 && dist <= 70, 'perch 30-70 m away: ' + dist);
  assert.ok(Math.hypot(b.x - ctx.player.x, b.y - ctx.player.y) >= d0 + 15, 'perch >= 15 m farther from the player');
  const v = vSum / vN; assert.ok(v >= 6 && v <= 9, 'flight speed ' + v);
}
// sprinting widens the trigger (fleeIfRunning 14): a walker at 11 m does not startle it, a sprinter does
{
  const c1 = mkctx(makeEnv(TREES), 1); const b1 = spawn(c1, 0, 0, 0); c1.player.x = 11; run(c1, 1);
  assert.equal(b1.state, FS_PERCH);
  const c2 = mkctx(makeEnv(TREES), 1); const b2 = spawn(c2, 0, 0, 0); c2.player.x = 11; c2.player.sprinting = true; run(c2, 1);
  assert.notEqual(b2.state, FS_PERCH);
}

// 3. flock: members share the tree, own offset, start delay 0-0.4 s
{
  const ctx = mkctx(makeEnv(TREES), 4);
  for (let i = 0; i < 4; i++) spawn(ctx, i, i * 0.5, 0);
  ctx.player.x = 5;
  run(ctx, 0.2);
  const tree = ctx.slots[0].tree;
  assert.ok(tree >= 2);
  const delays = [];
  for (const s of ctx.slots) { assert.equal(s.tree, tree); assert.ok(s.state >= FS_TAKEOFF); delays.push(s.delayT); }
  assert.ok(ctx.slots.every((s) => s.delayT <= 0.4));
  run(ctx, 25);
  const xs = new Set();
  for (const s of ctx.slots) {
    assert.equal(s.state, FS_PERCH);
    assert.ok(Math.hypot(s.x - TREES[tree].x, s.y - TREES[tree].y) < 2.5, 'near the shared tree');
    xs.add(s.x.toFixed(3));
  }
  assert.equal(xs.size, 4, 'each bird has its own offset');
}

// 4. no perch within reach: fly out of view, then ask to be despawned
{
  const ctx = mkctx(makeEnv([]), 1); const b = spawn(ctx, 0, 0, 0);
  assert.equal(b.state, 11, 'no tree: forages on the ground (HOP)');
  ctx.player.x = 4;
  run(ctx, 0.3);
  assert.ok(b.despawnReq && b.noPerch);
  run(ctx, 30);
  assert.equal(b.state, FS_FAR);
  assert.ok(Math.hypot(b.x - ctx.player.x, b.y - ctx.player.y) > 30, 'past drawM (30 m)');
  assert.ok(b.z > 3, 'left upwards');
}
// trees exist but none farther from the player: same fly-out
{
  const ctx = mkctx(makeEnv([{ x: 0, y: 0, z: 9 }, { x: 30, y: 0, z: 8 }]), 1); const b = spawn(ctx, 0, 0, 0);
  ctx.player.x = 7.9; run(ctx, 25);
  assert.equal(b.state, FS_FAR); assert.ok(b.despawnReq);
}

// 5. zero allocation over 1e5 steps (perch -> flee -> land cycles, flock of 4)
if (typeof global.gc === 'function') {
  const trees = [{ x: 0, y: 0, z: 9 }, { x: -45, y: 5, z: 10 }, { x: 45, y: 5, z: 10 }, { x: 5, y: 50, z: 8 }];
  const ctx = mkctx(makeEnv(trees), 4);
  for (let i = 0; i < 4; i++) spawn(ctx, i, 0.3 * i, 0);
  const cycle = (i) => { // player teleports next to the flock every 20 s
    if (i % 1200 === 0) { ctx.player.x = ctx.slots[0].x + 4; ctx.player.y = ctx.slots[0].y; }
    else if (i % 1200 === 600) { ctx.player.x = 500; }
  };
  run(ctx, 20, (i) => cycle(i)); // warm up the JIT and the clip players
  global.gc();
  const before = process.memoryUsage().heapUsed;
  const steps = 100000;
  for (let i = 0; i < steps; i++) {
    cycle(i);
    for (let k = 0; k < ctx.n; k++) flyerStep(ctx.slots[k], bird, ctx);
    ctx.tick++;
  }
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  assert.ok(grew < 200 * 1024, 'heap growth over 1e5 steps: ' + grew + ' bytes');
  console.log('flyerBrain alloc: heap delta ' + grew + ' bytes over ' + steps + ' steps');
} else console.log('flyerBrain: alloc check skipped (run with --expose-gc)');

console.log('flyerBrain tests passed');
