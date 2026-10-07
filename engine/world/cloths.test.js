// CLOTH-1b3 (architecture.md 33.5): the cloth system - layout, ground fit, sleep rules, caps, warm-up, determinism, perf.
// Run: node --expose-gc engine/world/cloths.test.js   (PERF_STRICT=1 makes the perf bar fail)
import { createClothSystem, collectClothDefs, MAX_CLOTHS } from './cloths.js';
import { createWind } from './wind.js';
import { createHasher } from '../core/hash.js';
import { World } from './World.js';
import { serialize, stringifySave } from './serialize.js';
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

const flat = { groundAt: () => 0 };
const blk = (id, extra = {}) => ({ id, preset: 'canvas', cols: 8, rows: 6, size: [1.4, 1], origin: [0, 0, 2], yawDeg: 0, plane: 'vertical', pins: [[0, 0], [7, 0]], ...extra });
const hashOf = (sys) => { const h = createHasher(); sys.hashInto(h); return h.value(); };

// ---- zero alloc per tick + perf (first: the heap/JIT state of a fresh process; later suites' World.load runs add noise) ----
{
  const mk = (i) => blk('p' + i, { cols: 24, rows: 16, size: [2.3, 1.5], origin: [i * 3, 0, 2], pins: [[0, 0], [12, 0], [23, 0]], colliders: [{ type: 'box', c: [i * 3 + 1, 0.3, 1], half: [1, 0.2, 1] }] });
  const s = createClothSystem([mk(0), mk(1), mk(2)], flat);
  const w = createWind({ dirDeg: 90, speed: 5, gust: { amp: 0.4, periodSec: 2, travel: 8 } }, 3);
  s.setBody(0, 1, -0.2, 0, 0.35, 1.8);
  let t = 0;
  const frame = () => { for (let i = 0; i < 3; i++) s.markDrawn(i); s.tick(t++, w, 3, -3, 2); };
  for (let i = 0; i < 6000; i++) frame(); // JIT warm-up: heap growth settles after a few thousand ticks
  ok('perf setup: 2 awake 24x16, third capped', s.stats.awake === 2 && s.stats.awakeNodes === 768, JSON.stringify(s.stats));
  if (globalThis.gc) {
    // The system itself: stub wind (createWind boxes ~50 B per sample) and no body (setCapsule's 9 double args box ~115 B per call, cloth.js).
    const stub = { sampleInto: (x, y, z, tt, o) => { o[0] = 0; o[1] = 5; o[2] = 0; } };
    const bodyN = s.bodyCount;
    s.clearBodies();
    const f2 = () => { for (let i = 0; i < 3; i++) s.markDrawn(i); s.tick(t++, stub, 3, -3, 2); };
    for (let i = 0; i < 6000; i++) f2();
    globalThis.gc();
    let grown = Infinity; // best of 3 windows: the first can still contain a re-optimisation after the wind object changed
    for (let r = 0; r < 3; r++) {
      const m0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < 5000; i++) f2();
      grown = Math.min(grown, process.memoryUsage().heapUsed - m0);
      globalThis.gc();
    }
    ok('zero allocation over 5000 ticks (stub wind, no body; heap growth < 64 KB)', grown < 65536, `${grown} B`);
    s.setBody(0, 1, -0.2, 0, 0.35, 1.8);
    for (let i = 0; i < 3000; i++) frame();
    globalThis.gc();
    const m1 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 5000; i++) frame();
    console.log(`  info real wind + body: ${((process.memoryUsage().heapUsed - m1) / 5000).toFixed(0)} B/tick (wind sample + setCapsule number boxing; bodyCount was ${bodyN})`);
  } else console.log('  info zero-alloc gate skipped (run with --expose-gc)');
  const N = 3000, t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) frame();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`  info perf: system tick, 2 awake 24x16 (+body, +wall box each): ${ms.toFixed(4)} ms/step`);
  if (process.env.PERF_STRICT === '1') ok('perf: system tick <= 0.4 ms', ms <= 0.4, ms.toFixed(4));
  else if (ms > 0.4) console.log('  warn perf over 0.4 ms (warn-only)');
}

