// US-004 sector raycaster: one ray per screen column, walked cell-by-cell
// (DDA) through the level, drawing walls/steps/lintels/solid-column-tops as
// they're crossed and floor/ceiling planes for the cell the ray currently
// occupies, using a narrowing open vertical span (classic portal/sector
// renderer technique) so nearer geometry correctly occludes farther
// geometry and "seeing over a low wall" / "seeing through a lintel" just
// falls out of the algorithm rather than being special-cased.
//
// Shading is delegated straight to the designer's reference implementation
// (`design/palette.js` -> `window.ASSETS.palette.util.shade` / `shadeSky`)
// so the engine's output is BY CONSTRUCTION identical to it (see `?shadetest=1`
// in main.js) - not just "close within tolerance". Cells are written with
// `RenderTarget.setCellRGB` only (no hex strings, no per-cell allocation).
//
// Coordinate conventions (must match game/js/world/Level.js exactly):
//   1 cell = 1 world meter. col/x grows east, row/y grows south.
//   facingDeg is COMPASS degrees: 0 = north (-y), 90 = east (+x), clockwise.
//   Screen rows grow downward (row 0 = top), matching RenderTarget's grid.
//
// Projection: horizontal FOV is a true camera-plane DDA cast (Lodev-style),
// which is perpendicular-distance-corrected by construction (no fisheye).
// Vertical placement of a world height `h` at ray distance `d` uses a
// linear y-shear: row = horizonRow - ((h-eye)/d)*planeDistY. `horizonRow`
// itself shifts with pitch (tan(pitch)*planeDistY) - the standard
// Doom/Build-style pitch simulation, cheap (no per-pixel trig) and exact
// enough at the clamped +-35 deg this game uses.

const HFOV_DEG = 75;
const MAX_RAY_STEPS = 96; // DDA safety cap per column (levels are well under this in practice)
const MAX_DIST = 120; // meters; beyond this, whatever's left open is treated as void/sky
const INTERIOR_FOG = 'interior';
const VOID_SECTOR = { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, topH: 'sky', upperMat: 'stone' };

// Reused across every shade() call in a frame - the reference shader writes
// into `out.fg`/`out.bg` in place and allocates nothing when they're already
// arrays (see design/README.md 1.7), so one shared object for the whole
// frame is exactly what "zero per-frame allocations" wants.
const shadeOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: ' ', b: 0 };
// Reused `opt` for every shade() call this frame (see shadeSurface below) -
// avoids allocating a fresh {z, fog} object per screen cell.
const shadeOpt = { z: 0, fog: INTERIOR_FOG };

// US-004 scope: L = ambient only (US-006/007 add point lights + sun). `hue`
// is normalised so max channel = 1; intensity is the actual energy
// (design/README.md 1.5). Computed once per frame from the live palette
// (so a future time-of-day change is picked up automatically).
let ambientL = [0, 0, 0];
function primeAmbientLight(P) {
  const amb = P.lights.ambient;
  const hue = P.hue[amb.color];
  ambientL[0] = hue[0] * amb.intensity;
  ambientL[1] = hue[1] * amb.intensity;
  ambientL[2] = hue[2] * amb.intensity;
}

