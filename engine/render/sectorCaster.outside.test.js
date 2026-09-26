// engine/render/sectorCaster.outside.test.js (BUG-OWN-008, docs/architecture.md
// 23.9). Headless regression test for the CPU caster with the camera OUTSIDE
// a structure's footprint: (1) rows whose ray is below the entry cell's floor
// (the outer ring) at the footprint edge are never claimed by the structure
// (they belong to the terrain pass - the old code drew a phantom "step" from
// level height 0 up to the ring across the whole bbox, and walls down to 0);
// (2) the entry cell's own floor is cast from the edge inward; (3) a solid
// entry cell's outer face lands AT the edge, not one cell deep.
// No `design/` import - inline level fixtures only.
// Run: node engine/render/sectorCaster.outside.test.js

import { loadLevel } from '../world/Level.js';
import { castScene, HFOV_DEG } from './sectorCaster.js';
import { GBuffer, KIND_WALL, KIND_STEP, KIND_FLOOR } from './GBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const sector = (floorH, solid) => ({ floorH, ceilH: 'sky', wallMat: 'stone', floorMat: 'stone', ceilMat: 'sky', solid: !!solid });
const legend = { '.': sector(2.0, false), '#': sector(6.0, true), 'o': sector(0.0, false) };
function level(rows) {
  const l = loadLevel({ name: 'own008', legend, rows, start: { x: 1.5, y: 1.5, facingDeg: 0 } });
  if (!l) throw new Error('fixture failed to load');
  return l;
}
// Ring (2.0 m floor) around a solid block: the tower's own shape.
const ringed = level(['........', '.######.', '.######.', '.######.', '.######.', '........']);
// Solid border (entry cell solid): the face must be drawn at the edge.
const bordered = level(['########', '#......#', '#......#', '#......#', '#......#', '########']);
// Flat 2.0 m plateau: nothing but floor may be drawn from outside.
const plateau = level(['........', '........', '........', '........', '........', '........']);

const COLS = 160, ROWS = 60, PXW = 9, PXH = 16;
const rt = { cols: COLS, rows: ROWS, pxCellW: PXW, pxCellH: PXH };
const gbuf = new GBuffer(COLS, ROWS);
const depth = new DepthBuffer(COLS, ROWS);
const palette = { hue: { white: [1, 1, 1] }, lights: { ambient: { color: 'white', intensity: 0.3 } } };
const RING = 2.0;

// Camera basis, same formulas as castScene (y-shear projection).
function basis(cam) {
  const tanHalf = Math.tan(HFOV_DEG * Math.PI / 360);
  const yaw = cam.yawDeg * Math.PI / 180;
  const dirX = Math.sin(yaw), dirY = -Math.cos(yaw);
  const planeX = -dirY * tanHalf, planeY = dirX * tanHalf;
  const planeDistY = (ROWS / 2) * ((COLS * PXW) / (ROWS * PXH)) / tanHalf;
  const horizonRow = ROWS / 2 + Math.tan(cam.pitchDeg * Math.PI / 180) * planeDistY;
  return { dirX, dirY, planeX, planeY, planeDistY, horizonRow };
}
function rayDir(b, x) { const c = (2 * (x + 0.5)) / COLS - 1; return [b.dirX + b.planeX * c, b.dirY + b.planeY * c]; }
function tEntry(cam, lvl, dx, dy) { // 2D slab of the (perp-dist) ray vs the footprint
  let tMin = -Infinity, tMax = Infinity;
  for (const [p, d, w] of [[cam.x, dx, lvl.width], [cam.y, dy, lvl.height]]) {
    if (d !== 0) { const a = (0 - p) / d, b = (w - p) / d; tMin = Math.max(tMin, Math.min(a, b)); tMax = Math.min(tMax, Math.max(a, b)); }
    else if (p < 0 || p > w) return null;
  }
  return tMax < tMin || tMax < 0 ? null : Math.max(tMin, 0);
}
function cast(lvl, cam) {
  gbuf.beginFrame(); depth.clear();
  castScene(rt, lvl, cam, palette, { depthBuffer: depth, gbuf, skyFallback: false });
}

