// OB-114: Quaternius Rock_Medium_1..3 imported with the `moss_cap` slot covering the whole underside + lower flanks
// (area: ~60% facing down / sideways), so boulders read as flat grass-green below a thin grey cap. Re-map by face normal:
// moss_cap only on UP-facing faces (nz >= 0.5), every other former moss_cap triangle becomes `rock`.
// Per-triangle records are reordered so each material stays one contiguous range. Idempotent. Usage: node tools/fix-rock-moss.mjs [--check]
import fs from 'node:fs';
import { readMeshJSON, renderMeshFiles } from './mesh-file.mjs';

export const MOSS_MIN_NZ = 0.5;
const STRIDE = { pos: 9, uv: 6, nrm: 3, flat: 6, aux: 24 };
const KEYS = ['moss_cap', 'rock', 'rock_soft'];

/** @returns {Object} new full json with moss_cap restricted to up-facing triangles */
export function remapRockMoss(j) {
  const T = j.triCount, mat = new Array(T);
  for (const r of j.ranges) for (let t = r.start; t < r.start + r.count; t++) mat[t] = r.part.split(':')[1];
  for (let t = 0; t < T; t++) {
    if (mat[t] !== 'moss_cap') continue;
    const p = j.pos, o = t * 9;
    const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
    const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
    const nz = (ux * vy - uy * vx) / (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) || 1);
    if (nz < MOSS_MIN_NZ) mat[t] = 'rock';
  }
  const order = [];
  const prefix = j.ranges[0].part.split(':')[0];
  const ranges = [];
  for (const k of KEYS) {
    const start = order.length;
    for (let t = 0; t < T; t++) if (mat[t] === k) order.push(t);
    if (order.length > start) ranges.push({ ...j.ranges[0], part: `${prefix}:${k}`, start, count: order.length - start });
  }
  const out = { ...j, ranges, matKeys: ranges.map((r) => r.part.split(':')[1]) };
  for (const [k, s] of Object.entries(STRIDE)) {
    const src = j[k], dst = new Array(src.length);
    order.forEach((t, i) => { for (let c = 0; c < s; c++) dst[i * s + c] = src[t * s + c]; });
    out[k] = dst;
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('fix-rock-moss.mjs')) {
  for (const n of [1, 2, 3]) {
    const file = `content/meshes/quaternius/Rock_Medium_${n}.mesh.json`;
    const full = remapRockMoss(readMeshJSON(file));
    const { metaText, bin, binName } = renderMeshFiles(file, full);
    if (process.argv.includes('--check')) { console.log(file, fs.readFileSync(file, 'utf8') === metaText ? 'ok' : 'WOULD CHANGE'); continue; }
    fs.writeFileSync(file, metaText);
    fs.writeFileSync(file.replace(/[^/]+$/, binName), bin);
    console.log('wrote', file, full.ranges.map((r) => `${r.part.split(':')[1]}=${r.count}`).join(' '));
  }
}
