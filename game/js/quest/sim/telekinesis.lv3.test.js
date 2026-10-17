// SPELL-R7 (arch 38.81): Telekinesis lv3 lift + throw against the REAL beastSim. Run: node game/js/quest/sim/telekinesis.lv3.test.js
import assert from 'node:assert/strict';
import { World, NavGrid, createAStar, createRng, createHasher } from '../../../../engine/index.js';
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
import { allocProbe } from '../../../../tools/allocProbe.mjs';
import { createBeastSim, holdBeast, throwBeast, STATE_HELD, STATE_THROWN, STATE_STAGGER } from './beastSim.js';
import { createTargetables } from './targetables.js';
import { createTelekinesisSim } from './telekinesis.js';

paletteMod; detailPassMod; terrainMod; boarMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod;
const { assets } = await loadTestAssets();
const X0 = 1480, Y0 = 1000;
const ent = (id, x, y, kind) => ({ id, type: 'beast', x, y, z: 'ground', components: { voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' }, brain: { kind: 'beast', home: [x, y], ...(kind ? { beastKind: kind } : {}) }, targetable: { radius: 0.45, height: 0.7 } } });

/** fresh rig: player at (X0-6, Y0) facing +x; beast 'a' 4 m ahead, optional extras. wallX stubs a collider plane (x > wallX blocked). */
function rig({ extra = [], wallX = null, mp = 100, props = [] } = {}) {
  const orig = console.warn; console.warn = () => {};
  const world = World.load({ name: 'beastTile', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities: [ent('a', X0 - 2, Y0), ...extra], state: {} }, assets, { physics: 'grid' });
  console.warn = orig;
  const grid = new NavGrid({ x0: X0 - 60, y0: Y0 - 60, w: 120, h: 120, cell: 1 }); grid.buildFromWorld(world, { maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] });
  let probes = 0;
  if (wallX !== null) world.collideCircle = (x, y, dx, dy, r, fz, g, o, out) => { probes++; let nx = x + dx; out.blockedX = false; out.blockedY = false; if (nx + r > wallX) { nx = wallX - r; out.blockedX = true; } out.x = nx; out.y = y + dy; out.nx = 0; out.ny = 0; out.overflow = false; return out; };
  const listeners = new Map(), hits = [];
  const events = { on(n, f) { let s = listeners.get(n); if (!s) listeners.set(n, s = new Set()); s.add(f); return () => s.delete(f); }, emit(n, p) { if (n === 'combat:hit') hits.push({ ...p }); const s = listeners.get(n); if (s) for (const f of Array.from(s)) f(p); } };
  const sim = createBeastSim(world, { nav: { grid, astar: createAStar(grid) }, rng: createRng(1), events });
  for (let i = 0; i < sim.count; i++) { const hp = sim.entities[i].components.health; hp.max = 40; hp.hp = 40; } // survive the 6 dmg hits
  const m = { mp };
  const player = { id: 'player', transform: { x: X0 - 6, y: Y0, z: 0 }, components: {} };
  const tk = createTelekinesisSim(world, events, createTargetables(world, events), { spendMana: (n) => (m.mp < n ? false : (m.mp -= n, true)), tier: () => 3, forEachProp: (fn) => props.forEach(fn), beastSim: sim });
  for (let i = 0; i < 3; i++) sim.step(player.transform.x, player.transform.y, 0);
  player.transform.z = sim.entities[sim.slotOf('a')].transform.z;
  const step = (down) => { tk.step(player, 1, 0, down); sim.step(player.transform.x, player.transform.y, player.transform.z); };
  const press = (n = 30) => { tk.requestCast(); for (let i = 0; i < n; i++) step(true); };
  return { world, sim, tk, player, hits, m, step, press, slot: (id) => sim.slotOf(id), e: (id) => sim.entities[sim.slotOf(id)], probes: () => probes };
}

{ // AC1: grab a boar, float ~2.5 m ahead at <= eye height for <= 3 s, then the timeout throws; mana 6 + 1/s, cd 3 s
  const R = rig(); R.press(40);
  const a = R.slot('a'); assert.equal(R.sim.state[a], STATE_HELD); assert.equal(R.tk.holds, 1);
  const t = R.e('a').transform, dx = t.x - R.player.transform.x;
  assert.ok(Math.abs(dx - 2.5) < 0.2, 'held 2.5 m ahead, got ' + dx); assert.ok(t.z - R.player.transform.z <= 1.2 + 1e-6 && t.z - R.player.transform.z > 0.3, 'floats at eye height');
  assert.equal(R.m.mp, 94, 'mana 6 on grab'); assert.equal(R.tk.cooldown > 150, true, 'cd 3 s');
  for (let i = 0; i < 160; i++) R.step(true);
  assert.ok(R.m.mp <= 92 && R.m.mp >= 90, 'mana drains ~1/s: ' + R.m.mp);
  for (let i = 0; i < 40; i++) R.step(true);
  assert.ok(R.tk.throws === 1, 'timeout (3 s) throws'); assert.notEqual(R.sim.state[a], STATE_HELD);
}
{ // release throws 14 m/s into a wall: 6 dmg to it + stagger; held body never inside the collider (every step)
  const R = rig({ wallX: X0 - 2 + 0.7 }); R.press(30);
  const a = R.slot('a'), t = R.e('a').transform;
  for (let i = 0; i < 90; i++) { R.step(true); assert.ok(t.x + 0.45 <= X0 - 2 + 0.7 + 1e-6, 'never inside the wall: x=' + t.x); }
  assert.equal(R.sim.state[a], STATE_HELD); assert.ok(R.probes() > 0);
  R.hits.length = 0; R.step(false); assert.equal(R.sim.state[a], STATE_THROWN);
  assert.equal(R.sim.spell.p[3], 14); assert.equal(R.sim.spell.p[4], 0);
  for (let i = 0; i < 10 && R.sim.state[a] === STATE_THROWN; i++) R.step(false);
  assert.equal(R.sim.state[a], STATE_STAGGER); const h = R.hits.filter((x) => x.source === 'tk');
  assert.deepEqual(h.map((x) => [x.target, x.damage]), [['a', 6]]);
}
{ // thrown into a second beast: both take 6 (once each)
  const R = rig({ extra: [ent('b', X0 + 1, Y0)], wallX: X0 + 2.5 }); R.press(30);
  R.hits.length = 0; R.step(false);
  for (let i = 0; i < 40; i++) R.step(false);
  const tk = R.hits.filter((x) => x.source === 'tk').map((x) => x.target + ':' + x.damage).sort();
  assert.deepEqual(tk, ['a:6', 'b:6']);
}
{ // refused kinds: bear, croc, boss (elite)
  for (const k of ['black_bear', 'river_crocodile', 'troll']) {
    const orig = console.warn; console.warn = () => {};
    const R = rigKind(k); console.warn = orig;
    R.press(40); assert.equal(R.tk.holds, 0, k + ' refused'); assert.notEqual(R.sim.state[R.slot('a')], STATE_HELD);
  }
}
function rigKind(kind) {
  const world = World.load({ name: 'beastTile', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities: [ent('a', X0 - 2, Y0, kind)], state: {} }, assets, { physics: 'grid' });
  const grid = new NavGrid({ x0: X0 - 60, y0: Y0 - 60, w: 120, h: 120, cell: 1 }); grid.buildFromWorld(world, { maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] });
  const events = { on() { return () => {}; }, emit() {} };
  const sim = createBeastSim(world, { nav: { grid, astar: createAStar(grid) }, rng: createRng(1), events });
  const player = { id: 'player', transform: { x: X0 - 6, y: Y0, z: 0 }, components: {} };
  const tk = createTelekinesisSim(world, events, createTargetables(world, events), { spendMana: () => true, tier: () => 3, beastSim: sim });
  const step = (down) => { tk.step(player, 1, 0, down); sim.step(player.transform.x, player.transform.y, 0); };
  return { sim, tk, slot: (id) => sim.slotOf(id), press(n) { tk.requestCast(); for (let i = 0; i < n; i++) step(true); } };
}
{ // mana out while holding -> drop (no throw damage)
  const R = rig({ mp: 7 }); R.press(30); const a = R.slot('a'); assert.equal(R.sim.state[a], STATE_HELD);
  R.hits.length = 0; for (let i = 0; i < 130; i++) R.step(true);
  assert.notEqual(R.sim.state[a], STATE_HELD); assert.equal(R.tk.throws, 0); assert.equal(R.hits.filter((x) => x.source === 'tk' && x.damage > 0).length, 0);
}
{ // props: a dummy roller prop joins through forEachProp with no spell change; held, thrown (<= 12 m/s), hits a beast for 6
  const prop = { id: 'dummy.rock', transform: { x: X0 - 3.5, y: Y0, z: 0 }, components: { roller: {}, body: { vx: 0, vy: 0, vz: 0, grounded: true } } };
  const R = rig({ props: [prop], extra: [ent('b', X0 + 4, Y0)] });
  R.world.forEachEntity((e) => { if (e.id === 'a') e.transform.y = Y0 + 20; }); R.sim.steer.y[R.slot('a')] = Y0 + 20; R.e('a').transform.y = Y0 + 20;
  prop.transform.z = R.player.transform.z;
  R.tk.requestCast(); for (let i = 0; i < 30; i++) { R.tk.step(R.player, 1, 0, true); prop.transform.x += prop.components.body.vx / 60; }
  assert.equal(R.tk.grabbing, 2, 'prop held'); assert.ok(Math.abs(prop.components.body.vx) <= 12 + 1e-9);
  R.hits.length = 0; R.tk.step(R.player, 1, 0, false);
  const sp = Math.hypot(prop.components.body.vx, prop.components.body.vy); assert.ok(sp > 1 && sp <= 12 + 1e-9, 'thrown speed ' + sp);
  prop.transform.x = X0 + 4; R.tk.step(R.player, 1, 0, false);
  assert.deepEqual(R.hits.filter((x) => x.source === 'tk').map((x) => [x.target, x.damage]), [['b', 6]]);
}
{ // determinism: same script twice -> equal hash; 0 alloc while holding + throwing
  const run = () => { const R = rig({ wallX: X0 + 1 }); R.press(60); R.step(false); for (let i = 0; i < 60; i++) R.step(false); const h = createHasher(); R.sim.hashInto(h); R.tk.hashInto(h); return h.value(); };
  assert.equal(run(), run(), 'hash twice equal');
  // 0 alloc: (a) tk hold steps (one 3 s hold = 180 steps, 30 used by the grab) (b) beastSim hold -> throw -> land cycles
  // 0 alloc: whole spell cycle (press, grab, hold, timeout throw, impact, cooldown) through tk.step + beastSim.step
  const R = rig({ wallX: X0 + 1 }); let c = 0, cast = true;
  const cyc = (n) => { for (let i = 0; i < n; i++, c++) { const k = c % 420; if (k === 0 && cast) { R.tk.requestCast(); for (let q = 0; q < R.sim.count; q++) R.sim.entities[q].components.health.hp = 40; } R.tk.step(R.player, 1, 0, k < 230); R.sim.step(R.player.transform.x, R.player.transform.y, R.player.transform.z); } };
  const ra = allocProbe(cyc, { n: 420 * 4, warm: 3, windows: 3, chunk: 420 });
  cast = false; const base = allocProbe(cyc, { n: 420 * 4, warm: 3, windows: 3, chunk: 420 }); // same loop, no spell: the sim's own garbage (stub-floor/supportAt boxing, ref arch 38.61)
  ra.perCall -= base.perCall;
  if (ra.skipped) console.log('  alloc probe SKIPPED (run with node --expose-gc)'); else { console.log('  alloc: spell cycle adds ' + ra.perCall.toFixed(1) + ' B/step over baseline ' + base.perCall.toFixed(1)  + ' B/step, throws ' + R.tk.throws); assert.ok(R.tk.throws > 0 && ra.perCall < 16, 'allocation while holding/throwing'); }
}
console.log('telekinesis.lv3.test.js OK');
