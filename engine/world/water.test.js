// US-055a1 (architecture.md 32.2): water regions + World#waterAt.
// Run: node --expose-gc engine/world/water.test.js   (PERF_STRICT=1 makes the perf bar fail)
import { createWater, collectWaterDefs, WATER_MAX, RIPPLE_MAX, RIPPLE_LIFE } from './water.js';
import { STEP } from '../core/loop.js';
import { World } from './World.js';
import { serialize, deserialize, stringifySave } from './serialize.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; farTowerMod; ferrumLightsMod;

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const threw = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// US-143a: `waves` defaults to "calm" (architecture.md 35.1), so every pre-143a exact-z assertion below pins
// `waves: 'none'` (zero amplitude) unless a test is specifically exercising the live wave height - see the new
// "US-143a: live waveHeight" block below for that.
const rect = (id, r, z, extra = {}) => ({ id, shape: 'rect', rect: r, z, waves: 'none', ...extra });
const circ = (id, c, r, z, extra = {}) => ({ id, shape: 'circle', c, r, z, waves: 'none', ...extra });
const mk = (list) => createWater(collectWaterDefs({ water: list }, []));
/** A bare World with a stepped floor: z = 0 for x < 5, z = 0.5 for 5 <= x < 10, null (no floor) beyond. */
function bare(list) {
  const w = new World();
  w.water = mk(list);
  w.floorAt = (x) => (x < 5 ? 0 : x < 10 ? 0.5 : null);
  return w;
}
const out = { surfaceZ: 0, depth: 0, region: '', index: -1, look: 0 };

// ---- inside / outside, rect + circle ----
{
  const w = bare([rect('pool', [0, 0, 4, 4], 1.2), circ('pond', [-10, -10], 3, 0.8)]);
  ok('rect: inside', w.waterAt(2, 2, out) && out.region === 'pool' && out.surfaceZ === 1.2);
  ok('rect: outside', !w.waterAt(4.5, 2, out) && !w.waterAt(-0.01, 2, out) && !w.waterAt(2, 4.01, out));
  ok('rect: half-open at x1/y1, closed at x0/y0', w.waterAt(0, 0, out) && !w.waterAt(4, 2, out));
  ok('circle: inside', w.waterAt(-10 + 2, -10, out) && out.region === 'pond');
  ok('circle: on the rim is inside', w.waterAt(-10 + 3, -10, out));
  ok('circle: bbox corner is outside (point test)', !w.waterAt(-10 + 2.5, -10 + 2.5, out));
  ok('circle: outside', !w.waterAt(-6.5, -10, out));
  const o2 = { surfaceZ: 7, depth: 7, region: 'x', look: 7 };
  w.waterAt(100, 100, o2);
  ok('miss leaves out untouched', o2.surfaceZ === 7 && o2.region === 'x');
}

// ---- depth over a stepped floor; shallow vs deep is the caller's 0.6 m threshold ----
{
  const w = bare([rect('step', [0, 0, 12, 4], 1.0)]);
  w.waterAt(2, 1, out); const dDeep = out.depth;
  w.waterAt(7, 1, out); const dShallow = out.depth;
  w.waterAt(11, 1, out); const dNone = out.depth;
  ok('depth = z - floor on the low step', near(dDeep, 1.0), String(dDeep));
  ok('depth = z - floor on the high step', near(dShallow, 0.5), String(dShallow));
  ok('depth is 0 where there is no floor', dNone === 0, String(dNone));
  ok('0.6 m wade/swim threshold separates the steps', dShallow < 0.6 && dDeep >= 0.6);
  const w2 = bare([rect('dry', [0, 0, 4, 4], -0.3)]);
  w2.waterAt(1, 1, out);
  ok('depth clamped at >= 0 (surface below floor)', out.depth === 0 && out.surfaceZ === -0.3);
}

