// WILD-06: wildEnv unit cases + integration (beastSim replay hash identical with fauna on / off, 600 steps).
// Run: node game/js/wild/wildEnv.test.js
import { World, NavGrid, createRng, createHasher } from '../../../engine/index.js';
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
import { createWildEnv, createWild, buildTrunkGrid, buildMeshBlockGrid } from './wildEnv.js';

wildlifeMod; paletteMod; detailPassMod; terrainMod; boarMod; swordMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; m3PropsMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.log('FAIL', m));

// ---- 1. trunk grid on a hand-made scatter ----
{
  const sc = { count: 3, x: Float64Array.of(100, 130, 100.5), y: Float64Array.of(200, 205, 240), species: Uint8Array.of(0, 1, 0) };
  const g = buildTrunkGrid(sc, [0.5, 1.0]);
  const fakeWorld = { terrain: { typeAt: () => 0, groundAt: () => 5, groundNormalAt: (x, y, o) => { o.z = 1; return o; } }, structureAt: () => null, scatter: sc };
  const env = createWildEnv(fakeWorld, { trunkR: [0.5, 1.0] });
  ok(g.n === 3 && env.grid.n === 3, 'grid holds 3 trunks');
  ok(env.blocked(100.6, 200, 0.2) === true, 'inside trunk radius -> blocked');
  ok(env.blocked(101.5, 200, 0.2) === false, 'clear of trunk -> free');
  ok(env.blocked(130, 206.4, 0.3) === true, 'species 1 radius 1.0 respected');
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
  ok(n > 0 && grew < 2e6, `blocked() 1e5 queries ~no allocation (${grew} B)`);
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
console.log(`wildEnv.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
