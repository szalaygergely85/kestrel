// @ts-check
// engine/mesh/rasterJS.js - ME-03 (docs/backlog.md, docs/architecture.md
// 27.7 items 1, 2, 4, 5; 27.15.4). The JS reference rasteriser: fills a
// `RasterTarget` from a `DrawList` (engine/mesh/DrawList.js) with the same
// pixel-coverage/depth/perspective-correct conventions ANGLE/D3D11 and Mesa
// use, so `?gpucompare=1` keeps a JS oracle once the GPU raster pass lands
// (ME-04). Every fragment rule for kinds 1-8 lives here (27.15.0 amendment
// 12) - ME-05/ME-07 only add feeds + integration tests.
//
// engine/mesh/* may import only engine/core/*, engine/render/GBuffer.js,
// engine/render/projection.js and engine/voxel/{octNormal,voxelPose,
// VoxelModel}.js (architecture.md 27.15.0) - never a caster, gpu/*, game/ or
// design/. This file imports GBuffer.js (kind/face/planeId constants),
// projection.js (PROJ_NEAR) and voxel/octNormal.js (normal packing) only.
//
// Zero allocation per frame (27.15.0 "hard gate"): every scratch buffer
// below is module-level and reused; no closures, array literals or
// destructuring inside the hot per-triangle/per-pixel path.
import { PROJ_NEAR } from '../render/projection.js';
import {
  KIND_TERRAIN, KIND_MODEL, KIND_MESH, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D, FACE_PACKED, PLANEID_TERRAIN,
} from '../render/GBuffer.js';
import { packNormalOct, unpackNormalOct } from '../voxel/octNormal.js';
import {
  flatKind, flatFace, flatMat, AO_NONE, AO_WALL, AO_PLANE, AUX_STRIDE, FLAT_STRIDE,
} from './MeshData.js';
import { DRAW_VOXEL, DRAW_INSTANCED, DRAW_WATER, DRAW_FLAG_DEPTH_BIAS } from './DrawList.js';
import { getClipmap, WATER_U_STRIDE, U_KIND, U_Z, U_AABB, U_SHAPE, U_SLOT } from './waterMesh.js';

/** Sub-pixel bits (1/256 px vertex snap, 27.7 item 1). */
export const SUBPIX = 256;
/** Guard-band clip planes multiplier (keeps |X*256| < 2^23, 27.15.4). */
export const GUARD = 16;
/** Depth-bias tuning (terrain only, off until ME-06 - 27.15.4). */
export const BIAS_FACTOR = 1;
export const BIAS_UNITS = 1;

/**
 * @typedef {Object} RasterTarget
 * @property {number} cols
 * @property {number} rows
 * @property {number} n - sub-samples per cell
 * @property {number} W - cols*n
 * @property {number} H - rows*n
 * @property {boolean} depthOnly - ME-15a: only `zbuf` is allocated/written (all other planes have length 0)
 * @property {Float64Array} zbuf - z_ndc, cleared to 1
 * @property {Float32Array} depth - view-space forward distance d, cleared to Infinity
 * @property {Uint8Array} kind
 * @property {Uint8Array} face
 * @property {Uint16Array} mat
 * @property {Int32Array} planeId
 * @property {Float32Array} u
 * @property {Float32Array} v
 * @property {Float32Array} z
 * @property {Float32Array} aoD
 * @property {Uint32Array} nrm - packNormalOct of the world-space fragment normal
 * @property {Uint32Array} objectId
 * @property {Uint32Array|null} writes - per-pixel write count (test instrumentation only)
 */

/**
 * @typedef {Object} RasterCtx
 * @property {Float64Array} M - column-major world->clip (`shearProjection`)
 * @property {import('../render/projection.js').ProjTerms} [terms]
 * @property {boolean} [snap] - false disables the 1/256 px vertex snap (tests only)
 * @property {(x: number, y: number) => number} [kind7Mat] - terrain mat lookup by world x, y
 * @property {Float64Array|Float32Array} [structFoot] - x0, y0, x1, y1 per placed structure (world m): terrain
 *   fragments inside any box are skipped (the DDA `buildSkips` rule; GPU twin: terrain.vert.js `uStructFoot`)
 * @property {number} [structCount] - boxes used in `structFoot`
 * @property {{slotIds: Uint32Array, mat: Uint32Array}|null} [team] - RE-06: `table.team` (teamRemap.js); DRAW_INSTANCED mat remap
 * @property {{factor: number, units: number}} [depthBias] - ME-15a (27.9a items 5, 9): GPU polygon-offset twin
 *   (`zn += factor * max(|dz/dx|, |dz/dy|) + 2 * units * 2^-24`, NDC z in [-1,1]) applied to EVERY item
 *   (the shadow pass); absent = the per-item terrain `DRAW_FLAG_DEPTH_BIAS` rule with `BIAS_FACTOR/BIAS_UNITS`
 */

/**
 * @param {number} cols
 * @param {number} rows
 * @param {number} n
 * @param {{countWrites?: boolean, depthOnly?: boolean}} [opts] - `depthOnly` (ME-15a, shadow maps): allocates
 *   `zbuf` only (every other plane is length 0); `rasterDrawList` skips attribute interpolation
 * @returns {RasterTarget}
 */
export function createRasterTarget(cols, rows, n, opts) {
  const W = cols * n, H = rows * n;
  const depthOnly = !!(opts && opts.depthOnly);
  const size = W * H;
  const a = depthOnly ? 0 : size; // attribute plane length
  const t = {
    cols, rows, n, W, H,
    depthOnly,
    zbuf: new Float64Array(size),
    depth: new Float32Array(a),
    kind: new Uint8Array(a),
    face: new Uint8Array(a),
    mat: new Uint16Array(a),
    planeId: new Int32Array(a),
    u: new Float32Array(a),
    v: new Float32Array(a),
    z: new Float32Array(a),
    aoD: new Float32Array(a),
    nrm: new Uint32Array(a),
    objectId: new Uint32Array(a),
    writes: opts && opts.countWrites ? new Uint32Array(size) : null,
  };
  clearRasterTarget(t);
  return t;
}

/**
 * US-078a (architecture.md 30.1): depth-buffer-only clear - the view-model layer draws after the scene with a fresh
 * depth range but keeps every attribute plane the scene wrote (twin of `gl.clear(DEPTH_BUFFER_BIT)`).
 * @param {RasterTarget} t
 */
