// tools/gait-lib.mjs - ANIM-A-01: option A gait generator (port of design/preview/animal-look-options.html "gait generator")
// + the pose FK / planted-foot measure shared by tools/gen-gait.mjs and tools/gait-a.test.mjs. Node, no dependencies.
// Conventions (engine, as the preview): rot = [rx, ry, rz] degrees, R = Rz*Ry*Rx; rx + on a leg = foot BACK (+y = south);
// y0 = the model front; z = up; a part rotates about its pivot, child pos is in the parent frame. Ground = world z 0.
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const GAITS = {
  amble:    { phase: { HL: 0, FL: 0.12, HR: 0.5, FR: 0.62 }, roll: 5, yaw: 4 },       // bear roll (lateral couplets)
  lateral:  { phase: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, roll: 3, yaw: 3 },       // lateral-sequence walk LH LF RH RF
  diagonal: { phase: { HL: 0.5, FL: 0, HR: 0, FR: 0.5 }, roll: 1.5, yaw: 2 }         // trot
};
function rotM(rx, ry, rz) {
  const cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R), cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
  return mul3([cz, -sz, 0, sz, cz, 0, 0, 0, 1], mul3([cy, 0, sy, 0, 1, 0, -sy, 0, cy], [1, 0, 0, 0, cx, -sx, 0, sx, cx]));
}
function mul3(a, b) { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; return o; }
function mulV(a, v) { return [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]]; }

