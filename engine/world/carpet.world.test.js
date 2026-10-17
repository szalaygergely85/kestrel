// OB-073-D2f: the real recipe.carpet on world_m1 (World.load, geo installed as main.js does). validateCarpetConfig passes,
// and the class-map share per variant at walk poses shows the intended field; OB-096: every variant hand-placed, tower + road bare. Run: node engine/world/carpet.world.test.js
import { World } from './World.js';
import { validateCarpetConfig, buildCarpetClassMap } from './carpet.js';
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
// OB-096: no catch-all variant any more - every variant is hand-placed
ok('every variant has hand-placed areas (OB-096, no catch-all)', cfg.variants.every((v) => Array.isArray(v.areas) && v.areas.length > 0));
ok('world.carpet built', !!(world.carpet && world.carpet.classMap && world.carpet.cfg === cfg));
// the new optional `areas` key is checked and names the key
let msg = '';
try { validateCarpetConfig({ ...cfg, variants: [{ ...cfg.variants[0], areas: [{ shape: 'disc', x: 1 }] }] }, world.terrain.typeNames); } catch (e) { msg = e.message; }
ok('bad area names carpet.variants[0].areas[0]', msg.includes('carpet.variants[0].areas[0]'));

// AC2: share per variant inside the carpet radius at the poses (OB-096: hand-placed areas; want 'none' = 0 % carpet).
const POSES = [
  { name: 'meadow (large north meadow below the tower)', x: 1440, y: 1004, want: 'meadow' },
  { name: 'east river bank south of the ford', x: 1050, y: 1096, want: 'riverbank' },
  { name: 'barley field (north of the barley fence)', x: 976, y: 882, want: 'straw' },
  { name: 'Outwall (west, outside the palisade)', x: 871, y: 947, want: 'outwall' },
  { name: 'tower interior', x: 1496, y: 1024, want: 'none', r: 12 } /* OB-121a: radiusM 20 reaches meadow outside the tower walls; the interior share is judged within 12 m */,
  { name: 'road (route-walk leg 8 waypoint)', x: 1350, y: 1050, want: 'none' },
];
const names = ['none', ...cfg.variants.map((v) => v.name)], R0 = cfg.radiusM || 12;
const covers = (c, x, y) => c && x >= c.x0 && y >= c.y0 && x < c.x0 + c.w * c.cellM && y < c.y0 + c.h * c.cellM;
for (const p of POSES) {
  const R = p.r || R0;
  world.ensureBandFor(p.x, p.y);
  if (!covers(world.carpet, p.x, p.y)) { world.terrain.bakeNearBand(Math.floor(p.x / 128) - 1, Math.floor(p.y / 128) - 1, 3, 3); world._rebuildCarpet(); }
  // OB-096: the share test is about the recipe fields, so it reads the map WITHOUT the structure mask (the mask empties cells near props/stones by design)
  const c = buildCarpetClassMap(world.terrain, world._carpetCtx.recipe, cfg, null);
  { const m = world.carpet; let nz = 0, nzAll = 0; for (let k = 0; k < c.classMap.length; k++) { if (c.classMap[k]) nzAll++; if (m.classMap[k]) nz++; } console.log(`  (info) ${p.name}: structure mask leaves ${nz} of ${nzAll} class cells in the whole band`); }
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
  if (p.want === 'none') { ok(`${p.name}: 0 % carpet (got ${(100 * (n - cnt[0]) / n).toFixed(1)}%)`, n > 0 && cnt[0] === n); continue; }
  let best = 1; for (let k = 2; k < names.length; k++) if (cnt[k] > cnt[best]) best = k;
  ok(`${p.name}: dominant variant is ${p.want} (got ${names[best]})`, names[best] === p.want && cnt[best] / n >= 0.2);
}

// MASK-e2 (38.52 OB-096): the real recipe + the baked content paint layer -> final near-band mask (paint * (1 - stamps), cutGround)
{
  const { default: fs } = await import('node:fs');
  const { grassMaskFromJSON } = await import('../index.js');
  const gm = grassMaskFromJSON(JSON.parse(fs.readFileSync(new URL('../../content/grassmask/overworld_far.grassMask.json', import.meta.url), 'utf8')));
  ok('recipe.carpet.cutGround names validate', Array.isArray(cfg.cutGround) && cfg.cutGround.length > 0);
  const w2 = World.load(assets.world('world_m1'), assets, { carpet: { ...cfg, mask: gm } });
  const at = (x, y) => { // final mask value 0..1 at (x, y), band built for it first
    w2.ensureBandFor(x, y);
    if (!w2.carpet.mask || !covers(w2.carpet.mask, x, y)) { w2.terrain.bakeNearBand(Math.floor(x / 128) - 1, Math.floor(y / 128) - 1, 3, 3); w2._rebuildCarpet(); }
    while (w2._maskJob && w2.stepMaskJob && w2.stepMaskJob(1e9)) { /* finish a pending sliced build */ }
    const m = w2.carpet.mask; if (!m) return -1;
    const i = Math.floor((x - m.x0) / m.cellM), j = Math.floor((y - m.y0) / m.cellM);
    return i < 0 || j < 0 || i >= m.w || j >= m.h ? -1 : m.data[i + j * m.w] / 255;
  };
  const mTower = at(1496, 1024), mRoad = at(1350, 1050), mMeadow = at(1440, 1004);
  ok(`tower interior: 0 grass (${mTower})`, mTower === 0);
  ok(`road: 0 grass (${mRoad})`, mRoad === 0);
  ok(`meadow pose: grass (${mMeadow})`, mMeadow > 0.9);
  w2.ensureBandFor(1360, 1086); // OB-101: the north meadow is inside the huge tower field now -> edge of the Road West disc (1360,1086 r 8)
  const edge = [0, 0.5, 1, 1.5, 2].map((d) => at(1360 + 8 + d, 1086));
  console.log('  meadow edge (r 8 + 0..2 m):', edge.map((v) => v.toFixed(2)).join(' '));
  ok('soft edge: a value strictly between 0 and 1 at the area border', edge.some((v) => v > 0.05 && v < 0.95));
  ok('beyond the feather: 0', edge[4] < 0.02);
}

for (const f of failures) console.error('FAIL:', f);
console.log(`carpet.world.test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
