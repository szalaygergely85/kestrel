#!/usr/bin/env node
// MESH-PHYS-02 bench: cost of ONE fixed sim step (game/js/main.js step order), broken down by part. Node only.
//   node tools/bench-physics.mjs [--steps N] [--json] [--hash]
// Same world construction as tools/route-walk.mjs (real world_m1, physics 'mesh'). Scenarios: tower wake spot (idle),
// tower stairs (walking), road (`roadSouth` pose of content/dev-poses.js, walking WSW), road idle.
// Parts are timed with performance.now brackets; engine entry points the step calls internally (World.collideCircle,
// supportAt, structureAt, terrain.groundAt/groundNormalAt) are wrapped on the instance and timed EXCLUSIVELY (a stack
// subtracts nested time). Prints us/step p50 / p95 / mean per part, then a per-collider side probe.
// `--hash` prints a bit-exact fingerprint of the player trace per scenario (use before/after a physics change).
import { performance } from 'node:perf_hooks';
import {
  World, PHYSICS_DEFAULTS, integrate, stepRollers, resolveBodyContacts, stepAnimations, stepSectorAnims, updateTriggers,
  createParticles, createRng,
} from '../engine/index.js';
import { moveCircleMesh } from '../engine/dev.js';
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
import titleMod from '../design/models/title.js';
import voxelWorldMod from '../design/models/voxel_world.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { registerQuestBehaviours } from '../game/js/quest/index.js';
import { createBeastSim } from '../game/js/quest/sim/beastSim.js';
import { buildBeastNav } from '../game/js/quest/sim/beastNav.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; terrainDef; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod;
detailPassMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod;
const { assets } = await loadTestAssets();
registerQuestBehaviours();

const argv = process.argv.slice(2);
const argN = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const STEPS = argN('--steps', 600), asJson = argv.includes('--json'), wantHash = argv.includes('--hash');
const P = PHYSICS_DEFAULTS, DT = P.fixedDt;
const O = { x: 1480, y: 1018 };
const W = ([x, y]) => ({ x: O.x + x + 0.5, y: O.y + y + 0.5 });
const stub = { on: () => () => {}, emit() {} };

// ---- exclusive-time profiler -------------------------------------------------------------------------------------
const PARTS = ['stepSectorAnims', 'water.step', 'integrate (own)', 'moveCircleMesh', 'supportAt (probeSupport etc.)', 'terrain.groundAt/Normal',
  'structureAt', 'cloths.tick', 'stepRollers', 'stepAnimations', 'resolveBodyContacts', 'beasts.step', 'particles.step', 'updateTriggers', 'bench overhead (empty bracket)'];
const idx = Object.fromEntries(PARTS.map((n, i) => [n, i]));
const acc = new Float64Array(PARTS.length);
const stack = new Int32Array(16), stackT = new Float64Array(16);
let sp = 0;
function enter(i) { const t = performance.now(); if (sp) acc[stack[sp - 1]] += t - stackT[sp - 1]; stack[sp] = i; stackT[sp] = t; sp++; }
function leave() { const t = performance.now(); sp--; acc[stack[sp]] += t - stackT[sp]; if (sp) stackT[sp - 1] = t; }
function wrap(obj, name, part) {
  const f = obj[name];
  obj[name] = function (...a) { enter(idx[part]); try { return f.apply(this, a); } finally { leave(); } };
}
function timed(part, fn) { enter(idx[part]); try { return fn(); } finally { leave(); } }

function makePlayer(x, y, z) {
  return { id: 'probe', type: 'player', transform: { x, y, z, yawDeg: 0, pitchDeg: 0 },
    components: { body: { radius: P.radius, height: P.height, eyeH: P.eyeHeight, vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: z } } };
}
const yawTo = (fx, fy, tx, ty) => Math.atan2(tx - fx, -(ty - fy)) * 180 / Math.PI;

function build(start) {
  const world = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
  wrap(world, 'collideCircle', 'moveCircleMesh');
  wrap(world, 'supportAt', 'supportAt (probeSupport etc.)');
  wrap(world, 'structureAt', 'structureAt');
  if (world.terrain) { wrap(world.terrain, 'groundAt', 'terrain.groundAt/Normal'); wrap(world.terrain, 'groundNormalAt', 'terrain.groundAt/Normal'); }
  const z0 = world.floorAt(start.x, start.y) ?? 0;
  const player = makePlayer(start.x, start.y, z0);
  const nav = assets.world('world_m1').nav;
  const beasts = createBeastSim(world, { nav: nav && buildBeastNav(world, nav), rng: createRng(nav?.seed ?? 1), events: stub });
  const particles = createParticles();
  return { world, player, beasts, particles, controls: { forward: 0, strafe: 0, run: true, jump: false, yawDeg: 0 }, clothTick: 0 };
}

const noop = () => {};
function stepOnce(s) {
  const { world, player, controls } = s;
  timed('stepSectorAnims', () => stepSectorAnims(world, DT));
  timed('water.step', () => world.water.step());
  timed('integrate (own)', () => integrate(player, DT, controls, world, P));
  timed('cloths.tick', () => {
    const t = player.transform, b = player.components.body;
    world.cloths.setBody(0, t.x, t.y, t.z, b.radius, b.height);
    world.cloths.tick(s.clothTick++, world.wind, t.x, t.y, t.z + b.eyeH);
  });
  timed('stepRollers', () => stepRollers(world, DT, P));
  timed('stepAnimations', () => stepAnimations(world, DT * 1000));
  timed('resolveBodyContacts', () => resolveBodyContacts(world, player, P));
  if (s.beasts) timed('beasts.step', () => { const t = player.transform; s.beasts.step(t.x, t.y, t.z); });
  timed('particles.step', () => s.particles.step());
  timed('updateTriggers', () => updateTriggers(world, {}, player));
  timed('bench overhead (empty bracket)', noop);
}

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
function mix(h, v) { f64[0] = v; h = Math.imul(h ^ u32[0], 16777619); return Math.imul(h ^ u32[1], 16777619) >>> 0; }

