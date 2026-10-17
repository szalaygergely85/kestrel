// BEAST-09a: regional river crocodiles. Spawn only in ford / river (heartland rect) / reedmire, 1 per group, every home on a water-mask-1 cell
// of the real world_m1 nav grid, deterministic, and each becomes a waterBrain slot (sim.wat) drawing model 'crocodile'.
// Run: node game/js/quest/sim/crocSpawn.test.js
import { World, NavGrid, createRng } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import geoMod from '../../../../design/levels/world_geo.js';
import '../../../../design/models/lantern.js'; import '../../../../design/models/lever.js'; import '../../../../design/models/boulder.js';
import '../../../../design/models/rubble.js'; import '../../../../design/models/wreckage.js'; import '../../../../design/models/relay.js';
import '../../../../design/models/sword.js'; import '../../../../design/models/m3_props.js'; import '../../../../design/models/far_tower.js';
import '../../../../design/models/ferrum_lights.js'; import '../../../../design/models/voxel_beast.js'; import '../../../../design/models/voxel_bear.js';
import '../../../../design/models/voxel_crocodile.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { buildBeastNav, buildWaterNav } from './beastNav.js';
import { createBand } from './band.js';
import { createBeastSim } from './beastSim.js';
import { spawnRegionalBeasts, generateRegionalBeasts, worldWaterProbe, REGION_RULES } from './regionalBeasts.js';

paletteMod; detailPassMod; terrainMod; geoMod;
const G = globalThis.ASSETS.levels.world_geo; G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const def = assets.world('world_m1');
const quiet = (f) => { const w = console.warn; console.warn = () => {}; try { return f(); } finally { console.warn = w; } };
const mk = () => World.load(def, assets, { physics: 'grid' });
const crocs = (w) => { const out = []; w.forEachEntity((e) => { if (/^croc\./.test(String(e.id))) out.push(e); }); return out; };

const w1 = mk(), w2 = mk();
quiet(() => spawnRegionalBeasts(w1, G, 12)); quiet(() => spawnRegionalBeasts(w2, G, 12));
const c1 = crocs(w1), c2 = crocs(w2);
ok('crocs spawn (>= 3) and are the same twice', c1.length >= 3 && JSON.stringify(c1.map((e) => [e.id, e.transform.x, e.transform.y])) === JSON.stringify(c2.map((e) => [e.id, e.transform.x, e.transform.y])), 'n=' + c1.length);

const waterRules = REGION_RULES.filter((r) => r.water);
const okRegion = (e) => { const b = e.id.split('.'); return waterRules.some((r) => r.key === b[1]); };
ok('every croc id is <croc>.<ford|river|reedmireWater>.n, 1 per group', c1.every(okRegion) && new Set(c1.map((e) => e.id)).size === c1.length && waterRules.every((r) => r.size === 1));
ok('model crocodile + beastKind river_crocodile', c1.every((e) => e.components.voxel.model === 'crocodile' && e.components.brain.beastKind === 'river_crocodile'));
const inRule = (e) => waterRules.some((r) => { const reg = G.regions.find((g) => g.id === r.region), rc = r.rect || reg.r; return e.id.split('.')[1] === r.key && e.transform.x > rc[0] && e.transform.x < rc[2] && e.transform.y > rc[1] && e.transform.y < rc[3]; });
ok('every croc lies inside its rule rect (ford / river reach / reedmire)', c1.every(inRule));
ok('no croc without a water probe (old callers unchanged)', generateRegionalBeasts({ geo: G, terrain: w1.terrain, seed: 12, avoid: [] }).every((b) => b.species !== 'croc'));
ok('different seed -> different croc homes', JSON.stringify(generateRegionalBeasts({ geo: G, terrain: w1.terrain, seed: 13, avoid: [], water: worldWaterProbe(w1) }).filter((b) => b.species === 'croc')) !== JSON.stringify(generateRegionalBeasts({ geo: G, terrain: w1.terrain, seed: 12, avoid: [], water: worldWaterProbe(w1) }).filter((b) => b.species === 'croc')));

// real nav grid + water mask: every home on mask 1
const nav = quiet(() => buildBeastNav(w1, def.nav));
const grid = new NavGrid({ x0: def.nav.area.x0, y0: def.nav.area.y0, w: def.nav.area.w, h: def.nav.area.h, cell: def.nav.cell });
const wn = buildWaterNav(w1, grid);
const off = c1.filter((e) => { const cx = grid.cellX(e.transform.x), cy = grid.cellY(e.transform.y); return !grid.inBounds(cx, cy) || wn.mask[cy * grid.w + cx] !== 1; }).map((e) => e.id);
ok('every croc home is on a water-mask-1 cell of the world_m1 nav grid', off.length === 0, off.join(','));

// sim: each croc becomes a water slot
const events = { emit() {}, on() { return () => {}; } };
const sim = quiet(() => createBeastSim(w1, { nav, rng: createRng(1), events, band: createBand(G.regions), tileNav: true, spawn: { x: 1480, y: 1030 }, waterNav: wn }));
const notWat = c1.filter((e) => sim.wat[sim.slotOf(e.id)] !== 1).map((e) => e.id);
ok('every croc is a water slot (sim.wat = 1) in the sim', notWat.length === 0 && sim.wb && c1.length > 0, notWat.join(','));
ok('croc slots are croc-type in waterBrain (lunge attack row)', c1.every((e) => sim.wb.croc[sim.slotOf(e.id)] === 1));
ok('all other spawned beasts stay land slots', (() => { let bad = 0; for (let i = 0; i < sim.count; i++) if (sim.wat[i] === 1 && !/^croc\./.test(String(sim.entities[i].id))) bad++; return bad === 0; })());

console.log(`crocSpawn: ${pass} pass, ${fail} fail`); if (fail) { console.log(failures.join('\n')); process.exit(1); }
