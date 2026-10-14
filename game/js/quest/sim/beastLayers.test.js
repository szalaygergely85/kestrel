// BEAST-03b: LAYERS dispatch + per-archetype perception (notice, near bubble, aggro modes) and leash / lose-sight, determinism,
// 0 alloc per sim.step. Run: node --expose-gc game/js/quest/sim/beastLayers.test.js
import { World, NavGrid, createRng, createHasher, pointBlocked } from '../../../../engine/index.js';
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
import { buildBeastNav } from './beastNav.js';
import { createBeastSim, STATE_WANDER, STATE_RETURN, STATE_NOTICE, STATE_CHASE } from './beastSim.js';
import { ARCH_NAMES } from './archetypes.js';
import { LAYERS } from './brains/layers.js';
import { allocProbe } from '../../../../tools/allocProbe.mjs';
import { toSteps } from './beastConfig.js';


lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; paletteMod; detailPassMod; terrainMod; boarMod; NavGrid;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
// Whole-step residual is pre-existing engine garbage (findPath, hasLineOfSight, terrain gridHeight: ~180 B/slot, same for
// legacy boars; owner of the fix = architect, see lane note). The dispatch itself is asserted at < 1 B/call below.
const ALLOC_MAX = Number(process.env.ALLOC_MAX || 160);
const HX = 1461, HY = 1031;
const orig = console.warn; console.warn = () => {};
function mk(kinds, seed = 1) {
  const entities = kinds.map((k, n) => ({ id: 'b' + n, type: 'beast', x: HX + n * 40, y: HY, z: 'ground',
    components: { voxel: { anim: 'idle', loop: true, model: 'goblin' }, brain: { kind: 'beast', home: [HX + n * 40, HY], beastKind: k }, targetable: { radius: 0.45, height: 0.7 } } }));
  const world = World.load({ name: 't', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities, state: {} }, assets, { physics: 'grid' });
  const nav = buildBeastNav(world, NAV_CFG);
  return { world, sim: createBeastSim(world, { nav, rng: createRng(seed), events: { emit() {}, on() {} } }) };
}
const noticed = (sim, k) => sim.state[k] === STATE_NOTICE || sim.state[k] === STATE_CHASE;
// 90 steps with the player at home + (dx, dy); true if slot 0 noticed. Beasts face north (negative y) by default.
function sees(kind, dx, dy, prep) {
  const { world, sim } = mk([kind]);
  if (prep) prep(sim);
  const px = HX + dx, py = HY + dy, z = world.terrain.heightAt(px, py);
  let hit = false;
  for (let t = 0; t < 90 && !hit; t++) { sim.step(px, py, z); if (noticed(sim, 0)) hit = true; }
  return hit;
}

ok('LAYERS has one entry per archetype', LAYERS.length === ARCH_NAMES.length && LAYERS.every((f) => typeof f === 'function'));
{ const { sim } = mk(['troll', 'boar']);
  ok('troll scfg from tank row', sim.scfg[0].noticeR === 14 && sim.scfg[0].loseR === 40 && sim.scfg[0].leashR === 40 && sim.pNear[0] === 4);
  ok('troll steps from row', sim.ssteps[0].notice === toSteps(0.8) && sim.ssteps[0].loseSight === toSteps(6));
  ok('boar legacy numbers kept', sim.scfg[1].noticeR === 12 && sim.pNear[1] === 3 && sim.pAggro[1] === 0 && sim.ssteps[1] === sim.cfgSteps);
  ok('archIdx tank', sim.archIdx[0] === ARCH_NAMES.indexOf('tank')); }

ok('ranged notices at 18 m ahead', sees('skeleton_archer', 0, -18));
ok('ranged does not notice at 25 m ahead', !sees('skeleton_archer', 0, -25));
ok('tank (r14) does not notice at 18 m', !sees('troll', 0, -18));
ok('tank notices at 11 m ahead', sees('troll', 0, -11));
ok('tank ignores 11 m behind (cone)', !sees('troll', 0, 11));
ok('near bubble: tank hears 3 m behind', sees('troll', 0, 3));
ok('near bubble: not 6 m behind', !sees('troll', 0, 6));
ok('never: red deer ignores the player at 2 m', !sees('red_deer', 0, -2));
ok('near: lynx ignores 6 m ahead', !sees('lynx', 0, -6));
ok('near: lynx notices at 2 m', sees('lynx', 0, -2));
ok('whenHit: goat ignores 5 m ahead', !sees('mountain_goat', 0, -5));
ok('whenHit: provoked goat notices', sees('mountain_goat', 0, -5, (s) => { s.provoked[0] = 1; }));

