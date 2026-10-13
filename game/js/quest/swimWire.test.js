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

let fails = 0; const ok = (n, c, d) => { if (!c) { fails++; console.log('FAIL', n, d === undefined ? '' : d); } };
const dt = 1 / 60;
const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const iW = main.indexOf('wading.before('), iF = main.indexOf('swimWire.before('), iI = main.indexOf('integrate(playerHandle.data, dt, controls');
ok('main.js: wading.before < swimWire.before < integrate', iW > 0 && iW < iF && iF < iI, [iW, iF, iI]);
ok('main.js: no wading.after / wadeRescue / wadeDeep', !/wading\.after\(|wadeRescue|wadeDeep/.test(main.replace(/\/\/.*$/gm, '')));
ok('main.js: gate shut while swimming + gear views hidden + fb.under', /gateOpen = .*swimWire\.active/.test(main) && /!swimGear && engine\.world\.state\['tower\.sword\.taken'\]/.test(main) && /under: makeUnderState\(\)/.test(main));
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
ok('clip placeholder = idle', wire.clipFor(e, true) === 'idle' && wire.clipFor(e, false) === 'idle');
console.log(`swimWire: ${fails ? 'FAIL' : 'ok'}`); process.exit(fails ? 1 : 0);
