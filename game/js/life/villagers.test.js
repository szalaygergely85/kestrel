// LIFE-03 villagers.test.js: 5 Outwall NPCs over a game day on the real world_m1 nav + colliders.
// Run: node game/js/life/villagers.test.js   (node --expose-gc for the strict alloc probe)
import { World } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainDef from '../../../design/levels/overworld_far.js';
import geoMod from '../../../design/levels/world_geo.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import voxelPropsMod from '../../../design/models/voxel_props.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import swordMod from '../../../design/models/sword.js';
import m3PropsMod from '../../../design/models/m3_props.js';
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
import titleMod from '../../../design/models/title.js';
import voxelWorldMod from '../../../design/models/voxel_world.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { buildBeastNav } from '../quest/sim/beastNav.js';
import { ROUTINES } from '../quest/outwallRoutines.js';
import { lifeFromRoutines, resolveAt } from './schedule.js';
import { createVillagers, BAND_FAR } from './villagers.js';
globalThis.window = globalThis;
paletteMod; terrainDef; geoMod; detailPassMod; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod;
class Events { constructor() { this.m = {}; } on(n, f) { (this.m[n] ||= []).push(f); return () => { this.m[n] = this.m[n].filter((g) => g !== f); }; } emit(n, p) { for (const f of this.m[n] || []) f(p); } }
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

const { assets } = await loadTestAssets();
const events = new Events();
const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh', events });
const nav = buildBeastNav(w, assets.world('world_m1').nav);
const life = lifeFromRoutines(ROUTINES);
const OPTS = { height: 1.7, stepUpMax: 0.45, walkCos: 0.7 }, out = {};
function blocked(x, y) {
  w.ensureBandFor(x, y);
  const r = w.collideCircle(x, y, 0, 0, 0.4, w.terrain.groundAt(x, y), true, OPTS, out);
  return Math.hypot((r.x ?? x) - x, (r.y ?? y) - y) > 0.01;
}
const pushOut = (x, y, o) => { w.ensureBandFor(x, y); const r = w.collideCircle(x, y, 0, 0, 0.4, w.terrain.groundAt(x, y), true, OPTS, out); o.x = r.x ?? x; o.y = r.y ?? y; };
const groundAt = (x, y) => w.terrain.groundAt(x, y);
const hourAt = (start, k) => (start + k / 60 / 300) % 24;
const PX = 915, PY = 945; // player on the Outwall plaza: everyone near

