// LIFE-10: living-world simulation budget bench (docs/architecture.md 38.56 part (e)). Node only, no browser.
//   node --expose-gc tools/bench-life.mjs [--hours 24] [--start 18] [--strict] [--json] [--quiet]
// Builds the real world_m1, the 5 Outwall villagers (+schedule), the fauna (rabbit/deer + a bench fox that hunts
// rabbits), the beast sim (fauna hunts + a bench raid) and steps them at the fixed 60 Hz step with the player at 3
// distances from Outwall (in the village, 100 m, 600 m). Prints per-system ms/step p50/p95/max + heap growth, then
// PASS/FLAG per budget row. Exit code is non-zero only with --strict and a FLAG.
// Skipped with a note: chat (game/js/life/chat.js missing on this branch). Villager count is 5 (budget is for 24).
import { World } from '../engine/index.js';
import { compileFaunaDef } from '../engine/fauna/faunaDef.js';
import { createFauna } from '../engine/fauna/fauna.js';
import { FIXTURE_FX, fixtureModels } from '../engine/fauna/wildlifeFx.fixture.js';
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
import { buildBeastNav } from '../game/js/quest/sim/beastNav.js';
import { createBeastSim, MAX_BEASTS } from '../game/js/quest/sim/beastSim.js';
import { createRng } from '../engine/index.js';
import { ROUTINES } from '../game/js/quest/outwallRoutines.js';
import { lifeFromRoutines } from '../game/js/life/schedule.js';
import { createVillagers } from '../game/js/life/villagers.js';
import { createRaids } from '../game/js/life/raids.js';

globalThis.window = globalThis;
paletteMod; terrainDef; geoMod; detailPassMod; lanternMod; leverMod; voxelPropsMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; titleMod; voxelWorldMod;

const STEPS_PER_HOUR = 18000; // 300 s per game hour at 60 Hz (D-064: 2 real hours per day)
const PLAZA = [915, 945];
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
    else if (a === '--scenarios') o.scenarios = +argv[++i]; else if (a === '--hours') o.hours = +argv[++i]; else if (a === '--start') o.start = +argv[++i];
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
async function build(assets) {
  const events = new Events();
  const wdef = assets.world('world_m1');
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
  for (let n = found.length; n < MAX_BEASTS && found.length; n++) {
    const src = found[n % realBeasts], t = src.transform;
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
  return { warmMs, events, world, nav, fauna, beasts, life, pushOut, realBeasts, groundAt: (x, y) => world.terrain.groundAt(x, y) };
}

async function runScenario(assets, name, dist, opt) {
  const S = await build(assets);
  const nav = S.nav;
  const px = PLAZA[0] + dist, py = PLAZA[1];
  const hour0 = opt.start;
  const vill = createVillagers({ life: S.life, nav, groundAt: S.groundAt, collide: S.pushOut, hour: hour0, dayIndex: 0, events: S.events });
  const wolves = [];
  for (let i = 0; i < S.beasts.count; i++) if (S.beasts.wolf[i]) wolves.push(S.beasts.entities[i].id);
  const pack = (wolves.length ? wolves : [S.beasts.entities[0].id]).slice(0, 5);
  const byId = {}; for (let i = 0; i < vill.n; i++) byId[vill.actors[i].id] = vill.actors[i];
  const raids = createRaids({
    defs: [{ id: 'bench', pack, target: 'plaza', from: 21, to: 5, chancePerNight: 1, cooldownDays: 0, alt: Object.keys(byId) }],
    sim: S.beasts, events: S.events, state: {}, anchors: { plaza: [PLAZA[0], PLAZA[1]] },
    npcPos: (id, o) => { const a = byId[id]; if (!a || a.hidden) return false; o.x = a.x; o.y = a.y; return true; },
  });
  const player = { x: px, y: py, sprinting: false }, cam = { x: px, y: py, fx: 0, fy: 1, hfovRad: 1.4 };
  const total = Math.round(opt.hours * STEPS_PER_HOUR), WARM = Math.min(600, total >> 2);
  const tv = new Float64Array(total), tr = new Float64Array(total), tf = new Float64Array(total), tb = new Float64Array(total);
  const pz = S.groundAt(px, py);
  let alive = 0, aliveSamples = 0, heap0 = 0;
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
    tb[k] = performance.now() - t1;
    if (k % 600 === 0) { alive += S.fauna.spawner.stats.alive ?? S.fauna.slots.filter((s) => s.alive).length; aliveSamples++; }
  }
  let heapGrowth = null;
  if (gc) { gc(); heapGrowth = process.memoryUsage().heapUsed - heap0; }
  const life = new Float64Array(total); for (let k = 0; k < total; k++) life[k] = tv[k] + tr[k];
  const n = total - WARM, sub = (a) => a.subarray(WARM);
  const res = {
    scenario: name, dist, steps: total, beasts: S.beasts.count, realBeasts: S.realBeasts, villagers: vill.n, packSize: pack.length,
    faunaAliveAvg: aliveSamples ? +(alive / aliveSamples).toFixed(1) : 0, raidSeen: raids.isActive(0) || null,
    warmMs: +S.warmMs.toFixed(1), heapGrowthBytes: heapGrowth, astar: vill.stats.astar, maxAstarPerStep: vill.stats.maxPerStep,
    sys: { villagers: summarize(sub(tv), n), raids: summarize(sub(tr), n), life: summarize(sub(life), n), fauna: summarize(sub(tf), n), beast: summarize(sub(tb), n) },
  };
  if (S.world.dispose) S.world.dispose();
  return res;
}

