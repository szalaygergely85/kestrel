// LIFE-10: living-world simulation budget bench (docs/architecture.md 38.56 part (e)). Node only, no browser.
//   node --expose-gc tools/bench-life.mjs [--hours 24] [--start 18] [--strict] [--json] [--quiet] [--poses --scenarios 0 --no-goblin]
// Builds the real world_m1, the 5 Outwall villagers (+schedule), the fauna (rabbit/deer + a bench fox that hunts
// rabbits), the beast sim (fauna hunts + a bench raid) and steps them at the fixed 60 Hz step with the player at 3
// distances from Outwall (in the village, 100 m, 600 m). Prints per-system ms/step p50/p95/max + heap growth, then
// PASS/FLAG per budget row. Exit code is non-zero only with --strict and a FLAG.
// Skipped with a note: chat (game/js/life/chat.js missing on this branch). Villager count is 5 (budget is for 24).
import { World } from '../engine/index.js';
import { compileFaunaDef, createFauna } from '../engine/index.js';
import { FIXTURE_FX, fixtureModels } from '../engine/dev.js';
import paletteMod from '../design/palette.js';
import detailPassMod from '../design/detail-pass.js';
import terrainDef from '../design/levels/overworld_far.js';
import geoMod from '../design/levels/world_geo.js';
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
import { gridVariant } from '../game/js/quest/bandPose.js'; // WM-06: --poses: whole-map poses on the default (WM-05 grid) world
import { buildBeastNav } from '../game/js/quest/sim/beastNav.js';
import { createBeastSim, MAX_BEASTS } from '../game/js/quest/sim/beastSim.js';
const BENCH_BEASTS = 48; // GOB-08 worst case is fixed at 48 (MAX_BEASTS is 96 since WM-12)
import { createRng } from '../engine/index.js';
import { ROUTINES } from '../game/js/quest/outwallRoutines.js';
import { lifeFromRoutines } from '../game/js/life/schedule.js';
import { createVillagers } from '../game/js/life/villagers.js';
import { createRaids } from '../game/js/life/raids.js';
import { ensureGoblinCamps, activeCamps, createGoblinCamps } from '../game/js/life/goblinCamps.js'; // GOB-08
import { createArrowSim, createPlayerTarget, lobVelocity } from '../game/js/quest/sim/arrows.js';
import { GOBLIN_SPEAR_CFG } from '../game/js/quest/bowConfig.js';
import { readFileSync } from 'node:fs';
const readJson = (rel) => JSON.parse(readFileSync(new URL('../' + rel, import.meta.url), 'utf8'));

globalThis.window = globalThis;
paletteMod; terrainDef; geoMod; detailPassMod; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod;

const STEPS_PER_HOUR = 18000; // 300 s per game hour at 60 Hz (D-064: 2 real hours per day)
const PLAZA = [915, 945];
const GOBLINS_AWAKE = 20, THROWERS = 6, SPEARS_FLYING = 8; // GOB-08 (38.57 (6))
// WM-06 (38.59): whole-map poses, same systems at a far-region pose on the default world; JS (life+fauna+beast p95 sum) <= 8 ms (D-007)
export const POSES = [['glasswater', 1200, 600], ['northwood', 1660, 600], ['highPastures', 650, 600], ['ashMile', 1780, 1100], ['downs', 1580, 1430],
  ['signalHill', 720, 1300], ['heath', 450, 1350], ['reedmire', 1090, 1510], ['strand', 1590, 1720], ['whitecombsFoot', 150, 300]]; // WM-11: one per opened region
const SCENARIOS = [['in Outwall', 0], ['100 m away', 100], ['600 m away', 600]];
// Budget rows (38.56 e). stat = which statistic is compared with cap.
const BUDGETS = [
  { sys: 'life', label: 'life (villagers+schedule+raids) mean', stat: 'mean', cap: 0.25 },
  { sys: 'life', label: 'life p99', stat: 'p99', cap: 0.6 },
  { sys: 'fauna', label: 'fauna incl. hunts mean', stat: 'mean', cap: 0.15 },
  { sys: 'beast', label: 'beastSim (total, hunt/raid extras cap 0.1 not separable) mean', stat: 'mean', cap: null },
];

