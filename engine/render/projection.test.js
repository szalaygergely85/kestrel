// engine/render/projection.test.js (ME-02, docs/architecture.md 27.15.3
// step 1-2). Run: node engine/render/projection.test.js
import { loadLevel } from '../world/Level.js';
import { castSectors, beginFrame, HFOV_DEG } from './sectorCaster.js';
import { GBuffer } from './GBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { OpenSpans } from './OpenSpans.js';
import { CellBuffer } from './CellBuffer.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { computeProjection } from '../voxel/instanceRect.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import {
  PROJ_HFOV_DEG, PROJ_NEAR, PROJ_FAR,
  projTerms, shearProjection, projectPoint, unprojectCell, windowToCell,
} from './projection.js';
import { makeOk, approxEqual } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod;

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260927);

ok('PROJ_HFOV_DEG matches HFOV_DEG everywhere else', PROJ_HFOV_DEG === HFOV_DEG);
ok('PROJ_NEAR is 5 cm', PROJ_NEAR === 0.05);
ok('PROJ_FAR is fogFull 2000 m', PROJ_FAR === 2000);

// ---------------------------------------------------------------------------
// Step 1: projTerms bit-identical to castScene (via fb.gbuf.cam.planeDistY)
// and to instanceRect.computeProjection, on 20 seeded poses.
// ---------------------------------------------------------------------------
{
  const { assets } = await loadTestAssets();
  const level = loadLevel(assets.level('tower'));
  const matTable = bindShading(assets.palette, assets.detailPass, 16 / 9);
  bindLevel(matTable, level);
  const COLS = 32, ROWS = 18;
  const start = level.start;

  let allPlaneDistY = true, allMatchInstanceRect = true;
  const projOut = { cols: 0, rows: 0, dirX: 0, dirY: 0, planeX: 0, planeY: 0, planeDet: 0, horizonRow: 0, planeDistY: 0, eyeX: 0, eyeY: 0, eyeZ: 0 };
  const terms = {};
  for (let i = 0; i < 20; i++) {
    const cam = {
      x: start.x + (rnd() - 0.5) * 4, y: start.y + (rnd() - 0.5) * 4, z: (start.z ?? level.sectorAt(start.x, start.y).floorH + 1.6),
      yawDeg: rnd() * 360, pitchDeg: (rnd() - 0.5) * 60,
    };
    const fb = { rt: new CellBuffer(COLS, ROWS), depth: new DepthBuffer(COLS, ROWS), spans: new OpenSpans(COLS), palette: assets.palette, gbuf: new GBuffer(COLS, ROWS), matTable };
    fb.rt.pxCellW = 9; fb.rt.pxCellH = 16;
    beginFrame(fb);
    castSectors(fb, level, cam, { x: 0, y: 0, z: 0 });

    projTerms(cam, { cols: COLS, rows: ROWS, pxCellW: 9, pxCellH: 16 }, terms);
    if (!approxEqual(terms.planeDistY, fb.gbuf.cam.planeDistY, 1e-9)) allPlaneDistY = false;

    computeProjection(cam, { cols: COLS, rows: ROWS, pxCellW: 9, pxCellH: 16 }, projOut);
    const fields = ['dirX', 'dirY', 'planeX', 'planeY', 'horizonRow', 'planeDistY', 'eyeX', 'eyeY', 'eyeZ'];
    for (const f of fields) if (!approxEqual(terms[f], projOut[f], 1e-9)) allMatchInstanceRect = false;
  }
  ok('projTerms.planeDistY == fb.gbuf.cam.planeDistY (castScene) x20', allPlaneDistY);
  ok('projTerms matches instanceRect.computeProjection on every shared field x20', allMatchInstanceRect);
}

// ---------------------------------------------------------------------------
// Step 2a: 1000 seeded (col, row, dist, n) round trips within 1e-9 cells.
// ---------------------------------------------------------------------------
{
  let allOk = true, worst = 0;
  const grid = { cols: 240, rows: 90 };
  const M = new Float64Array(16);
  const out3 = new Float64Array(3);
  const out4 = new Float64Array(4);
  const out2 = new Float64Array(2);
  const terms = {};
  for (let i = 0; i < 1000; i++) {
    const cam = { x: (rnd() - 0.5) * 200, y: (rnd() - 0.5) * 200, z: (rnd() - 0.5) * 10, yawDeg: rnd() * 360, pitchDeg: (rnd() - 0.5) * 60 };
    const col = -0.5 + rnd() * (grid.cols);
    const row = -0.5 + rnd() * (grid.rows);
    const dist = 0.06 + rnd() * 1500;
    const n = 1 + Math.floor(rnd() * 3); // 1,2,3

    projTerms(cam, grid, terms);
    shearProjection(terms, M);
    unprojectCell(terms, col, row, dist, out3);
    const W = grid.cols * n, H = grid.rows * n;
    projectPoint(M, W, H, out3[0], out3[1], out3[2], out4);
    if (!(out4[3] > 0)) { allOk = false; continue; }
    windowToCell(n, out4[0], out4[1], out2);
    const dCol = Math.abs(out2[0] - col), dRow = Math.abs(out2[1] - row);
    const dW = Math.abs(out4[3] - dist) / dist;
    worst = Math.max(worst, dCol, dRow, dW);
    if (dCol > 1e-9 || dRow > 1e-9 || dW > 1e-9) allOk = false;
  }
  ok('1000 seeded project(unproject) round trips within 1e-9 cells and w within 1e-9 relative', allOk, `worst=${worst}`);
}

