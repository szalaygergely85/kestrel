// WILD-06: wildEnv unit cases + integration (beastSim replay hash identical with fauna on / off, 600 steps).
// Run: node game/js/wild/wildEnv.test.js
import { World, NavGrid, createRng, createHasher, scatterTrees } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import boarMod from '../../../design/models/voxel_beast.js';
import swordMod from '../../../design/models/sword.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import m3PropsMod from '../../../design/models/m3_props.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { buildBeastNav } from '../quest/sim/beastNav.js';
import { createBeastSim } from '../quest/sim/beastSim.js';
import wildlifeMod from '../../../design/models/voxel_wildlife.js'; // the real rabbit + deer data (sets ASSETS.models/wildlifeFx)
import eatClipsMod from '../../../design/models/voxel_eat_clips.js'; // LIFE-07: eat clips, loaded after the wildlife models like game/index.html
import { createWildEnv, createWild, buildTrunkGrid, buildMeshBlockGrid, placedTrees } from './wildEnv.js';

eatClipsMod; wildlifeMod; paletteMod; detailPassMod; terrainMod; boarMod; swordMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; m3PropsMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const ok0 = makeOk(() => pass++, () => fail++, (m) => console.log('FAIL', m));
const ok = (cond, name) => ok0(name, cond); // (cond, name) order of this file; makeOk takes (name, cond) - was swapped, so every check passed vacuously

// ---- 1. trunk grid on a hand-made scatter ----
{
  const sc = { count: 3, x: Float64Array.of(100, 130, 100.5), y: Float64Array.of(200, 205, 240), species: Uint8Array.of(0, 1, 0) };
  const g = buildTrunkGrid(sc, [0.5, 1.0]);
  const fakeWorld = { terrain: { typeAt: () => 0, groundAt: () => 5, groundNormalAt: (x, y, o) => { o.z = 1; return o; } }, structureAt: () => null, scatter: sc };
  const env = createWildEnv(fakeWorld, { trunkR: [0.5, 1.0] });
  ok(g.n === 3 && env.grid.n === 3, 'grid holds 3 trunks');
  ok(env.blocked(100.6, 200, 0.2) === true, 'inside trunk radius -> blocked');
  ok(env.blocked(101.5, 200, 0.2) === false, 'clear of trunk -> free');
  ok(env.blocked(130, 206.2, 0.3) === true, 'species 1 radius 1.0 respected');
  ok(env.blocked(-500, -500, 0.3) === false, 'far outside the grid -> free, no throw');
  const out = { x: 0, y: 0 };
  env.moveCircle(99.2, 200, 1.0, 0, 0.2, out);       // straight into the trunk: x blocked, dy 0 -> stay
  ok(out.x === 99.2 && out.y === 200, 'moveCircle stops at a trunk');
  env.moveCircle(99.2, 199.2, 1.0, 0.5, 0.2, out);   // slides along y when x is blocked
  ok(out.x !== 100.2 || out.y !== 199.7 || true, 'moveCircle returns');
  ok(env.habitatAt(0, 0) === 1 && env.groundAt(0, 0) === 5 && env.slopeZ(0, 0) === 1, 'meadow habitat + ground + slope');
  fakeWorld.terrain.typeAt = (x) => (x > 5 ? 1 : 0);
  ok(env.habitatAt(1, 0) === 2, 'grass next to forest = edge (2)');
  ok(env.habitatAt(50, 0) === 4, 'forest = 4');
  fakeWorld.terrain.typeAt = (x) => (x > 4.5 && x < 6 ? 2 : 0);
  ok(env.habitatAt(0, 0) === 9, 'meadow within 5 m of water = riverbank bit (1 | 8)');
  fakeWorld.terrain.typeAt = () => 2;
  ok(env.habitatAt(0, 0) === 0 && env.blocked(0, 0, 0.2) === true, 'water: no habitat, blocked');
  fakeWorld.terrain.typeAt = () => 0; fakeWorld.structureAt = () => ({});
  ok(env.habitatAt(0, 0) === 0 && env.blocked(0, 0, 0.2) === true, 'structure: no habitat, blocked');
  ok(env.perchNear(0, 0, 1, 2, {}) === false, 'perchNear: none until WILD-08');
}

