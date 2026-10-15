// GI-PROBE-01 (arch 38.72): baked bounce-light probe field. Pure data + maths, no GPU, no design import.
// The WGSL twin (GI-PROBE-05) must decode bytes and weigh probes exactly like sampleGI (no hardware filtering).
// Probe layout (88 channels, uint8 each, value = bias[c] + byte/255 * scale[c]):
//   0..3 sky (mono SH L1) | 4..75 sun[k=0..5] x 12 (R,G,B x 4 SH) | 76..87 emissive (R,G,B x 4 SH)
export const GI_CHANNELS = 88, GI_NKEYS = 6, GI_SKY0 = 0, GI_SUN0 = 4, GI_EMIS0 = 76;
export const GI_KEY_HOURS = [6, 9, 12, 15, 18, 20];
export const GI_NORMAL_OFFSET = 0.5;           // m along N before sampling (light-leak guard)
export const GI_Y0 = 0.282095, GI_Y1 = 0.488603; const Y0 = GI_Y0, Y1 = GI_Y1;            // L1 SH basis constants: [Y0, Y1*y, Y1*z, Y1*x]

/**
 * Encode float probes into a GIField. probes = Float32Array(w*h*layers*88) (index ((l*h+row)*w+col)*88+c),
 * valid = Uint8Array(w*h*layers) (1 = usable). Scale/bias per channel from the min/max of valid probes.
 */
