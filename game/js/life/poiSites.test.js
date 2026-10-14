// POI-01: generated points of interest. Run: node game/js/life/poiSites.test.js
// >= 12 POIs (heartland + Thornwood + Ford-west), walkable/in region/in bounds, clear of authored entities, unique ids, deterministic, NEEDS WRITER list.
import { World } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import geoMod from '../../../design/levels/world_geo.js';
import '../../../design/models/lantern.js'; import '../../../design/models/lever.js'; import '../../../design/models/boulder.js';
import '../../../design/models/rubble.js'; import '../../../design/models/wreckage.js'; import '../../../design/models/relay.js';
import '../../../design/models/sword.js'; import '../../../design/models/m3_props.js'; import '../../../design/models/far_tower.js';
import '../../../design/models/ferrum_lights.js'; import '../../../design/models/voxel_beast.js'; import '../../../design/models/voxel_bear.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { makeWalkable, inPolygon } from '../quest/sim/regionalBeasts.js';
import { generatePois, authoredPoints, needsWriter, AUTHORED_GAP } from './poiSites.js';
import { POI_ROWS, POI_TABLES, KINDS } from './poiTable.js';

paletteMod; detailPassMod; terrainMod;
const G = globalThis.ASSETS.levels.world_geo; geoMod;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const def = assets.world('world_m1');
const w = World.load(def, assets, { physics: 'grid' });
const avoid = authoredPoints(def.entities);
const a = generatePois({ geo: G, terrain: w.terrain, seed: 12, avoid });
const b = generatePois({ geo: G, terrain: w.terrain, seed: 12, avoid });
const walk = makeWalkable(w.terrain, G.bounds);

ok('at least 12 POIs', a.length >= 12, String(a.length));
ok('every table row produced a POI (none lost to placement)', a.length === POI_ROWS.length, `${a.length}/${POI_ROWS.length}`);
ok('deterministic: two runs identical', JSON.stringify(a) === JSON.stringify(b));
ok('seed changes at least one position', JSON.stringify(generatePois({ geo: G, terrain: w.terrain, seed: 99, avoid })) !== JSON.stringify(a));
ok('ids unique and poi.<key>.<n>', new Set(a.map((d) => d.id)).size === a.length && a.every((d) => /^poi\.[A-Za-z0-9]+\.\d+$/.test(d.id)));
ok('all on walkable non-water ground inside bounds', a.every((d) => inPolygon(G.bounds.pts, d.at[0], d.at[1]) && walk(d.at[0], d.at[1]) && w.terrain.typeAt(d.at[0], d.at[1]) !== 2));
ok('inside their region rect (rows with a region)', a.every((d) => { if (!POI_ROWS.find((r) => r.key === d.key).region) return true; const r = (G.regions.find((g) => g.id === d.region) || { r: [0, 0, 2048, 2048] }).r; return d.at[0] > r[0] && d.at[0] < r[2] && d.at[1] > r[1] && d.at[1] < r[3]; }));
ok(`>= ${AUTHORED_GAP} m from every authored entity (no building/rock/chest overlap)`, a.every((d) => avoid.every((p) => Math.hypot(p[0] - d.at[0], p[1] - d.at[1]) >= AUTHORED_GAP)));
ok('>= 20 m from each other', a.every((d, i) => a.every((e, j) => i === j || Math.hypot(d.at[0] - e.at[0], d.at[1] - e.at[1]) >= 20)));
ok('within 70 m of their world_geo site', a.every((d) => { const s = G.sites.find((x) => x.n === d.site); return s && Math.hypot(s.x - d.at[0], s.y - d.at[1]) <= 71; }));
ok('no site flagged ex:1 is built', a.every((d) => !G.sites.find((x) => x.n === d.site).ex));
ok('regions covered: heartland, thornwood, outwall', ['heartland', 'thornwood', 'outwall'].every((r) => a.some((d) => d.region === r)));
ok('chest-kind POIs have a loot table from POI_TABLES', a.filter((d) => d.props.some((p) => p.chest)).every((d) => d.table && Object.values(POI_TABLES).includes(d.table)));
ok('every kind is a known template', a.every((d) => KINDS[d.kind]));
ok('NEEDS WRITER list has one line per POI', needsWriter(a).length === a.length && needsWriter(a).every((s) => s.startsWith('NEEDS WRITER: poi.')));
ok('no counter / total strings in defs', !JSON.stringify(a).match(/\d+\/\d+ found/));

console.log(`poiSites: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
