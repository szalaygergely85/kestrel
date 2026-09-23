// engine/render/compositor.test.js (US-025, docs/architecture.md 7.3).
// Headless (CellBuffer + GBuffer + DepthBuffer + OpenSpans - no canvas/DOM).
// Run: node engine/render/compositor.test.js
//      node --expose-gc engine/render/compositor.test.js   (also checks for heap growth)
import { World } from '../world/World.js';
import { AssetRegistry } from '../core/assets.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { OpenSpans } from './OpenSpans.js';
import { GBuffer } from './GBuffer.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import { renderWorld } from './compositor.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import testRoomDef from '../../design/levels/test_room.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; testRoomDef;
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const COLS = 40, ROWS = 20;

function makeFb() {
  // `bindShading` always resolves against the real detail-pass module (so a
  // v1-less v2-only material key, e.g. `ceiling_timber`, still finds its
  // `.v1` fallback) - passing `detailPass: null` into `shadeSurfaces` below
  // is what actually forces the v1-only shading PATH, same distinction
  // game/js/main.js makes (see its `useDetail`/`detailPass` comment).
  const matTable = bindShading(assets.palette, assets.detailPass, 1);
  return {
    rt: new CellBuffer(COLS, ROWS),
    depth: new DepthBuffer(COLS, ROWS),
    spans: new OpenSpans(COLS),
    palette: assets.palette,
    gbuf: new GBuffer(COLS, ROWS),
    matTable,
    detailPass: null,
    lights: null,
    timeSec: 0,
    loop: { stats: {} },
  };
}

function worldDefFor(origin) {
  return {
    terrain: null,
    structures: [{ id: 'test_room', level: 'test_room', origin, yawSteps: 0 }],
    entities: [],
  };
}

// --- invariant: a structure at origin O, camera translated by O, == the bare level at origin 0 ----
{
  const ORIGIN = { x: 1480, y: 1018, z: 0 };
  const worldAt0 = World.load(worldDefFor({ x: 0, y: 0, z: 0 }), assets, {});
  const worldAtO = World.load(worldDefFor(ORIGIN), assets, {});
  for (const w of [worldAt0, worldAtO]) bindLevel((makeFb()).matTable, w.structures[0].level);

  const fb0 = makeFb();
  const fbO = makeFb();
  bindLevel(fb0.matTable, worldAt0.structures[0].level);
  bindLevel(fbO.matTable, worldAtO.structures[0].level);

  const localCam = { x: 5.5, y: 5.5, z: 1.6, yawDeg: 40, pitchDeg: -5 };
  const cam0 = { ...localCam };
  const camO = { x: localCam.x + ORIGIN.x, y: localCam.y + ORIGIN.y, z: localCam.z + ORIGIN.z, yawDeg: localCam.yawDeg, pitchDeg: localCam.pitchDeg };

  renderWorld(fb0, worldAt0, cam0);
  renderWorld(fbO, worldAtO, camO);

  let cellsMatch = true, depthMatch = true, gbufMatch = true;
  for (let i = 0; i < COLS * ROWS; i++) {
    if (fb0.rt.glyphIdx[i] !== fbO.rt.glyphIdx[i]) cellsMatch = false;
    for (let k = 0; k < 4; k++) {
      if (fb0.rt.fg[i * 4 + k] !== fbO.rt.fg[i * 4 + k]) cellsMatch = false;
      if (fb0.rt.bg[i * 4 + k] !== fbO.rt.bg[i * 4 + k]) cellsMatch = false;
    }
    const d0 = fb0.depth.depth[i], dO = fbO.depth.depth[i];
    if (Number.isFinite(d0) || Number.isFinite(dO)) {
      if (!(Number.isFinite(d0) === Number.isFinite(dO)) || Math.abs(d0 - dO) > 1e-3) depthMatch = false;
    }
    if (fb0.gbuf.kind[i] !== fbO.gbuf.kind[i]) gbufMatch = false;
    if (fb0.gbuf.mat[i] !== fbO.gbuf.mat[i]) gbufMatch = false;
    if (fb0.gbuf.face[i] !== fbO.gbuf.face[i]) gbufMatch = false;
    if (fb0.gbuf.planeId[i] !== fbO.gbuf.planeId[i]) gbufMatch = false;
    if (Math.abs(fb0.gbuf.u[i] - fbO.gbuf.u[i]) > 1e-3) gbufMatch = false;
    if (Math.abs(fb0.gbuf.v[i] - fbO.gbuf.v[i]) > 1e-3) gbufMatch = false;
  }
  ok('origin invariance: rt cells (glyph/fg/bg) identical', cellsMatch);
  ok('origin invariance: depth identical', depthMatch);
  ok('origin invariance: gbuf kind/mat/face/planeId/u/v identical', gbufMatch);
}

// --- more than 8 structures: cast the 8 nearest, bump structuresCulled, never wrap structSeq ----
{
  const structures = [];
  for (let i = 0; i < 9; i++) {
    structures.push({ id: `s${i}`, level: 'test_room', origin: { x: i * 40, y: 0, z: 0 }, yawSteps: 0 });
  }
  const world = World.load({ terrain: null, structures, entities: [] }, assets, {});
  const fb = makeFb();
  for (const s of world.structures) bindLevel(fb.matTable, s.level);
  const cam = { x: -50, y: 5.5, z: 1.6, yawDeg: 90, pitchDeg: 0 }; // looking east down the row of structures
  renderWorld(fb, world, cam);
  ok('9 structures: structuresCulled counted at least once', (fb.loop.stats.structuresCulled || 0) >= 1, JSON.stringify(fb.loop.stats));
  ok('9 structures: gbuf.structSeq never exceeds 8 (3-bit field cap)', fb.gbuf.structSeq <= 8, fb.gbuf.structSeq);
}

// --- 100 frames of renderWorld with no heap growth (--expose-gc) ---------------
{
  const world = World.load(worldDefFor({ x: 0, y: 0, z: 0 }), assets, {});
  const fb = makeFb();
  bindLevel(fb.matTable, world.structures[0].level);
  const cam = { x: 5.5, y: 5.5, z: 1.6, yawDeg: 0, pitchDeg: 0 };

  if (typeof global.gc === 'function') {
    for (let i = 0; i < 20; i++) { cam.yawDeg = i; renderWorld(fb, world, cam); } // warm-up
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100; i++) { cam.yawDeg = i % 360; renderWorld(fb, world, cam); }
    global.gc();
    const after = process.memoryUsage().heapUsed;
    const grewBy = after - before;
    ok('100 frames of renderWorld: no significant heap growth', grewBy < 2 * 1024 * 1024, `grew by ${grewBy} bytes`);
  } else {
    for (let i = 0; i < 100; i++) { cam.yawDeg = i % 360; renderWorld(fb, world, cam); }
    ok('100 frames of renderWorld run without throwing (run with --expose-gc for the heap-growth check)', true);
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