function parseArgs(argv) {
  const o = { hours: 24, start: 18, strict: false, json: false, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') o.strict = true; else if (a === '--json') o.json = true; else if (a === '--quiet') o.quiet = true;
    else if (a === '--poses') o.poses = true; else if (a === '--no-goblin') o.goblin = false; else if (a === '--scenarios') o.scenarios = +argv[++i]; else if (a === '--hours') o.hours = +argv[++i]; else if (a === '--start') o.start = +argv[++i];
  }
  return o;
}

class Events {
  constructor() { this.m = {}; }
  on(n, f) { (this.m[n] ||= []).push(f); return () => { this.m[n] = this.m[n].filter((g) => g !== f); }; }
  emit(n, p) { const a = this.m[n]; if (a) for (let i = 0; i < a.length; i++) a[i](p); }
}

function summarize(t, n) {
  const a = t.subarray(0, n).slice().sort();
  const q = (p) => a[Math.min(n - 1, Math.floor(p * n))];
  let sum = 0; for (let i = 0; i < n; i++) sum += a[i];
  return { mean: sum / n, p50: q(0.5), p95: q(0.95), p99: q(0.99), p999: q(0.999), max: a[n - 1] };
}

/** Builds the whole living world once per scenario (fresh state, same seeds). */
async function build(assets, goblin = false, grid = false) {
  const events = new Events();
  let wdef = assets.world('world_m1');
  if (grid) { const geo = globalThis.ASSETS.levels.world_geo; if (geo && geo.util) geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util); if (!(wdef.terrainGrid && wdef.bounds && wdef.bounds.shape === 'polygon')) wdef = gridVariant(wdef, geo); }
  const world = World.load(wdef, assets, { physics: 'mesh', events });
  // fauna: fixture rabbit + deer, plus a bench fox that hunts rabbits (predator-prey, LIFE-06)
  const fx = JSON.parse(JSON.stringify(FIXTURE_FX));
  fx.animals.fox = Object.assign(JSON.parse(JSON.stringify(FIXTURE_FX.animals.rabbit)), { hunts: ['rabbit'], huntR: 20, chaseMaxS: 6, eatS: 3 });
  fx.animals.fox.spawn = { habitats: ['forest', 'edge', 'meadow'].filter(Boolean), cap: 2, cellChance: 0.9, kind: 'ground' };
  fx.animals.rabbit.fleeFrom = 'predators';
  const fdef = compileFaunaDef(fx, fixtureModels(), { warn: () => {} });
  const env = {
    groundAt: () => 0, slopeZ: () => 1, habitatAt: () => 1, blocked: () => false, perchNear: () => false,
    moveCircle: (x, y, dx, dy, r, out) => { out.x = x + dx; out.y = y + dy; },
  };
  const fauna = createFauna(fdef, env, { seed: 7, models: fixtureModels() });
  // beasts: pad to MAX_BEASTS by cloning existing beast entities (as dev/combatBench.js does)
  const found = [];
  world.forEachEntity((e) => { if (e.components && e.components.brain && e.components.brain.kind === 'beast') found.push(e); });
  const realBeasts = found.length;
  // GOB-08: 2 enabled camps from content/life/goblinCamps.json, padded by clones to 20 goblins (6 throwers) = the 38.57 worst case
  let campDefs = [], goblinCount = 0;
  if (goblin) {
    campDefs = activeCamps(readJson('content/life/goblinCamps.json'));
    goblinCount = ensureGoblinCamps(world, campDefs, world.terrain);
    const gobs = []; world.forEachEntity((e) => { if (e.components && e.components.brain && e.components.brain.species === 'goblin') gobs.push(e); });
    let thr = gobs.filter((e) => e.components.brain.role === 'thrower').length;
    for (let n = 0; goblinCount < GOBLINS_AWAKE && gobs.length; n++, goblinCount++) {
      const src = gobs[n % gobs.length], t = src.transform, c = JSON.parse(JSON.stringify(src.components));
      if (thr < THROWERS) { c.brain.role = 'thrower'; thr++; } else c.brain.role = 'melee';
      world.spawn(src.type, { ...t, x: t.x + 1.5 + (n % 5), y: t.y - 1 - (n % 3) }, c, `benchGob${n}`);
    }
    // drop the thrower surplus (the authored camps may hold more than 6)
    let seen = 0; world.forEachEntity((e) => { const b = e.components && e.components.brain; if (b && b.species === 'goblin' && b.role === 'thrower' && ++seen > THROWERS) b.role = 'melee'; });
  }
  const pad = found.filter((e) => !(e.components.brain.species === 'goblin'));
  for (let n = found.length + goblinCount; n < BENCH_BEASTS && pad.length; n++) {
    const src = pad[n % pad.length], t = src.transform;
    world.spawn(src.type, { ...t, x: t.x + 2 * n, y: t.y + 1 }, JSON.parse(JSON.stringify(src.components)), `benchBeast${n}`);
  }
  const nav = buildBeastNav(world, wdef.nav);
  const beasts = createBeastSim(world, { nav, rng: createRng(wdef.nav?.seed ?? 1), events, fauna });
  const OPTS = { height: 1.7, stepUpMax: 0.45, walkCos: 0.7 }, out = {};
  const pushOut = (x, y, o) => { const r = world.collideCircle(x, y, 0, 0, 0.4, world.terrain.groundAt(x, y), true, OPTS, out); o.x = r.x ?? x; o.y = r.y ?? y; };
  const life = lifeFromRoutines(ROUTINES);
  // LIFE-03-SPIKE: the first push-out near the plaza swapped the terrain band (ensureBandFor bake, 260-1400 ms) inside a villager step.
  // In the game the band follows the player (streamBand), not the villagers; bake it at load, never inside a step. Load cost is reported.
  const tw = performance.now(); world.ensureBandFor(PLAZA[0], PLAZA[1]); pushOut(PLAZA[0], PLAZA[1], {});
  const warmMs = performance.now() - tw;
  return { warmMs, campDefs, goblinCount, events, world, nav, fauna, beasts, life, pushOut, realBeasts, groundAt: (x, y) => world.terrain.groundAt(x, y) };
}

