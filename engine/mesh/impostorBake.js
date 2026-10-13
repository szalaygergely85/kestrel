// engine/mesh/impostorBake.js - R6a (architecture.md 38.60): deterministic tree card-impostor atlas bake.
// Pure JS twin, no GPU, no game/ imports. Runs at load. HOOK NEEDED (R6d): the OB-109 loading-bar pre-bake
// step must call bakeImpostor once per species (cache by mesh id; never per frame; skip + log if over budget).
//
// Source: a static MeshData (pos, nrm = packNormalOct mesh-local, flat; 3 verts per triangle, non-indexed),
// normally LOD1 of the species. Uses its own tiny z-buffer triangle fill (the full mesh raster needs a
// DrawList/ctx and writes cell G-buffers; the bake only needs a private 32x32 ortho target).
//
// Views: 8 yaws (view v = v*45 deg). The mesh is rotated by -yaw about z; the ortho camera looks along +y'
// tilted ELEV_DEG down: u = x', v = z*cos(e) + y'*sin(e), depth = y'*cos(e) - z*sin(e)
// (card plane = depth 0 through the instance origin). u spans [-radius, radius], v spans [vMin, vMax].
//
// TEXEL = 8 bytes:
//   0 mat      u8   mesh mat slot (matKeys index or resolved id, must be < 256)
//   1 face     u8   flat face bits (0-15)
//   2 nx hi    u8   octahedral normal x, view-local (rotated by -yaw), 16-bit q = floor((o*0.5+0.5)*65535+0.5), high byte
//   3 ny hi    u8   octahedral normal y, high byte
//   4 depth    i8   depth / radius * 127, clamped: offset from the card plane (renderer rotates the normal back to world)
//   5 coverage u8   0 = empty, 255 = covered
//   6 nx lo / 7 ny lo  u8  low bytes of the 16-bit oct normal (the spec's 2 B pad: 8-bit oct only reaches ~0.014 error, AC needs <= 1/127)
// Layout: view-major; per view mip0 32x32, mip1 16x16, mip2 8x8 (row-major, row 0 = top). Mips: 2x2 majority
// coverage (>= 2 covered), nearest-depth pick, no filtering. 8*(1024+256+64)*8 = 86016 B per species.
import { unpackNormalOct } from '../voxel/octNormal.js';

export const IMP_VIEWS = 8;
export const IMP_SIZE = 32;
export const IMP_TEXEL = 8;
export const IMP_ELEV_DEG = 8;
export const IMP_BUDGET_BYTES = 2 * 1024 * 1024;
export const IMP_BYTES = IMP_VIEWS * (1024 + 256 + 64) * IMP_TEXEL;

/** Byte offset of the (view, mip) block; mip 0/1/2 = 32/16/8 px. */
export function impMipOffset(view, mip) {
  const per = (1024 + 256 + 64) * IMP_TEXEL;
  return view * per + (mip === 0 ? 0 : mip === 1 ? 1024 * IMP_TEXEL : (1024 + 256) * IMP_TEXEL);
}

const ELEV = IMP_ELEV_DEG * Math.PI / 180;
const CE = Math.cos(ELEV), SE = Math.sin(ELEV);

// Scratch (allocated once).
const zbuf = new Float32Array(IMP_SIZE * IMP_SIZE);
const nrmTmp = new Float64Array(3);

function quantOct(nx, ny, nz) {
  const s = Math.abs(nx) + Math.abs(ny) + Math.abs(nz);
  let x = nx / s, y = ny / s;
  if (nz < 0) {
    const ax = Math.abs(x), ay = Math.abs(y);
    const sx = x >= 0 ? 1 : -1, sy = y >= 0 ? 1 : -1;
    x = (1 - ay) * sx; y = (1 - ax) * sy;
  }
  let qx = Math.floor((x * 0.5 + 0.5) * 65535 + 0.5);
  let qy = Math.floor((y * 0.5 + 0.5) * 65535 + 0.5);
  if (qx < 0) qx = 0; else if (qx > 65535) qx = 65535;
  if (qy < 0) qy = 0; else if (qy > 65535) qy = 65535;
  return (qx | (qy << 16)) >>> 0;
}

/** Decodes a texel's oct normal (bytes at o+2, o+3 high; o+6, o+7 low) into out[0..2] (view-local unit normal). */
export function decodeImpNormal(bytes, o, out) {
  unpackNormalOct(((bytes[o + 2] << 8 | bytes[o + 6]) | ((bytes[o + 3] << 8 | bytes[o + 7]) << 16)) >>> 0, out);
}

/**
 * @param {import('./MeshData.js').MeshData} mesh static layout, non-indexed
 * @returns {{views:number,size:number,bytes:Uint8Array,radius:number,height:number,vMin:number,vMax:number}}
 */
