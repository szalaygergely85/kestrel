// ME-19b: sky/ambient moved verbatim from sectorCaster; shear stays until ME-19d.
import { fastShadeSky, primeFastShadeFrame } from './fastShade.js';
import { clampByte } from '../core/math.js';
import { PROJ_HFOV_DEG as HFOV_DEG, createPitchedTerms, pitchedTerms, screenRay, resolveProjection } from './projection.js';

const refOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: ' ' };
const fastOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0 };

export const ambientL = [0, 0, 0];
export function primeAmbientLight(P) {
  const amb = P.lights.ambient;
  const hue = P.hue[amb.color];
  ambientL[0] = hue[0] * amb.intensity;
  ambientL[1] = hue[1] * amb.intensity;
  ambientL[2] = hue[2] * amb.intensity;
}

function shadeSkyAndWrite(rt, x, y, ctx, azimuthDeg, elevDeg, tag) {
  let glyphIdx, fg, bg;
  if (ctx.useReferenceShader) {
    ctx.P.util.shadeSky(azimuthDeg, elevDeg, refOut, ctx.P.defaultTime);
    const code = refOut.glyph.charCodeAt(0);
    glyphIdx = code < 32 || code > 126 ? 0 : code - 32;
    fg = refOut.fg; bg = refOut.bg;
  } else {
    fastShadeSky(ctx.P, azimuthDeg, elevDeg, ctx.P.defaultTime, fastOut);
    glyphIdx = fastOut.glyphIdx;
    fg = fastOut.fg; bg = fastOut.bg;
  }
  rt.setCellRGB(x, y, glyphIdx, clampByte(fg[0]), clampByte(fg[1]), clampByte(fg[2]),
    clampByte(bg[0]), clampByte(bg[1]), clampByte(bg[2]));
  if (ctx.depthBuffer) ctx.depthBuffer.set(x, y, Infinity); // sky has no finite depth
}

function compassAzimuthDeg(dirX, dirY) {
  let az = Math.atan2(dirX, -dirY) * 180 / Math.PI;
  if (az < 0) az += 360;
  return az;
}

function elevAtRow(ctx, row) {
  return Math.atan2(ctx.horizonRow - row, ctx.planeDistY) * 180 / Math.PI;
}

// RE-02a: fillSky's pitched-branch scratch.
const skyTerms = createPitchedTerms();
const skyGrid = { cols: 0, rows: 0, pxCellW: 1, pxCellH: 1 };
const skyRay = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };

/**
 * Paints cells whose depth is Infinity with sky. Both camera branches
 * retain the old expression order until ME-19d removes shear.
 */
export function fillSky(fb, cam) {
  const rt = fb.rt;
  const cols = rt.cols, rows = rt.rows;
  const P = fb.palette;

  // Idempotent per frame (castSectors already primed these if it ran first
  // this frame) - safe/cheap to redo so a sky-only frame still shades right.
  primeAmbientLight(P);
  primeFastShadeFrame(ambientL);

  const hFovRad = HFOV_DEG * Math.PI / 180;
  const tanHalfHFov = Math.tan(hFovRad / 2);
  const yawRad = cam.yawDeg * Math.PI / 180;
  const dirX = Math.sin(yawRad);
  const dirY = -Math.cos(yawRad);
  const planeX = -dirY * tanHalfHFov;
  const planeY = dirX * tanHalfHFov;
  const screenAspect = (cols * (rt.pxCellW || 1)) / (rows * (rt.pxCellH || 1));
  const planeDistY = (rows / 2) * screenAspect / tanHalfHFov;
  const pitchRad = cam.pitchDeg * Math.PI / 180;
  const horizonRow = rows / 2 + Math.tan(pitchRad) * planeDistY;

  const ctx = {
    P, U: P.util, rows, horizonRow, planeDistY,
    depthBuffer: fb.depth, useReferenceShader: false,
  };

  // RE-02a (28.1 A2 item 2): the pitched sky twin - per cell the `screenRay` direction gives
  // azimuth and elevation (GLSL: `pitchedCellDir` in shade.frag.js's sky branch).
  const pitched = resolveProjection(cam, fb.renderer) === 'pitched';
  if (pitched) {
    skyGrid.cols = cols; skyGrid.rows = rows; skyGrid.pxCellW = rt.pxCellW || 1; skyGrid.pxCellH = rt.pxCellH || 1;
    pitchedTerms(cam, skyGrid, skyTerms);
  }

  for (let x = 0; x < cols; x++) {
    const top = 0, bottom = rows - 1;

    if (pitched) {
      for (let row = top; row <= bottom; row++) {
        if (ctx.depthBuffer && ctx.depthBuffer.depth[row * cols + x] < Infinity) continue;
        screenRay(skyTerms, x, row, skyRay);
        const az = compassAzimuthDeg(skyRay.dx, skyRay.dy);
        const el = Math.atan2(skyRay.dz, Math.hypot(skyRay.dx, skyRay.dy)) * 180 / Math.PI;
        shadeSkyAndWrite(rt, x, row, ctx, az, el, 'fillsky');
      }
      continue;
    }

    const cameraX = (2 * (x + 0.5)) / cols - 1;
    const rayDirX = dirX + planeX * cameraX;
    const rayDirY = dirY + planeY * cameraX;
    const azimuthDeg = compassAzimuthDeg(rayDirX, rayDirY);

    for (let row = top; row <= bottom; row++) {
      // Preserve finite-depth scene cells; sky leaves depth at Infinity.
      if (ctx.depthBuffer && ctx.depthBuffer.depth[row * cols + x] < Infinity) continue;
      const elevDeg = elevAtRow(ctx, row);
      shadeSkyAndWrite(rt, x, row, ctx, azimuthDeg, elevDeg, 'fillsky');
    }
  }
}
