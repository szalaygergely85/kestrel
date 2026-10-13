// MESH-PLACE-01: meadow dressing from EXISTING content/meshes (Quaternius): bushes, grass clumps, MegaKit ferns/flowers/clover/plants (MESH-PLACE-02), mushrooms,
// rocks on the slopes, pebbles. Writes the "mdw###" structures into content/worlds/world_m1.world.json (replaces earlier mdw* rows and
// leaves roadS*/roadL* rows alone) and retargets burlBush to the leafy Bush_Common. Bushes are walk-through via the mesh json `collide:false`
// (SOFT_NAME_RE in engine/mesh/colliderProxy.js + tools/gen-mesh-colliders.mjs), not per placement (World.load ignores a placement `collide`).
// Usage: node tools/gen-meadow-meshes.mjs [--seed N] [--dry-run]
// Area: the meadow around Burl, the walk-out path breach (1486.5, 1025) -> bend (1420, 1032) -> waystone (1428, 1040), and the hillside south of it.
// Keep-outs (checked again by tools/meadow-clear.test.mjs): the path (ground type path + 1.5 m verge), 2.5 m beside the route walk line, 3.5 m
// around Burl / the waystone / every boar home (+ the piece's own radius), the tower footprint, and every existing mesh structure.
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import { PLANT_SCALE, plantScaleFor } from './plant-scale.mjs';
import { pathToFileURL } from 'node:url';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/levels/overworld_far.js';
for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'menu_ui', 'notes', 'brazier']) await import(`../design/models/${m}.js`);
import { World, stringifyContent } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { meshClass } from './editor/meshPlace.js';
// ROCK-SNAP-01 (owner 2026-10-10: "those stones are in the air"): the generators placed rocks at the MAX ground height of 5 samples
// + LIFT 0.15, so on slopes the downhill side floats. Re-snap every placed Rock_* / Pebble* / RockPath* mesh to the LOWEST ground
// under its footprint (scaled bbox), sunk by SINK so the base is buried. Layout (x, y, yaw, scale) unchanged.
// Usage: node tools/resnap-rocks.mjs [--dry]
const FILE = 'content/worlds/world_m1.world.json';
const SINK = { rock: 0.12, pebble: 0.03, rockpath: 0.02 };
const dry = process.argv.includes('--dry');
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const { assets } = await loadTestAssets();
const world = World.load(data, assets, { physics: 'mesh' });
const T = world.terrain;
let n = 0, maxFix = 0;
for (const s of data.structures) {
  if (!s.mesh || !s.mesh.startsWith('quaternius/')) continue;
  const name = s.mesh.slice('quaternius/'.length), cls = meshClass(name);
  if (!(cls in SINK)) continue;
  const b = assets.mesh(s.mesh).bbox, k = s.scale || 1, ext = 0.5 * k * Math.max(b[3] - b[0], b[4] - b[1]);
  let lo = Infinity;
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI / 4, r = i === 8 ? 0 : 0.8 * ext;
    lo = Math.min(lo, T.groundAt(s.origin.x + r * Math.cos(a), s.origin.y + r * Math.sin(a)));
  }
  const z = +(lo - SINK[cls]).toFixed(2);
  if (Math.abs(z - s.origin.z) > 0.005) { maxFix = Math.max(maxFix, s.origin.z - z); s.origin.z = z; n++; }
}
console.log(`resnapped ${n} rock/pebble meshes, largest drop ${maxFix.toFixed(2)} m`);
if (!dry) { fs.writeFileSync(FILE, stringifyContent(data), 'utf8'); console.log('wrote', FILE); }
