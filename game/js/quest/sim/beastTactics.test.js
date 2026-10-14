// BEAST-04: attack tokens + group tactics (tactics.js). Run: node --expose-gc game/js/quest/sim/beastTactics.test.js
import { readFileSync } from 'node:fs';
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
import { buildBeastNav } from './beastNav.js';
import { createBeastSim, STATE_WANDER, STATE_RETURN, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_STAGGER, STATE_CIRCLE } from './beastSim.js';
import { KINDS } from './beastKinds.js';
import { COMBAT_TARGETS, toSteps } from './beastConfig.js';
import { createTactics, FLANK_X, FLANK_Y, TOK_M, TOK_R, TOK_S } from './tactics.js';
import { allocProbe } from '../../../../tools/allocProbe.mjs';

lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; paletteMod; detailPassMod; terrainMod; boarMod; NavGrid;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const HX = 1461, HY = 1031;
const orig = console.warn; console.warn = () => {};
// kinds placed close together (3 per row, 3 m apart) around (HX, HY)
function mk(kinds, seed = 1) {
  const entities = kinds.map((k, n) => { const x = HX + (n % 3) * 3, y = HY + Math.floor(n / 3) * 3;
    return { id: 'b' + n, type: 'beast', x, y, z: 'ground',
      components: { voxel: { anim: 'idle', loop: true, model: 'goblin' }, brain: { kind: 'beast', home: [x, y], beastKind: k }, targetable: { radius: 0.45, height: 0.7 } } }; });
  const world = World.load({ name: 't', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities, state: {} }, assets, { physics: 'grid' });
  const nav = buildBeastNav(world, NAV_CFG);
  return { world, sim: createBeastSim(world, { nav, rng: createRng(seed), seed, events: { emit() {}, on() {} } }) };
}
const attackers = (sim) => { let n = 0; for (let k = 0; k < sim.count; k++) if (sim.state[k] === STATE_WINDUP || sim.state[k] === STATE_CHARGE) n++; return n; };

// AC1: 6 wolves, player 8 m away: never more than tokM melee attackers at once; counters match holders; no stale token
for (const [diff, cap] of [['normal', 2], ['easy', 1], ['hard', 3]]) {
  const { world, sim } = mk(Array(6).fill('grey_wolf'));
  sim.tactics.setDifficulty(diff);
  const px = HX + 4, py = HY - 8, z = world.terrain.heightAt(px, py);
  let maxAtt = 0, circled = 0, leak = true, bad = '';
  for (let t = 0; t < 1800; t++) {
    sim.step(px, py, z);
    const a = attackers(sim); if (a > maxAtt) maxAtt = a;
    let held = 0; for (let k = 0; k < 6; k++) { if (sim.tactics.held[k]) held++; if (sim.state[k] === STATE_CIRCLE) circled++; }
    if (held !== sim.tactics.nM) { leak = false; bad = `t=${t} held=${held} nM=${sim.tactics.nM}`; }
    if (held > cap) { leak = false; bad = 'over cap ' + held; }
  }
  ok(`6 wolves ${diff}: attackers <= ${cap} (max ${maxAtt}, tokens used ${sim.tactics.maxMelee})`, maxAtt <= cap && sim.tactics.maxMelee >= 1, `maxAtt=${maxAtt} maxMelee=${sim.tactics.maxMelee}`);
  ok(`6 wolves ${diff}: counters match holders`, leak, bad);
  if (diff === 'normal') ok('normal: token-less wolves circle (waiting on a flank slot)', circled > 0);
}
// leak guard: stagger / return / dormancy release, 180-step timeout
{ const { world, sim } = mk(['grey_wolf', 'grey_wolf', 'grey_wolf']); const T = sim.tactics;
  const px = HX, py = HY - 40, z = world.terrain.heightAt(px, py); // far: nobody engages by itself
  sim.step(px, py, z);
  ok('request grants up to tokM', T.request(0, TOK_M) && T.request(1, TOK_M) && !T.request(2, TOK_M) && T.nM === 2);
  sim.state[0] = STATE_STAGGER; sim.state[1] = STATE_WINDUP; sim.step(px, py, z);
  ok('STAGGER releases, WINDUP keeps', T.held[0] === 0 && T.held[1] === TOK_M && T.nM === 1);
  sim.state[1] = STATE_RETURN; sim.step(px, py, z); ok('RETURN releases', T.held[1] === 0 && T.nM === 0);
  T.request(2, TOK_M);
  for (let t = 0; t < 200; t++) { sim.state[2] = STATE_RECOVER; sim.timer[2] = 99999; sim.step(px, py, z); }
  ok('180-step holder timeout frees a stuck token', T.held[2] === 0 && T.nM === 0, `held=${T.held[2]} nM=${T.nM}`);
  T.request(0, TOK_M); sim.state[0] = STATE_CHARGE; sim.setDormant(0, true); sim.step(px, py, z);
  ok('dormancy releases', T.held[0] === 0 && T.nM === 0, `held=${T.held[0]}`); }
