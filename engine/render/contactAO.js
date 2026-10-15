// engine/render/contactAO.js (CONTACT-AO-01a, architecture.md 38.78): analytic blob "contact" ambient occlusion.
// Pure module, zero alloc after createContactAO(). The WGSL port (01b) mirrors contactAOAt/contactAOQ exactly.
//
// Blob record (8 floats, `data[i*8..]`): cx, cy, zBase, rx, ry, h, k, 0 (z is up; footprint = axis-aligned ellipse).
//   occl_i = k * (1 - smoothstep(0.6, 1.6, dE)) * (1 - smoothstep(0, 0.5*h, Pz - zBase)) * (0.5 + 0.5*max(Nz, 0))
//   ao = 1 - max_i occl_i      (max, not product: order-free, never double dark)
// LIGHT.w bits 1..7 (CAO_SHIFT) hold the OCCLUSION byte d = round(occl * 127) (0 = no occlusion, so a zeroed
// buffer is "off" and n = 0 is byte-identical to today). ao = (127 - d) / 127.
export const CAO_SHIFT = 1, CAO_MAX = 32, CAO_STRIDE = 8;
export const CAO_RADIUS_M = 24; // default list radius (opts.radius)

/** @returns {{n:number, data:Float32Array, version:number, dyn:Float32Array, dynN:number}} */
export function createContactAO() {
  return {
    n: 0, data: new Float32Array(CAO_MAX * CAO_STRIDE), version: 0,
    dyn: new Float32Array(CAO_MAX * CAO_STRIDE), dynId: new Int32Array(CAO_MAX), dynN: 0,
    // build scratch (fixed, never reallocated)
    cur: new Float64Array(1), box: new Float32Array(CAO_MAX * 4), gbox: new Float32Array(4), tmp: new Float32Array(CAO_STRIDE), sc: new Float32Array(CAO_MAX * CAO_STRIDE), scD: new Float64Array(CAO_MAX), scId: new Int32Array(CAO_MAX), scN: 0,
  };
}

/**
 * Dynamic blobs (player, beasts in view), copied into fixed storage: `list` = { count, x[], y[], zBase[], rx[], ry[], h[], k[], id[] }
 * (parallel arrays, so the caller allocates nothing per frame). Anything past CAO_MAX is ignored.
 */
export function setDynamicBlobs(cao, list) {
  const n = list && list.count > 0 ? Math.min(list.count | 0, CAO_MAX) : 0;
  for (let i = 0; i < n; i++) {
    const o = i * CAO_STRIDE;
    cao.dyn[o] = list.x[i]; cao.dyn[o + 1] = list.y[i]; cao.dyn[o + 2] = list.zBase[i]; cao.dyn[o + 3] = list.rx[i];
    cao.dyn[o + 4] = list.ry[i]; cao.dyn[o + 5] = list.h[i]; cao.dyn[o + 6] = list.k[i]; cao.dyn[o + 7] = 0;
    cao.dynId[i] = list.id ? list.id[i] | 0 : i;
  }
  cao.dynN = n;
}

// Offer one candidate to the sorted top-CAO_MAX scratch list (insertion sort on (dist, id), stable, in place).
function offer(cao, src, so, id) {
  const dist = cao.cur[0]; // passed via scratch: a double argument would be boxed per call
  const sc = cao.sc, scD = cao.scD, scId = cao.scId;
  let n = cao.scN;
  let p = n; // insertion position: after every entry that sorts <= the new one
  while (p > 0 && (scD[p - 1] > dist || (scD[p - 1] === dist && scId[p - 1] > id))) p--;
  if (p >= CAO_MAX) return; // worse than all kept entries and the list is full
  if (n < CAO_MAX) n++;
  for (let j = n - 1; j > p; j--) { // shift tail right (drops the last when full)
    scD[j] = scD[j - 1]; scId[j] = scId[j - 1];
    const a = j * CAO_STRIDE, b = (j - 1) * CAO_STRIDE;
    for (let q = 0; q < CAO_STRIDE; q++) sc[a + q] = sc[b + q];
  }
  scD[p] = dist; scId[p] = id;
  const a = p * CAO_STRIDE;
  sc[a] = src[so]; sc[a + 1] = src[so + 1]; sc[a + 2] = src[so + 2]; sc[a + 3] = src[so + 3];
  sc[a + 4] = src[so + 4]; sc[a + 5] = src[so + 5]; sc[a + 6] = src[so + 6]; sc[a + 7] = 0;
  cao.scN = n;
}