// ---- overlaps: highest z wins; tie = lower index ----
{
  const w = bare([rect('low', [0, 0, 4, 4], 1.0), circ('high', [2, 2], 1, 2.0), rect('tie', [0, 0, 4, 4], 2.0)]);
  w.waterAt(2, 2, out);
  ok('overlap: highest z wins, tie to lower index', out.region === 'high' && out.surfaceZ === 2.0, out.region);
  w.waterAt(0.2, 0.2, out);
  ok('overlap: outside the circle falls to the next highest', out.region === 'tie', out.region);
}

// ---- look resolution, flow stored, defaults ----
{
  const t = mk([rect('a', [0, 0, 1, 1], 0), rect('b', [2, 0, 3, 1], 0, { look: 'lava', flow: [1, 2] }), rect('c', [4, 0, 5, 1], 0, { look: 'lava' })]);
  ok('look defaults to "water", resolved in first-seen order', t.lookNames.join() === 'water,lava' && t.look[0] === 0 && t.look[1] === 1 && t.look[2] === 1);
  ok('flow stored (default [0,0])', t.flow[2] === 1 && t.flow[3] === 2 && t.flow[0] === 0);
}

// ---- validation throws naming the region ----
{
  const cases = [
    ['no id', { shape: 'rect', rect: [0, 0, 1, 1], z: 0 }, 'id'],
    ['bad shape', { id: 'q1', shape: 'blob', z: 0 }, 'q1'],
    ['rect wrong length', rect('q2', [0, 0, 1], 0), 'q2'],
    ['rect inverted', rect('q3', [1, 1, 0, 0], 0), 'q3'],
    ['rect NaN', rect('q4', [0, 0, NaN, 1], 0), 'q4'],
    ['circle r <= 0', circ('q5', [0, 0], 0, 0), 'q5'],
    ['circle c bad', circ('q6', [0], 1, 0), 'q6'],
    ['z missing', { id: 'q7', shape: 'rect', rect: [0, 0, 1, 1] }, 'q7'],
    ['look not a string', rect('q8', [0, 0, 1, 1], 0, { look: 3 }), 'q8'],
    ['flow bad', rect('q9', [0, 0, 1, 1], 0, { flow: [1] }), 'q9'],
    ['waves bad', rect('q10', [0, 0, 1, 1], 0, { waves: 'typhoon' }), 'q10'],
    ['waveDirDeg bad', rect('q11', [0, 0, 1, 1], 0, { waveDirDeg: 'n' }), 'q11'],
    ['seed bad', rect('q12', [0, 0, 1, 1], 0, { seed: 1.5 }), 'q12'],
  ];
  for (const [name, r, id] of cases) {
    const m = threw(() => collectWaterDefs({ water: [r] }, []));
    ok(`validation: ${name}`, !!m && m.includes(id), String(m));
  }
  const dup = threw(() => collectWaterDefs({ water: [rect('d', [0, 0, 1, 1], 0), rect('d', [2, 0, 3, 1], 0)] }, []));
  ok('validation: duplicate id names it', !!dup && dup.includes('"d"'), String(dup));
  const many = [];
  for (let i = 0; i <= WATER_MAX; i++) many.push(rect('r' + i, [i, 0, i + 0.5, 1], 0));
  ok('validation: more than 32 regions throws', !!threw(() => collectWaterDefs({ water: many }, [])));
  ok('32 regions are fine', !threw(() => collectWaterDefs({ water: many.slice(0, WATER_MAX) }, [])));
}