export function clearRasterDepth(t) {
  t.zbuf.fill(1);
}

/** @param {RasterTarget} t */
export function clearRasterTarget(t) {
  t.zbuf.fill(1);
  t.depth.fill(Infinity);
  t.kind.fill(0);
  t.face.fill(0);
  t.mat.fill(0);
  t.planeId.fill(0);
  t.u.fill(0);
  t.v.fill(0);
  t.z.fill(0);
  t.aoD.fill(Infinity);
  t.nrm.fill(0);
  t.objectId.fill(0);
  if (t.writes) t.writes.fill(0);
}

// ---------------------------------------------------------------------------
// Module scratch (zero allocation - 27.15.0)
// ---------------------------------------------------------------------------
const STRIDE = 12; // [xClip,yClip,zClip,wClip, wx,wy,wz, u,v, nx,ny,nz]
const CLIP_MAX = 16; // 3 input verts + <=5 planes -> <=8, generous margin
const _bufA = new Float64Array(CLIP_MAX * STRIDE);
const _bufB = new Float64Array(CLIP_MAX * STRIDE);
const _matScratch = new Float64Array(12);
const _nrmScratch = new Float64Array(3);
// RE-06 (28.6): DRAW_INSTANCED scratch - the per-instance item rasterRange sees.
const _instItem = {
  matrix: _matScratch, planeIdOr: 0, objectId: 0, zBase: 0, flags: 0,
  partMatrices: /** @type {Float64Array|null} */ (null), partFlags: /** @type {Uint8Array|null} */ (null),
};
let _team = 0; // team index of the instance being rasterised (0 outside DRAW_INSTANCED)
/** Per-triangle constant fragment data, reused every triangle (no per-call allocation). */
const _info = {
  cullBack: false,
  kind: 0, face: 0, mat: 0, planeId: 0, aoMode: 0, zRef: 0,
  aux2: 0, aux3: 0, aux4: 0, aux5: 0,
  zBase: 0, objectId: 0, isTerrain: false, isVoxel: false, isMesh: false,
  partAxisAligned: false, kind7Mat: /** @type {((x:number,y:number)=>number)|null} */ (null),
  biasFlag: 0, biasFactor: BIAS_FACTOR, biasUnits: BIAS_UNITS, twoSided: false,
  structFoot: /** @type {Float64Array|Float32Array|null} */ (null), structCount: 0,
};

/** True when world (x, y) is inside any `[x0, x1) x [y0, y1)` box of `foot` (structure footprint carve, terrain only). */
function insideStructFoot(foot, count, x, y) {
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    if (x >= foot[o] && x < foot[o + 2] && y >= foot[o + 1] && y < foot[o + 3]) return true;
  }
  return false;
}

/** Literal copy of `voxelMarch.js`'s `roundedFace` (never import a caster/march module - 27.15.0). */
function roundedFace(nx, ny, nz) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ax >= ay && ax >= az) return nx >= 0 ? FACE_E : FACE_W;
  if (ay >= ax && ay >= az) return ny >= 0 ? FACE_S : FACE_N;
  return nz >= 0 ? FACE_U : FACE_D;
}

/** Scalar twin of the instanced vertex shader's team loop (engine/render/teamRemap.js `remapTeamMat`, copied: no render imports here). */
function teamMat(team, teamIdx, mat) {
  if (mat === 0) return mat;
  for (let s = 0; s < 4; s++) if (team.slotIds[s] === mat) return team.mat[teamIdx * 4 + s];
  return mat;
}

/** AO_WALL/AO_PLANE fragment formulas (27.15.2, literal - identical to levelMesh.test.js's oracle). */
function computeAoD(aoMode, u, v, zRef, a2, a3, a4, a5) {
  if (aoMode === AO_WALL) {
    const h = v;
    let d = Math.max(0, h - zRef);
    const zc = a2 - h; // ceilZ - h
    if (zc < d) d = Math.max(0, zc);
    const fr = u - a5; // u - u0
    if (h < a3) d = Math.min(d, fr); // nbrALo
    if (h < a4) d = Math.min(d, 1 - fr); // nbrBLo
    return d;
  }
  if (aoMode === AO_PLANE) {
    const fx = u - a3, fy = v - a4; // - cellX0, - cellY0
    let a = Infinity;
    if (a2 & 1) a = Math.min(a, fx); // W
    if (a2 & 2) a = Math.min(a, 1 - fx); // E
    if (a2 & 4) a = Math.min(a, fy); // N
    if (a2 & 8) a = Math.min(a, 1 - fy); // S
    return a;
  }
  return Infinity; // AO_NONE
}

/**
 * Vertex stage: local pos/normal -> world (item matrix) -> clip (M). Writes
 * `outBuf[off .. off+STRIDE)`. Zero allocation (`_nrmScratch` reused).
 */
function transformVertex(mesh, matArr, vIdx, M, outBuf, off) {
  const px = mesh.pos[vIdx * 3], py = mesh.pos[vIdx * 3 + 1], pz = mesh.pos[vIdx * 3 + 2];
  const a00 = matArr[0], a01 = matArr[1], a02 = matArr[2];
  const a10 = matArr[3], a11 = matArr[4], a12 = matArr[5];
  const a20 = matArr[6], a21 = matArr[7], a22 = matArr[8];
  const tx = matArr[9], ty = matArr[10], tz = matArr[11];
  const wx = a00 * px + a01 * py + a02 * pz + tx;
  const wy = a10 * px + a11 * py + a12 * pz + ty;
  const wz = a20 * px + a21 * py + a22 * pz + tz;

  _nrmScratch[0] = 0; _nrmScratch[1] = 0; _nrmScratch[2] = 1;
  unpackNormalOct(mesh.nrm[vIdx], _nrmScratch);
  const lnx = _nrmScratch[0], lny = _nrmScratch[1], lnz = _nrmScratch[2];
  let nx = a00 * lnx + a01 * lny + a02 * lnz;
  let ny = a10 * lnx + a11 * lny + a12 * lnz;
  let nz = a20 * lnx + a21 * lny + a22 * lnz;
  const nlen = Math.hypot(nx, ny, nz) || 1;
  nx /= nlen; ny /= nlen; nz /= nlen;

  let u = 0, v = 0;
  if (mesh.layout === 'static' || mesh.layout === 'cloth') { u = mesh.uv[vIdx * 2]; v = mesh.uv[vIdx * 2 + 1]; }

  const xClip = M[0] * wx + M[4] * wy + M[8] * wz + M[12];
  const yClip = M[1] * wx + M[5] * wy + M[9] * wz + M[13];
  const zClip = M[2] * wx + M[6] * wy + M[10] * wz + M[14];
  const wClip = M[3] * wx + M[7] * wy + M[11] * wz + M[15];

  outBuf[off] = xClip; outBuf[off + 1] = yClip; outBuf[off + 2] = zClip; outBuf[off + 3] = wClip;
  outBuf[off + 4] = wx; outBuf[off + 5] = wy; outBuf[off + 6] = wz;
  outBuf[off + 7] = u; outBuf[off + 8] = v;
  outBuf[off + 9] = nx; outBuf[off + 10] = ny; outBuf[off + 11] = nz;
}

