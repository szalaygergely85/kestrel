// game/js/life/poiSites.js (POI-01, OB-141, D-088): points of interest GENERATED from world_geo.sites (no hand placement in the world file).
// Pure + deterministic (rule 15): the same geo / terrain / seed / avoid list gives identical defs. Def = {id, key, site, name, region, kind,
// at:[x,y], props, table?, fight?, guardian, textKey}. Placement: nearest ground to the site that is walkable (not water, slope ok, inside
// bounds + the region rect), >= AUTHORED_GAP m from authored entities (chests, ruins, rocks, beasts) and >= POI_GAP from other POIs.
import { makeWalkable, inPolygon } from '../quest/sim/regionalBeasts.js';
import { KINDS, POI_ROWS, POI_TABLES } from './poiTable.js';

export const AUTHORED_GAP = 8, POI_GAP = 20, MAX_PULL = 70, STEP = 2;

function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Positions of every authored entity of the world def (props, beasts, npcs; not the player). */
export function authoredPoints(entities) {
  const out = [];
  for (const e of entities || []) { if (e.type === 'player') continue; const t = e.transform || e; if (Number.isFinite(t.x) && Number.isFinite(t.y)) out.push([t.x, t.y]); }
  return out;
}

/** Text keys the writer still owes (one per POI). */
export function needsWriter(defs) { return defs.map((d) => 'NEEDS WRITER: ' + d.textKey); }

/**
 * @param {{geo:any, terrain:any, seed?:number, avoid?:Array<[number,number]>, rows?:any[]}} o
 * @returns {Array<object>} POI defs in table order (stable ids poi.<key>.<n>)
 */
export function generatePois(o) {
  const { geo, terrain } = o, seed = o.seed ?? 12, avoid = o.avoid || [], rows = o.rows || POI_ROWS;
  const walkable = makeWalkable(terrain, geo.bounds), out = [];
  for (const row of rows) {
    const site = (geo.sites || []).find((s) => s.n === row.site);
    if (!site || site.ex) continue; // sites that already exist in play data are not rebuilt
    const reg = row.region ? geo.regions.find((g) => g.id === row.region) : null, r = reg ? reg.r : null;
    const ok = (x, y) => (!r || (x > r[0] + 2 && x < r[2] - 2 && y > r[1] + 2 && y < r[3] - 2)) && inPolygon(geo.bounds.pts, x, y) && walkable(x, y)
      && !avoid.some((p) => Math.hypot(p[0] - x, p[1] - y) < AUTHORED_GAP) && !out.some((d) => Math.hypot(d.at[0] - x, d.at[1] - y) < POI_GAP);
    const rng = mulberry32(seed ^ strHash('poi.' + row.key));
    let at = null;
    // expanding ring search from the site; a seeded start angle varies the pick but stays deterministic
    for (let rad = 0; rad <= MAX_PULL && !at; rad += STEP) {
      const n = rad === 0 ? 1 : Math.max(8, Math.round(rad * 1.2)), a0 = rng() * 6.283185307;
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * 6.283185307, x = Math.round((site.x + Math.cos(a) * rad) * 2) / 2, y = Math.round((site.y + Math.sin(a) * rad) * 2) / 2;
        if (ok(x, y)) { at = [x, y]; break; }
      }
    }
    if (!at) continue;
    const tpl = KINDS[row.kind], id = `poi.${row.key}.1`;
    out.push({
      id, key: row.key, site: row.site, name: row.name, region: row.area || row.region || 'heartland', kind: row.kind, at,
      props: tpl.props.map((p) => ({ ...p, at: p.at.slice() })),
      table: row.table ? POI_TABLES[row.table] : null, tableKey: row.table || null,
      fight: row.fight ? { ...row.fight } : null, guardian: !!(row.fight && row.fight.guardian), textKey: `poi.${id}.text`,
    });
  }
  return out;
}
