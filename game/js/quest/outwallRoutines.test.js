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
// minimal event bus (engine/dev.js Events is off limits for game/js outside dev/, check-deps)
class Events { constructor() { this.m = {}; } on(n, f) { (this.m[n] ||= []).push(f); return () => { this.m[n] = this.m[n].filter((g) => g !== f); }; } emit(n, p) { for (const f of this.m[n] || []) f(p); } }
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { ROUTINES, createRoutineNpc, stepRoutine, setTalking, inWindow } from './outwallRoutines.js';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
paletteMod; terrainDef; geoMod; detailPassMod; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod;
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh', events: new Events() });
const OPTS = { height: 1.7, stepUpMax: 0.45, walkCos: 0.7 };
// blocked: the existing mesh collision query (world.collideCircle) pushes a 0.4 m circle at the stop out of a collider
function blocked(x, y) {
  w.ensureBandFor(x, y);
  const out = {};
  const r = w.collideCircle(x, y, 0, 0, 0.4, w.terrain.groundAt(x, y), true, OPTS, out);
  return Math.hypot((r.x ?? x) - x, (r.y ?? y) - y) > 0.01;
}
if (process.argv.includes('--probe')) { console.log(w.collideCircle(912, 940, 0, 0, 0.4, 0, true, OPTS, {})); }

// 1. table: every stop outside colliders, every NPC has home + a stop at each hour; unmeshed marked
if (process.argv.includes("--scan")) { for (const [id, r] of Object.entries(ROUTINES)) for (const s of r.stops) { let b = null; for (let rad = 0; rad < 12 && !b; rad += 0.5) for (let a = 0; a < 6.28 && !b; a += 0.4) { const x = s.x + Math.cos(a) * rad, y = s.y + Math.sin(a) * rad; if (![[0,0],[1,0],[-1,0],[0,1],[0,-1]].some(([ox, oy]) => blocked(x + ox, y + oy))) b = [x.toFixed(1), y.toFixed(1)]; } console.log(id, s.name, s.x, s.y, blocked(s.x, s.y) ? "BLOCKED" : "ok", "->", b.join(",")); } process.exit(0); }
for (const [id, r] of Object.entries(ROUTINES)) {
  assert.ok(r.mesh === 'char.kit' || r.mesh === 'NEEDS DESIGNER', id + ' mesh');
  for (const s of r.stops) assert.ok(!blocked(s.x, s.y), `${id}.${s.name} (${s.x},${s.y}) inside a collider`);
  for (let h = 0; h < 24; h += 0.5) assert.ok(r.stops.some((s) => inWindow(h, s.from, s.to)), `${id} no stop at ${h}`);
}
assert.equal(ROUTINES.hesk.mesh, 'char.kit'); assert.equal(ROUTINES.pell.mesh, 'NEEDS DESIGNER');

// 2. full-day loop: the caller moves the NPC at 1.6 m/s toward the target; every stop of a routine is visited, poses valid
function sim(id, hours, talkAt) {
  const npc = createRoutineNpc(id, ROUTINES[id].stops[0].x, ROUTINES[id].stops[0].y);
  const seen = new Set(), poses = new Set(), dt = 0.25; let hour = 6, hist = [];
  for (let t = 0; t < hours * 300; t += dt) { // 300 s per game hour (7200 s / 24)
    hour = (6 + t / 300) % 24;
    const o = stepRoutine(npc, hour, dt);
    seen.add(o.stop); poses.add(o.pose);
    const dx = o.x - npc.x, dy = o.y - npc.y, d = Math.hypot(dx, dy), m = Math.min(d, 1.6 * dt);
    if (d > 1e-6 && !npc.talking) { npc.x += dx / d * m; npc.y += dy / d * m; }
    if (talkAt) talkAt(t, npc, o, hist);
  }
  return { npc, seen, poses, hist };
}
for (const id of Object.keys(ROUTINES)) {
  const { seen, poses } = sim(id, 24);
  for (const s of ROUTINES[id].stops) assert.ok(seen.has(s.name), `${id} never visits ${s.name}`);
  assert.ok(poses.has('walk'), id + ' never walks');
}
assert.ok(sim('dorrin', 24).poses.has('work'));

// 3. interrupt / resume: talking freezes position + dwell, pose idle; afterwards it continues to its target
{
  const npc = createRoutineNpc('hesk', 938, 930); stepRoutine(npc, 8, 0.25);
  npc.x = 930; npc.y = 935; setTalking(npc, true);
  const stop = npc.out.stop, dl = npc.dwellLeft;
  for (let i = 0; i < 100; i++) { const o = stepRoutine(npc, 8, 0.25); assert.equal(o.x, 930); assert.equal(o.y, 935); assert.equal(o.pose, 'idle'); }
  assert.equal(npc.dwellLeft, dl);
  setTalking(npc, false);
  const o = stepRoutine(npc, 8, 0.25);
  assert.equal(o.stop, stop); assert.equal(o.pose, 'walk');
}
// 4. hour window wrap: Dorrin's home (19..7) at night, anvil by day
{
  const npc = createRoutineNpc('dorrin', 909, 938);
  assert.equal(stepRoutine(npc, 23, 0.25).stop, 'home');
  assert.equal(stepRoutine(npc, 9, 0.25).stop, 'anvil');
}
console.log('outwallRoutines ok');
