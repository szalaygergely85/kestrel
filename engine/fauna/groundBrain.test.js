// WILD-04 tests: ground brain with a fake FaunaEnv (no world).
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.js';
import { compileFaunaDef } from './faunaDef.js';
import { FIXTURE_FX, fixtureModels } from './wildlifeFx.fixture.js';
import { extendGroundSlot, initGroundAnimal, groundStep, ST_IDLE, ST_ALERT, ST_FLEE, ST_RETURN, walkable } from './groundBrain.js';
import { createFauna } from './fauna.js';

const def = compileFaunaDef(FIXTURE_FX, fixtureModels());
const rabbit = def.species[0], deer = def.species[1];

function makeEnv(opts = {}) {
  return {
    groundAt: () => 0, slopeZ: () => 1,
    habitatAt: (x) => (opts.water && x > opts.water[0] && x < opts.water[1] ? 0 : 1),
    blocked: (x, y, r) => !!opts.disc && Math.hypot(x - opts.disc.x, y - opts.disc.y) < opts.disc.r + r,
    moveCircle: (x, y, dx, dy, r, out) => { out.x = x + dx; out.y = y + dy; },
    perchNear: () => false,
  };
}
function mkctx(env, n, seed = 1) {
  const slots = [];
  for (let i = 0; i < n; i++) {
    slots.push(extendGroundSlot({ id: i, alive: false, group: 1, x: 0, y: 0, z: 0, yaw: 0, homeX: 0, homeY: 0, state: 0,
      stateT: 0, speed: 0, gait: 0, leashMode: 0, leashT: 0, fx: 0, fy: 1, coneCos: -0.5, range: 0, hearR: 0, homeR: 0 }));
  }
  return { env, player: { x: 100, y: 0, sprinting: false }, rng: createRng(seed), slots, n, tick: 0, dt: 1 / 60 };
}
function spawn(ctx, i, sp, x, y, group = 1) {
  const s = ctx.slots[i];
  s.alive = true; s.group = group; s.x = x; s.y = y; s.homeX = x; s.homeY = y; s.yaw = 0;
  initGroundAnimal(s, sp, null);
  return s;
}
function run(ctx, sp, secs, fn) {
  const steps = Math.round(secs * 60);
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < ctx.n; k++) groundStep(ctx.slots[k], sp, ctx);
    ctx.tick++;
    if (fn) fn(i);
  }
}

// 1. calm: idles / grazes / wanders near home
{
  const ctx = mkctx(makeEnv(), 1); const r = spawn(ctx, 0, rabbit, 0, 0);
  const seen = new Set(); run(ctx, rabbit, 60, () => seen.add(r.state));
  assert.ok(!seen.has(ST_ALERT) && !seen.has(ST_FLEE));
  assert.ok(seen.size >= 2);
  assert.ok(Math.hypot(r.x, r.y) <= rabbit.flee.maxDistM);
}

// 2. notice -> alert -> flee as a walking player approaches
{
  const ctx = mkctx(makeEnv(), 1); const r = spawn(ctx, 0, rabbit, 0, 0);
  ctx.player.x = 11.5; run(ctx, rabbit, 2);
  assert.equal(r.state, ST_IDLE); assert.ok(r.watch, 'turned to watch at notice distance');
  ctx.player.x = 8; run(ctx, rabbit, 0.5); assert.equal(r.state, ST_ALERT);
  ctx.player.x = 4; run(ctx, rabbit, 0.5); assert.equal(r.state, ST_FLEE);
}
// sprinting: heard behind its back at the notice distance; flees from fleeIfRunning, a walker at 8.5 m does not
{
  const ctx = mkctx(makeEnv(), 1); const r = spawn(ctx, 0, rabbit, 0, 0); r.yaw = Math.PI;
  ctx.player.x = 11; ctx.player.sprinting = true; run(ctx, rabbit, 0.5);
  assert.ok(r.watch || r.state === ST_ALERT, 'noticed the sprinter');
  ctx.player.x = 8.5; run(ctx, rabbit, 0.5); assert.equal(r.state, ST_FLEE, 'fleeIfRunning');
  const c2 = mkctx(makeEnv(), 1); const r2 = spawn(c2, 0, rabbit, 0, 0);
  c2.player.x = 8.5; run(c2, rabbit, 0.5);
  assert.notEqual(r2.state, ST_FLEE);
}

// 3. flees past the flee radius, rate stays in rate[], returns home when safe
{
  const ctx = mkctx(makeEnv(), 1); const r = spawn(ctx, 0, rabbit, 0, 0);
  ctx.player.x = 3;
  let rateOk = true;
  run(ctx, rabbit, 4, () => {
    if (r.state === ST_FLEE) { const g = rabbit.gaits[r.gait]; if (r.clip.rate < g.rate[0] - 1e-9 || r.clip.rate > g.rate[1] + 1e-9) rateOk = false; }
  });
  assert.equal(r.state, ST_FLEE);
  assert.ok(Math.hypot(r.x - 3, r.y) > 5);
  assert.ok(rateOk, 'gait rate within rate[]');
  ctx.player.x = 500; run(ctx, rabbit, 1); assert.equal(r.state, ST_RETURN);
  assert.equal(r.despawnReq, true);
  run(ctx, rabbit, 40);
  assert.ok(Math.hypot(r.x, r.y) <= r.homeR + 0.5, 'back home');
  assert.notEqual(r.state, ST_RETURN); assert.equal(r.despawnReq, false);
}