/** Plane 0 = near (w - PROJ_NEAR >= 0); 1..4 = guard band (27.15.4). */
function planeDist(buf, off, planeType) {
  const x = buf[off], y = buf[off + 1], w = buf[off + 3];
  switch (planeType) {
    case 0: return w - PROJ_NEAR;
    case 1: return GUARD * w + x;
    case 2: return GUARD * w - x;
    case 3: return GUARD * w + y;
    default: return GUARD * w - y;
  }
}

/** Lexicographic (w, x, y, z) compare - canonical order so a shared edge clips identically in both triangles (27.7 item 1 / 27.15.4). */
function isSmaller(buf, offA, offB) {
  const wA = buf[offA + 3], wB = buf[offB + 3];
  if (wA !== wB) return wA < wB;
  const xA = buf[offA], xB = buf[offB];
  if (xA !== xB) return xA < xB;
  const yA = buf[offA + 1], yB = buf[offB + 1];
  if (yA !== yB) return yA < yB;
  return buf[offA + 2] < buf[offB + 2];
}

function copyVert(inBuf, inOff, outBuf, outOff) {
  for (let k = 0; k < STRIDE; k++) outBuf[outOff + k] = inBuf[inOff + k];
}

function intersectCanonical(buf, offA, offB, planeType, outBuf, outOff) {
  let smallOff, largeOff;
  if (isSmaller(buf, offA, offB)) { smallOff = offA; largeOff = offB; } else { smallOff = offB; largeOff = offA; }
  const dS = planeDist(buf, smallOff, planeType);
  const dL = planeDist(buf, largeOff, planeType);
  const t = dS / (dS - dL);
  for (let k = 0; k < STRIDE; k++) outBuf[outOff + k] = buf[smallOff + k] + t * (buf[largeOff + k] - buf[smallOff + k]);
}

/** Sutherland-Hodgman, one plane, `inBuf[0..inCount)` -> `outBuf`. Zero allocation. */
function clipAgainstPlane(inBuf, inCount, outBuf, planeType) {
  let outCount = 0;
  if (inCount === 0) return 0;
  for (let i = 0; i < inCount; i++) {
    const curOff = i * STRIDE;
    const nextI = i + 1 === inCount ? 0 : i + 1;
    const nextOff = nextI * STRIDE;
    const dCur = planeDist(inBuf, curOff, planeType);
    const dNext = planeDist(inBuf, nextOff, planeType);
    const curIn = dCur >= 0, nextIn = dNext >= 0;
    if (curIn && outCount < CLIP_MAX) { copyVert(inBuf, curOff, outBuf, outCount * STRIDE); outCount++; }
    if (curIn !== nextIn && outCount < CLIP_MAX) {
      intersectCanonical(inBuf, curOff, nextOff, planeType, outBuf, outCount * STRIDE);
      outCount++;
    }
  }
  return outCount;
}

/**
 * Rasterises one already-clipped fan triangle (window/edge/depth/attribute
 * steps 3-7 of 27.15.4). `info` carries this triangle's constant fragment
 * data (kind/face/mat/planeId/aoMode/aux/zRef/zBase/objectId/...).
 */
