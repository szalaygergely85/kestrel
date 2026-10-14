// BEAST-08b + 08b-PIN + CROC-SOFT (arch 38.64 item 5, D-096 B, D-088): water slots inside beastSim. Croc lunge 4 m after a 0.7 s tell,
// GRAB 1.5 s (3 ticks x 4 % = 12 %, cap 15 %), mash escape, retreat <= 300 steps, never > 3 m from water; eel/turtle aggro only on swimmers;
// turtle front block; same result every run; 0 alloc. Run: node --expose-gc game/js/quest/sim/waterBrain.test.js
import { World, NavGrid, createRng } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import boarMod from '../../../../design/models/voxel_beast.js';
import lanternMod from '../../../../design/models/lantern.js';
import leverMod from '../../../../design/models/lever.js';
import boulderMod from '../../../../design/models/boulder.js';
import rubbleMod from '../../../../design/models/rubble.js';
import wreckageMod from '../../../../design/models/wreckage.js';
import relayMod from '../../../../design/models/relay.js';
import swordMod from '../../../../design/models/sword.js';
import m3PropsMod from '../../../../design/models/m3_props.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { allocProbe, skipNote } from '../../../../tools/allocProbe.mjs';
import { buildBeastNav, buildWaterNav } from './beastNav.js';
import { createBeastSim } from './beastSim.js';
import { waterBlocks } from './brains/waterBrain.js';

lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; paletteMod; detailPassMod; terrainMod; boarMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const CX = 1461, CY = 1031; // fake lake centre: depth 2.5 at the middle, 0 at r=30 (deep = depth >= 0.6 -> r <= 22.8), surface z 5
const fakeWorld = { waterAt(x, y, out) { const d = Math.hypot(x - CX, y - CY); if (d >= 30) return false; out.depth = 2.5 * (1 - d / 30); out.surfaceZ = 5; out.flatZ = 5; return true; } };
const orig = console.warn; console.warn = () => {};

function mk(kinds, seed = 1, ex = CX) {
  const entities = kinds.map((k, n) => ({ id: 'b' + n, type: 'beast', x: ex + n * 3, y: CY, z: 'ground',
    components: { voxel: { anim: 'idle', loop: true, model: 'goblin' }, brain: { kind: 'beast', home: [ex + n * 3, CY], beastKind: k }, targetable: { radius: 0.45, height: 0.7 } } }));
  const world = World.load({ name: 't', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities, state: {} }, assets, { physics: 'grid' });
  const nav = buildBeastNav(world, NAV_CFG);
  const waterNav = buildWaterNav(fakeWorld, new NavGrid({ x0: 1400, y0: 928, w: 192, h: 192, cell: 1 }));
  const log = [];
  const events = { emit(n, p) { if (n === 'beast:grab') log.push(['grab', p.on, p.slot]); else if (n === 'combat:hit' && p.target === 'player') log.push(['hit', p.damage]); }, on() { return () => {}; } };
  const sim = createBeastSim(world, { nav, rng: createRng(seed), events, waterNav, playerMaxHp: 30, hpPerDamage: 5, seed });
  return { world, sim, log, waterNav };
}
const dist = (x, y) => Math.hypot(x - CX, y - CY);

