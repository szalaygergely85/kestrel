// engine/chargen/clip.js (CHARGEN-03, docs/architecture.md 38.29 item 4): sampleClip on the 22-bone master rig.
// Clip (kit JSON): {duration:ms (multiple of 50), loop?:true, keys:[{t:ms, rot?:{Bone:[rx,ry,rz] degrees},
//   pos?:{Hips:[x,y,z] cells}}]} keys sorted by t; a missing bone/axis in a key = 0 (rest). Euler order Rz*Ry*Rx
// (voxelPose.js), linear between keys, converted to a quaternion. Hips pos is returned in metres (cells * cellM).
const TABLE_MS = 5;
const D2R = Math.PI / 360; // degrees -> half-angle radians
let _ka = null, _kb = null; const _f = new Float64Array(2), _e = new Float64Array(3); // [blend factor, clip time]: doubles passed via memory, never boxed // rawPose results (module scratch: no per-call object)
const tables = new WeakMap(); // clip -> {n, q}: sign reference table, one sample per TABLE_MS

/** Euler degrees (our Rz*Ry*Rx) -> quaternion x,y,z,w written at out[o..o+3]. */
export function eulerToQuat(rx, ry, rz, out, o) {
  _e[0] = rx; _e[1] = ry; _e[2] = rz;
  eulerBufToQuat(out, o);
}
// Same, reading the angles from the _e scratch: calls with double arguments box a HeapNumber each when V8 does not
// inline them (16 B/call on the 22-bone rig), so the hot path passes doubles through memory instead.
function eulerBufToQuat(out, o) {
  const rx = _e[0], ry = _e[1], rz = _e[2];
  const sx = Math.sin(rx * D2R), cx = Math.cos(rx * D2R);
  const sy = Math.sin(ry * D2R), cy = Math.cos(ry * D2R);
  const sz = Math.sin(rz * D2R), cz = Math.cos(rz * D2R);
  // q = qz * qy * qx
  out[o] = cz * cy * sx - sz * sy * cx;
  out[o + 1] = cz * sy * cx + sz * cy * sx;
  out[o + 2] = sz * cy * cx - cz * sy * sx;
  out[o + 3] = cz * cy * cx + sz * sy * sx;
}

/** Quaternion x,y,z,w -> Euler degrees (Rz*Ry*Rx) into out[o..o+2]. */
export function quatToEuler(x, y, z, w, out, o) {
  const r20 = 2 * (x * z - y * w);
  const r21 = 2 * (y * z + x * w);
  const r22 = 1 - 2 * (x * x + y * y);
  const r10 = 2 * (x * y + z * w);
  const r00 = 1 - 2 * (y * y + z * z);
  const sy = Math.max(-1, Math.min(1, -r20));
  let rx, rz;
  if (Math.abs(sy) > 0.9999999) { // gimbal: put everything on z
    rx = 0;
    rz = Math.atan2(-2 * (x * y - z * w), 1 - 2 * (x * x + z * z));
  } else { rx = Math.atan2(r21, r22); rz = Math.atan2(r10, r00); }
  out[o] = (rx * 180) / Math.PI;
  out[o + 1] = (Math.asin(sy) * 180) / Math.PI;
  out[o + 2] = (rz * 180) / Math.PI;
}

