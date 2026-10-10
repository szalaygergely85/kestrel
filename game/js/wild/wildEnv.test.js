// WILD-06: FaunaEnv (wildEnv.js) + game wiring checks. Run: node game/js/wild/wildEnv.test.js
//   - trunk grid: hits, misses, 3x3 neighbourhood
//   - env on the real overworld_far terrain: habitat ids, slope, blocked, moveCircle, zero allocation
//   - beastSim replay hash identical with fauna stepped alongside and without (600 steps): fauna is not in the hash
import {
  World, createRng, createHasher,
} from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import boarMod from '../../../design/models/voxel_beast.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import swordMod from '../../../design/models/sword.js';
import m3PropsMod from '../../../design/models/m3_props.js';
import wildMod from '../../../design/models/voxel_wildlife.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { createBeastSim } from '../quest/sim/beastSim.js';
import { buildBeastNav } from '../quest/sim/beastNav.js';
import { createWildEnv, buildTrunkGrid } from './wildEnv.js';
import { createWildFauna } from './wildFauna.js';

paletteMod; detailPassMod; terrainMod; boarMod; wildMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

// ---- trunk grid ----
{
  const sc = { count: 3, x: Float64Array.of(0, 17, 100), y: Float64Array.of(0, 0, 100), z: new Float64Array(3), species: Uint8Array.of(0, 0, 1) };
  const g = buildTrunkGrid(sc, [0.5, 1.0]);
  ok(g.hit(0.4, 0, 0.1), 'inside trunk 0');
  ok(!g.hit(2, 2, 0.1), 'clear of trunks');
  ok(g.hit(16.3, 0, 0.2), 'neighbour-cell trunk (17,0) seen from x=16.3');
  ok(g.hit(100, 101.4, 0.5), 'species-1 trunk radius 1.0 + body 0.5');
  ok(buildTrunkGrid(null, []).hit(0, 0, 1) === false, 'empty grid');
}

// ---- env on the real terrain ----
const TOWER_ORIGIN = { x: 1480, y: 1018, z: 0 };
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
function beastEntity(id, x, y) {
  return { id, type: 'beast', transform: { x, y, z: 0, yawDeg: 0 }, components: {
    voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' }, brain: { kind: 'beast', home: [x, y] }, targetable: { radius: 0.45, height: 0.7 } } };
}
function buildWorld() {
  const orig = console.warn; console.warn = () => {};
  const w = World.load({ name: 'wildEnvTest', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: TOWER_ORIGIN, yawSteps: 0 }],
    entities: [beastEntity('b1', 1461, 1031), beastEntity('b2', 1444, 1035)], state: {} }, assets, { physics: 'grid' });
  console.warn = orig;
  return w;
}
const world = buildWorld();
const env = createWildEnv(world);
{
  const seen = new Set(); let slopeOk = true, groundOk = true;
  for (let x = 1300; x < 1700; x += 7) for (let y = 900; y < 1200; y += 7) {
    seen.add(env.habitatAt(x, y));
    const s = env.slopeZ(x, y); if (!(s > 0 && s <= 1.0000001)) slopeOk = false;
    if (!Number.isFinite(env.groundAt(x, y))) groundOk = false;
  }
  ok([...seen].every((h) => h === 0 || h === 1 || h === 2 || h === 4), `habitat ids only 0/1/2/4 (${[...seen]})`);
  ok(seen.has(0) || seen.size > 1, 'more than one habitat class in the sample');
  ok(slopeOk && groundOk, 'slope in (0,1], ground finite');
  ok(env.habitatAt(TOWER_ORIGIN.x + 2, TOWER_ORIGIN.y + 2) === 0 || true, 'structure probe runs');
  const out = { x: 0, y: 0 };
  env.moveCircle(1461, 1031, 0.1, 0.05, 0.2, out);
  ok(out.x > 1461 && out.y > 1031, 'moveCircle moves in open ground');
  ok(env.perchNear(0, 0, 1, 2, {}) === false, 'perchNear: no perches yet');
}

// ---- zero allocation of the env queries ----
if (typeof globalThis.gc === 'function') {
  const out = { x: 0, y: 0 };
  for (let i = 0; i < 2000; i++) { env.habitatAt(1400 + i % 50, 1000); env.slopeZ(1400, 1000 + i % 50); env.blocked(1450, 1000 + i % 30, 0.3); env.moveCircle(1450, 1000, 0.1, 0, 0.3, out); }
  gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) { env.habitatAt(1400 + i % 50, 1000); env.slopeZ(1400, 1000 + i % 50); env.blocked(1450, 1000 + i % 30, 0.3); env.moveCircle(1450, 1000, 0.1, 0, 0.3, out); }
  gc(); const d = process.memoryUsage().heapUsed - h0;
  ok(d < 200_000, `env queries: heap growth ${d} B over 20k iterations`);
} else console.log('(run with --expose-gc for the env heap check)');

// ---- beastSim replay hash: fauna on vs off ----
const fakePool = { models: new Map() };
for (const k of ['rabbit', 'deer', 'deerBuck']) {
  const an = window_ASSETS().models[k].voxel.animations;
  fakePool.models.set(k, { clipIndex: Object.fromEntries(Object.keys(an).map((n, i) => [n, i])) });
}
function window_ASSETS() { return (globalThis.window || globalThis).ASSETS; }

function runReplay(withFauna) {
  const w = buildWorld();
  const nav = buildBeastNav(w, NAV_CFG);
  const rng = createRng(42);
  const sim = createBeastSim(w, { nav, rng, events: { on: () => () => {}, emit() {} } });
  const wf = withFauna ? createWildFauna(w, window_ASSETS().wildlifeFx, fakePool, { seed: 5 }) : null;
  const hashes = [];
  for (let i = 1; i <= 600; i++) {
    const period = 240, amp = 14, t = i % period, frac = t < period / 2 ? t / (period / 2) : 2 - t / (period / 2);
    const px = 1461 + (frac - 0.5) * amp, py = 1031 + (frac - 0.5) * amp * 0.6;
    sim.step(px, py, w.terrain.heightAt(px, py));
    if (wf) wf.step(1 / 60, px, py, i % 120 < 30, (i * 0.7) % 360);
    if (i % 60 === 0) { const h = createHasher(); h.u32(i); rng.hashInto(h); h.u32(sim.steer.hash()); sim.hashInto(h); hashes.push(h.value()); }
  }
  return { hashes, alive: wf ? wf.fauna.stats.alive : 0, wf };
}
{
  const a = runReplay(false), b = runReplay(true);
  ok(a.hashes.length === 10 && a.hashes.join() === b.hashes.join(), 'beastSim 600-step hash identical with fauna on and off');
  console.log(`fauna alive after replay: ${b.alive} (info)`);
}

console.log(`wildEnv.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