function clampByte(v) {
  v = Math.round(v);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Writes `shadeOut` (already populated by shade()/shadeSky()) to cell (x,y)
 * via the allocation-free path, and the ray's distance (meters) into the
 * shared DepthBuffer alongside it, when one is attached (D-008 item 1).
 */
function writeShadeOut(rt, x, y, ctx, dist) {
  const code = shadeOut.glyph.charCodeAt(0);
  const glyphIdx = code < 32 || code > 126 ? 0 : code - 32;
  rt.setCellRGB(
    x, y, glyphIdx,
    clampByte(shadeOut.fg[0]), clampByte(shadeOut.fg[1]), clampByte(shadeOut.fg[2]),
    clampByte(shadeOut.bg[0]), clampByte(shadeOut.bg[1]), clampByte(shadeOut.bg[2])
  );
  if (ctx.depthBuffer) ctx.depthBuffer.set(x, y, dist);
}

function shadeSurface(U, matKey, u, v, dist, z) {
  shadeOpt.z = z;
  U.shade(matKey, ambientL, u, v, dist, shadeOut, shadeOpt);
}

function compassAzimuthDeg(dirX, dirY) {
  let az = Math.atan2(dirX, -dirY) * 180 / Math.PI;
  if (az < 0) az += 360;
  return az;
}

/**
 * @param {{cols:number, rows:number, pxCellW?:number, pxCellH?:number, setCellRGB:Function}} rt
 * @param {import('../world/Level.js').Level} level
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} camera - z = eye height, WORLD meters
 * @param {object} palette - the shading oracle (today: window.ASSETS.palette,
 *   read exactly once by the caller - see game/js/main.js - and passed in
 *   here; this module never reads window.ASSETS itself, so it is a drop-in
 *   AssetRegistry consumer once US-024 injects one instead. D-008.)
 * @param {object} [opts]
 * @param {import('./DepthBuffer.js').DepthBuffer} [opts.depthBuffer] - per-cell
 *   camera distance (meters) is written here alongside every setCellRGB call
 *   (D-008 item 1), for compositing with a future terrain pass.
 * @param {{x:number,y:number,z:number}} [opts.origin] - world-space offset of
 *   this level's local (0,0,0), so the same level data can be rendered as a
 *   structure placed anywhere in the world (D-008 item 3). Defaults to the
 *   origin, i.e. today's "level IS the world" behaviour.
 * @param {boolean} [opts.skyFallback] - when a column's ray leaves the level
 *   grid or exhausts its step budget, the vertical span that's still open
 *   is, by default, left unresolved and reported (D-008 item 2) for a
 *   terrain pass to fill in. Pass true (e.g. test_room, which has no
 *   terrain pass yet) to fill it with sky instead, matching this story's
 *   original stand-alone behaviour.
 * @returns {{openSpans: Array<{x:number, topRow:number, bottomRow:number, depth:number}>}}
 *   Unresolved per-column spans (empty when `skyFallback` is true, or when
 *   every column's geometry fully closed its own span).
 */
export function castScene(rt, level, camera, palette, opts = {}) {
  const P = palette;
  const U = P.util;
  const cols = rt.cols;
  const rows = rt.rows;
  primeAmbientLight(P);

  const origin = opts.origin || { x: 0, y: 0, z: 0 };

  // --- camera / projection setup (once per frame, not per column) --------
  const hFovRad = HFOV_DEG * Math.PI / 180;
  const tanHalfHFov = Math.tan(hFovRad / 2);

  const yawRad = camera.yawDeg * Math.PI / 180;
  const dirX = Math.sin(yawRad);
  const dirY = -Math.cos(yawRad);
  // "Right" on screen, compass-clockwise from `dir` (rotate 90 deg clockwise
  // on the compass: (dx,dy) -> (-dy,dx) - see the module doc's convention).
  const planeX = -dirY * tanHalfHFov;
  const planeY = dirX * tanHalfHFov;

  // Pixel aspect ratio of the actual screen (not just cols/rows) is what a
  // "square pillar looks square" needs - it accounts for cells not being
  // square in device pixels.
  const screenAspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
  const planeDistY = (rows / 2) * screenAspect / tanHalfHFov;

  const pitchRad = camera.pitchDeg * Math.PI / 180;
  const horizonRow = rows / 2 + Math.tan(pitchRad) * planeDistY;

  const openSpans = [];
  const ctx = {
    P, U, rows,
    // Camera position/eye height translated into the LEVEL's own local
    // frame (world minus origin) - every sectorAt/floorAt query and all
    // projection math below stays in local meters; distances (and so the
    // DepthBuffer) are unaffected since translation doesn't change them.
    posX: camera.x - origin.x, posY: camera.y - origin.y, eyeH: camera.z - origin.z,
    horizonRow, planeDistY,
    depthBuffer: opts.depthBuffer || null,
    skyFallback: !!opts.skyFallback,
    openSpans,
  };

  for (let x = 0; x < cols; x++) {
    const cameraX = (2 * (x + 0.5)) / cols - 1;
    const rayDirX = dirX + planeX * cameraX;
    const rayDirY = dirY + planeY * cameraX;
    ctx.rayDirX = rayDirX;
    ctx.rayDirY = rayDirY;
    castColumn(rt, level, ctx, x, rayDirX, rayDirY);
  }

  return { openSpans };
}

// row <-> world height (at a FIXED distance `dist`) - the y-shear projection.
function rowAtHeight(ctx, h, dist) {
  if (dist < 1e-4) dist = 1e-4;
  return ctx.horizonRow - ((h - ctx.eyeH) / dist) * ctx.planeDistY;
}
function heightAtRow(ctx, row, dist) {
  if (dist < 1e-4) dist = 1e-4;
  return ctx.eyeH - (row - ctx.horizonRow) * dist / ctx.planeDistY;
}
// Inverse for a FIXED world height h: the distance at which a horizontal
// plane at height h crosses screen row `row` (floor/ceiling plane casting).
function distAtRowForHeight(ctx, row, h) {
  const denom = ctx.horizonRow - row;
  if (Math.abs(denom) < 1e-5) return Infinity;
  return ((h - ctx.eyeH) * ctx.planeDistY) / denom;
}
// Elevation angle (degrees) of the ray direction implied by screen row
// `row`, for the sky (tan(elev) = (horizonRow-row)/planeDistY by definition
// of the y-shear above - same relationship, just without a target height).
function elevAtRow(ctx, row) {
  return Math.atan2(ctx.horizonRow - row, ctx.planeDistY) * 180 / Math.PI;
}

function castColumn(rt, level, ctx, x, rayDirX, rayDirY) {
  const { rows, posX, posY } = ctx;
  const azimuthDeg = compassAzimuthDeg(rayDirX, rayDirY);

  // --- DDA state -----------------------------------------------------
  let mapX = Math.floor(posX);
  let mapY = Math.floor(posY);
  const deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
  const deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);
  let stepX, sideDistX, stepY, sideDistY;
  if (rayDirX < 0) { stepX = -1; sideDistX = (posX - mapX) * deltaDistX; }
  else { stepX = 1; sideDistX = (mapX + 1 - posX) * deltaDistX; }
  if (rayDirY < 0) { stepY = -1; sideDistY = (posY - mapY) * deltaDistY; }
  else { stepY = 1; sideDistY = (mapY + 1 - posY) * deltaDistY; }

  // side: 0 = crossed an X boundary (a north/south-facing wall - it runs
  // along Y, so its texture U coordinate is the hit Y); 1 = crossed a Y
  // boundary (an east/west-facing wall, U = hit X).
  function ddaStep() {
    let side;
    if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
    else { sideDistY += deltaDistY; mapY += stepY; side = 1; }
    const perpDist = side === 0
      ? (mapX - posX + (1 - stepX) / 2) / rayDirX
      : (mapY - posY + (1 - stepY) / 2) / rayDirY;
    return { side, perpDist };
  }

  let openTop = 0;
  let openBottom = rows - 1;
  let skyClosedTop = false; // once sky has claimed the top of the span, stop drawing ceiling geometry
  let ceilingFilledTo = openTop - 1; // highest row index a ceiling/sky segment has already drawn
  let prevDist = 0;
  let nearSector = level.sectorAt(posX, posY) || VOID_SECTOR;

  for (let i = 0; i < MAX_RAY_STEPS && openTop <= openBottom; i++) {
    const { side, perpDist } = ddaStep();
    if (perpDist > MAX_DIST) break;

    const hitX = posX + perpDist * rayDirX;
    const hitY = posY + perpDist * rayDirY;
    const u = side === 0 ? hitY : hitX;

    // 1) The NEAR cell's own floor + ceiling planes, for the segment we
    // just finished walking through ([prevDist, perpDist]).
    ({ skyClosedTop, ceilingFilledTo } = castFloorCeiling(rt, x, ctx, nearSector, prevDist, perpDist,
      openTop, openBottom, azimuthDeg, skyClosedTop, ceilingFilledTo));

    const farSector = level.sectorAt(mapX + 0.5, mapY + 0.5);

    if (!farSector) {
      // Left the level grid: this is a job for the terrain pass (D-008 item
      // 2), not this one - leave the remaining span unresolved unless the
      // caller asked for the old stand-alone sky fallback.
      resolveRemainder(rt, x, ctx, openTop, openBottom, azimuthDeg, perpDist);
      return;
    }

    if (farSector.solid) {
      const entryDist = perpDist;
      const rowAtTop = rowAtHeight(ctx, farSector.floorH, entryDist);
      const wallRowStart = Math.max(openTop, Math.ceil(rowAtTop));
      for (let row = wallRowStart; row <= openBottom; row++) {
        const h = heightAtRow(ctx, row, entryDist);
        shadeSurface(ctx.U, farSector.wallMat, u, h, entryDist, h - nearSector.floorH);
        writeShadeOut(rt, x, row, ctx, entryDist);
      }

      const exit = ddaStep();
      const exitDist = Math.min(exit.perpDist, MAX_DIST);
      castPlane(rt, x, ctx, farSector.floorMat, farSector.floorH, entryDist, exitDist,
        openTop, wallRowStart - 1, farSector.floorH);

      openBottom = Math.min(openBottom, wallRowStart - 1);
      prevDist = exitDist;
      nearSector = level.sectorAt(mapX + 0.5, mapY + 0.5) || VOID_SECTOR;
      if (openTop > openBottom) break;
      continue;
    }

    // 2) Non-solid transition: floor step/ledge front + ceiling lintel face.
    if (farSector.floorH !== nearSector.floorH) {
      const higher = farSector.floorH > nearSector.floorH ? farSector : nearSector;
      const lo = Math.min(farSector.floorH, nearSector.floorH);
      const hi = Math.max(farSector.floorH, nearSector.floorH);
      const r0 = Math.max(openTop, Math.ceil(rowAtHeight(ctx, hi, perpDist)));
      const r1 = Math.min(openBottom, Math.floor(rowAtHeight(ctx, lo, perpDist)));
      for (let row = r0; row <= r1; row++) {
        const h = heightAtRow(ctx, row, perpDist);
        shadeSurface(ctx.U, higher.wallMat, u, h, perpDist, h - nearSector.floorH);
        writeShadeOut(rt, x, row, ctx, perpDist);
      }
      openBottom = Math.min(openBottom, r0 - 1);
    }

    if (!skyClosedTop && farSector.ceilH !== 'sky' && nearSector.ceilH !== 'sky' &&
        farSector.ceilH !== nearSector.ceilH) {
      const lowerCell = farSector.ceilH < nearSector.ceilH ? farSector : nearSector;
      const loC = Math.min(farSector.ceilH, nearSector.ceilH);
      const hiC = Math.max(lowerCell.topH, Math.max(farSector.ceilH, nearSector.ceilH));
      const r0 = Math.max(openTop, Math.ceil(rowAtHeight(ctx, hiC, perpDist)));
      const r1 = Math.min(openBottom, Math.floor(rowAtHeight(ctx, loC, perpDist)));
      for (let row = r0; row <= r1; row++) {
        const h = heightAtRow(ctx, row, perpDist);
        shadeSurface(ctx.U, lowerCell.upperMat || lowerCell.wallMat, u, h, perpDist, h - nearSector.floorH);
        writeShadeOut(rt, x, row, ctx, perpDist);
      }
      openTop = Math.max(openTop, r1 + 1);
    }

    prevDist = perpDist;
    nearSector = farSector;
  }

  // Ran out of step budget / max distance without closing the span or
  // leaving the grid (an unusually large open room) - same "hand off
  // whatever's left" treatment as leaving the grid (D-008 item 2).
  resolveRemainder(rt, x, ctx, openTop, openBottom, azimuthDeg, prevDist);
}