// ---- layout: yaw 0 / 90 / 225, vertical + horizontal (pins never move, so they show the layout) ----
{
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const s0 = createClothSystem([blk('a')], flat);
  const p = s0.cloths[0].pos;
  ok('yaw 0: pin (7,0) at x=+1.4 along right (cos0=1), z=origin', near(p[3 * 7], 1.4) && near(p[3 * 7 + 1], 0) && near(p[3 * 7 + 2], 2));
  const s90 = createClothSystem([blk('a', { yawDeg: 90 })], flat);
  const p9 = s90.cloths[0].pos;
  ok('yaw 90: cols run along +y (right of east-facing)', near(p9[3 * 7], 0) && near(p9[3 * 7 + 1], 1.4));
  const s225 = createClothSystem([blk('a', { yawDeg: 225 })], flat);
  const q = s225.cloths[0].pos, c = Math.cos(225 * Math.PI / 180), s = Math.sin(225 * Math.PI / 180);
  ok('yaw 225: right = (cos, sin)', near(q[3 * 7], 1.4 * c) && near(q[3 * 7 + 1], 1.4 * s));
  const sh = createClothSystem([blk('a', { plane: 'horizontal', pins: [[0, 0], [7, 0], [0, 5], [7, 5]] })], flat);
  const ph = sh.cloths[0].pos; // pin (0,5): forward (yaw 0 = -y) * 1.0
  ok('horizontal: rows along forward (-y), z constant', near(ph[3 * 40], 0) && near(ph[3 * 40 + 1], -1) && near(ph[3 * 40 + 2], 2));
}

// ---- validation throws naming the cloth + key ----
{
  const bad = (extra, key) => { const m = threw(() => createClothSystem([blk('bx', extra)], flat)); ok(`throws on bad ${key}`, !!m && m.includes('"bx"') && m.includes(key), String(m)); };
  bad({ cols: 1 }, 'cols'); bad({ rows: 99 }, 'rows'); bad({ size: [0, 1] }, 'size'); bad({ origin: [0, 0] }, 'origin');
  bad({ plane: 'sideways' }, 'plane'); bad({ pins: [] }, 'pins'); bad({ pins: [[9, 0]] }, 'pins[0]'); bad({ holes: [[7, 0]] }, 'holes[0]');
  bad({ preset: 'nope' }, 'preset'); bad({ colliders: [{ type: 'box', c: [0, 0, 0], half: [1, 0.05, 1] }] }, 'thinner');
  bad({ colliders: [{ type: 'cone', c: [0, 0, 0] }] }, 'type'); bad({ sleepDist: -1 }, 'sleepDist'); bad({ mat: 5 }, 'mat');
  ok('duplicate id throws', !!threw(() => createClothSystem([blk('d'), blk('d')], flat)));
  ok('> MAX_CLOTHS throws', !!threw(() => createClothSystem(Array.from({ length: MAX_CLOTHS + 1 }, (_, i) => blk('c' + i)), flat)));
  ok('empty / null defs -> empty system', createClothSystem(null, null).count === 0 && createClothSystem([], flat).cloths.length === 0);
}

// ---- ground plane fitted from 3 samples (tilted) ----
{
  const slope = { groundAt: (x) => 0.2 * x }; // z = 0.2 x
  const s = createClothSystem([blk('g', { origin: [0, 0, 0.4], pins: [[0, 0]], size: [1.4, 1] })], slope);
  const p = s.cloths[0].pos;
  let worst = 1;
  for (let k = 0; k < s.cloths[0].n; k++) worst = Math.min(worst, p[3 * k + 2] - 0.2 * p[3 * k]);
  ok('tilted ground plane: no node below the fitted surface after warm-up', worst > -1e-3, String(worst));
  const steep = createClothSystem([blk('g2', { origin: [0, 0, 0.4] })], { groundAt: (x) => 5 * x });
  ok('too-steep ground falls back to flat (builds)', steep.count === 1);
  const none = createClothSystem([blk('g3')], { groundAt: () => null });
  ok('groundAt null -> no ground, builds', none.count === 1);
}

// ---- warm-up settles, with colliders passed (box overlapping the rest cloth) ----
{
  const wall = { type: 'box', c: [0.7, 0.3, 1.5], half: [1.5, 0.2, 1.5], yawDeg: 0 }; // wall -y face at y=0.1: the rest plane y=0 is outside, so shift the wall over it
  const over = { ...wall, c: [0.7, 0.0, 1.5] }; // face at y=-0.2..0.2: the rest cloth starts INSIDE the box
  const s = createClothSystem([blk('w', { colliders: [over] })], flat);
  const c = s.cloths[0];
  let inside = 0;
  for (let k = 0; k < c.n; k++) {
    const x = c.pos[3 * k], y = c.pos[3 * k + 1], z = c.pos[3 * k + 2];
    if (Math.abs(x - 0.7) < 1.5 && Math.abs(z - 1.5) < 1.5 && Math.abs(y) < 0.2 - 0.03 - 1e-3 && !(k % 8 === 0 && k < 8) && k !== 7) inside++;
  }
  ok('warm-up with colliders: no node left inside the wall', inside === 0, String(inside));
  const free = createClothSystem([blk('w2')], flat);
  free.cloths[0].step(0, 0, 0, null);
  ok('warm-up leaves the free cloth near rest (< 0.5 m/s)', free.cloths[0].maxSpeed < 0.5, String(free.cloths[0].maxSpeed));
}

