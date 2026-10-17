// Run: node engine/fauna/spawner.test.js (re-spawns itself with --expose-gc if missing)
import { spawnSync } from 'node:child_process';
import { compileFaunaDef } from './faunaDef.js';
import { createSpawner, hash3, CELL_M, FAUNA_MAX } from './spawner.js';
import { FIXTURE_FX, fixtureModels } from './wildlifeFx.fixture.js';
if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
let fail = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const models = fixtureModels();
const mkFx = (spawn) => { const f = JSON.parse(JSON.stringify(FIXTURE_FX)); for (const n of Object.keys(spawn)) f.animals[n].spawn = spawn[n]; return f; };

// Fake FaunaEnv: flat ground; meadow everywhere except a lake (x in 100..140) and a blocked disc at (300, 0) r 20.
function fakeEnv() {
  return {
    groundAt: () => 0, slopeZ: () => 1,
    habitatAt: (x, y) => (x > 100 && x < 140 ? 0 : 1),
    blocked: (x, y, r) => { const dx = x - 300, dy = y; return dx * dx + dy * dy < (20 + r) * (20 + r); },
    moveCircle() {}, perchNear: () => false,
  };
}
const HFOV = Math.PI / 2; // 90 deg
const dt = 1 / 60;

// Walk east along y=0 for `secs`, camera looking along the walk direction. Returns the spawn log.
function walk(sp, secs, speed = 4, x0 = 0, y0 = 0) {
  const cur = { x: x0, y: y0 };
  const log = [];
  sp.onSpawn = (s) => log.push({ id: s.id, k: s.k, model: s.model, x: s.x, y: s.y, px: cur.x, py: cur.y, group: s.group });
  for (let i = 0; i < secs * 60; i++) {
    cur.x += speed * dt;
    sp.update(dt, cur.x, cur.y, cur.x, cur.y, 1, 0, HFOV);
  }
  return { log, cur };
}
const sig = (log) => log.map((e) => `${e.id}:${e.k}:${e.model}:${e.x.toFixed(3)}:${e.y.toFixed(3)}`).join('|');

const def = compileFaunaDef(FIXTURE_FX, models);

// ---- determinism: same seed + same path = same spawns; other seed differs; reset replays ----
{
  const A = walk(createSpawner(def, fakeEnv(), { seed: 42 }), 120);
  const B = walk(createSpawner(def, fakeEnv(), { seed: 42 }), 120);
  const C = walk(createSpawner(def, fakeEnv(), { seed: 43 }), 120);
  ok(A.log.length > 10, `spawns happen along the path (${A.log.length})`);
  ok(sig(A.log) === sig(B.log), 'same seed + path -> identical spawns');
  ok(sig(A.log) !== sig(C.log), 'other seed -> different spawns');
  const sp = createSpawner(def, fakeEnv(), { seed: 42 });
  const first = walk(sp, 60); sp.reset();
  ok(sp.stats.alive === 0 && sp.slots.every((s) => !s.alive), 'reset clears slots');
  const again = walk(sp, 60);
  ok(sig(first.log) === sig(again.log), 'reset re-seeds: same path replays the same spawns');
  ok(hash3(5, -7, 99) === hash3(5, -7, 99) && hash3(5, -7, 99) !== hash3(5, -7, 100), 'hash3 stable + sensitive');
}

// ---- cell content is a pure function of (cell, seed): independent of the player's earlier path ----
{
  const a = createSpawner(def, fakeEnv(), { seed: 7 });
  const b = createSpawner(def, fakeEnv(), { seed: 7 });
  a.update(1, 50, 50, 50, 50, 1, 0, HFOV);
  b.update(1, 3000, -2000, 3000, -2000, 1, 0, HFOV); b.update(1, 700, 20, 700, 20, 1, 0, HFOV); b.update(1, 50, 50, 50, 50, 1, 0, HFOV);
  ok(a._ring.stat.every((v, i) => v === b._ring.stat[i]), 'ring candidate table identical regardless of path');
}

// ---- spawn rules: never inside the view cone within drawM; within spawnMaxM ----
{
  const { log } = walk(createSpawner(def, fakeEnv(), { seed: 11 }), 200);
  const cosHalf = Math.cos(HFOV / 2 + 15 * Math.PI / 180);
  let bad = 0, badDist = 0;
  for (const e of log) {
    const spc = def.species[e.k];
    const dx = e.x - e.px, dy = e.y - e.py, d = Math.hypot(dx, dy);
    if (d <= spc.drawM && dx / d >= cosHalf) bad++;      // camera = player, forward = +x
    if (d > spc.spawnMaxM + 4.5) badDist++;              // members sit up to 4 m from the anchor
  }
  ok(log.length > 10 && bad === 0, `no spawn inside the view cone within drawM (${bad} of ${log.length})`);
  ok(badDist === 0, `spawns within spawnMaxM (+group radius) (${badDist} bad)`);
  ok(log.every((e) => !(e.x > 100 && e.x < 140)), 'never spawns in the lake (habitat 0)');
  ok(log.every((e) => Math.hypot(e.x - 300, e.y) >= 20), 'never spawns in the blocked disc');
}