// pools: ranged 2, swarm 2 per group
{ const T = createTactics(8, 1); T.tg[0] = T.tg[1] = T.tg[2] = 1; T.tg[3] = 2;
  ok('ranged pool 2', T.request(4, TOK_R) && T.request(5, TOK_R) && !T.request(6, TOK_R) && T.nR === 2);
  ok('swarm 2 per group (group B independent)', T.request(0, TOK_S) && T.request(1, TOK_S) && !T.request(2, TOK_S) && T.request(3, TOK_S) && T.nS[1] === 2 && T.nS[2] === 1);
  T.release(0); T.release(1); T.release(3); T.release(4); T.release(5);
  ok('release frees every pool', T.nS[1] === 0 && T.nS[2] === 0 && T.nR === 0 && T.nM === 0); }

// AC2: surround slots 120 deg apart
{ const dot = (a, b) => FLANK_X[a] * FLANK_X[b] + FLANK_Y[a] * FLANK_Y[b];
  ok('flank table unit vectors', FLANK_X.every((x, k) => Math.abs(x * x + FLANK_Y[k] * FLANK_Y[k] - 1) < 1e-9));
  ok('slots 0/2/4 and 1/3/5 are 120 deg apart (cos -0.5)', [[0, 2], [2, 4], [4, 0], [1, 3], [3, 5], [5, 1]].every(([a, b]) => Math.abs(dot(a, b) + 0.5) < 1e-9)); }
{ const { world, sim } = mk(Array(6).fill('grey_wolf')); sim.tactics.setDifficulty('easy'); // 1 token -> circlers
  const px = HX + 4, py = HY - 8, z = world.terrain.heightAt(px, py); let okSp = false, got = '';
  const d = (x, y) => Math.abs(FLANK_X[x] * FLANK_X[y] + FLANK_Y[x] * FLANK_Y[y] + 0.5) < 1e-9;
  for (let t = 0; t < 900 && !okSp; t++) { sim.step(px, py, z);
    const f = []; for (let k = 0; k < 6; k++) if (sim.state[k] === STATE_CIRCLE && sim.tactics.flank[k] >= 0) f.push(sim.tactics.flank[k]);
    if (f.length >= 3) { okSp = d(f[0], f[1]) && d(f[1], f[2]) && d(f[2], f[0]); got = f.join(','); } }
  ok('live pack: first three circlers sit 120 deg apart', okSp, got); }

// AC3: ranged keeps 10-14 m, backs off < 6 m; caster stays behind allies
{ const { world, sim } = mk(['skeleton_archer']);
  let px = HX, py = HY - 18, z = world.terrain.heightAt(px, py), minD = 1e9, maxD = 0;
  for (let t = 0; t < 1200; t++) { sim.step(px, py, z); if (t > 900) { const dd = Math.hypot(sim.steer.x[0] - px, sim.steer.y[0] - py); minD = Math.min(minD, dd); maxD = Math.max(maxD, dd); } }
  ok('ranged settles in 9..15 m (strafe tolerance)', minD > 9 && maxD < 15, `${minD.toFixed(1)}..${maxD.toFixed(1)}`);
  px = sim.steer.x[0]; py = sim.steer.y[0] + 3; z = world.terrain.heightAt(px, py);
  sim.step(px, py, z); ok('inside 6 m -> back-off flag', sim.waiting[0] === 2, 'w=' + sim.waiting[0] + ' st=' + sim.state[0]);
  const d0 = Math.hypot(sim.steer.x[0] - px, sim.steer.y[0] - py);
  for (let t = 0; t < 60; t++) sim.step(px, py, z);
  const d1 = Math.hypot(sim.steer.x[0] - px, sim.steer.y[0] - py);
  ok('backs off when the player closes in', d1 > d0 + 0.5, `${d0.toFixed(2)} -> ${d1.toFixed(2)}`); }
{ const { world, sim } = mk(['grey_wolf', 'grey_wolf', 'goblin_shaman']);
  const px = HX + 2, py = HY - 14, z = world.terrain.heightAt(px, py); let good = 0, n = 0;
  for (let t = 0; t < 900; t++) { sim.step(px, py, z);
    if (t > 600) { const st = sim.steer, cx = (st.x[0] + st.x[1]) / 2, cy = (st.y[0] + st.y[1]) / 2;
      n++; if (Math.hypot(st.x[2] - px, st.y[2] - py) > Math.hypot(cx - px, cy - py) - 0.5) good++; } }
  ok('caster stays behind its allies', good / n > 0.9, `${good}/${n}`); }

