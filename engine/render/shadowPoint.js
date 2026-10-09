// engine/render/shadowPoint.js (ME-16a, note 38.22): pure JS twin of the point-light shadow maps.
// World is Z-up. One light = 6 faces (layer = slot*6 + face, order +X,-X,+Y,-Y,+Z,-Z), each a proper rotation (det +1)
// x perspective 90 deg, near PSH_NEAR, far = light radius. Stored depth = 0.5 + 0.5 * NDC depth (GL NDC [-1,1]), i.e. [0, 1] (near 0, far 1)
// (the sun map stores [0.5,1]; point maps use the full range). Layout of the depth array: ((slot*6+face)*res + ty)*res + tx, ty up = +v.
// Matrices are column-major Float64 (world -> clip, w = depth along the face axis). No allocation in any per-call function.

export const PSH_NEAR = 0.05;
export const POINT_SHADOW_DEFAULTS = Object.freeze({ n: 2, res: 256, faceCap: 6, near: PSH_NEAR, biasM: 0.04, normalOffTexels: 1.5, hysteresis: 1.25, originQ: 64 });
const LEVELS = { low: [2, 128, 6], medium: [2, 256, 6], high: [4, 256, 12], ultra: [6, 256, 12] };

/** Resolve options (cold path, allocates). `user` = {n,res,faceCap,biasM,normalOffTexels} overrides; user.n === 0 = off. */
export function resolvePointShadowOptions(user, level) {
  const lv = LEVELS[level] || LEVELS.medium, o = { ...POINT_SHADOW_DEFAULTS, n: lv[0], res: lv[1], faceCap: lv[2] };
  if (user) for (const k of Object.keys(POINT_SHADOW_DEFAULTS)) if (user[k] !== undefined && Number.isFinite(+user[k])) o[k] = +user[k];
  o.n = Math.max(0, Math.min(6, o.n | 0)); o.res = Math.max(16, o.res | 0); o.faceCap = Math.max(1, o.faceCap | 0);
  return o;
}

// Per face: forward f, right r, up u (rows of the view rotation; r x u = f, so det +1).
export const FACE_TABLE = Object.freeze([
  Object.freeze({ name: '+X', f: [1, 0, 0], r: [0, 1, 0], u: [0, 0, 1] }),
  Object.freeze({ name: '-X', f: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0] }),
  Object.freeze({ name: '+Y', f: [0, 1, 0], r: [0, 0, 1], u: [1, 0, 0] }),
  Object.freeze({ name: '-Y', f: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] }),
  Object.freeze({ name: '+Z', f: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] }),
  Object.freeze({ name: '-Z', f: [0, 0, -1], r: [0, 1, 0], u: [1, 0, 0] }),
]);
// flat copies (9 floats per face: r, u, f) for allocation-free access
const FT = new Float64Array(54);
for (let i = 0; i < 6; i++) { const t = FACE_TABLE[i]; FT.set(t.r, i * 9); FT.set(t.u, i * 9 + 3); FT.set(t.f, i * 9 + 6); }

/** Face of direction v (largest |component|; ties -> X before Y before Z; a zero component counts as positive). */
export function pointFaceOf(vx, vy, vz) {
  const ax = Math.abs(vx), ay = Math.abs(vy), az = Math.abs(vz);
  if (ax >= ay && ax >= az) return vx >= 0 ? 0 : 1;
  if (ay >= az) return vy >= 0 ? 2 : 3;
  return vz >= 0 ? 4 : 5;
}

/** Light-origin quantisation (1/originQ m): flicker jitter never re-renders. */
export function quantiseOrigin(x, q = 64) { return Math.floor(x * q + 0.5) / q; }

/** World -> clip matrix of face `face` for a light at O (array-like 3), column-major into out16. */
export function pointFaceMatrix(O, far, face, out16, near = PSH_NEAR) {
  const b = face * 9, rx = FT[b], ry = FT[b + 1], rz = FT[b + 2], ux = FT[b + 3], uy = FT[b + 4], uz = FT[b + 5], fx = FT[b + 6], fy = FT[b + 7], fz = FT[b + 8];
  const ox = O[0], oy = O[1], oz = O[2], A = (far + near) / (far - near), B = -2 * far * near / (far - near);
  // clip x = r.(p-O), y = u.(p-O), z = A*f.(p-O) + B, w = f.(p-O)
  out16[0] = rx; out16[4] = ry; out16[8] = rz; out16[12] = -(rx * ox + ry * oy + rz * oz);
  out16[1] = ux; out16[5] = uy; out16[9] = uz; out16[13] = -(ux * ox + uy * oy + uz * oz);
  const fo = fx * ox + fy * oy + fz * oz;
  out16[2] = A * fx; out16[6] = A * fy; out16[10] = A * fz; out16[14] = -A * fo + B;
  out16[3] = fx; out16[7] = fy; out16[11] = fz; out16[15] = -fo;
  return out16;
}