// ---------------------------------------------------------------------------
// Step 2b: unprojectCell == a literal JS copy of GLSL cellRayP, 1e-9.
// ---------------------------------------------------------------------------
function cellRayPTwin(cell_x, cell_y, gridX, posX, posY, eyeH, dirX, dirY, planeX, planeY, horizonRow, planeDistY, dist) {
  const cameraX = (2.0 * (cell_x + 0.5)) / gridX - 1.0;
  const rayDirX = dirX + planeX * cameraX;
  const rayDirY = dirY + planeY * cameraX;
  const slope = -(cell_y - horizonRow) / planeDistY;
  return [posX + rayDirX * dist, posY + rayDirY * dist, eyeH + slope * dist];
}
{
  let allOk = true;
  const grid = { cols: 320, rows: 120 };
  const out3 = new Float64Array(3);
  const terms = {};
  for (let i = 0; i < 500; i++) {
    const cam = { x: (rnd() - 0.5) * 200, y: (rnd() - 0.5) * 200, z: (rnd() - 0.5) * 10, yawDeg: rnd() * 360, pitchDeg: (rnd() - 0.5) * 60 };
    const col = -0.5 + rnd() * grid.cols;
    const row = -0.5 + rnd() * grid.rows;
    const dist = 0.06 + rnd() * 1500;
    projTerms(cam, grid, terms);
    unprojectCell(terms, col, row, dist, out3);
    const twin = cellRayPTwin(col, row, grid.cols, terms.eyeX, terms.eyeY, terms.eyeZ, terms.dirX, terms.dirY, terms.planeX, terms.planeY, terms.horizonRow, terms.planeDistY, dist);
    for (let k = 0; k < 3; k++) if (!approxEqual(out3[k], twin[k], 1e-9)) allOk = false;
  }
  ok('unprojectCell == literal cellRayP twin within 1e-9 x500', allOk);
}

// ---------------------------------------------------------------------------
// Step 2c: pitch sweep -30..+30 keeps the horizon row equal to today's
// formula (a point at eye height, 100 m ahead, lands on row == horizonRow).
// ---------------------------------------------------------------------------
{
  let allOk = true;
  const grid = { cols: 240, rows: 90 };
  const M = new Float64Array(16);
  const out4 = new Float64Array(4);
  const out2 = new Float64Array(2);
  const terms = {};
  for (let pitchDeg = -30; pitchDeg <= 30; pitchDeg += 5) {
    const cam = { x: 0, y: 0, z: 10, yawDeg: 37, pitchDeg };
    projTerms(cam, grid, terms);
    shearProjection(terms, M);
    const yawRad = (cam.yawDeg * Math.PI) / 180;
    const dirX = Math.sin(yawRad), dirY = -Math.cos(yawRad);
    const px = cam.x + dirX * 100, py = cam.y + dirY * 100, pz = cam.z; // eye height, straight ahead
    projectPoint(M, grid.cols, grid.rows, px, py, pz, out4);
    windowToCell(1, out4[0], out4[1], out2);
    const dRow = Math.abs(out2[1] - terms.horizonRow);
    if (dRow > 1e-9) allOk = false;
  }
  ok('pitch sweep -30..+30 deg: a point at eye height 100 m ahead lands on row == horizonRow (1e-9)', allOk);
}

// ---------------------------------------------------------------------------
// Step 2d: pixel centres (px + 0.5) map to cx + (i + 0.5)/n - 0.5 (dda.frag.js
// sub-sample offsets) within 1e-12.
// ---------------------------------------------------------------------------
{
  let allOk = true;
  const out2 = new Float64Array(2);
  for (const n of [1, 2, 3]) {
    for (let cx = 0; cx < 5; cx++) {
      for (let i = 0; i < n; i++) {
        const px = cx * n + i;
        windowToCell(n, px + 0.5, px + 0.5, out2);
        const expected = cx + (i + 0.5) / n - 0.5;
        if (Math.abs(out2[0] - expected) > 1e-12) allOk = false;
      }
    }
  }
  ok('pixel centres (px+0.5) map to cx + (i+0.5)/n - 0.5 within 1e-12', allOk);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