// ---- sleep rules ----
{
  const eye = [0, -3, 2];
  const wind = createWind({ dirDeg: 90, speed: 4, gust: { amp: 0.3, periodSec: 2, travel: 8 } }, 1);
  let spyCalls = 0;
  const spy = { sampleInto: (...a) => { spyCalls++; return wind.sampleInto(...a); } };
  const defs = [blk('near'), blk('mid', { origin: [10, 0, 2] }), blk('far', { origin: [100, 0, 2] })];
  const s = createClothSystem(defs, flat);
  s.tick(0, spy, ...eye);
  ok('not drawn -> all asleep, 0 samples', s.cloths.every((c) => c.asleep) && spyCalls === 0 && s.stats.awake === 0);
  for (let i = 0; i < 3; i++) s.markDrawn(i);
  spyCalls = 0;
  s.tick(1, spy, ...eye);
  ok('drawn + in range -> awake; > 40 m stays asleep', !s.cloths[0].asleep && !s.cloths[1].asleep && s.cloths[2].asleep, `${s.cloths.map((c) => c.asleep)}`);
  ok('one sampleInto per candidate cloth per step', spyCalls === 2, String(spyCalls));
  const v0 = s.cloths[2].version;
  for (let t = 2; t < 20; t++) { for (let i = 0; i < 3; i++) s.markDrawn(i); s.tick(t, spy, ...eye); }
  ok('far cloth never stepped', s.cloths[2].version === v0 && s.cloths[2].asleep);
  for (let t = 20; t < 40; t++) s.tick(t, spy, ...eye);
  ok('not drawn for > grace ticks -> asleep again', s.cloths.every((c) => c.asleep));
  const before = Float64Array.from(s.cloths[0].pos);
  for (let i = 0; i < 3; i++) s.markDrawn(i);
  s.tick(40, spy, ...eye);
  let maxD = 0;
  for (let k = 0; k < before.length; k++) maxD = Math.max(maxD, Math.abs(s.cloths[0].pos[k] - before[k]));
  ok('wake from distance/draw sleep: first step moves < 1 cm (no pop)', maxD < 0.01, String(maxD));
  s.markDrawn(0); s.tick(41, spy, 500, 0, 2);
  ok('eye far away -> all asleep', s.cloths.every((c) => c.asleep));
}

// ---- caps: maxAwake and maxAwakeNodes, nearest first ----
{
  const defs = Array.from({ length: 10 }, (_, i) => blk('c' + i, { origin: [i * 2, 0, 2] }));
  const s = createClothSystem(defs, flat, null, { maxAwake: 6 });
  for (let i = 0; i < 10; i++) s.markDrawn(i);
  s.tick(1, null, 0, -2, 2);
  const awake = s.cloths.map((c, i) => (c.asleep ? -1 : i)).filter((i) => i >= 0);
  ok('maxAwake 6: the 6 nearest awake', awake.join() === '0,1,2,3,4,5', awake.join());
  const big = (i) => blk('b' + i, { cols: 24, rows: 16, size: [2.3, 1.5], origin: [i * 3, 0, 2], pins: [[0, 0], [23, 0]] });
  const s2 = createClothSystem([big(0), big(1), big(2)], flat);
  for (let i = 0; i < 3; i++) s2.markDrawn(i);
  s2.tick(1, null, 0, -2, 2);
  ok('maxAwakeNodes 768: two 24x16 awake, third asleep', !s2.cloths[0].asleep && !s2.cloths[1].asleep && s2.cloths[2].asleep && s2.stats.awakeNodes === 768, `${s2.cloths.map((c) => c.asleep)} ${s2.stats.awakeNodes}`);
  const s3 = createClothSystem([big(0), big(1), big(2)], flat);
  for (let i = 0; i < 3; i++) s3.markDrawn(i);
  s3.tick(1, null, 6, -2, 2);
  ok('nearest first: eye by slot 2 keeps slots 2,1 awake', s3.cloths[0].asleep && !s3.cloths[1].asleep && !s3.cloths[2].asleep);
}

