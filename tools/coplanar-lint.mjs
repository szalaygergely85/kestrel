#!/usr/bin/env node
// tools/coplanar-lint.mjs (OB-053). Lists pairs of overlapping, (near-)coplanar, same-facing triangles in the world:
// those z-fight (flicker) in the depth buffer. Sources: the grid structures' level meshes (engine/mesh/levelMesh.js)
// and every placed mesh (world `structures[]` with a `mesh`, scale + yawDeg + origin). Alpha-cutout ranges (foliage
// cards) are skipped. Read-only; Node only.
//   node tools/coplanar-lint.mjs [--at x,y,z] [--radius 8] [--eps 0.02] [--min-area 0.002] [--limit 40] [--json]
//     [--self-meshes] [--world world_m1] [--max N]
// Exit 0 (a report) unless --max N is given and the world has more than N pairs (then 1); tools/coplanar-lint.test.mjs checks the maths and the tower spot.
import { pathToFileURL } from 'node:url';
import { loadTestAssets } from './testing/content-node.mjs';
import { loadLevel } from '../engine/index.js';
import { buildLevelMesh } from '../engine/dev.js';

export const DEFAULTS = { eps: 0.02, minArea: 0.002, cos: 0.9995, cell: 4, dBin: 0.05 };
export const TOWER_SPOT = { x: 1481.85, y: 1024.3, z: 2.4 };

/** Triangle soup: pos (9 floats/tri, world metres), src (index into srcs), srcs [{name, level}]. */
export function newSoup() { return { pos: [], src: [], srcs: [] }; }

/** Appends a MeshData's triangles (static layout, 3 verts/tri) with scale -> yaw (CCW) -> origin; skips masked ranges. */
export function addMesh(soup, mesh, name, place = {}, isLevel = false) {
  if (!mesh || !mesh.pos || mesh.idx || mesh.layout === 'terrain') return 0;
  const s = place.scale || 1, o = place.origin || { x: 0, y: 0, z: 0 };
  const a = ((place.yawDeg || 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const skip = new Uint8Array(mesh.triCount);
  for (const r of mesh.ranges || []) if (r.mask) skip.fill(1, r.start, r.start + r.count);
  const si = soup.srcs.length;
  soup.srcs.push({ name, level: isLevel });
  let n = 0;
  const p = mesh.pos;
  for (let t = 0; t < mesh.triCount; t++) {
    if (skip[t]) continue;
    for (let v = 0; v < 3; v++) {
      const i = (t * 3 + v) * 3, x = p[i] * s, y = p[i + 1] * s, z = p[i + 2] * s;
      soup.pos.push(c * x - sn * y + o.x, sn * x + c * y + o.y, z + o.z);
    }
    soup.src.push(si); n++;
  }
  return n;
}

// 2D Sutherland-Hodgman: area of convex poly `subj` clipped by convex CCW poly `clip` (arrays of [x,y]).
function clipArea(subj, clip) {
  let out = subj;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], inp = out;
    out = [];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  let ar = 0;
  for (let i = 0; i < out.length; i++) { const p = out[i], q = out[(i + 1) % out.length]; ar += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(ar) / 2;
}

/**
 * Finds same-facing near-coplanar overlapping triangle pairs.
 * @returns {{a:number,b:number,area:number,c:number[],n:number[],sa:number,sb:number}[]}
 */
export function findCoplanar(soup, opts = {}) {
  const { eps, minArea, cos, cell, dBin } = { ...DEFAULTS, ...opts };
  const P = soup.pos, T = soup.src.length;
  const N = new Float64Array(T * 4); // nx ny nz d
  const ok = new Uint8Array(T);
  const bins = new Map();
  for (let t = 0; t < T; t++) {
    const i = t * 9;
    const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2];
    const vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9 || l / 2 < minArea) continue; // degenerate or too small to matter
    nx /= l; ny /= l; nz /= l;
    ok[t] = 1; N[t * 4] = nx; N[t * 4 + 1] = ny; N[t * 4 + 2] = nz; N[t * 4 + 3] = nx * P[i] + ny * P[i + 1] + nz * P[i + 2];
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const axis = (ax >= ay && ax >= az) ? (nx > 0 ? 0 : 1) : (ay >= az ? (ny > 0 ? 2 : 3) : (nz > 0 ? 4 : 5));
    const d = N[t * 4 + 3];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let v = 0; v < 3; v++) { x0 = Math.min(x0, P[i + v * 3]); x1 = Math.max(x1, P[i + v * 3]); y0 = Math.min(y0, P[i + v * 3 + 1]); y1 = Math.max(y1, P[i + v * 3 + 1]); }
    const cx0 = Math.floor(x0 / cell), cx1 = Math.floor(x1 / cell), cy0 = Math.floor(y0 / cell), cy1 = Math.floor(y1 / cell);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 400) continue; // huge ground-sized sheet: not a prop quad
    const d0 = Math.floor((d - eps) / dBin), d1 = Math.floor((d + eps) / dBin);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) for (let db = d0; db <= d1; db++) {
      const key = `${cx},${cy},${axis},${db}`;
      let b = bins.get(key); if (!b) bins.set(key, b = []);
      b.push(t);
    }
  }
  const seen = new Set(), out = [];
  for (const b of bins.values()) {
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      const a = Math.min(b[i], b[j]), c = Math.max(b[i], b[j]);
      const sa = soup.src[a], sb = soup.src[c];
      if (sa === sb && !(soup.srcs[sa].level || opts.selfMeshes)) continue;
      if (N[a * 4] * N[c * 4] + N[a * 4 + 1] * N[c * 4 + 1] + N[a * 4 + 2] * N[c * 4 + 2] < cos) continue;
      const key = a * T + c;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!planeNear(P, N, a, c, eps) || !planeNear(P, N, c, a, eps)) continue;
      const area = overlap(P, N, a, c);
      if (area < minArea) continue;
      out.push({ a, b: c, area, c: centroid(P, a), n: [N[a * 4], N[a * 4 + 1], N[a * 4 + 2]], sa, sb });
    }
  }
  return out;
}