// 1. a full game day (7200 s = 432000 steps), start 6 h, player at the plaza
{
  const t0 = process.hrtime.bigint();
  const v = createVillagers({ life, nav, groundAt, collide: pushOut, hour: 6, dayIndex: 0, events });
  ok(v.n === 5, '5 Outwall NPCs');
  const seenWalk = new Set(), seenHidden = new Set();
  let bad = 0, firstBad = '';
  const STEPS = 7200 * 60;
  for (let k = 0; k < STEPS; k++) {
    const hr = hourAt(6, k);
    v.step(hr, 0, PX, PY);
    if (k % 20 === 0) for (let i = 0; i < v.n; i++) {
      const a = v.actors[i];
      if (a.anim === 'walk') seenWalk.add(a.id);
      if (a.hidden) seenHidden.add(a.id);
      if (!a.hidden && k % 60 === 0 && blocked(a.x, a.y)) { bad++; if (process.env.VDBG) console.log(a.id, a.x.toFixed(2), a.y.toFixed(2), a.anim, hr.toFixed(2)); if (!firstBad) firstBad = `${a.id} (${a.x.toFixed(1)},${a.y.toFixed(1)}) k=${k} h=${hr.toFixed(2)}`; }
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(bad === 0, 'no visible position inside a collider; first: ' + firstBad + ' count ' + bad);
  ok(v.stats.maxPerStep <= 1, '<= 1 A* per step');
  ok(v.stats.astar >= 20, 'A* requests were served: ' + v.stats.astar);
  ok(seenWalk.size === 5, 'all 5 walked: ' + [...seenWalk]);
  ok(seenHidden.size === 5, 'all 5 slept hidden (parked at home): ' + [...seenHidden]);
  console.log(`bench LIFE-10 row: villagers 5 npcs, ${STEPS} steps incl. collision probes: ${(ms / STEPS).toFixed(5)} ms/step (${ms.toFixed(0)} ms total), A* ${v.stats.astar}`);
  v.dispose();
}

// 2. sleep park + wake: at 3 h everyone is hidden at home (snap), after the window they reappear
{
  const v = createVillagers({ life, nav, groundAt, collide: pushOut, hour: 3, events });
  ok(v.actors.every((a) => a.hidden), 'asleep at 3 h -> all hidden');
  const home = life.npcs[0].home;
  ok(Math.hypot(v.actors[0].x - home[0], v.actors[0].y - home[1]) < 1e-6, 'hidden at the home anchor');
  let visibleAt = -1;
  for (let k = 0; k < 60 * 300 * 5 && visibleAt < 0; k++) { v.step(hourAt(3, k), 0, PX, PY); if (!v.actors[0].hidden) visibleAt = k; }
  ok(visibleAt > 0 && hourAt(3, visibleAt) >= 6.9 && hourAt(3, visibleAt) < 8.1, 'hesk wakes after its sleep window: h=' + hourAt(3, visibleAt).toFixed(2));
}

// 3. LOD: far player -> far band, no A*, positions snap onto schedule spots; return -> bands recomputed; mid band simulates
{
  const v = createVillagers({ life, nav, groundAt, collide: pushOut, hour: 10, events });
  for (let k = 0; k < 60 * 300 * 6; k++) v.step(hourAt(10, k), 0, 2000, 2000);
  ok(v.stats.astar === 0, 'far band: 0 A* requests (' + v.stats.astar + ')');
  const hr = hourAt(10, 60 * 300 * 6 - 1);
  let snapOk = true;
  for (let i = 0; i < v.n; i++) {
    const a = v.actors[i], r = resolveAt(life, i, hr, 0);
    ok(a.band === BAND_FAR, 'band far');
    const spots = life.npcs[i].activities.map((x) => x.at).concat([life.npcs[i].home]);
    if (!a.hidden && !spots.some((s) => Math.hypot(s[0] - a.x, s[1] - a.y) < 1e-6)) snapOk = false;
    if (r.kind === 'sleep') ok(a.hidden, 'far + sleep -> hidden');
  }
  ok(snapOk, 'far positions sit exactly on a schedule spot');
  for (let k = 0; k < 600; k++) v.step(hr, 0, PX, PY);
  ok(v.actors.every((a) => a.band <= 1), 'bands recomputed when the player returns');
  const v2 = createVillagers({ life, nav, groundAt, collide: pushOut, hour: 6.9, events });
  const x0 = v2.actors[1].x, y0 = v2.actors[1].y;
  for (let k = 0; k < 60 * 400; k++) v2.step(hourAt(6.9, k), 0, PX + 100, PY);
  ok(v2.actors[1].band === 1, 'mid band at 100 m (band ' + v2.actors[1].band + ')');
  ok(v2.stats.astar > 0 && Math.hypot(v2.actors[1].x - x0, v2.actors[1].y - y0) > 1, 'mid band villager walks (A* ' + v2.stats.astar + ')');
}

// 4. flee on life:npcHit: runs home, parks hidden, then resumes
{
  const v = createVillagers({ life, nav, groundAt, collide: pushOut, hour: 9, events });
  for (let k = 0; k < 60 * 60; k++) v.step(hourAt(9, k), 0, PX, PY);
  events.emit('life:npcHit', { npc: 'dorrin' });
  const i = 1, home = life.npcs[i].home; let hid = -1;
  for (let k = 0; k < 60 * 25 && hid < 0; k++) { v.step(9.2, 0, PX, PY); if (v.actors[i].hidden) hid = k; }
  ok(hid > 0, 'dorrin fled home and parked (steps ' + hid + ')');
  ok(Math.hypot(v.actors[i].x - home[0], v.actors[i].y - home[1]) < 0.5, 'parked at home');
  for (let k = 0; k < 60 * 25; k++) v.step(9.2, 0, PX, PY);
  ok(!v.actors[i].hidden, 'flee over: reappears');
  v.dispose();
}

// 5. paused (scripted walk / player talk) freezes a villager
{
  const v = createVillagers({ life, nav, groundAt, collide: pushOut, hour: 9, events, isPaused: (id) => id === 'hesk' });
  const x0 = v.actors[0].x;
  for (let k = 0; k < 60 * 200; k++) v.step(hourAt(9, k), 0, PX, PY);
  ok(v.actors[0].x === x0, 'paused villager does not move');
}

// 6. ~0 alloc per step: steady state ~9 B/step is V8 boxing the double hour/px/py call args (no objects/arrays created); bound 24 B
{
  const v = createVillagers({ life, nav, groundAt: null, hour: 9, events });
  for (let k = 0; k < 60 * 120; k++) v.step(hourAt(9, k), 0, PX, PY);
  if (globalThis.gc) globalThis.gc();
  for (let k = 0; k < 60 * 600; k++) v.step(9.5, 0, PX, PY); // settle after the hour jump (route plans are one-off)
  if (globalThis.gc) globalThis.gc();
  const h0 = process.memoryUsage().heapUsed, N = 60 * 600;
  for (let k = 0; k < N; k++) v.step(9.5, 0, PX, PY);
  const per = (process.memoryUsage().heapUsed - h0) / N;
  console.log('alloc probe: ' + per.toFixed(2) + ' B/step' + (globalThis.gc ? '' : ' (no --expose-gc)'));
  ok(per < 24, 'about 0 alloc per step (' + per.toFixed(1) + ' B)');
}
console.log(fails ? fails + ' FAILED' : 'villagers.test.js OK');
process.exit(fails ? 1 : 0);
