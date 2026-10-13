#!/usr/bin/env node
// tools/map-loop.mjs (WM-06, arch 38.59): the whole-map loop walk, headless Node, default world (WM-05: terrainGrid + polygon bounds ship in world_m1; `?grid=1` accepted as a no-op).
//   node tools/map-loop.mjs [--json] [--no-return] [--stride N]    exit 1 on FAIL. Asserts: 0 band:late, 0 sync bakes (world.bandMisses), no fall, no stuck,
//   max swap <= 4 ms, band cache <= 32 MB; then save/load round trip at the 6 pose stops. Waypoints: tools/map-loop-waypoints.mjs.
import { MAP_LOOP, mapLoopFull, mapLoopPoses, outsideBounds } from './map-loop-waypoints.mjs';
import { readFileSync } from 'node:fs';
import { World, PHYSICS_DEFAULTS as P, integrate, stepRollers, resolveBodyContacts, stepAnimations, stepSectorAnims, updateTriggers } from '../engine/index.js';
import { Events } from '../engine/dev.js';
import paletteMod from '../design/palette.js';
import farMod from '../design/levels/overworld_far.js';
import geoMod from '../design/levels/world_geo.js';
import detailPassMod from '../design/detail-pass.js';
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
import titleMod from '../design/models/title.js';
import voxelWorldMod from '../design/models/voxel_world.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { registerQuestBehaviours } from '../game/js/quest/index.js';
import { gridVariant, placeLoaded } from '../game/js/quest/bandPose.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; farMod; geoMod; detailPassMod; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod;
const { assets } = await loadTestAssets();
registerQuestBehaviours();
const geo = globalThis.ASSETS.levels.world_geo;
if (geo && geo.util) geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util); // as game/js/main.js does (MAP-02/03/05)

const DT = P.fixedDt, asJson = process.argv.includes('--json'), noReturn = process.argv.includes('--no-return');
const raw = assets.world('world_m1');
const def = raw.terrainGrid && raw.bounds && raw.bounds.shape === 'polygon' ? raw : gridVariant(raw, geo); // WM-05: the default already is the grid world (fallback for old content)
const world = World.load(def, assets, { physics: 'mesh', events: new Events() });
const MB = 1048576, CACHE_MB = 32, SWAP_MS = 4;

const t0 = { x: MAP_LOOP[0].x, y: MAP_LOOP[0].y, z: 0, yawDeg: 0, pitchDeg: 0 };
placeLoaded(world, t0, null); t0.z = world.terrain.groundAt(t0.x, t0.y);
const loadMisses = world.bandMisses;
const player = { id: 'probe', type: 'player', transform: t0, components: { body: { radius: P.radius, height: P.height, eyeH: P.eyeHeight, vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: t0.z } } };
const controls = { forward: 1, strafe: 0, run: true, jump: false, yawDeg: 0 };
const misses = []; let lastMiss = world.bandMisses; // the load-time ensureBandFor (behind the fade) is a legal sync bake: count from here
const swaps = [], swapMs = []; let late = 0, maxCacheB = 0;
world.events.on('world:band', (e) => { swaps.push(e.from + '>' + e.to); swapMs.push(world.lastSwapMs); });
world.events.on('band:late', () => { late++; });

