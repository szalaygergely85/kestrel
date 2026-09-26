// engine/render/sectorCaster.silhouette.test.js (BUG-OWN-008 reopen,
// docs/architecture.md 23.9). The OUTSIDE-footprint silhouette of the real
// placed tower (content/worlds/world_m1 + content/levels/tower) on BOTH cast
// paths against an analytic projection built straight from the level data:
//   * per column: the topmost structure row must equal
//     min over every footprint cell the ray crosses of the projected row of
//     that cell's top height (floorH) at its nearest (H > eye) / farthest
//     (H < eye) crossing distance - the same y-shear projection castScene
//     uses, no caster code involved;
//   * per column: the lowest structure row must not fall below the ring
//     hand-off row (rows under the entry cell's floor at the footprint edge
//     belong to the terrain);
//   * the claimed column range must equal the analytic footprint crossing;
//   * a 1 m sideways move keeps the silhouette on the analytic projection
//     (no jump / shear with position);
// at the owner's two repro poses, a line 20/40/80/120 m west of the tower at
// eye height above AND below the level origin z, and a full circle at 20/40/
// 80 m. The GPU side is `glslTwin` below: a literal JS transcription of
// `engine/render/gpu/glsl/dda.frag.js` main() at n = 1 (kind only). It is the
// headless stand-in for a real-GPU `?gpucompare=1` outside pose - parity
// between the two paths is NOT evidence (they can share a bug; the CPU/GPU
// pair did until 23.9), the analytic projection is. Keep the twin in step
// with the shader when the shader's geometry rules change.
// Run: node engine/render/sectorCaster.silhouette.test.js [--verbose]
//
// BUG-OWN-008 part 3 ("I can see under the tower"): a GROUND CONTACT check
// per column - below the structure's lowest row every cell must be terrain
// hit IN FRONT of the footprint (depth <= tIn), never sky and never a hit
// under/behind the structure, and the lowest structure row must sit within
// 1 row of the ring hand-off row. CPU: the real `castSectors` + `castTerrain`
// frame. GPU: `glslTwin` for the structure rows and `marchTerrainRay` (the
// literal JS twin of `terrain.frag.js`'s march, 23.4) for the terrain rows.
// Needs the real world (terrain + placed tower): World.load(world_m1).
import { loadLevel } from '../world/Level.js';
import { World } from '../world/World.js';
import { castSectors, beginFrame, HFOV_DEG, MAX_RAY_STEPS, MAX_DIST } from './sectorCaster.js';
import { castTerrain, marchTerrainRay, FOG_FULL } from './terrainCaster.js';
import { KIND_TERRAIN } from './GBuffer.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { GBuffer } from './GBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { OpenSpans } from './OpenSpans.js';
import { CellBuffer } from './CellBuffer.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef;
lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// Owner's grid: 400x150 (GPU) - the CPU caster is the twin, same projection.
const COLS = 400, ROWS = 150, PXW = 9, PXH = 16;
// The placed tower exactly as world_m1 places it (level + origin only - no
// terrain/props/horizon, so the test needs no design/models imports).
const worldDef = assets.world('world_m1');
const S = worldDef.structures.find((s) => s.level === 'tower');
const level = loadLevel(assets.level('tower'));
const O = { x: S.origin.x, y: S.origin.y, z: S.origin.z || 0 };
// The placed world (terrain + tower bbox) for the ground-contact check; the
// far grid is baked synchronously, the near band by World.load itself.
const world = World.load(worldDef, assets, {});
world.terrain.bakeFarSync();
const BB = world.structures.find((s) => s.id === S.id).bbox;
const matTable = bindShading(assets.palette, assets.detailPass, PXH / PXW);
bindLevel(matTable, level);
const fb = {
  rt: new CellBuffer(COLS, ROWS), depth: new DepthBuffer(COLS, ROWS), spans: new OpenSpans(COLS),
  palette: assets.palette, gbuf: new GBuffer(COLS, ROWS), matTable,
};
fb.rt.pxCellW = PXW; fb.rt.pxCellH = PXH;

