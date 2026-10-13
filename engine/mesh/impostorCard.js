// engine/mesh/impostorCard.js - R6b (architecture.md 38.60): tree card-impostor rules, the JS twin (oracle) of the R6c WGSL.
// Pure helpers; the card raster itself is `rasterCards` in rasterJS.js (needs its triangle machinery). No GPU, no game/ imports.
//
// ===== RULES THE WGSL TWIN (R6c) MUST MIRROR EXACTLY =====
// Opt-in: group.imp = {bytes, radius, vMin, vMax} (impostorBake.js) AND group.impM > 0 AND an eye. Otherwise nothing below runs
// and the frame is byte-identical to before R6b.
// 1. DISTANCE d = 3D distance eye -> instance translation (words 3/7/11), f64 in JS / f32 in WGSL (compare with impM, impM + 8).
//    d >  maxDistM            : dropped (existing OB-089 cut, runs first).
//    d <  impM                : mesh only (existing LOD0/LOD1 pick).
//    impM <= d < impM + 8     : BAND. f = (d - impM) / 8; cov = min(floor((1 - f) * 256), 256)  (lodDitherBits(1 - f, lod)).
//                               mesh copy flags |= ACTIVE | cov << 16            (kept where ditherHash(x,y) & 255 <  cov)
//                               card copy flags |= ACTIVE | cov << 16 | INVERT   (kept where ditherHash(x,y) & 255 >= cov)
//                               -> every raster cell is covered by exactly one of mesh/card (x,y = raster sample coords, lodDither.js).
//                               The impostor band replaces the LOD-hysteresis dither of the same instance (no double dither).
//    d >= impM + 8            : card only (the mesh copy is NOT emitted).
// 2. VIEW PICK. h = normalize(tree.xy - eye.xy); beta = atan2(-h.x, h.y) (bearing from +y, CCW; h = Rz(beta)(0,1));
//    yaw = atan2(inst.m10, inst.m00) (word 4 / word 0); view = floor((beta - yaw) / (pi/4) + 0.5) mod 8 (non-negative mod).
//    Bake frame of view v: mesh rotated by -v*45 deg about z, camera looks along +y', u = x', v = z*cos(8deg) + y'*sin(8deg).
// 3. CARD GEOMETRY (cylindrical billboard, tilted plane through the instance origin), s = hypot(m00, m10) (instance scale):
//    r = (h.y, -h.x, 0); up = (h.x*SE, h.y*SE, CE); dir = (h.x*CE, h.y*CE, -SE)  (CE/SE = cos/sin 8 deg)
//    world(u, v, o) = origin + s * (u*r + v*up + o*dir), u in [-radius, radius], v in [vMin, vMax], o = depth offset (metres, unscaled).
//    The quad (o = 0) is the card plane: 2 triangles, corners (-R,vMax) (R,vMax) (R,vMin) (-R,vMin).
// 4. MIP. cardPx = |screen(corner1) - screen(corner0)| in raster sample px (W = cols*n); mip = cardPx >= 32 ? 0 : cardPx >= 16 ? 1 : 2.
// 5. TEXEL. N = 32 >> mip; tx = clamp(floor((u + R) / (2R) * N), 0, N-1); ty = clamp(floor((vMax - v) / (vMax - vMin) * N), 0, N-1);
//    byte offset = impMipOffset(view, mip) + (ty*N + tx) * 8. coverage byte [5] == 0 -> discard (no write, zbuf untouched).
// 6. DEPTH. q = int8 byte [4]; o = q / 127 * radius; P' = P + s * o * dir; zn = clip.z(P') / clip.w(P'); depth = clip.w(P')
//    (perspective); the depth test uses zn; written depth = clip.w(P'). world z field = plane z (P, not P').
// 7. NORMAL. view-local oct (bytes 2,3 high + 6,7 low, decodeImpNormal) rotated about z by theta = view*pi/4 + yaw
//    (n' = (nx*c - ny*s, nx*s + ny*c, nz)); face = the mesh rule (max|n| >= 0.9 ? axis face : packed); packed with packNormalOct.
// 8. CELL WRITE = a plain KIND_MESH cell: kind 9, mat = byte [0], objectId = instance objectId, planeId = 0, vao = 1, aoD = Infinity.
//    depthTier 1 (same as instanced meshes). Cards never cast shadows (the shadow pass ignores cardIb).
// 9. No allocation per frame: all scratch is module-level.
import { impMipOffset, decodeImpNormal, IMP_ELEV_DEG, IMP_VIEWS } from './impostorBake.js';
import { lodDitherBits, lodBandFrac } from './lodDither.js';

