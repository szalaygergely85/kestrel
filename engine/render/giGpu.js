// GI-PROBE-05 (arch 38.72 item 6): GPU twin of giProbe.sampleGIBuf. Pure (no GPU, no design import): the storage-buffer layout
// the light/shade passes read (packGIField / packGIMix) and GI_SAMPLE_WGSL, generated from the same constants as the JS twin.
// Parity contract: sample positions snap to GI_SNAP steps per probe cell (0.5 m at cellM 8) BEFORE the trilinear, bytes are decoded
// exactly like decodeGIChannel (bias + byte/255*scale), no hardware filtering. No memo cache on the GPU (the JS cache is a pure speed-up).
import { GI_CHANNELS, GI_SUN0, GI_EMIS0, GI_NORMAL_OFFSET, GI_SNAP, GI_Y0, GI_Y1 } from './giProbe.js';

export const GI_HDR_WORDS = 32;
/** Header word indices (u32 words; f32 ones bitcast). Layers <= 4. */
export const GIH = { W: 0, H: 1, L: 2, X0: 3, Y0: 4, CELL: 5, DZ: 6, K0: 10, K1: 11, KF: 12, EMISK: 13, SKYFLOOR: 14, SKY: 15, SUN: 18, OSCALE: 21, OBIAS: 22, OBASE: 23, OVALID: 24, ODATA: 25, ON: 26 };
const PROBE_WORDS = GI_CHANNELS / 4; // 22

/** Total u32 words of a packed field. */
export function giBufferWords(f) {
  const n = f.w * f.h * f.layers;
  return GI_HDR_WORDS + 2 * GI_CHANNELS + f.w * f.h + ((n + 3) >> 2) + n * PROBE_WORDS;
}

/** Write the per-look-step mix state into a header (u32 view; f32 view shares its buffer). 0 alloc. */
export function packGIMix(st, hdrU32, hdrF32) {
  hdrU32[GIH.K0] = st.k0; hdrU32[GIH.K1] = st.k1; hdrF32[GIH.KF] = st.kf; hdrF32[GIH.EMISK] = st.emisK; hdrF32[GIH.SKYFLOOR] = st.skyFloor;
  for (let i = 0; i < 3; i++) { hdrF32[GIH.SKY + i] = st.skyRGB[i]; hdrF32[GIH.SUN + i] = st.sunRGB[i]; }
  hdrU32[GIH.ON] = st.on && st.field ? 1 : 0;
}

/** Full pack of field + mix state -> Uint32Array (only on a field change; allocates). */
export function packGIField(f, st) {
  if (f.layers > 4) throw new Error('packGIField: layers <= 4');
  const n = f.w * f.h * f.layers, words = new Uint32Array(giBufferWords(f)), fl = new Float32Array(words.buffer);
  const oScale = GI_HDR_WORDS, oBias = oScale + GI_CHANNELS, oBase = oBias + GI_CHANNELS, oValid = oBase + f.w * f.h, oData = oValid + ((n + 3) >> 2);
  words[GIH.W] = f.w; words[GIH.H] = f.h; words[GIH.L] = f.layers; fl[GIH.X0] = f.x0; fl[GIH.Y0] = f.y0; fl[GIH.CELL] = f.cellM;
  for (let l = 0; l < f.layers; l++) fl[GIH.DZ + l] = f.layerDz[l];
  words[GIH.OSCALE] = oScale; words[GIH.OBIAS] = oBias; words[GIH.OBASE] = oBase; words[GIH.OVALID] = oValid; words[GIH.ODATA] = oData;
  for (let c = 0; c < GI_CHANNELS; c++) { fl[oScale + c] = f.scale[c]; fl[oBias + c] = f.bias[c]; }
  for (let i = 0; i < f.w * f.h; i++) fl[oBase + i] = f.base[i];
  new Uint8Array(words.buffer, oValid * 4, n).set(f.valid);
  new Uint8Array(words.buffer, oData * 4, n * GI_CHANNELS).set(f.data);
  packGIMix(st, words, fl);
  return words;
}

