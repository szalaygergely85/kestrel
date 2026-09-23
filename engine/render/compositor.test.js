// engine/render/compositor.test.js (US-025, docs/architecture.md 7.3).
// Headless (CellBuffer + GBuffer + DepthBuffer + OpenSpans - no canvas/DOM).
// Run: node engine/render/compositor.test.js
//      node --expose-gc engine/render/compositor.test.js   (also checks for heap growth)
import { World } from '../world/World.js';
import { AssetRegistry } from '../core/assets.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { OpenSpans } from './OpenSpans.js';
import { GBuffer, KIND_WALL } from './GBuffer.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import { renderWorld } from './compositor.js';
import { beginFrame, castSectors } from './sectorCaster.js';
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

// --- Architect review #1, item 3: two-structure pixel-level occlusion test ---
// A tiny near room (5x5) with a single-cell gap in its east wall, and a far
// room (5x5, fully enclosed) placed 5 m beyond the gap. Camera inside the
// near room, facing east through the gap: rays that pass straight through
// see the far room's west wall (planeId struct bits = 1); rays that curve
// enough to miss the gap hit the near room's own solid east wall (struct
// bits = 0) and must be untouched by the far structure's cast (item 1).
{
  const roomLegend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false },
    'S': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false, start: true, facingDeg: 90 },
  };
  const nearDef = {
    name: 'occ_near', legend: roomLegend,
    rows: [
      '#####',
      '#...#',
      '#.S.#',
      '#....', // east wall open at col 4, this row only - the gap
      '#####',
    ],
  };
  const farDef = {
    name: 'occ_far', legend: roomLegend,
    rows: [
      '#####',
      '#...#',
      '#.S.#',
      '#...#',
      '#####',
    ],
  };

  const world = new World();
  const near = world.placeStructure(nearDef, { x: 0, y: 0, z: 0 }, 'near');
  const far = world.placeStructure(farDef, { x: 10, y: 0, z: 0 }, 'far');

  const cam = { x: 2.5, y: 3.5, z: 1.6, yawDeg: 90, pitchDeg: 0 }; // inside `near`, facing east through the gap

  // Cast `near` alone first, to learn which columns it leaves open (the gap)
  // vs. closes (its own solid east wall) - the oracle for what "must be
  // untouched by the far cast" and "must show the far structure" mean below.
  const fbNearOnly = makeFb();
  bindLevel(fbNearOnly.matTable, near.level);
  beginFrame(fbNearOnly);
  castSectors(fbNearOnly, near.level, cam, near.origin);

  const fbBoth = makeFb();
  bindLevel(fbBoth.matTable, near.level);
  bindLevel(fbBoth.matTable, far.level);
  beginFrame(fbBoth);
  castSectors(fbBoth, near.level, cam, near.origin);
  castSectors(fbBoth, far.level, cam, far.origin);

  let closedColumnsUntouched = true;
  let sawFarStruct = false;
  let farOnlyInOpenColumns = true;
  for (let x = 0; x < COLS; x++) {
    const closedByNear = !fbNearOnly.spans.isOpen(x);
    for (let y = 0; y < ROWS; y++) {
      const i = y * COLS + x;
      const structOfFar = (fbBoth.gbuf.planeId[i] >>> 28) & 0x7;
      if (closedByNear) {
        if (fbBoth.rt.glyphIdx[i] !== fbNearOnly.rt.glyphIdx[i]) closedColumnsUntouched = false;
        for (let k = 0; k < 4; k++) {
          if (fbBoth.rt.fg[i * 4 + k] !== fbNearOnly.rt.fg[i * 4 + k]) closedColumnsUntouched = false;
          if (fbBoth.rt.bg[i * 4 + k] !== fbNearOnly.rt.bg[i * 4 + k]) closedColumnsUntouched = false;
        }
        if (fbBoth.gbuf.kind[i] !== fbNearOnly.gbuf.kind[i]) closedColumnsUntouched = false;
        if (fbBoth.depth.depth[i] !== fbNearOnly.depth.depth[i]) closedColumnsUntouched = false;
        if (fbBoth.gbuf.kind[i] !== 0 && structOfFar === 1) farOnlyInOpenColumns = false;
      } else if (fbBoth.gbuf.kind[i] !== 0 && structOfFar === 1) {
        sawFarStruct = true;
      }
    }
  }
  ok('two-structure occlusion: columns closed by the near structure are byte-identical to the near-only render (item 1)', closedColumnsUntouched);
  ok('two-structure occlusion: the far structure is never drawn into a column the near structure closed', farOnlyInOpenColumns);
  ok('two-structure occlusion: at least one open (gap) column shows the far structure through the opening (item 2)', sawFarStruct);
}

// --- Architect review #1, item 2 (compositor-level case): camera outside a
// single structure's own footprint must still cast it (ray entry into the
// footprint), not draw nothing. -----------------------------------------
{
  const wallLegend = {
    '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false },
    'S': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'ceiling_timber', solid: false, start: true, facingDeg: 90 },
  };
  const roomDef = {
    name: 'occ_outside', legend: wallLegend,
    rows: [
      '#####',
      '#...#',
      '#.S.#',
      '#...#',
      '#####',
    ],
  };
  const world = new World();
  const room = world.placeStructure(roomDef, { x: 0, y: 0, z: 0 }, 'room');
  const cam = { x: -10, y: 2.5, z: 1.6, yawDeg: 90, pitchDeg: 0 }; // 10 m west of the footprint, facing east at it

  const fb = makeFb();
  bindLevel(fb.matTable, room.level);
  beginFrame(fb);
  castSectors(fb, room.level, cam, room.origin);

  let sawWall = false;
  for (let i = 0; i < COLS * ROWS; i++) {
    if (fb.gbuf.kind[i] === KIND_WALL && Number.isFinite(fb.depth.depth[i]) && fb.depth.depth[i] > 8 && fb.depth.depth[i] < 14) {
      sawWall = true;
      break;
    }
  }
  ok('camera outside footprint: the structure\'s west wall is still cast (~10 m away), not left undrawn', sawWall);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