async function runScenario(assets, name, dist, opt, goblin = false, at = null) {
  const S = await build(assets, goblin, !!at);
  const nav = S.nav;
  const px = at ? at[0] : PLAZA[0] + dist, py = at ? at[1] : PLAZA[1];
  if (at) S.world.ensureBandFor(px, py); // pose band baked at load, as the game does behind the fade
  const hour0 = opt.start;
  const vill = createVillagers({ life: S.life, nav, groundAt: S.groundAt, collide: S.pushOut, hour: hour0, dayIndex: 0, events: S.events });
  const wolves = [];
  for (let i = 0; i < S.beasts.count; i++) if (S.beasts.wolf[i]) wolves.push(S.beasts.entities[i].id);
  const pack = (wolves.length ? wolves : [S.beasts.entities[0].id]).slice(0, 5);
  const byId = {}; for (let i = 0; i < vill.n; i++) byId[vill.actors[i].id] = vill.actors[i];
  let raidDefs = [{ id: 'bench', pack, target: 'plaza', from: 21, to: 5, chancePerNight: 1, cooldownDays: 0, alt: Object.keys(byId) }];
  if (goblin) { // the real goblinNorth torch raid, forced every night (chance 1, no cooldown)
    const g = readJson('content/life/raids.json').raids.find((r) => r.id === 'goblinNorth');
    raidDefs = [{ ...g, target: 'plaza', from: 21, to: 5, chancePerNight: 1, cooldownDays: 0, alt: Object.keys(byId) }];
  }
  const raids = createRaids({
    defs: raidDefs, campDefs: S.campDefs,
    sim: S.beasts, events: S.events, state: {}, anchors: { plaza: [PLAZA[0], PLAZA[1]] },
    npcPos: (id, o) => { const a = byId[id]; if (!a || a.hidden) return false; o.x = a.x; o.y = a.y; return true; },
  });
  let raidStarts = 0; S.events.on('life:raid:start', () => { raidStarts++; });
  const camps = goblin ? createGoblinCamps({ defs: S.campDefs, sim: S.beasts, events: S.events, state: {} }) : null;
  const player = { x: px, y: py, sprinting: false }, cam = { x: px, y: py, fx: 0, fy: 1, hfovRad: 1.4 };
  // GOB-08: enemy spear sim (GOBLIN_SPEAR_CFG on the arrow sim, owner 'enemy') vs a stand-in player; the pool is kept full (8 in flight)
  let spears = null, lob = { vx: 0, vy: 0, vz: 0 }, throwers = [];
  if (goblin) {
    const pent = { data: { transform: { x: px, y: py, z: 0, yaw: 0 }, components: { health: { hp: 1e9, max: 1e9 } } } };
    const wproxy = { get: (id) => (id === 'player' ? pent : null), raySegment: (...a) => S.world.raySegment(...a), raySegmentRay: (s, o) => S.world.raySegmentRay(s, o), flowAt: (...a) => S.world.flowAt(...a) };
    spears = createArrowSim(wproxy, S.events, GOBLIN_SPEAR_CFG, createPlayerTarget(wproxy), null, { owner: 'enemy' });
    S.beasts.step(px, py, 0); // slots exist; collect thrower ids for the keep-full top-up
    for (let i = 0; i < S.beasts.count; i++) if (S.beasts.ranged[i]) throwers.push(i);
    S.events.on('beast:throw', (p) => { lobVelocity(p.x, p.y, p.z, p.tx, p.ty, p.tz, GOBLIN_SPEAR_CFG.speedH, GOBLIN_SPEAR_CFG.g, lob); spears.fireVel(p.x, p.y, p.z, lob.vx, lob.vy, lob.vz, 1, p.id); });
  }
  const total = Math.round(opt.hours * STEPS_PER_HOUR), WARM = Math.min(600, total >> 2);
  const ta = new Float64Array(total), tv = new Float64Array(total), tr = new Float64Array(total), tf = new Float64Array(total), tb = new Float64Array(total);
  const pz = S.groundAt(px, py);
  let alive = 0, aliveSamples = 0, heap0 = 0, flyMax = 0;
  const gc = globalThis.gc;
  for (let k = 0; k < total; k++) {
    if (k === WARM) { if (gc) gc(); heap0 = process.memoryUsage().heapUsed; }
    const h = hour0 + k / STEPS_PER_HOUR, day = Math.floor(h / 24), hr = h - day * 24;
    let t0 = performance.now();
    vill.step(hr, day, px, py);
    let t1 = performance.now(); tv[k] = t1 - t0;
    raids.step(day, hr);
    t0 = performance.now(); tr[k] = t0 - t1;
    S.fauna.update(1 / 60, player, cam);
    t1 = performance.now(); tf[k] = t1 - t0;
    S.beasts.step(px, py, pz);
    if (goblin) camps.step(day, px, py); // camp dormancy checks count as beastSim goblin extras
    t0 = performance.now(); tb[k] = t0 - t1;
    if (goblin) {
      // top the pool up to 8 in flight: 10 m lobs from the thrower slots around the player (worst case, regardless of the brains' reload)
      const sx = px + 10 * Math.cos(k * 0.1), sy = py + 10 * Math.sin(k * 0.1);
      while (spears.flyingCount < SPEARS_FLYING) { lobVelocity(sx, sy, 1.4, px + 6, py, 0.9, GOBLIN_SPEAR_CFG.speedH, GOBLIN_SPEAR_CFG.g, lob); if (!spears.fireVel(sx, sy, 1.4, lob.vx, lob.vy, lob.vz, 1, 'bench')) break; }
      t1 = performance.now(); spears.step(); ta[k] = performance.now() - t1;
      if (spears.flyingCount > flyMax) flyMax = spears.flyingCount;
    }
    if (k % 600 === 0) { alive += S.fauna.spawner.stats.alive ?? S.fauna.slots.filter((s) => s.alive).length; aliveSamples++; }
  }
  let heapGrowth = null;
  if (gc) { gc(); heapGrowth = process.memoryUsage().heapUsed - heap0; }
  let spearHeap = null;
  if (goblin && gc) { // enemy projectile alloc: 6000 steps of a full pool, nothing else running
    for (let k = 0; k < 600; k++) { while (spears.flyingCount < SPEARS_FLYING) { lobVelocity(px + 10, py, 1.4, px, py, 0.9, 13, GOBLIN_SPEAR_CFG.g, lob); if (!spears.fireVel(px + 10, py, 1.4, lob.vx, lob.vy, lob.vz, 1, 'bench')) break; } spears.step(); }
    gc(); const h0 = process.memoryUsage().heapUsed;
    for (let k = 0; k < 6000; k++) { while (spears.flyingCount < SPEARS_FLYING) { lobVelocity(px + 10, py, 1.4, px, py, 0.9, 13, GOBLIN_SPEAR_CFG.g, lob); if (!spears.fireVel(px + 10, py, 1.4, lob.vx, lob.vy, lob.vz, 1, 'bench')) break; } spears.step(); }
    gc(); spearHeap = process.memoryUsage().heapUsed - h0;
  }
  const life = new Float64Array(total); for (let k = 0; k < total; k++) life[k] = tv[k] + tr[k];
  const n = total - WARM, sub = (a) => a.subarray(WARM);
  const res = {
    scenario: name, dist, steps: total, beasts: S.beasts.count, realBeasts: S.realBeasts, villagers: vill.n, packSize: pack.length,
    raidStarts, goblins: S.goblinCount, throwers: throwers.length, flyMax, faunaAliveAvg: aliveSamples ? +(alive / aliveSamples).toFixed(1) : 0, raidSeen: raids.isActive(0) || null,
    warmMs: +S.warmMs.toFixed(1), heapGrowthBytes: heapGrowth, spearHeap, astar: vill.stats.astar, maxAstarPerStep: vill.stats.maxPerStep,
    sys: { villagers: summarize(sub(tv), n), raids: summarize(sub(tr), n), life: summarize(sub(life), n), fauna: summarize(sub(tf), n), beast: summarize(sub(tb), n), ...(goblin ? { spears: summarize(sub(ta), n) } : {}) },
  };
  if (S.world.dispose) S.world.dispose();
  return res;
}

