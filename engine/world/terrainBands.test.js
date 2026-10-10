// engine/world/terrainBands.test.js (WS2-01, arch 38.38): authored band zones, stepped bake, overlap copy, atomic swap.
// Run: node engine/world/terrainBands.test.js   (add --expose-gc for a meaningful heap number)
import { World } from './World.js';
import { Terrain } from './Terrain.js';
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
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod;
farTowerMod; ferrumLightsMod;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const { assets } = await loadTestAssets();
const heapMB = () => { if (globalThis.gc) globalThis.gc(); return process.memoryUsage().heapUsed / 1048576; };
const def0 = (() => { const d = JSON.parse(JSON.stringify(assets.world('world_m1'))); delete d.terrainBand; delete d.terrainBands; return d; })();
const A = { id: 'east', cx0: 8, cy0: 7, cw: 5, ch: 3 }, B = { id: 'west', cx0: 6, cy0: 7, cw: 5, ch: 3 };
const mk = (extra, o) => World.load({ ...def0, ...extra }, assets, { detail: true, ...o });
const throws = (extra, re) => { try { mk(extra); return false; } catch (e) { return re.test(e.message); } };
const eq = (a, b) => Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;
const same = (a, b) => a.x0 === b.x0 && a.y0 === b.y0 && a.w === b.w && a.h === b.h && a.minH === b.minH && a.maxH === b.maxH && eq(a.height, b.height) && eq(a.type, b.type) && eq(a.hDraw, b.hDraw);

// --- validation ---------------------------------------------------------------
ok('both terrainBand and terrainBands -> error', throws({ terrainBand: A, terrainBands: [A, B] }, /mutually exclusive/));
ok('0 zones -> error', throws({ terrainBands: [] }, /1\.\.4/));
ok('5 zones -> error', throws({ terrainBands: [1, 2, 3, 4, 5].map((i) => ({ ...A, id: 'z' + i })) }, /1\.\.4/));
ok('different sizes -> error', throws({ terrainBands: [A, { ...B, cw: 4 }] }, /same cw x ch/));
ok('duplicate id -> error', throws({ terrainBands: [A, { ...B, id: 'east' }] }, /unique/));
ok('bad bandSwitch -> error', throws({ terrainBands: [A, B], bandSwitch: { prefetchM: 100, switchM: 112 } }, /bandSwitch/));
ok('bad rect -> error', throws({ terrainBands: [{ ...A, cw: 7 }] }, /terrainBand/));

// --- worlds without terrainBands: untouched --------------------------------------
const wOld = mk({});
ok('no terrainBands -> null/idle', wOld.terrainBands === null && wOld.bandId === null && wOld.streamBand(1200, 1088, 2) === 0 && wOld.ensureBandFor(1200, 1000) === false);
const wOne = mk({ terrainBand: A }), wOneL = mk({ terrainBands: [A] });
ok('one-zone terrainBands == terrainBand world (bytes)', same(wOne.terrain.near, wOneL.terrain.near));

// --- zone pick + hysteresis table -------------------------------------------------
const w = mk({ terrainBands: [A, B] }, { spawn: { x: 1500, y: 1000 } });
ok('spawn in east picks zone A', w.bandId === 'east' && w.terrain.near.x0 === 1024);
const T = w.terrain, cs = T.chunkSize;
ok('margin: east @1200 = 176', w._bandMargin(A, 1200, 1088, cs) === 176);
const ev = []; w.events = { emit: (n, p) => ev.push(n + ':' + ((p && p.from) || '') + '>' + ((p && p.to) || '')) };
let allIdle = true; for (const x of [1500, 1300, 1210]) if (w.streamBand(x, 1088, 2) !== 0 || T.nearBandPending) allIdle = false;
ok('margin >= prefetchM: idle, nothing pending', allIdle);
ok('x=1190 (margin 166): starts baking', w.streamBand(1190, 1088, 0.01) === 1 && T.nearBandPending && w._bandPend === 1);
const nearBefore = T.near;
let maxStep = 0, steps = 0, r = 1; const stepMs = [];
while (r === 1) { const t = performance.now(); r = w.streamBand(1190, 1088, 2); const dt = performance.now() - t; stepMs.push(dt.toFixed(1)); maxStep = Math.max(maxStep, dt); if (++steps > 5000) break; }
ok('bake completes; margin 166 >= switchM: no swap yet', r === 0 && w.bandId === 'east' && T.near === nearBefore && T.nearBandPending);
console.log(`stepped bake: ${steps} steps, max ${maxStep.toFixed(2)} ms; ${stepMs.join(" ")}`);
ok('slice budget: step <= 2 ms + one row (<6)', maxStep < 6, maxStep.toFixed(2));
ok('x=1150 margin 126 >= 112: still no swap', w.streamBand(1150, 1088, 2) === 0 && w.bandId === 'east');
ok('x=1130 margin 106 < switchM: swap', w.streamBand(1130, 1088, 2) === 2 && w.bandId === 'west');
ok('events: world:band east>west, no band:late', ev.includes('world:band:east>west') && !ev.some((e) => e.startsWith('band:late')), ev.join(','));
ok('swap -> new near identity, version+1, x0 768', T.near !== nearBefore && T.near.x0 === 768 && T.near.version > nearBefore.version);
ok('west zone, x=1140 (west margin >= 176): idle', w.streamBand(1140, 1088, 2) === 0);
ok('back east: prefetch at x=1230 (west margin 178 -> 1232 edge)', w.streamBand(1234, 1088, 2) === 1 && w._bandPend === 0);
w.streamBand(1000, 1088, 2);
ok('walking back west cancels the pending bake', !T.nearBandPending && w._bandPend === -1);