// --- shared camera basis (castScene / dda.frag formulas) --------------------
const tanHalf = Math.tan(HFOV_DEG * Math.PI / 360);
const planeDistY = (ROWS / 2) * ((COLS * PXW) / (ROWS * PXH)) / tanHalf;
function basis(cam) {
  const yaw = cam.yawDeg * Math.PI / 180;
  const dirX = Math.sin(yaw), dirY = -Math.cos(yaw);
  return { dirX, dirY, planeX: -dirY * tanHalf, planeY: dirX * tanHalf,
    horizonRow: ROWS / 2 + Math.tan(cam.pitchDeg * Math.PI / 180) * planeDistY };
}
const rowAt = (b, eyeH, h, d) => b.horizonRow - ((h - eyeH) / Math.max(d, 1e-4)) * planeDistY;

// --- analytic projection (independent of both casters) ----------------------
// Exact 2D grid walk of the (perp-distance) ray through the footprint; the
// per-column analytic top row / ring row / crossing flag. `top` is the min
// over crossed cells of the projected top-face row: the nearest edge for a
// top above the eye, the farthest edge for one below it (whatever occludes a
// cell's top edge lies even higher on screen, so the min is exact).
function analytic(cam, x, out) {
  const b = basis(cam);
  const c = (2 * (x + 0.5)) / COLS - 1;
  const dx = b.dirX + b.planeX * c, dy = b.dirY + b.planeY * c;
  const px = cam.x - O.x, py = cam.y - O.y, eyeH = cam.z - O.z;
  const w = level.width, h = level.height;
  let tMin = -Infinity, tMax = Infinity;
  for (const [p, d, len] of [[px, dx, w], [py, dy, h]]) {
    if (d !== 0) { const a = -p / d, bb = (len - p) / d; tMin = Math.max(tMin, Math.min(a, bb)); tMax = Math.min(tMax, Math.max(a, bb)); }
    else if (p < 0 || p >= len) { out.crosses = false; return out; }
  }
  if (tMax < tMin || tMax <= 0) { out.crosses = false; return out; }
  const tIn = Math.max(tMin, 0);
  if (tIn > MAX_DIST) { out.crosses = false; return out; } // beyond the DDA distance cap on both paths
  out.crosses = true; out.tIn = tIn;
  const ec = level.sectorAt(px + dx * (tIn + 1e-4), py + dy * (tIn + 1e-4));
  out.ringRow = Math.floor(rowAt(b, eyeH, ec && !ec.solid ? ec.floorH : 0, tIn));
  let t = tIn, top = Infinity;
  let mx = Math.floor(px + dx * (t + 1e-6)), my = Math.floor(py + dy * (t + 1e-6));
  const stepX = dx < 0 ? -1 : 1, stepY = dy < 0 ? -1 : 1;
  for (let i = 0; i < 200 && t < tMax - 1e-9; i++) {
    if (mx < 0 || my < 0 || mx >= w || my >= h) break;
    const tx = dx !== 0 ? ((dx > 0 ? mx + 1 : mx) - px) / dx : Infinity;
    const ty = dy !== 0 ? ((dy > 0 ? my + 1 : my) - py) / dy : Infinity;
    const tNext = Math.min(tx, ty, tMax);
    const sec = level.sectorAt(mx + 0.5, my + 0.5);
    if (sec) {
      const H = sec.floorH;
      const r = H >= eyeH ? rowAt(b, eyeH, H, t) : rowAt(b, eyeH, H, tNext);
      if (r < top) top = r;
      // A numeric ceiling above the eye (tower 'K' sun crack, 6.4 m) shows
      // its underside from outside too - nearest edge is its top row.
      if (sec.ceilH !== 'sky' && sec.ceilH > eyeH) {
        const rc = rowAt(b, eyeH, sec.ceilH, t);
        if (rc < top) top = rc;
      }
    }
    if (tx < ty) mx += stepX; else my += stepY;
    t = tNext;
  }
  out.top = top;
  return out;
}