/**
 * Rebuild the blob list once per frame: statics (`staticSrc` = { count, x[], y[], zBase[], rx[], ry[], h[], k[], id[] },
 * e.g. an adapter over the placement grid; may be null) within `opts.radius` (default 24 m) of the camera, plus the dynamics
 * from setDynamicBlobs. Sorted by (distance, id), capped at CAO_MAX. `version` bumps only when the list content changed.
 */
export function buildContactBlobs(cao, cam, staticSrc, opts) {
  const R = opts && opts.radius > 0 ? opts.radius : CAO_RADIUS_M, R2 = R * R;
  const cx = cam.x, cy = cam.y;
  cao.scN = 0;
  for (let i = 0; i < cao.dynN; i++) {
    const o = i * CAO_STRIDE, dx = cao.dyn[o] - cx, dy = cao.dyn[o + 1] - cy;
    cao.cur[0] = dx * dx + dy * dy; offer(cao, cao.dyn, o, cao.dynId[i]); // dynamics are not radius-culled (player is under the camera)
  }
  if (staticSrc) {
    const sx = staticSrc.x, sy = staticSrc.y, sz = staticSrc.zBase, srx = staticSrc.rx, sry = staticSrc.ry, sh = staticSrc.h, sk = staticSrc.k, sid = staticSrc.id;
    const cnt = staticSrc.count | 0;
    for (let i = 0; i < cnt; i++) {
      const dx = sx[i] - cx, dy = sy[i] - cy, d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      if (cao.scN >= CAO_MAX && d2 > cao.scD[CAO_MAX - 1]) continue; // cheap reject once full
      const t = cao.tmp;
      t[0] = sx[i]; t[1] = sy[i]; t[2] = sz[i]; t[3] = srx[i]; t[4] = sry[i]; t[5] = sh[i]; t[6] = sk[i]; t[7] = 0;
      cao.cur[0] = d2; offer(cao, t, 0, sid ? sid[i] | 0 : i);
    }
  }
  // changed? (n or any float differs) -> copy + bump version
  let changed = cao.n !== cao.scN;
  const m = cao.scN * CAO_STRIDE;
  if (!changed) for (let i = 0; i < m; i++) if (cao.data[i] !== cao.sc[i]) { changed = true; break; }
  if (changed) { for (let i = 0; i < m; i++) cao.data[i] = cao.sc[i];
    cao.n = cao.scN; cao.version++;
    const g = cao.gbox; g[0] = g[2] = Infinity; g[1] = g[3] = -Infinity;
    for (let i = 0; i < cao.n; i++) { // CPU-only reach box (1.6 ellipse radii) for the cheap per-point reject; not part of the UBO
      const o = i * CAO_STRIDE, b = i * 4, rx = 1.6 * cao.data[o + 3], ry = 1.6 * cao.data[o + 4];
      cao.box[b] = cao.data[o] - rx; cao.box[b + 1] = cao.data[o] + rx; cao.box[b + 2] = cao.data[o + 1] - ry; cao.box[b + 3] = cao.data[o + 1] + ry;
      if (cao.box[b] < g[0]) g[0] = cao.box[b]; if (cao.box[b + 1] > g[1]) g[1] = cao.box[b + 1];
      if (cao.box[b + 2] < g[2]) g[2] = cao.box[b + 2]; if (cao.box[b + 3] > g[3]) g[3] = cao.box[b + 3];
    } }
}

