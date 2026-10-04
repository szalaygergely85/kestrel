#!/usr/bin/env node
// D-036 / US-119a helper (designer, 2026-10-04): sanity-check the showcase camera paths in
// design/cinematics/*.json against the real world_m1 data, headless, no browser.
//   node tools/cine-check.mjs            all paths
//   node tools/cine-check.mjs forest     one path
// Per path: validatePath, duration/frames, then samples every capture frame and prints the minimum
// eye clearance above the floor (World.floorAt: structure sector top or terrain ground), above any
// water region under the eye, and any sample inside a tree trunk (realTrees scatter, ME-06c1/c2).
// Also prints forest anchors (densest 30 m discs of tree placements) for retargeting forest.json.
// Not a *.test.mjs: never run by tools/run-tests.mjs; it reports, it does not fail the suite.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import paletteMod from '../design/palette.js';
import detailPassMod from '../design/detail-pass.js';
import terrainDef from '../design/levels/overworld_far.js';
import lanternMod from '../design/models/lantern.js';
import leverMod from '../design/models/lever.js';
import voxelPropsMod from '../design/models/voxel_props.js';
import boulderMod from '../design/models/boulder.js';
import rubbleMod from '../design/models/rubble.js';
import wreckageMod from '../design/models/wreckage.js';
import relayMod from '../design/models/relay.js';
import swordMod from '../design/models/sword.js';
import m3PropsMod from '../design/models/m3_props.js';
import farTowerMod from '../design/models/far_tower.js';
import ferrumLightsMod from '../design/models/ferrum_lights.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { World } from '../engine/index.js';
import { validatePath, evaluatePath } from '../game/js/dev/modes/cinematic.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod;
wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'design', 'cinematics');
const MIN_CLEAR = 0.4;   // m: eye closer than this to a floor/wall top/water = WARN
const TRUNK_PAD = 0.3;   // m: extra radius round a trunk collider

const { assets } = await loadTestAssets();
const world = World.load(assets.world('world_m1'), assets, { realTrees: true });
const sc = world.scatter;
const cfg = world.terrain && world.terrain.recipe.recipe.forest.trees;
const waters = (assets.world('world_m1').water || []);

function waterZ(x, y) {
  let z = -Infinity;
  for (const w of waters) {
    if (w.shape === 'circle' && Math.hypot(x - w.c[0], y - w.c[1]) <= w.r) z = Math.max(z, w.z);
    if (w.shape === 'rect' && x >= w.rect[0] && x <= w.rect[2] && y >= w.rect[1] && y <= w.rect[3]) z = Math.max(z, w.z);
  }
  return z;
}

function trunkHit(x, y, z) {
  if (!sc || !cfg) return -1;
  for (let i = 0; i < sc.count; i++) {
    const sp = cfg.species[sc.species[i]];
    const rc = sp.trunkR / Math.cos(Math.PI / 8) + TRUNK_PAD;
    if (Math.abs(sc.x[i] - x) > rc || Math.abs(sc.y[i] - y) > rc) continue;
    if (Math.hypot(sc.x[i] - x, sc.y[i] - y) <= rc && z >= sc.z[i] - 0.5 && z <= sc.z[i] + sp.trunkH) return i;
  }
  return -1;
}