// --- CPU path -----------------------------------------------------------------
function renderCpu(cam) {
  beginFrame(fb);
  castSectors(fb, level, cam, O);
  castTerrain(fb, world.terrain, cam, world);
  const top = new Int16Array(COLS).fill(-1), bot = new Int16Array(COLS).fill(-1);
  for (let x = 0; x < COLS; x++) {
    for (let r = 0; r < ROWS; r++) {
      const k = fb.gbuf.kind[r * COLS + x];
      if (k >= 1 && k <= 6) { if (top[x] < 0) top[x] = r; bot[x] = r; }
    }
  }
  return { top, bot };
}

// --- GPU path: literal twin of dda.frag.js main() (n = 1, kind only) ---------
const cellCache = new Map();
function cell(cx, cy) {
  const key = cy * level.width + cx;
  let c = cellCache.get(key);
  if (!c) {
    const s = level.sectorAt(cx + 0.5, cy + 0.5);
    c = { floorH: s.floorH, solid: !!s.solid, ceilSky: s.ceilH === 'sky', ceilH: s.ceilH === 'sky' ? 1e30 : s.ceilH };
    cellCache.set(key, c);
  }
  return c;
}
function glslTwin(cam, x, row) {
  const b = basis(cam);
  const cameraX = (2 * (x + 0.5)) / COLS - 1;
  const rayDirX = b.dirX + b.planeX * cameraX, rayDirY = b.dirY + b.planeY * cameraX;
  const slope = (b.horizonRow - row) / planeDistY;
  const w = level.width, h = level.height;
  const lx = cam.x - O.x, ly = cam.y - O.y, leyeH = cam.z - O.z;
  let bestT = 1e30, bestKind = 0;
  // slabEntry
  let t0;
  if (lx >= 0 && lx < w && ly >= 0 && ly < h) t0 = 0;
  else {
    let tMin = -1e30, tMax = 1e30;
    if (rayDirX !== 0) { const t1 = (0 - lx) / rayDirX, t2 = (w - lx) / rayDirX; tMin = Math.max(tMin, Math.min(t1, t2)); tMax = Math.min(tMax, Math.max(t1, t2)); } else if (lx < 0 || lx > w) return 0;
    if (rayDirY !== 0) { const t1 = (0 - ly) / rayDirY, t2 = (h - ly) / rayDirY; tMin = Math.max(tMin, Math.min(t1, t2)); tMax = Math.min(tMax, Math.max(t1, t2)); } else if (ly < 0 || ly > h) return 0;
    if (tMax < tMin || tMax < 0) return 0;
    t0 = Math.max(tMin, 0) + 1e-4;
  }
  const ex = lx + rayDirX * t0, ey = ly + rayDirY * t0;
  let mapX = Math.min(Math.max(Math.floor(ex), 0), w - 1), mapY = Math.min(Math.max(Math.floor(ey), 0), h - 1);
  if (t0 > 0) { const E = cell(mapX, mapY); if (!E.solid && leyeH + slope * t0 < E.floorH) return 0; }
  const deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
  const deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);
  const stepX = rayDirX < 0 ? -1 : 1, stepY = rayDirY < 0 ? -1 : 1;
  let sideDistX = rayDirX < 0 ? (ex - mapX) * deltaDistX : (mapX + 1 - ex) * deltaDistX;
  let sideDistY = rayDirY < 0 ? (ey - mapY) * deltaDistY : (mapY + 1 - ey) * deltaDistY;
  sideDistX += t0; sideDistY += t0; // the 23.9 reopen fix: camera-relative distances
  let C = cell(mapX, mapY);
  let t0seg = t0;
  for (let step = 0; step < MAX_RAY_STEPS; step++) {
    if (t0seg >= bestT) break;
    let t1;
    if (sideDistX < sideDistY) { t1 = sideDistX; sideDistX += deltaDistX; mapX += stepX; } else { t1 = sideDistY; sideDistY += deltaDistY; mapY += stepY; }
    if (t1 > MAX_DIST) break;
    if (slope < 0) {
      const hAtT1 = leyeH + slope * t1;
      if (hAtT1 < C.floorH) { const tp = (C.floorH - leyeH) / slope; if (tp >= t0seg && tp < bestT) { bestT = tp; bestKind = C.solid ? 5 : 4; } }
    }
    if (slope > 0 && !C.ceilSky) {
      const hAtT1 = leyeH + slope * t1;
      if (hAtT1 > C.ceilH) { const tp = (C.ceilH - leyeH) / slope; if (tp >= t0seg && tp < bestT) { bestT = tp; bestKind = 6; } }
    }
    if (!(mapX >= 0 && mapX < w && mapY >= 0 && mapY < h)) break;
    const N = cell(mapX, mapY);
    const hb = leyeH + slope * t1;
    if (N.solid && hb <= N.floorH && t1 < bestT) { bestT = t1; bestKind = 1; }
    else if (!N.solid && N.floorH > C.floorH && hb < N.floorH && t1 < bestT) { bestT = t1; bestKind = 2; }
    else if (!N.solid && N.floorH < C.floorH && hb > N.floorH && hb < C.floorH && t1 < bestT) { bestT = t1; bestKind = 2; }
    else if (!C.ceilSky && !N.ceilSky && N.ceilH < C.ceilH && hb > N.ceilH && t1 < bestT) { bestT = t1; bestKind = 3; }
    C = N; t0seg = t1;
  }
  return bestKind;
}
function renderGpu(cam) {
  const top = new Int16Array(COLS).fill(-1), bot = new Int16Array(COLS).fill(-1);
  for (let x = 0; x < COLS; x++) {
    for (let r = 0; r < ROWS; r++) {
      const k = glslTwin(cam, x, r);
      if (k >= 1 && k <= 6) { if (top[x] < 0) top[x] = r; bot[x] = r; }
    }
  }
  return { top, bot };
}