/** 6 frustum planes (nx,ny,nz,d; inside = n.p + d >= 0): left,right,bottom,top,near,far -> out24. For classifyAABB culling. */
export function pointFacePlanes(O, far, face, out24, near = PSH_NEAR) {
  const b = face * 9, ox = O[0], oy = O[1], oz = O[2];
  const fo = FT[b + 6] * ox + FT[b + 7] * oy + FT[b + 8] * oz;
  for (let k = 0; k < 6; k++) {
    let nx, ny, nz, d;
    if (k < 4) { // c + a >= 0 (left), c - a >= 0 (right), c + b, c - b
      const s = (k & 1) ? -1 : 1, o = k < 2 ? 0 : 3;
      nx = FT[b + o] * s + FT[b + 6]; ny = FT[b + o + 1] * s + FT[b + 7]; nz = FT[b + o + 2] * s + FT[b + 8];
      d = -(nx * ox + ny * oy + nz * oz);
    } else if (k === 4) { nx = FT[b + 6]; ny = FT[b + 7]; nz = FT[b + 8]; d = -fo - near; }
    else { nx = -FT[b + 6]; ny = -FT[b + 7]; nz = -FT[b + 8]; d = fo + far; }
    const o = k * 4; out24[o] = nx; out24[o + 1] = ny; out24[o + 2] = nz; out24[o + 3] = d;
  }
  return out24;
}

