// ME-20a (sprint-8 S8-B2-04): importer-side per-vertex ambient occlusion bake. Pure JS, deterministic, no engine imports
// (tools may only import engine/index.js). `gltf-import --ao [rays]` calls bakeVertexAo and stores the result with writeVertexAo.
//
// Storage: the existing `aux` lane (8 floats/vertex, identical on the 3 vertices of a triangle - MeshData validator).
// For AO_NONE meshes slots 2..7 are unused, so the bake writes aux[5], aux[6], aux[7] = AO of the triangle's vertex 0, 1, 2
// (1 = open, (0,1) = occluded, never 0; "all three 0" = no baked AO). Nothing reads them yet (ME-20b = a later WGSL story),
// so a mesh carrying them renders exactly like one without.
export const AO_AUX_SLOT = 5;
export const AO_RAYS_DEFAULT = 32;

// Deterministic cosine-weighted hemisphere samples (Hammersley set), z up.
function hemisphere(n) {
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    let bits = i, r = 0, f = 0.5;
    for (let b = 0; b < 16; b++) { r += (bits & 1) * f; bits >>= 1; f *= 0.5; }
    const u = (i + 0.5) / n, phi = 2 * Math.PI * r, rad = Math.sqrt(u), z = Math.sqrt(1 - u);
    out[i * 3] = rad * Math.cos(phi); out[i * 3 + 1] = rad * Math.sin(phi); out[i * 3 + 2] = z;
  }
  return out;
}

// Median-split BVH over triangles (triangle soup: pos has 9 floats per triangle).
function buildTree(pos, triCount) {
  const cen = new Float64Array(triCount * 3), order = new Uint32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    order[t] = t;
    for (let a = 0; a < 3; a++) cen[t * 3 + a] = (pos[t * 9 + a] + pos[t * 9 + 3 + a] + pos[t * 9 + 6 + a]) / 3;
  }
  const nodes = []; // {min, max, l, r, s, c}
  const build = (s, e) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
      const x = pos[order[i] * 9 + v * 3 + a];
      if (x < min[a]) min[a] = x;
      if (x > max[a]) max[a] = x;
    }
    const node = { min, max, l: -1, r: -1, s, c: e - s }, id = nodes.length;
    nodes.push(node);
    if (e - s <= 4) return id;
    let axis = 0;
    for (let a = 1; a < 3; a++) if (max[a] - min[a] > max[axis] - min[axis]) axis = a;
    const sub = Array.from(order.subarray(s, e)).sort((p, q) => cen[p * 3 + axis] - cen[q * 3 + axis] || p - q);
    order.set(sub, s);
    const m = (s + e) >> 1;
    node.l = build(s, m); node.r = build(m, e); node.c = 0;
    return id;
  };
  if (triCount) build(0, triCount);
  return { nodes, order };
}

function hitTri(pos, t, ox, oy, oz, dx, dy, dz, tMax) { // two-sided Moller-Trumbore
  const b = t * 9;
  const e1x = pos[b + 3] - pos[b], e1y = pos[b + 4] - pos[b + 1], e1z = pos[b + 5] - pos[b + 2];
  const e2x = pos[b + 6] - pos[b], e2y = pos[b + 7] - pos[b + 1], e2z = pos[b + 8] - pos[b + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return false;
  const inv = 1 / det, tx = ox - pos[b], ty = oy - pos[b + 1], tz = oz - pos[b + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return d > 0 && d < tMax;
}

const _o = [0, 0, 0], _d = [0, 0, 0];
function occluded(tree, pos, ox, oy, oz, dx, dy, dz, tMax, stack) {
  const { nodes, order } = tree;
  _o[0] = ox; _o[1] = oy; _o[2] = oz; _d[0] = dx; _d[1] = dy; _d[2] = dz;
  let sp = 0;
  stack[sp++] = 0;
  while (sp) {
    const n = nodes[stack[--sp]];
    let t0 = 0, t1 = tMax;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(_d[a]) < 1e-12) { if (_o[a] < n.min[a] || _o[a] > n.max[a]) { t1 = -1; break; } continue; }
      let ta = (n.min[a] - _o[a]) / _d[a], tb = (n.max[a] - _o[a]) / _d[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) break;
    }
    if (t0 > t1) continue;
    if (n.c) {
      for (let i = n.s; i < n.s + n.c; i++) if (hitTri(pos, order[i], ox, oy, oz, dx, dy, dz, tMax)) return true;
    } else { stack[sp++] = n.l; stack[sp++] = n.r; }
  }
  return false;
}

