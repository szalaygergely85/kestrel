// engine/world/giBake.js - GI-PROBE-02a (architecture.md 38.72 section 3). Pure, sliced, deterministic probe bake.
// Per probe: 64 fixed Fibonacci-sphere rays (no RNG). Miss -> sky visibility; hit -> one bounce of the sun
// (per hour key) and of static emissive lights, both x albedo(hit). L1 SH, stored PRE-CONVOLVED so that
// value(n) = c0 + c1*n.y + c2*n.z + c3*n.x  (cosine-weighted irradiance / pi; open sky up = 1).
// Raw output is plain Float32 arrays; `encodeRaw` encodes through giProbe.js `encodeGIField`.
//
// world interface (World satisfies it): raySegmentRay(seg:Float64Array(6), out:{t,x,y,z}) -> bool, and
// groundAt(x,y). Surface at a hit (albedo + normal) comes from cfg.surfaceAt(x,y,z,out{nx,ny,nz,albedo}) or
// the default: terrain-gradient normal from groundAt + cfg.albedo.

import { encodeGIField, GI_CHANNELS, GI_SKY0, GI_SUN0, GI_EMIS0 } from '../render/giProbe.js';

export const GI_DIRS = 64;
export const GI_KEY_HOURS = Float32Array.of(6, 9, 12, 15, 18, 20);
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Fixed Fibonacci sphere, N x 3 (x,y,z; z up). */
export function fibonacciDirs(n = GI_DIRS) {
  const d = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - z * z), a = i * GOLDEN;
    d[i * 3] = r * Math.cos(a); d[i * 3 + 1] = r * Math.sin(a); d[i * 3 + 2] = z;
  }
  return d;
}

/** Default data sun path: east at 06 h, high at 12 h, west at 20 h (unit vector TOWARD the sun, z up). */
export function defaultSunDir(hour, out) {
  const u = Math.min(1, Math.max(0, (hour - 6) / 14));
  const el = Math.max(0.08, Math.sin(Math.PI * u) * 1.2), az = Math.PI * (1 - u); // 1.2 rad = 69 deg max
  out[0] = Math.cos(el) * Math.cos(az); out[1] = Math.cos(el) * Math.sin(az); out[2] = Math.sin(el);
  return out;
}

/** Add a radiance sample (rgb) from world direction (w0 = x, w1 = y, w2 = z) into 3x4 SH accumulators at acc[off..]. */
function accum(acc, off, w0, w1, w2, r, g, b, scale) {
  // mean term 1/N, directional terms 2/N (pre-convolved L1, see header); coeff order c0, y, z, x
  acc[off] += r * scale; acc[off + 1] += r * 2 * scale * w1; acc[off + 2] += r * 2 * scale * w2; acc[off + 3] += r * 2 * scale * w0;
  acc[off + 4] += g * scale; acc[off + 5] += g * 2 * scale * w1; acc[off + 6] += g * 2 * scale * w2; acc[off + 7] += g * 2 * scale * w0;
  acc[off + 8] += b * scale; acc[off + 9] += b * 2 * scale * w1; acc[off + 10] += b * 2 * scale * w2; acc[off + 11] += b * 2 * scale * w0;
}

export class GIBake {
  /**
   * @param {object} world see header
   * @param {object} cfg {x0,y0,w,h (columns), cellM=8, layerDz=[1,4,10], keyHours, sunDir(hour,out)=defaultSunDir,
   *   sunRGB=[1,1,1], lights=[{x,y,z,r,g,b,range}], albedo=[.5,.5,.5], surfaceAt, rayLen=48, dirs=64, now=performance.now}
   */
  constructor(world, cfg) {
    this.world = world;
    this.x0 = cfg.x0; this.y0 = cfg.y0; this.w = cfg.w; this.h = cfg.h;
    this.cellM = cfg.cellM || 8;
    this.layerDz = Float32Array.from(cfg.layerDz || [1, 4, 10]);
    this.layers = this.layerDz.length;
    this.keyHours = Float32Array.from(cfg.keyHours || GI_KEY_HOURS);
    this.nKeys = this.keyHours.length;
    this.sunRGB = cfg.sunRGB || [1, 1, 1];
    this.lights = cfg.lights || [];
    this.albedo = cfg.albedo || [0.5, 0.5, 0.5];
    this.surfaceAt = cfg.surfaceAt || null;
    this.rayLen = cfg.rayLen || 48;
    this.dirs = fibonacciDirs(cfg.dirs || GI_DIRS);
    this.nDirs = this.dirs.length / 3;
    this.now = cfg.now || (() => performance.now());
    const sd = cfg.sunDir || defaultSunDir, tmp = new Float64Array(3);
    this.sun = new Float64Array(this.nKeys * 3);
    for (let k = 0; k < this.nKeys; k++) { sd(this.keyHours[k], tmp); this.sun.set(tmp, k * 3); }
    const cols = this.w * this.h;
    this.total = cols * this.layers;
    this.base = new Float32Array(cols);
    // raw output: sky[p*4]; sun[(p*nKeys+k)*12 + c*4 + m]; emis[p*12 + c*4 + m]
    this.sky = new Float32Array(this.total * 4);
    this.sunSH = new Float32Array(this.total * this.nKeys * 12);
    this.emis = new Float32Array(this.total * 12);
    this.valid = new Uint8Array(this.total);
    this.next = 0;
    this._seg = new Float64Array(6); this._hit = { t: 0, x: 0, y: 0, z: 0 };
    this._surf = { nx: 0, ny: 0, nz: 1, albedo: this.albedo };
    this._acc = new Float64Array(this.nKeys * 12 + 12);
    this._bases = false;
  }