// Either fills the remaining open span with sky (stand-alone fallback,
// opts.skyFallback) or records it for a later pass (terrain, D-008 item 2).
function resolveRemainder(rt, x, ctx, openTop, openBottom, azimuthDeg, depth) {
  if (openTop > openBottom) return;
  if (ctx.skyFallback) {
    fillSky(rt, x, ctx, openTop, openBottom, azimuthDeg);
  } else {
    ctx.openSpans.push({ x, topRow: openTop, bottomRow: openBottom, depth });
  }
}

// Casts a sector's own floor plane and (unless sky already closed the top,
// or this segment is itself the sky) ceiling plane, across [dNear,dFar],
// clipped to the open row span AND to `ceilingFilledTo` (see castColumn):
// rows a NEARER ceiling/sky segment already drew are never redrawn by a
// FARTHER one - without this, a ceiling-height change (e.g. into a sky
// region) whose projected extent gets clamped at the screen edge could have
// two different segments both "reach" row 0 and the farther one would wrongly
// overwrite the nearer, correctly-occluding one (a real visual bug, verified
// via a call-count audit, not just wasted work).
// Returns the updated { skyClosedTop, ceilingFilledTo }.
function castFloorCeiling(rt, x, ctx, sector, dNear, dFar, openTop, openBottom, azimuthDeg, skyClosedTop, ceilingFilledTo) {
  if (dFar <= dNear || openTop > openBottom) return { skyClosedTop, ceilingFilledTo };

  castPlane(rt, x, ctx, sector.floorMat, sector.floorH, dNear, dFar, openTop, openBottom, sector.floorH);

  if (skyClosedTop) return { skyClosedTop, ceilingFilledTo };
  const ceilTop = Math.max(openTop, ceilingFilledTo + 1);
  if (ceilTop > openBottom) return { skyClosedTop, ceilingFilledTo };

  if (sector.ceilH === 'sky') {
    castSkySegment(rt, x, ctx, dNear, dFar, ceilTop, openBottom, azimuthDeg, sector.floorH);
    return { skyClosedTop: true, ceilingFilledTo };
  }
  const ceilRange = castPlane(rt, x, ctx, sector.ceilMat, sector.ceilH, dNear, dFar, ceilTop, openBottom, sector.floorH);
  if (ceilRange.r1 >= ceilRange.r0) ceilingFilledTo = Math.max(ceilingFilledTo, ceilRange.r1);
  return { skyClosedTop, ceilingFilledTo };
}