function rasterFanTri(buf, o0, o1, o2, target, ctx, info) {
  const w0 = buf[o0 + 3], w1 = buf[o1 + 3], w2 = buf[o2 + 3];
  const W = target.W, H = target.H;
  const X0 = (W / 2) * (buf[o0] / w0) + W / 2, Y0 = (H / 2) * (buf[o0 + 1] / w0) + H / 2, zn0 = buf[o0 + 2] / w0, iw0 = 1 / w0;
  let X1 = (W / 2) * (buf[o1] / w1) + W / 2, Y1 = (H / 2) * (buf[o1 + 1] / w1) + H / 2, zn1 = buf[o1 + 2] / w1, iw1 = 1 / w1;
  let X2 = (W / 2) * (buf[o2] / w2) + W / 2, Y2 = (H / 2) * (buf[o2 + 1] / w2) + H / 2, zn2 = buf[o2 + 2] / w2, iw2 = 1 / w2;

  let wx0 = buf[o0 + 4], wy0 = buf[o0 + 5], wz0 = buf[o0 + 6], u0a = buf[o0 + 7], v0a = buf[o0 + 8], nx0 = buf[o0 + 9], ny0 = buf[o0 + 10], nz0 = buf[o0 + 11];
  let wx1 = buf[o1 + 4], wy1 = buf[o1 + 5], wz1 = buf[o1 + 6], u1a = buf[o1 + 7], v1a = buf[o1 + 8], nx1 = buf[o1 + 9], ny1 = buf[o1 + 10], nz1 = buf[o1 + 11];
  let wx2 = buf[o2 + 4], wy2 = buf[o2 + 5], wz2 = buf[o2 + 6], u2a = buf[o2 + 7], v2a = buf[o2 + 8], nx2 = buf[o2 + 9], ny2 = buf[o2 + 10], nz2 = buf[o2 + 11];

  let Xs0, Ys0, Xs1, Ys1, Xs2, Ys2;
  if (ctx.snap === false) {
    Xs0 = X0 * SUBPIX; Ys0 = Y0 * SUBPIX;
    Xs1 = X1 * SUBPIX; Ys1 = Y1 * SUBPIX;
    Xs2 = X2 * SUBPIX; Ys2 = Y2 * SUBPIX;
  } else {
    Xs0 = Math.round(X0 * SUBPIX); Ys0 = Math.round(Y0 * SUBPIX);
    Xs1 = Math.round(X1 * SUBPIX); Ys1 = Math.round(Y1 * SUBPIX);
    Xs2 = Math.round(X2 * SUBPIX); Ys2 = Math.round(Y2 * SUBPIX);
  }

  let A2 = (Xs1 - Xs0) * (Ys2 - Ys0) - (Ys1 - Ys0) * (Xs2 - Xs0);
  if (A2 === 0) return;
  if (A2 < 0 && info.cullBack) return; // RE-06c (28.10): voxel/instanced back faces, same snapped area as the GPU
  // CLOTH-1b1 (33.5): two-sided surface rule. The vertex normals follow the triangle winding (n = cross(b-a, c-a), A2 > 0 =
  // front, RE-06c). A fragment of a triangle whose snapped screen area is negative (seen from behind) gets N = -N, so the
  // lit normal always faces the eye. Captured BEFORE the vertex swap below; the GPU twin does the same with gl_FrontFacing.
  const flipN = info.twoSided && A2 < 0;
  if (A2 < 0) {
    let t;
    t = Xs1; Xs1 = Xs2; Xs2 = t; t = Ys1; Ys1 = Ys2; Ys2 = t;
    t = zn1; zn1 = zn2; zn2 = t; t = iw1; iw1 = iw2; iw2 = t;
    t = wx1; wx1 = wx2; wx2 = t; t = wy1; wy1 = wy2; wy2 = t; t = wz1; wz1 = wz2; wz2 = t;
    t = u1a; u1a = u2a; u2a = t; t = v1a; v1a = v2a; v2a = t;
    t = nx1; nx1 = nx2; nx2 = t; t = ny1; ny1 = ny2; ny2 = t; t = nz1; nz1 = nz2; nz2 = t;
    A2 = -A2;
  }

  const topLeft01 = (Ys1 === Ys0 && Xs1 > Xs0) || Ys1 < Ys0;
  const topLeft12 = (Ys2 === Ys1 && Xs2 > Xs1) || Ys2 < Ys1;
  const topLeft20 = (Ys0 === Ys2 && Xs0 > Xs2) || Ys0 < Ys2;

  const minX = Math.min(Xs0, Xs1, Xs2), maxX = Math.max(Xs0, Xs1, Xs2);
  const minY = Math.min(Ys0, Ys1, Ys2), maxY = Math.max(Ys0, Ys1, Ys2);
  const pxMin = Math.max(0, Math.ceil((minX - 128) / 256));
  const pxMax = Math.min(W - 1, Math.floor((maxX - 128) / 256));
  const pyMin = Math.max(0, Math.ceil((minY - 128) / 256));
  const pyMax = Math.min(H - 1, Math.floor((maxY - 128) / 256));
  if (pxMin > pxMax || pyMin > pyMax) return;

  let biasAdd = 0;
  if (info.biasFlag) {
    const dE12dX = -(Ys2 - Ys1), dE12dY = (Xs2 - Xs1);
    const dE20dX = -(Ys0 - Ys2), dE20dY = (Xs0 - Xs2);
    const dE01dX = -(Ys1 - Ys0), dE01dY = (Xs1 - Xs0);
    const dznX = ((dE12dX * zn0 + dE20dX * zn1 + dE01dX * zn2) / A2) * SUBPIX;
    const dznY = ((dE12dY * zn0 + dE20dY * zn1 + dE01dY * zn2) / A2) * SUBPIX;
    biasAdd = info.biasFactor * Math.max(Math.abs(dznX), Math.abs(dznY)) + 2 * info.biasUnits * Math.pow(2, -24);
  }

  for (let py = pyMin; py <= pyMax; py++) {
    const Py = py * 256 + 128;
    const rowBase = py * W;
    for (let px = pxMin; px <= pxMax; px++) {
      const Px = px * 256 + 128;
      const e12 = (Xs2 - Xs1) * (Py - Ys1) - (Ys2 - Ys1) * (Px - Xs1);
      const e20 = (Xs0 - Xs2) * (Py - Ys2) - (Ys0 - Ys2) * (Px - Xs2);
      const e01 = (Xs1 - Xs0) * (Py - Ys0) - (Ys1 - Ys0) * (Px - Xs0);
      const in12 = e12 > 0 || (e12 === 0 && topLeft12);
      const in20 = e20 > 0 || (e20 === 0 && topLeft20);
      const in01 = e01 > 0 || (e01 === 0 && topLeft01);
      if (!(in12 && in20 && in01)) continue;

      const l0 = e12 / A2, l1 = e20 / A2, l2 = e01 / A2;
      let zn = l0 * zn0 + l1 * zn1 + l2 * zn2;
      if (info.biasFlag) zn += biasAdd;
      if (zn > 1) continue;

      const idx = rowBase + px;
      if (target.depthOnly) {
        if (zn < -1) continue; // GPU near-clip parity (depth-only path) // ME-15a shadow map: depth (+ terrain footprint carve) only
        if (zn < target.zbuf[idx]) {
          if (info.isTerrain && info.structCount > 0) {
            const iq = 1 / (l0 * iw0 + l1 * iw1 + l2 * iw2);
            const cwx = (l0 * wx0 * iw0 + l1 * wx1 * iw1 + l2 * wx2 * iw2) * iq;
            const cwy = (l0 * wy0 * iw0 + l1 * wy1 * iw1 + l2 * wy2 * iw2) * iq;
            if (insideStructFoot(info.structFoot, info.structCount, cwx, cwy)) continue;
          }
          target.zbuf[idx] = zn;
          if (target.writes) target.writes[idx]++;
        }
        continue;
      }
      if (zn < target.zbuf[idx]) {
        const q = l0 * iw0 + l1 * iw1 + l2 * iw2;
        const invq = 1 / q;
        const u = (l0 * u0a * iw0 + l1 * u1a * iw1 + l2 * u2a * iw2) * invq;
        const v = (l0 * v0a * iw0 + l1 * v1a * iw1 + l2 * v2a * iw2) * invq;
        const wx = (l0 * wx0 * iw0 + l1 * wx1 * iw1 + l2 * wx2 * iw2) * invq;
        const wy = (l0 * wy0 * iw0 + l1 * wy1 * iw1 + l2 * wy2 * iw2) * invq;
        const wz = (l0 * wz0 * iw0 + l1 * wz1 * iw1 + l2 * wz2 * iw2) * invq;
        let wnx = (l0 * nx0 * iw0 + l1 * nx1 * iw1 + l2 * nx2 * iw2) * invq;
        let wny = (l0 * ny0 * iw0 + l1 * ny1 * iw1 + l2 * ny2 * iw2) * invq;
        let wnz = (l0 * nz0 * iw0 + l1 * nz1 * iw1 + l2 * nz2 * iw2) * invq;
        const nlen = Math.hypot(wnx, wny, wnz) || 1;
        wnx /= nlen; wny /= nlen; wnz /= nlen;
        if (flipN) { wnx = -wnx; wny = -wny; wnz = -wnz; }

        let face = info.face, mat = info.mat, outU = u, outV = v;
        if (info.isTerrain) {
          if (info.structCount > 0 && insideStructFoot(info.structFoot, info.structCount, wx, wy)) continue;
          outU = wx; outV = wy;
          mat = info.kind7Mat ? info.kind7Mat(wx, wy) : 0;
        } else if (info.isVoxel) {
          face = info.partAxisAligned ? roundedFace(wnx, wny, wnz) : FACE_PACKED;
        } else if (info.isMesh) {
          // ME-14c2 (37.1 item 1): axis face when the world normal is within ~26 deg of an axis, else packed (face 7).
          face = Math.max(Math.abs(wnx), Math.abs(wny), Math.abs(wnz)) >= 0.9 ? roundedFace(wnx, wny, wnz) : FACE_PACKED;
        }
        const aoD = (info.isTerrain || info.isMesh) ? Infinity : computeAoD(info.aoMode, u, v, info.zRef, info.aux2, info.aux3, info.aux4, info.aux5);

        target.kind[idx] = info.kind;
        target.face[idx] = face;
        target.mat[idx] = mat;
        target.planeId[idx] = info.planeId;
        target.u[idx] = outU;
        target.v[idx] = outV;
        target.z[idx] = wz - info.zBase - info.zRef;
        target.aoD[idx] = aoD;
        target.nrm[idx] = packNormalOct(wnx, wny, wnz);
        target.objectId[idx] = info.objectId;
        target.depth[idx] = invq;
        target.zbuf[idx] = zn;
        if (target.writes) target.writes[idx]++;
      }
    }
  }
}