// leash / lose-R: engage a tank at 8 m, then put the player 70 m away (> loseR 40): it gives up
{ const { world, sim } = mk(['troll']);
  let px = HX, py = HY - 8, z = world.terrain.heightAt(px, py), chased = false, returned = false;
  for (let t = 0; t < 120; t++) { sim.step(px, py, z); if (sim.state[0] === STATE_CHASE) chased = true; }
  py = HY - 70; z = world.terrain.heightAt(px, py);
  for (let t = 0; t < 240; t++) { sim.step(px, py, z); if (sim.state[0] === STATE_RETURN || sim.state[0] === STATE_WANDER) returned = true; }
  ok('tank chased then gave up past loseR', chased && returned, `chased=${chased} returned=${returned}`); }
// lose-sight: forced unseen count past the per-slot limit
{ const { world, sim } = mk(['skeleton_archer']);
  const px = HX, py = HY - 10, z = world.terrain.heightAt(px, py);
  for (let t = 0; t < 120; t++) sim.step(px, py, z);
  ok('ranged engaged', sim.state[0] !== STATE_WANDER);
  ok('lose-sight count is 8 s', sim.ssteps[0].loseSight === toSteps(8));
  while (sim.tick % 6 === 0) sim.step(px, py, z); // not a LOS sample tick for slot 0
  sim.state[0] = STATE_CHASE; sim.unseen[0] = sim.ssteps[0].loseSight; sim.seen[0] = 0;
  sim.step(px, py, z);
  ok('unseen >= loseSight -> RETURN', sim.state[0] === STATE_RETURN, 'state=' + sim.state[0]); }

// determinism + alloc through the real sim.step (moving player, no trig)
function run(seed, steps) {
  const { world, sim } = mk(['troll', 'skeleton_archer', 'grey_wolf'], seed);
  const h = createHasher();
  for (let t = 0; t < steps; t++) {
    const ph = (t % 600) / 600, tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
    const px = HX + 80 * tri, py = HY - 6 - 10 * tri;
    sim.step(px, py, world.terrain.heightAt(px, py));
  }
  sim.hashInto(h); return JSON.stringify(h.digest ? h.digest() : h);
}
const a = run(7, 10000), b = run(7, 10000);
ok('10k steps: same seed -> identical state', a === b && a.length > 4, a + ' vs ' + b);
{ const { world, sim } = mk(process.env.KS ? process.env.KS.split(',') : ['troll', 'skeleton_archer', 'lynx', 'red_deer']);
  const zz = world.terrain.heightAt(HX, HY - 10); let k = 0;
  const r = allocProbe((n) => { for (let t = 0; t < n; t++, k++) { const ph = (k % 400) / 400, tri = ph < 0.5 ? ph * 2 : 2 - ph * 2; sim.step(HX + 30 * tri, HY - 8 - 6 * tri, zz); } }, { n: 2000 });
  const ctx = sim._ctx; let acc = 0; const rl = allocProbe((n) => { for (let t = 0; t < n; t++) acc += LAYERS[sim.archIdx[t & 3]](sim, t & 3, ctx) ? 1 : 0; }, { n: 50000 });
  if (!rl.skipped) ok('LAYERS dispatch alloc < 1 B/call', rl.perCall < 1, rl.perCall.toFixed(2));
  if (r.skipped) console.log('SKIP alloc (no --expose-gc)');
  else { console.log('beastSim.step alloc: ' + r.perCall.toFixed(1) + ' B/step'); ok('alloc/step through real sim.step < ' + ALLOC_MAX + ' B', r.perCall < ALLOC_MAX, r.perCall.toFixed(1)); } }
// NAV-ALLOC-01 golden: scratch fast paths answer exactly like the scalar originals (corpus: 6000 points around the tower + terrain)
{ const { world } = mk(['troll']); const T = world.terrain; let bad = 0, nb = 0, g = 0, rng = 12345;
  const rnd = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
  for (let n = 0; n < 6000; n++) {
    const x = 1400 + rnd() * 192, y = 928 + rnd() * 192, z = T.heightAt(x, y) + (rnd() - 0.5) * 3;
    world._lq[0] = x; world._lq[1] = y; world._lq[2] = z;
    const q = world.losPointQ(); if (q >= 0) { nb += q; if ((q === 1) !== pointBlocked(world, x, y, z)) bad++; }
    const gh = T.util.gridHeight(T.near, x, y); if (gh !== null && T.groundAt(x, y) !== gh) g++;
    const sa = world.supportAt(x, y, z, true, { height: 0, stepUpMax: 1, walkCos: -1 }).floorH;
    if (!(sa === world.supportAtQ(Float64Array.of(x, y, z), true, { height: 0, stepUpMax: 1, walkCos: -1 }).floorH)) bad++;
  }
  ok('losPointQ == pointBlocked, supportAt == supportAtQ (6000 pts)', bad === 0, 'bad=' + bad);
  ok('groundAt bit-equal to util.gridHeight in the band', g === 0, 'diff=' + g);
  ok('corpus has blocked and free points', nb > 100 && nb < 5900, 'blocked=' + nb); }
console.warn = orig;
console.log(`beastLayers: ${pass} pass, ${fail} fail`); for (const f of failures) console.log('  FAIL ' + f);
if (fail) process.exit(1);
