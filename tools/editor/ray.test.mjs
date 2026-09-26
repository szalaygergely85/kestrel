// tools/editor/ray.test.mjs - US-032 S1 (docs/architecture.md 24.13).
// Plain Node ESM, no framework - run with `node tools/editor/ray.test.mjs`.
import {
  unprojectCell, projectPoint, rayPoint, decodePlaneId, rayCylinderHit, rayPickEntities,
  KIND_NONE, KIND_WALL,
} from './ray.js';
import { KIND_TERRAIN, KIND_MODEL } from '../../engine/index.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

function approxEqual(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

const COLS = 240, ROWS = 90, PX_W = 8, PX_H = 16;

// ---- unproject/project round trip (24.13 S1) ------------------------------
{
  const cam = { x: 10, y: 20, z: 3, yawDeg: 37, pitchDeg: -10 };
  for (const [col, row, depth] of [[120, 45, 5], [10, 80, 12], [230, 5, 30], [120, 45, 1]]) {
    const ray = unprojectCell(cam, COLS, ROWS, PX_W, PX_H, col, row);
    const point = rayPoint(ray, depth);
    const proj = projectPoint(cam, COLS, ROWS, PX_W, PX_H, point);
    ok(`round trip col=${col} row=${row} depth=${depth}: col`, approxEqual(proj.col, col, 1e-6), `got ${proj.col}`);
    ok(`round trip col=${col} row=${row} depth=${depth}: row`, approxEqual(proj.row, row, 1e-6), `got ${proj.row}`);
    ok(`round trip col=${col} row=${row} depth=${depth}: depth`, approxEqual(proj.depth, depth, 1e-6), `got ${proj.depth}`);
  }
}

// ---- decodePlaneId ---------------------------------------------------------
{
  ok('decodePlaneId: sky', decodePlaneId(KIND_NONE, 0).type === 'sky');
  ok('decodePlaneId: terrain', decodePlaneId(KIND_TERRAIN, -1).type === 'terrain');
  // packPlaneId(structSeq, tag, coord): structure hit.
  const structPlaneId = ((2 & 0x7) << 28) | ((5 & 0xf) << 24) | 123;
  const d1 = decodePlaneId(KIND_WALL, structPlaneId);
  ok('decodePlaneId: structure type', d1.type === 'structure');
  ok('decodePlaneId: structure structSeq', d1.structSeq === 2, `got ${d1.structSeq}`);
  ok('decodePlaneId: structure tag', d1.tag === 5, `got ${d1.tag}`);
  // Voxel instance slot: top nibble 0xF, slot in the next nibble down (24.6).
  const voxelPlaneId = (0xf << 28) | (7 << 24) | 999;
  const d2 = decodePlaneId(KIND_MODEL, voxelPlaneId);
  ok('decodePlaneId: voxel type', d2.type === 'voxel');
  ok('decodePlaneId: voxel slot', d2.slot === 7, `got ${d2.slot}`);
}

// ---- ray/cylinder ------------------------------------------------------
{
  const straightRay = { ox: 0, oy: 0, oz: 1, dx: 0, dy: 1, dz: 0 }; // looking straight along +y, level
  const cylHit = { x: 0, y: 10, zMin: 0, zMax: 2, radius: 1 };
  const dHit = rayCylinderHit(straightRay, cylHit, 100);
  ok('ray/cylinder: hit gives the near intersection depth', dHit != null && approxEqual(dHit, 9), `got ${dHit}`);

  const cylMiss = { x: 5, y: 10, zMin: 0, zMax: 2, radius: 1 };
  ok('ray/cylinder: miss (off to the side) returns null', rayCylinderHit(straightRay, cylMiss, 100) === null);

  ok('ray/cylinder: occluded (hit depth beyond maxDepth) returns null', rayCylinderHit(straightRay, cylHit, 5) === null);

  const cylNear = { x: 0, y: 4, zMin: 0, zMax: 2, radius: 1 };
  const cylFar = { x: 0, y: 10, zMin: 0, zMax: 2, radius: 1 };
  // A vertical miss (outside the cylinder's z range) still doesn't clobber the near one.
  const cylOutOfHeight = { x: 0, y: 2, zMin: 5, zMax: 6, radius: 1 };
  const fakeAssets = {
    has(kind, key) { return kind === 'model' && key === 'sprite_model'; },
    model(key) {
      if (key === 'sprite_model') return { world: { w: 1, h: 2 } };
      throw new Error(`unknown model "${key}"`); // real AssetRegistry.model() throws, not returns null
    },
  };
  const entities = [
    { id: 'far', transform: { x: 0, y: 10, z: 0 }, components: { sprite: { model: 'sprite_model' } } },
    { id: 'near', transform: { x: 0, y: 4, z: 0 }, components: { sprite: { model: 'sprite_model' } } },
    { id: 'oob', transform: { x: 0, y: 2, z: 5 }, components: { sprite: { model: 'sprite_model' } } },
    // US-032 fix: an entity referencing a model key the bundle doesn't
    // carry (real case: `waystone` before a page's script list carries
    // `voxel_world.js`) must be skipped, never crash the whole pick.
    { id: 'unknownModel', transform: { x: 0, y: 5, z: 0 }, components: { sprite: { model: 'nope' } } },
  ];
  const nearest = rayPickEntities(straightRay, entities, fakeAssets, 100);
  ok('ray/cylinder: nearest of two entities wins', nearest && nearest.id === 'near', JSON.stringify(nearest));
  ok('ray/cylinder: an entity with an unknown model key is skipped, not thrown', nearest && nearest.id !== 'unknownModel');
  void cylNear; void cylFar; void cylOutOfHeight;
}

console.log(`ray.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