function planeNear(P, N, tri, other, eps) { // all 3 verts of `other` within eps of the plane of `tri`
  const k = tri * 4;
  for (let v = 0; v < 3; v++) {
    const i = other * 9 + v * 3;
    if (Math.abs(N[k] * P[i] + N[k + 1] * P[i + 1] + N[k + 2] * P[i + 2] - N[k + 3]) > eps) return false;
  }
  return true;
}
function centroid(P, t) { const i = t * 9; return [(P[i] + P[i + 3] + P[i + 6]) / 3, (P[i + 1] + P[i + 4] + P[i + 7]) / 3, (P[i + 2] + P[i + 5] + P[i + 8]) / 3]; }
function overlap(P, N, a, b) { // project both onto a's plane basis, clip
  const nx = N[a * 4], ny = N[a * 4 + 1], nz = N[a * 4 + 2];
  let ux, uy, uz;
  if (Math.abs(nz) < 0.9) { ux = -ny; uy = nx; uz = 0; } else { ux = 0; uy = -nz; uz = ny; }
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const proj = (t) => {
    const poly = [];
    for (let v = 0; v < 3; v++) { const i = t * 9 + v * 3; poly.push([P[i] * ux + P[i + 1] * uy + P[i + 2] * uz, P[i] * vx + P[i + 1] * vy + P[i + 2] * vz]); }
    const s = (poly[1][0] - poly[0][0]) * (poly[2][1] - poly[0][1]) - (poly[1][1] - poly[0][1]) * (poly[2][0] - poly[0][0]);
    return s < 0 ? poly.reverse() : poly; // CCW
  };
  return clipArea(proj(b), proj(a));
}