/** Conservative world AABB (minx,miny,minz,maxx,maxy,maxz) of one face frustum (apex + 4 far corners). */
export function pointFaceBounds(O, far, face, out6) {
  const b = face * 9;
  let mnx = O[0], mny = O[1], mnz = O[2], mxx = mnx, mxy = mny, mxz = mnz;
  for (let c = 0; c < 4; c++) {
    const sr = (c & 1) ? 1 : -1, su = (c & 2) ? 1 : -1;
    const x = O[0] + far * (FT[b + 6] + sr * FT[b] + su * FT[b + 3]), y = O[1] + far * (FT[b + 7] + sr * FT[b + 1] + su * FT[b + 4]), z = O[2] + far * (FT[b + 8] + sr * FT[b + 2] + su * FT[b + 5]);
    if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  out6[0] = mnx; out6[1] = mny; out6[2] = mnz; out6[3] = mxx; out6[4] = mxy; out6[5] = mxz;
  return out6;
}

/** AABB of the whole light sphere (the caster-list box of the note): origin +- radius. */
export function pointSphereBounds(O, radius, out6) {
  out6[0] = O[0] - radius; out6[1] = O[1] - radius; out6[2] = O[2] - radius; out6[3] = O[0] + radius; out6[4] = O[1] + radius; out6[5] = O[2] + radius;
  return out6;
}

/** Stored depth for a point at depth c along the face axis: 0.5 + 0.5 * NDC depth. */
export function pointDepthEncode(c, far, near = PSH_NEAR) {
  return 0.5 + 0.5 * ((far + near) / (far - near) - 2 * far * near / ((far - near) * c));
}
/** Inverse: stored depth -> metres along the face axis. */
export function pointDepthDecode(sdm, far, near = PSH_NEAR) {
  return 2 * far * near / ((far + near) - (far - near) * (2 * sdm - 1));
}

export const pointShadowInfo = { boundary: 0 }; // taps whose receiver depth is within BOUNDARY_EPS of the stored depth (gpucompare excludes them)
const BOUNDARY_EPS = 1e-6;

/**
 * Lit tap count 0..4 (integer; vis = n * 0.25) of receiver P (normal N) for shadow slot `slot` of a light at O.
 * 2x2 taps at floor(uv*res - 0.5) clamped to the face (no cross-face taps). Receiver beyond far / inside near -> 4.
 * P' = P + N * normalOffTexels * (2*ma/res) + dirToLight * biasM, where ma = major-axis distance (texel world size ~ 2*ma/res).
 * WGSL (16d) mirrors this op order.
 */
export function pointShadowTaps(depthF32, res, slot, O, far, P, N, opts = POINT_SHADOW_DEFAULTS) {
  let vx = P[0] - O[0], vy = P[1] - O[1], vz = P[2] - O[2];
  const ma = Math.max(Math.abs(vx), Math.abs(vy), Math.abs(vz));
  const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const no = opts.normalOffTexels * (2 * ma / res), bm = opts.biasM, il = len > 0 ? 1 / len : 0;
  vx += N[0] * no - vx * il * bm; vy += N[1] * no - vy * il * bm; vz += N[2] * no - vz * il * bm; // toward the light = -v/|v|
  const face = pointFaceOf(vx, vy, vz), b = face * 9;
  const a = vx * FT[b] + vy * FT[b + 1] + vz * FT[b + 2], bb = vx * FT[b + 3] + vy * FT[b + 4] + vz * FT[b + 5], c = vx * FT[b + 6] + vy * FT[b + 7] + vz * FT[b + 8];
  const near = opts.near === undefined ? PSH_NEAR : opts.near;
  if (c >= far || c <= near) return 4;
  const rd = Math.fround(0.5 + 0.5 * ((far + near) / (far - near) - 2 * far * near / ((far - near) * c)));
  const fu = (a / c * 0.5 + 0.5) * res - 0.5, fv = (bb / c * 0.5 + 0.5) * res - 0.5;
  const x0 = Math.floor(fu), y0 = Math.floor(fv), last = res - 1, base = (slot * 6 + face) * res * res;
  let lit = 0;
  for (let k = 0; k < 4; k++) {
    let x = x0 + (k & 1), y = y0 + (k >> 1);
    x = x < 0 ? 0 : x > last ? last : x; y = y < 0 ? 0 : y > last ? last : y;
    const sd = depthF32[base + y * res + x], dd = rd - sd;
    if (rd <= sd) lit++;
    if (dd < BOUNDARY_EPS && dd > -BOUNDARY_EPS) pointShadowInfo.boundary++;
  }
  return lit;
}

/** Texel centre -> world point on face at depth c (inverse of the face lookup); for round-trip tests. */
export function pointFaceTexelToWorld(O, face, res, tx, ty, c, out3) {
  const b = face * 9, a = ((tx + 0.5) / res * 2 - 1) * c, bb = ((ty + 0.5) / res * 2 - 1) * c;
  out3[0] = O[0] + a * FT[b] + bb * FT[b + 3] + c * FT[b + 6];
  out3[1] = O[1] + a * FT[b + 1] + bb * FT[b + 4] + c * FT[b + 7];
  out3[2] = O[2] + a * FT[b + 2] + bb * FT[b + 5] + c * FT[b + 8];
  return out3;
}

// ---- light ranking ----
const MAX_L = 64;
const _score = new Float64Array(MAX_L);
/** Preallocated ranking state: slots[i] = light handle or -1, slotScore[i]. */
export function createShadowLightState(maxN = 8) { return { slots: new Int32Array(maxN).fill(-1), slotScore: new Float64Array(maxN), count: 0 }; }

/**
 * Pick the top-n lights for shadow slots with stable slots. lights = LightSet-like {count,on,pos(x,y,z,r *4),col(rgb*4),defX/Y/Z, entity?:Uint8Array}.
 * cam = {x,y,z, planes?: Float64Array(24) (inside n.p+d>=0)}. score = intensity * radius / max(1, dist(eye, origin)), entity x2.
 * A holder is replaced only when a challenger scores > hysteresis x the weakest holder. Returns number of occupied slots.
 */
export function selectShadowLights(lights, cam, n, state, hysteresis = 1.25) {
  const cnt = Math.min(lights.count, MAX_L), slots = state.slots, sc = state.slotScore;
  for (let i = 0; i < cnt; i++) {
    _score[i] = -1;
    if (!lights.on[i]) continue;
    const r = lights.pos[i * 4 + 3], x = lights.defX[i], y = lights.defY[i], z = lights.defZ[i];
    if (!(r > 0)) continue;
    if (cam.planes) {
      let out = false; const p = cam.planes;
      for (let k = 0; k < 6; k++) if (p[k * 4] * x + p[k * 4 + 1] * y + p[k * 4 + 2] * z + p[k * 4 + 3] < -r) { out = true; break; }
      if (out) continue;
    }
    const inten = Math.max(lights.col[i * 4], lights.col[i * 4 + 1], lights.col[i * 4 + 2]);
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    _score[i] = inten * r / Math.max(1, d) * (lights.entity && lights.entity[i] ? 2 : 1);
  }
  for (let s = 0; s < n; s++) { // refresh / drop holders
    const h = slots[s];
    if (h >= cnt || (h >= 0 && _score[h] <= 0)) slots[s] = -1;
    else if (h >= 0) sc[s] = _score[h];
  }
  for (let s = n; s < slots.length; s++) slots[s] = -1;
  for (;;) { // best non-held challenger vs free slot / weakest holder
    let best = -1, bs = 0;
    for (let i = 0; i < cnt; i++) {
      if (_score[i] <= bs) continue;
      let held = false; for (let s = 0; s < n; s++) if (slots[s] === i) { held = true; break; }
      if (!held) { best = i; bs = _score[i]; }
    }
    if (best < 0) break;
    let free = -1, weak = -1, ws = Infinity;
    for (let s = 0; s < n; s++) { if (slots[s] < 0) { free = s; break; } if (sc[s] < ws) { ws = sc[s]; weak = s; } }
    if (free >= 0) { slots[free] = best; sc[free] = bs; continue; }
    if (weak >= 0 && bs > hysteresis * ws) { slots[weak] = best; sc[weak] = bs; continue; }
    break;
  }
  let occ = 0; for (let s = 0; s < n; s++) if (slots[s] >= 0) occ++;
  state.count = occ;
  return occ;
}

// ---- update policy ----
/**
 * Dirty key of one slot (2 Int32 lanes). Changes only on: light origin (quantised 1/q m), radius, structVersion,
 * caster content (casterH0/1 = the two lanes of shadowInputHash over the slot's caster list; includes caster moves), windKey
 * (pass 0 unless the list holds a swaying group: sway quantum). Flicker jitter / colour / intensity never change it.
 */
export function pointShadowKey(out2, ox, oy, oz, radius, casterH0, casterH1, structVersion, windKey, q = 64) {
  _o4[0] = ox; _o4[1] = oy; _o4[2] = oz; _o4[3] = radius;
  return pointShadowKeyO(out2, _o4, casterH0, casterH1, structVersion, windKey, q);
}
const _o4 = new Float64Array(4);
/** Same key, origin + radius read from `o4` (xyz, radius): no boxed-double call arguments, so the per-frame key is allocation-free. */
export function pointShadowKeyO(out2, o4, casterH0, casterH1, structVersion, windKey, q = 64) {
  const ox = o4[0], oy = o4[1], oz = o4[2], radius = o4[3];
  let h0 = 0x811c9dc5 | 0, h1 = 0x1b873593 | 0;
  const w0 = Math.floor(ox * q + 0.5) | 0, w1 = Math.floor(oy * q + 0.5) | 0, w2 = Math.floor(oz * q + 0.5) | 0, w3 = Math.floor(radius * 16 + 0.5) | 0;
  h0 = Math.imul(h0 ^ w0, 0x01000193); h1 = Math.imul(h1 ^ w0, 0x85ebca6b);
  h0 = Math.imul(h0 ^ w1, 0x01000193); h1 = Math.imul(h1 ^ w1, 0x85ebca6b);
  h0 = Math.imul(h0 ^ w2, 0x01000193); h1 = Math.imul(h1 ^ w2, 0x85ebca6b);
  h0 = Math.imul(h0 ^ w3, 0x01000193); h1 = Math.imul(h1 ^ w3, 0x85ebca6b);
  h0 = Math.imul(h0 ^ casterH0, 0x01000193); h1 = Math.imul(h1 ^ casterH1, 0x85ebca6b);
  h0 = Math.imul(h0 ^ (structVersion | 0), 0x01000193); h1 = Math.imul(h1 ^ (windKey | 0), 0x85ebca6b);
  out2[0] = h0 ^ (h0 >>> 15); out2[1] = h1 ^ (h1 >>> 13);
  return out2;
}