/** Transforms + clips one mesh triangle, then fans the clipped polygon into `rasterFanTri` calls. */
function clipAndRasterTri(mesh, v0, v1, v2, target, ctx, info) {
  transformVertex(mesh, _matScratch, v0, ctx.M, _bufA, 0);
  transformVertex(mesh, _matScratch, v1, ctx.M, _bufA, STRIDE);
  transformVertex(mesh, _matScratch, v2, ctx.M, _bufA, STRIDE * 2);

  let curBuf = _bufA, curCount = 3, otherBuf = _bufB;
  for (let p = 0; p < 5 && curCount > 0; p++) {
    const outCount = clipAgainstPlane(curBuf, curCount, otherBuf, p);
    const tmp = curBuf; curBuf = otherBuf; otherBuf = tmp;
    curCount = outCount;
  }
  if (curCount < 3) return;
  for (let k = 1; k < curCount - 1; k++) {
    rasterFanTri(curBuf, 0, k * STRIDE, (k + 1) * STRIDE, target, ctx, info);
  }
}

/**
 * Rasterises one draw item's triangle range (static/terrain: `item.rangeFirst
 * .. +rangeCount`; voxel: one call per `mesh.ranges[partIdx]`, matrix =
 * `item.partMatrices[partIdx]`).
 */
function rasterRange(mesh, item, target, ctx, triStart, triCount, partIdx, isVoxelItem, instAligned) {
  const isTerrain = mesh.layout === 'terrain';
  const isCloth = mesh.layout === 'cloth';
  if (instAligned !== undefined) {
    // DRAW_INSTANCED: the caller already composed I_i * P_p into _matScratch (== item.matrix).
  } else if (isVoxelItem) {
    for (let k = 0; k < 12; k++) _matScratch[k] = item.partMatrices[partIdx * 12 + k];
  } else {
    for (let k = 0; k < 12; k++) _matScratch[k] = item.matrix[k];
  }

  for (let t = triStart; t < triStart + triCount; t++) {
    let v0, v1, v2;
    if (isCloth) {
      // CLOTH-1b1: indexed like terrain, kind 8 / face 7 (packed smooth normal), one mat per mesh, one planeId per
      // cloth (folds outline through depth only), cull none (two-sided, see rasterFanTri).
      v0 = mesh.idx[t * 3]; v1 = mesh.idx[t * 3 + 1]; v2 = mesh.idx[t * 3 + 2];
      _info.isTerrain = false;
      _info.kind = KIND_MODEL;
      _info.face = FACE_PACKED;
      _info.mat = mesh.matId;
      _info.planeId = item.planeIdOr | 0;
      _info.aoMode = AO_NONE;
      _info.zRef = 0;
      _info.isVoxel = false;
      _info.isMesh = false;
      _info.partAxisAligned = false;
      _info.kind7Mat = null;
      _info.biasFlag = 0;
      _info.cullBack = false;
      _info.twoSided = true;
    } else if (isTerrain) {
      _info.twoSided = false;
      v0 = mesh.idx[t * 3]; v1 = mesh.idx[t * 3 + 1]; v2 = mesh.idx[t * 3 + 2];
      _info.isTerrain = true;
      _info.kind = KIND_TERRAIN;
      _info.face = FACE_PACKED;
      _info.mat = 0;
      _info.planeId = PLANEID_TERRAIN;
      _info.aoMode = AO_NONE;
      _info.zRef = 0;
      _info.isVoxel = false;
      _info.isMesh = false;
      _info.partAxisAligned = false;
      _info.kind7Mat = ctx.kind7Mat || null;
      _info.structFoot = ctx.structFoot || null;
      _info.structCount = ctx.structFoot ? (ctx.structCount || 0) : 0;
      _info.biasFlag = item.flags & DRAW_FLAG_DEPTH_BIAS;
      _info.cullBack = false;
    } else {
      _info.twoSided = false;
      v0 = t * 3; v1 = t * 3 + 1; v2 = t * 3 + 2;
      const flat0 = mesh.flat[v0 * FLAT_STRIDE];
      const flat1 = mesh.flat[v0 * FLAT_STRIDE + 1];
      const kind = flatKind(flat1);
      _info.isTerrain = false;
      _info.kind = kind;
      _info.face = flatFace(flat1);
      _info.mat = _team !== 0 && ctx.team ? teamMat(ctx.team, _team, flatMat(flat1)) : flatMat(flat1);
      _info.planeId = (flat0 | item.planeIdOr) | 0;
      _info.aoMode = mesh.aux[v0 * AUX_STRIDE + 1];
      _info.zRef = mesh.aux[v0 * AUX_STRIDE + 0];
      _info.aux2 = mesh.aux[v0 * AUX_STRIDE + 2];
      _info.aux3 = mesh.aux[v0 * AUX_STRIDE + 3];
      _info.aux4 = mesh.aux[v0 * AUX_STRIDE + 4];
      _info.aux5 = mesh.aux[v0 * AUX_STRIDE + 5];
      _info.isVoxel = kind === KIND_MODEL;
      _info.isMesh = kind === KIND_MESH;
      _info.partAxisAligned = instAligned !== undefined ? instAligned : (isVoxelItem && (item.partFlags[partIdx] & 1) !== 0);
      _info.kind7Mat = null;
      _info.biasFlag = 0;
      _info.cullBack = isVoxelItem || instAligned !== undefined;
    }
    if (ctx.depthBias) { // ME-15a: the shadow pass biases every caster
      _info.biasFlag = 1; _info.biasFactor = ctx.depthBias.factor; _info.biasUnits = ctx.depthBias.units;
    } else {
      _info.biasFactor = BIAS_FACTOR; _info.biasUnits = BIAS_UNITS;
    }
    _info.zBase = item.zBase;
    _info.objectId = item.objectId;

    clipAndRasterTri(mesh, v0, v1, v2, target, ctx, _info);
  }
}