/** Walk to waypoint `wp` at run speed (same stall detour as verify-grid-walk); records fall / stuck. */
function walkTo(wp, rec, maxWp = 12000) {
  const tr = player.transform; let best = Infinity, bestAt = 0, bias = 0, biasLeft = 0, tries = 0;
  for (let n = 0; ; n++) {
    const dx = wp.x - tr.x, dy = wp.y - tr.y, dist = Math.hypot(dx, dy);
    if (dist < (wp.tol || 1.5)) return true;
    if (n >= maxWp) { rec.ok = false; rec.stuck = { at: wp.n, x: +tr.x.toFixed(1), y: +tr.y.toFixed(1) }; return false; }
    if (dist < best - 0.3) { best = dist; bestAt = n; }
    if (biasLeft <= 0 && n - bestAt > 60) { tries++; bias = (tries % 2 ? 1 : -1) * 50 * Math.ceil(tries / 2); biasLeft = 45; bestAt = n; }
    if (biasLeft > 0) biasLeft--; else bias = 0;
    controls.yawDeg = Math.atan2(dx, -dy) * 180 / Math.PI + bias;
    stepSectorAnims(world, DT); integrate(player, DT, controls, world, P); stepRollers(world, DT, P); stepAnimations(world, DT * 1000);
    resolveBodyContacts(world, player, P); updateTriggers(world, {}, player);
    world.streamBand(tr.x, tr.y, 2); rec.steps++;
    if ((rec.steps & 255) === 0) maxCacheB = Math.max(maxCacheB, world.bandCache.stats().bytes);
    if (world.bandMisses !== lastMiss) { lastMiss = world.bandMisses; misses.push({ leg: rec.name, x: +tr.x.toFixed(0), y: +tr.y.toFixed(0), zone: world.bandId }); }
    const fl = world.floorAt(tr.x, tr.y);
    if (fl != null && tr.z < fl - 0.25) rec.fell = true;
  }
}
const route = noReturn ? MAP_LOOP : mapLoopFull();
const legs = [];
const outsideSet = new Set(outsideBounds(def.bounds.pts).map((w) => w.n)); // flagged + skipped if a stop ever leaves the polygon
for (let i = 1; i < route.length; i++) {
  const rec = { name: route[i - 1].n + ' -> ' + route[i].n, ok: true, fell: false, steps: 0, stuck: null };
  if (outsideSet.has(route[i].n)) { rec.skipped = 'outside the bounds polygon today (WM-05)'; rec.end = { x: +player.transform.x.toFixed(1), y: +player.transform.y.toFixed(1) }; legs.push(rec); continue; }
  walkTo(route[i], rec); rec.end = { x: +player.transform.x.toFixed(1), y: +player.transform.y.toFixed(1) }; legs.push(rec);
}
maxCacheB = Math.max(maxCacheB, world.bandCache.stats().bytes);
const walkMisses = world.bandMisses - loadMisses; // before the save/load poses below (their ensureBandFor is a legal sync bake behind a fade)

// save/load round trip at the 6 pose stops: a fresh world (as a load) + placeLoaded must keep the pose (inside the polygon) and wake the same zone a walk would.
const poses = mapLoopPoses().map((p) => {
  const w2 = World.load(def, assets, { physics: 'mesh', events: new Events() });
  const t = { x: p.x, y: p.y, z: 0, yawDeg: 90, pitchDeg: 0 };
  const moved = placeLoaded(w2, t, null); const gz = w2.terrain.groundAt(t.x, t.y);
  const r = { pose: p.n, moved, zone: w2.bandId, sameZone: w2.bandId === (world.ensureBandFor(p.x, p.y), world.bandId), groundOk: Number.isFinite(gz), kept: t.x === p.x && t.y === p.y && t.yawDeg === 90 };
  if (w2.dispose) w2.dispose();
  return r;
});
const outside = outsideBounds(def.bounds.pts).map((w) => w.n); // WM-05 widens the polygon: flagged, not failed
const res = { legs: legs.length, swaps: swaps.length, bandLate: late, syncBakes: walkMisses, maxSwapMs: +Math.max(0, ...swapMs).toFixed(2), cacheMB: +(maxCacheB / MB).toFixed(1), misses, outside, poses };
const poseOk = poses.every((p) => p.groundOk && p.sameZone && (p.kept || outside.includes(p.pose)));
const ok = legs.every((l) => l.skipped || (l.ok && !l.fell)) && swaps.length >= 1 && late === 0 && walkMisses === 0 && res.maxSwapMs <= SWAP_MS && maxCacheB <= CACHE_MB * MB && poseOk;
if (asJson) console.log(JSON.stringify({ ok, ...res, legList: legs })); else {
  for (const l of legs) console.log(`${l.skipped ? 'skip' : l.ok && !l.fell ? 'ok  ' : 'FAIL'} ${l.name.padEnd(64)} steps ${String(l.steps).padStart(6)} end ${l.end.x},${l.end.y}${l.stuck ? ' stuck ' + JSON.stringify(l.stuck) : ''}${l.fell ? ' FELL' : ''}`);
  for (const p of poses) console.log(`${p.groundOk && p.sameZone ? 'ok  ' : 'FAIL'} save/load ${p.pose.padEnd(32)} zone ${p.zone} sameZone ${p.sameZone} kept ${p.kept} moved ${p.moved}`);
  console.log(`mapLoop: ${ok ? 'PASS' : 'FAIL'} swaps ${res.swaps} band:late ${late} sync bakes ${res.syncBakes} max swap ${res.maxSwapMs} ms (<= ${SWAP_MS}) cache ${res.cacheMB} MB (<= ${CACHE_MB}) misses ${JSON.stringify(misses)} outside bounds today: ${outside.join(', ') || 'none'}`);
}
process.exit(ok ? 0 : 1);