function countEntities(w) {
  const c = { all: 0, rollers: 0, animated: 0 };
  w.forEachEntity((e) => { c.all++; const k = e.components || {}; if (k.roller) c.rollers++; const a = k.sprite || k.voxel; if (a && a.playing) c.animated++; });
  return c;
}

/** scenario: {name, start:{x,y}, wps:[{x,y}]|null (null = idle)} */
function run(sc) {
  const s = build(sc.start);
  const tr = s.player.transform, body = s.player.components.body;
  let wi = 0;
  const drive = () => {
    if (!sc.wps) { s.controls.forward = 0; return; }
    let wp = sc.wps[wi];
    while (Math.hypot(wp.x - tr.x, wp.y - tr.y) < 0.4) { wi = (wi + 1) % sc.wps.length; wp = sc.wps[wi]; }
    s.controls.yawDeg = yawTo(tr.x, tr.y, wp.x, wp.y); s.controls.forward = 1; s.controls.run = true;
  };
  let hash = 2166136261;
  for (let i = 0; i < 120; i++) { drive(); stepOnce(s); hash = mix(mix(mix(hash, tr.x), tr.y), tr.z); } // warm-up (JIT + settle)
  const samples = PARTS.map(() => new Float64Array(STEPS)), total = new Float64Array(STEPS);
  for (let i = 0; i < STEPS; i++) {
    acc.fill(0); drive();
    const t0 = performance.now(); stepOnce(s); total[i] = (performance.now() - t0) * 1000;
    for (let k = 0; k < PARTS.length; k++) samples[k][i] = acc[k] * 1000;
    hash = mix(mix(mix(mix(hash, tr.x), tr.y), tr.z), body.vx);
  }
  // per-collider side probe at the final pose (informational): moveCircleMesh over each collider alone
  const colTimes = [];
  const out = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
  for (const c of s.world.colliders) {
    const one = [c], N = 20000;
    for (let i = 0; i < 2000; i++) moveCircleMesh(one, 1, tr.x, tr.y, 0.05, 0.02, body.radius, tr.z, true, body._collideOpts, out);
    const t = performance.now();
    for (let i = 0; i < N; i++) moveCircleMesh(one, 1, tr.x, tr.y, 0.05, 0.02, body.radius, tr.z, true, body._collideOpts, out);
    colTimes.push({ id: c.id, tris: c.bvh ? c.bvh.triCount : 0, us: (performance.now() - t) * 1000 / N });
  }
  const st = (a) => {
    const s2 = Float64Array.from(a).sort(); let m = 0; for (const v of a) m += v;
    return { p50: s2[Math.floor(s2.length * 0.5)], p95: s2[Math.floor(s2.length * 0.95)], mean: m / a.length };
  };
  return { name: sc.name, parts: PARTS.map((n, k) => ({ part: n, ...st(samples[k]) })), total: st(total), colTimes, hash: hash.toString(16),
    end: { x: tr.x, y: tr.y, z: tr.z }, colliders: s.world.colliders.length, ents: countEntities(s.world) };
}

const scenarios = [
  { name: 'tower wake (idle)', start: { x: O.x + 17, y: O.y + 9.5 }, wps: null },
  { name: 'tower stairs (walking)', start: W([15, 3]), wps: [W([16, 3]), W([19, 3]), W([19, 4]), W([20, 4]), W([20, 6]), W([19, 4]), W([16, 3])] },
  { name: 'road roadSouth (walking WSW)', start: { x: 1466, y: 1035 }, wps: [{ x: 1449, y: 1044 }, { x: 1466, y: 1035 }] },
  { name: 'road roadSouth (idle)', start: { x: 1466, y: 1035 }, wps: null },
];
scenarios.forEach(run); // untimed-in-report pass: JIT warm-up for every code path, so scenario order does not matter
const results = scenarios.map(run);
if (asJson) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }
const f = (v) => v.toFixed(2).padStart(7);
for (const r of results) {
  console.log(`\n== ${r.name}  (${STEPS} steps, ${r.colliders} colliders, entities ${r.ents.all} / rollers ${r.ents.rollers} / playing anims ${r.ents.animated})  end (${r.end.x.toFixed(3)}, ${r.end.y.toFixed(3)}, ${r.end.z.toFixed(3)})${wantHash ? '  trace-hash ' + r.hash : ''}`);
  console.log('part'.padEnd(34) + '   p50 us   p95 us  mean us');
  for (const p of r.parts) console.log(p.part.padEnd(34) + f(p.p50) + ' ' + f(p.p95) + ' ' + f(p.mean));
  console.log('TOTAL step'.padEnd(34) + f(r.total.p50) + ' ' + f(r.total.p95) + ' ' + f(r.total.mean));
  console.log('collideCircle per collider (us/call, side probe): ' + r.colTimes.map((c) => `${c.id}[${c.tris}t] ${c.us.toFixed(2)}`).join(' | '));
}