/**
 * RE-06 (28.6): part-major, then instance order - the GPU primitive order
 * (one instanced draw per part). Composes I_i * P_p in float64 per
 * (part, instance) into `_matScratch`; objectId/planeIdOr/zBase/aligned/team
 * come from the instance words. Zero allocation.
 */
function rasterInstanced(mesh, item, target, ctx) {
  const ranges = mesh.ranges;
  const ib = item.instBuf;
  if (!ib) return;
  const f = ib.f32, u = ib.u32, pm = item.partMatrices, n = item.instCount;
  const M = _matScratch;
  for (let p = 0; p < ranges.length; p++) {
    const range = ranges[p];
    if (range.count <= 0) continue;
    const o = p * 12;
    const a00 = pm[o], a01 = pm[o + 1], a02 = pm[o + 2];
    const a10 = pm[o + 3], a11 = pm[o + 4], a12 = pm[o + 5];
    const a20 = pm[o + 6], a21 = pm[o + 7], a22 = pm[o + 8];
    const tx = pm[o + 9], ty = pm[o + 10], tz = pm[o + 11];
    const partAligned = (item.partFlags[p] & 1) !== 0;
    for (let i = 0; i < n; i++) {
      const b = i * 16;
      const i00 = f[b], i01 = f[b + 1], i02 = f[b + 2], itx = f[b + 3];
      const i10 = f[b + 4], i11 = f[b + 5], i12 = f[b + 6], ity = f[b + 7];
      const i20 = f[b + 8], i21 = f[b + 9], i22 = f[b + 10], itz = f[b + 11];
      M[0] = i00 * a00 + i01 * a10 + i02 * a20; M[1] = i00 * a01 + i01 * a11 + i02 * a21; M[2] = i00 * a02 + i01 * a12 + i02 * a22;
      M[3] = i10 * a00 + i11 * a10 + i12 * a20; M[4] = i10 * a01 + i11 * a11 + i12 * a21; M[5] = i10 * a02 + i11 * a12 + i12 * a22;
      M[6] = i20 * a00 + i21 * a10 + i22 * a20; M[7] = i20 * a01 + i21 * a11 + i22 * a21; M[8] = i20 * a02 + i21 * a12 + i22 * a22;
      M[9] = i00 * tx + i01 * ty + i02 * tz + itx;
      M[10] = i10 * tx + i11 * ty + i12 * tz + ity;
      M[11] = i20 * tx + i21 * ty + i22 * tz + itz;
      const oid = u[b + 12];
      const meta = u[b + 13];
      _instItem.objectId = oid;
      _instItem.planeIdOr = (oid & 0xF) << 24;
      _instItem.zBase = itz;
      _team = (meta >>> 8) & 0xff;
      rasterRange(mesh, _instItem, target, ctx, range.start, range.count, p, false, partAligned && (meta & 1) !== 0);
    }
  }
  _team = 0;
}

/**
 * Rasterises every item in `list.items[0..list.count)` into `target`.
 * @param {import('./DrawList.js').DrawList} list
 * @param {RasterTarget} target
 * @param {RasterCtx} ctx
 */
export function rasterDrawList(list, target, ctx) {
  for (let i = 0; i < list.count; i++) {
    const item = list.items[i];
    if (item.type === DRAW_WATER) { // US-055a2a: no MeshData; the shared clipmap + the frame's selection
      if (item.water) rasterWaterSlot(item.water, item.objectId, target, ctx);
      continue;
    }
    const mesh = item.mesh;
    if (!mesh) continue;
    if (item.type === DRAW_INSTANCED) {
      rasterInstanced(mesh, item, target, ctx);
    } else if (item.type === DRAW_VOXEL) {
      const ranges = mesh.ranges;
      for (let p = 0; p < ranges.length; p++) {
        rasterRange(mesh, item, target, ctx, ranges[p].start, ranges[p].count, p, true);
      }
    } else {
      rasterRange(mesh, item, target, ctx, item.rangeFirst, item.rangeCount, 0, false);
    }
  }
}

// ---------------------------------------------------------------------------
// US-055a2a (architecture.md 35.3): DRAW_WATER - the JS twin of water.vert/frag.js
// ---------------------------------------------------------------------------
const WATER_NRM_UP = packNormalOct(0, 0, 1);

/** Frustum outcode of the clip vertex at `buf[off..]`: bit 0 behind the near plane, bits 1-4 outside -w..w in x / y. */
function waterOutcode(buf, off) {
  const x = buf[off], y = buf[off + 1], w = buf[off + 3];
  return (w < PROJ_NEAR ? 1 : 0) | (x < -w ? 2 : 0) | (x > w ? 4 : 0) | (y < -w ? 8 : 0) | (y > w ? 16 : 0);
}

/**
 * Rasterises one selected water slot: every triangle of the clipmap index runs through `waterVertexJS` (clamp to the
 * region AABB, flat z), the standard near/guard clip, then `rasterWaterTri`. `target` is a cell-resolution (n = 1)
 * RasterTarget; `ctx.sceneDepth` (Float32Array cols*rows, d units) is the occluder.
 * @param {any} sel - WaterSelection (engine/render/water.js) @param {number} slot
 * @param {RasterTarget} target @param {any} ctx
 */
