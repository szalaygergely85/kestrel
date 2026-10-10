// engine/chargen/mesh.js (CHARGEN-03, docs/architecture.md 38.29 item 4): meshCharacter(grid) -> RiggedModel.
// Per-bone culled + greedy quads; a quad never crosses bones. A face is hidden only by a filled voxel of the SAME bone,
// so each bone is a closed shell and the cap pair at every bone boundary stays (rotating joints show no holes).
//
// RiggedModel.mesh: quads, 4 vertices per quad (implicit indices 0,1,2, 0,2,3; counter-clockwise seen from outside).
//   pos Float32Array(12*quads) metres relative to the anchor (authoring axes: x right, y south, z up)
//   nrm Int8Array(12*quads) unit axis normal per vertex   mat Uint8Array(quads) 1-based index into matKeys (one per quad)
//   ranges[boneIndex] = {start,count} in quads; quads of a bone are contiguous, bones in skeleton order.
//   joints are metres relative to the anchor: (joint - anchor) * cellM, cell centres at +0.5 like the voxel mesher.
const AXES = [
  // [axis u, axis v, axis w (face normal axis), sign]
  [1, 2, 0, 1], [1, 2, 0, -1], [0, 2, 1, 1], [0, 2, 1, -1], [0, 1, 2, 1], [0, 1, 2, -1],
];

export function meshCharacter(grid) {
  const { size, mat, bone, cellM, anchor } = grid;
  const [sx, sy, sz] = size;
  const nb = grid.bones.length;
  const stride = [1, sx, sx * sy];
  // bounding box per bone (cells), so each bone only scans its own box
  const lo = new Int32Array(3 * nb).fill(1 << 30);
  const hi = new Int32Array(3 * nb).fill(-1);
  for (let z = 0, i = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++, i++) {
    if (!mat[i]) continue;
    const b = 3 * bone[i];
    if (x < lo[b]) lo[b] = x; if (x > hi[b]) hi[b] = x;
    if (y < lo[b + 1]) lo[b + 1] = y; if (y > hi[b + 1]) hi[b + 1] = y;
    if (z < lo[b + 2]) lo[b + 2] = z; if (z > hi[b + 2]) hi[b + 2] = z;
  }
  let cap = 1024; // quads
  let pos = new Float32Array(12 * cap), nrm = new Int8Array(12 * cap), qmat = new Uint8Array(cap);
  let nq = 0;
  const ranges = [];
  const mask = new Uint8Array(Math.max(sx, sy, sz) ** 2);
  const q = [0, 0, 0];
  const emit = (u, v, w, sign, pw, i0, j0, wd, ht, m) => {
    if (nq === cap) {
      cap *= 2;
      const p2 = new Float32Array(12 * cap); p2.set(pos); pos = p2;
      const n2 = new Int8Array(12 * cap); n2.set(nrm); nrm = n2;
      const m2 = new Uint8Array(cap); m2.set(qmat); qmat = m2;
    }
    // corner order: counter-clockwise around +sign*w. (u,v,w) = (1,2,0) is right-handed, (0,2,1) left-handed, (0,1,2) right-handed
    const flip = (u === 0 && v === 2) ? -1 : 1;
    const ccw = sign * flip > 0;
    for (let k = 0; k < 4; k++) {
      const o = ccw ? k : (4 - k) % 4; // 0,1,2,3 or 0,3,2,1
      q[u] = (o === 1 || o === 2) ? i0 + wd : i0;
      q[v] = (o >= 2) ? j0 + ht : j0;
      q[w] = pw;
      const p = 12 * nq + 3 * k;
      pos[p] = (q[0] - anchor[0]) * cellM; pos[p + 1] = (q[1] - anchor[1]) * cellM; pos[p + 2] = (q[2] - anchor[2]) * cellM;
      nrm[p] = 0; nrm[p + 1] = 0; nrm[p + 2] = 0; nrm[p + w] = sign;
    }
    qmat[nq++] = m;
  };

  for (let b = 0; b < nb; b++) {
    const start = nq;
    if (hi[3 * b] >= 0) {
      for (let d = 0; d < 6; d++) {
        const [u, v, w, sign] = AXES[d];
        const u0 = lo[3 * b + u], u1 = hi[3 * b + u] + 1, v0 = lo[3 * b + v], v1 = hi[3 * b + v] + 1;
        const w0 = lo[3 * b + w], w1 = hi[3 * b + w] + 1, dw = size[w];
        const su = stride[u], sv = stride[v], sw = stride[w];
        const mw = u1 - u0;
        for (let s = w0; s < w1; s++) {
          let any = false;
          for (let j = v0; j < v1; j++) for (let i = u0; i < u1; i++) {
            const idx = i * su + j * sv + s * sw;
            let m = 0;
            if (mat[idx] && bone[idx] === b) {
              const t = s + sign;
              m = (t >= 0 && t < dw && mat[idx + sign * sw] && bone[idx + sign * sw] === b) ? 0 : mat[idx];
            }
            mask[(i - u0) + mw * (j - v0)] = m;
            if (m) any = true;
          }
          if (!any) continue;
          const pw = s + (sign > 0 ? 1 : 0);
          for (let j = v0; j < v1; j++) {
            for (let i = u0; i < u1;) {
              const m = mask[(i - u0) + mw * (j - v0)];
              if (!m) { i++; continue; }
              let wd = 1;
              while (i + wd < u1 && mask[(i + wd - u0) + mw * (j - v0)] === m) wd++;
              let ht = 1;
              outer: while (j + ht < v1) {
                for (let k = 0; k < wd; k++) if (mask[(i + k - u0) + mw * (j + ht - v0)] !== m) break outer;
                ht++;
              }
              for (let jj = 0; jj < ht; jj++) for (let k = 0; k < wd; k++) mask[(i + k - u0) + mw * (j + jj - v0)] = 0;
              emit(u, v, w, sign, pw, i, j, wd, ht, m);
              i += wd;
            }
          }
        }
      }
    }
    ranges.push({ start, count: nq - start });
  }

  return {
    cellM,
    bones: grid.bones.map((bn) => ({
      name: bn.name, parent: bn.parent, jointCells: bn.joint ? bn.joint.slice() : [0, 0, 0],
      joint: bn.joint ? bn.joint.map((v, k) => (v - anchor[k]) * cellM) : [0, 0, 0],
    })),
    mesh: { quads: nq, pos: pos.slice(0, 12 * nq), nrm: nrm.slice(0, 12 * nq), mat: qmat.slice(0, nq), ranges },
    matKeys: grid.matKeys.slice(),
    clips: grid.clips,
    tempo: grid.tempo ?? 1,
    mounts: grid.mounts,
  };
}
