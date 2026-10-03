// US-142a1 (35.5): static ballistic sheet, vec4 vertices (lip-local x/y, world z, arc metres).
import { forwardOf } from '../core/transform.js';

export function buildSheetMesh(def) {
  const lip = def.lip, dx = lip[2] - lip[0], dy = lip[3] - lip[1], width = Math.hypot(dx, dy);
  const dir = [0, 0]; forwardOf(def.outDeg, dir);
  const speed = def.out, endT = Math.sqrt(def.drop / 4.9);
  const arc = (t) => {
    const v = 9.8 * t, h = Math.hypot(speed, v);
    return (v * h + speed * speed * Math.asinh(v / speed)) / 19.6;
  };
  const length = arc(endT), cols = Math.ceil(width / 0.5), rows = Math.ceil(length / 0.5);
  const count = (cols + 1) * (rows + 1);
  if (!Number.isFinite(count) || count > 65535) throw new Error(`waterfall "${def.id}": sheet exceeds 65535 vertices`);
  const verts = new Float32Array(count * 4), index = new Uint16Array(cols * rows * 6);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let r = 0; r <= rows; r++) {
    const v = Math.min(r * 0.5, length);
    let lo = 0, hi = endT;
    for (let k = 0; k < 40; k++) { const t = (lo + hi) * 0.5; if (arc(t) < v) lo = t; else hi = t; }
    const t = r === 0 ? 0 : r === rows ? endT : (lo + hi) * 0.5;
    for (let c = 0; c <= cols; c++) {
      const u = Math.min(c * 0.5, width) / width, i = (r * (cols + 1) + c) * 4;
      const x = dx * u + dir[0] * speed * t, y = dy * u + dir[1] * speed * t;
      verts[i] = x; verts[i + 1] = y; verts[i + 2] = def.z - 4.9 * t * t; verts[i + 3] = v;
      x0 = Math.min(x0, x + lip[0]); y0 = Math.min(y0, y + lip[1]); x1 = Math.max(x1, x + lip[0]); y1 = Math.max(y1, y + lip[1]);
    }
  }
  let k = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    index[k++] = a; index[k++] = b; index[k++] = e; index[k++] = a; index[k++] = e; index[k++] = d;
  }
  return { verts, index, cols, rows, length, x0, y0, x1, y1, z0: def.z - def.drop, z1: def.z };
}
