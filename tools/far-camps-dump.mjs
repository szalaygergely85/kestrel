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
import { planWorldLife } from '../game/js/quest/sim/worldGen.js';
import { ensureGoblinCamps, activeCamps } from '../game/js/life/goblinCamps.js';
import { readFileSync } from 'node:fs';

paletteMod; detailPassMod; terrainMod; geoMod;
const G = globalThis.ASSETS.levels.world_geo;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'grid' });
// boot like main.js: authored goblin camps first (their homes are authored avoid points), then the shared plan (herd -> far camps)
const goblinJson = JSON.parse(readFileSync(new URL('../content/life/goblinCamps.json', import.meta.url), 'utf8'));
const warn = console.warn; console.warn = () => {};
let plan; try { ensureGoblinCamps(w, activeCamps(goblinJson), w.terrain); plan = planWorldLife(w, G, 12); } finally { console.warn = warn; }
process.stdout.write('@@CAMPS@@' + JSON.stringify({ camps: plan.camps, bounds: G.bounds, regions: G.regions.map((g) => ({ id: g.id, r: g.r })) }));