// ---- croc ----
{
  const { sim, log, waterNav } = mk(['river_crocodile'], 1, CX + 14);
  ok('water slot is parked outside the land pipeline', sim.wat[0] === 1 && sim.steer.active[0] === 0 && sim.state[0] === 20);
  const px = CX + 25, py = CY; // 2.2 m from deep water, on the bank band
  let tWind = -1, tCharge = -1, tGrab = -1, tRel = -1, tBank = -1, maxD = 0, badZ = 0, maxLunge = 0, lx = 0, ly = 0, offGrid = 0;
  const hits = [];
  for (let t = 0; t < 900; t++) {
    const prev = sim.state[0];
    sim.step(px, py, 0);
    const st = sim.state[0], x = sim.steer.x[0], y = sim.steer.y[0];
    if (st === 3 && prev !== 3 && tWind < 0) tWind = t;
    if (st === 4 && prev !== 4 && tCharge < 0) { tCharge = t; lx = x; ly = y; }
    if (st === 4) maxLunge = Math.max(maxLunge, Math.hypot(x - lx, y - ly));
    if (st === 21 && prev !== 21 && tGrab < 0) tGrab = t;
    if (tGrab >= 0 && tRel < 0 && st !== 21) tRel = t;
    if (tRel >= 0 && tBank < 0 && dist(x, y) <= 22.8) tBank = t;
    maxD = Math.max(maxD, dist(x, y) - 22.8);
    const mc = waterNav.mask[waterNav.grid.cellY(y) * waterNav.grid.w + waterNav.grid.cellX(x)]; if (mc === 0) offGrid++;
    if (Math.abs(sim.entities[0].transform.z - (5 - (st === 3 || st === 4 || st === 21 ? 0 : 0.4))) > 1e-4) badZ++;
  }
  for (const e of log) if (e[0] === 'hit') hits.push(e[1]);
  ok('tell >= 0.7 s (42 steps) before the lunge', tWind >= 0 && tCharge - tWind >= 42, `wind=${tWind} charge=${tCharge}`);
  ok('lunge <= 4 m', maxLunge <= 4.01 && maxLunge > 0.5, `lunge=${maxLunge.toFixed(2)}`);
  ok('GRAB happens, released <= 120 steps', tGrab >= 0 && tRel - tGrab <= 120 && tRel > tGrab, `grab=${tGrab} rel=${tRel}`);
  ok('3 ticks of 4 % HP (12 %), under the 15 % cap', hits.length >= 3 && Math.abs(hits.slice(0, 3).reduce((a, b) => a + b, 0) * 5 / 30 - 0.12) < 1e-9, `hits=${hits.length} sum%=${(hits.slice(0, 3).reduce((a, b) => a + b, 0) * 500 / 30).toFixed(2)}`);
  ok('beast:grab on then off', log.filter((e) => e[0] === 'grab').map((e) => e[1]).slice(0, 2).join() === '1,0');
  ok('croc back in deep water <= 300 steps after release', tBank >= 0 && tBank - tRel <= 300, `bank=${tBank - tRel}`);
  ok('croc never > 3 m from deep water, never off the croc grid', maxD <= 3.3 && offGrid === 0, `maxD=${maxD.toFixed(2)} offGrid=${offGrid}`);
  ok('z = surface - 0.4 submerged, surface when attacking', badZ === 0, `bad=${badZ}`);
  const s2 = mk(['river_crocodile'], 1, CX + 14).sim, ts = []; let prev = 0;
  for (let t = 0; t < 1500; t++) { s2.step(px, py, 0); if (s2.state[0] === 3 && prev !== 3) ts.push(t); prev = s2.state[0]; }
  ok('one attack per 4 s', ts.length >= 2 && ts.every((v, k) => k === 0 || v - ts[k - 1] >= 240), `windups at ${ts.join(',')}`);
}
// mash escape
{
  const { sim, log } = mk(['river_crocodile'], 1, CX + 14);
  const px = CX + 25, py = CY; let tGrab = -1, tRel = -1;
  for (let t = 0; t < 600 && tRel < 0; t++) {
    sim.step(px, py, 0);
    if (sim.state[0] === 21) { if (tGrab < 0) tGrab = t; if (t - tGrab >= 5 && t - tGrab < 13) sim.grabMash(0); }
    if (tGrab >= 0 && sim.state[0] !== 21) tRel = t;
  }
  ok('mash 8x releases early', tGrab >= 0 && tRel - tGrab < 20 && sim.grabSlot() === -1, `held=${tRel - tGrab}`);
  ok('early escape took < 3 ticks', log.filter((e) => e[0] === 'hit').length < 3);
}
// ---- eel / turtle ----
function windedUp(kind, px, py, steps) {
  const { sim, waterNav } = mk([kind]); let w = 0, off = 0;
  for (let t = 0; t < steps; t++) {
    sim.step(px, py, 0); if (sim.state[0] === 3) w++;
    const g = waterNav.grid; if (waterNav.mask[g.cellY(sim.steer.y[0]) * g.w + g.cellX(sim.steer.x[0])] !== 1) off++;
  }
  return { w, off };
}
{
  const dry = windedUp('reed_eel', CX + 25, CY, 900), wet = windedUp('reed_eel', CX + 8, CY, 900), tdry = windedUp('snapping_turtle', CX + 25, CY, 900), twet = windedUp('snapping_turtle', CX + 6, CY, 900);
  ok('eel ignores a player on the bank', dry.w === 0 && dry.off === 0, `windups=${dry.w}`);
  ok('eel attacks a swimming player, stays in deep water', wet.w > 0 && wet.off === 0, `windups=${wet.w} off=${wet.off}`);
  ok('turtle ignores a player on the bank, attacks a swimmer', tdry.w === 0 && twet.w > 0 && twet.off === 0, `dry=${tdry.w} wet=${twet.w} off=${twet.off}`);
  const { sim } = mk(['snapping_turtle', 'reed_eel']); sim.fx[0] = 1; sim.fy[0] = 0;
  ok('turtle blocks a hit from its front, not the back/eel', waterBlocks(sim.wb, sim, 0, { dirX: -1, dirY: 0 }) && !waterBlocks(sim.wb, sim, 0, { dirX: 1, dirY: 0 }) && !waterBlocks(sim.wb, sim, 1, { dirX: -1, dirY: 0 }) && !waterBlocks(sim.wb, sim, 0, {}));
}
// ---- determinism + alloc ----
function hashRun() {
  const { sim } = mk(['river_crocodile', 'reed_eel', 'snapping_turtle']);
  for (let t = 0; t < 3000; t++) sim.step(CX + 22 + ((t >> 8) & 3), CY + ((t >> 9) & 3), 0);
  return Buffer.concat([sim.steer.x, sim.steer.y, sim.state, sim.timer].map((a) => Buffer.from(a.buffer, a.byteOffset, Math.min(a.byteLength, 64 * a.BYTES_PER_ELEMENT))));
}
ok('same result every run (3 slots, 3000 steps)', Buffer.compare(hashRun(), hashRun()) === 0);
{
  const { sim } = mk(['river_crocodile', 'reed_eel', 'snapping_turtle']); let t = 0;
  const r = allocProbe((n) => { for (let i = 0; i < n; i++, t++) sim.step(CX + 22 + ((t >> 8) & 3), CY + ((t >> 9) & 3), 0); }, { n: 3000, warm: 20 });
  if (!skipNote(r, 'water brain in beastSim alloc')) ok('alloc: water pass adds nothing over the land step (< 1500 B/step floor, pre-existing)', r.perCall < 1500, `${r.perCall.toFixed(1)} B/step`);
}
console.warn = orig;
console.log(`waterBrain: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