// 4. a threat during RETURN still forces a flee
{
  const ctx = mkctx(makeEnv(), 1); const r = spawn(ctx, 0, rabbit, 0, 0);
  ctx.player.x = 3; run(ctx, rabbit, 3); ctx.player.x = 500; run(ctx, rabbit, 1.5);
  assert.equal(r.state, ST_RETURN);
  ctx.player.x = r.x - 3; ctx.player.y = r.y; run(ctx, rabbit, 0.5);
  assert.equal(r.state, ST_FLEE);
}

// 5. group alarm within 15 m, not beyond
{
  const ctx = mkctx(makeEnv(), 3);
  const a = spawn(ctx, 0, rabbit, 0, 0, 7), b = spawn(ctx, 1, rabbit, 14, 0, 7), c = spawn(ctx, 2, rabbit, 30, 0, 7);
  ctx.player.x = -3; ctx.player.y = 0;
  run(ctx, rabbit, 1.2);
  assert.equal(a.state, ST_FLEE); assert.equal(b.state, ST_FLEE, 'member within 15 m flees'); assert.notEqual(c.state, ST_FLEE);
}

// 6. blocked disc and water strip are never entered while fleeing
{
  const env = makeEnv({ disc: { x: 8, y: 0, r: 2 }, water: [14, 18] });
  const ctx = mkctx(env, 1); const r = spawn(ctx, 0, rabbit, 0, 0);
  ctx.player.x = -3; ctx.player.y = 0.2; let bad = 0, maxX = 0;
  run(ctx, rabbit, 10, () => { if (!walkable(env, rabbit, r.x, r.y)) bad++; maxX = Math.max(maxX, r.x); });
  assert.equal(bad, 0); assert.ok(maxX > 3, 'moved'); assert.ok(maxX < 14, 'did not cross the water');
}

// 7. stuck rule: cornered at a wall the animal turns instead of pushing on
{
  const env = makeEnv(); env.blocked = (x) => x > 2;
  const ctx = mkctx(env, 1); const r = spawn(ctx, 0, rabbit, 0, 0);
  ctx.player.x = -3; let turned = false;
  run(ctx, rabbit, 5, () => { if (r.biasT > 0 || Math.abs(r.goalYaw) > 0.4) turned = true; });
  assert.ok(r.x <= 2.01); assert.ok(turned, 'stuck/feeler turn happened');
}

// 8. far animals decide at 2 Hz (thinkDt accumulates ~0.5 s), near ones at 10 Hz
{
  const ctx = mkctx(makeEnv(), 1); const r = spawn(ctx, 0, rabbit, 0, 0);
  ctx.player.x = 200; run(ctx, rabbit, 0.2);
  let maxFar = 0; run(ctx, rabbit, 2, () => { maxFar = Math.max(maxFar, r.thinkDt); });
  assert.ok(maxFar > 0.3 && maxFar <= 0.55, `far think interval ${maxFar}`);
  ctx.player.x = 30; run(ctx, rabbit, 1);
  let maxNear = 0; run(ctx, rabbit, 1, () => { maxNear = Math.max(maxNear, r.thinkDt); });
  assert.ok(maxNear <= 0.11, `near think interval ${maxNear}`);
}

// 9. deer: gaits and rate bounds on a chase
{
  const ctx = mkctx(makeEnv(), 1, 5); const d = spawn(ctx, 0, deer, 0, 0);
  ctx.player.x = -10; let ok = true, gallop = false;
  run(ctx, deer, 8, () => {
    if (d.state === ST_FLEE) { const g = deer.gaits[d.gait]; if (d.clip.rate < g.rate[0] - 1e-9 || d.clip.rate > g.rate[1] + 1e-9) ok = false; if (d.gait === 2) gallop = true; }
  });
  assert.ok(ok && gallop);
}

// 10. zero allocation: 40 animals, 1e5 steps
{
  const ctx = mkctx(makeEnv({ disc: { x: 20, y: 5, r: 3 } }), 40, 9);
  const sps = [];
  for (let i = 0; i < 40; i++) { sps.push(i % 2 ? deer : rabbit); spawn(ctx, i, sps[i], (i % 8) * 3, Math.floor(i / 8) * 3, 1 + (i >> 2)); }
  const step = () => { for (let k = 0; k < 40; k++) groundStep(ctx.slots[k], sps[k], ctx); ctx.tick++; };
  for (let i = 0; i < 2000; i++) { ctx.player.x = 12 * Math.sin(i / 300); ctx.player.sprinting = ((i >> 8) & 1) === 1; step(); }
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100000; i++) {
    if ((i & 63) === 0) { ctx.player.x = 12 * Math.sin(i / 700); ctx.player.y = 6 * Math.cos(i / 500); ctx.player.sprinting = ((i >> 9) & 1) === 1; }
    step();
  }
  const grown = process.memoryUsage().heapUsed - before;
  assert.ok(grown < 3e6, `heap grew ${grown} bytes over 1e5 steps`);
}

// 11. createFauna wiring: the spawner hook initialises brains, steps run, animals have valid state
{
  const env = makeEnv();
  const f = createFauna(def, env, { seed: 3, models: fixtureModels() });
  const cam = { x: 0, y: 0, fx: 1, fy: 0, hfovRad: 1.2 };
  const pl = { x: 0, y: 0, sprinting: false };
  for (let i = 0; i < 1200; i++) f.update(1 / 60, pl, cam);
  assert.ok(f.stats.alive > 0, 'something spawned');
  for (const s of f.slots) if (s.alive) assert.ok(s.state >= 0 && s.clip.clip >= 0);
}
console.log('groundBrain.test.js ok');