/** Soup of the whole world: level meshes of structures with a `level`, placed meshes of structures with a `mesh`. */
export async function worldSoup(worldId = 'world_m1') {
  const { bundle } = await loadTestAssets();
  const world = bundle.worlds[worldId];
  const soup = newSoup();
  let missing = 0;
  for (const s of world.structures || []) {
    if (s.level) {
      const level = loadLevel(bundle.levels[s.level]);
      if (!level) continue;
      if (s.yawSteps) { console.warn(`level ${s.id} has yawSteps ${s.yawSteps}: skipped`); continue; }
      const set = buildLevelMesh(level);
      addMesh(soup, set.base, `level:${s.id}`, { origin: s.origin }, true);
      for (const d of set.dyn) addMesh(soup, d.mesh, `level:${s.id}#${d.tag}`, { origin: s.origin }, true);
    } else if (s.mesh) {
      const m = bundle.meshes[s.mesh];
      if (!m || m.lazy) { missing++; continue; }
      addMesh(soup, m, `${s.id}(${s.mesh})`, { origin: s.origin, scale: s.scale, yawDeg: s.yawDeg });
    }
  }
  soup.missing = missing;
  return soup;
}

/** Summary: pairs grouped by source pair, and by 32 m world cell. */
export function summarize(soup, pairs) {
  const bySrc = new Map(), byCell = new Map();
  for (const p of pairs) {
    const k = `${soup.srcs[p.sa].name}  x  ${soup.srcs[p.sb].name}`;
    const e = bySrc.get(k) || { k, n: 0, area: 0, c: p.c }; e.n++; e.area += p.area; bySrc.set(k, e);
    const ck = `${Math.floor(p.c[0] / 32) * 32},${Math.floor(p.c[1] / 32) * 32}`;
    byCell.set(ck, (byCell.get(ck) || 0) + 1);
  }
  return { bySrc: [...bySrc.values()].sort((a, b) => b.area - a.area), byCell: [...byCell.entries()].sort((a, b) => b[1] - a[1]) };
}

export function near(p, at, r) { return Math.hypot(p.c[0] - at.x, p.c[1] - at.y, (p.c[2] - at.z) * 0.5) <= r; }

async function main() {
  const args = process.argv.slice(2);
  const arg = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
  const at = arg('at') ? Object.fromEntries(arg('at').split(',').map((v, i) => ['xyz'[i], +v])) : TOWER_SPOT;
  const radius = +arg('radius', 8), limit = +arg('limit', 40);
  const opts = { eps: +arg('eps', DEFAULTS.eps), minArea: +arg('min-area', DEFAULTS.minArea), selfMeshes: args.includes('--self-meshes') };
  const soup = await worldSoup(arg('world', 'world_m1'));
  const pairs = findCoplanar(soup, opts);
  const sum = summarize(soup, pairs);
  const max = arg('max') != null ? +arg('max') : null;   // --max N: exit 1 when the world has more than N pairs (regression gate, OB-053b)
  if (max != null && pairs.length > max) process.exitCode = 1;
  if (args.includes('--json')) { console.log(JSON.stringify({ at, radius, tris: soup.src.length, pairs: pairs.length, spot: pairs.filter((p) => near(p, at, radius)).length, bySrc: sum.bySrc.slice(0, limit), byCell: sum.byCell.slice(0, limit) })); return; }
  const spot = pairs.filter((p) => near(p, at, radius));
  console.log(`SPOT (${at.x}, ${at.y}, ${at.z}) r=${radius}: ${spot.length} coplanar overlapping pair(s)`);
  for (const p of spot.slice(0, limit)) console.log(`  ${soup.srcs[p.sa].name} x ${soup.srcs[p.sb].name}  area ${p.area.toFixed(3)} m2 at (${p.c.map((v) => v.toFixed(2)).join(', ')}) n (${p.n.map((v) => v.toFixed(2)).join(', ')})`);
  console.log(`WORLD: ${soup.src.length} tris, ${soup.srcs.length} sources (${soup.missing} lazy meshes skipped), ${pairs.length} pair(s) total, eps ${opts.eps} m, min area ${opts.minArea} m2`);
  console.log('by location (32 m cell: pairs):', sum.byCell.slice(0, 12).map(([k, n]) => `${k}: ${n}`).join(' | '));
  console.log('worst source pairs (area m2):');
  for (const e of sum.bySrc.slice(0, limit)) console.log(`  ${e.area.toFixed(2).padStart(8)}  ${String(e.n).padStart(4)} tri pairs  ${e.k}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