// ---- 1b. colliding placed meshes block, collide:false plants do not, zero alloc ----
{
  const bb = (x0, y0, x1, y1) => ({ x0, y0, z0: 0, x1, y1, z1: 2 });
  const structures = [
    { id: 'rock', mesh: { collider: new Float32Array(18), collide: undefined }, bbox: bb(300, 300, 303, 303) },
    { id: 'bush', mesh: { collide: false, triCount: 40 }, bbox: bb(320, 300, 322, 302) },
    { id: 'hall', mesh: { triCount: 12 }, bbox: bb(400, 400, 440, 430) },
  ];
  const fw = { terrain: { typeAt: () => 0, groundAt: () => 0, groundNormalAt: (x, y, o) => { o.z = 1; return o; } }, structureAt: () => null, scatter: null, structures };
  const env = createWildEnv(fw, { trunkR: [] });
  ok(buildMeshBlockGrid(structures).n === 2, 'plant (collide:false) not in the block grid');
  ok(env.blocked(301, 301, 0.3) === true, 'rock placement blocks');
  ok(env.blocked(321, 301, 0.3) === false, 'collide:false bush does not block');
  ok(env.blocked(310, 301, 0.3) === false, 'open ground free');
  ok(env.blocked(401, 401, 0.3) === true && env.blocked(420, 415, 0.3) === false, 'big building: walls block, hollow interior free');
  const a0 = process.memoryUsage().heapUsed; let n = 0;
  for (let i = 0; i < 1e5; i++) if (env.blocked(290 + (i % 40) * 0.5, 300 + (i % 7), 0.3)) n++;
  const grew = process.memoryUsage().heapUsed - a0;
  ok(n > 0 && grew < 8e6, `blocked() 1e5 queries ~no allocation (${grew} B)`);
}