export function bakeImpostor(mesh) {
  const pos = mesh.pos, nrm = mesh.nrm, flat = mesh.flat, tris = mesh.triCount;
  let r2 = 0, zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < tris * 3; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const d = x * x + y * y; if (d > r2) r2 = d;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const radius = Math.max(Math.sqrt(r2), 1e-3);
  const vMin = zMin * CE - radius * SE, vMax = zMax * CE + radius * SE;
  const bytes = new Uint8Array(IMP_BYTES);
  const S = IMP_SIZE;
  const uScale = S / (2 * radius), vScale = S / (vMax - vMin);
  for (let view = 0; view < IMP_VIEWS; view++) {
    const a = view * Math.PI / 4;
    const ca = Math.cos(a), sa = Math.sin(a);
    const base = impMipOffset(view, 0);
    zbuf.fill(Infinity);
    for (let t = 0; t < tris; t++) {
      const i0 = t * 3;
      let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) {
        const o = (i0 + k) * 3;
        const x = pos[o], y = pos[o + 1], z = pos[o + 2];
        const xr = x * ca + y * sa, yr = -x * sa + y * ca;
        const px = (xr + radius) * uScale;
        const py = (vMax - (z * CE + yr * SE)) * vScale;
        const dp = yr * CE - z * SE;
        if (k === 0) { ax = px; ay = py; az = dp; } else if (k === 1) { bx = px; by = py; bz = dp; } else { cx = px; cy = py; cz = dp; }
      }
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (area === 0) continue;
      const inv = 1 / area;
      let x0 = Math.floor(Math.min(ax, bx, cx)), x1 = Math.ceil(Math.max(ax, bx, cx));
      let y0 = Math.floor(Math.min(ay, by, cy)), y1 = Math.ceil(Math.max(ay, by, cy));
      if (x0 < 0) x0 = 0;
      if (y0 < 0) y0 = 0;
      if (x1 > S) x1 = S;
      if (y1 > S) y1 = S;
      // Flat attributes from the first vertex; mesh-local normal rotated into the view frame.
      const f1 = flat[i0 * 2 + 1];
      unpackNormalOct(nrm[i0], nrmTmp);
      const nx = nrmTmp[0] * ca + nrmTmp[1] * sa, ny = -nrmTmp[0] * sa + nrmTmp[1] * ca, nz = nrmTmp[2];
      const oct = quantOct(nx, ny, nz);
      const mat = (f1 >>> 16) & 0xff, face = (f1 >>> 8) & 0xf;
      for (let py = y0; py < y1; py++) {
        const qy = py + 0.5;
        for (let px = x0; px < x1; px++) {
          const qx = px + 0.5;
          const w1 = ((qx - ax) * (cy - ay) - (cx - ax) * (qy - ay)) * inv;
          const w2 = ((bx - ax) * (qy - ay) - (qx - ax) * (by - ay)) * inv;
          const w0 = 1 - w1 - w2;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const d = w0 * az + w1 * bz + w2 * cz;
          const zi = py * S + px;
          if (d >= zbuf[zi]) continue;
          zbuf[zi] = d;
          let q = Math.floor(d / radius * 127 + 0.5);
          if (q < -127) q = -127; else if (q > 127) q = 127;
          const o = base + zi * IMP_TEXEL;
          bytes[o] = mat; bytes[o + 1] = face; bytes[o + 2] = (oct >>> 8) & 255; bytes[o + 3] = oct >>> 24; bytes[o + 6] = oct & 255; bytes[o + 7] = (oct >>> 16) & 255;
          bytes[o + 4] = q & 255; bytes[o + 5] = 255;
        }
      }
    }
    // Mips: 2x2 majority coverage, nearest covered texel.
    for (let mip = 1; mip < 3; mip++) {
      const dstN = S >> mip, srcN = dstN * 2;
      const src = impMipOffset(view, mip - 1), dst = impMipOffset(view, mip);
      for (let y = 0; y < dstN; y++) for (let x = 0; x < dstN; x++) {
        let cnt = 0, best = -1, bestD = 128;
        for (let k = 0; k < 4; k++) {
          const so = src + ((y * 2 + (k >> 1)) * srcN + x * 2 + (k & 1)) * IMP_TEXEL;
          if (bytes[so + 5] === 0) continue;
          cnt++;
          const dd = (bytes[so + 4] << 24) >> 24;
          if (dd < bestD) { bestD = dd; best = so; }
        }
        if (cnt >= 2) bytes.copyWithin(dst + (y * dstN + x) * IMP_TEXEL, best, best + IMP_TEXEL);
      }
    }
  }
  return { views: IMP_VIEWS, size: S, bytes, radius, height: vMax - vMin, vMin, vMax };
}