// ---- rest sleep + wake on wind / body overlap ----
{
  const s = createClothSystem([blk('r')], flat);
  const calm = { sampleInto: (x, y, z, t, o) => { o[0] = 0; o[1] = 0; o[2] = 0; } };
  const gale = { sampleInto: (x, y, z, t, o) => { o[0] = 6; o[1] = 0; o[2] = 0; } };
  let t = 0;
  for (; t < 1500 && !s.isAsleep(0); t++) { s.markDrawn(0); s.tick(t, calm, 0, -3, 2); }
  ok('rest: sleeps after settling in zero wind', s.isAsleep(0) && t < 1500, `t=${t}`);
  const v = s.cloths[0].version;
  for (let k = 0; k < 30; k++, t++) { s.markDrawn(0); s.tick(t, calm, 0, -3, 2); }
  ok('rest: stays asleep (version unchanged)', s.cloths[0].version === v && s.isAsleep(0));
  s.markDrawn(0); s.tick(t++, gale, 0, -3, 2);
  ok('rest: wakes on wind > 0', !s.isAsleep(0));
  for (let k = 0; k < 1500 && !s.isAsleep(0); k++, t++) { s.markDrawn(0); s.tick(t, calm, 0, -3, 2); }
  ok('rest: sleeps again', s.isAsleep(0));
  s.setBody(0, 0.7, -2, 0, 0.35, 1.8);
  s.markDrawn(0); s.tick(t++, calm, 0, -3, 2);
  ok('body outside the bbox does not wake', s.isAsleep(0));
  s.setBody(0, 0.7, 0, 0, 0.35, 1.8);
  s.markDrawn(0); s.tick(t++, calm, 0, -3, 2);
  ok('body overlapping the bbox wakes', !s.isAsleep(0));
  for (let k = 0; k < 240; k++, t++) { s.markDrawn(0); s.tick(t, calm, 0, -3, 2); }
  ok('body standing in the cloth keeps it awake', !s.isAsleep(0));
  let pen = 0;
  const p = s.cloths[0].pos;
  for (let k = 0; k < s.cloths[0].n; k++) {
    const dx = p[3 * k] - 0.7, dy = p[3 * k + 1], z = p[3 * k + 2];
    if (z > 0.35 && z < 1.45) pen = Math.max(pen, 0.35 - Math.sqrt(dx * dx + dy * dy));
  }
  ok('player capsule: no cloth node inside it', pen < 0.01, String(pen));
}

// ---- determinism + hash differs by seed ----
{
  const run = (seed) => {
    const s = createClothSystem([blk('d', { seed })], flat);
    const w = createWind({ dirDeg: 90, speed: 5, gust: { amp: 0.4, periodSec: 2, travel: 8 } }, 3);
    for (let t = 0; t < 600; t++) { s.markDrawn(0); s.tick(t, w, 0, -3, 2); }
    return hashOf(s);
  };
  ok('deterministic: same inputs -> same hash', run(5) === run(5));
  ok('different seed -> different hash', run(5) !== run(6));
}

// ---- mesh version hook ----
{
  const s = createClothSystem([blk('m')], flat);
  const mesh = { meshVersion: 1 };
  s.setMesh(0, mesh);
  const w = { sampleInto: (x, y, z, t, o) => { o[0] = 0; o[1] = 6; o[2] = 0; } };
  for (let t = 1; t < 30; t++) { s.markDrawn(0); s.tick(t, w, 0, -3, 2); }
  ok('mesh.meshVersion bumped when the sim moved', mesh.meshVersion > 1, String(mesh.meshVersion));
}