  get done() { return this.next >= this.total; }
  get progress() { return this.total ? this.next / this.total : 1; }

  _initBases() {
    const m = this.cellM;
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const x = this.x0 + i * m, y = this.y0 + j * m;
      let g = Infinity;
      for (let q = 0; q < 5; q++) { // min of the 4 corners + centre = column base
        const v = q < 4 ? this.world.groundAt(x + (q & 1) * m, y + (q >> 1) * m) : this.world.groundAt(x + m / 2, y + m / 2);
        if (v === v && v < g) g = v;
      }
      this.base[j * this.w + i] = g === Infinity ? 0 : g;
    }
    this._bases = true;
  }

  /** Bake whole probes until `budgetMs` has elapsed (overrun <= 1 probe). Returns true when finished. */
  step(budgetMs) {
    if (!this._bases) this._initBases();
    const t0 = this.now();
    while (this.next < this.total) {
      this._probe(this.next++);
      if (this.now() - t0 >= budgetMs) break;
    }
    return this.done;
  }

  _surface(x, y, z, hit) {
    const s = this._surf;
    s.albedo = this.albedo;
    if (hit && hit.hasN && !this.surfaceAt) { s.nx = hit.nx; s.ny = hit.ny; s.nz = hit.nz; return s; }
    if (this.surfaceAt) { this.surfaceAt(x, y, z, s); return s; }
    const w = this.world, e = 0.5;
    const gx = (w.groundAt(x + e, y) - w.groundAt(x - e, y)) / (2 * e), gy = (w.groundAt(x, y + e) - w.groundAt(x, y - e)) / (2 * e);
    const il = 1 / Math.sqrt(gx * gx + gy * gy + 1);
    s.nx = -gx * il || 0; s.ny = -gy * il || 0; s.nz = il;
    return s;
  }

  /** True when the segment p -> p + d*len is unobstructed. */
  _clear(px, py, pz, dx, dy, dz, len) {
    const s = this._seg;
    s[0] = px; s[1] = py; s[2] = pz; s[3] = px + dx * len; s[4] = py + dy * len; s[5] = pz + dz * len;
    return !this._cast(s, this._hit);
  }

  /** Segment cast: World.rayStaticFirst when the world has it (terrain + colliders, hit normal in hit.n*), else raySegmentRay. */
  _cast(seg, hit) {
    const w = this.world;
    if (!w.rayStaticFirst) { hit.hasN = false; return w.raySegmentRay(seg, hit); }
    const io = this._io || (this._io = new Float64Array(12));
    io[0] = seg[0]; io[1] = seg[1]; io[2] = seg[2]; io[3] = seg[3] - seg[0]; io[4] = seg[4] - seg[1]; io[5] = seg[5] - seg[2]; io[6] = 1;
    if (!w.rayStaticFirst(io)) return false;
    hit.t = io[7]; hit.x = seg[0] + io[3] * io[7]; hit.y = seg[1] + io[4] * io[7]; hit.z = seg[2] + io[5] * io[7];
    hit.nx = io[8]; hit.ny = io[9]; hit.nz = io[10]; hit.hasN = true;
    return true;
  }

  _probe(p) {
    const cols = this.w * this.h, layer = (p / cols) | 0, col = p - layer * cols;
    const i = col % this.w, j = (col / this.w) | 0, m = this.cellM;
    const px = this.x0 + i * m + m / 2, py = this.y0 + j * m + m / 2, pz = this.base[col] + this.layerDz[layer];
    const D = this.dirs, N = this.nDirs, nK = this.nKeys, acc = this._acc, seg = this._seg, hit = this._hit;
    acc.fill(0);
    let skyMean = 0, sx = 0, sy = 0, sz = 0, near = 0;
    const sc = 1 / N;
    for (let d = 0; d < N; d++) {
      const dx = D[d * 3], dy = D[d * 3 + 1], dz = D[d * 3 + 2];
      seg[0] = px; seg[1] = py; seg[2] = pz; seg[3] = px + dx * this.rayLen; seg[4] = py + dy * this.rayLen; seg[5] = pz + dz * this.rayLen;
      if (!this._cast(seg, hit)) { // sky
        skyMean += sc; sx += 2 * sc * dy; sy += 2 * sc * dz; sz += 2 * sc * dx; continue;
      }
      const dist = hit.t * this.rayLen;
      if (dist < 0.05) near++;
      const surf = this._surface(hit.x, hit.y, hit.z, hit);
      let nx = surf.nx, ny = surf.ny, nz = surf.nz;
      if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; } // face the probe
      const ox = hit.x + nx * 0.05, oy = hit.y + ny * 0.05, oz = hit.z + nz * 0.05, al = surf.albedo;
      for (let k = 0; k < nK; k++) { // sun per key
        const sdx = this.sun[k * 3], sdy = this.sun[k * 3 + 1], sdz = this.sun[k * 3 + 2];
        const ndl = nx * sdx + ny * sdy + nz * sdz;
        if (ndl <= 0 || !this._clear(ox, oy, oz, sdx, sdy, sdz, this.rayLen)) continue;
        accum(acc, k * 12, dx, dy, dz, al[0] * ndl * this.sunRGB[0], al[1] * ndl * this.sunRGB[1], al[2] * ndl * this.sunRGB[2], sc);
      }
      let er = 0, eg = 0, eb = 0; // static emissive irradiance at the hit
      for (let l = 0; l < this.lights.length; l++) {
        const L = this.lights[l];
        let lx = L.x - ox, ly = L.y - oy, lz = L.z - oz;
        const d2 = lx * lx + ly * ly + lz * lz, rg = L.range;
        if (d2 >= rg * rg) continue;
        const ds = Math.sqrt(d2) || 1e-6; lx /= ds; ly /= ds; lz /= ds;
        const ndl = nx * lx + ny * ly + nz * lz;
        if (ndl <= 0 || !this._clear(ox, oy, oz, lx, ly, lz, ds)) continue;
        const f = ndl * (1 - ds / rg) * (1 - ds / rg);
        er += L.r * f; eg += L.g * f; eb += L.b * f;
      }
      if (er || eg || eb) accum(acc, nK * 12, dx, dy, dz, al[0] * er, al[1] * eg, al[2] * eb, sc);
    }
    if (near > N / 2) { this.valid[p] = 0; return; } // inside solid
    this.valid[p] = 1;
    const sk = p * 4;
    this.sky[sk] = skyMean; this.sky[sk + 1] = sx; this.sky[sk + 2] = sy; this.sky[sk + 3] = sz;
    for (let k = 0; k < nK * 12; k++) this.sunSH[p * nK * 12 + k] = acc[k];
    for (let k = 0; k < 12; k++) this.emis[p * 12 + k] = acc[nK * 12 + k];
  }

  /** Raw field (plain typed arrays + header values). */
  raw() {
    return { x0: this.x0, y0: this.y0, cellM: this.cellM, w: this.w, h: this.h, layers: this.layers, layerDz: this.layerDz,
      base: this.base, keyHours: this.keyHours, nKeys: this.nKeys, sky: this.sky, sun: this.sunSH, emis: this.emis, valid: this.valid };
  }
}

