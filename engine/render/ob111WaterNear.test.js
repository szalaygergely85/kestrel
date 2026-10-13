// OB-111: shallow water near a standing player keeps its surface (opaque in fb.waterMask), no see-through hole around the camera.
// Run: node engine/render/ob111WaterNear.test.js
import fs from 'node:fs';
import '../../design/palette.js'; import '../../design/detail-pass.js';
import '../../design/levels/overworld_far.js'; import '../../design/levels/world_geo.js';
import '../../design/models/voxel_seamonster.js'; import '../../design/models/voxel_goblin.js';
globalThis.window = globalThis.window || globalThis;
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../../design/models/${m}.js`); } catch {} }
import { World } from '../index.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
const data = JSON.parse(fs.readFileSync('content/worlds/world_m1.world.json', 'utf8'));
const { assets } = await loadTestAssets();
const w = World.load(data, assets, { physics: 'mesh' });


import { projTerms, unprojectCell } from './projection.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer } from './GBuffer.js';
import { bindShading } from './MaterialTable.js';
import { renderWorld } from './compositor.js';
import { makeLightBuffer } from './lighting.js';
let fail = 0;
const ok = (n, c, d) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (d === undefined ? '' : ' ' + d)); };
const C = 160, R = 60, wa = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: -1, look: 0 };
function near(ex, ey, yaw, pitch) {
  w.ensureBandFor(ex, ey);
  const fb = { rt: new CellBuffer(C, R), depth: new DepthBuffer(C, R), palette: assets.palette, gbuf: new GBuffer(C, R), matTable: bindShading(assets.palette, assets.detailPass, 1), detailPass: null, lights: null, light: makeLightBuffer(C, R), timeSec: 0, loop: { stats: {} }, renderer: 'mesh' };
  const cam = { x: ex, y: ey, z: w.terrain.groundAt(ex, ey) + 1.6, yawDeg: yaw, pitchDeg: pitch, projection: 'pitched' };
  for (let k = 0; k < 30; k++) renderWorld(fb, w, cam);
  const T = {}; projTerms(cam, { cols: C, rows: R, pxCellW: 1, pxCellH: 2 }, T);
  const P = [0, 0, 0]; let n = 0, opaque = 0;
  for (let i = 0; i < C * R; i++) {
    if (!fb.water.kind[i]) continue;
    unprojectCell(T, i % C, (i / C) | 0, fb.water.depth[i], P);
    if (Math.hypot(P[0] - ex, P[1] - ey) > 5) continue;
    const raw = fb.depth.depth[i]; if (!(raw < 1e8)) continue;       // scene floor under the water (no sky / missing band)
    const wz = P[2]; unprojectCell(T, i % C, (i / C) | 0, raw, P);
    if (wz - P[2] < 0.2) continue;                                   // column < 0.2 m: shore cells fade out by design
    n++; if (fb.waterMask[i]) opaque++;
  }
  return [n, opaque];
}
for (const [label, x, y, yaw, pitch] of [['ford bar yaw 270 pitch -30', 1040, 1068, 270, -30], ['ford bar pitch -50', 1038, 1074, 270, -50], ['bank 1029.5,990 pitch -35', 1029.5, 990, 180, -35]]) {
  const [n, op] = near(x, y, yaw, pitch);
  ok('water within 5 m opaque: ' + label, n > 200 && op >= 0.98 * n, op + '/' + n);
}
process.exit(fail ? 1 : 0);
