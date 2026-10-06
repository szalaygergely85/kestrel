// engine/mesh/simplify.js (ME-SIMPLIFY-01): quadric edge-collapse triangle reduction (Garland-Heckbert, simplified).
// Pure function, no dependencies, used by the glTF importer (`loadGltf` opts.simplifyRatio) so heavy imported meshes
// (Quaternius trees / stepping stones) can be cut to a triangle budget offline. Positions are welded by value first, so
// split vertices (UV / normal seams) do not tear holes; boundary edges get a penalty plane so open meshes keep their rim;
// every collapse is rejected if it flips or degenerates a neighbouring face.

const WELD = 1e5; // weld positions to 1e-5 m

function planeQuadric(nx, ny, nz, d, w, q, o) {
  q[o] += w * nx * nx; q[o + 1] += w * nx * ny; q[o + 2] += w * nx * nz; q[o + 3] += w * nx * d;
  q[o + 4] += w * ny * ny; q[o + 5] += w * ny * nz; q[o + 6] += w * ny * d;
  q[o + 7] += w * nz * nz; q[o + 8] += w * nz * d;
  q[o + 9] += w * d * d;
}
function evalQ(q, o, x, y, z) {
  return q[o] * x * x + 2 * q[o + 1] * x * y + 2 * q[o + 2] * x * z + 2 * q[o + 3] * x
    + q[o + 4] * y * y + 2 * q[o + 5] * y * z + 2 * q[o + 6] * y
    + q[o + 7] * z * z + 2 * q[o + 8] * z + q[o + 9];
}

/**
 * @param {ArrayLike<ArrayLike<number>>} positions per-vertex [x,y,z] (may contain duplicates)
 * @param {ArrayLike<number>} idx triangle vertex indices (length % 3 === 0)
 * @param {number} targetTris desired triangle count (result may be slightly higher if collapses are rejected)
 * @returns {{positions: number[][], idx: number[]}} welded, reduced mesh (same winding)
 */
