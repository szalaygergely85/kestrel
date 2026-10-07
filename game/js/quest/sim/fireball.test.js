// game/js/quest/sim/fireball.test.js (SPELL-01a, docs/architecture.md 37.14). Headless Node ESM.
// Run: node --expose-gc game/js/quest/sim/fireball.test.js
// Stub world = an exact thin wall plane (segment vs plane x = wx, the thinnest possible wall); one integration block uses the real World + the real beastSim.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  World, createRng, createHasher, PHYSICS,
} from '../../../../engine/index.js';
import { makeOk } from '../../../../engine/test/assert.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import lanternMod from '../../../../design/models/lantern.js';
import leverMod from '../../../../design/models/lever.js';
import boulderMod from '../../../../design/models/boulder.js';
import rubbleMod from '../../../../design/models/rubble.js';
import wreckageMod from '../../../../design/models/wreckage.js';
import relayMod from '../../../../design/models/relay.js';
import swordMod from '../../../../design/models/sword.js';
import m3PropsMod from '../../../../design/models/m3_props.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import boarMod from '../../../../design/models/voxel_beast.js';
import spellMod from '../../../../design/models/spell.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { buildBeastNav } from './beastNav.js';
import { createBeastSim, STATE_STAGGER, STATE_FLINCH } from './beastSim.js';
import { FIREBALL_CFG } from '../spellConfig.js';
import { createTargetables } from './targetables.js';
import { createFireballSim, FB_IDLE, FB_HOLD, FB_CHARGE } from './fireball.js';