export async function runBench(opt) {
  const { assets } = await loadTestAssets();
  const results = [];
  for (const [name, dist] of SCENARIOS.slice(0, opt.scenarios ?? SCENARIOS.length)) results.push(await runScenario(assets, name, dist, opt));
  if (opt.poses) for (const [nm, x, y] of POSES) { const r = await runScenario(assets, 'pose ' + nm, 0, opt, false, [x, y]); results.push(r); }
  // GOB-08: 48 beasts, 20 goblins awake (2 camps + torch raid), 6 throwers, 8 spears in flight, player in Outwall
  let gob = null;
  if (opt.goblin !== false) { gob = await runScenario(assets, 'goblins 48 beasts', 0, { ...opt, hours: opt.goblinHours ?? opt.hours }, true); results.push(gob); }
  const rows = [];
  for (const r of results) {
    if (r === gob) continue;
    if (r.scenario.startsWith('pose ')) { const v = r.sys.life.p95 + r.sys.fauna.p95 + r.sys.beast.p95; rows.push({ scenario: r.scenario, label: 'WM-06 life+fauna+beast JS p95 sum (ms, cap 8 = D-007)', value: v, cap: 8, verdict: v <= 8 ? 'PASS' : 'FLAG' }); continue; }
    for (const b of BUDGETS) {
      const v = r.sys[b.sys][b.stat];
      rows.push({ scenario: r.scenario, label: b.label, value: v, cap: b.cap, verdict: b.cap == null ? 'INFO' : v <= b.cap ? 'PASS' : 'FLAG' });
    }
    rows.push({ scenario: r.scenario, label: 'heap growth after warm-up (bytes)', value: r.heapGrowthBytes, cap: null, verdict: r.heapGrowthBytes == null ? 'INFO (run with --expose-gc)' : 'INFO' });
    rows.push({ scenario: r.scenario, label: 'villager step p99.9 (ms; max is GC/OS noise from the other systems, see lane note)', value: r.sys.villagers.p999, cap: 4, verdict: r.sys.villagers.p999 <= 4 ? 'PASS' : 'FLAG' });
    rows.push({ scenario: r.scenario, label: 'load-time band warm-up (ms, not per step)', value: r.warmMs, cap: null, verdict: 'INFO' });
    rows.push({ scenario: r.scenario, label: 'A* per step max', value: r.maxAstarPerStep, cap: 1, verdict: r.maxAstarPerStep <= 1 ? 'PASS' : 'FLAG' });
  }
  if (gob) {
    const base = results[0], sc = 'goblins 48 beasts', b = gob.sys.beast, sp = gob.sys.spears;
    const row = (label, value, cap, verdict) => rows.push({ scenario: sc, label, value, cap, verdict: verdict ?? (cap == null ? 'INFO' : value <= cap ? 'PASS' : 'FLAG') });
    row(`setup: ${gob.beasts} beasts, ${gob.goblins} goblins, ${gob.throwers} throwers, max ${gob.flyMax} spears in flight`, gob.goblins, null, gob.beasts === 48 && gob.goblins === GOBLINS_AWAKE && gob.throwers === THROWERS && gob.flyMax === SPEARS_FLYING ? 'PASS' : 'FLAG');
    row('beastSim goblin extras mean (goblin scenario minus the 48-beast "in Outwall" baseline, ms)', b.mean - base.sys.beast.mean, 0.1);
    row('goblin torch raid started (goblinNorth, forced nightly)', gob.raidStarts, null, gob.raidStarts > 0 ? 'PASS' : 'FLAG');
    row('beastSim total mean (ms)', b.mean, null);
    row('enemy projectiles (arrow sim, owner enemy) mean (ms)', sp.mean, 0.03);
    row('enemy projectiles p99.9 (ms)', sp.p999, null);
    row('enemy projectile heap growth over 6000 steps (bytes, 0 alloc)', gob.spearHeap, 4096, gob.spearHeap == null ? 'INFO (run with --expose-gc)' : undefined);
    row('whole-scenario heap growth after warm-up (bytes)', gob.heapGrowthBytes, null, gob.heapGrowthBytes == null ? 'INFO (run with --expose-gc)' : 'INFO');
    row('goblin raid + camps + villagers life mean (ms)', gob.sys.life.mean, 0.25);
  }
  return { options: opt, chat: 'skipped (game/js/life/chat.js missing on this branch)', results, rows, flags: rows.filter((r) => r.verdict === 'FLAG').length };
}