const only = process.argv[2];
const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && (!only || f === `${only}.json`)).sort();
if (!files.length) { console.error(`no cinematic ${only ? only + '.json' : '*.json'} in ${DIR}`); process.exitCode = 1; }
const cam = {};
for (const f of files) {
  let p;
  try { p = validatePath(JSON.parse(readFileSync(path.join(DIR, f), 'utf8'))); }
  catch (e) { console.log(`${f}: INVALID ${e.message}`); process.exitCode = 1; continue; }
  if (`${p.id}.json` !== f) { console.log(`${f}: INVALID id '${p.id}' does not match the filename`); process.exitCode = 1; continue; }
  const dur = p.keys[p.keys.length - 1].t, frames = Math.ceil(dur * p.fps) + 1;
  let minClear = Infinity, minAt = null, minWater = Infinity, waterAt = null, trunks = 0, firstTrunk = null, nearTrees = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / p.fps;
    evaluatePath(p, t, cam);
    const floor = world.floorAt(cam.x, cam.y);
    const clear = floor === null ? Infinity : cam.z - floor;
    if (clear < minClear) { minClear = clear; minAt = { t, x: cam.x, y: cam.y, z: cam.z, floor }; }
    const wz = waterZ(cam.x, cam.y);
    if (wz > -Infinity && cam.z - wz < minWater) { minWater = cam.z - wz; waterAt = { t, x: cam.x, y: cam.y }; }
    const hit = trunkHit(cam.x, cam.y, cam.z);
    if (hit >= 0) { trunks++; if (!firstTrunk) firstTrunk = { t, tree: hit, x: sc.x[hit], y: sc.y[hit] }; }
    if (sc && i % p.fps === 0) for (let k = 0; k < sc.count; k++) if (Math.hypot(sc.x[k] - cam.x, sc.y[k] - cam.y) < 15) nearTrees++;
  }
  const r = (v) => (typeof v === 'number' ? v.toFixed(2) : v);
  const flag = minClear < MIN_CLEAR || trunks > 0 || minWater < 0.2 ? 'WARN' : 'OK';
  console.log(`${flag} ${p.id}: ${dur} s, ${p.fps} fps, ${frames} frames, ${p.keys.length} keys`);
  console.log(`   min eye clearance ${r(minClear)} m at t=${r(minAt.t)} (${r(minAt.x)}, ${r(minAt.y)}) eye ${r(minAt.z)} floor ${r(minAt.floor)}`);
  if (waterAt) console.log(`   min clearance over water ${r(minWater)} m at t=${r(waterAt.t)} (${r(waterAt.x)}, ${r(waterAt.y)})`);
  if (sc) console.log(`   trunk hits ${trunks} frames${firstTrunk ? ` (first t=${r(firstTrunk.t)} tree #${firstTrunk.tree} at ${r(firstTrunk.x)}, ${r(firstTrunk.y)})` : ''}; trees within 15 m summed over 1 s samples: ${nearTrees}`);
  for (const k of p.keys) {
    const fl = world.floorAt(k.x, k.y);
    console.log(`   key t=${k.t}: (${k.x}, ${k.y}) eye ${k.z} floor ${r(fl)} -> ${fl === null ? '?' : r(k.z - fl)} m`);
  }
}

// Forest anchors: densest 30 m discs of placements (same idea as ME-06c3's forestWalk pose), nearest the spawn first.
if (sc && sc.count && (!only || only === 'forest')) {
  const spawn = { x: 1497.0, y: 1027.5 }, best = [];
  for (let i = 0; i < sc.count; i++) {
    let n = 0;
    for (let k = 0; k < sc.count; k++) if (Math.hypot(sc.x[k] - sc.x[i], sc.y[k] - sc.y[i]) <= 15) n++;
    best.push({ i, n, d: Math.hypot(sc.x[i] - spawn.x, sc.y[i] - spawn.y) });
  }
  best.sort((a, b) => b.n - a.n || a.d - b.d);
  console.log(`forest: ${sc.count} trees in the near band; densest 30 m discs (centre tree, ground, trees, distance from spawn):`);
  const shown = [];
  for (const b of best) {
    if (shown.some((s) => Math.hypot(sc.x[s.i] - sc.x[b.i], sc.y[s.i] - sc.y[b.i]) < 40)) continue;
    shown.push(b);
    const gx = sc.x[b.i], gy = sc.y[b.i];
    console.log(`   (${gx.toFixed(1)}, ${gy.toFixed(1)}) ground ${world.floorAt(gx, gy).toFixed(2)}  trees ${b.n}  ${b.d.toFixed(0)} m`);
    if (shown.length >= 5) break;
  }
  let near = -1, nd = Infinity;
  for (let i = 0; i < sc.count; i++) { const d = Math.hypot(sc.x[i] - 1401.8, sc.y[i] - 1038.3); if (d < nd) { nd = d; near = i; } }
  console.log(`   nearest tree to the forestEdge pose (1401.8, 1038.3): (${sc.x[near].toFixed(1)}, ${sc.y[near].toFixed(1)}) ${nd.toFixed(1)} m`);
} else if (!sc && (!only || only === 'forest')) {
  console.log('forest: world.scatter is null (no realTrees scatter) - forest.json cannot be checked against trees');
}