// AC4: wind-up floor
{ let worst = 1e9, who = ''; for (const k of Object.keys(KINDS)) for (const a of KINDS[k].attacks) if (a.windupSec < worst) { worst = a.windupSec; who = k + '/' + a.id; }
  ok(`every kind attack wind-up >= ${COMBAT_TARGETS.windupMinSec} s (worst ${who} ${worst})`, worst >= COMBAT_TARGETS.windupMinSec - 1e-9);
  const { sim } = mk(['grey_wolf', 'skeleton_archer']); ok('tactical slot wind-up steps >= 0.4 s', sim.ssteps[0].windup >= toSteps(0.4) && sim.ssteps[1].windup >= toSteps(0.4), `${sim.ssteps[0].windup}/${sim.ssteps[1].windup}`); }

// AC5: determinism over 10k steps (positions + states + tokens + flank slots); rule 15 scan
function run(seed, steps) {
  const { world, sim } = mk(['grey_wolf', 'grey_wolf', 'grey_wolf', 'grey_wolf', 'skeleton_archer', 'goblin_shaman', 'spiderling'], seed);
  let h = 2166136261 >>> 0; const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  const mix = (v) => { h = Math.imul(h ^ v, 16777619) >>> 0; };
  for (let t = 0; t < steps; t++) {
    const ph = (t % 600) / 600, tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
    const px = HX + 20 * tri, py = HY - 6 - 10 * tri; sim.step(px, py, world.terrain.heightAt(px, py));
    if (t % 10 === 0) for (let k = 0; k < sim.count; k++) { f[0] = sim.steer.x[k]; mix(u[0]); mix(u[1]); mix(sim.state[k]); mix(sim.tactics.held[k]); mix(sim.tactics.flank[k] + 8); }
  }
  return h;
}
{ const a = run(7, 10000), b = run(7, 10000); ok('10k steps: same seed -> identical hash', a === b, a + ' vs ' + b); }
{ const code = readFileSync(new URL('./tactics.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  ok('rule 15: no Math.random / trig / clock / Map / Set in tactics.js', !/Math\.(random|sin|cos|tan|atan2?)|Date\.now|performance\.now|new Map|new Set/.test(code)); }

// AC6: allocation delta of the tactics layer (same 6-wolf scene with tactOn zeroed = legacy ground path)
{ const measure = (tact) => { const { world, sim } = mk(Array(6).fill('grey_wolf')); if (!tact) sim.tactOn.fill(0);
    const z = world.terrain.heightAt(HX + 4, HY - 8); let k = 0;
    return allocProbe((n) => { for (let t = 0; t < n; t++, k++) { const ph = (k % 400) / 400, tri = ph < 0.5 ? ph * 2 : 2 - ph * 2; sim.step(HX + 4 + 10 * tri, HY - 8, z); } }, { n: 2000 }); };
  const A = measure(true), B = measure(false);
  if (A.skipped) console.log('SKIP alloc (no --expose-gc)');
  else { console.log(`tactics alloc: with ${A.perCall.toFixed(1)} B/step, without ${B.perCall.toFixed(1)} B/step`); ok('tactics layer adds < 20 B/step', A.perCall - B.perCall < 20, (A.perCall - B.perCall).toFixed(1)); } }

// BEAST-04 ARCH CHANGES: token-less waiters sit in the sticky STATE_CIRCLE (no CHASE<->waiting flip-flop at the ring)
{ const { world, sim } = mk(Array(6).fill('grey_wolf')); sim.tactics.setDifficulty('easy'); // 1 token, 5 waiters
  const px = HX + 4, py = HY - 8, z = world.terrain.heightAt(px, py);
  const last = new Int16Array(6).fill(-1); let flips = 0, circled = 0;
  for (let t = 0; t < 600; t++) { sim.step(px, py, z);
    for (let k = 0; k < 6; k++) { const s = sim.state[k];
      if (s === STATE_CIRCLE) circled++;
      if (last[k] === STATE_CIRCLE && s !== STATE_CIRCLE && s !== STATE_WINDUP) flips++; // a waiter only leaves CIRCLE by winning the token (leash/lose aside)
      last[k] = s; } }
  ok('600 steps: token-less waiters do not flip-flop (CIRCLE exits other than to WINDUP: ' + flips + ', circle slot-steps ' + circled + ')', circled > 0 && flips <= 2, 'flips=' + flips);
}
console.warn = orig;
console.log(`beastTactics: ${pass} pass, ${fail} fail`); for (const f of failures) console.log('  FAIL ' + f);
if (fail) process.exit(1);
void STATE_WANDER; void STATE_CHASE; void STATE_RETURN;