function smooth(a, b, x) {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/** Occlusion 0..1 at world point P with surface normal z-component Nz (max over blobs). */
export function contactOcclAt(cao, Px, Py, Pz, Nz) {
  const n = cao.n, d = cao.data;
  const nf = 0.5 + 0.5 * (Nz > 0 ? Nz : 0);
  let occl = 0;
  const box = cao.box, gb = cao.gbox;
  if (n === 0 || Px < gb[0] || Px > gb[1] || Py < gb[2] || Py > gb[3]) return 0;
  for (let i = 0; i < n; i++) {
    const b = i * 4;
    if (Px < box[b] || Px > box[b + 1] || Py < box[b + 2] || Py > box[b + 3]) continue;
    const o = i * CAO_STRIDE;
    const ex = (Px - d[o]) / d[o + 3], ey = (Py - d[o + 1]) / d[o + 4];
    const e2 = ex * ex + ey * ey;
    if (e2 >= 2.56) continue; // dE >= 1.6 (sqrt only for blobs that reach this point)
    const dE = Math.sqrt(e2);
    const h = d[o + 5];
    const v = h > 0 ? 1 - smooth(0, 0.5 * h, Pz - d[o + 2]) : 0;
    const w = d[o + 6] * (1 - smooth(0.6, 1.6, dE)) * v * nf;
    if (w > occl) occl = w;
  }
  return occl;
}

/** ao = 1 - occlusion, 0..1 (1 = unoccluded). */
export function contactAOAt(cao, Px, Py, Pz, Nz) { return 1 - contactOcclAt(cao, Px, Py, Pz, Nz); }

/** LIGHT.w-ready 7-bit occlusion byte (already shifted by CAO_SHIFT in `caoBits`). */
export function contactAOQ(cao, Px, Py, Pz, Nz) { return Math.round(contactOcclAt(cao, Px, Py, Pz, Nz) * 127); }
export function caoBits(q) { return q << CAO_SHIFT; }
/** Ambient multiplier from the stored occlusion byte (exactly 1 at 0). */
export function caoFactor(q) { return q === 0 ? 1 : (127 - q) / 127; }

// WGSL twin (CONTACT-AO-01b): shared by light.wgsl.js (spliced into LIGHT_WGSL / LIGHT_GI_WGSL, reads the LightU fields
// `u.caoA.x` = n and `u.caoD[i*2], [i*2+1]` = the 8-float blob record as two vec4) and by the Node parity test, which
// translates this exact text to JS (scalar-only syntax on purpose). Returns the occlusion byte q = round(occl * 127);
// caller: LIGHT.w |= q << CAO_SHIFT, non-terrain cells L -= ambient * (f32(q) / 127); shade ambient *= caoFactor(q).
// The abs() pre-reject equals the JS box reject (1.6 radii), so results are identical, only cheaper.
export const CONTACT_AO_WGSL = /* wgsl */`
fn caoSmooth(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn contactOcclQ(px: f32, py: f32, pz: f32, nz: f32) -> u32 {
  let nf = 0.5 + 0.5 * max(nz, 0.0);
  var occl = 0.0;
  let n = u32(u.caoA.x);
  for (var i = 0u; i < n; i = i + 1u) {
    let b0 = u.caoD[i * 2u]; let b1 = u.caoD[i * 2u + 1u];
    let ex = (px - b0.x) / b0.w; let ey = (py - b0.y) / b1.x;
    if (abs(ex) >= 1.6 || abs(ey) >= 1.6) { continue; }
    let dE = sqrt(ex * ex + ey * ey);
    let v = select(0.0, 1.0 - caoSmooth(0.0, 0.5 * b1.y, pz - b0.z), b1.y > 0.0);
    occl = max(occl, b1.z * (1.0 - caoSmooth(0.6, 1.6, dE)) * v * nf);
  }
  return u32(floor(occl * 127.0 + 0.5));
}`;