// --- the check ------------------------------------------------------------------
const scratch = { crosses: false, tIn: 0, ringRow: 0, top: 0 };
function checkPath(name, path, cam, { top, bot }, tolRows) {
  let cols = 0, topErrMax = 0, topErrSum = 0, botViol = 0, extentMiss = 0, extentExtra = 0, offTop = 0;
  let topMinRendered = ROWS, topMinAnalytic = ROWS, worstCol = -1;
  for (let x = 0; x < COLS; x++) {
    const a = analytic(cam, x, scratch);
    const expectVisible = a.crosses && Math.ceil(a.top) <= a.ringRow && a.ringRow >= 0 && a.top < ROWS;
    const rendered = top[x] >= 0;
    if (!expectVisible) { if (rendered) extentExtra++; continue; }
    if (!rendered) { extentMiss++; continue; }
    cols++;
    const expTop = Math.max(0, Math.ceil(a.top));
    const err = Math.abs(top[x] - expTop);
    topErrSum += err;
    if (err > topErrMax) { topErrMax = err; worstCol = x; }
    if (bot[x] > a.ringRow + 1) botViol++;
    if (top[x] === 0 && expTop > 2) offTop++;
    if (top[x] < topMinRendered) topMinRendered = top[x];
    if (expTop < topMinAnalytic) topMinAnalytic = expTop;
  }
  const meanErr = cols ? topErrSum / cols : 0;
  if (VERBOSE) console.log(`${path} ${name.padEnd(34)} cols ${String(cols).padStart(3)} topErr max ${topErrMax} mean ${meanErr.toFixed(2)} (col ${worstCol})  topRow ${topMinRendered} analytic ${topMinAnalytic}  botViol ${botViol} miss ${extentMiss} extra ${extentExtra} offTop ${offTop}`);
  const tag = `${path} ${name}`;
  ok(`${tag}: structure visible`, cols > 0, 'no columns rendered');
  ok(`${tag}: top row per column within ${tolRows} rows of the analytic projection`, topErrMax <= tolRows, `max err ${topErrMax} rows at col ${worstCol}, mean ${meanErr.toFixed(2)}`);
  ok(`${tag}: no structure row below the ring hand-off row`, botViol === 0, `${botViol} columns`);
  ok(`${tag}: claimed columns == analytic footprint crossing (+-2)`, extentMiss <= 2 && extentExtra <= 2, `missing ${extentMiss}, extra ${extentExtra}`);
  ok(`${tag}: nothing runs off the top of the screen`, offTop === 0, `${offTop} columns`);
}
// --- ground contact (BUG-OWN-008 part 3) -----------------------------------
// Per rendered column: rows below the structure's lowest row are terrain
// hit at depth <= tIn (in front of the footprint edge - the recipe blends the
// ground to the ring height there, so a ray under the ring at the edge has
// crossed the ground before it); no sky/unresolved cell; and the lowest
// structure row is within 1 row of the ring hand-off row.
const skipScratch = new Float64Array(2);
function footprintSkip(cam, dx, dy) { // terrainCaster.js buildSkips/slab2D twin, one structure
  let tMin = -Infinity, tMax = Infinity;
  for (const [p, d, a0, a1] of [[cam.x, dx, BB.x0, BB.x1], [cam.y, dy, BB.y0, BB.y1]]) {
    if (d !== 0) { const t1 = (a0 - p) / d, t2 = (a1 - p) / d; tMin = Math.max(tMin, Math.min(t1, t2)); tMax = Math.min(tMax, Math.max(t1, t2)); }
    else if (p < a0 || p > a1) return 0;
  }
  if (tMax < tMin || tMax < 0) return 0;
  skipScratch[0] = Math.max(0, tMin); skipScratch[1] = tMax;
  return 1;
}
const marchOut = { t: 0, x: 0, y: 0, h: 0, near: false };
function checkGround(name, path, cam, { bot }) {
  const b = basis(cam);
  let cols = 0, under = 0, holes = 0, seam = 0, worst = -1, worstT = 0;
  for (let x = 0; x < COLS; x++) {
    if (bot[x] < 0 || bot[x] >= ROWS - 1) continue;
    const a = analytic(cam, x, scratch);
    if (!a.crosses) continue;
    cols++;
    if (Math.abs(bot[x] - Math.floor(a.ringRow)) > 1) seam++;
    const c = (2 * (x + 0.5)) / COLS - 1;
    const dx = b.dirX + b.planeX * c, dy = b.dirY + b.planeY * c;
    const nSkips = footprintSkip(cam, dx, dy);
    for (let r = bot[x] + 1; r < ROWS; r++) {
      let t;
      if (path === 'CPU') {
        const i = r * COLS + x;
        if (fb.gbuf.kind[i] !== KIND_TERRAIN) { holes++; continue; }
        t = fb.depth.depth[i];
      } else {
        const slope = (b.horizonRow - r) / planeDistY;
        if (!marchTerrainRay(world.terrain, cam.x, cam.y, cam.z, dx, dy, slope, FOG_FULL, skipScratch, nSkips, {}, marchOut)) { holes++; continue; }
        t = marchOut.t;
      }
      if (t > a.tIn + 0.05) { under++; if (t > worstT) { worstT = t; worst = x; } }
    }
  }
  if (VERBOSE) console.log(`${path} ${name.padEnd(34)} ground: cols ${cols} under ${under} holes ${holes} seam ${seam}${worst >= 0 ? ` (col ${worst}, t ${worstT.toFixed(1)})` : ''}`);
  const tag = `${path} ${name}`;
  ok(`${tag}: ground contact - no terrain hit under/behind the structure below its base`, under === 0, `${under} cells, worst col ${worst} t ${worstT.toFixed(1)}`);
  ok(`${tag}: ground contact - no sky/unresolved cell below the base`, holes === 0, `${holes} cells`);
  ok(`${tag}: ground contact - base within 1 row of the ring hand-off row`, seam === 0, `${seam} columns`);
}
function checkPose(name, cam, tolRows = 2) {
  const cpu = renderCpu(cam), gpu = renderGpu(cam);
  checkPath(name, 'CPU', cam, cpu, tolRows);
  checkPath(name, 'GPU', cam, gpu, tolRows);
  checkGround(name, 'CPU', cam, cpu);
  checkGround(name, 'GPU', cam, gpu);
}

