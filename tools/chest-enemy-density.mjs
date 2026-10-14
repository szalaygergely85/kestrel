// OB152-DENSITY (OB-152 count step): per world_geo region, chests vs enemy groups / puzzle props. No content change.
// Run: node tools/chest-enemy-density.mjs [--max-loose N]   exit 1 when any region has more than N loose chests (default: off).
// "guarded" chest = an enemy group (beast home / goblin camp) or puzzle prop within RADIUS m; otherwise "loose".
import { pathToFileURL } from 'node:url';
export const RADIUS = 25;
export const DIVE_GUARDED = new Set(['chestBed']); // lake-bed chest: earned by the dive itself (SWIM-04d, same as content-lint R8_OK)
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
  const guardsOf = guards.filter((g) => g.kind === 'beast' || g.kind === 'camp' || g.kind === 'puzzle');
  for (const c of chests) {
    const row = rows[at(c)]; row.chests++;
    if (guardsOf.some((g) => Math.hypot(g.x - c.x, g.y - c.y) <= radius)) row.guarded++; else { row.loose++; row.looseIds.push(c.id); }
  }
  for (const r of rows) { r.perGroup = r.groups ? +(r.chests / r.groups).toFixed(2) : null; r.looseIds.sort(); }
  return rows;
}
export const fmt = (rows) => [
  'region            chests guarded loose groups puzzles chests/group',
  ...rows.map((r) => `${String(r.id).padEnd(17)} ${String(r.chests).padStart(6)} ${String(r.guarded).padStart(7)} ${String(r.loose).padStart(5)} ${String(r.groups).padStart(6)} ${String(r.puzzles).padStart(7)} ${r.perGroup === null ? '-' : r.perGroup}`),
].join('\n');
async function main() {
  const argv = process.argv.slice(2), mi = argv.indexOf('--max-loose'), max = mi >= 0 ? Number(argv[mi + 1]) : null;
  const { buildContext } = await import('./content-lint.mjs');
  const ctx = await buildContext({});
  const regions = globalThis.ASSETS.levels.world_geo.regions;
  const rows = density(regions, ctx.chests.filter((c) => !DIVE_GUARDED.has(c.id)), ctx.guards.filter((g) => g.kind !== 'giver'));
  console.log(fmt(rows));
  const over = max === null ? [] : rows.filter((r) => r.loose > max);
  for (const r of over) console.log(`loose > ${max}: ${r.id} (${r.loose}): ${r.looseIds.join(' ')}`);
  process.exit(over.length ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