/** Euler-lerped (not yet sign-fixed) quaternions of every bone at clip time t, into out (4 * bones). */
function rawPose(rigged, clip, out) {
  const t = _f[1];
  const keys = clip.keys;
  const n = keys.length;
  let a = 0;
  while (a + 1 < n && keys[a + 1].t <= t) a++;
  let b = a + 1;
  let tb;
  if (b >= n) { if (clip.loop === false) b = a; else b = 0; tb = b === a ? keys[a].t : clip.duration + keys[0].t; } else tb = keys[b].t;
  const ta = keys[a].t;
  const f = tb > ta ? (t - ta) / (tb - ta) : 0;
  const ka = keys[a], kb = keys[b];
  const nb = rigged.bones.length;
  for (let i = 0; i < nb; i++) {
    const name = rigged.bones[i].name;
    const ra = ka.rot && ka.rot[name];
    const rb = kb.rot && kb.rot[name];
    if (!ra && !rb) { out[4 * i] = 0; out[4 * i + 1] = 0; out[4 * i + 2] = 0; out[4 * i + 3] = 1; continue; }
    _e[0] = (ra ? ra[0] : 0) * (1 - f) + (rb ? rb[0] : 0) * f;
    _e[1] = (ra ? ra[1] : 0) * (1 - f) + (rb ? rb[1] : 0) * f;
    _e[2] = (ra ? ra[2] : 0) * (1 - f) + (rb ? rb[2] : 0) * f;
    eulerBufToQuat(out, 4 * i);
  }
  _ka = ka; _kb = kb; _f[0] = f;
}

/** Sign-continuous quaternions of the whole clip every TABLE_MS (a stateless sampler can then pick the sign by lookup). */
function signTable(rigged, clip) {
  const nb = rigged.bones.length;
  let c = tables.get(clip);
  if (c && c.n === nb) return c.q;
  const count = Math.floor(clip.duration / TABLE_MS) + 1;
  const q = new Float64Array(count * 4 * nb);
  const cur = new Float64Array(4 * nb);
  for (let s = 0; s < count; s++) {
    _f[1] = Math.min(s * TABLE_MS, clip.duration);
    rawPose(rigged, clip, cur);
    for (let b = 0; b < nb; b++) {
      const o = 4 * b, p = (s - 1) * 4 * nb + o, d = s * 4 * nb + o;
      const dot = s > 0 ? cur[o] * q[p] + cur[o + 1] * q[p + 1] + cur[o + 2] * q[p + 2] + cur[o + 3] * q[p + 3] : cur[o + 3];
      const sg = dot < 0 ? -1 : 1;
      q[d] = sg * cur[o]; q[d + 1] = sg * cur[o + 1]; q[d + 2] = sg * cur[o + 2]; q[d + 3] = sg * cur[o + 3];
    }
  }
  tables.set(clip, { n: nb, q });
  return q;
}

/**
 * Pose of `clip` at tMs. outQuat: Float32/64Array(4 * bones) x,y,z,w per bone in skeleton order, sign-continuous
 * over time (continuous with the table, i.e. identical sign choice for equal t); outHips: array(3) Hips translation in
 * metres. Allocation-free after the first call per clip (the call builds a small sign table).
 */
export function sampleClip(rigged, clip, tMs, outQuat, outHips) {
  const nb = rigged.bones.length;
  const table = signTable(rigged, clip);
  const dur = clip.duration;
  let t = tMs;
  if (clip.loop === false) t = t < 0 ? 0 : t > dur ? dur : t;
  else if (dur > 0) { t %= dur; if (t < 0) t += dur; } else t = 0;
  _f[1] = t;
  rawPose(rigged, clip, outQuat);
  const ka = _ka, kb = _kb, f = _f[0];
  const base = Math.min(Math.floor(t / TABLE_MS), table.length / (4 * nb) - 1) * 4 * nb;
  for (let i = 0; i < nb; i++) {
    const o = 4 * i;
    if (outQuat[o] * table[base + o] + outQuat[o + 1] * table[base + o + 1] + outQuat[o + 2] * table[base + o + 2] + outQuat[o + 3] * table[base + o + 3] < 0) {
      outQuat[o] = -outQuat[o]; outQuat[o + 1] = -outQuat[o + 1]; outQuat[o + 2] = -outQuat[o + 2]; outQuat[o + 3] = -outQuat[o + 3];
    }
  }
  const pa = ka.pos && ka.pos.Hips, pb = kb.pos && kb.pos.Hips;
  const cm = rigged.cellM;
  for (let k = 0; k < 3; k++) outHips[k] = ((pa ? pa[k] : 0) * (1 - f) + (pb ? pb[k] : 0) * f) * cm;
}