// WGSL text of one decoded channel: bias + byte/255 * scale (same operation order as giProbe.giCoef). `o` = the probe's first data word.
const dec = (o, c) => `(bitcast<f32>(uGIB[oBias + (${c})]) + f32((uGIB[${o} + ((${c}) >> 2u)] >> (((${c}) & 3u) * 8u)) & 255u) / 255.0 * bitcast<f32>(uGIB[oScale + (${c})]))`;
const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const shLine = (q0, q) => `max(acc[${q0 + q}] * ${f(GI_Y0)} + acc[${q0 + q + 1}] * b1 + acc[${q0 + q + 2}] * b2 + acc[${q0 + q + 3}] * b3, 0.0)`;

/** `giSample(px, py, pz, nx, ny, nz) -> vec3f`: ARGS IN giProbe AXES (y = up): the light pass passes (P.x, P.z, P.y, N.x, N.z, N.y). Needs `uGIB`. */
export const GI_SAMPLE_WGSL = `
fn giSample(px: f32, py: f32, pz: f32, nx: f32, ny: f32, nz: f32) -> vec3f {
  let sky = vec3f(bitcast<f32>(uGIB[${GIH.SKY}u]), bitcast<f32>(uGIB[${GIH.SKY + 1}u]), bitcast<f32>(uGIB[${GIH.SKY + 2}u]));
  if (uGIB[${GIH.ON}u] == 0u) { return sky; }
  let w = i32(uGIB[${GIH.W}u]); let h = i32(uGIB[${GIH.H}u]); let L = i32(uGIB[${GIH.L}u]);
  let x0 = bitcast<f32>(uGIB[${GIH.X0}u]); let y0 = bitcast<f32>(uGIB[${GIH.Y0}u]); let cellM = bitcast<f32>(uGIB[${GIH.CELL}u]);
  let oScale = uGIB[${GIH.OSCALE}u]; let oBias = uGIB[${GIH.OBIAS}u]; let oBase = uGIB[${GIH.OBASE}u]; let oValid = uGIB[${GIH.OVALID}u]; let oData = uGIB[${GIH.ODATA}u];
  let x = px + nx * ${f(GI_NORMAL_OFFSET)}; let y = py + ny * ${f(GI_NORMAL_OFFSET)}; let z = pz + nz * ${f(GI_NORMAL_OFFSET)};
  let sn = ${f(GI_SNAP)} / cellM;
  let sx = (floor(x * sn) + 0.5) / sn; let sy = (floor(y * sn) + 0.5) / sn; let sz = (floor(z * sn) + 0.5) / sn;
  let inv = 1.0 / cellM;
  let gx = clamp((sx - x0) * inv - 0.5, 0.0, f32(w - 1)); let gz = clamp((sz - y0) * inv - 0.5, 0.0, f32(h - 1));
  let ix = min(i32(gx), max(0, w - 2)); let iz = min(i32(gz), max(0, h - 2));
  let fx = gx - f32(ix); let fz = gz - f32(iz);
  let ix1 = min(ix + 1, w - 1); let iz1 = min(iz + 1, h - 1);
  var ci: array<i32, 4>; var cw: array<f32, 4>; var cl0: array<i32, 4>; var cl1: array<i32, 4>; var cfy: array<f32, 4>;
  ci[0] = iz * w + ix; ci[1] = iz * w + ix1; ci[2] = iz1 * w + ix; ci[3] = iz1 * w + ix1;
  cw[0] = (1.0 - fx) * (1.0 - fz); cw[1] = fx * (1.0 - fz); cw[2] = (1.0 - fx) * fz; cw[3] = fx * fz;
  for (var j = 0; j < 4; j++) {                      // per column: layer pair + blend (layers follow the terrain)
    let q = sy - bitcast<f32>(uGIB[oBase + u32(ci[j])]);
    if (q <= bitcast<f32>(uGIB[${GIH.DZ}u])) { cl0[j] = 0; cl1[j] = 0; cfy[j] = 0.0; continue; }
    var l = 0;
    while (l < L - 1 && q > bitcast<f32>(uGIB[${GIH.DZ}u + u32(l + 1)])) { l++; }
    if (l >= L - 1) { cl0[j] = L - 1; cl1[j] = L - 1; cfy[j] = 0.0; continue; }
    let da = bitcast<f32>(uGIB[${GIH.DZ}u + u32(l)]); let db = bitcast<f32>(uGIB[${GIH.DZ}u + u32(l + 1)]);
    cl0[j] = l; cl1[j] = l + 1; cfy[j] = (q - da) / (db - da);
  }
  var acc: array<f32, 28>;
  var wsum = 0.0;
  let k0 = ${GI_SUN0}u + uGIB[${GIH.K0}u] * 12u; let k1 = ${GI_SUN0}u + uGIB[${GIH.K1}u] * 12u; let kf = bitcast<f32>(uGIB[${GIH.KF}u]);
  for (var j = 0; j < 4; j++) {
    for (var s = 0; s < 2; s++) {
      var l = cl0[j]; var wt = cw[j] * (1.0 - cfy[j]);
      if (s == 1) { l = cl1[j]; wt = cw[j] * cfy[j]; }
      if (wt <= 0.0) { continue; }
      let p = u32(l * w * h + ci[j]);
      if (((uGIB[oValid + (p >> 2u)] >> ((p & 3u) * 8u)) & 255u) == 0u) { continue; }
      wsum += wt;
      let o = oData + p * ${PROBE_WORDS}u;
      for (var c = 0u; c < 4u; c++) { acc[c] += wt * ${dec('o', 'c')}; }
      for (var c = 0u; c < 12u; c++) {
        let a = ${dec('o', 'k0 + c')}; let b = ${dec('o', 'k1 + c')};
        acc[4u + c] += wt * (a + (b - a) * kf);
        acc[16u + c] += wt * ${dec('o', `${GI_EMIS0}u + c`)};
      }
    }
  }
  if (wsum <= 0.000000001) { return sky; }
  let r = 1.0 / wsum;
  for (var i = 0; i < 28; i++) { acc[i] = acc[i] * r; }
  let b1 = ${f(GI_Y1)} * ny; let b2 = ${f(GI_Y1)} * nz; let b3 = ${f(GI_Y1)} * nx;
  let vis = max(acc[0] * ${f(GI_Y0)} + acc[1] * b1 + acc[2] * b2 + acc[3] * b3, bitcast<f32>(uGIB[${GIH.SKYFLOOR}u]));
  let emk = bitcast<f32>(uGIB[${GIH.EMISK}u]);
  let sunC = vec3f(bitcast<f32>(uGIB[${GIH.SUN}u]), bitcast<f32>(uGIB[${GIH.SUN + 1}u]), bitcast<f32>(uGIB[${GIH.SUN + 2}u]));
  return vec3f(
    sky.x * vis + ${shLine(4, 0)} * sunC.x + ${shLine(16, 0)} * emk,
    sky.y * vis + ${shLine(4, 4)} * sunC.y + ${shLine(16, 4)} * emk,
    sky.z * vis + ${shLine(4, 8)} * sunC.z + ${shLine(16, 8)} * emk);
}

// Terrain/carpet ambient scale (twin: terrainShade.js giTerrainK): GI ambient / flat sky colour. a, b = GA.x / GA.y, hz = GA.z, N = unpacked normal.
fn giTerrK(a: f32, b: f32, hz: f32, N: vec3f) -> f32 {
  let g = giSample(a, hz, b, N.x, N.z, N.y);
  return (g.x + g.y + g.z) / max(0.000001, bitcast<f32>(uGIB[${GIH.SKY}u]) + bitcast<f32>(uGIB[${GIH.SKY + 1}u]) + bitcast<f32>(uGIB[${GIH.SKY + 2}u]));
}
`;

/** WGSL declaration of the storage buffer at `binding` (light: 8, shade: 16 = after its 16 textures). */
export const giBindingWgsl = (binding) => `@group(0) @binding(${binding}) var<storage, read> uGIB: array<u32>; // GI-PROBE-05: packed probe field (giGpu.js layout)`;