function rasterWaterSlot(sel, slot, target, ctx) {
  const cm = getClipmap(), M = ctx.M, u = sel.u, ub = slot * WATER_U_STRIDE;
  const verts = cm.verts, index = cm.index;
  const ox = sel.O[0], oy = sel.O[1];
  const ro = slot * 7, nRuns = sel.runs[ro];
  const ax0 = u[ub + U_AABB], ay0 = u[ub + U_AABB + 1], ax1 = u[ub + U_AABB + 2], ay1 = u[ub + U_AABB + 3], zW = u[ub + U_Z];
  for (let r = 0; r < nRuns; r++) {
    const first = sel.runs[ro + 1 + r * 2], end = first + sel.runs[ro + 2 + r * 2];
    for (let t = first; t < end; t += 3) {
      let sameX = true, sameY = true, px0 = 0, py0 = 0;
      for (let c = 0; c < 3; c++) {
        const vi = index[t + c] * 4;
        // = waterVertexJS (waterMesh.js), inlined: no double-argument calls in the per-vertex / per-pixel loops (allocation)
        const lx = verts[vi] < ax0 ? ax0 : (verts[vi] > ax1 ? ax1 : verts[vi]);
        const ly = verts[vi + 1] < ay0 ? ay0 : (verts[vi + 1] > ay1 ? ay1 : verts[vi + 1]);
        if (c === 0) { px0 = lx; py0 = ly; } else { if (lx !== px0) sameX = false; if (ly !== py0) sameY = false; }
        const wx = ox + lx, wy = oy + ly, wz = zW;
        const o = c * STRIDE;
        _bufA[o] = M[0] * wx + M[4] * wy + M[8] * wz + M[12];
        _bufA[o + 1] = M[1] * wx + M[5] * wy + M[9] * wz + M[13];
        _bufA[o + 2] = M[2] * wx + M[6] * wy + M[10] * wz + M[14];
        _bufA[o + 3] = M[3] * wx + M[7] * wy + M[11] * wz + M[15];
        _bufA[o + 4] = wx; _bufA[o + 5] = wy; _bufA[o + 6] = wz;
        _bufA[o + 7] = lx; _bufA[o + 8] = ly; _bufA[o + 9] = 0; _bufA[o + 10] = 0; _bufA[o + 11] = 1;
      }
      if (sameX || sameY) continue; // collapsed onto the AABB boundary: degenerate
      // Trivial reject (all three outside the same frustum plane / behind the near plane) and trivial accept (all inside
      // the frustum: nothing to clip) - the clipmap has ~27k triangles, most are off screen.
      const c0 = waterOutcode(_bufA, 0), c1 = waterOutcode(_bufA, STRIDE), c2 = waterOutcode(_bufA, 2 * STRIDE);
      if (c0 & c1 & c2) continue;
      if ((c0 | c1 | c2) === 0) { rasterWaterTri(_bufA, 0, STRIDE, 2 * STRIDE, target, ctx, sel, ub); continue; }
      let curBuf = _bufA, curCount = 3, otherBuf = _bufB;
      for (let p = 0; p < 5 && curCount > 0; p++) {
        const outCount = clipAgainstPlane(curBuf, curCount, otherBuf, p);
        const tmp = curBuf; curBuf = otherBuf; otherBuf = tmp;
        curCount = outCount;
      }
      if (curCount < 3) continue;
      for (let k = 1; k < curCount - 1; k++) rasterWaterTri(curBuf, 0, k * STRIDE, (k + 1) * STRIDE, target, ctx, sel, ub);
    }
  }
}

/**
 * One clipped fan triangle of the water layer: the same window/edge/top-left/depth rules as `rasterFanTri`, then the
 * water fragment stage (35.3): region shape test (discard), occluder `vD >= sceneDepth[cell]` (discard), `back` bit from
 * the winding. Channels: depth = vD, nrm = up (oct), z = h (0, flat), objectId = slot | back << 4 | sheet << 5, kind = 1.
 * `target.writes` (if present) counts COVERAGE (before any discard / depth test): the "every pixel exactly once" fixture.
 */
