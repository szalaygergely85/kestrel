// GI-PROBE-01 (arch 38.72): baked bounce-light probe field. Pure data + maths, no GPU, no design import.
// The WGSL twin (GI-PROBE-05) must decode bytes and weigh probes exactly like sampleGI (no hardware filtering).
// Probe layout (88 channels, uint8 each, value = bias[c] + byte/255 * scale[c]):
//   0..3 sky (mono SH L1) | 4..75 sun[k=0..5] x 12 (R,G,B x 4 SH) | 76..87 emissive (R,G,B x 4 SH)
export const GI_CHANNELS = 88, GI_NKEYS = 6, GI_SKY0 = 0, GI_SUN0 = 4, GI_EMIS0 = 76;
export const GI_KEY_HOURS = [6, 9, 12, 15, 18, 20];
export const GI_NORMAL_OFFSET = 0.5;           // m along N before sampling (light-leak guard)
const Y0 = 0.282095, Y1 = 0.488603;            // L1 SH basis constants: [Y0, Y1*y, Y1*z, Y1*x]

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
    emisK: 1, skyFloor: 0.15, version: 0 };
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
  const f = st.field;
  if (!f) { out[0] = st.skyRGB[0]; out[1] = st.skyRGB[1]; out[2] = st.skyRGB[2]; return false; }
  x += nx * GI_NORMAL_OFFSET; y += ny * GI_NORMAL_OFFSET; z += nz * GI_NORMAL_OFFSET;   // world: x,z horizontal, y up
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
  if (wsum <= 1e-9) { out[0] = st.skyRGB[0]; out[1] = st.skyRGB[1]; out[2] = st.skyRGB[2]; return false; }
  const r = 1 / wsum, b1 = Y1 * ny, b2 = Y1 * nz, b3 = Y1 * nx;
  let vis = (acc[0] * Y0 + acc[1] * b1 + acc[2] * b2 + acc[3] * b3) * r; if (vis < st.skyFloor) vis = st.skyFloor;
  for (let c = 0; c < 3; c++) {
    const q = c * 4;
    let sun = (acc[4 + q] * Y0 + acc[5 + q] * b1 + acc[6 + q] * b2 + acc[7 + q] * b3) * r; if (sun < 0) sun = 0;
    let em = (acc[16 + q] * Y0 + acc[17 + q] * b1 + acc[18 + q] * b2 + acc[19 + q] * b3) * r; if (em < 0) em = 0;
    out[c] = st.skyRGB[c] * vis + sun * st.sunRGB[c] + em * st.emisK;
  }
  return true;
}
