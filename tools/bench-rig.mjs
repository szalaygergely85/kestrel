// RIG-04 bench (docs/architecture.md 38.32): 100 `char.` rigged instances (10 fixed-seed chargen characters x 10) pushed + posed
// per frame through VoxelPool (beginFrame, pushInstance, project, projectShadow).
//   node --expose-gc tools/bench-rig.mjs [frames]      Reports ms p50/p95 and bytes allocated per frame (0 expected).
import { composeCharacter, meshCharacter, collapseRig, riggedModelDef, randomRecipe, HUMANOID_PART_MAP, VoxelPool } from '../engine/index.js';
import { loadKit, DEMO_CLIPS } from './chargen/export.mjs';

const FRAMES = +process.argv[2] || 30000, WARM = +(process.env.WARM || 30000), N = 100, CHARS = 10;
const STAGE = +(process.env.STAGE ?? 2); // 0 push only, 1 +project, 2 +projectShadow, 3 +feed (debug aid)
const kit = loadKit();
const defs = {}, keys = [];
for (let c = 0; c < CHARS; c++) {
  const g = composeCharacter({ ...kit, clips: DEMO_CLIPS }, randomRecipe(kit, 1000 + c));
  defs['char.' + c] = riggedModelDef(collapseRig(meshCharacter(g), kit.partMap || HUMANOID_PART_MAP));
  keys.push('char.' + c);
}
const mat = new Map();
const registry = { keys: () => keys, model: (k) => defs[k] };
const pool = new VoxelPool(); pool.renderer = 'mesh';
pool.bind(registry, { idFor: (m) => { if (!mat.has(m)) mat.set(m, mat.size + 1); return mat.get(m); } });
const partNames = (k) => Object.keys(defs[k].voxel.parts);

const cam = { x: 0, y: 40, z: 20, yawDeg: 0, pitchDeg: -20 }, rt = { cols: 160, rows: 80, pxCellW: 1, pxCellH: 2 };
const nClips = pool.models.get('char.0').clips ? pool.models.get('char.0').clips.length : 0;
// Pre-built argument tables: keeps the harness itself from boxing doubles, so the number measures the engine.
const POS = new Float64Array(200), YAW = new Float64Array(360), TMS = new Float64Array(4096);
for (let i = 0; i < 100; i++) { POS[i] = (i % 10) * 1.2 - 6; POS[100 + i] = (i / 10 | 0) * 1.2; }
for (let i = 0; i < 360; i++) YAW[i] = i; for (let i = 0; i < 4096; i++) TMS[i] = i * 16.7;
let step = 0, posed = 0;
// The pool caps at MAX_VOX_INSTANCES_MESH (48) per beginFrame, so 100 instances = passes of <= cap (same per-instance work).
function frame() {
  const t = step * 16.7; step++;
  for (let base = 0; base < N; base += pool.cap) {
    pool.beginFrame();
    for (let i = base; i < N && i < base + pool.cap; i++) pool.pushInstance(keys[i % CHARS], POS[i], POS[100 + i], 0, YAW[(i + step) % 360], (nClips && !process.env.NOCLIP) ? i % nClips : -1, 0, TMS[(i + step) % 4096]);
    if (STAGE >= 1) pool.project(cam, rt);
    if (STAGE >= 2) pool.projectShadow();
    posed += pool.list.length;
  }
}
const ms = new Float64Array(FRAMES);
for (let i = 0; i < WARM; i++) frame();
posed = 0;
for (let i = 0; i < FRAMES; i++) { const t0 = performance.now(); frame(); ms[i] = performance.now() - t0; }
// Allocation: heapUsed deltas over short windows (no scavenge inside a window); min/median across windows is the per-frame figure.
const WIN = 200, win = [];
for (let w = 0; w < 60; w++) {
  globalThis.gc && globalThis.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < WIN; i++) frame();
  win.push((process.memoryUsage().heapUsed - h0) / WIN);
}
win.sort((x, y) => x - y);
ms.sort();
const q = (p) => ms[Math.min(FRAMES - 1, Math.floor(p * FRAMES))];
console.log(`clips/char ${nClips}, listed ${pool.list.length}, shadow ${pool.shadowList.length}, raw ${pool._rawCount}`);
console.log(`ms/frame (100 inst, push+project+shadow): p50 ${q(0.5).toFixed(4)}  p95 ${q(0.95).toFixed(4)}  max ${ms[FRAMES - 1].toFixed(4)}`);
console.log(`bytes allocated per frame (100 inst): min ${win[0].toFixed(1)}  median ${win[win.length >> 1].toFixed(1)}  max ${win[win.length - 1].toFixed(1)} ${globalThis.gc ? '' : '(run with --expose-gc)'}`);
