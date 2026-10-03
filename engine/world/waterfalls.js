// US-142a1 (35.1): waterfall content, converted once through placed level frames.
import { localToWorld } from '../core/transform.js';
import { buildSheetMesh } from '../mesh/waterfallMesh.js';

export const WATERFALL_MAX = 8;
export function collectWaterfallDefs(def, structures) {
  const out = [], seen = new Set(), p = {}, q = {};
  const add = (r, frame, prefix) => {
    const id = prefix + (r && r.id || '');
    const bad = (msg) => { throw new Error(`World.load: waterfall "${id}": ${msg}`); };
    if (!r || typeof r.id !== 'string' || !r.id) bad('id is required');
    if (!Array.isArray(r.lip) || r.lip.length !== 4 || !r.lip.every(Number.isFinite)) bad('lip must be four finite numbers');
    if (Math.hypot(r.lip[2] - r.lip[0], r.lip[3] - r.lip[1]) === 0) bad('lip must have nonzero length');
    if (!Number.isFinite(r.z) || !Number.isFinite(r.outDeg)) bad('z and outDeg must be finite');
    if (!Number.isFinite(r.drop) || !(r.drop >= 2 && r.drop <= 20)) bad('drop must be 2..20 m');
    if (r.out !== undefined && (!Number.isFinite(r.out) || r.out <= 0)) bad('out must be finite and positive');
    if (r.look !== undefined && (typeof r.look !== 'string' || !r.look)) bad('look must be a nonempty string');
    if (seen.has(id)) bad('duplicate id');
    if (out.length === WATERFALL_MAX) bad('more than 8 waterfalls');
    seen.add(id);
    let lip = r.lip.slice(), z = r.z, outDeg = r.outDeg;
    if (frame) {
      localToWorld(frame, lip[0], lip[1], z, p); localToWorld(frame, lip[2], lip[3], z, q);
      lip = [p.x, p.y, q.x, q.y]; z = p.z; outDeg += 90 * (frame.yawSteps || 0);
    }
    out.push({ id, lip, z, drop: r.drop, outDeg, out: r.out === undefined ? 1.5 : r.out, look: r.look || 'water' });
  };
  for (const r of def.waterfalls || []) add(r, null, '');
  for (const s of structures || []) for (const r of s.level && s.level.def.waterfalls || []) add(r, s.frame, `${s.id}.`);
  return out;
}

export function createWaterfalls(defs) {
  return defs.map((def) => ({ ...def, mesh: buildSheetMesh(def) }));
}