// --- owner's poses (400x150, GPU screenshots; z = eye) ------------------------
checkPose('owner pose A (25 m, pitch 19)', { x: 1464.33, y: 1045.50, z: 2.32, yawDeg: 54, pitchDeg: 19 });
checkPose('owner pose B (80 m, eye below z0)', { x: 1401.80, y: 1038.32, z: -2.38, yawDeg: 83, pitchDeg: 14 });

// --- a line west of the tower (d = distance to the footprint edge), aimed at
// the footprint centre; eye above and below the level origin z --------------
const CX = O.x + level.width / 2, CY = O.y + level.height / 2;
function aimAt(x, y, z, pitchDeg) {
  const yaw = Math.atan2(CX - x, -(CY - y)) * 180 / Math.PI;
  return { x, y, z, yawDeg: (yaw + 360) % 360, pitchDeg };
}
// y offset 0.37: keep the centre ray off the y = 7 grid line (a ray exactly
// along a cell boundary is a legitimately ambiguous cell walk, not a bug).
for (const d of [20, 40, 80, 120]) {
  checkPose(`west ${d} m, eye 4.0`, aimAt(O.x - d, CY + 0.37, 4.0, 0));
  checkPose(`west ${d} m, eye -2.38`, aimAt(O.x - d, CY + 0.37, -2.38, 8));
}

