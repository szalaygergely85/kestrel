#!/usr/bin/env node
// tools/verify-grid-walk.mjs (MAP-13/14 seed): the `?grid=1` world (terrainGrid + polygon bounds, built by game/js/quest/bandPose.js gridVariant)
// walked headless in Node (no browser, no port): tower hillside -> waystone -> bend relay -> ford stones -> crossroads -> Glasswater lake edge.
//   node tools/verify-grid-walk.mjs [--json]      exit 1 on FAIL. Asserts: >= 1 `world:band` swap, no `band:late`, no fall, no stuck waypoint.
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

const DT = P.fixedDt, asJson = process.argv.includes('--json');
const def = gridVariant(assets.world('world_m1'), geo);
const world = World.load(def, assets, { physics: 'mesh', events: new Events() });
const stones = JSON.parse(readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8')).structures
  .filter((s) => /^fordS[0-9]+$/.test(s.id)).map((s) => ({ x: s.origin.x, y: s.origin.y })).sort((a, b) => b.x - a.x);

const t0 = { x: 1470, y: 1029, z: 0, yawDeg: 0, pitchDeg: 0 };
placeLoaded(world, t0, null); t0.z = world.terrain.groundAt(t0.x, t0.y);
const player = { id: 'probe', type: 'player', transform: t0, components: { body: { radius: P.radius, height: P.height, eyeH: P.eyeHeight, vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: t0.z } } };
const controls = { forward: 1, strafe: 0, run: true, jump: false, yawDeg: 0 };
const swaps = [], swapMs = []; let late = 0;
world.events.on('world:band', (e) => { swaps.push(e.from + '>' + e.to); swapMs.push(world.lastSwapMs); });
world.events.on('band:late', () => { late++; });

function walk(name, wps, maxWp = 4000, expectBlocked = false) {
  const tr = player.transform, rec = { name, ok: true, fell: false, steps: 0, stuck: null };
  for (let i = 0; i < wps.length && rec.ok; i++) {
    let best = Infinity, bestAt = 0, bias = 0, biasLeft = 0, tries = 0; // slope/prop slide-off: steer +-50/100 deg for 45 steps after 60 stalled steps (as route-walk detour)
    for (let n = 0; ; n++) {
      const dx = wps[i].x - tr.x, dy = wps[i].y - tr.y;
      if (Math.hypot(dx, dy) < 1) break;
      if (n >= maxWp) { rec.ok = false; rec.stuck = { wp: i, x: +tr.x.toFixed(1), y: +tr.y.toFixed(1) }; break; }
      const dist = Math.hypot(dx, dy);
      if (dist < best - 0.3) { best = dist; bestAt = n; }
      if (biasLeft <= 0 && n - bestAt > 60) { tries++; bias = (tries % 2 ? 1 : -1) * 50 * Math.ceil(tries / 2); biasLeft = 45; bestAt = n; }
      if (biasLeft > 0) biasLeft--; else bias = 0;
      controls.yawDeg = Math.atan2(dx, -dy) * 180 / Math.PI + bias;
      stepSectorAnims(world, DT); integrate(player, DT, controls, world, P); stepRollers(world, DT, P); stepAnimations(world, DT * 1000);
      resolveBodyContacts(world, player, P); updateTriggers(world, {}, player);
      world.streamBand(tr.x, tr.y, 2); rec.steps++;
      const fl = world.floorAt(tr.x, tr.y);
      if (fl != null && tr.z < fl - 0.25) rec.fell = true;
    }
  }
  rec.end = { x: +tr.x.toFixed(1), y: +tr.y.toFixed(1) };
  if (expectBlocked) { rec.ok = true; rec.stuck = null; } // bound probe: stopping at the bound or walking on to the far waypoint are both fine, only a fall (checked by the caller) fails
  return rec;
}
const legs = [
  walk('tower hillside -> waystone -> bend relay', [{ x: 1420, y: 1032 }, { x: 1350, y: 1050 }, { x: 1270, y: 1042 }]),
  walk('relay -> ford stones', [{ x: 1180, y: 1062 }, { x: 1090, y: 1070 }, { x: 1046, y: 1069 }, ...stones, { x: 1010, y: 1069 }]),
  walk('ford -> crossroads', [{ x: 998, y: 1064 }, { x: 994, y: 1058 }]),
  walk('crossroads -> outwall bound probe (west, no fall)', [{ x: 998, y: 1075 }, { x: 900, y: 1075 }], 2500, true),
  walk('outwall -> lake edge (Glasswater south shore)', [{ x: 998, y: 1075 }, { x: 994, y: 1058 }, { x: 1010, y: 900 }, { x: 1150, y: 760 }, { x: 1237.5, y: 605 }], 9000),
  walk('lake edge -> back to the tower (leg 10 return)', [{ x: 1150, y: 760 }, { x: 1010, y: 900 }, { x: 994, y: 1058 }, { x: 1010, y: 1069 }, ...stones.slice().reverse(), { x: 1090, y: 1070 }, { x: 1270, y: 1042 }, { x: 1420, y: 1032 }, { x: 1470, y: 1029 }], 9000),
];
const res = { bandId: world.bandId, swaps, bandLate: late, maxSwapMs: +Math.max(0, ...swapMs).toFixed(2), legs };
const ok = legs.every((l) => l.ok && !l.fell) && swaps.length >= 1 && late === 0 && res.maxSwapMs <= 16; // MAP-14: max swap frame <= 16 ms
if (asJson) console.log(JSON.stringify({ ok, ...res })); else {
  for (const l of legs) console.log(`${l.ok && !l.fell ? 'ok  ' : 'FAIL'} ${l.name.padEnd(52)} steps ${String(l.steps).padStart(5)} end ${l.end.x},${l.end.y}${l.stuck ? ' stuck ' + JSON.stringify(l.stuck) : ''}${l.fell ? ' FELL' : ''}`);
  console.log(`grid walk: ${ok ? 'PASS' : 'FAIL'} swaps ${swaps.join(',') || '-'} band:late ${late} max swap ${res.maxSwapMs} ms final zone ${world.bandId}`);
}
process.exit(ok ? 0 : 1);
