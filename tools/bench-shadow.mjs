// ME-19b: retained ME-15d sun-shadow CPU benchmark, moved from bench-cast.
// Run: node --expose-gc tools/bench-shadow.mjs --gc [--frames N].
import { performance } from 'node:perf_hooks';
import { World, dirFromAzEl } from '../engine/index.js';
import { createSunShadowMatrix, shadowSunMatrix, sunShadowCentre, shadowInputHash, SUN_SHADOW_DEFAULTS } from '../engine/render/shadowSun.js';
import { createShadowList, buildShadowList, shadowWorldZ } from '../engine/mesh/shadowList.js';
import { LevelMeshCache } from '../engine/mesh/DrawList.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { POSES } from './bench-poses.js';
import { DrawList, addStructures } from '../engine/mesh/DrawList.js';
import { makeMockGpuDevice } from '../engine/test/assert.js';
import { WgShadowPass } from '../engine/render/gpu/wg/passShadow.js';
import { WgPointShadowPass } from '../engine/render/gpu/wg/passPointShadow.js';

const WARMUP_FRAMES = 120;
// ME-16: point-shadow CPU row (WgPointShadowPass on the device mock, real World). Lights sit at the first POSES positions (+0.4 m up) and hop 0.5 m
// every frame so each frame re-renders (worst case, no key skip). Reports faces/frame, casters per face (draws/face), ms per face.
function runPointShadowBench(world, frames) {
  let ok = true;
  const cam = { x: POSES[0].x, y: POSES[0].y, z: POSES[0].z, yawDeg: 0, pitchDeg: 0 };
  const levelCache = new LevelMeshCache(), camList = new DrawList(64); camList.begin(); addStructures(camList, world, cam, levelCache, 2000);
  const raster = { list: camList, levelCache, meshCache: null, strictMatIdFor: null };
  for (const [k, level] of [[2, 'medium'], [4, 'high']]) {
    const d = makeMockGpuDevice().device; d.beginPass = () => {}; d.draw = () => {};
    const sun = new WgShadowPass(d, { shadows: { sun: 'off' }, casters: true }), ps = new WgPointShadowPass(d, { level, pointShadows: { n: k }, casters: sun });
    const L = { count: k, on: new Uint8Array(8).fill(1), pos: new Float32Array(32), col: new Float32Array(32).fill(1), defX: new Float32Array(8), defY: new Float32Array(8), defZ: new Float32Array(8), entity: new Uint8Array(8) };
    for (let i = 0; i < k; i++) { const q = POSES[i % POSES.length]; L.defX[i] = q.x; L.defY[i] = q.y; L.defZ[i] = q.z + 0.4; L.pos[i * 4 + 3] = 8; L.col[i * 4] = 4 - i * 0.4; }
    const p = { _light: L, _cam: cam, _world: world, _table: null, _palette: null, _voxelPool: null, _instances: null, terrainEnabled: false };
    let faces = 0, draws = 0, ms = 0, frameMs = 0, tick = 0;
    const step = () => { tick++; for (let i = 0; i < k; i++) L.defX[i] += (tick & 1) ? 0.5 : -0.5; ps.run(p, raster); };
    for (let i = 0; i < WARMUP_FRAMES; i++) step();
    for (let i = 0; i < frames; i++) { const t0 = performance.now(); step(); frameMs += performance.now() - t0; faces += ps.stats.faces; draws += ps.stats.draws; }
    ms = frameMs;
    const f = faces / frames, perFace = faces ? ms / faces : 0;
    console.log(`  [point shadow cpu] ${k} lights (${level}): faces/frame ${f.toFixed(1)}, casters(draws)/face ${(faces ? draws / faces : 0).toFixed(1)}, ms/face ${perFace.toFixed(4)}, ms/frame ${(ms / frames).toFixed(4)}`);
    ok = ok && f > 0;
    ps.dispose(); sun.dispose();
  }
  return ok;
}
function runShadowCpuBench(world, frames, withGc) {
  const so = { ...SUN_SHADOW_DEFAULTS };
  const sunDir = dirFromAzEl(135, 40, new Float64Array(3));
  const sm = createSunShadowMatrix(), list = createShadowList(), centre = new Float64Array(3), wz = { min: 0, max: 0 };
  const cache = new LevelMeshCache(), key = new Int32Array(2);
  const src = { centre: { x: 0, y: 0, z: 0 }, cache, terrainSet: null, voxelPool: null, voxelMeshCache: null, fogFarM: 2000, instances: null };
  const one = (cam) => {
    sunShadowCentre(cam, so, centre);
    src.centre.x = centre[0]; src.centre.y = centre[1]; src.centre.z = centre[2];
    shadowWorldZ(world, cache, wz);
    const m = shadowSunMatrix(sunDir, centre, so, wz, sm);
    buildShadowList(list, null, world, m.planes, src);
    shadowInputHash(list, m.M, world.structVersion | 0, key);
  };
  let ok = true;
  const ms = new Float64Array(frames);
  for (const pose of POSES) {
    const cam = { x: pose.x, y: pose.y, z: pose.z, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg };
    for (let i = 0; i < WARMUP_FRAMES * 4; i++) one(cam);
    if (withGc && global.gc) global.gc();
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < frames; i++) { const t0 = performance.now(); one(cam); ms[i] = performance.now() - t0; }
    if (withGc && global.gc) global.gc();
    const perFrame = (process.memoryUsage().heapUsed - h0) / frames;
    const sorted = Array.from(ms).sort((a, b) => a - b);
    const p50 = sorted[Math.floor(frames * 0.5)], p95 = sorted[Math.floor(frames * 0.95)];
    const passP = p95 <= 0.15, passG = !(withGc && global.gc) || perFrame <= 64;
    console.log(`  [shadow cpu] ${pose.name}: items ${list.count}, p50 ${p50.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms (<= 0.15: ${passP ? 'OK' : 'FAIL'}), heap ${perFrame.toFixed(1)} B/frame${withGc && global.gc ? (passG ? ' OK' : ' FAIL') : ''}`);
    ok = ok && passP && passG;
  }
  return ok;
}

const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('node --expose-gc tools/bench-shadow.mjs [--gc] [--frames N] | rows: sun-shadow CPU list per pose; point-shadow CPU rows (ME-16: faces/frame, casters per face, ms per face for 2 and 4 lights)'); process.exit(0); }
const frameIdx = args.indexOf('--frames');
const frames = frameIdx >= 0 ? Number(args[frameIdx + 1]) : 600;
if (!Number.isInteger(frames) || frames <= 0) throw new Error('--frames must be a positive integer');
const { bundle } = await loadTestAssets();
const world = World.load(
  { terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] },
  { level: () => bundle.levels.test_room }, {},
);
const ok = runShadowCpuBench(world, frames, args.includes('--gc')) && runPointShadowBench(world, frames);
console.log(ok ? '[bench-shadow] ALL CHECKS PASS' : '[bench-shadow] FAILURES ABOVE');
if (!ok) process.exitCode = 1;