function rasterWaterTri(buf, o0, o1, o2, target, ctx, sel, ub) {
  const w0 = buf[o0 + 3], w1 = buf[o1 + 3], w2 = buf[o2 + 3];
  const W = target.W, H = target.H;
  const X0 = (W / 2) * (buf[o0] / w0) + W / 2, Y0 = (H / 2) * (buf[o0 + 1] / w0) + H / 2, zn0 = buf[o0 + 2] / w0, iw0 = 1 / w0;
  const X1 = (W / 2) * (buf[o1] / w1) + W / 2, Y1 = (H / 2) * (buf[o1 + 1] / w1) + H / 2;
  const X2 = (W / 2) * (buf[o2] / w2) + W / 2, Y2 = (H / 2) * (buf[o2 + 1] / w2) + H / 2;
  let zn1 = buf[o1 + 2] / w1, iw1 = 1 / w1, zn2 = buf[o2 + 2] / w2, iw2 = 1 / w2;
  const lx0 = buf[o0 + 7], ly0 = buf[o0 + 8];
  let lx1 = buf[o1 + 7], ly1 = buf[o1 + 8], lx2 = buf[o2 + 7], ly2 = buf[o2 + 8];

  let Xs0, Ys0, Xs1, Ys1, Xs2, Ys2;
  if (ctx.snap === false) {
    Xs0 = X0 * SUBPIX; Ys0 = Y0 * SUBPIX; Xs1 = X1 * SUBPIX; Ys1 = Y1 * SUBPIX; Xs2 = X2 * SUBPIX; Ys2 = Y2 * SUBPIX;
  } else {
    Xs0 = Math.round(X0 * SUBPIX); Ys0 = Math.round(Y0 * SUBPIX);
    Xs1 = Math.round(X1 * SUBPIX); Ys1 = Math.round(Y1 * SUBPIX);
    Xs2 = Math.round(X2 * SUBPIX); Ys2 = Math.round(Y2 * SUBPIX);
  }
  let A2 = (Xs1 - Xs0) * (Ys2 - Ys0) - (Ys1 - Ys0) * (Xs2 - Xs0);
  if (A2 === 0) return;
  const back = A2 < 0 ? 1 : 0; // the clipmap is CCW from above: A2 > 0 = seen from above
  if (A2 < 0) {
    let t;
    t = Xs1; Xs1 = Xs2; Xs2 = t; t = Ys1; Ys1 = Ys2; Ys2 = t;
    t = zn1; zn1 = zn2; zn2 = t; t = iw1; iw1 = iw2; iw2 = t;
    t = lx1; lx1 = lx2; lx2 = t; t = ly1; ly1 = ly2; ly2 = t;
    A2 = -A2;
  }
  const topLeft01 = (Ys1 === Ys0 && Xs1 > Xs0) || Ys1 < Ys0;
  const topLeft12 = (Ys2 === Ys1 && Xs2 > Xs1) || Ys2 < Ys1;
  const topLeft20 = (Ys0 === Ys2 && Xs0 > Xs2) || Ys0 < Ys2;
  const minX = Math.min(Xs0, Xs1, Xs2), maxX = Math.max(Xs0, Xs1, Xs2);
  const minY = Math.min(Ys0, Ys1, Ys2), maxY = Math.max(Ys0, Ys1, Ys2);
  const pxMin = Math.max(0, Math.ceil((minX - 128) / 256));
  const pxMax = Math.min(W - 1, Math.floor((maxX - 128) / 256));
  const pyMin = Math.max(0, Math.ceil((minY - 128) / 256));
  const pyMax = Math.min(H - 1, Math.floor((maxY - 128) / 256));
  if (pxMin > pxMax || pyMin > pyMax) return;

  const sceneDepth = ctx.sceneDepth;
  const wr = target.writes;
  const tagBase = sel.u[ub + U_SLOT] | (back << 4);
  const isCircle = sel.u[ub + U_KIND] === 1, sA = sel.u[ub + U_SHAPE], sB = sel.u[ub + U_SHAPE + 1], sC = sel.u[ub + U_SHAPE + 2], sD = sel.u[ub + U_SHAPE + 3];
  for (let py = pyMin; py <= pyMax; py++) {
    const Py = py * 256 + 128;
    const rowBase = py * W;
    for (let px = pxMin; px <= pxMax; px++) {
      const Px = px * 256 + 128;
      const e12 = (Xs2 - Xs1) * (Py - Ys1) - (Ys2 - Ys1) * (Px - Xs1);
      const e20 = (Xs0 - Xs2) * (Py - Ys2) - (Ys0 - Ys2) * (Px - Xs2);
      const e01 = (Xs1 - Xs0) * (Py - Ys0) - (Ys1 - Ys0) * (Px - Xs0);
      const in12 = e12 > 0 || (e12 === 0 && topLeft12);
      const in20 = e20 > 0 || (e20 === 0 && topLeft20);
      const in01 = e01 > 0 || (e01 === 0 && topLeft01);
      if (!(in12 && in20 && in01)) continue;
      const idx = rowBase + px;
      if (wr) wr[idx]++;
      const l0 = e12 / A2, l1 = e20 / A2, l2 = e01 / A2;
      const zn = l0 * zn0 + l1 * zn1 + l2 * zn2;
      if (zn > 1 || !(zn < target.zbuf[idx])) continue;
      const q = l0 * iw0 + l1 * iw1 + l2 * iw2;
      const invq = 1 / q; // = vD, the perpendicular camera distance (GPU: 1 / gl_FragCoord.w)
      const lx = (l0 * lx0 * iw0 + l1 * lx1 * iw1 + l2 * lx2 * iw2) * invq;
      const ly = (l0 * ly0 * iw0 + l1 * ly1 * iw1 + l2 * ly2 * iw2) * invq;
      if (isCircle) { // = waterInsideJS (waterMesh.js), inlined
        const dx = lx - sA, dy = ly - sB;
        if (dx * dx + dy * dy > sC) continue;
      } else if (!(lx >= sA && lx < sC && ly >= sB && ly < sD)) continue;
      if (sceneDepth && !(invq < sceneDepth[idx])) continue; // occluder: the scene is nearer (or equal)
      target.kind[idx] = 1;
      target.depth[idx] = invq;
      target.nrm[idx] = WATER_NRM_UP;
      target.z[idx] = 0;
      target.objectId[idx] = tagBase;
      target.zbuf[idx] = zn;
    }
  }
}

// ---------------------------------------------------------------------------
// GBuffer copy (n === 1 only - ME-04 reads the sub-sample target directly)
// ---------------------------------------------------------------------------
const ALIAS_KEY = '__meshAoU32';
/** Same bit-alias trick as `voxelMarch.js`'s `getAoAlias` (15.1 item 4): cached per GBuffer identity, not per frame. */
function getAoAlias(gbuf) {
  let alias = gbuf[ALIAS_KEY];
  if (!alias || alias.buffer !== gbuf.aoD.buffer) {
    alias = new Uint32Array(gbuf.aoD.buffer, gbuf.aoD.byteOffset, gbuf.aoD.length);
    Object.defineProperty(gbuf, ALIAS_KEY, { value: alias, enumerable: false, configurable: true, writable: true });
  }
  return alias;
}

/**
 * Copies a `n === 1` `RasterTarget` into an existing `GBuffer` (+ a plain
 * view-depth array, e.g. `fb.depth.depth`). Kind-0 pixels are left untouched
 * (the caller ran `beginFrame` already). Face 7 (`FACE_PACKED`) stores the
 * packed normal bits where `aoD` would go (CPU v2 convention, matches
 * `voxelMarch.js`'s `getAoAlias`) since today's GBuffer has no normal field.
 * @param {RasterTarget} target
 * @param {import('../render/GBuffer.js').GBuffer} gbuf
 * @param {Float32Array} [depthArr]
 */
export function copyToGBuffer(target, gbuf, depthArr) {
  if (target.n !== 1) throw new Error(`copyToGBuffer: n === 1 only (got n=${target.n})`);
  const size = target.W * target.H;
  let alias = null;
  for (let i = 0; i < size; i++) {
    const kind = target.kind[i];
    if (kind === 0) continue;
    const face = target.face[i];
    const aoD = face === FACE_PACKED ? 0 : target.aoD[i];
    gbuf.writeSample(i, kind, target.mat[i], face, target.planeId[i], target.u[i], target.v[i], target.z[i], aoD);
    if (face === FACE_PACKED) {
      if (!alias) alias = getAoAlias(gbuf);
      alias[i] = target.nrm[i];
    }
    if (depthArr) depthArr[i] = target.depth[i];
  }
}
