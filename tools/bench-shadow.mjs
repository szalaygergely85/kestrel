// ME-19b: retained ME-15d sun-shadow CPU benchmark, moved from bench-cast.
// Run: node --expose-gc tools/bench-shadow.mjs --gc [--frames N].
import { performance } from 'node:perf_hooks';
import { World, dirFromAzEl } from '../engine/index.js';
import { createSunShadowMatrix, shadowSunMatrix, sunShadowCentre, shadowInputHash, SUN_SHADOW_DEFAULTS } from '../engine/render/shadowSun.js';
import { createShadowList, buildShadowList, shadowWorldZ } from '../engine/mesh/shadowList.js';
import { LevelMeshCache } from '../engine/mesh/DrawList.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { POSES } from './bench-poses.js';
const WARMUP_FRAMES = 120;
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

const args = process.argv.slice(2), frameIdx = args.indexOf('--frames');
const frames = frameIdx >= 0 ? Number(args[frameIdx + 1]) : 600;
if (!Number.isInteger(frames) || frames <= 0) throw new Error('--frames must be a positive integer');
const { bundle } = await loadTestAssets();
const world = World.load(
  { terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 } }], entities: [] },
  { level: () => bundle.levels.test_room }, {},
);
const ok = runShadowCpuBench(world, frames, args.includes('--gc'));
console.log(ok ? '[bench-shadow] ALL CHECKS PASS' : '[bench-shadow] FAILURES ABOVE');
if (!ok) process.exitCode = 1;