// ---- World.load: world + level blocks, level-frame conversion, not saved ----
let sharedAssets;
{
  const { assets } = await loadTestAssets();
  sharedAssets = assets;
  const def = assets.world('world_m1');
  const base = World.load(def, assets, {});
  // CLOTH-1b5 placed a real content cloth (tower.stairwell.canvas) in
  // world_m1's own tower level, so the base system is no longer empty -
  // this line now guards "system present, never null" (count >= 1 from
  // the real content) rather than hard count === 0.
  ok('World.load without extra cloths -> system present, never null, carries the real content cloth', !!base.cloths && base.cloths.count >= 1);
  ok('bare new World() has an empty system', new World().cloths.count === 0);
  const sIn = base.structures.find((x) => x.id === 'tower') || base.structures[0];
  const f = sIn.frame;
  const wdef = { ...def, cloths: [blk('wc', { origin: [f.x + 1, f.y + 1, f.z + 3] })] };
  const origLevel = assets.level;
  assets.level = (n) => {
    const d = origLevel.call(assets, n);
    if (d !== sIn.level.def && n !== 'tower') return d;
    return { ...d, cloths: [{ id: 'lc', cols: 6, rows: 4, size: [1, 1], origin: [2, 3, 4], yawDeg: 0, pins: [[0, 0]], colliders: [{ type: 'box', c: [2, 3, 3], half: [1, 0.2, 1], yawDeg: 0 }] }] };
  };
  let w;
  try { w = World.load(wdef, assets, {}); } finally { assets.level = origLevel; }
  // this override REPLACES tower's level-cloths array with just "lc" (the real
  // "stairwell.canvas" content cloth is not part of this particular load): wc (world) + lc (level) = 2
  ok('World.load builds world + level cloths', w.cloths.count >= 2, String(w.cloths.count));
  const lcId = w.cloths.ids.find((id) => id.endsWith('.lc'));
  ok('level cloth id prefixed with the structure id', !!lcId, w.cloths.ids.join());
  if (lcId) {
    const slot = w.cloths.ids.indexOf(lcId);
    const pin = w.cloths.cloths[slot].pos; // pin (0,0) = node 0 stays at the converted origin
    const st = w.structures.find((x) => lcId.startsWith(x.id + '.'));
    const ex = collectClothDefs({}, [{ ...st, level: { def: { cloths: [{ id: 'lc', origin: [2, 3, 4] }] } } }])[0];
    ok('level-local origin converted through the structure frame', Math.abs(pin[0] - ex.origin[0]) < 1e-9 && Math.abs(pin[1] - ex.origin[1]) < 1e-9 && Math.abs(pin[2] - ex.origin[2]) < 1e-9, `${pin[0]},${pin[1]},${pin[2]} vs ${ex.origin}`);
    ok('level yaw gains the structure yawSteps*90', ex.yawDeg === st.frame.yawSteps * 90);
  }
  ok('cloths not in serialize', !/cloth/i.test(stringifySave(serialize(w))));
  const m = threw(() => { const bd = { ...def, cloths: [blk('bad', { pins: [] })] }; World.load(bd, assets, {}); });
  ok('World.load throws naming the bad cloth', !!m && m.includes('"bad"'), String(m));
}

// ---- CLOTH-DRAPE-01: the stairwell drape (tower.level.json) hangs from the step-I lip ----
{
  const assets = sharedAssets;
  const w = World.load(assets.world('world_m1'), assets, {});
  const sys = w.cloths;
  const di = sys.ids.findIndex((n) => n.endsWith('stairwell.drape'));
  ok('drape: loaded by id', di >= 0, sys.ids.join());
  if (di >= 0) {
    const c = sys.cloths[di];
    ok('drape: 80 nodes', c.n === 80, String(c.n));
    const fr = w.structures.find((x) => x.id === 'tower').frame;
    // wake it (eye next to it, drawn) and settle 600 ticks
    const ex = fr.x + 13, ey = fr.y + 7.4, ez = fr.z + 5.4;
    let minZ = 1e9, pinZ = [];
    for (let t = 1; t <= 600; t++) { sys.lastDrawn.fill(t); sys.tick(t, null, ex, ey, ez); }
    for (let k = 0; k < c.n; k++) minZ = Math.min(minZ, c.pos[3 * k + 2]);
    ok('drape: pinned nodes at the step-I lip (z 5.4, x 14.05)', [1, 3, 6].every((col) => Math.abs(c.pos[3 * col + 2] - (fr.z + 5.4)) < 0.05 && Math.abs(c.pos[3 * col] - (fr.x + 14.05)) < 0.05), String(c.pos.slice(0, 24)));
    ok('drape: hem stays >= 3.45 m above the level floor after settling', minZ - fr.z >= 3.45, String(minZ - fr.z));
    ok('drape: cloth budget holds (2 cloths awake, <= 768 nodes)', sys.stats.awake <= 6 && sys.stats.awakeNodes <= 768, JSON.stringify(sys.stats));
  }
}

console.log(`cloths.test: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
