// OB152-DENSITY (OB-152 count step): per world_geo region, chests vs enemy groups / puzzle props. No content change.
// Run: node tools/chest-enemy-density.mjs [--max-loose N]   exit 1 when any region has more than N loose chests (default: off).
// "guarded" chest = an enemy group (beast home / goblin camp) or puzzle prop within RADIUS m; otherwise "loose".
import { pathToFileURL } from 'node:url';
export const RADIUS = 15; // OB-179: enemy group (beast home / camp) must be this close; 25 m let roadside chests count as guarded
export const PUZZLE_R = 10, POI_R = 12; // lever/plate within PUZZLE_R; a ruin/camp site within POI_R (waystones and relays do not guard)
/** G.sites ruins/camps -> guards (kind 'poi'); waystone/relay 'puzzle' guards are dropped (they only light a path, they do not defend a chest) */
export const INTERIORS = [{ id: 'forge', x: 912.5, y: 935 }]; // Outwall forge house (ow171..190 footprint 908-917 x 932-937): a chest inside a structure is earned
export const guardsFor = (guards, sites = [], extra = []) => [
  ...extra,
  ...guards.filter((g) => g.kind === 'beast' || g.kind === 'camp' || (g.kind === 'puzzle' && /lever|plate/i.test(g.id || ''))),
  ...[...INTERIORS.map((i) => ({ t: 'R', x: i.x, y: i.y })), ...sites.filter((s) => s.t === 'R' || s.t === 'C')].map((s) => ({ x: s.x, y: s.y, kind: 'poi' })),
];
const reach = (g, radius) => g.kind === 'puzzle' ? PUZZLE_R : g.kind === 'poi' ? POI_R : radius;
export const DIVE_GUARDED = new Set(['chestBed']); // lake-bed chest: earned by the dive itself (SWIM-04d, same as content-lint R8_OK)
// OB-152: a chest in an underground structure (Ford cellar, cemetery crypt: keepTerrain levels, entity z far below the surface) is hidden/hard to reach = earned
export const UNDERGROUND_Z = -20;
export const isUnderground = (e) => typeof e.z === 'number' && e.z < UNDERGROUND_Z;
export const isChest = (e) => e.components?.voxel?.model === 'chestSmall' || /^(chest|secret)[A-Z]/.test(e.id || ''); // any chest model / chest id
const inRect = (r, x, y) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
/** regions: [{id,r:[x0,y0,x1,y1]}] (first match wins, like regionAt); chests [{id,x,y}]; guards [{x,y,kind:'beast'|'camp'|'puzzle'}]. Returns one row per region. */
export function density(regions, chests, guards, radius = RADIUS) {
  const at = (p) => { const i = regions.findIndex((g) => inRect(g.r, p.x, p.y)); return i < 0 ? regions.length - 1 : i; };
  const rows = regions.map((g) => ({ id: g.id, chests: 0, guarded: 0, loose: 0, groups: 0, puzzles: 0, perGroup: null, looseIds: [] }));
  const seen = new Set();
  for (const g of guards) { // enemy groups = distinct beast homes / camps (entities sharing a home are one group)
    const k = g.kind + ':' + g.x.toFixed(0) + ',' + g.y.toFixed(0); if (seen.has(k)) continue; seen.add(k);
    const row = rows[at(g)]; if (g.kind === 'puzzle') row.puzzles++; else if (g.kind === 'beast' || g.kind === 'camp') row.groups++;
  }
  const guardsOf = guards.filter((g) => g.kind === 'beast' || g.kind === 'camp' || g.kind === 'puzzle' || g.kind === 'poi');
  for (const c of chests) {
    const row = rows[at(c)]; row.chests++;
    if (guardsOf.some((g) => Math.hypot(g.x - c.x, g.y - c.y) <= reach(g, radius))) row.guarded++; else { row.loose++; row.looseIds.push(c.id); }
  }
  for (const r of rows) { r.perGroup = r.groups ? +(r.chests / r.groups).toFixed(2) : null; r.looseIds.sort(); }
  return rows;
}
export const fmt = (rows) => [
  'region            chests guarded loose groups puzzles chests/group',
  ...rows.map((r) => `${String(r.id).padEnd(17)} ${String(r.chests).padStart(6)} ${String(r.guarded).padStart(7)} ${String(r.loose).padStart(5)} ${String(r.groups).padStart(6)} ${String(r.puzzles).padStart(7)} ${r.perGroup === null ? '-' : r.perGroup}`),
].join('\n');
export const ROAD_VISIBLE = 25; // closer than this to a road/path edge = seen from the road
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a[0] - t * dx, p.y - a[1] - t * dy); };
/** distance (m) from p to the nearest road/path edge; roads [{id,hw,pts}] */
export function roadDist(roads, p) { let best = [Infinity, '']; for (const r of roads) for (let i = 0; i < r.pts.length - 1; i++) { const d = segD(p, r.pts[i], r.pts[i + 1]) - (r.hw || 0); if (d < best[0]) best = [d, r.id]; } return best; }
/** every chest: nearest guard + road distance + verdict (ok = guarded / dive-guarded, LOOSE otherwise) */
export function listChests(regions, chests, guards, roads, radius = RADIUS) {
  const gs = guards;
  return chests.map((c) => {
    let g = [Infinity, '-']; for (const q of gs) { const d = Math.hypot(q.x - c.x, q.y - c.y); if (d < g[0]) g = [d, q.kind]; }
    const rd = roadDist(roads, c), ri = regions.find((r) => inRect(r.r, c.x, c.y));
    const dive = DIVE_GUARDED.has(c.id), ok = dive || c.z < UNDERGROUND_Z || gs.some((q) => Math.hypot(q.x - c.x, q.y - c.y) <= reach(q, radius));
    return { id: c.id, x: c.x, y: c.y, z: c.z, region: ri ? ri.id : '-', guardKind: g[1], guardM: g[0], roadM: rd[0], road: rd[1], visible: rd[0] < ROAD_VISIBLE, verdict: dive ? 'ok (dive)' : c.z < UNDERGROUND_Z ? 'ok (underground)' : ok ? 'ok' : 'LOOSE' };
  });
}
async function main() {
  const argv = process.argv.slice(2), mi = argv.indexOf('--max-loose'), max = mi >= 0 ? Number(argv[mi + 1]) : null;
  const { buildContext } = await import('./content-lint.mjs');
  const ctx = await buildContext({});
  const regions = globalThis.ASSETS.levels.world_geo.regions;
  const G0 = globalThis.ASSETS.levels.world_geo;
  const scrawls = ctx.entities.filter((e) => e.id === 'hiddenScrawl').map((e) => ({ x: e.x, y: e.y, kind: 'puzzle', id: 'lever-scrawl' })); // chestHidden: the scrawl hint is its puzzle (within PUZZLE_R)
  const all = ctx.entities.filter(isChest); // every chest model (chestSmall: chest*, secret*), not just ids named chest*
  const rows = density(regions, all.filter((c) => !DIVE_GUARDED.has(c.id) && !isUnderground(c)), guardsFor(ctx.guards, G0.sites, scrawls));
  if (argv.includes('--list')) {
    const G = globalThis.ASSETS.levels.world_geo, l = listChests(regions, all, guardsFor(ctx.guards, G0.sites, scrawls), [...(G.roads || []), ...(G.paths || [])]);
    for (const r of l) console.log(`${r.id.padEnd(16)} ${r.region.padEnd(10)} (${r.x},${r.y}) guard ${r.guardKind} ${Number.isFinite(r.guardM) ? r.guardM.toFixed(0) : '-'}m  road ${r.roadM.toFixed(0)}m (${r.road})${r.visible ? ' VISIBLE' : ''}  ${r.verdict}`);
  }
  console.log(`chests counted: ${all.length}`);
  console.log(fmt(rows));
  const over = max === null ? [] : rows.filter((r) => r.loose > max);
  for (const r of over) console.log(`loose > ${max}: ${r.id} (${r.loose}): ${r.looseIds.join(' ')}`);
  process.exit(over.length ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
