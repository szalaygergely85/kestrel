// game/js/quest/sim/beastSim.a3.test.js (drop rule, perf, determinism). Part of the BEAST-06b split of beastSim.test.js; shared setup in beastSimHarness.js.
import { World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, loadTestAssets, makeOk, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, assets, ok, TOWER_ORIGIN, NAV_CFG, beastEntity, buildWorld, makeEvents, freshSim, groundZ, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R, finish } from './beastSimHarness.js';

void [World, NavGrid, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING, paletteMod, detailPassMod, lanternMod, leverMod, boulderMod, rubbleMod, wreckageMod, relayMod, swordMod, m3PropsMod, terrainMod, boarMod, buildBeastNav, canSee, SWORD_CFG, createSwordSim, ST_HARD, createTargeting, createVitals, VITALS_DEFAULTS, presentBeasts, frameTFromElapsed, DIE_DURATIONS, createBeastSim, STATE_WANDER, STATE_NOTICE, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_RETURN, STATE_STAGGER, STATE_FLINCH, STATE_DYING, STATE_CORPSE, STATE_SINK, STATE_GONE, STATE_EAT, TOWER_ORIGIN, NAV_CFG, groundZ, assets, beastEntity, buildWorld, makeEvents, freshSim, ok, scriptedPlayer, hashAt, emitHeavyHit, swordPlayer, LIGHT_HIT, HEAVY_HIT, hpOf, BOAR_R];

// ---------------------------------------------------------------------------------------------------------------
// 3 + 4. Determinism replay (600 steps, two fresh runs) and save/load round trip (save @ 300, fresh sim, same
//    hash @ 600).
// ---------------------------------------------------------------------------------------------------------------


{
  const entities = () => [beastEntity('b1', 1461, 1031), beastEntity('b2', 1444, 1035)];
  const { world: wA, sim: simA, rng: rngA } = freshSim(entities(), 42);
  const { world: wB, sim: simB, rng: rngB } = freshSim(entities(), 42);
  void wA; void wB;

  const checkpoints = [];
  let agree = true;
  for (let i = 1; i <= 600; i++) {
    const p = scriptedPlayer(i);
    const pzA = groundZ(wA, p.x, p.y), pzB = groundZ(wB, p.x, p.y);
    simA.step(p.x, p.y, pzA);
    simB.step(p.x, p.y, pzB);
    if (i % 60 === 0) {
      const ha = hashAt(simA, simA.steer, i, rngA);
      const hb = hashAt(simB, simB.steer, i, rngB);
      checkpoints.push([i, ha, hb]);
      if (ha !== hb) agree = false;
    }
  }
  ok('600-step determinism replay: hash equal at every 60-step checkpoint and at the end',
    agree, JSON.stringify(checkpoints));
}

{
  const entities = () => [beastEntity('b1', 1461, 1031), beastEntity('b2', 1444, 1035)];
  const { world: wA, sim: simA, rng: rngA } = freshSim(entities(), 7);

  for (let i = 1; i <= 300; i++) {
    const p = scriptedPlayer(i);
    simA.step(p.x, p.y, groundZ(wA, p.x, p.y));
  }
  const savedSim = simA.save();
  const savedRng = rngA.save();
  for (let i = 301; i <= 600; i++) {
    const p = scriptedPlayer(i);
    simA.step(p.x, p.y, groundZ(wA, p.x, p.y));
  }
  const hashA600 = hashAt(simA, simA.steer, 600, rngA);

  const { world: wB, sim: simB, rng: rngB } = freshSim(entities(), 7);
  rngB.load(savedRng);
  simB.load(savedSim);
  for (let i = 301; i <= 600; i++) {
    const p = scriptedPlayer(i);
    simB.step(p.x, p.y, groundZ(wB, p.x, p.y));
  }
  const hashB600 = hashAt(simB, simB.steer, 600, rngB);
  ok('save() at step 300, load() into a fresh sim: same hash at step 600',
    hashA600 === hashB600, `A=${hashA600} B=${hashB600}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 5. RE-05c drop-rule fixture through buildFromArrays (same shape as engine/nav/NavGrid.test.js's own RE-05c
//    fixture - this just confirms world_m1's chosen maxStepM: 1 content value actually blocks the drop it should).
// ---------------------------------------------------------------------------------------------------------------
{
  const w = 3, h = 1, n = w * h;
  const slopeOk = new Uint8Array(n).fill(1);
  const type = new Uint8Array(n).fill(0);
  const bigStep = Float32Array.from([0, 0, 1.5]);
  const gridBlocked = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  gridBlocked.buildFromArrays(bigStep, slopeOk, type, { typeNames: ['grass'], maxStepM: NAV_CFG.maxStepM });
  ok('RE-05c through buildFromArrays: a 1.5 m step with the content maxStepM (1) drops both edge cells',
    gridBlocked.cost[1] === 0 && gridBlocked.cost[2] === 0, gridBlocked.cost.join(','));

  const smallStep = Float32Array.from([0, 0, 0.9]);
  const gridOk = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  gridOk.buildFromArrays(smallStep, slopeOk, type, { typeNames: ['grass'], maxStepM: NAV_CFG.maxStepM });
  ok('RE-05c through buildFromArrays: a 0.9 m step under the content maxStepM stays walkable',
    gridOk.cost[1] === 1 && gridOk.cost[2] === 1, gridOk.cost.join(','));
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Perf budget (warn-only unless PERF_STRICT=1): 8 beasts, step mean <= 0.1 ms, p95 (ticks that run an A*)
//    <= 0.3 ms, zero allocation over 10k steps.
// ---------------------------------------------------------------------------------------------------------------
{
  const ents = [];
  for (let k = 0; k < 8; k++) ents.push(beastEntity(`perf${k}`, 1455 + k, 1028 + (k % 3)));
  const { world, sim } = freshSim(ents, 99);
  for (let i = 0; i < 8; i++) sim.state[i] = STATE_CHASE; // worst case: every beast pathing/chasing
  const px = 1500, py = 1025, pz = groundZ(world, px, py);

  const N = 2000;
  const times = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    sim.step(px, py, pz);
    const t1 = process.hrtime.bigint();
    times[i] = Number(t1 - t0) / 1e6;
  }
  const sorted = Array.from(times).sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / N;
  const p95 = sorted[Math.floor(N * 0.95)];
  const strict = process.env.PERF_STRICT === '1';
  const okMean = mean <= 0.1, okP95 = p95 <= 0.3;
  if (!okMean || !okP95) console.warn(`[perf] 8-beast step mean=${mean.toFixed(4)}ms p95=${p95.toFixed(4)}ms (budget 0.1/0.3ms)`);
  ok('perf: 8-beast step mean/p95 within budget (or PERF_STRICT unset)', strict ? (okMean && okP95) : true, `mean=${mean} p95=${p95}`);

  if (global.gc) {
    const heapBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 10000; i++) sim.step(px, py, pz);
    global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    ok('zero allocation over 10k steps (--expose-gc heap check)', heapAfter <= heapBefore + 1e6, `before=${heapBefore} after=${heapAfter}`);
  } else {
    console.log('(skip) zero-allocation heap check needs --expose-gc');
  }
}


finish();