/** Evaluate stored SH (4 floats at arr[off..]) toward unit n (z up). */
export function evalSH(arr, off, nx, ny, nz) { return arr[off] + arr[off + 1] * ny + arr[off + 2] * nz + arr[off + 3] * nx; }

/**
 * Raw floats -> GIField via giProbe.js `encodeGIField` (88 uint8 channels). The bake's pre-convolved SH
 * (value = c0 + c1*n.y + c2*n.z + c3*n.x, z up) is remapped to giProbe's basis (Y0*g0 + Y1*(ny*g1 + nz*g2 + nx*g3), y up):
 * g0 = c0/Y0, g1 (up) = c2/Y1, g2 (world y) = c1/Y1, g3 = c3/Y1, so `sampleGI` reproduces `evalSH`.
 */
const Y0 = 0.282095, Y1 = 0.488603;
function mapSH(dst, o, src, s) { dst[o] = src[s] / Y0; dst[o + 1] = src[s + 2] / Y1; dst[o + 2] = src[s + 1] / Y1; dst[o + 3] = src[s + 3] / Y1; }
export function encodeRaw(raw) {
  const n = raw.w * raw.h * raw.layers, nK = raw.nKeys, probes = new Float32Array(n * GI_CHANNELS);
  for (let p = 0; p < n; p++) {
    const o = p * GI_CHANNELS;
    mapSH(probes, o + GI_SKY0, raw.sky, p * 4);
    for (let k = 0; k < nK; k++) for (let c = 0; c < 3; c++) mapSH(probes, o + GI_SUN0 + k * 12 + c * 4, raw.sun, (p * nK + k) * 12 + c * 4);
    for (let c = 0; c < 3; c++) mapSH(probes, o + GI_EMIS0 + c * 4, raw.emis, p * 12 + c * 4);
  }
  return encodeGIField({ x0: raw.x0, y0: raw.y0, cellM: raw.cellM, w: raw.w, h: raw.h, layers: raw.layers, layerDz: raw.layerDz,
    base: raw.base, keyHours: raw.keyHours, probes, valid: raw.valid });
}

/** Run a whole bake synchronously (tests / tools). */
export function bakeAll(world, cfg, sliceMs = 1000) {
  const b = new GIBake(world, cfg);
  while (!b.step(sliceMs));
  return b;
}