export async function runBench(opt) {
  const { assets } = await loadTestAssets();
  const results = [];
  for (const [name, dist] of SCENARIOS.slice(0, opt.scenarios || SCENARIOS.length)) results.push(await runScenario(assets, name, dist, opt));
  const rows = [];
  for (const r of results) {
    for (const b of BUDGETS) {
      const v = r.sys[b.sys][b.stat];
      rows.push({ scenario: r.scenario, label: b.label, value: v, cap: b.cap, verdict: b.cap == null ? 'INFO' : v <= b.cap ? 'PASS' : 'FLAG' });
    }
    rows.push({ scenario: r.scenario, label: 'heap growth after warm-up (bytes)', value: r.heapGrowthBytes, cap: null, verdict: r.heapGrowthBytes == null ? 'INFO (run with --expose-gc)' : 'INFO' });
    rows.push({ scenario: r.scenario, label: 'villager step p99.9 (ms; max is GC/OS noise from the other systems, see lane note)', value: r.sys.villagers.p999, cap: 4, verdict: r.sys.villagers.p999 <= 4 ? 'PASS' : 'FLAG' });
    rows.push({ scenario: r.scenario, label: 'load-time band warm-up (ms, not per step)', value: r.warmMs, cap: null, verdict: 'INFO' });
    rows.push({ scenario: r.scenario, label: 'A* per step max', value: r.maxAstarPerStep, cap: 1, verdict: r.maxAstarPerStep <= 1 ? 'PASS' : 'FLAG' });
  }
  return { options: opt, chat: 'skipped (game/js/life/chat.js missing on this branch)', results, rows, flags: rows.filter((r) => r.verdict === 'FLAG').length };
}

if (import.meta.url === new URL(process.argv[1], 'file:///').href || process.argv[1]?.endsWith('bench-life.mjs')) {
  const opt = parseArgs(process.argv);
  const out = await runBench(opt);
  if (opt.json) console.log(JSON.stringify(out, null, 1));
  else if (!opt.quiet) {
    const f = (v) => v.toFixed(4).padStart(8);
    console.log(`bench-life: ${opt.hours} game h from ${opt.start}:00, fixed 60 Hz step. chat: ${out.chat}`);
    for (const r of out.results) {
      console.log(`\n[${r.scenario}] ${r.steps} steps, villagers ${r.villagers}, beasts ${r.beasts} (${r.realBeasts} real), raid pack ${r.packSize}, fauna alive avg ${r.faunaAliveAvg}, A* ${r.astar}`);
      console.log('  system        p50(ms)  p95(ms)  max(ms)  mean(ms)');
      for (const k of ['villagers', 'raids', 'life', 'fauna', 'beast']) { const s = r.sys[k]; console.log(`  ${k.padEnd(12)} ${f(s.p50)} ${f(s.p95)} ${f(s.max)} ${f(s.mean)}`); }
      console.log(`  heap growth after warm-up: ${r.heapGrowthBytes == null ? 'n/a (no --expose-gc)' : (r.heapGrowthBytes / 1024).toFixed(0) + ' KiB'}`);
    }
    console.log('\nbudgets:');
    for (const r of out.rows) console.log(`  ${r.verdict.padEnd(5)} [${r.scenario}] ${r.label}: ${r.value == null ? 'n/a' : +r.value.toFixed(4)}${r.cap != null ? ' (cap ' + r.cap + ')' : ''}`);
    console.log(`\n${out.flags ? 'FLAG: ' + out.flags + ' row(s) over budget' : 'PASS: all capped rows within budget'}`);
  }
  process.exit(opt.strict && out.flags ? 1 : 0);
}