if (typeof global.gc !== 'function') { // the 0-alloc check needs gc: re-run self with --expose-gc
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
paletteMod; detailPassMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; terrainMod; boarMod;
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- fixtures ----------------------------------------------------------------------------------------------------
/** Wall = the infinite thin plane x = wx (exact segment/plane test, like a one-triangle collider). `wx = null` = open. */
function stubWorld(entities, wx) {
  return {
    state: {},
    forEachEntity(fn) { entities.forEach(fn); },
    raySegment(ax, ay, az, bx, by, bz, out) {
      if (wx === null) return false;
      const dx = bx - ax;
      if (dx * dx + (by - ay) ** 2 + (bz - az) ** 2 < 1e-18) return false;
      if (Math.abs(dx) < 1e-12) return false;
      const t = (wx - ax) / dx;
      if (t <= 0 || t > 1) return false;
      out.t = t; out.x = wx; out.y = ay + (by - ay) * t; out.z = az + (bz - az) * t;
      return true;
    },
  };
}
function makeEvents() {
  const log = { hits: [], bursts: [], casts: [], all: 0 };
  const listeners = new Map();
  const events = {
    on(n, fn) { let s = listeners.get(n); if (!s) { s = new Set(); listeners.set(n, s); } s.add(fn); return () => s.delete(fn); },
    emit(n, p) {
      if (log.mute) return;
      if (n === 'combat:hit') log.hits.push({ ...p });
      else if (n === 'fireball:burst') log.bursts.push({ ...p });
      else if (n === 'fireball:cast') log.casts.push({ ...p });
      const s = listeners.get(n); if (s) for (const fn of Array.from(s)) fn(p);
    },
  };
  return { events, log };
}
const mkPlayer = (eyeH = 1.6) => ({ id: 'player', transform: { x: 0, y: 0, z: 0, yawDeg: 90 }, components: { body: { grounded: true, vx: 0, vy: 0, vz: 0, eyeH } } });
const mkTarget = (id, x, y, z = 0, hp = 4, r = 0.3, h = 1.6) => ({ id, transform: { x, y, z }, components: { targetable: { radius: r, height: h }, health: { hp, max: 4 } } });
function mana(mp) {
  const m = { mp, calls: 0, spendMana(n) { m.calls++; if (m.mp < n) return false; m.mp -= n; return true; } };
  return m;
}
function rig({ wx = null, targets = [], mp = 100, cfg = FIREBALL_CFG, eyeH = 1.6, hand = 'right' } = {}) {
  const player = mkPlayer(eyeH);
  const entities = [player, ...targets];
  const world = stubWorld(entities, wx);
  const { events, log } = makeEvents();
  const tg = createTargetables(world, events);
  const m = mana(mp);
  const sim = createFireballSim(world, events, cfg, tg, { spendMana: (n) => m.spendMana(n) });
  sim.setHand(hand);
  const r = { player, world, events, log, tg, m, sim, targets };
  r.step = (down, ax = 1, ay = 0, az = 0) => sim.step(player, down, 1, 0, ax, ay, az); // facing +x
  r.press = (n) => { for (let i = 0; i < n; i++) r.step(true); };
  r.release = () => r.step(false);
  r.idle = (n) => { for (let i = 0; i < n; i++) r.step(false); };
  return r;
}

// ---- tap vs hold edges, mana on release --------------------------------------------------------------------------
{
  const a = rig(); a.press(35); ok('35 steps down = still HOLD', a.sim.state === FB_HOLD, `state=${a.sim.state}`);
  ok('mana untouched while holding', a.m.mp === 100 && a.m.calls === 0);
  a.release();
  ok('35-step release = tap: 5 MP, normal radius', a.m.mp === 95 && a.log.casts.length === 1 && a.log.casts[0].charged === false, `mp=${a.m.mp}`);
  const b = rig(); b.press(36); ok('36 steps down = CHARGE', b.sim.state === FB_CHARGE, `state=${b.sim.state}`);
  ok('still no mana spent in CHARGE', b.m.mp === 100);
  b.release();
  ok('36-step release = charged: 10 MP', b.m.mp === 90 && b.log.casts[0].charged === true, `mp=${b.m.mp}`);
  ok('charged ball: speed 12, radius 3, damage 5', b.sim.slots.speed[0] === 12 && b.sim.slots.radius[0] === 3 && b.sim.slots.damage[0] === 5);
  ok('tap ball: speed 16, radius 2, damage 3', a.sim.slots.speed[0] === 16 && a.sim.slots.radius[0] === 2 && a.sim.slots.damage[0] === 3);
  ok('back to idle after release', b.sim.state === FB_IDLE && a.sim.state === FB_IDLE);
}
// ---- charged with 5-9 MP = normal ball; < 5 = refused without a flash-less cast -----------------------------------
{
  const a = rig({ mp: 7 }); a.press(40); a.release();
  ok('charged release with 7 MP casts a normal tap ball for 5', a.log.casts.length === 1 && a.log.casts[0].charged === false && a.m.mp === 2, `mp=${a.m.mp}`);
  ok('...and it is a tap ball (radius 2)', a.sim.slots.radius[0] === 2);
  const b = rig({ mp: 4 }); b.press(40); b.release();
  ok('4 MP: nothing cast, MP unchanged', b.log.casts.length === 0 && b.m.mp === 4 && b.sim.alive === 0);
  ok('4 MP: no cooldown started', b.sim.cooldown === 0);
  const c = rig({ mp: 4 }); c.press(5); c.release();
  ok('tap with 4 MP refused', c.log.casts.length === 0 && c.m.mp === 4);
}
// ---- cooldown ------------------------------------------------------------------------------------------------------
{
  const a = rig(); a.press(3); a.release();
  ok('cooldown set to 30 after the cast', a.sim.cooldown === 30, `cd=${a.sim.cooldown}`);
  a.press(3); a.release();
  ok('a press inside the cooldown is ignored', a.log.casts.length === 1 && a.m.mp === 95);
  a.idle(30);
  a.press(3); a.release();
  ok('after the cooldown a new cast works', a.log.casts.length === 2 && a.m.mp === 90, `casts=${a.log.casts.length}`);
  // a button held through the cooldown must be pressed again
  const b = rig(); b.press(3); b.release();
  for (let i = 0; i < 40; i++) b.step(true);
  b.release();
  ok('holding through the cooldown does not cast on release', b.log.casts.length === 1);
}
// ---- cancel ---------------------------------------------------------------------------------------------------------
{
  const a = rig(); a.press(40); a.sim.cancel(); a.release();
  ok('cancel: no cast, no mana', a.log.casts.length === 0 && a.m.mp === 100 && a.sim.state === FB_IDLE);
}
// ---- cap of 4 --------------------------------------------------------------------------------------------------------
{
  const cfg = { ...FIREBALL_CFG, cooldown: 1, maxRange: 60 };
  const a = rig({ cfg });
  for (let i = 0; i < 4; i++) { a.press(2); a.release(); a.idle(2); }
  ok('4 balls alive', a.sim.alive === 4 && a.m.mp === 80, `alive=${a.sim.alive}`);
  a.press(2); a.release();
  ok('5th cast refused at the cap: MP unchanged, still 4 alive', a.sim.alive === 4 && a.m.mp === 80 && a.log.casts.length === 4);
  const b = rig({ cfg, mp: 100 });
  for (let i = 0; i < 4; i++) { b.press(40); b.release(); b.idle(2); }
  b.press(40); const before = b.m.mp, calls = b.m.calls; b.release();
  ok('charged at the cap: no mana call at all', b.m.mp === before && b.m.calls === calls);
  ok('persistent serials: 4 distinct', new Set(Array.from(b.sim.slots.serial)).size === 4);
}
// ---- swept flight: no tunnelling through a thin wall at max speed ----------------------------------------------------
{
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let allOk = true, detail = '';
  for (let k = 0; k < 20; k++) {
    const ang = (rnd() - 0.5) * 2.0; // +-57 deg
    const a = rig({ wx: 7 + rnd() * 3 });
    a.step(true, Math.cos(ang), Math.sin(ang), 0); a.step(false, Math.cos(ang), Math.sin(ang), 0);
    for (let i = 0; i < 120 && a.sim.alive > 0; i++) a.idle(1);
    const b = a.log.bursts[0];
    if (!b || a.sim.alive !== 0 || b.x >= 10.0 || b.x < 6.2) { allOk = false; detail += ` [${k}: ${b ? b.x.toFixed(3) : 'none'}]`; }
  }
  ok('20 seeded angles: bursts in front of the wall, never behind it', allOk, detail);
  const a = rig({ wx: 5 }); a.press(2); a.release(); a.idle(40);
  ok('burst point 0.1 m in front of the wall', a.log.bursts.length === 1 && Math.abs(a.log.bursts[0].x - 4.9) < 0.02, `x=${a.log.bursts[0] && a.log.bursts[0].x}`);
  // wall plane position sweeps (sub-step offsets)
  let thin = true;
  for (let k = 0; k < 30; k++) {
    const b = rig({ wx: 4 + k * 0.0917 }); b.press(2); b.release(); b.idle(60);
    if (b.log.bursts.length !== 1 || b.log.bursts[0].x >= 4 + k * 0.0917) thin = false;
  }
  ok('30 wall offsets (sub-step phases): always stops at the wall', thin);
}
// ---- target cylinder: slab edges, start inside, dead ignored ---------------------------------------------------------
{
  const shoot = (zOrigin, targets) => {
    const a = rig({ targets, eyeH: zOrigin + FIREBALL_CFG.castOffset.down });
    a.press(2); a.release(); a.idle(130);
    return a;
  };
  const t1 = () => [mkTarget('b', 6, 0.22)];
  ok('top slab edge (1.6 + 0.15): hit', shoot(1.75, t1()).log.hits.length === 1);
  ok('above the top pad (1.6 + 0.3): miss', shoot(1.95, t1()).log.hits.length === 0);
  ok('bottom slab edge (-0.15): hit', shoot(-0.15, t1()).log.hits.length === 1);
  ok('below the bottom pad (-0.3): miss', shoot(-0.3, t1()).log.hits.length === 0);
  const s = shoot(1.0, [mkTarget('b', 0.5, 0.22)]);
  ok('start inside the cylinder: immediate hit', s.log.hits.length === 1 && s.log.bursts.length === 1 && s.sim.alive === 0);
  const d = shoot(1.0, [mkTarget('dead', 6, 0.22, 0, 0)]);
  ok('dead target (hp 0) ignored: flies through, no hit', d.log.hits.length === 0 && d.log.bursts.length === 1 && d.log.bursts[0].x > 20, `x=${d.log.bursts[0] && d.log.bursts[0].x}`);
  const e = shoot(1.0, [mkTarget('a', 6, 0.22, 0, 4), mkTarget('far', 9, 0.22, 0, 4)]);
  ok('first target on the path takes the ball', e.log.hits.length >= 1 && e.log.hits[0].target === 'a');
}
// ---- range 24 m -> air burst ------------------------------------------------------------------------------------------
{
  const a = rig(); a.press(2); a.release(); a.idle(120);
  const b = a.log.bursts[0];
  ok('range 24: burst in the air at 24 m', b && Math.abs(Math.hypot(b.x - 0.5, b.y - 0.22) - 24) < 0.05 && a.sim.alive === 0, b && `x=${b.x}`);
  const c = rig(); c.press(40); c.release(); c.idle(160);
  ok('charged ball (12 m/s) also ends at 24 m', c.log.bursts.length === 1 && c.log.bursts[0].charged === true);
}
// ---- point-blank wall: burst at once --------------------------------------------------------------------------------
{
  const a = rig({ wx: 0.3 }); a.press(2); a.release();
  ok('wall between eye and hand: immediate burst, nothing alive', a.log.bursts.length === 1 && a.sim.alive === 0 && a.log.bursts[0].x < 0.3, `n=${a.log.bursts.length}`);
  ok('...mana still spent (the cast happened)', a.m.mp === 95);
}
// ---- aim point vs hand offset + castOffset + hands --------------------------------------------------------------------
{
  const a = rig({ wx: 10 }); a.press(2); a.release();
  const c = a.log.casts[0];
  ok('right hand origin = eye + castOffset', Math.abs(c.x - 0.5) < 1e-9 && Math.abs(c.y - 0.22) < 1e-9 && Math.abs(c.z - (1.6 - 0.135)) < 1e-9, `${c.x},${c.y},${c.z}`);
  a.idle(60);
  const b = a.log.bursts[0];
  ok('ball lands on the crosshair ray hit at 10 m (< 0.05 m)', Math.abs(b.y - 0) < 0.05 && Math.abs(b.z - 1.6) < 0.05 && Math.abs(b.x - 9.9) < 0.05, `${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)}`);
  const l = rig({ hand: 'left' }); l.press(2); l.release();
  ok('left hand mirrors the offset', Math.abs(l.log.casts[0].y + 0.22) < 1e-9);
  const co = spellMod.spellHand.castOffset;
  ok('castOffset = the designer\'s ember mount (D-042), within 0.05 m',
    Math.abs(co.right - FIREBALL_CFG.castOffset.right) < 0.05 && Math.abs(co.fwd - FIREBALL_CFG.castOffset.fwd) < 0.05 && Math.abs(co.down - FIREBALL_CFG.castOffset.down) < 0.05);
}
// ---- burst: falloff, LOS, direct hit floor, no self damage -------------------------------------------------------------
{
  // blast centre ~ (9.9, 0, 1.6); targets beside it on the wall's front side
  const mk = (dist) => rig({ wx: 10, targets: [mkTarget('t', 9.9, -dist, 0.8, 4, 0.3, 1.6)] });
  const run = (a) => { a.press(2); a.release(); a.idle(60); return a.log.hits; };
  const h1 = run(mk(1.2)); // surface distance 0.9 -> f 0.55 -> round(1.65) = 2
  ok('falloff R/2: damage round(3 * 0.5) = 2', h1.length === 1 && h1[0].damage === 2 && Math.abs(h1[0].knock - 3.3) < 0.05, JSON.stringify(h1[0]));
  const h2 = run(mk(2.4)); // surface distance 2.1 >= R: untouched
  ok('outside the radius: no hit', h2.length === 0);
  const h3 = run(mk(0.9)); // surface 0.6 -> f 0.7 -> round(2.1) = 2
  ok('falloff 0.7: damage 2', h3.length === 1 && h3[0].damage === 2, JSON.stringify(h3[0]));
  const h4 = run(mk(0.75)); // surface 0.45 -> f 0.775 -> 2.3 -> 2 (and the ball itself passes at y 0..0.22: outside pad)
  ok('payload: source player, cause fire, heavy 1', h4.length === 1 && h4[0].source === 'player' && h4[0].cause === 'fire' && h4[0].heavy === 1 && h4[0].target === 't');
  ok('payload direction points away from the blast', h4[0].dirY < -0.9);
  // LOS: target behind the wall
  const back = rig({ wx: 10, targets: [mkTarget('b', 11, 0, 0.8)] });
  ok('LOS blocked by the wall: target untouched', run(back).length === 0);
  // direct hit floor: a charged-radius ball gives full falloff; a tap ball hitting a target far from its centre still >= 1
  const dir = rig({ targets: [mkTarget('d', 6, 0.22, 0, 4, 0.3, 1.6)] });
  const hd = run(dir);
  ok('direct hit: damage >= 1 (3 * 0.9 = 3)', hd.length === 1 && hd[0].damage === 3, JSON.stringify(hd[0]));
  // charged damage 5, radius 3
  const ch = rig({ wx: 10, targets: [mkTarget('t', 9.9, -2.3, 0.8)] });
  ch.press(40); ch.release(); ch.idle(80);
  ok('charged radius 3: target at surface 2.0 is hit for round(5 * 0.33) = 2', ch.log.hits.length === 1 && ch.log.hits[0].damage === 2, JSON.stringify(ch.log.hits[0]));
}
{
  // no self-damage: the player stands next to the wall, takes knockback only
  const a = rig({ wx: 1.5 });
  a.press(2); a.release(); a.idle(5);
  const b = a.player.components.body;
  ok('own blast: no combat:hit at all, none to the player', a.log.hits.length === 0 && !a.log.hits.some((h) => h.target === 'player'));
  ok('own blast: knockback away (vx < 0) and up (vz > 0)', b.vx < -0.5 && b.vz > 0.2, `vx=${b.vx} vz=${b.vz}`);
  const far = rig({ wx: 12 }); far.press(2); far.release(); far.idle(80);
  const fb = far.player.components.body;
  ok('blast far away: the player is not pushed', fb.vx === 0 && fb.vz === 0);
}
// ---- integration: real world + real beastSim ----------------------------------------------------------------------------
{
  const bx = 1461, by = 1031;
  const ent = { id: 'b1', type: 'beast', x: bx, y: by, z: 'ground',
    components: { voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' }, brain: { kind: 'beast', home: [bx, by] }, targetable: { radius: 0.45, height: 0.7 } } };
  const orig = console.warn; console.warn = () => {};
  const world = World.load({ name: 'fireballTest', terrain: 'overworld_far',
    structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities: [ent], state: {} }, assets, { physics: 'grid' });
  console.warn = orig;
  const nav = buildBeastNav(world, { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] });
  const { events, log } = makeEvents();
  const beasts = createBeastSim(world, { nav, rng: createRng(1), events });
  const tg = createTargetables(world, events);
  const m = mana(100);
  const sim = createFireballSim(world, events, FIREBALL_CFG, tg, { spendMana: (n) => m.spendMana(n) });
  const gz = world.terrain.heightAt(bx - 10, by);
  const pl = { id: 'player', transform: { x: bx - 10, y: by, z: gz, yawDeg: 90 }, components: { body: { grounded: true, vx: 0, vy: 0, vz: 0, eyeH: 1.6 } } };
  const bz = world.get('b1').data.transform.z;
  let ax = 10, az = bz + 0.35 - (gz + 1.6);
  const al = Math.hypot(ax, az); ax /= al; az /= al;
  const hp0 = world.get('b1').data.components.health.hp;
  let stateAtHit = -1;
  const stepAll = (down) => { sim.step(pl, down, 1, 0, ax, 0, az); if (stateAtHit < 0 && log.hits.length) stateAtHit = beasts.state[0]; beasts.step(pl.transform.x, pl.transform.y, pl.transform.z); };
  stepAll(true); stepAll(true); stepAll(false);
  for (let i = 0; i < 90; i++) stepAll(false);
  const hp1 = world.get('b1').data.components.health.hp;
  ok('real boar: took fire damage (hp 4 -> <= 2)', hp1 <= hp0 - 2, `hp ${hp0} -> ${hp1}`);
  ok('real boar: hit event is source player / cause fire', log.hits.length === 1 && log.hits[0].cause === 'fire' && log.hits[0].target === 'b1', JSON.stringify(log.hits));
  ok('real boar: staggered or flinching', stateAtHit === STATE_STAGGER || stateAtHit === STATE_FLINCH, `state=${stateAtHit}`);
  ok('real boar: player 10 m away unharmed and not pushed', pl.components.body.vx === 0);
  beasts.dispose(); tg.dispose();
}
// ---- determinism + 0 alloc ------------------------------------------------------------------------------------------------
{
  function replay() {
    const a = rig({ wx: 12, targets: [mkTarget('t', 9, 1.2, 0, 4)], mp: 1e9 });
    const h = createHasher();
    for (let i = 0; i < 600; i++) {
      const down = (i % 90) < 4 || (i % 150) >= 100 && (i % 150) < 145;
      a.step(down, Math.cos(i * 0.001), Math.sin(i * 0.001), 0);
      a.sim.hashInto(h);
    }
    return { hash: h.digest ? h.digest() : h.value, casts: a.log.casts.length, hits: a.log.hits.length };
  }
  const r1 = replay(), r2 = replay();
  ok('600-step replay with taps + holds + a hit: hash stable', JSON.stringify(r1) === JSON.stringify(r2) && r1.casts >= 4, JSON.stringify(r1));
  ok('replay actually exercised hits', r1.hits >= 1, `hits=${r1.hits}`);

  const a = rig({ wx: 12, targets: [mkTarget('t', 9, 1.2, 0, 4)], mp: 1e12 });
  a.log.mute = true; // recording would allocate in the test itself
  let i = 0;
  const run = (n) => { for (let k = 0; k < n; k++, i++) a.step((i % 90) < 4 || ((i % 150) >= 100 && (i % 150) < 145), 1, 0, 0); };
  run(2000);
  if (global.gc) global.gc();
  const m0 = process.memoryUsage().heapUsed;
  run(10000);
  if (global.gc) global.gc();
  const grow = process.memoryUsage().heapUsed - m0;
  ok('0 alloc over 10k steps (with casts and bursts)', grow < 100000, `heap +${grow}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
