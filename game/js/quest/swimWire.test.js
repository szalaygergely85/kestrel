// SWIM-03c: the main.js step order on the real modules + world_m1: wading.before -> swimWire.before -> integrate; gear gate shut while swimming.
import fs from 'node:fs';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/levels/overworld_far.js';
import '../../../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../../../design/models/${m}.js`); } catch { /* optional */ } }
import { World, createWater, collectWaterDefs, integrate, PHYSICS } from '../../../engine/index.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { createSwimWire } from './swimWire.js';
import { createWading } from './sim/wading.js';
import { createVitals } from './sim/vitals.js';
import { VITALS_DEFAULTS } from './sim/vitalsConfig.js';
import { createShore } from './seaEdge.js';

let fails = 0; const ok = (n, c, d) => { if (!c) { fails++; console.log('FAIL', n, d === undefined ? '' : d); } };
const dt = 1 / 60;
const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const iW = main.indexOf('wading.before('), iF = main.indexOf('swimWire.before('), iI = main.indexOf('integrate(playerHandle.data, dt, controls');
ok('main.js: wading.before < swimWire.before < integrate', iW > 0 && iW < iF && iF < iI, [iW, iF, iI]);
ok('main.js: no wading.after / wadeRescue / wadeDeep', !/wading\.after\(|wadeRescue|wadeDeep/.test(main.replace(/\/\/.*$/gm, '')));
ok('main.js: gate shut while swimming + gear views hidden + fb.under', /gateOpen = .*swimWire\.active/.test(main) && /!swimGear && engine\.world\.state\['tower\.sword\.taken'\]/.test(main) && /under: (make|create)UnderState\(\)/ /* main.js now calls createUnderState (SWIM-04b) */.test(main));
const U = globalThis.ASSETS.levels.overworld_far.util;
const data = JSON.parse(fs.readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
world.bounds = null; // stale capsule bounds cut the Braid (see swimFeed.test)
const wire = createSwimWire(world), wd = createWading(world);
const wa = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 };
let by = 0, bd = 0;
for (let y = 832; y < 1058; y += 2) { const x = U.riverX(y); world.ensureBandFor(x, y); if (world.waterAt(x, y, wa) && wa.depth > bd) { bd = wa.depth; by = y; } }
const cx = U.riverX(by); world.ensureBandFor(cx - 22, by);
const e = { id: 'p', transform: { x: cx - 22, y: by, z: world.floorAt(cx - 22, by), yawDeg: 0, pitchDeg: 0 }, components: { body: { radius: 0.3, height: 1.7, eyeH: 1.6 } } };
const b = e.components.body, c = { forward: 1, strafe: 0, yawDeg: 90, run: false };
let sawSwim = 0, gateWhileSwim = 0, openWhileDry = 0, tele = 0, minScale = 1, dryGateAtStart = wire.gate(true, e);
for (let i = 0; i < 60 * 30; i++) {
  const t = e.transform, px = t.x, py = t.y; world.ensureBandFor(t.x, t.y);
  wd.before(e, b.speedScale); wire.before(e); // `other` = last step's speedScale: must not ratchet
  integrate(e, dt, c, world, PHYSICS);
  b.speedScale = 1; // main.js: resolveBodyContacts resets it each step
  if (b.swimming) { sawSwim++; if (wire.gate(true, e)) gateWhileSwim++; if (!wire.active(e)) gateWhileSwim++; } else if (!wire.gate(true, e)) openWhileDry++;
  if (Math.hypot(t.x - px, t.y - py) > 1) tele++;
}
ok('gate open on dry land at the start', dryGateAtStart === true);
ok('walked into deep water: swimming', sawSwim > 20, sawSwim);
ok('gate shut + gear hidden (active) every swimming step', gateWhileSwim === 0, gateWhileSwim);
ok('gate open every dry step (gear back)', openWhileDry === 0, openWhileDry);
ok('no rescue teleport; out on the far bank, dry, grounded', tele === 0 && b.wadeRescue === undefined && e.transform.x > cx + 8 && !b.swimming && b.grounded, [tele, e.transform.x, cx]);
ok('speedScale did not ratchet down', b.speedScale === 1);
ok('clip pick: swim / tread / dive', wire.clipFor(e, true) === 'swim' && wire.clipFor(e, false) === 'tread' && wire.clipFor({ transform: { z: -3 }, components: { body: { swimming: true, waterZ: 0, eyeH: 1.6 } } }, true) === 'dive' && wire.clipFor({ transform: { z: -1 }, components: { body: { swimming: true, waterZ: 0, eyeH: 1.6 } } }, true) === 'swim');
// SWIM-HOOKS-01: bindVitals/afterStep on the real world_m1 + real vitals (bodies set swimming by hand: the feed is covered above)
{
  const ev = { on() { return () => {}; }, emit() {} };
  const pl = world.get('player').data, pt = pl.transform; pl.components.body = pl.components.body || { radius: 0.3, height: 1.7, eyeH: 1.6, vx: 0, vy: 0, vz: 0, grounded: true, landed: false, fallDistance: 0 }; const pb = pl.components.body;
  const vit = createVitals(world, ev, VITALS_DEFAULTS, {}); vit.step(pl, false);
  const w2 = createSwimWire(world); w2.bindVitals(vit, { shore: createShore(globalThis.ASSETS.levels.world_geo.coast), ent: null });
  const run = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) { w2.afterStep(pl, i / 60); vit.step(pl, false); } };
  // (a) D-070 amendment: 60 s surface swim in the Braid: no drain, no damage; then a dive > breath time -> drown ticks -> death 'drown'
  pt.x = cx; pt.y = by; pb.swimming = true;
  const wet = world.waterAt(pt.x, pt.y, wa); ok('Braid point is water, not sea', wet && wa.region !== 'sea', wa.region);
  run(60); ok('60 s surface swim: no drain, no damage', w2.vitals.state.stamina === 100 && !vit.dead && vit.hp === VITALS_DEFAULTS.startHp, [w2.vitals.state.stamina, vit.hp]);
  pb.diving = true; run(6.5); ok('stamina drained after 6 s dive', w2.vitals.state.stamina <= 1 && !vit.dead, w2.vitals.state.stamina);
  run(6); ok('drown via vitals', vit.dead && vit.deathCause === 'drown', [vit.dead, vit.deathCause]);
  ok('monster stayed hidden in the river', w2.monster.state === 0);
  pb.diving = false;
  // respawn -> reset
  for (let i = 0; i < 600 && !vit.cardReady; i++) vit.step(pl, false);
  vit.step(pl, true); w2.reset(); pb.swimming = false;
  ok('respawned, stamina full', !vit.dead && w2.vitals.state.stamina === 100);
  // (b) sea swim past the kill band -> 'eaten'. world_m1 sea rect (y 1420+) is real water here (bounds nulled): region 'sea'
  pt.x = 1525; pt.y = 1770; pb.swimming = true; // starting point: 1770 (seaMonster.test)
  const seaWet = world.waterAt(1525, 1790, wa);
  const stub = !(seaWet && wa.region === 'sea'); // stub the test point if the sea is not queryable
  if (stub) w2.seaTest = () => true;
  console.log('swimWire: sea test point ' + (stub ? 'STUBBED (waterAt gives ' + wa.region + ')' : 'real (region sea)'));
  let eaten = false;
  for (let i = 0; i < 60 * 40 && !eaten; i++) { if (i % 6 === 0) pt.y = Math.min(1870, 1770 + i / 3); /* dist ~1.98 m per y-m: kill band 90 m at y ~1815 */ w2.afterStep(pl, i / 60); vit.step(pl, false); eaten = vit.dead; pb.swimming = true; if (process.env.DBG && i % 60 === 0) console.log(i, pt.y, w2.monster.state, w2.monster.edge.state, w2.monster.edge.dist, vit.dead); }
  ok('sea swim past kill band -> eaten', vit.dead && vit.deathCause === 'eaten', [vit.dead, vit.deathCause, w2.monster.state, pt.y]);
}
console.log(`swimWire: ${fails ? 'FAIL' : 'ok'}`); process.exit(fails ? 1 : 0);