// --- 1. ringed: no claim below the ring height at the edge, wall depth right, ring floor drawn
{
  const cam = { x: -3, y: 3.0, z: 3.0, yawDeg: 90, pitchDeg: 0 }; // 1 m above the ring, 3 m west of the edge, looking east at the west face
  cast(ringed, cam);
  const b = basis(cam);
  let claimed = 0, below = 0, tight = 0, floorCells = 0;
  for (let x = 0; x < COLS; x++) {
    const [dx, dy] = rayDir(b, x);
    const te = tEntry(cam, ringed, dx, dy);
    if (te === null) continue;
    const lastOk = Math.floor(b.horizonRow - ((RING - cam.z) / te) * b.planeDistY); // castColumn's clamp row
    for (let row = 0; row < ROWS; row++) {
      const k = gbuf.kind[row * COLS + x];
      if (k === 0) continue;
      claimed++;
      const hAtEdge = cam.z + ((b.horizonRow - row) / b.planeDistY) * te;
      if (hAtEdge < RING - 1e-9) below++;
      if (row === lastOk) tight++;
      const d = depth.depth[row * COLS + x];
      if (k === KIND_FLOOR && d >= te - 1e-9 && d <= te + 1.0 + 1e-9) floorCells++;
    }
  }
  ok('ringed: the structure claims cells', claimed > 200, `claimed ${claimed}`);
  ok('ringed: no claimed cell is below the ring height at the footprint edge', below === 0, `${below} cells`);
  ok('ringed: the clamp is tight (the last row at/above the ring is claimed in some columns)', tight > 0);
  ok('ringed: the entry (ring) cell floor is cast from the edge inward', floorCells > 0, `${floorCells} floor cells in [tEntry, tEntry+1]`);
  const cx = COLS / 2;
  let minD = Infinity;
  for (let row = 0; row < ROWS; row++) { const d = depth.depth[row * COLS + cx]; if (gbuf.kind[row * COLS + cx] === KIND_WALL && d < minD) minD = d; }
  ok('ringed: centre-column wall face at the block face (4.0 m), not one cell deep', Math.abs(minD - 4.0) < 1e-3, `min wall depth ${minD}`);
}

// --- 2. bordered: a solid entry cell's outer face is drawn at the edge
{
  const cam = { x: -10, y: 3.0, z: 1.6, yawDeg: 90, pitchDeg: 0 };
  cast(bordered, cam);
  const cx = COLS / 2;
  let minD = Infinity, walls = 0;
  for (let row = 0; row < ROWS; row++) { const d = depth.depth[row * COLS + cx]; if (gbuf.kind[row * COLS + cx] === KIND_WALL) { walls++; if (d < minD) minD = d; } }
  ok('bordered: outer face at the footprint edge (10.0 m)', walls > 0 && Math.abs(minD - 10.0) < 1e-3, `min wall depth ${minD}, ${walls} wall rows`);
}

// --- 3. plateau: nothing but floor, no phantom step at the edge, ring rule holds at a glancing yaw too
{
  const cam = { x: -6, y: -4, z: 3.0, yawDeg: 125, pitchDeg: -10 };
  cast(plateau, cam);
  const b = basis(cam);
  let steps = 0, below = 0, floors = 0, other = 0;
  for (let x = 0; x < COLS; x++) {
    const [dx, dy] = rayDir(b, x);
    const te = tEntry(cam, plateau, dx, dy);
    for (let row = 0; row < ROWS; row++) {
      const k = gbuf.kind[row * COLS + x];
      if (k === 0) continue;
      if (k === KIND_STEP) steps++; else if (k === KIND_FLOOR) floors++; else other++;
      const hAtEdge = cam.z + ((b.horizonRow - row) / b.planeDistY) * te;
      if (te !== null && hAtEdge < RING - 1e-9) below++;
    }
  }
  ok('plateau: floor cells drawn', floors > 100, `${floors}`);
  ok('plateau: no phantom step band at the footprint edge', steps === 0 && other === 0, `${steps} step, ${other} other`);
  ok('plateau: no claimed cell below the ring at the edge (glancing yaw, pitched down)', below === 0, `${below}`);
}

// --- 4. camera inside: unchanged behaviour (sanity - the walk still closes the column on a wall)
{
  const cam = { x: 3.5, y: 3.0, z: 3.6, yawDeg: 90, pitchDeg: 0 }; // 1.6 m over the 2.0 m interior floor
  cast(bordered, cam);
  const cx = COLS / 2;
  let walls = 0;
  for (let row = 0; row < ROWS; row++) if (gbuf.kind[row * COLS + cx] === KIND_WALL) walls++;
  ok('inside: wall rows still drawn from inside the footprint', walls > 0);
}

console.log(`sectorCaster.outside.test: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