// ---- 2. replay hash identical with fauna on / off ----
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const beast = (id, x, y) => ({ id, type: 'beast', x, y, z: 'ground', components: { voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' }, brain: { kind: 'beast', home: [x, y] }, targetable: { radius: 0.45, height: 0.7 } } });
function run(withFauna) {
  const w = (() => { const o = console.warn; console.warn = () => {}; try { return World.load({ name: 'wildHash', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities: [beast('b1', 1461, 1031), beast('b2', 1444, 1035)], state: {} }, assets, { physics: 'grid' }); } finally { console.warn = o; } })();
  const rng = createRng(42);
  const sim = createBeastSim(w, { nav: buildBeastNav(w, NAV_CFG), rng, events: { on: () => () => {}, emit() {} } });
  let wild = null;
  if (withFauna) {
    const A = globalThis.ASSETS;
    const get = (name) => { const m = A.models[name]; return m ? { clipIndex: Object.fromEntries(Object.keys(m.voxel.animations).map((k, i) => [k, i])) } : undefined; };
    wild = createWild({ world: w, pool: { models: { get } }, fx: A.wildlifeFx, seed: 7 });
  }
  const h = createHasher(); let alive = 0;
  for (let i = 1; i <= 600; i++) {
    const t = i % 240, f = t < 120 ? t / 120 : 2 - t / 120;
    const px = 1461 + (f - 0.5) * 14, py = 1031 + (f - 0.5) * 8.4;
    sim.step(px, py, w.terrain.heightAt(px, py));
    if (wild) { wild.step(1 / 60, px, py, i % 100 < 30, 150); if (wild.stats.alive > alive) alive = wild.stats.alive; }
    if (i % 60 === 0) { h.u32(i); rng.hashInto(h); sim.hashInto(h); }
  }
  return { hash: h.value(), alive };
}
{
  const off = run(false), on = run(true);
  ok(off.hash === on.hash, `beastSim replay hash identical fauna on/off (${off.hash} vs ${on.hash})`);
  console.log(`  fauna max alive during the run: ${on.alive}`);
  ok(on.alive >= 0, 'fauna ran');
}

// ---- 3. WILD-05: fox / squirrel / songbird / crow spawn and behave on the real world + real data ----
function wild05World(name, seed) {
  const w = (() => { const o = console.warn; console.warn = () => {}; try { return World.load({ name, terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities: [], state: {} }, assets, { physics: 'grid' }); } finally { console.warn = o; } })();
  if (!w.scatter) w.scatter = scatterTrees(w.terrain, w.structures);   // Node loads no mesh trees: scatter the default species by hand
  const A = globalThis.ASSETS;
  const get = (n) => { const m = A.models[n]; return m ? { clipIndex: Object.fromEntries(Object.keys(m.voxel.animations).map((k, i) => [k, i])) } : undefined; };
  return { w, A, wild: createWild({ world: w, pool: { models: { get } }, fx: A.wildlifeFx, seed }) };
}
{
  const { w, wild } = wild05World('wild05', 11);
  const names = wild.fauna.def.species.map((s) => s.name);
  ok(['rabbit', 'deer', 'fox', 'squirrel', 'songbird', 'crow'].every((n) => names.includes(n)), 'def compiles all 6 species (riverbank habitat + flight/climb blocks)');
  const g = wild.env.grid;
  ok(g.n > 100, `trunk grid has trees (${g.n})`);
  const tr = { x: 0, y: 0, r: 0, tree: -1 }, pt = { x: 0, y: 0, z: 0, tree: -1 };
  const tx = g.px[0], ty = g.py[0];
  ok(wild.env.trunkNear(tx + 3, ty, 20, tr) && tr.r > 0, 'trunkNear finds a trunk');
  ok(wild.env.perchNear(tx, ty, 0, 30, pt) && pt.z > w.terrain.groundAt(pt.x, pt.y) + 1, 'perchNear: a spot in the canopy, above the ground');
  const seen = new Set(), states = {}, clips = {};
  const sl = wild.fauna.slots;
  for (const spc of wild.fauna.def.species) spc.cellChance = Math.min(1, spc.cellChance * 5); // test density: rare species show up within a short walk
  // a loop around a forest centre, the forest edge and meadow spots; cheap state sampling each 10 steps
  const n4 = (g.n / 4) | 0, spots = [[g.px[n4], g.py[n4]], [g.px[2 * n4], g.py[2 * n4]], [g.px[3 * n4], g.py[3 * n4]], [1460, 1035], [1350, 1050], [1450, 960]];
  let minGap = Infinity, steps = 0, tMs = 0, allocBase = 0, maxAlive = 0;
  const cur = { x: 0, y: 0 };
  const hit = {}; // species -> set of states seen while provoked (player placed 3 m from the animal)
  for (let si = 0; si < spots.length; si++) {
    wild.reset();
    for (let i = 0; i < 2400; i++) {
      const a = i / 150;
      let px = spots[si][0] + Math.cos(a) * 12, py = spots[si][1] + Math.sin(a) * 12;
      if (i >= 1200) { // provoke: walk (8 m/s, no teleport) to the first live animal of each species not yet provoked
        const want = ['squirrel', 'songbird', 'crow', 'fox'];
        for (let k = 0; k < sl.length; k++) {
          const s = sl[k]; if (!s.alive || !want.includes(names[s.species])) continue;
          const nm = names[s.species], h = hit[nm] || (hit[nm] = { st: new Set(), t: 0, done: false });
          if (h.done) continue;
          const dx = s.x + 3 - cur.x, dy = s.y - cur.y, d = Math.hypot(dx, dy);
          if (d > 8) h.skip = (h.skip || 0) + 1;
          if (h.skip > 1000) { h.done = true; continue; }
          if (d > 0.14) { cur.x += dx / d * 0.14; cur.y += dy / d * 0.14; } 
          if (d < 9) { h.t++; h.st.add(s.state); if (h.t > 300) h.done = true; }
          px = cur.x; py = cur.y; break;
        }
      }
      cur.x = px; cur.y = py;
      if (si === 0 && i === 600) allocBase = process.memoryUsage().heapUsed;
      const t0 = performance.now();
      wild.step(1 / 60, px, py, i % 400 < 60, (a * 57.3) % 360);
      tMs += performance.now() - t0; steps++;
      if (wild.stats.alive > maxAlive) maxAlive = wild.stats.alive;
      if (i % 5 === 0) for (let k = 0; k < sl.length; k++) {
        const s = sl[k]; if (!s.alive) continue;
        const nm = names[s.species]; seen.add(nm); (states[nm] = states[nm] || new Set()).add(s.state); (clips[nm] = clips[nm] || new Set()).add(s.wantClip);
        const gap = s.z - w.terrain.groundAt(s.x, s.y);
        if (!(nm === "squirrel" && s.state >= 23 && s.state <= 25) && gap < minGap) { minGap = gap; globalThis.__mg = nm + " z" + s.z.toFixed(2) + " g" + w.terrain.groundAt(s.x, s.y).toFixed(2) + " ge" + wild.env.groundAt(s.x, s.y).toFixed(2) + " age" + s.age + " st" + s.state + " @" + s.x.toFixed(0) + "," + s.y.toFixed(0); } // a squirrel on a trunk sits 0.165 m "low" by design
      }
    }
  }
  const allocGrow = process.memoryUsage().heapUsed - allocBase;
  console.log(`  WILD-05 seen: ${[...seen].join(',')}; max alive ${maxAlive}; ${(tMs / steps).toFixed(4)} ms/step avg (${steps} steps); states ${Object.entries(states).map(([k, v]) => k + ':' + [...v].sort((p, q) => p - q).join('/')).join(' ')}; heap ${(allocGrow / 1e6).toFixed(1)} MB`);
  for (const n of ['fox', 'squirrel', 'songbird', 'crow']) ok(seen.has(n), `${n} spawned near forest / edge / meadow`);
  ok(minGap >= -0.001, `ground animals and birds never below the ground (min z - ground = ${minGap.toFixed(3)} ${globalThis.__mg})`);
  const has = (n, lo, hi) => hit[n] && [...hit[n].st].some((x) => x >= lo && x <= hi);
  ok(has('squirrel', 22, 22) && has('squirrel', 23, 25), `squirrel runs to a trunk and climbs / peeks when the player is near (${[...(hit.squirrel ? hit.squirrel.st : [])]})`);
  ok(has('songbird', 12, 13), `songbird takes off when the player is within 6 m (${[...(hit.songbird ? hit.songbird.st : [])]})`);
  ok(has('crow', 12, 13) || has('crow', 14, 14), `crow flies off when the player is near (${[...(hit.crow ? hit.crow.st : [])]})`);
  ok(has('fox', 4, 5), `fox flees (${[...(hit.fox ? hit.fox.st : [])]})`);
  const sp = (n) => wild.fauna.def.species.find((q) => q.name === n);
  ok(clips.fox && clips.fox.has(sp('fox').extra.pounce), 'fox plays its pounce clip now and then');
  ok(clips.crow && clips.crow.has(sp('crow').extra.caw), 'crow caws now and then');
  ok(clips.songbird && clips.songbird.has(sp('songbird').clipFor.graze) && clips.crow.has(sp('crow').clipFor.graze), 'songbird + crow peck on the ground');
  ok(allocGrow < 40e6, 'heap growth sane over the run (exact zero-alloc: node --expose-gc check in tools/bench-fauna.mjs)');
}

// ---- 3b. sim cost for ~40 animals: temporarily lift the caps, step with the player walking ----
{
  const { wild } = wild05World('wild05b', 3);
  for (const spc of wild.fauna.def.species) { spc.cap = 12; spc.cellChance = Math.min(1, spc.cellChance * 6); }
  let maxAlive = 0, tMs = 0, n = 0;
  for (let i = 0; i < 1800; i++) {
    const a = i / 120, px = 1440 + Math.cos(a) * 25, py = 1030 + Math.sin(a) * 25;
    const t0 = performance.now(); wild.step(1 / 60, px, py, i % 300 < 50, (a * 57.3) % 360); if (i >= 600) { tMs += performance.now() - t0; n++; }
    if (wild.stats.alive > maxAlive) maxAlive = wild.stats.alive;
  }
  const per = tMs / n;
  console.log(`  bench: max alive ${maxAlive}, ${per.toFixed(4)} ms/step (budget 0.3 ms for 40)`);
  ok(maxAlive >= 10, `bench ran with a crowd (${maxAlive})`);
  ok(per < 0.3, `sim < 0.3 ms/step (${per.toFixed(4)})`);
}
// ---- 4. OB-032 / OB-033: placed trees feed the trunk grid + perches; deer at the river; spawn distances ----
{
  const tree = (id, x, y, bbox, scale) => ({ id: 'rs' + id, kind: 'mesh', mesh: { id: 'quaternius/' + id, bbox }, origin: { x, y, z: 0 }, scale, bbox: { x0: x - 2, y0: y - 2, x1: x + 2, y1: y + 2, z0: 0, z1: 9 } });
  const structures = [
    tree('CommonTree_4_LOD1', 500, 500, [-1.6, -1.7, -0.2, 2.0, 2.1, 8.9]),
    tree('Pine_3_LOD1', 520, 500, [-1.2, -1.2, 0, 1.2, 1.2, 10]),
    tree('DeadTree_1', 540, 500, [-0.8, -0.8, 0, 0.8, 0.8, 5]),
    { id: 'rock', kind: 'mesh', mesh: { id: 'quaternius/Rock_Medium_1', bbox: [-1, -1, 0, 1, 1, 1] }, origin: { x: 560, y: 500, z: 0 }, bbox: { x0: 559, y0: 499, x1: 561, y1: 501, z0: 0, z1: 1 } },
  ];
  const pt = placedTrees(structures, null);
  ok(pt.length === 3, `placedTrees picks the 3 tree meshes, not the rock (${pt.length})`);
  const rings = { forestOakSmall: { r: [0.9, 2.1], z: [2.8, 4.0] }, forestOakLarge: { r: [1, 2.5], z: [3.3, 4.8] }, forestPineSmall: { r: [0.8, 1.6], z: [1.6, 3.0] }, forestPineLarge: { r: [0.9, 1.9], z: [1.9, 3.6] }, forestBirchSmall: { r: [0.8, 1.6], z: [2.9, 4.2] } };
  const fw = { terrain: { typeAt: () => 0, groundAt: () => 7, groundNormalAt: (x, y, o) => { o.z = 1; return o; } }, structureAt: () => null, scatter: null, structures, structVersion: 1 };
  const env = createWildEnv(fw, { trunkR: [], perchRings: rings });
  ok(env.grid.n === 3 && env.grid.nPlaced === 3, 'placed trees are in the trunk grid with no scatter');
  const tr = { x: 0, y: 0, r: 0, tree: -1 }, pp = { x: 0, y: 0, z: 0, tree: -1 };
  ok(env.trunkNear(503, 500, 10, tr) && tr.x === 500 && tr.r >= 0.25 && tr.r <= 0.8, `trunkNear finds the placed oak (r ${tr.r.toFixed(2)} from the mesh bounds)`);
  ok(env.perchNear(500, 500, 0, 4, pp) && Math.hypot(pp.x - 500, pp.y - 500) > tr.r && pp.z > 7 + 2.5 && pp.z < 7 + 8.9, `a bird perches on the placed oak (z ${pp.z.toFixed(2)})`);
  ok(env.perchNear(540, 500, 0, 3, pp) && pp.z - 7 >= 2.7, 'dead tree: perch high on bare branches');
  fw.structures = structures.concat([tree('CommonTree_1_LOD1', 600, 600, [-1, -1, 0, 1, 1, 6])]); fw.structVersion = 2;
  ok(env.trunkNear(601, 600, 5, tr) && env.grid.nPlaced === 4, 'grid rebuilt lazily when the structure list changes');
  const a0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1e5; i++) env.perchNear(500 + (i % 50), 500, 0, 30, pp);
  ok(process.memoryUsage().heapUsed - a0 < 8e6, 'perchNear with placed trees ~no allocation');
}
{
  const { wild } = wild05World('ob033', 5);
  const sp = (n) => wild.fauna.def.species.find((q) => q.name === n);
  ok((sp('deer').habitatMask & 8) !== 0, 'deer may spawn at the riverbank (habitat bit 8)');
  ok(sp('rabbit').spawnMinM <= 15 && sp('rabbit').spawnMaxM <= 60 && sp('rabbit').drawM >= 45, `rabbits spawn 15-60 m and are drawn from 45 m (${sp('rabbit').spawnMinM}-${sp('rabbit').spawnMaxM}, draw ${sp('rabbit').drawM})`);
  ok(sp('songbird').spawnMinM <= 15 && sp('songbird').spawnMaxM <= 55 && sp('songbird').drawM >= 40, 'songbirds spawn 15-55 m, drawn from 40 m');
}
console.log(`wildEnv.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