export const IMP_BAND_M = 8;
const ELEV = IMP_ELEV_DEG * Math.PI / 180;
export const IMP_CE = Math.cos(ELEV), IMP_SE = Math.sin(ELEV);
const QUARTER_PI = Math.PI / 4;

/** View index 0..7 for a camera at (ex, ey) looking at a tree at (tx, ty) with instance yaw (rad). Rule 2. */
export function impViewPick(ex, ey, tx, ty, yaw) {
  const hx = tx - ex, hy = ty - ey;
  const beta = Math.atan2(-hx, hy);
  const v = Math.floor((beta - yaw) / QUARTER_PI + 0.5);
  return ((v % IMP_VIEWS) + IMP_VIEWS) % IMP_VIEWS;
}

/** Rule 1 band: flags-word bits of the mesh copy (lod 0) / card copy (lod 1) at distance d, or 0 outside the band. */
export function impBandBits(d, impM, lod) {
  if (d < impM || d >= impM + IMP_BAND_M) return 0;
  return lodDitherBits(1 - lodBandFrac(d, impM, impM + IMP_BAND_M), lod);
}

/** Rule 4. */
export function impMipPick(cardPx) { return cardPx >= 32 ? 0 : cardPx >= 16 ? 1 : 2; }

/** Rule 5: byte offset of the texel for card coords (u, v), or -1 when out of the card. */
export function impTexelOffset(imp, view, mip, u, v) {
  const N = 32 >> mip, R = imp.radius;
  let tx = Math.floor((u + R) / (2 * R) * N), ty = Math.floor((imp.vMax - v) / (imp.vMax - imp.vMin) * N);
  if (tx < 0) tx = 0; else if (tx > N - 1) tx = N - 1;
  if (ty < 0) ty = 0; else if (ty > N - 1) ty = N - 1;
  return impMipOffset(view, mip) + (ty * N + tx) * 8;
}

const _n = new Float64Array(3);
let _rView = NaN, _rYaw = NaN, _rC = 1, _rS = 0;
/**
 * Rules 6 + 7 for one texel. out = {covered, mat, o, nx, ny, nz}: o = depth offset in metres (unscaled), (nx,ny,nz) = WORLD normal.
 * @returns {boolean} covered
 */
export function impDecodeTexel(imp, view, mip, u, v, yaw, out) {
  const o = impTexelOffset(imp, view, mip, u, v), b = imp.bytes;
  if (b[o + 5] === 0) return false;
  out.mat = b[o];
  const q = b[o + 4] > 127 ? b[o + 4] - 256 : b[o + 4];
  out.o = q / 127 * imp.radius;
  decodeImpNormal(b, o, _n);
  if (view !== _rView || yaw !== _rYaw) { const th = view * QUARTER_PI + yaw; _rView = view; _rYaw = yaw; _rC = Math.cos(th); _rS = Math.sin(th); } // once per card (view/yaw constant across its fragments)
  const c = _rC, s = _rS;
  out.nx = _n[0] * c - _n[1] * s; out.ny = _n[0] * s + _n[1] * c; out.nz = _n[2];
  return true;
}

/** Group opt-in: allocates the engine-owned card bucket (called once by the host). */
export function enableGroupImpostor(g, imp, impM, createBuffer) {
  g.imp = imp; g.impM = impM; g.cardIb = createBuffer(g.ib.capacity); g.cardCount = 0;
}