// ---- caps ----
{
  const dense = compileFaunaDef(mkFx({ rabbit: { cellChance: 1, cap: 3, spawnMinM: 5 }, deer: { cellChance: 1, cap: 8, spawnMinM: 5 } }), models);
  const sp = createSpawner(dense, fakeEnv(), { seed: 3 });
  let maxTotal = 0, maxR = 0, maxD = 0;
  for (let i = 0; i < 60 * 120; i++) {
    sp.update(dt, 2000 + i * 0.05, 0, 2000 + i * 0.05, 0, 1, 0, HFOV);
    maxTotal = Math.max(maxTotal, sp.stats.alive); maxR = Math.max(maxR, sp.stats.bySpecies[0]); maxD = Math.max(maxD, sp.stats.bySpecies[1]);
  }
  ok(maxTotal <= FAUNA_MAX && maxTotal > 0, `global cap ${FAUNA_MAX} holds (max ${maxTotal})`);
  ok(maxR === 3, `rabbit cap 3 holds and is reached (max ${maxR})`);
  ok(maxD <= 8 && maxD > 0, `deer cap 8 holds (max ${maxD})`);
  const small = createSpawner(dense, fakeEnv(), { seed: 3, maxAlive: 5 });
  for (let i = 0; i < 600; i++) small.update(dt, 2000, 0, 2000, 0, 1, 0, HFOV);
  ok(small.stats.alive === 5 && small.slots.length === 5, 'maxAlive caps the slot pool');
  // the global cap itself: 8 deer + 10 rabbits fit, so use a bigger species cap to reach 40
  const wide = compileFaunaDef(mkFx({ rabbit: { cellChance: 1, cap: 60, spawnMinM: 5 }, deer: { cellChance: 1, cap: 60, spawnMinM: 5 } }), models);
  const w = createSpawner(wide, fakeEnv(), { seed: 3 });
  let wMax = 0;
  for (let i = 0; i < 60 * 120; i++) { w.update(dt, 2000 + i * 0.05, 0, 2000 + i * 0.05, 0, 1, 0, HFOV); wMax = Math.max(wMax, w.stats.alive); }
  ok(wMax === FAUNA_MAX, `global cap reached exactly and never exceeded (${wMax})`);
}

// ---- despawn past despawnM, then cell cooldown ----
{
  const fx = mkFx({ rabbit: { cellChance: 0.4, cap: 40, spawnMinM: 5, spawnMaxM: 60 }, deer: { cellChance: 0, spawnMinM: 5 } });
  fx.animals.rabbit.groupSize = [1, 1];
  const sparse = compileFaunaDef(fx, models);
  const sp2 = createSpawner(sparse, fakeEnv(), { seed: 5 });
  const step2 = (secs) => { for (let i = 0; i < secs * 60; i++) sp2.update(dt, 2000, 0, 2000, 0, 1, 0, HFOV); };
  step2(1);
  const m0 = sp2.stats.alive;
  for (const s of sp2.slots) if (s.alive) sp2.despawn(s, true);
  ok(m0 > 0 && m0 < 40 && sp2.stats.alive === 0, `rabbits spawned (${m0}) then all despawned manually`);
  step2(30);
  ok(sp2.stats.alive === 0, `no respawn during the 60 s cooldown (alive ${sp2.stats.alive})`);
  step2(100);
  ok(sp2.stats.alive === m0, `cells respawn after the cooldown (${sp2.stats.alive} vs ${m0})`);
  // despawn by distance: push every animal past despawnM (75 m)
  const spd = createSpawner(sparse, fakeEnv(), { seed: 5 });
  for (let i = 0; i < 60; i++) spd.update(dt, 2000, 0, 2000, 0, 1, 0, HFOV);
  const before = spd.stats.alive;
  for (const s of spd.slots) if (s.alive) s.x += 200;
  for (let i = 0; i < 30; i++) spd.update(dt, 2000, 0, 2000, 0, 1, 0, HFOV);
  ok(before > 0 && spd.stats.alive === 0, `animals past despawnM despawn (${before} -> ${spd.stats.alive})`);
}

// ---- groups: members share a home and a group id; one buck per deer group ----
{
  const fx = mkFx({ deer: { cellChance: 1, cap: 8, spawnMinM: 5 }, rabbit: { cellChance: 0 } });
  fx.animals.deer.buckChance = 1; fx.animals.deer.groupSize = [3, 3];
  const sp = createSpawner(compileFaunaDef(fx, models), fakeEnv(), { seed: 9 });
  const { log } = walk(sp, 20, 0, 2000, 0);
  ok(log.length >= 3, 'deer group spawned');
  const g = log[0].group, members = sp.slots.filter((s) => s.alive && s.group === g);
  ok(members.length === 3 && members.every((s) => s.homeX === members[0].homeX && s.homeY === members[0].homeY), 'group shares one home');
  ok(members.every((s) => Math.hypot(s.x - s.homeX, s.y - s.homeY) <= 4.001), 'members within 4 m of the anchor');
  ok(members.filter((s) => s.model === 1).length === 1, 'exactly one buck per deer group');
}

// ---- zero allocation: 1e4 steps while crossing cells ----
{
  const sp = createSpawner(def, fakeEnv(), { seed: 21 });
  let px = 0;
  const run = (n) => { for (let i = 0; i < n; i++) { px += 0.25; sp.update(dt, px, 0, px, 0, 1, 0, HFOV); } };
  run(12000); // warm up (JIT + inline caches)
  globalThis.gc(); globalThis.gc();
  const h0 = process.memoryUsage().heapUsed;
  run(10000);
  globalThis.gc();
  const dh = process.memoryUsage().heapUsed - h0;
  ok(sp.ringCenter()[0] > 40, 'player crossed many cells');
  ok(dh < 20000, `no per-step allocation over 1e4 steps (${dh} B)`);
}
ok(CELL_M === 64, '64 m cells');

console.log(`spawner.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
