// WMP-04 helper: prints the generated far camps (WMP-02) as JSON, booted like main.js / farCamps.test.js.
// Separate process because validate-content.mjs already registers the content levels in globalThis.ASSETS (loadTestAssets would clash).
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
import { generateFarCamps } from '../game/js/life/farCamps.js';
import { spawnRegionalBeasts } from '../game/js/quest/sim/regionalBeasts.js';

paletteMod; detailPassMod; terrainMod; geoMod;
const G = globalThis.ASSETS.levels.world_geo;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'grid' });
const warn = console.warn; console.warn = () => {};
try { spawnRegionalBeasts(w, G, 12); } finally { console.warn = warn; }
const homes = []; w.forEachEntity((e) => { const b = e.components?.brain; if (b?.kind === 'beast' && b.home) homes.push([b.home[0], b.home[1]]); });
process.stdout.write('@@CAMPS@@' + JSON.stringify({ camps: generateFarCamps({ geo: G, terrain: w.terrain, seed: 12, avoid: homes }), bounds: G.bounds, regions: G.regions.map((g) => ({ id: g.id, r: g.r })) }));
