// OB-152: chest vs enemy density per region -> docs/test-reports/ob152-density.md. Run: node tools/density-report.mjs [--write]
// Counts chest* entities (= chestDefs keys), beasts by kind (authored + WM-12 regional herds), goblins (authored + far camps).
import { World } from '../engine/index.js';
import paletteMod from '../design/palette.js';
import detailPassMod from '../design/detail-pass.js';
import terrainMod from '../design/levels/overworld_far.js';
import geoMod from '../design/levels/world_geo.js';
import '../design/models/lantern.js'; import '../design/models/lever.js'; import '../design/models/boulder.js';
import '../design/models/rubble.js'; import '../design/models/wreckage.js'; import '../design/models/relay.js';
import '../design/models/sword.js'; import '../design/models/m3_props.js'; import '../design/models/far_tower.js';
import '../design/models/ferrum_lights.js'; import '../design/models/voxel_beast.js'; import '../design/models/voxel_bear.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { spawnRegionalBeasts, inPolygon } from '../game/js/quest/sim/regionalBeasts.js';
import { generateFarCamps } from '../game/js/life/farCamps.js';
import { activeCamps } from '../game/js/life/goblinCamps.js';
import { readFileSync, writeFileSync } from 'node:fs';
globalThis.window = globalThis;
paletteMod; detailPassMod; terrainMod; geoMod;
const G = globalThis.ASSETS.levels.world_geo;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'grid' });
const quiet = (f) => { const c = console.warn; console.warn = () => {}; try { return f(); } finally { console.warn = c; } };
quiet(() => spawnRegionalBeasts(w, G, 12));
const camps = JSON.parse(readFileSync(new URL('../content/life/goblinCamps.json', import.meta.url), 'utf8'));

const regionOf = (x, y) => { for (const r of G.regions) if (x >= r.r[0] && x < r.r[2] && y >= r.r[1] && y < r.r[3]) return r.id; return G.regions[G.regions.length - 1].id; };
const kindOf = (e) => { const m = JSON.stringify(e.components?.voxel?.model || e.model || '') + e.id; return /boar/i.test(m) ? 'boars' : /wolf/i.test(m) ? 'wolves' : /croc/i.test(m) ? 'crocs' : /bear/i.test(m) ? 'bears' : 'other'; };
const row = () => ({ chests: 0, boars: 0, wolves: 0, bears: 0, crocs: 0, goblins: 0, other: 0, area: 0 });
const T = {}; for (const r of G.regions) T[r.id] = row();
const chests = [], threats = [], puzzles = [];

w.forEachEntity((e) => {
  const t = e.transform; if (!t) return;
  if (/^chest/.test(e.id)) { T[regionOf(t.x, t.y)].chests++; chests.push({ id: e.id, x: t.x, y: t.y }); }
  const b = e.components?.brain;
  if (b?.kind === 'beast') { const k = kindOf(e), h = b.home || [t.x, t.y]; T[regionOf(h[0], h[1])][k]++; threats.push([h[0], h[1]]); }
  if (/lever|plate|waystone/i.test(e.id) || e.components?.waystone) puzzles.push([t.x, t.y]);
});
const homes = threats.slice();
const far = generateFarCamps({ geo: G, terrain: w.terrain, seed: 12, avoid: homes });
for (const c of [...activeCamps(camps), ...far]) { T[regionOf(c.at[0], c.at[1])].goblins += c.members.length; threats.push(c.at); }

// area: 8 m grid samples inside the walk bounds, first-match region
for (let x = 4; x < 2048; x += 8) for (let y = 4; y < 1720; y += 8) if (inPolygon(G.bounds.pts, x, y)) T[regionOf(x, y)].area += 64;

const f1 = (n) => n.toFixed(1);
let md = '# OB-152 enemy / chest density per region (tools/density-report.mjs)\n\n';
md += 'Chests = `chest*` entities of world_m1 (= chestDefs keys). Beasts = authored + WM-12 regional herds; goblins = authored camps + far camps (seed 12). km2 = walk-bounds area by 8 m sampling (first-match region rect).\n\n';
md += '| region | chests | boars | wolves | bears | crocs | goblins | km2 | chests/km2 | enemies/km2 |\n|---|---|---|---|---|---|---|---|---|---|\n';
const tot = row();
for (const r of G.regions) {
  const t = T[r.id]; if (!t.area && !t.chests && !t.boars && !t.wolves && !t.bears && !t.crocs && !t.goblins) continue;
  const km = t.area / 1e6, en = t.boars + t.wolves + t.bears + t.crocs + t.goblins;
  md += `| ${r.id} | ${t.chests} | ${t.boars} | ${t.wolves} | ${t.bears} | ${t.crocs} | ${t.goblins} | ${f1(km)} | ${km ? f1(t.chests / km) : '-'} | ${km ? f1(en / km) : '-'} |\n`;
  for (const k of Object.keys(tot)) tot[k] += t[k];
}
md += `| TOTAL | ${tot.chests} | ${tot.boars} | ${tot.wolves} | ${tot.bears} | ${tot.crocs} | ${tot.goblins} | ${f1(tot.area / 1e6)} | ${f1(tot.chests / (tot.area / 1e6))} | ${f1((tot.boars + tot.wolves + tot.bears + tot.crocs + tot.goblins) / (tot.area / 1e6))} |\n\n`;
const near = (p, list, d) => list.some((q) => Math.hypot(q[0] - p.x, q[1] - p.y) < d);
const open = chests.filter((c) => !near(c, threats, 25) && !near(c, puzzles, 25));
md += `## Chests in the open (no beast home, goblin camp, relay or lever within 25 m): ${open.length} of ${chests.length}\n\n`;
for (const c of open) md += `- ${c.id} (${c.x}, ${c.y}) in ${regionOf(c.x, c.y)}\n`;
console.log(md);
if (process.argv.includes('--write')) writeFileSync(new URL('../docs/test-reports/ob152-density.md', import.meta.url), md);
