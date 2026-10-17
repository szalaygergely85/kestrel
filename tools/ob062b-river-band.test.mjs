// OB-062b: the wet-bed band (terrain type 2) hugs the visible water (<= 2 m past where the ground meets the water z), and the
// carved bank beside it is earth, not grey rock. Run: node tools/ob062b-river-band.test.mjs
import fs from 'node:fs';
import '../design/palette.js'; import '../design/detail-pass.js';
import '../design/levels/overworld_far.js'; import '../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
let fail = 0;
const ok = (n, c) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n); };
const A = globalThis.ASSETS.levels.overworld_far, U = A.util, RV = A.recipe.river;
const data = JSON.parse(fs.readFileSync('content/worlds/world_m1.world.json', 'utf8'));
const { assets } = await loadTestAssets();
const w = World.load(data, assets, { physics: 'mesh' });
const band = RV.halfWidth;
ok('band half-width known and <= 10', band > 0 && band <= 10);
let worst = 0, rocky = 0, n = 0;
for (const y of [1040, 1055, 1100, 1160, 1250]) {
  w.ensureBandFor(U.riverX(y), y);
  const xr = U.riverX(y); let z0 = w.terrain.groundAt(xr, y), cross = 0;
  for (let d = 0; d <= 16; d += 0.25) { if (w.terrain.groundAt(xr + d, y) > z0 + 0.4) { cross = d; break; } }   // ground rises 0.4 m above the bed = water edge
  worst = Math.max(worst, band - cross);
  for (let d = band; d < band + 5; d += 1) { n++; if (U.typeAt(xr + d, y) === 3) rocky++; }
}
ok('band reaches <= 2 m past the water edge (worst ' + worst.toFixed(2) + ')', worst <= 2);
ok('no grey rock ring right beside the band (' + rocky + '/' + n + ')', rocky === 0);
const cols = A.terrain.water.colors || [];
ok('bed colours are wet earth, not stone: ' + cols.join(','), cols.length === 3 && !cols.some((c) => /^(stone|rubble|rock)/.test(c)));
process.exit(fail ? 1 : 0);
