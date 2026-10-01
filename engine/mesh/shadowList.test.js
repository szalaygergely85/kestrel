// engine/mesh/shadowList.test.js (ME-15a, docs/architecture.md 27.9a item 4, ACs 3 and 5).
// Zero-allocation gate is hard: when `global.gc` is missing this file re-runs itself with `--expose-gc`.
// Run: node engine/mesh/shadowList.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DrawList, DRAW_STATIC, LevelMeshCache, addStructures, MAX_DRAW_ITEMS } from './DrawList.js';
import { buildShadowList, createShadowList, shadowWorldZ, trimShadowList } from './shadowList.js';
import { frustumPlanes } from './culling.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { createSunShadowMatrix, shadowSunMatrix, SUN_SHADOW_DEFAULTS } from '../render/shadowSun.js';
import { dirFromAzEl } from '../core/transform.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function fakeLevel(name) {
  const legend = { f: { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, start: true } };
  return { name, width: 1, height: 1, legend, sectorAt(x, y) { return (x >= 0 && x < 1 && y >= 0 && y < 1) ? legend.f : null; } };
}
function struct(i, x, y) {
  return { id: `s${i}`, level: fakeLevel(`l${i}`), origin: { x, y, z: 0 }, bbox: { x0: x, y0: y, x1: x + 1, y1: y + 1 }, structSeq: i & 7, packed: { version: 1 } };
}

const OPTS = { ...SUN_SHADOW_DEFAULTS, res: 512, boxM: 192 };
const sunDir = dirFromAzEl(135, 40, new Float64Array(3));
const grid = { cols: 240, rows: 90 };
const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 }; // forward = -y

function cameraPlanes() {
  const terms = {}, M = new Float64Array(16), planes = new Float64Array(24);
  projTerms(cam, grid, terms); shearProjection(terms, M); frustumPlanes(M, planes);
  return planes;
}

// ---- AC 3: caster behind the camera -----------------------------------------
{
  const world = { structures: [struct(0, 0, -20), struct(1, 0, 30), struct(2, 300, 0)], structVersion: 1, terrain: null };
  const cache = new LevelMeshCache();
  const camList = new DrawList(16);
  camList.begin();
  addStructures(camList, world, cam, cache, 2000);
  camList.cull(cameraPlanes());
  const inCamera = (s) => { for (let i = 0; i < camList.count; i++) if (camList.items[i].objectId === s) return true; return false; };

  const centre = [0, -64, 0];
  const sm = createSunShadowMatrix();
  const z = shadowWorldZ(world, cache, { min: 0, max: 0 });
  shadowSunMatrix(sunDir, centre, OPTS, z, sm);
  const sl = createShadowList();
  const n = buildShadowList(sl, camList, world, sm.planes, { centre: { x: centre[0], y: centre[1], z: centre[2] }, cache });
  const inShadow = (s) => { for (let i = 0; i < sl.count; i++) if (sl.items[i].objectId === s) return true; return false; };
  ok('structure ahead of the camera is in the camera list', inCamera(0));
  ok('structure behind the camera (y=+30) is NOT in the camera list', !inCamera(1));
  ok('structure behind the camera IS in the shadow list', inShadow(1), `shadow count=${n}`);
  ok('structure ahead is in the shadow list too', inShadow(0));
  ok('structure 300 m away (outside the box) is culled from the shadow list', !inShadow(2));
  ok('shadowWorldZ covers the floor quads', z.min <= 0 && z.max >= 0, `${z.min}..${z.max}`);
}

// ---- overflow: farthest-from-centre dropped first, deterministic -------------
{
  const structs = [];
  for (let i = 0; i < 8; i++) structs.push(struct(i, i * 2, 0));
  const world = { structures: structs, structVersion: 1, terrain: null };
  const cache = new LevelMeshCache();
  const sl = createShadowList(2048);
  const sm = createSunShadowMatrix();
  shadowSunMatrix(sunDir, [0, 0, 0], OPTS, { min: 0, max: 0 }, sm);
  // Fill up with fake extras via the builder's own feed: 8 structures x 1 mesh = 8 items; shrink the cap by pushing manually is not
  // possible, so check ordering/determinism instead and that count never exceeds MAX_DRAW_ITEMS.
  const src = { centre: { x: 0, y: 0, z: 0 }, cache };
  const n1 = buildShadowList(sl, null, world, sm.planes, src);
  const ids1 = [];
  for (let i = 0; i < sl.count; i++) ids1.push(sl.items[i].objectId);
  const n2 = buildShadowList(sl, null, world, sm.planes, src);
  const ids2 = [];
  for (let i = 0; i < sl.count; i++) ids2.push(sl.items[i].objectId);
  ok('deterministic across rebuilds', n1 === n2 && ids1.join() === ids2.join(), `${ids1} / ${ids2}`);
  ok('never exceeds MAX_DRAW_ITEMS', n1 <= MAX_DRAW_ITEMS);
  ok('near -> far order kept (structSeq ascending by distance)', ids1.join() === '0,1,2,3,4,5,6,7', ids1.join());
}

// ---- overflow trim: farthest-from-centre dropped first ---------------------
{
  const l = new DrawList(400);
  l.begin();
  for (let i = 0; i < MAX_DRAW_ITEMS + 5; i++) {
    const it = l.push(null, DRAW_STATIC);
    it.objectId = i;
    const x = i === 10 ? 5000 : i; // item 10 is by far the farthest
    it.aabb[0] = x; it.aabb[3] = x; // y = 0
  }
  trimShadowList(l, 0, 0);
  const ids = new Set();
  for (let i = 0; i < l.count; i++) ids.add(l.items[i].objectId);
  ok('trim keeps MAX_DRAW_ITEMS', l.count === MAX_DRAW_ITEMS, 'count=' + l.count);
  ok('trim drops the farthest first (item 10, then ids 257..260)', !ids.has(10) && !ids.has(257) && !ids.has(258) && !ids.has(259) && !ids.has(260) && ids.has(256) && ids.has(9));
  ok('trim keeps relative order', (() => { let prev = -1; for (let i = 0; i < l.count; i++) { if (l.items[i].objectId < prev) return false; prev = l.items[i].objectId; } return true; })());
}

// ---- AC 5: zero allocation over N frames ---------------------------------------
{
  const world = { structures: [struct(0, 0, -20), struct(1, 0, 30), struct(2, 10, 10), struct(3, -15, 5)], structVersion: 1, terrain: null };
  const cache = new LevelMeshCache();
  const sl = createShadowList();
  const sm = createSunShadowMatrix();
  const centre = new Float64Array(3);
  const zr = { min: 0, max: 0 };
  const src = { centre: { x: 0, y: 0, z: 0 }, cache };
  let sink = 0;
  const run = (k) => {
    for (let i = 0; i < k; i++) {
      centre[0] = i * 0.01; centre[1] = -64;
      src.centre.x = centre[0]; src.centre.y = centre[1];
      shadowWorldZ(world, cache, zr);
      shadowSunMatrix(sunDir, centre, OPTS, zr, sm);
      sink += buildShadowList(sl, null, world, sm.planes, src);
    }
  };
  run(500);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  run(20000);
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  ok('buildShadowList + matrix: no heap growth over 20k frames', grew < 64 * 1024, `grew ${grew} bytes (sink=${sink})`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