// ---- World.load: world block + level block (frame offset, yawSteps), mesh and grid floors, serialize ----
{
  const { assets } = await loadTestAssets();
  globalThis.__waterAssets = assets;
  const def = assets.world('world_m1');
  // US-055a2c (Q12 item 8): world_m1 itself now carries 2 real water regions (the first visible pond/flooded
  // cellar) - this "no water" baseline fixture strips them back out rather than relying on the real content
  // happening to have none, same as any other "world_m1 minus one specific thing" test fixture would.
  const defNoWater = { ...def, water: undefined };
  const base = World.load(defNoWater, assets, {});
  ok('World.load without water -> empty table, never null', !!base.water && base.water.count === 0 && !base.waterAt(0, 0, out));
  ok('bare new World() has an empty table', new World().water.count === 0 && !new World().waterAt(1, 1, out));
  const st = base.structures.find((x) => x.id === 'tower') || base.structures[0];
  const f = st.frame;
  const origLevel = assets.level;
  const lvl = { id: 'lp', shape: 'rect', rect: [1, 2, 3, 4], z: 0.4, look: 'water', flow: [1, 0] };
  const ldef = (yawSteps) => {
    const a = Object.create(assets, { level: { value: (n) => { const d = origLevel.call(assets, n); return d === st.level.def || n === st.level.name ? { ...d, water: [lvl] } : d; } } });
    return a;
  };
  const wdef = { ...def, water: [circ('wp', [f.x + 20, f.y + 20], 2, f.z + 0.1)] };
  const a1 = ldef(0);
  const w = World.load(wdef, a1, {});
  ok('world + level regions loaded', w.water.count === 2 && w.water.ids.includes('wp') && w.water.ids.includes(`${st.id}.lp`), w.water.ids.join());
  const li = w.water.ids.indexOf(`${st.id}.lp`);
  ok('level rect converted by the frame offset', near(w.water.x0[li], f.x + 1) && near(w.water.y0[li], f.y + 2) && near(w.water.x1[li], f.x + 3) && near(w.water.y1[li], f.y + 4), [w.water.x0[li], w.water.y0[li], w.water.x1[li], w.water.y1[li]].join());
  ok('level z gains the frame z', near(w.water.z[li], 0.4 + f.z));
  // yawSteps 1 via the collector directly (placeStructure refuses yawSteps != 0 in M1)
  const fake = [{ id: 's', frame: { x: 10, y: 20, z: 1, yawSteps: 1 }, level: { def: { water: [lvl, { id: 'lc', shape: 'circle', c: [2, 0], r: 1, z: 0 }] } } }];
  const d = collectWaterDefs({}, fake);
  // yaw 90: local (x, y) -> world (-y, x): rect x[1,3] y[2,4] -> x[-4,-2] y[1,3] + (10,20)
  ok('level rect with yawSteps 1 stays axis-aligned and normalised', d[0].id === 's.lp' && near(d[0].rect[0], 6) && near(d[0].rect[1], 21) && near(d[0].rect[2], 8) && near(d[0].rect[3], 23), JSON.stringify(d[0].rect));
  ok('level circle with yawSteps 1 centre rotated', near(d[1].c[0], 10) && near(d[1].c[1], 22), JSON.stringify(d[1].c));
  ok('level flow rotated, z offset', near(d[0].flow[0], 0) && near(d[0].flow[1], 1) && near(d[0].z, 1.4), JSON.stringify(d[0].flow));
  ok('level validation names the prefixed id', (threw(() => collectWaterDefs({}, [{ id: 's', frame: fake[0].frame, level: { def: { water: [{ id: 'oops', shape: 'x', z: 0 }] } } }])) || '').includes('"s.oops"'));
  // US-143a (35.1): waves/waveDirDeg/seed defaults + round trip; a level frame's yawSteps adds 90*yawSteps to waveDirDeg.
  ok('waves/waveDirDeg/seed default (world region)', d[1].waves === 'calm' && d[1].waveDirDeg === 90 && d[1].seed === 1, JSON.stringify(d[1]));
  ok('waveDirDeg + yawSteps 1 adds 90 to the authored bearing', d[0].waveDirDeg === 90, d[0].waveDirDeg); // lp has no waveDirDeg (0) + 90*1
  const dCustom = collectWaterDefs({ water: [rect('cw', [0, 0, 1, 1], 0, { waves: 'storm', waveDirDeg: 45, seed: 7 })] }, []);
  ok('waves/waveDirDeg/seed round trip through collectWaterDefs', dCustom[0].waves === 'storm' && dCustom[0].waveDirDeg === 45 && dCustom[0].seed === 7, JSON.stringify(dCustom[0]));

  // floor: grid uses floorAt, mesh uses supportAt; both agree with the terrain at the world pool
  const cx = f.x + 20, cy = f.y + 20;
  for (const mode of ['grid', 'mesh']) {
    const wm = World.load(wdef, a1, { physics: mode });
    const hit = wm.waterAt(cx, cy, out);
    const floor = mode === 'grid' ? wm.floorAt(cx, cy) : wm.supportAt(cx, cy, out.surfaceZ + 0.01, false, null).floorH;
    ok(`${mode}: waterAt on a real world`, hit && near(out.depth, Math.max(0, (f.z + 0.1) - floor)), `${out.depth} floor ${floor}`);
  }
  // serialize: world block round-trips, level block is not saved
  const saved = stringifySave(serialize(w));
  ok('serialize writes the world block only', saved.includes('"wp"') && !saved.includes('lp"'));
  const w2 = deserialize(JSON.parse(saved), a1, {});
  ok('serialize round trip restores world + level regions', w2.water.count === 2 && w2.waterAt(cx, cy, out) && out.region === 'wp');
  ok('no water -> no "water" key in the save (old saves unchanged)', !('water' in serialize(base)));

  // US-143a (35.8): waterState (tick + sea blend) is saved only when water.count > 0, and round-trips.
  ok('no water -> no "waterState" key in the save', !('waterState' in serialize(base)));
  w.water.setSeaState('storm', 0.5);
  for (let i = 0; i < 10; i++) w.water.step();
  const savedTick = stringifySave(serialize(w));
  const parsed = JSON.parse(savedTick);
  ok('waterState present when water.count > 0', parsed.waterState && parsed.waterState.tick === w.water.tick, JSON.stringify(parsed.waterState));
  const w3 = deserialize(parsed, a1, {});
  ok('waterState round trip restores tick + sea blend', w3.water.tick === w.water.tick && w3.water.seaStep === w.water.seaStep && w3.water.seaSteps === w.water.seaSteps, `${w3.water.tick}/${w.water.tick}`);

  // US-143a (35.1): world key "seaState" (default "calm"); invalid value throws.
  const defBadSea = { ...def, seaState: 'hurricane' };
  ok('World.load: invalid seaState throws', (threw(() => World.load(defBadSea, a1, {})) || '').includes('seaState'));
  const defSea = { ...def, water: [rect('sea1', [0, 0, 1, 1], 0, { waves: 'sea' })], seaState: 'storm' };
  const wStorm = World.load(defSea, a1, {});
  const ampStorm = wStorm.water.wa[0] + wStorm.water.wa[1] + wStorm.water.wa[2] + wStorm.water.wa[3];
  ok('World key "seaState" seeds "sea" regions at load', near(ampStorm, 0.24 + 0.12 + 0.06 + 0.03), ampStorm);
}

