// OB-214 FALLS-POOL: water spans the full foot of the braidFalls sheet (terrain below the water surface at every sample across
// the 20 m foot, and the water region really covers it). Run: node tools/falls-pool.test.mjs [--probe]
import fs from 'node:fs';
import '../design/palette.js'; import '../design/detail-pass.js';
import '../design/levels/overworld_far.js'; import '../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World } from '../engine/index.js';
import { forwardOf } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
const probe = process.argv.includes('--probe');
let fail = 0;
const ok = (n, c) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n); };
const data = JSON.parse(fs.readFileSync('content/worlds/world_m1.world.json', 'utf8'));
const { assets } = await loadTestAssets();
const w = World.load(data, assets, { physics: 'mesh' });
const f = data.waterfalls.find((x) => x.id === 'braidFalls');
const dir = [0, 0]; forwardOf(f.outDeg, dir);
const landT = Math.sqrt(f.drop / 4.9), throwM = f.out * landT;
const dx = f.lip[2] - f.lip[0], dy = f.lip[3] - f.lip[1], width = Math.hypot(dx, dy);
const out = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: 0, look: 0 };
let bad = 0, minDepth = 1e9, n = 0;
for (let d = 0; d <= width + 1e-6; d += 0.5) {
  const u = d / width, x = f.lip[0] + dx * u + dir[0] * throwM, y = f.lip[1] + dy * u + dir[1] * throwM;
  w.ensureBandFor(x, y);
  const g = w.terrain.groundAt(x, y), wet = w.waterAt(x, y, out), depth = wet ? out.surfaceZ - g : -1;
  if (probe) console.log(d.toFixed(1), x.toFixed(1), y.toFixed(1), 'ground', g.toFixed(2), wet ? 'water ' + out.surfaceZ.toFixed(2) + ' (' + out.region + ')' : 'DRY');
  n++; minDepth = Math.min(minDepth, depth); if (!wet || depth <= 0) bad++;
}
ok(`sheet foot (${width.toFixed(1)} m wide, lands ${throwM.toFixed(1)} m out): water above terrain at all ${n} samples (bad ${bad}, min depth ${minDepth.toFixed(2)})`, bad === 0);
process.exit(fail ? 1 : 0);