// --- overlap copy == full bake (bit-identical), sliced == bakeNearBand -------------
{
  const full = new Terrain(T.recipe); full.bakeNearBand(6, 7, 5, 3);
  const t1 = new Terrain(T.recipe); t1.bakeNearBand(8, 7, 5, 3);
  t1.beginNearBand(6, 7, 5, 3);
  let n = 0; while (!t1.nearBandStep(0.05) && n++ < 100000);
  t1.swapNearBand();
  ok('overlap copy + stepped bake == bakeNearBand bytes (east->west)', same(t1.near, full.near));
  t1.beginNearBand(8, 7, 5, 3); t1.nearBandStep(Infinity); t1.swapNearBand();
  const fullE = new Terrain(T.recipe); fullE.bakeNearBand(8, 7, 5, 3);
  ok('west->east back == bakeNearBand bytes', same(t1.near, fullE.near));
  const t3 = new Terrain(T.recipe); t3.bakeNearBand(0, 0, 2, 2);
  t3.beginNearBand(10, 10, 2, 2); t3.nearBandStep(Infinity); t3.swapNearBand();
  const f3 = new Terrain(T.recipe); f3.bakeNearBand(10, 10, 2, 2);
  ok('disjoint band == bakeNearBand', same(t3.near, f3.near));
  const t4 = new Terrain(T.recipe); t4.bakeNearBand(8, 7, 5, 3);
  t4.beginNearBand(7, 8, 5, 3); t4.nearBandStep(Infinity); t4.swapNearBand();
  const f4 = new Terrain(T.recipe); f4.bakeNearBand(7, 8, 5, 3);
  ok('diagonal-shift overlap == bakeNearBand', same(t4.near, f4.near));
  // publish atomicity: near untouched until swap; swap before ready throws
  const t5 = new Terrain(T.recipe); t5.bakeNearBand(8, 7, 5, 3); const n5 = t5.near, h0 = t5.groundAt(1300, 1000);
  t5.beginNearBand(6, 7, 5, 3); t5.nearBandStep(0.05);
  let thr = false; try { t5.swapNearBand(); } catch (e) { thr = true; }
  ok('swap before ready throws; near object + groundAt untouched while baking', thr && t5.near === n5 && t5.groundAt(1300, 1000) === h0);
  t5.nearBandStep(Infinity); t5.swapNearBand();
  ok('groundAt continuous across the swap (overlap points)', t5.groundAt(1300, 1000) === h0 && t5.groundAt(1200, 1000) === full.groundAt(1200, 1000));
}

// --- ensureBandFor + late path ----------------------------------------------------
{
  const w2 = mk({ terrainBands: [A, B] }), ev2 = []; w2.events = { emit: (n) => ev2.push(n) };
  ok('load without spawn = zone 0', w2.bandId === 'east');
  ok('ensureBandFor same zone -> false', w2.ensureBandFor(1500, 1000) === false);
  ok('ensureBandFor west -> swaps', w2.ensureBandFor(1000, 1072) === true && w2.bandId === 'west' && w2.terrain.near.x0 === 768);
  ok('ensureBandFor emitted world:band + world:scatter', ev2.includes('world:band') && ev2.includes('world:scatter'));
  const w3 = mk({ terrainBands: [A, B] }), ev3 = []; w3.events = { emit: (n) => ev3.push(n) };
  w3.streamBand(1190, 1088, 0.01);
  ok('margin < 32 with pending bake: sync finish + band:late', w3.streamBand(1040, 1088, 0.01) === 2 && ev3.includes('band:late') && w3.bandId === 'west');
}

// --- idle: ~0 alloc over 10k calls --------------------------------------------------
{
  const w4 = mk({ terrainBands: [A, B] });
  for (let i = 0; i < 200; i++) w4.streamBand(1500, 1088, 2);
  const h0 = heapMB();
  for (let i = 0; i < 10000; i++) w4.streamBand(1500 + (i & 7), 1088, 2);
  const d = heapMB() - h0;
  ok('idle streamBand: 10k calls < 0.2 MB heap growth', d < 0.2, d.toFixed(3) + ' MB' + (globalThis.gc ? '' : ' (no --expose-gc)'));
}

// --- scatter in the overlap identical across zones (when the world has real trees) -----
{
  const wa = mk({ terrainBands: [A, B] }), wb = mk({ terrainBands: [B, A] });
  if (wa.scatter && wb.scatter && wa.scatter.x) {
    const key = (sc) => { const out = []; for (let i = 0; i < sc.count; i++) { const x = sc.x[i]; if (x >= 1100 && x < 1330) out.push(x + ',' + sc.y[i]); } return out.join('|'); };
    ok('scatter trees in the overlap identical (A-first vs B-first world)', key(wa.scatter) === key(wb.scatter));
  } else ok('scatter n/a in this test world', true);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f2) => console.error('FAIL:', f2)); process.exit(1); }
console.log('ALL PASS');