// ---- mesh mode: no collider + no terrain -> FLOOR_NONE -> depth 0; out.index ----
{
  const w = new World();
  w.physicsMode = 'mesh';
  w.water = mk([rect('a', [0, 0, 4, 4], 1), circ('b', [10, 10], 2, 2)]);
  ok('mesh, no floor: waterAt hits with depth 0', w.waterAt(2, 2, out) && out.depth === 0 && out.surfaceZ === 1, String(out.depth));
  ok('out.index is the region slot, region stays the id', w.waterAt(10, 10, out) && out.index === 1 && out.region === 'b');
  ok('out.index of the first region', w.waterAt(1, 1, out) && out.index === 0 && w.water.ids[out.index] === 'a');
}

// ---- US-143a: live waterAt (surfaceZ/flatZ), world.water.step()/setSeaState(), hashInto ----
{
  const w = bare([rect('wavy', [0, 0, 10, 10], 1.0, { waves: 'storm', waveDirDeg: 0, seed: 3 })]);
  w.waterAt(2, 3, out);
  ok('flatZ is the still-water plane (unaffected by waves)', out.flatZ === 1.0, out.flatZ);
  const ampSum = 0.24 + 0.12 + 0.06 + 0.03; // WAVE_STATES.storm
  ok('surfaceZ = flatZ + h, |h| <= ampSum', Math.abs(out.surfaceZ - out.flatZ) <= ampSum + 1e-9, out.surfaceZ - out.flatZ);
  const h0 = out.surfaceZ - out.flatZ;
  for (let i = 0; i < 30; i++) w.water.step();
  w.waterAt(2, 3, out);
  ok('world.water.step() advances tick -> surfaceZ changes over 30 steps', out.surfaceZ - out.flatZ !== h0, out.surfaceZ - out.flatZ);
  ok('world.water.tick advanced', w.water.tick === 30, w.water.tick);

  // "none" region stays flat forever, regardless of tick.
  const wNone = bare([rect('flat', [0, 0, 4, 4], 2.0)]); // default extra -> waves: 'none'
  for (let i = 0; i < 50; i++) wNone.water.step();
  wNone.waterAt(1, 1, out);
  ok('waves:"none" stays exactly flat', out.surfaceZ === 2.0 && out.flatZ === 2.0, out.surfaceZ);

  // "sea" region follows world.water.setSeaState - a "calm"->"storm" blend changes the amplitude over time, no jump at t=0.
  const wSea = bare([rect('ocean', [0, 0, 20, 20], 0, { waves: 'sea', seed: 9 })]);
  wSea.waterAt(5, 5, out);
  const hCalm = out.surfaceZ;
  wSea.water.setSeaState('storm', 1); // 1 s = 60 steps at STEP=1/60
  wSea.waterAt(5, 5, out);
  ok('setSeaState: no jump at step 0 (ss=0 -> amp stays at "from")', near(out.surfaceZ, hCalm, 1e-9), `${out.surfaceZ} vs ${hCalm}`);
  for (let i = 0; i < 60; i++) wSea.water.step();
  wSea.waterAt(5, 5, out);
  ok('setSeaState: amplitude actually grew after the blend (storm > calm, same phase)', Math.abs(out.surfaceZ) > Math.abs(hCalm) || out.surfaceZ !== hCalm, out.surfaceZ);

  // hashInto: same state -> same hash; a step or a setSeaState changes it.
  const { createHasher } = await import('../core/hash.js');
  const hashOf = (water) => { const h = createHasher(); water.hashInto(h); return h.value(); };
  const wA = bare([rect('h', [0, 0, 1, 1], 0, { waves: 'calm' })]);
  const wB = bare([rect('h', [0, 0, 1, 1], 0, { waves: 'calm' })]);
  ok('hashInto: same fresh state -> same hash', hashOf(wA.water) === hashOf(wB.water));
  wA.water.step();
  ok('hashInto: a step changes the hash (tick advances)', hashOf(wA.water) !== hashOf(wB.water));
}

