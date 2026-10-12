// OB-073-D2f: the real recipe.carpet on world_m1 (World.load, geo installed as main.js does). validateCarpetConfig passes,
// and the class-map share per variant at 3 walk poses shows the intended field. Run: node engine/world/carpet.world.test.js
import { World } from './World.js';
import { validateCarpetConfig } from './carpet.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import '../../design/levels/world_geo.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; farTowerMod; ferrumLightsMod;

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const A = globalThis.ASSETS, far = A.levels.overworld_far, cfg = far.recipe.carpet;
if (A.levels.world_geo) A.levels.world_geo.util.installGeo(far.util);   // as main.js (?geo=1 default)
const { assets } = await loadTestAssets();
const world = World.load(assets.world('world_m1'), assets, { carpet: cfg });

// AC1: the real recipe validates against the real type names; the World built the class map.
let threw = null;
try { validateCarpetConfig(cfg, world.terrain.typeNames); } catch (e) { threw = e.message; }
ok('validateCarpetConfig OK on recipe.carpet' + (threw ? ` (${threw})` : ''), threw === null);
ok('4 variants: riverbank, straw, outwall, meadow', cfg.variants.map((v) => v.name).join() === 'riverbank,straw,outwall,meadow');
ok('world.carpet built', !!(world.carpet && world.carpet.classMap && world.carpet.cfg === cfg));
// the new optional `areas` key is checked and names the key
let msg = '';
try { validateCarpetConfig({ ...cfg, variants: [{ ...cfg.variants[0], areas: [{ shape: 'disc', x: 1 }] }] }, world.terrain.typeNames); } catch (e) { msg = e.message; }
ok('bad area names carpet.variants[0].areas[0]', msg.includes('carpet.variants[0].areas[0]'));

// AC2: share per variant inside the carpet radius at 3 poses.
const POSES = [
  { name: 'meadow (near the tower)', x: 1470, y: 1035, want: 'meadow' },
  { name: 'ford bank', x: 1040, y: 1062, want: 'riverbank' },
  { name: 'Outwall (route-walk leg 10o, outside the gate)', x: 954, y: 940, want: 'outwall' },
];
const names = ['none', ...cfg.variants.map((v) => v.name)], R = cfg.radiusM || 12;
const covers = (c, x, y) => c && x >= c.x0 && y >= c.y0 && x < c.x0 + c.w * c.cellM && y < c.y0 + c.h * c.cellM;
for (const p of POSES) {
  world.ensureBandFor(p.x, p.y);
  if (!covers(world.carpet, p.x, p.y)) { world.terrain.bakeNearBand(Math.floor(p.x / 128) - 1, Math.floor(p.y / 128) - 1, 3, 3); world._rebuildCarpet(); }
  const c = world.carpet;
  ok(`${p.name}: carpet band covers the pose`, covers(c, p.x, p.y));
  if (!covers(c, p.x, p.y)) continue;
  const cnt = new Array(names.length).fill(0); let n = 0;
  const i0 = Math.floor((p.x - R - c.x0) / c.cellM), i1 = Math.floor((p.x + R - c.x0) / c.cellM);
  const j0 = Math.floor((p.y - R - c.y0) / c.cellM), j1 = Math.floor((p.y + R - c.y0) / c.cellM);
  for (let j = Math.max(0, j0); j <= Math.min(c.h - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(c.w - 1, i1); i++) {
    const x = c.x0 + (i + 0.5) * c.cellM, y = c.y0 + (j + 0.5) * c.cellM;
    if ((x - p.x) ** 2 + (y - p.y) ** 2 > R * R) continue;
    cnt[c.classMap[i + j * c.w]]++; n++;
  }
  console.log(`  ${p.name} (${p.x}, ${p.y}) r ${R} m, ${n} cells: ` + names.map((s, k) => `${s} ${(100 * cnt[k] / n).toFixed(1)}%`).join(', '));
  let best = 1; for (let k = 2; k < names.length; k++) if (cnt[k] > cnt[best]) best = k;
  ok(`${p.name}: dominant variant is ${p.want} (got ${names[best]})`, names[best] === p.want && cnt[best] / n >= 0.2);
}

for (const f of failures) console.error('FAIL:', f);
console.log(`carpet.world.test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
