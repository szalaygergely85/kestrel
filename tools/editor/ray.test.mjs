// tools/editor/ray.test.mjs - US-032 S1 (docs/architecture.md 24.13).
// Plain Node ESM, no framework - run with `node tools/editor/ray.test.mjs`.
import {
  unprojectCell, projectPoint, screenCentreGroundHit, rayPoint, decodePlaneId, rayCylinderHit, rayPickEntities, resolveVoxelSlot,
  KIND_NONE, KIND_WALL,
} from './ray.js';
import { KIND_TERRAIN, KIND_MODEL, createPitchedTerms, pitchedTerms, unprojectPitched, worldToCell } from '../../engine/index.js';
import { makeOk, approxEqual as approxEqualCore } from '../../engine/test/assert.js';

let pass = 0;
let fail = 0;
const failures = [];

const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function approxEqual(a, b, eps = 1e-6) { return approxEqualCore(a, b, eps); }

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

// ---- US-068d: screen-centre ground hit (flat ground z=0) ----
{
  const cam = { x: 5, y: 7, z: 10, yawDeg: 0, pitchDeg: -45 };
  const h = screenCentreGroundHit(cam, COLS, ROWS, PX_W, PX_H, () => 0);
  ok('centre hit on z=0 ground', h && approxEqual(h.z, 0, 1e-4) && approxEqual(h.x, 5, 1e-3) && approxEqual(h.y, 7 - 10, 0.5), JSON.stringify(h));
  const pr = projectPoint(cam, COLS, ROWS, PX_W, PX_H, h);
  ok('hit projects back to screen centre', approxEqual(pr.col, (COLS - 1) / 2, 1e-3) && approxEqual(pr.row, (ROWS - 1) / 2, 1e-3), JSON.stringify(pr));
  ok('level camera over flat ground: no hit', screenCentreGroundHit({ ...cam, pitchDeg: 0 }, COLS, ROWS, PX_W, PX_H, () => 0, 100) === null);
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

// ---- ED-SCALE-1c (34.2 item 9): a scaled voxel entity's pick cylinder -----
{
  const straightRay = { ox: 0, oy: 0, oz: 1, dx: 0, dy: 1, dz: 0 };
  const fakeAssets = {
    has(kind, key) { return kind === 'model' && key === 'crate'; },
    model(key) {
      if (key === 'crate') return { voxel: { size: [1, 1, 2], cellM: 0.5 } }; // world radius 0.25, height 1 at scale 1
      throw new Error(`unknown model "${key}"`);
    },
  };
  // Unscaled: radius 0.25, height 1 - a ray at x=0.5 (just past the unscaled
  // radius) misses, but a 2x scale (radius 0.5) catches it.
  const unscaled = [{ id: 'crate1', transform: { x: 0.5, y: 10, z: 0 }, components: { voxel: { model: 'crate' } } }];
  ok('unscaled voxel cylinder: a ray just past its radius misses', rayPickEntities(straightRay, unscaled, fakeAssets, 100) === null);
  const scaled = [{ id: 'crate1', transform: { x: 0.5, y: 10, z: 0, scale: 2 }, components: { voxel: { model: 'crate' } } }];
  const hit = rayPickEntities(straightRay, scaled, fakeAssets, 100);
  ok('scale: 2 widens the pick cylinder radius, so the same ray now hits', hit && hit.id === 'crate1', JSON.stringify(hit));
  // Height scales too: a ray level with z=1.5 misses the unscaled height (1)
  // but hits once height doubles to 2.
  const rayUp = { ox: 0, oy: 0, oz: 1.5, dx: 0, dy: 1, dz: 0 };
  const tall = [{ id: 'crate1', transform: { x: 0, y: 10, z: 0, scale: 2 }, components: { voxel: { model: 'crate' } } }];
  const shortOne = [{ id: 'crate1', transform: { x: 0, y: 10, z: 0 }, components: { voxel: { model: 'crate' } } }];
  ok('unscaled voxel cylinder: a ray above its (unscaled) height misses', rayPickEntities(rayUp, shortOne, fakeAssets, 100) === null);
  ok('scale: 2 doubles the pick cylinder height, so the same ray now hits', !!rayPickEntities(rayUp, tall, fakeAssets, 100));
}

// ---- ED-MESH-1c: pitched (mesh) projection ---------------------------------
{
  const grid = { cols: COLS, rows: ROWS, pxCellW: PX_W, pxCellH: PX_H };
  for (const cam of [{ x: 10, y: 20, z: 3, yawDeg: 37, pitchDeg: -10 }, { x: -4, y: 7, z: 12, yawDeg: 200, pitchDeg: -55 }, { x: 0, y: 0, z: 2, yawDeg: 90, pitchDeg: 60 }]) {
    const terms = pitchedTerms(cam, grid, createPitchedTerms());
    for (const [col, row, vd] of [[120, 45, 5], [10, 80, 12], [230, 5, 30], [3, 3, 1.5]]) {
      const ray = unprojectCell(cam, COLS, ROWS, PX_W, PX_H, col, row, 'mesh');
      const pt = rayPoint(ray, vd);
      const ref = unprojectPitched(terms, col, row, vd, new Float64Array(3));
      ok(`pitched unproject == engine unprojectPitched (yaw ${cam.yawDeg} col ${col})`, approxEqual(pt.x, ref[0]) && approxEqual(pt.y, ref[1]) && approxEqual(pt.z, ref[2]));
      const proj = projectPoint(cam, COLS, ROWS, PX_W, PX_H, pt, 'mesh');
      ok(`pitched round trip col/row/vd (yaw ${cam.yawDeg} col ${col} row ${row})`,
        approxEqual(proj.col, col) && approxEqual(proj.row, row) && approxEqual(proj.depth, vd), JSON.stringify(proj));
      const w2c = worldToCell(terms, pt.x, pt.y, pt.z, new Float64Array(3));
      ok('pitched project == engine worldToCell', approxEqual(proj.col, w2c[0]) && approxEqual(proj.row, w2c[1]));
    }
  }
  // default (no renderer arg) is the pitched projection
  const cam = { x: 1, y: 2, z: 3, yawDeg: 15, pitchDeg: -20 };
  const a = unprojectCell(cam, COLS, ROWS, PX_W, PX_H, 50, 30);
  const m = unprojectCell(cam, COLS, ROWS, PX_W, PX_H, 50, 30, 'mesh');
  ok('default == mesh ray', a.dx === m.dx && a.dy === m.dy && a.dz === m.dz);
}

// ---- ED-MESH-1c: planeId encodings (DrawList levels / addVoxelInstances) ----
{
  for (let seq = 0; seq < 8; seq++) {
    const d = decodePlaneId(KIND_WALL, ((seq & 7) << 28) | (3 << 24) | 77);
    ok(`decode level planeId structSeq ${seq}`, d.type === 'structure' && d.structSeq === seq);
  }
  for (const k of [0, 1, 15, 16, 17, 31]) {
    const planeId = (0xf << 28) | ((k & 0xf) << 24); // planeIdOr = (k&0xF)<<24 plus the voxel marker nibble
    const d = decodePlaneId(KIND_MODEL, planeId >>> 0);
    ok(`decode voxel planeId k=${k} -> slot ${k & 15}`, d.type === 'voxel' && d.slot === (k & 15), JSON.stringify(d));
  }
}

// ---- ED-MESH-1c: slot-alias guard ------------------------------------------
{
  const mk = (x) => ({ rect: { minX: x - 0.5, maxX: x + 0.5, minY: -0.5, maxY: 0.5, minZ: 0, maxZ: 2 } });
  const list = Array.from({ length: 20 }, (_, i) => mk(i * 3));
  // slot 1 aliases index 1 (x=3) and 17 (x=51).
  ok('guard: point in instance 17 resolves to 17 (not 1)', resolveVoxelSlot(list, 1, { x: 51, y: 0, z: 1 }) === 17);
  ok('guard: point in instance 1 resolves to 1', resolveVoxelSlot(list, 1, { x: 3, y: 0, z: 1 }) === 1);
  ok('guard: point in neither -> -1 (ray-cylinder fallback)', resolveVoxelSlot(list, 1, { x: 30, y: 0, z: 1 }) === -1);
  ok('guard: eps tolerance 0.05', resolveVoxelSlot(list, 1, { x: 3.54, y: 0, z: 1 }) === 1 && resolveVoxelSlot(list, 1, { x: 3.6, y: 0, z: 1 }) === -1);
  ok('guard: <=16 instances, slot returned as is (dda unchanged)', resolveVoxelSlot(list.slice(0, 16), 5, { x: 999, y: 0, z: 0 }) === 5);
  ok('guard: slot beyond list -> -1', resolveVoxelSlot(list.slice(0, 5), 9, { x: 0, y: 0, z: 0 }) === -1);
  // generalises past 32 instances
  const big = Array.from({ length: 70 }, (_, i) => mk(i * 3));
  ok('guard: 4th alias (index 65, slot 1)', resolveVoxelSlot(big, 1, { x: 195, y: 0, z: 1 }) === 65);
}

// ---- US-068d: ortho round trip through ray.js (renderer 'mesh') -----------
{
  for (const [yaw, pitch] of [[0, -90], [0, 0], [45, -35.264], [-90, -90]]) {
    for (const halfH of [4, 40]) {
      const cam = { x: 10, y: 20, z: 3, yawDeg: yaw, pitchDeg: pitch, projection: 'ortho', orthoHalfH: halfH, focusX: 10, focusY: 20, focusZ: 3 };
      let worst = 0, parallel = true, f0 = null;
      for (const [col, row, vd] of [[120, 45, 500], [10, 80, 480], [230, 5, 520], [3.5, 7.25, 505]]) {
        const ray = unprojectCell(cam, COLS, ROWS, PX_W, PX_H, col, row, 'mesh');
        const proj = projectPoint(cam, COLS, ROWS, PX_W, PX_H, rayPoint(ray, vd), 'mesh');
        worst = Math.max(worst, Math.abs(proj.col - col), Math.abs(proj.row - row), Math.abs(proj.depth - vd));
        if (!f0) f0 = [ray.dx, ray.dy, ray.dz]; else if (Math.hypot(ray.dx - f0[0], ray.dy - f0[1], ray.dz - f0[2]) > 1e-12) parallel = false;
      }
      ok(`ortho round trip yaw ${yaw} pitch ${pitch} halfH ${halfH} <= 1e-6 (worst ${worst})`, worst <= 1e-6);
      ok('ortho rays parallel', parallel);
    }
  }
}

console.log(`ray.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