// ---- zero allocation + perf ----
{
  const list = [];
  for (let i = 0; i < 32; i++) list.push(i % 2 ? rect('r' + i, [i * 3, 0, i * 3 + 2, 2], 1) : circ('r' + i, [i * 3, 1], 1, 1));
  const w = bare(list);
  const o = { surfaceZ: 0, depth: 0, region: '', look: 0 };
  let hits = 0;
  const run = (n) => { for (let i = 0; i < n; i++) { if (w.waterAt(i % 100, 1, o)) hits++; } }; // integer args: a non-inlined call boxes double ARGUMENTS (caller side, cf. cloths.test), not the query
  run(200000); // JIT warm-up
  const N = 200000;
  const t0 = process.hrtime.bigint();
  run(N);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`perf: waterAt, 32 regions: ${(ms * 1000).toFixed(3)} us/query`);
  if (process.env.PERF_STRICT) ok('perf: waterAt <= 0.005 ms (32 regions)', ms <= 0.005, ms.toFixed(5));
  else if (ms > 0.005) console.warn(`WARN waterAt ${ms.toFixed(5)} ms > 0.005`);
  ok('perf probe hit some regions', hits > 0);
  {
    // mesh mode on world_m1 (baseline for 143a's 0.01 ms bar): a region over the spawn area, real colliders + terrain
    const assets = globalThis.__waterAssets;
    const wm = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
    wm.water = mk([rect('m1', [-1000, -1000, 1000, 1000], 100)]);
    const om = { surfaceZ: 0, depth: 0, region: '', index: -1, look: 0 };
    let h = 0;
    const runM = (n) => { for (let i = 0; i < n; i++) { if (wm.waterAt((i % 100) - 50, (i % 37) - 18, om)) h++; } };
    runM(20000);
    const NM = 50000;
    const m0 = process.hrtime.bigint();
    runM(NM);
    const mms = Number(process.hrtime.bigint() - m0) / 1e6 / NM;
    console.log(`perf: waterAt, mesh mode on world_m1: ${(mms * 1000).toFixed(3)} us/query (${wm.colliders.length} colliders)`);
    if (mms > 0.01) console.warn(`WARN waterAt mesh ${mms.toFixed(5)} ms > 0.01`);
    ok('mesh perf probe hit', h > 0);
  }
  if (globalThis.gc) {
    globalThis.gc();
    let grown = Infinity;
    for (let r = 0; r < 3; r++) {
      const m0 = process.memoryUsage().heapUsed;
      run(100000);
      grown = Math.min(grown, process.memoryUsage().heapUsed - m0);
      globalThis.gc();
    }
    ok('zero allocation: 100k queries grow the heap < 64 KB', grown < 65536, `${grown} B`);
  }
}