// part-to-world (12: 3x3 * cellM, translation metres) for every part of def in `frame` ({part: {rot, pos}}), instance at the origin, yaw 0.
export function poseF(def, frame) {
  const names = Object.keys(def.parts), cm = def.cellM, anc = def.anchor, A = {}, b = {}, F = {};
  const bw = [-cm * anc[0], -cm * anc[1], -cm * anc[2]];
  const go = (nm) => {
    if (A[nm]) return;
    const pd = def.parts[nm]; if (pd.parent !== undefined) go(pd.parent);
    const pf = frame[nm] || {}, rot = pf.rot || [0, 0, 0], pos = pf.pos || [0, 0, 0], R = rotM(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    const rv = mulV(R, pd.pivot), l = [pd.pivot[0] + (pos[0] || 0) - rv[0], pd.pivot[1] + (pos[1] || 0) - rv[1], pd.pivot[2] + (pos[2] || 0) - rv[2]];
    if (pd.parent === undefined) { A[nm] = R; b[nm] = l; }
    else { A[nm] = mul3(A[pd.parent], R); const t = mulV(A[pd.parent], l), pb = b[pd.parent]; b[nm] = [t[0] + pb[0], t[1] + pb[1], t[2] + pb[2]]; }
    F[nm] = [...A[nm].map((v) => v * cm), cm * b[nm][0] + bw[0], cm * b[nm][1] + bw[1], cm * b[nm][2] + bw[2]];
  };
  names.forEach(go);
  return F;
}
// the two lowest-layer points of a part's box (x = pivot x, y = first / last occupied row), voxel coords
export function footPts(def, partName) {
  const b = def.parts[partName].box, px = def.parts[partName].pivot[0];
  for (let z = b[2]; z < b[5]; z++) {
    let y0 = 1e9, y1 = -1;
    for (let y = b[1]; y < b[4]; y++) { const row = def.layers[z][y]; for (let x = b[0]; x < b[3]; x++) if (row[x] !== '.' && row[x] !== ' ') { y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
    if (y1 >= 0) return { z, pts: [[px, y0, z], [px, y1 + 1, z]] };
  }
  return { z: b[2], pts: [[px, b[1], b[2]], [px, b[4], b[2]]] };
}
export function footMinZ(F, part, pts) {            // lowest world z (m) of the foot points
  const f = F[part]; let m = Infinity;
  for (const p of pts) m = Math.min(m, f[6] * p[0] + f[7] * p[1] + f[8] * p[2] + f[11]);
  return m;
}

// cfg: { id, body, head, neck?, tail?, ears?, legs: {FL,FR,HL,HR: partName}, gait, G: {T ms, v m/s, beta, bobM, pitch, nod, liftM, ...}, keys }
export function legInfo(def, cfg) {
  const L = {};
  for (const k of Object.keys(cfg.legs)) {
    const part = cfg.legs[k], fp = footPts(def, part), piv = def.parts[part].pivot;
    L[k] = { part, pts: fp.pts, len: piv[2] - fp.z };              // pendulum length in voxels (pivot -> sole)
  }
  return L;
}
const r3 = (v) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
export function genGait(def, cfg) {
  const g = GAITS[cfg.gait], G = Object.assign({ beta: 0.65, bobM: 0.01, pitch: 1.5, nod: 1.5, liftM: 0.02, tail: 3, ears: 3 }, g, cfg.G);
  const n = cfg.keys, legs = legInfo(def, cfg), cm = def.cellM, S = G.v * (G.T / 1000) * G.beta / cm;   // stance travel, voxels
  const names = Object.keys(def.parts), frames = [], durations = [], info = { maxRot: 0 };
  for (let i = 0; i < n; i++) {
    const p = i / n, fr = {};
    for (const nm of names) fr[nm] = { rot: [0, 0, 0], pos: [0, 0, 0] };
    const bob = (G.bobM / cm) * Math.cos(4 * Math.PI * (p - 0.08));
    const pitch = G.pitch * Math.sin(4 * Math.PI * p + 0.6), roll = -G.roll * Math.sin(2 * Math.PI * (p - 0.2)), yaw = G.yaw * Math.sin(2 * Math.PI * p);
    fr[cfg.body] = { rot: [pitch, roll, yaw], pos: [0, 0, bob] };
    fr[cfg.neck || cfg.head].rot = [-pitch * 1.3 + G.nod * Math.sin(4 * Math.PI * p + 0.6), 0, -yaw * 0.8];   // head counter-nod
    if (cfg.tail) fr[cfg.tail].rot = [(cfg.tailBase || 0) + G.tail * 0.5 * Math.sin(4 * Math.PI * p + 1), 0, G.tail * Math.sin(2 * Math.PI * p + 1.2)];
    for (const e of [].concat(cfg.ears || [])) fr[e].rot = [G.ears * Math.sin(4 * Math.PI * p + 2.0), 0, 0];
    const lift = {};
    for (const k of Object.keys(legs)) {
      const lg = legs[k]; let ph = (p - G.phase[k]) % 1; if (ph < 0) ph += 1;
      let Ty, lf = 0;
      if (ph < G.beta) Ty = -S / 2 + S * (ph / G.beta);              // stance: the foot moves front -> back under the body
      else { const q = (ph - G.beta) / (1 - G.beta); Ty = S / 2 - S * smooth(q); lf = G.liftM / cm * Math.sin(Math.PI * q); }
      if (Math.abs(Ty / lg.len) > 0.85) throw new Error(`${cfg.id}: leg ${k} stride ${Ty.toFixed(1)} vox too long for pendulum ${lg.len} (lower v / T / beta)`);
      const r = Math.asin(Ty / lg.len) / D2R;                        // single segment: foot y = len * sin(r)
      info.maxRot = Math.max(info.maxRot, Math.abs(r));
      fr[lg.part].rot = [r, 0, 0]; lift[k] = lf;
    }
    // ground-snap: leg pos z (parent frame) so the sole sits on ground + lift (3 passes: body tilt couples in)
    for (let it = 0; it < 3; it++) {
      const F = poseF(def, fr);
      for (const k of Object.keys(legs)) { const lg = legs[k]; fr[lg.part].pos[2] += (lift[k] * cm - footMinZ(F, lg.part, lg.pts)) / cm; }
    }
    if (cfg.mirror) for (const [dst, src] of Object.entries(cfg.mirror)) fr[dst] = { rot: fr[src].rot.slice(), pos: [fr[src].pos[0], fr[src].pos[1], fr[src].pos[2] + (cfg.mirrorDz || 0)] };
    for (const nm of Object.keys(fr)) { fr[nm].rot = fr[nm].rot.map(r3); fr[nm].pos = fr[nm].pos.map(r3); }
    frames.push(fr); durations.push(Math.round(G.T / n));
  }
  info.legs = legs; info.G = G; info.S = S;
  return { clip: { durations, loop: true, frames }, info };
}

// planted-foot error (m): worst |sole z| of a leg during its stance, at the keys (sub = 1) or at `sub` linear samples per key
export function plantedError(def, cfg, clip, sub = 1) {
  const legs = legInfo(def, cfg), G = Object.assign({ beta: 0.65 }, GAITS[cfg.gait], cfg.G), n = clip.frames.length;
  let worst = 0;
  for (let i = 0; i < n * sub; i++) {
    const kf = Math.floor(i / sub), a = (i % sub) / sub, A = clip.frames[kf], B = clip.frames[(kf + 1) % n], fr = {};
    for (const nm of Object.keys(def.parts)) {
      const x = A[nm] || {}, y = B[nm] || {};
      const lerp = (u, v) => (u || [0, 0, 0]).map((e, j) => e + ((v || [0, 0, 0])[j] - e) * a);
      fr[nm] = { rot: lerp(x.rot, y.rot), pos: lerp(x.pos, y.pos) };
    }
    const F = poseF(def, fr);
    for (const k of Object.keys(legs)) {
      let ph = (i / (n * sub) - G.phase[k]) % 1; if (ph < 0) ph += 1;
      if (ph < G.beta - 1e-9) worst = Math.max(worst, Math.abs(footMinZ(F, legs[k].part, legs[k].pts)));
    }
  }
  return worst;
}
