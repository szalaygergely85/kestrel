// ED-AI-04: painted spawn areas from content/beasts/spawnAreas.json (edited by tools/editor/ai/model.js). Pure + deterministic.
// buildGroups (spawnDirector.js) appends one group per area AFTER the regional rules; an empty file adds nothing.
import data from '../../../../content/beasts/spawnAreas.json' with { type: 'json' };
import { hashU } from '../../life/schedule.js';
import { inPolygon } from './regionalBeasts.js';

export const SPAWN_AREAS = Object.freeze((data.areas || []).map((a) => Object.freeze({ ...a })));

function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** Deterministic id from the area id (never the array index): '<kind>.area.<8 hex of hash(area id)>'. */
export const areaGid = (a) => `${a.kind}.area.${strHash(a.id).toString(16).padStart(8, '0')}`;

function bounds(a) {
  if (a.shape === 'disc') return [a.x - a.r, a.y - a.r, a.x + a.r, a.y + a.r];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of a.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}
export function inArea(a, x, y) { return a.shape === 'disc' ? (x - a.x) * (x - a.x) + (y - a.y) * (y - a.y) <= a.r * a.r : inPolygon(a.pts, x, y); }

/** Members of one area: `count` spots inside it (rejection sampling on hashU, rounded to 0.5 m), centre fallback. */
export function areaMembers(a, seed, firstSlot, walkable) {
  const b = bounds(a), key = strHash(a.id), out = [];
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  for (let k = 0; k < a.count; k++) {
    let x = cx, y = cy;
    for (let t = 0; t < 40; t++) {
      const h1 = hashU(seed, key, k * 64 + t * 2), h2 = hashU(seed ^ 0x5bd1, key, k * 64 + t * 2 + 1);
      const px = Math.round((b[0] + (h1 / 4294967296) * (b[2] - b[0])) * 2) / 2, py = Math.round((b[1] + (h2 / 4294967296) * (b[3] - b[1])) * 2) / 2;
      if (inArea(a, px, py) && (!walkable || walkable(px, py))) { x = px; y = py; break; }
    }
    out.push({ id: `${a.kind}.${a.id}.${k + 1}`, kind: a.kind, key: a.id, group: 0, x, y, slot: firstSlot + k });
  }
  return out;
}

/** Group specs for the areas, sorted by area id so slots do not depend on file order. Returns [{ area, members }]. */
export function areaGroupSpecs(areas, seed, firstSlot, walkable) {
  const sorted = [...areas].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0)), out = [];
  let slot = firstSlot;
  for (const a of sorted) { const members = areaMembers(a, seed, slot, walkable); slot += members.length; out.push({ area: a, members }); }
  return out;
}
