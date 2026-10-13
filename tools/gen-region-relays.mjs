// WM-13: one dormant relay waystone per opened region (ws_<region>), placed by a seeded search for flat, dry, open ground near the WM-11 pose.
// Usage: node tools/gen-region-relays.mjs [--dry-run]   (idempotent: removes its own rows first; writes via stringifyContent)
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/levels/overworld_far.js';
import '../design/levels/world_geo.js';
globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
import { World, stringifyContent } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { outsidePolygon } from '../game/js/quest/bandPose.js';

const dry = process.argv.includes('--dry-run');
const FILE = 'content/worlds/world_m1.world.json';
// [region id in world_geo.regions, ws suffix, pose x, y, display name]
export const RELAYS = [
  ['glasswater', 'glasswater', 1200, 600], ['northwood', 'northwood', 1660, 600], ['alpine', 'highPastures', 650, 600],
  ['ashMile', 'ashMile', 1780, 1100], ['downs', 'downs', 1580, 1430], ['signalHill', 'signalHill', 720, 1300],
  ['westHeath', 'heath', 450, 1350], ['reedmire', 'reedmire', 1090, 1510], ['strand', 'strand', 1590, 1720], ['whitecombs', 'whitecombs', 150, 300],
];
const IDS = RELAYS.map((r) => 'relay_' + r[1]);
const geo = globalThis.ASSETS.levels.world_geo;
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
data.entities = data.entities.filter((e) => !IDS.includes(e.id));
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain;
const gz = (x, y) => { world.ensureBandFor(x, y); return T.groundAt(x, y); };
const typ = (x, y) => { world.ensureBandFor(x, y); return T.groundTypeAt(x, y); };
const regionOf = (x, y) => geo.regions.find((r) => x >= r.r[0] && x < r.r[2] && y >= r.r[1] && y < r.r[3]);
const ell = (L, x, y) => { const c = Math.cos(-L.rot), sn = Math.sin(-L.rot), dx = x - L.x, dy = y - L.y; return Math.hypot((dx * c - dy * sn) / L.rx, (dx * sn + dy * c) / L.ry); };
const CLEAR = 8, EDGE = 12;
// all fixed obstacles: mesh/structure origins + existing entities that are not terrain-only
const obst = data.structures.map((s) => [s.origin.x, s.origin.y]);
for (const e of data.entities) if (e.x !== undefined && e.type !== 'player') obst.push([e.x, e.y]);
const nearestObst = (x, y) => { let d = 1e9; for (const [ox, oy] of obst) { const q = Math.hypot(ox - x, oy - y); if (q < d) d = q; } return d; };
const RING = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)]);
let OK = [0]; // ground types accepted (0 grass); widened to rock/path only if a region has no grass spot
function score(x, y, regId) {
  const rg = regionOf(x, y);
  if (!rg || rg.id !== regId) return null;
  if (outsidePolygon({ bounds: data.bounds }, x, y)) return null;
  // region + bounds margin: all 8 points 12 m around must also be inside both
  for (const [cx, cy] of RING) { const px = x + cx * EDGE, py = y + cy * EDGE; const r2 = regionOf(px, py); if (!r2 || r2.id !== regId || outsidePolygon({ bounds: data.bounds }, px, py)) return null; }
  const z = gz(x, y);
  for (const w of data.water) if (w.shape === 'rect' && w.rect && x > w.rect[0] - 25 && x < w.rect[2] + 25 && y > w.rect[1] - 25 && y < w.rect[3] + 25 && z < w.z + 2) return null; // surface + shore margin
  if (ell(geo.lake, x, y) < 1.8) return null; // lake bowl
  let maxDz = 0;
  for (const rad of [2, 5]) for (const [cx, cy] of RING) {
    const px = x + cx * rad, py = y + cy * rad;
    if (!OK.includes(typ(px, py))) return null;                 // grass only: not water / forest / rock / path
    maxDz = Math.max(maxDz, Math.abs(gz(px, py) - z));
  }
  if (!OK.includes(typ(x, y)) || maxDz > (OK.length > 1 ? 3 : 1.5)) return null;
  const nd = nearestObst(x, y); if (nd < CLEAR) return null;
  return { z, maxDz, nd };
}
const found = []; 
RELAYS.forEach(([regId, suffix, px, py], idx) => {
  let best = null; OK = [0];
  for (const pass of [[0], [0, 3, 4]]) { if (best) break; OK = pass;
  for (let r = 0; r <= 250 && !best; r += 4) for (let a = 0; a < (r ? 24 : 1); a++) {
    const th = (a / 24) * Math.PI * 2 + idx * 0.37, x = Math.round(px + Math.cos(th) * r), y = Math.round(py + Math.sin(th) * r);
    const s = score(x, y, regId);
    if (s && (!best || s.maxDz < best.s.maxDz - 0.05)) best = { x, y, s };
  }
  }
  if (!best) { console.log('NO SPOT', regId); process.exitCode = 1; return; }
  console.log(`ws_${suffix}: (${best.x}, ${best.y}) pose off ${Math.hypot(best.x - px, best.y - py).toFixed(0)} m, z ${best.s.z.toFixed(1)}, dz ${best.s.maxDz.toFixed(2)}, clear ${best.s.nd.toFixed(0)} m`);
  found.push({ regId, suffix, x: best.x, y: best.y, order: 5 + idx });
});
if (!dry && !process.exitCode) {
  for (const f of found) data.entities.push({ id: 'relay_' + f.suffix, type: 'prop', x: f.x, y: f.y, yawDeg: 90, z: 'ground',
    components: { collider: { h: 2.2, r: 0.9 }, light: { offset: { down: -1.1 }, on: false, preset: 'relay' }, voxel: { anim: 'dead', loop: true, model: 'relay' },
      waystone: { id: 'ws_' + f.suffix, kind: 'relay', label: 'place.relay.ws_' + f.suffix, order: f.order } },
    note: `WM-13: dormant region relay ws_${f.suffix} (${f.regId}); name key place.relay.ws_${f.suffix} = NEEDS WRITER` });
  fs.writeFileSync(FILE, stringifyContent(data));
  console.log('written', found.length);
}