// Draws a single horizontal plane (floor, ceiling, or a solid column's top
// face) at world height `h`, across ray segment [dNear,dFar], one row at a
// time - each row's exact distance/world position is recovered from the row
// itself (via distAtRowForHeight), so texture sampling stays accurate.
// Returns { r0, r1 } - the actual (clipped) row range drawn, r1 < r0 if none.
function castPlane(rt, x, ctx, matKey, h, dNear, dFar, openTop, openBottom, floorHForZ) {
  // Adjacent segments share a distance boundary (this segment's dFar is the
  // next segment's dNear) - the SAME world height at the SAME distance
  // therefore projects to the SAME row on both sides. To avoid drawing that
  // boundary row twice (a real bug this was verified against: ~40% of
  // cells were being shaded 2-4x, costing several ms/frame), the near end
  // of a segment (shared with the PREVIOUS segment's far end) is inclusive
  // and the far end (shared with the NEXT segment's near end) is exclusive,
  // regardless of whether row increases or decreases with distance (floors
  // and ceilings go opposite ways).
  const rowAtNear = rowAtHeight(ctx, h, Math.max(dNear, 1e-3));
  const rowAtFar = rowAtHeight(ctx, h, Math.max(dFar, 1e-3));
  let r0, r1;
  if (rowAtNear <= rowAtFar) {
    r0 = Math.ceil(rowAtNear);
    r1 = Math.ceil(rowAtFar) - 1;
  } else {
    r0 = Math.floor(rowAtFar) + 1;
    r1 = Math.floor(rowAtNear);
  }
  r0 = Math.max(openTop, r0);
  r1 = Math.min(openBottom, r1);
  for (let row = r0; row <= r1; row++) {
    const dist = distAtRowForHeight(ctx, row, h);
    if (!Number.isFinite(dist) || dist <= 0) continue;
    // World position at this row's exact distance, along THIS column's ray
    // (ctx.rayDirX/Y are set once per column in castScene's loop).
    const wx = ctx.posX + ctx.rayDirX * dist;
    const wy = ctx.posY + ctx.rayDirY * dist;
    shadeSurface(ctx.U, matKey, wx, wy, dist, h - floorHForZ);
    writeShadeOut(rt, x, row, ctx, dist);
  }
  return { r0, r1 };
}

function castSkySegment(rt, x, ctx, dNear, dFar, openTop, openBottom, azimuthDeg, floorH) {
  const floorRowAtNear = rowAtHeight(ctx, floorH, Math.max(dNear, 1e-3));
  const r1 = Math.min(openBottom, Math.floor(floorRowAtNear) - 1);
  for (let row = openTop; row <= r1; row++) {
    const elevDeg = elevAtRow(ctx, row);
    ctx.P.util.shadeSky(azimuthDeg, elevDeg, shadeOut, ctx.P.defaultTime);
    writeShadeOut(rt, x, row, ctx, Infinity); // sky has no finite depth
  }
}

function fillSky(rt, x, ctx, openTop, openBottom, azimuthDeg) {
  for (let row = openTop; row <= openBottom; row++) {
    const elevDeg = elevAtRow(ctx, row);
    ctx.P.util.shadeSky(azimuthDeg, elevDeg, shadeOut, ctx.P.defaultTime);
    writeShadeOut(rt, x, row, ctx, Infinity); // sky has no finite depth
  }
}