// --- full circle at 20/40/80 m, eye 4.0 (ring 2.4 + 1.6), pitch 5 -------------
for (const d of [20, 40, 80]) {
  for (let a = 0; a < 360; a += 30) {
    const rad = a * Math.PI / 180;
    checkPose(`circle ${d} m az ${a}`, aimAt(CX + Math.sin(rad) * (d + 12) + 0.37, CY - Math.cos(rad) * (d + 7) + 0.37, 4.0, 5));
  }
}

// --- BUG-OWN-008 part 3: close poses pitched down at the base (the owner's
// pose C: feet z 2.40 + eye 1.60, 8.5 m west; then 3/6/10/15 m out at a
// standing and a crouching eye, and a 12-point circle at 8 m, pitch -8) ----
checkPose('owner pose C (8.5 m west, pitch -6)', { x: 1471.53, y: 1026.86, z: 4.0, yawDeg: 86, pitchDeg: -6 });
for (const d of [3, 6, 10, 15]) {
  checkPose(`west ${d} m, eye 4.0, pitch -10`, aimAt(O.x - d, CY + 0.37, 4.0, -10));
  checkPose(`west ${d} m, eye 2.9 (crouch), pitch -6`, aimAt(O.x - d, CY + 0.37, 2.9, -6));
}
for (let a = 0; a < 360; a += 30) {
  const rad = a * Math.PI / 180;
  checkPose(`circle 8 m az ${a}, pitch -8`, aimAt(CX + Math.sin(rad) * 20 + 0.37, CY - Math.cos(rad) * 15 + 0.37, 4.0, -8));
}

// --- sideways / forward 1 m: the silhouette must stay on the analytic
// projection after a small move (no jump / shear with position). The check
// is against the projection, not the previous frame: the ragged tower top
// legitimately shifts 4-5 columns per metre at 40 m, so a frame-to-frame
// per-column delta is not a meaningful bound. -------------------------------
{
  const base = aimAt(O.x - 40, CY + 0.37, 4.0, 0);
  checkPose('sideways +1 m at 40 m', { ...base, y: base.y + 1 });
  checkPose('sideways -1 m at 40 m', { ...base, y: base.y - 1 });
  checkPose('forward +1 m at 40 m', { ...base, x: base.x + 1 });
}

console.log(`sectorCaster.silhouette.test: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
