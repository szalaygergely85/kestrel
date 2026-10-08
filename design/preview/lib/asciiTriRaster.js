// S8-B2-11: tiny z-buffered triangle rasteriser to a glyph grid, shared by design/preview/lod1-trees.html and its Node test.
// Loads both ways (script tag -> window.AsciiTriRaster, require -> module.exports). Pure, no DOM.
(function (g) {
  /**
   * @param {Float32Array} pos world xyz per vertex (3 floats)
   * @param {ArrayLike<number>} idx triangle vertex indices
   * @param {{cols:number, rows:number, dist:number, yaw:number, center:number[], fov?:number}} v view: object turned by `yaw` rad around Y,
   *   camera `dist` m in front of `center` looking at it; the grid covers `fov` deg vertically; cells are twice as tall as wide.
   * @returns {{tri:Int32Array, shade:Float32Array, cols:number, rows:number, covered:number}} per cell: triangle index (-1 = empty) and 0..1 light
   */
  function rasterize(pos, idx, v) {
    const { cols, rows, dist, yaw, center } = v;
    const fov = v.fov || 45;
    const fy = rows / (2 * Math.tan((fov * Math.PI) / 360)); // cells per unit of (y / depth)
    const fx = fy * 2;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const nv = pos.length / 3;
    const vx = new Float32Array(nv), vy = new Float32Array(nv), vz = new Float32Array(nv);
    for (let i = 0; i < nv; i++) {
      const x = pos[i * 3] - center[0], y = pos[i * 3 + 1] - center[1], z = pos[i * 3 + 2] - center[2];
      vx[i] = x * cs + z * sn; vy[i] = y; vz[i] = -x * sn + z * cs + dist;
    }
    const tri = new Int32Array(cols * rows).fill(-1);
    const shade = new Float32Array(cols * rows);
    const inv = new Float32Array(cols * rows); // 1/depth, larger = nearer
    const L = [-0.45, 0.7, -0.55]; // light dir towards the sun in view space (upper left, towards the camera)
    const ln = Math.hypot(L[0], L[1], L[2]);
    let covered = 0;
    for (let t = 0, nt = idx.length / 3; t < nt; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      if (vz[a] < 0.1 || vz[b] < 0.1 || vz[c] < 0.1) continue;
      const ax = cols / 2 + (vx[a] / vz[a]) * fx, ay = rows / 2 - (vy[a] / vz[a]) * fy;
      const bx = cols / 2 + (vx[b] / vz[b]) * fx, by = rows / 2 - (vy[b] / vz[b]) * fy;
      const cx = cols / 2 + (vx[c] / vz[c]) * fx, cy = rows / 2 - (vy[c] / vz[c]) * fy;
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(cols - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(rows - 1, Math.ceil(Math.max(ay, by, cy)));
      if (x0 > x1 || y0 > y1) continue;
      // two-sided flat shade from the view-space face normal
      const e1x = vx[b] - vx[a], e1y = vy[b] - vy[a], e1z = vz[b] - vz[a], e2x = vx[c] - vx[a], e2y = vy[c] - vy[a], e2z = vz[c] - vz[a];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const lam = Math.abs(nx * L[0] + ny * L[1] + nz * L[2]) / ln;
      const sh = 0.22 + 0.78 * lam;
      const ia = 1 / vz[a], ib = 1 / vz[b], ic = 1 / vz[c];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
          const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const iz = w0 * ia + w1 * ib + w2 * ic;
          const o = y * cols + x;
          if (iz <= inv[o]) continue;
          if (tri[o] < 0) covered++;
          inv[o] = iz; tri[o] = t; shade[o] = sh;
        }
      }
    }
    return { tri, shade, cols, rows, covered };
  }

  /** Decodes a lod1-trees.data.js candidate ({verts: b64 Uint16 xyz, idx: b64 Uint16|Uint32, bbox}) to world positions + indices. */
  function decode(c, b64ToBytes) {
    const vb = b64ToBytes(c.verts), ib = b64ToBytes(c.idx);
    const q = new Uint16Array(vb.buffer, vb.byteOffset, vb.byteLength >> 1);
    const idx = c.idx32 ? new Uint32Array(ib.buffer, ib.byteOffset, ib.byteLength >> 2) : new Uint16Array(ib.buffer, ib.byteOffset, ib.byteLength >> 1);
    const bb = c.bbox, pos = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) { const a = i % 3; pos[i] = bb[a] + (q[i] / 65535) * (bb[a + 3] - bb[a]); }
    return { pos, idx };
  }

  const api = { rasterize, decode };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  g.AsciiTriRaster = api;
})(typeof window !== 'undefined' ? window : globalThis);
