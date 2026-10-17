// engine/chargen/mesh.js (CHARGEN-03, docs/architecture.md 38.29 item 4): meshCharacter(grid) -> RiggedModel.
// Per-bone culled + greedy quads; a quad never crosses bones. A face is hidden only by a filled voxel of the SAME bone,
// so each bone is a closed shell and the cap pair at every bone boundary stays (rotating joints show no holes).
//
// 38.34: grid.blocks (a region finer than the main grid, e.g. the head) are meshed in their own cells; everything is written at
// the finest chosen size G: rigged.cellM = grid.cellM / f, f = max block k (1 without blocks, then bytes are unchanged).
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
  const { mat: mainMat, bone: mainBone, cellM: mainCellM, anchor } = grid;
  const nb = grid.bones.length;
  const blocks = grid.blocks || [];
  let f = 1;
  for (const b of blocks) if (b.k > f) f = b.k;
  const cellM = mainCellM / f; // G: every vertex is an integer multiple of it
  // one entry per grid: main (k=1, origin 0) then the blocks; s = G cells per grid cell, o = origin in G cells
  const parts = [{ size: grid.size, mat: mainMat, bone: mainBone, s: f, o: [0, 0, 0] }];
  for (const b of blocks) parts.push({ size: b.size, mat: b.mat, bone: b.bone, s: f / b.k, o: b.origin.map((v) => v * f) });
  for (const g of parts) { // bounding box per bone (cells), so each bone only scans its own box
    const [sx, sy, sz] = g.size;
    g.lo = new Int32Array(3 * nb).fill(1 << 30);
    g.hi = new Int32Array(3 * nb).fill(-1);
    for (let z = 0, i = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++, i++) {
      if (!g.mat[i]) continue;
      const b = 3 * g.bone[i];
      if (x < g.lo[b]) g.lo[b] = x; if (x > g.hi[b]) g.hi[b] = x;
      if (y < g.lo[b + 1]) g.lo[b + 1] = y; if (y > g.hi[b + 1]) g.hi[b + 1] = y;
      if (z < g.lo[b + 2]) g.lo[b + 2] = z; if (z > g.hi[b + 2]) g.hi[b + 2] = z;
    }
  }
  let cap = 1024; // quads
  let pos = new Float32Array(12 * cap), nrm = new Int8Array(12 * cap), qmat = new Uint8Array(cap);
  let nq = 0;
  const ranges = [];
  let maxDim = 0;
  for (const g of parts) maxDim = Math.max(maxDim, ...g.size);
  const mask = new Uint8Array(maxDim ** 2);
  const q = [0, 0, 0];
  let gs = 1, go = [0, 0, 0]; // scale + origin of the grid being meshed
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
      pos[p] = (go[0] + q[0] * gs - anchor[0] * f) * cellM; pos[p + 1] = (go[1] + q[1] * gs - anchor[1] * f) * cellM; pos[p + 2] = (go[2] + q[2] * gs - anchor[2] * f) * cellM;
      nrm[p] = 0; nrm[p + 1] = 0; nrm[p + 2] = 0; nrm[p + w] = sign;
    }
    qmat[nq++] = m;
  };

  // greedy quads of bone b inside one grid (a closed shell per bone and grid; a face is hidden only by the same bone)
  const meshBlock = (g, b) => {
    const { size, mat, bone, lo, hi } = g;
    const stride = [1, size[0], size[0] * size[1]];
    gs = g.s; go = g.o;
    if (hi[3 * b] < 0) return;
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
  };

  for (let b = 0; b < nb; b++) {
    const start = nq;
    for (const g of parts) meshBlock(g, b);
    ranges.push({ start, count: nq - start });
  }

  const scaleMounts = (m) => { if (f === 1 || !m) return m; const r = {}; for (const k in m) r[k] = m[k].map((v) => v * f); return r; };
  let clips = grid.clips;
  if (f > 1 && clips) { // Hips translation is in cells: scale to G cells (collapseRig / sampleClip multiply by rigged.cellM)
    clips = JSON.parse(JSON.stringify(clips));
    const walk = (o) => { if (o && typeof o === 'object') { if (o.pos && o.pos.Hips) o.pos.Hips = o.pos.Hips.map((v) => v * f); for (const k in o) walk(o[k]); } };
    walk(clips);
  }
  return {
    cellM,
    bones: grid.bones.map((bn) => ({
      name: bn.name, parent: bn.parent, jointCells: bn.joint ? bn.joint.map((v) => v * f) : [0, 0, 0],
      joint: bn.joint ? bn.joint.map((v, k) => (v * f - anchor[k] * f) * cellM) : [0, 0, 0],
    })),
    mesh: { quads: nq, pos: pos.slice(0, 12 * nq), nrm: nrm.slice(0, 12 * nq), mat: qmat.slice(0, nq), ranges },
    matKeys: grid.matKeys.slice(),
    clips,
    tempo: grid.tempo ?? 1,
    mounts: scaleMounts(grid.mounts),
  };
}