export function simplifyTriangles(positions, idx, targetTris) {
  // weld
  const key = new Map(); const vp = []; const remap = new Int32Array(positions.length);
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const k = `${Math.round(p[0] * WELD)},${Math.round(p[1] * WELD)},${Math.round(p[2] * WELD)}`;
    let v = key.get(k);
    if (v === undefined) { v = vp.length; vp.push([p[0], p[1], p[2]]); key.set(k, v); }
    remap[i] = v;
  }
  const faces = []; // [a,b,c]
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]], b = remap[idx[t + 1]], c = remap[idx[t + 2]];
    if (a !== b && b !== c && a !== c) faces.push([a, b, c]);
  }
  const nV = vp.length;
  const alive = new Uint8Array(faces.length).fill(1);
  let liveFaces = faces.length;
  if (liveFaces <= targetTris) return emit(vp, faces, alive);

  const vFaces = Array.from({ length: nV }, () => new Set());
  faces.forEach((f, i) => { vFaces[f[0]].add(i); vFaces[f[1]].add(i); vFaces[f[2]].add(i); });
  const Q = new Float64Array(nV * 10);

  function faceNormal(f, out) {
    const a = vp[f[0]], b = vp[f[1]], c = vp[f[2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
    return Math.hypot(out[0], out[1], out[2]); // = 2 * area
  }
  const n = [0, 0, 0];
  for (const f of faces) {
    const len = faceNormal(f, n);
    if (len < 1e-14) continue;
    const nx = n[0] / len, ny = n[1] / len, nz = n[2] / len, a = vp[f[0]];
    const d = -(nx * a[0] + ny * a[1] + nz * a[2]);
    for (const v of f) planeQuadric(nx, ny, nz, d, len * 0.5, Q, v * 10);
  }
  // boundary penalty: an edge owned by one face gets a plane through it, perpendicular to that face
  const edgeCount = new Map();
  const ek = (a, b) => (a < b ? a * nV + b : b * nV + a);
  for (const f of faces) for (let e = 0; e < 3; e++) { const k = ek(f[e], f[(e + 1) % 3]); edgeCount.set(k, (edgeCount.get(k) || 0) + 1); }
  for (const f of faces) {
    const len = faceNormal(f, n);
    if (len < 1e-14) continue;
    for (let e = 0; e < 3; e++) {
      const a = f[e], b = f[(e + 1) % 3];
      if (edgeCount.get(ek(a, b)) !== 1) continue;
      const pa = vp[a], pb = vp[b];
      const ex = pb[0] - pa[0], ey = pb[1] - pa[1], ez = pb[2] - pa[2];
      let bx = ey * n[2] - ez * n[1], by = ez * n[0] - ex * n[2], bz = ex * n[1] - ey * n[0];
      const bl = Math.hypot(bx, by, bz); if (bl < 1e-14) continue;
      bx /= bl; by /= bl; bz /= bl;
      const d = -(bx * pa[0] + by * pa[1] + bz * pa[2]);
      const w = 100 * (ex * ex + ey * ey + ez * ez);
      planeQuadric(bx, by, bz, d, w, Q, a * 10); planeQuadric(bx, by, bz, d, w, Q, b * 10);
    }
  }

  // binary min-heap of candidate edges
  const heap = []; // {c, a, b, va, vb}
  const ver = new Int32Array(nV);
  const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (heap[p].c <= heap[i].c) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const down = (i) => { for (;;) { let m = i; const l = 2 * i + 1, r = l + 1; if (l < heap.length && heap[l].c < heap[m].c) m = l; if (r < heap.length && heap[r].c < heap[m].c) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } };
  const push = (e) => { heap.push(e); up(heap.length - 1); };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; down(0); } return top; };
  const q2 = new Float64Array(10);
  function costOf(a, b) {
    for (let i = 0; i < 10; i++) q2[i] = Q[a * 10 + i] + Q[b * 10 + i];
    const pa = vp[a], pb = vp[b], m = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    let best = m, bc = evalQ(q2, 0, m[0], m[1], m[2]);
    const ca = evalQ(q2, 0, pa[0], pa[1], pa[2]); if (ca < bc) { bc = ca; best = pa; }
    const cb = evalQ(q2, 0, pb[0], pb[1], pb[2]); if (cb < bc) { bc = cb; best = pb; }
    return { c: Math.max(0, bc), p: [best[0], best[1], best[2]] };
  }
  function pushEdge(a, b) { const { c, p } = costOf(a, b); push({ c, a, b, va: ver[a], vb: ver[b], p }); }
  const seen = new Set();
  for (const f of faces) for (let e = 0; e < 3; e++) { const a = f[e], b = f[(e + 1) % 3], k = ek(a, b); if (!seen.has(k)) { seen.add(k); pushEdge(Math.min(a, b), Math.max(a, b)); } }

  const n0 = [0, 0, 0], n1 = [0, 0, 0];
  function collapseOk(a, b, p) {
    const orig = [vp[a], vp[b]];
    for (const v of [a, b]) {
      for (const fi of vFaces[v]) {
        const f = faces[fi];
        if ((f[0] === a || f[1] === a || f[2] === a) && (f[0] === b || f[1] === b || f[2] === b)) continue; // dies with the edge
        const l0 = faceNormal(f, n0);
        const save = vp[v]; vp[v] = p;
        const l1 = faceNormal(f, n1);
        vp[v] = save;
        if (l1 < 1e-12) return false;
        if (l0 > 1e-12 && (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (l0 * l1) < 0.2) return false;
      }
    }
    void orig;
    return true;
  }

  while (liveFaces > targetTris && heap.length) {
    const e = pop();
    const { a, b } = e;
    if (e.va !== ver[a] || e.vb !== ver[b] || !vFaces[a].size || !vFaces[b].size) continue;
    if (!collapseOk(a, b, e.p)) continue;
    // collapse b into a at e.p
    vp[a] = e.p;
    for (let i = 0; i < 10; i++) Q[a * 10 + i] += Q[b * 10 + i];
    for (const fi of [...vFaces[b]]) {
      const f = faces[fi];
      if (f[0] === a || f[1] === a || f[2] === a) { // face contains both: dies
        alive[fi] = 0; liveFaces--;
        for (const v of f) vFaces[v].delete(fi);
        continue;
      }
      for (let k = 0; k < 3; k++) if (f[k] === b) f[k] = a;
      vFaces[b].delete(fi); vFaces[a].add(fi);
    }
    ver[a]++; ver[b]++;
    const nbr = new Set();
    for (const fi of vFaces[a]) for (const v of faces[fi]) if (v !== a) nbr.add(v);
    for (const v of nbr) pushEdge(Math.min(a, v), Math.max(a, v));
  }
  return emit(vp, faces, alive);
}

function emit(vp, faces, alive) {
  const map = new Map(); const positions = []; const idx = [];
  faces.forEach((f, i) => {
    if (!alive[i]) return;
    for (const v of f) {
      let m = map.get(v);
      if (m === undefined) { m = positions.length; positions.push(vp[v]); map.set(v, m); }
      idx.push(m);
    }
  });
  return { positions, idx };
}