/** ANIM-C-04: fauna feed + leg driver cost with `n` animals (quadruped16 fixture standing in for deer/fox/goat rigs), ms/frame at 60 Hz.
 *  Compares legIk off vs on; D-007: the on-p95 (plus the other life rows, <= 8 ms) must stay within the JS budget. Hills = synthetic groundAt. */
export async function benchLegs(n = 30, frames = 3000) {
  const { createFaunaFeed, VoxelPool, packVoxelModel } = await import('../engine/index.js');
  const { quadruped16 } = await import('../engine/dev.js');
  const def = compileFaunaDef(FIXTURE_FX, fixtureModels());
  const pm = packVoxelModel(quadruped16, () => 1);
  const ground = { groundAt: (x, y) => 0.6 * Math.sin(x * 0.2) + 0.5 * Math.cos(y * 0.15) };
  const res = {};
  for (const legIk of [false, true]) {
    const pool = new VoxelPool(); pool.renderer = 'mesh';
    for (const k of ['rabbit', 'deer', 'deerBuck']) pool.models.set(k, pm);
    const slots = [];
    for (let i = 0; i < n; i++) slots.push({ alive: true, species: 1, model: 0, x: -20 + (i % 10) * 4, y: -8 - Math.floor(i / 10) * 5, z: 0, yaw: -Math.PI / 2, cp: { clip: 1, frame: 0, tMs: 0, fromClip: -1, fromFrame: 0, fromTMs: 0, fadeMs: 0, fadeT: 0 } });
    const feed = createFaunaFeed(def, slots, { drawMax: n, legIk, ground });
    const cam = { x: 0, y: 0, z: 1.7, yawDeg: 0, pitchDeg: 0, dtMs: 1000 / 60 };
    const t = new Float64Array(frames);
    for (let f = -300; f < frames; f++) {
      for (let i = 0; i < n; i++) { const s = slots[i]; s.y -= 1.2 / 60; s.x += Math.sin(f * 0.01 + i) * 0.4 / 60; if (s.y < -60) s.y += 55; }
      const t0 = performance.now(); pool.beginFrame(); feed.feed(pool, cam); const dt = performance.now() - t0;
      if (f >= 0) t[f] = dt;
    }
    res[legIk ? 'on' : 'off'] = { ...summarize(t, frames), drawn: feed.stats.drawn, solved: feed.stats.legs };
  }
  return res;
}