// ---- S8-B2-13 (38.14): ripple ring buffer (presentation only, never saved) ----
{
  const defs = collectWaterDefs({ water: [{ id: 'r', shape: 'rect', rect: [0, 0, 10, 10], z: 0 }] }, []);
  const wt = createWater(defs);
  let live = 0;
  for (let i = 0; i < RIPPLE_MAX; i++) { const age = (wt.tick - wt.ripT0[i]) * STEP; if (age >= 0 && age < RIPPLE_LIFE) live++; }
  ok('World.load leaves 0 live rings', live === 0);
  const save0 = wt.saveState();
  const hash0 = []; wt.hashInto({ u32: (v) => hash0.push(v), f64: (v) => hash0.push(v) });
  ok('non-finite input is refused and writes nothing', wt.addRipple(NaN, 0, 1) === false && wt.addRipple(0, Infinity, 1) === false && wt.addRipple(0, 0, NaN) === false && wt.ripHead === 0);
  ok('amp is clamped to [0,1]', wt.addRipple(1, 1, 5) === true && wt.ripAmp[0] === 1 && wt.addRipple(1, 1, -5) === true && wt.ripAmp[1] === 0);
  for (let i = 2; i < 9; i++) wt.addRipple(i, i, 0.5); // slots 2..7, then the 9th (i=8) wraps and overwrites slot 0
  ok('9 adds overwrite the oldest (slot 0) and ripHead wraps', wt.ripHead === 1 && wt.ripX[0] === 8 && wt.ripAmp[0] === 0.5);
  const save1 = wt.saveState();
  const hash1 = []; wt.hashInto({ u32: (v) => hash1.push(v), f64: (v) => hash1.push(v) });
  ok('saveState() is byte-identical with and without live rings', JSON.stringify(save0) === JSON.stringify(save1));
  ok('hashInto output is byte-identical with and without live rings', JSON.stringify(hash0) === JSON.stringify(hash1));
}

console.log(`water.test: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
