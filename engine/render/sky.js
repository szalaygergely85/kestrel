// ME-19b: sky/ambient moved verbatim from sectorCaster; shear stays until ME-19d.
import { fastShadeSky, primeFastShadeFrame } from './fastShade.js';
import { clampByte } from '../core/math.js';
import { PROJ_HFOV_DEG as HFOV_DEG, createPitchedTerms, pitchedTerms, screenRay, resolveProjection } from './projection.js';
// ART-04a (docs/architecture.md 37.18 item 5): the cloud deck reuses the bit-exact
// `hashFast01` value-noise twin (period 256, seed-keyed) so the JS path and the
// future GLSL kind-0 branch can never drift; `resolveLook` supplies the resolved
// `clouds` record (null when the look has no clouds block).
import { hashFast01 } from './terrainShade.js';
import { resolveLook } from './look.js';
import { dirFromAzEl } from '../core/transform.js';

const refOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: ' ' };
const fastOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0 };

// ART-04a cloud-deck scratch. `cloudOff` holds the per-frame drift (computed
// once in `fillSky`), `cloudDir` the per-cell unit view direction, `cloudOut`
// is `cloudAt`'s caller-owned in/out (`base` + `band` in, `fg`/`bg`/`glyph`
// out) - no per-cell allocation.
const cloudOff = new Float32Array(2);
const cloudDir = [0, 0, 0];
const cloudOut = { base: [0, 0, 0], band: null, fg: [0, 0, 0], bg: [0, 0, 0], glyph: 0 };

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
  } else if (ctx.clouds) {
    // ART-04a (37.18 item 5): the look has a clouds block, so the noise deck
    // replaces today's texture-cloud tint/glyph. `fastShadeSky` first computes
    // the gradient into `fastOut.bg` (= `cloudAt`'s `base`), then `cloudAt`
    // writes the deck over it. The unit direction is the canonical
    // `dirFromAzEl` round-trip of (az, elev).
    fastShadeSky(ctx.P, azimuthDeg, elevDeg, ctx.P.defaultTime, fastOut);
    cloudOut.base[0] = fastOut.bg[0]; cloudOut.base[1] = fastOut.bg[1]; cloudOut.base[2] = fastOut.bg[2];
    cloudOut.band = ctx.band;
    dirFromAzEl(azimuthDeg, elevDeg, cloudDir);
    cloudAt(cloudDir[0], cloudDir[1], cloudDir[2], elevDeg, ctx.clouds, ctx.off, cloudOut);
    glyphIdx = cloudOut.glyph < 32 || cloudOut.glyph > 126 ? 0 : cloudOut.glyph - 32;
    fg = cloudOut.fg; bg = cloudOut.bg;
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

// --- ART-04a (37.18 item 5): JS cloud twin ---------------------------------
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smoothstep01(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

/**
 * Smooth value noise (`vn` in 37.18 item 5): smoothstep-bilinear of the
 * existing `hashFast01` twin, integer-lattice period 256 via `& 255`. Exported
 * so the drift-wrap test can assert the period-256 continuity directly.
 * @param {number} x
 * @param {number} y
 * @param {number} seed
 * @returns {number} 0..1
 */
export function cloudValueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const v00 = hashFast01(ix & 255, iy & 255, seed);
  const v10 = hashFast01((ix + 1) & 255, iy & 255, seed);
  const v01 = hashFast01(ix & 255, (iy + 1) & 255, seed);
  const v11 = hashFast01((ix + 1) & 255, (iy + 1) & 255, seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v11 - v10 - v01 + v00) * sx * sy;
}

/**
 * Per-frame cloud drift: `(C.wind * timeSec) mod 256`, each component
 * `Math.fround`-ed (the value uploaded as the GPU `uCloudOff`). Deterministic
 * in `timeSec`; the mod-256 keeps it precision-safe for hours because the
 * noise is period-256. Writes `out[0..1]` and returns `out`.
 * @param {Object} C - resolved `look.clouds`
 * @param {number} timeSec
 * @param {Float32Array} out
 * @returns {Float32Array}
 */
export function cloudDriftOffset(C, timeSec, out) {
  out[0] = Math.fround((C.wind[0] * timeSec) % 256);
  out[1] = Math.fround((C.wind[1] * timeSec) % 256);
  return out;
}

/**
 * ART-04a pure JS cloud twin (the GLSL kind-0 branch, same expression order).
 * `(dx, dy, dz)` is a UNIT view direction; `elevDeg` its elevation (degrees);
 * `C` is the resolved `look.clouds`; `off` the per-frame drift (Float32Array(2)).
 * `out` is caller-owned: `out.base` (0..255 gradient) and `out.band` ([cb0, cb1,
 * cb2]) are INPUTS (already computed by the caller), `out.fg`/`out.bg` (0..255)
 * and `out.glyph` (char code, 0 = no cloud) are written. No allocation.
 * @param {number} dx
 * @param {number} dy
 * @param {number} dz
 * @param {number} elevDeg
 * @param {Object} C
 * @param {Float32Array} off
 * @param {{base:number[],band:number[],fg:number[],bg:number[],glyph:number}} out
 * @returns {{base:number[],band:number[],fg:number[],bg:number[],glyph:number}} out
 */
export function cloudAt(dx, dy, dz, elevDeg, C, off, out) {
  const seed = C.seed;
  // q = cloud-deck projection, drifted once per frame (off).
  const qx = (dx / (dz + C.bias)) * C.scale + off[0];
  const qy = (dy / (dz + C.bias)) * C.scale + off[1];
  const puff = cloudValueNoise(qx, qy, seed) * 0.65 + cloudValueNoise(qx * 2.03 + 17.0, qy * 2.03 + 17.0, seed) * 0.35;
  // wisp: stretched 3x along x (the wind axis).
  const wisp = cloudValueNoise(qx * 0.33 * 1.7 + 41.0, qy * 1.7 + 41.0, seed);
  const cb = out.band;
  const band = smoothstep01(0, cb[0], elevDeg) * (1 - smoothstep01(cb[1], cb[2], elevDeg));
  const dn = clamp01(Math.max((puff - C.cover) * C.puffK, (wisp - C.wispCover) * C.wispK * 0.55) * band);

  if (dn > 0.04) {
    const qbx = (dx / (dz + C.bias)) * C.scale; // un-drifted part
    const qby = (dy / (dz + C.bias)) * C.scale;
    // below minus above: white tops.
    const lit = clamp01(0.5 + (cloudValueNoise(qbx * (1 + C.litDy) + off[0], qby * (1 + C.litDy) + off[1], seed)
      - cloudValueNoise(qbx * (1 - C.litDy) + off[0], qby * (1 - C.litDy) + off[1], seed)) * C.litK);
    const ccR = C.shade[0] + (C.lit[0] - C.shade[0]) * lit;
    const ccG = C.shade[1] + (C.lit[1] - C.shade[1]) * lit;
    const ccB = C.shade[2] + (C.lit[2] - C.shade[2]) * lit;
    let body = dn * C.bodyK; if (body > 1) body = 1;
    // bg carries the cloud body.
    out.bg[0] = out.base[0] + (ccR - out.base[0]) * body;
    out.bg[1] = out.base[1] + (ccG - out.base[1]) * body;
    out.bg[2] = out.base[2] + (ccB - out.base[2]) * body;
    const hi = 0.1 * lit;
    out.fg[0] = ccR + (255 - ccR) * hi;
    out.fg[1] = ccG + (255 - ccG) * hi;
    out.fg[2] = ccB + (255 - ccB) * hi;
    const ramp = C.ramp, N = ramp.length;
    let idx = 1 + Math.floor(dn * (N - 1.01));
    if (idx > N - 1) idx = N - 1;
    out.glyph = ramp.charCodeAt(idx);
  } else {
    out.fg[0] = out.base[0]; out.fg[1] = out.base[1]; out.fg[2] = out.base[2];
    out.bg[0] = out.base[0]; out.bg[1] = out.base[1]; out.bg[2] = out.base[2];
    out.glyph = 0;
  }
  return out;
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

  // ART-04a: resolve the active look once per frame; when it has a `clouds`
  // block, compute the drift `off` ONCE (per the spec's "computed ONCE per
  // frame") and thread the resolved record + band through to `cloudAt` below.
  // Absent block -> `clouds`/`off`/`band` are null and today's path runs verbatim.
  const look = resolveLook(P);
  const clouds = look ? look.clouds : null;
  const off = clouds ? cloudDriftOffset(clouds, fb.timeSec || 0, cloudOff) : null;
  const band = clouds ? P.materials.sky.cloudBand : null;

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
    clouds, off, band,
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