if (process.argv.includes('--legs') && process.argv[1]?.endsWith('bench-life.mjs')) {
  const n = +(process.argv[process.argv.indexOf('--legs') + 1]) || 30;
  const r = await benchLegs(n);
  for (const k of ['off', 'on']) console.log(`legs ${k}: drawn ${r[k].drawn} solved ${r[k].solved} feed ms p50 ${r[k].p50.toFixed(4)} p95 ${r[k].p95.toFixed(4)} max ${r[k].max.toFixed(4)} mean ${r[k].mean.toFixed(4)}`);
  console.log(`delta p95 ${(r.on.p95 - r.off.p95).toFixed(4)} ms (D-007 JS budget 8 ms total)`);
  process.exit(0);
}
if (import.meta.url === new URL(process.argv[1], 'file:///').href || process.argv[1]?.endsWith('bench-life.mjs')) {
  const opt = parseArgs(process.argv);
  const out = await runBench(opt);
  if (opt.json) console.log(JSON.stringify(out, null, 1));
  else if (!opt.quiet) {
    const f = (v) => v.toFixed(4).padStart(8);
    console.log(`bench-life: ${opt.hours} game h from ${opt.start}:00, fixed 60 Hz step. chat: ${out.chat}`);
    for (const r of out.results) {
      console.log(`\n[${r.scenario}] ${r.steps} steps, villagers ${r.villagers}, beasts ${r.beasts} (${r.realBeasts} real), raid pack ${r.packSize}, goblins ${r.goblins ?? 0}, raid starts ${r.raidStarts}, throwers ${r.throwers ?? 0}, fauna alive avg ${r.faunaAliveAvg}, A* ${r.astar}`);
      console.log('  system        p50(ms)  p95(ms) p99.9(ms) max(ms) mean(ms)');
      for (const k of ['villagers', 'raids', 'life', 'fauna', 'beast', 'spears']) { const s = r.sys[k]; if (!s) continue; console.log(`  ${k.padEnd(12)} ${f(s.p50)} ${f(s.p95)} ${f(s.p999)} ${f(s.max)} ${f(s.mean)}`); }
      console.log(`  heap growth after warm-up: ${r.heapGrowthBytes == null ? 'n/a (no --expose-gc)' : (r.heapGrowthBytes / 1024).toFixed(0) + ' KiB'}`);
    }
    console.log('\nbudgets:');
    for (const r of out.rows) console.log(`  ${r.verdict.padEnd(5)} [${r.scenario}] ${r.label}: ${r.value == null ? 'n/a' : +r.value.toFixed(4)}${r.cap != null ? ' (cap ' + r.cap + ')' : ''}`);
    console.log(`\n${out.flags ? 'FLAG: ' + out.flags + ' row(s) over budget' : 'PASS: all capped rows within budget'}`);
  }
  process.exit(opt.strict && out.flags ? 1 : 0);
}