export function encodeGIField(o) {
  const { w, h, layers, probes } = o, n = w * h * layers;
  const valid = o.valid || new Uint8Array(n).fill(1);
  const lo = new Float32Array(GI_CHANNELS).fill(Infinity), hi = new Float32Array(GI_CHANNELS).fill(-Infinity);
  for (let p = 0; p < n; p++) if (valid[p]) for (let c = 0; c < GI_CHANNELS; c++) {
    const v = probes[p * GI_CHANNELS + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v;
  }
  const scale = new Float32Array(GI_CHANNELS), bias = new Float32Array(GI_CHANNELS);
  for (let c = 0; c < GI_CHANNELS; c++) {
    if (lo[c] > hi[c]) { lo[c] = 0; hi[c] = 0; }
    bias[c] = lo[c]; scale[c] = hi[c] - lo[c];
  }
  const data = new Uint8Array(n * GI_CHANNELS);
  for (let p = 0; p < n; p++) if (valid[p]) for (let c = 0; c < GI_CHANNELS; c++) {
    const s = scale[c]; data[p * GI_CHANNELS + c] = s > 0 ? Math.round((probes[p * GI_CHANNELS + c] - bias[c]) / s * 255) : 0;
  }
  return {
    x0: o.x0 || 0, y0: o.y0 || 0, cellM: o.cellM || 8, w, h, layers,
    layerDz: Float32Array.from(o.layerDz || [1, 4, 10]), base: o.base || new Float32Array(w * h),
    keyHours: Float32Array.from(o.keyHours || GI_KEY_HOURS), scale, bias, data, valid, volumes: [], version: o.version || 1,
  };
}

/** Decode one channel of one probe back to float. */
export function decodeGIChannel(f, probe, c) { return f.bias[c] + f.data[probe * GI_CHANNELS + c] / 255 * f.scale[c]; }

export function createGIState() {
  return { on: false, field: null, skyRGB: new Float32Array(3), sunRGB: new Float32Array(3), k0: 0, k1: 0, kf: 0,
    emisK: 1, skyFloor: 0.15, version: 0, cache: null };
}

/** Cyclic key lerp: writes st.k0/k1/kf for a clock hour (night: pass hour + 12 for the moon key). */
export function giKeyWeights(st, hour, keyHours) {
  const kh = keyHours || GI_KEY_HOURS, first = kh[0];
  let t = ((hour % 24) + 24) % 24; if (t < first) t += 24;
  let i = GI_NKEYS - 1;                                    // default: last key -> first key (+24), wraps midnight
  for (let k = 0; k < GI_NKEYS - 1; k++) if (t < kh[k + 1]) { i = k; break; }
  const a = kh[i], b = i === GI_NKEYS - 1 ? first + 24 : kh[i + 1];
  st.k0 = i; st.k1 = (i + 1) % GI_NKEYS; st.kf = (t - a) / (b - a);
  return st;
}

/**
 * Mix the per-step state (call only on a look-version bump). sky/sun = live colour x intensity (RGB arrays);
 * cfg: {night, emisK, skyFloor}. night -> keys of the moon direction (hour + 12), `sun` is then the moon colour.
 */
export function mixGIState(st, hour, sky, sun, cfg) {
  const c = cfg || {};
  giKeyWeights(st, c.night ? hour + 12 : hour, st.field ? st.field.keyHours : null);
  for (let i = 0; i < 3; i++) { st.skyRGB[i] = sky[i]; st.sunRGB[i] = sun[i]; }
  if (c.emisK !== undefined) st.emisK = c.emisK;
  if (c.skyFloor !== undefined) st.skyFloor = c.skyFloor;
  st.version++;
  return st;
}

const acc = new Float64Array(28);          // 0..3 sky, 4..15 sun-mix, 16..27 emis (scratch, no per-sample alloc)
const ci = new Int32Array(4), cw = new Float64Array(4), cl0 = new Int32Array(4), cl1 = new Int32Array(4), cfy = new Float64Array(4);

/**
 * Trilinear sample of the field at world (x,y,z) for surface normal (nx,ny,nz) -> out RGB (>= 0):
 *   sky colour * max(skyFloor, skyVis(N)) + sunMix(N) * sun colour + emis(N) * emisK.
 * Invalid probes are skipped and weights renormalised; all invalid / no field -> out = skyRGB (ambient), returns false.
 */
export function sampleGI(st, x, y, z, nx, ny, nz, out) {
  giIo[0] = x; giIo[1] = y; giIo[2] = z; giIo[3] = nx; giIo[4] = ny; giIo[5] = nz;
  return sampleGIBuf(st, giIo, out);
}
const giIo = new Float64Array(6);
/** 0-alloc hot-path variant (GI-PROBE-04): io = Float64Array [x,y,z,nx,ny,nz] (doubles as args would box per call). Axes: y = up. */
export function sampleGIBuf(st, io, out) {
  const f = st.field;
  let x = io[0], y = io[1], z = io[2]; const nx = io[3], ny = io[4], nz = io[5];
  if (!f) { out[0] = st.skyRGB[0]; out[1] = st.skyRGB[1]; out[2] = st.skyRGB[2]; return false; }
  x += nx * GI_NORMAL_OFFSET; y += ny * GI_NORMAL_OFFSET; z += nz * GI_NORMAL_OFFSET;   // world: x,z horizontal, y up
  // PERF (GI-PROBE-04-perf): the trilinear + key-lerp coefficient set (28 floats, normal-independent) is memoised per
  // snapped position (GI_SNAP per probe cell = 0.5 m at cellM 8; GPU twin must snap identically) in a direct-mapped
  // cache that lives on the state and is flushed on version / field change. Only the 4-term SH eval runs per cell.
  const sn = GI_SNAP / f.cellM, qx = Math.floor(x * sn), qy = Math.floor(y * sn), qz = Math.floor(z * sn);
  // PERF (GI-PROBE-04b): per-frame last-result memo (opt-in via giMemoBegin/End, state is constant inside the frame):
  // same snapped position + same normal as the previous call -> identical output, bit for bit.
  const mm = st.memo;
  if (mm !== undefined && mm.on === 1 && mm.q0 === qx && mm.q1 === qy && mm.q2 === qz && mm.n0 === nx && mm.n1 === ny && mm.n2 === nz) {
    out[0] = mm.o0; out[1] = mm.o1; out[2] = mm.o2; return mm.ret === 1;
  }
  const hint = mm !== undefined && mm.on === 1 && mm.q0 === qx && mm.q1 === qy && mm.q2 === qz ? mm.slot : -1; // same cell, other normal: skip the cache lookup
  const ret = sampleGISnapped(st, f, qx, qy, qz, sn, nx, ny, nz, out, hint);
  if (mm !== undefined && mm.on === 1) { mm.slot = gSlot; mm.q0 = qx; mm.q1 = qy; mm.q2 = qz; mm.n0 = nx; mm.n1 = ny; mm.n2 = nz; mm.o0 = out[0]; mm.o1 = out[1]; mm.o2 = out[2]; mm.ret = ret ? 1 : 0; }
  return ret;
}
/** Open / close the per-frame last-result memo of sampleGIBuf (call both around a loop; state must not change in between). */
export function giMemoBegin(st) {
  if (st.memo === undefined) st.memo = { on: 0, slot: 0, q0: 0, q1: 0, q2: 0, n0: 0, n1: 0, n2: 0, o0: 0, o1: 0, o2: 0, ret: 0 };
  st.memo.on = 1; st.memo.q0 = st.memo.q1 = st.memo.q2 = 0x7fffffff; // impossible key: first call misses
}
export function giMemoEnd(st) { if (st.memo !== undefined) st.memo.on = 0; }
let gSlot = 0;
function sampleGISnapped(st, f, qx, qy, qz, sn, nx, ny, nz, out, hint) {
  let c = st.cache;
  if (c === null) c = st.cache = { n: GI_CACHE, keys: new Int32Array(GI_CACHE * 3), stamp: new Int32Array(GI_CACHE), ok: new Uint8Array(GI_CACHE), coef: new Float32Array(GI_CACHE * 28), field: null, ver: -1, gen: 1 };
  if (c.field !== f || c.ver !== st.version) { c.field = f; c.ver = st.version; c.gen++; }
  const slot = hint >= 0 ? hint : (Math.imul(qx, 73856093) ^ Math.imul(qz, 19349663) ^ Math.imul(qy, 83492791)) & (GI_CACHE - 1), k3 = slot * 3, co = slot * 28;
  gSlot = slot;
  if (hint < 0 && (c.stamp[slot] !== c.gen || c.keys[k3] !== qx || c.keys[k3 + 1] !== qy || c.keys[k3 + 2] !== qz)) {
    gp[0] = (qx + 0.5) / sn; gp[1] = (qy + 0.5) / sn; gp[2] = (qz + 0.5) / sn;   // scratch: doubles as args would box per miss
    const ok = giCoef(st, f);
    c.stamp[slot] = c.gen; c.keys[k3] = qx; c.keys[k3 + 1] = qy; c.keys[k3 + 2] = qz; c.ok[slot] = ok ? 1 : 0;
    for (let i = 0; i < 28; i++) c.coef[co + i] = acc[i];
  }
  if (c.ok[slot] === 0) { out[0] = st.skyRGB[0]; out[1] = st.skyRGB[1]; out[2] = st.skyRGB[2]; return false; }
  const cf = c.coef, b1 = Y1 * ny, b2 = Y1 * nz, b3 = Y1 * nx;
  let vis = cf[co] * Y0 + cf[co + 1] * b1 + cf[co + 2] * b2 + cf[co + 3] * b3; if (vis < st.skyFloor) vis = st.skyFloor;
  for (let ch = 0; ch < 3; ch++) {
    const q = ch * 4;
    let sun = cf[co + 4 + q] * Y0 + cf[co + 5 + q] * b1 + cf[co + 6 + q] * b2 + cf[co + 7 + q] * b3; if (sun < 0) sun = 0;
    let em = cf[co + 16 + q] * Y0 + cf[co + 17 + q] * b1 + cf[co + 18 + q] * b2 + cf[co + 19 + q] * b3; if (em < 0) em = 0;
    out[ch] = st.skyRGB[ch] * vis + sun * st.sunRGB[ch] + em * st.emisK;
  }
  return true;
}
export const GI_SNAP = 16, GI_CACHE = 8192;   // snap steps per probe cell; cache slots (power of 2)
/** Fill `acc` (normalised by wsum) with the interpolated sky4 / sun12 / emis12 coefficients at (x,y,z); false = all probes invalid. */
const gp = new Float64Array(3);
function giCoef(st, f) {
  const x = gp[0], y = gp[1], z = gp[2];
  const w = f.w, h = f.h, inv = 1 / f.cellM;
  let gx = (x - f.x0) * inv - 0.5, gz = (z - f.y0) * inv - 0.5;
  if (gx < 0) gx = 0; else if (gx > w - 1) gx = w - 1;
  if (gz < 0) gz = 0; else if (gz > h - 1) gz = h - 1;
  let ix = gx | 0, iz = gz | 0; if (ix > w - 2) ix = Math.max(0, w - 2); if (iz > h - 2) iz = Math.max(0, h - 2);
  const fx = gx - ix, fz = gz - iz, ix1 = Math.min(ix + 1, w - 1), iz1 = Math.min(iz + 1, h - 1);
  ci[0] = iz * w + ix; ci[1] = iz * w + ix1; ci[2] = iz1 * w + ix; ci[3] = iz1 * w + ix1;
  cw[0] = (1 - fx) * (1 - fz); cw[1] = fx * (1 - fz); cw[2] = (1 - fx) * fz; cw[3] = fx * fz;
  const L = f.layers, dz = f.layerDz;
  for (let j = 0; j < 4; j++) {                              // per column: layer pair + blend (layers follow terrain)
    const py = y - f.base[ci[j]]; let l = 0;
    if (py <= dz[0]) { cl0[j] = 0; cl1[j] = 0; cfy[j] = 0; continue; }
    while (l < L - 1 && py > dz[l + 1]) l++;
    if (l >= L - 1) { cl0[j] = L - 1; cl1[j] = L - 1; cfy[j] = 0; continue; }
    cl0[j] = l; cl1[j] = l + 1; cfy[j] = (py - dz[l]) / (dz[l + 1] - dz[l]);
  }
  acc.fill(0);
  const D = f.data, V = f.valid, S = f.scale, B = f.bias, kf = st.kf, k0 = GI_SUN0 + st.k0 * 12, k1 = GI_SUN0 + st.k1 * 12;
  let wsum = 0;
  for (let j = 0; j < 4; j++) for (let s = 0; s < 2; s++) {
    const l = s ? cl1[j] : cl0[j], wt = cw[j] * (s ? cfy[j] : 1 - cfy[j]);
    if (wt <= 0) continue;
    const p = l * w * h + ci[j]; if (!V[p]) continue;
    wsum += wt; const o = p * GI_CHANNELS;
    for (let c = 0; c < 4; c++) acc[c] += wt * (B[c] + D[o + c] / 255 * S[c]);
    for (let c = 0; c < 12; c++) {
      const a = B[k0 + c] + D[o + k0 + c] / 255 * S[k0 + c], b = B[k1 + c] + D[o + k1 + c] / 255 * S[k1 + c];
      acc[4 + c] += wt * (a + (b - a) * kf);
      acc[16 + c] += wt * (B[GI_EMIS0 + c] + D[o + GI_EMIS0 + c] / 255 * S[GI_EMIS0 + c]);
    }
  }
  if (wsum <= 1e-9) return false;
  const r = 1 / wsum; for (let i = 0; i < 28; i++) acc[i] *= r;
  return true;
}