/**
 * @param {{pos: Float32Array, triCount: number, bbox: ArrayLike<number>}} mesh static triangle-soup mesh (3 vertices per triangle)
 * @param {{rays?: number, maxDist?: number}} [opts] maxDist default = 0.35 x bbox diagonal
 * @returns {Float32Array} per-vertex AO, 1 = open, min 1/rays (never 0)
 */
export function bakeVertexAo(mesh, opts = {}) {
  const rays = opts.rays || AO_RAYS_DEFAULT;
  if (!Number.isInteger(rays) || rays < 4) throw new Error('vertex-ao: rays must be an integer >= 4');
  const { pos, triCount } = mesh, V = triCount * 3, bb = mesh.bbox;
  const diag = Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]);
  const maxDist = opts.maxDist || 0.35 * diag, eps = 1e-4 * Math.max(diag, 1e-3);
  // Smooth normals: area-weighted face normals summed over welded (1e-5 quantised) positions.
  const key = (v) => `${Math.round(pos[v * 3] * 1e5)},${Math.round(pos[v * 3 + 1] * 1e5)},${Math.round(pos[v * 3 + 2] * 1e5)}`;
  const acc = new Map(), faceN = new Float64Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    const e1 = [pos[b + 3] - pos[b], pos[b + 4] - pos[b + 1], pos[b + 5] - pos[b + 2]];
    const e2 = [pos[b + 6] - pos[b], pos[b + 7] - pos[b + 1], pos[b + 8] - pos[b + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    faceN.set(n, t * 3);
    for (let c = 0; c < 3; c++) {
      const k = key(t * 3 + c);
      let s = acc.get(k);
      if (!s) acc.set(k, s = [0, 0, 0]);
      s[0] += n[0]; s[1] += n[1]; s[2] += n[2];
    }
  }
  const tree = buildTree(pos, triCount), dirs = hemisphere(rays), stack = new Int32Array(256), ao = new Float32Array(V);
  for (let v = 0; v < V; v++) {
    const s = acc.get(key(v));
    let nx = s[0], ny = s[1], nz = s[2];
    let len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) { const f = Math.floor(v / 3) * 3; nx = faceN[f]; ny = faceN[f + 1]; nz = faceN[f + 2]; len = Math.hypot(nx, ny, nz) || 1; }
    nx /= len; ny /= len; nz /= len;
    // tangent frame (t, b, n)
    const hx = Math.abs(nx) < 0.9 ? 1 : 0, hy = hx ? 0 : 1;
    let tx = hy * nz, ty = -hx * nz, tz = hx * ny - hy * nx;
    const tl = Math.hypot(tx, ty, tz);
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const ox = pos[v * 3] + nx * eps, oy = pos[v * 3 + 1] + ny * eps, oz = pos[v * 3 + 2] + nz * eps;
    let open = 0;
    for (let i = 0; i < rays; i++) {
      const a = dirs[i * 3], b = dirs[i * 3 + 1], c = dirs[i * 3 + 2];
      const dx = a * tx + b * bx + c * nx, dy = a * ty + b * by + c * ny, dz = a * tz + b * bz + c * nz;
      if (!occluded(tree, pos, ox, oy, oz, dx, dy, dz, maxDist, stack)) open++;
    }
    ao[v] = Math.max(open, 1) / rays;
  }
  return ao;
}

/** Writes per-vertex AO into aux[5..7] of each triangle (all 3 vertices of the triangle get the same 3 values). AO_NONE meshes only (aux[1] === 0). */
export function writeVertexAo(mesh, ao, stride = 8) {
  for (let t = 0; t < mesh.triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const base = (t * 3 + c) * stride;
      if (mesh.aux[base + 1] !== 0) throw new Error('vertex-ao: only AO_NONE meshes can carry baked AO');
      for (let k = 0; k < 3; k++) mesh.aux[base + AO_AUX_SLOT + k] = ao[t * 3 + k];
    }
  }
}

/** Reads back per-vertex AO (null when the mesh has none baked). */
export function readVertexAo(mesh, stride = 8) {
  const out = new Float32Array(mesh.triCount * 3);
  let any = false;
  for (let t = 0; t < mesh.triCount; t++) for (let k = 0; k < 3; k++) {
    const x = mesh.aux[t * 3 * stride + AO_AUX_SLOT + k];
    out[t * 3 + k] = x;
    if (x > 0) any = true;
  }
  return any ? out : null;
}
