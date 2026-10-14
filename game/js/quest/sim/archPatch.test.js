import { readFileSync } from 'node:fs';
import { World, NavGrid, createRng, createHasher } from '../../../../engine/index.js';
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
import { createBeastSim, STATE_WANDER, STATE_RETURN, STATE_CHASE, STATE_WINDUP, STATE_CHARGE, STATE_RECOVER, STATE_STAGGER } from './beastSim.js';

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
import { allocProbe } from '../../../../tools/allocProbe.mjs';
import { KINDS } from './beastKinds.js';
import { toSteps } from './beastConfig.js';
import { ARCHETYPES } from './archetypes.js';
// ED-AI-02: sim.patchArchetype. Run: node --expose-gc game/js/quest/sim/archPatch.test.js
const px0 = HX + 4, py0 = HY - 30;
const hashOf = (sim) => { const h = createHasher(); sim.hashInto(h); return JSON.stringify(h.digest ? h.digest() : h); };
const run = (sim, world, from, to) => { for (let t = from; t < to; t++) { const px = HX + 10 * Math.sin(t / 90), py = HY - 12; sim.step(px, py, world.terrain.heightAt(px, py)); } };
const KS = ['grey_wolf', 'grey_wolf', 'lynx', 'boar', 'skeleton_archer', 'grey_wolf'];

// 1. every slot of the archetype re-derives; other archetypes + legacy boar untouched
{
  const { world, sim } = mk(KS); run(sim, world, 0, 20);
  const before = (i) => JSON.stringify([sim.scfg[i].noticeR, sim.scfg[i].chase, sim.pNear[i], sim.ssteps[i].notice, sim.tactBand[i * 3 + 2]]);
  const lynx0 = before(2), boar0 = before(3), arch0 = before(4);
  const r = sim.patchArchetype('packHunter', { noticeR: 17, nearR: 6, run: 9.5, walk: 2, noticeSec: 0.5, backOffR: 1 });
  ok('valid patch is accepted', r.ok && r.errors.length === 0);
  ok('nothing changes before the next step', sim.scfg[0].noticeR === ARCHETYPES.packHunter.noticeR);
  const posBefore = [0, 1, 5].map((i) => sim.steer.x[i]);
  sim.step(HX, HY - 12, world.terrain.heightAt(HX, HY - 12));
  for (const i of [0, 1, 5]) ok(`wolf slot ${i} re-derived`, sim.scfg[i].noticeR === 17 && sim.pNear[i] === 6 && sim.scfg[i].chase === 9.5 && sim.scfg[i].walk === 2 && sim.ssteps[i].notice === toSteps(0.5) && sim.tactBand[i * 3 + 2] === 1);
  ok('no respawn: wolves moved at most one step, still alive', [0, 1, 5].every((k, n) => Math.abs(sim.steer.x[k] - posBefore[n]) < 1) && sim.entities[0].components.health.hp > 0);
  ok('other archetypes + legacy boar untouched', before(2) === lynx0 && before(3) === boar0 && before(4) === arch0);
  ok('frozen global table untouched', ARCHETYPES.packHunter.noticeR !== 17 && Object.isFrozen(ARCHETYPES.packHunter));
  ok('ssteps is per slot (no shared mutation)', sim.ssteps[0] !== sim.cfgSteps && sim.ssteps[3] === sim.cfgSteps && sim.cfgSteps.notice !== toSteps(0.5));
  ok('role patch moves the tactical role', sim.patchArchetype('packHunter', { role: 'tank' }).ok && (sim.step(HX, HY - 12, 0), sim.tactOn[0] === 0));
}
// 2. refused patches change nothing and return plain messages
{
  const { world, sim } = mk(KS); run(sim, world, 0, 10);
  const h0 = hashOf(sim), n0 = sim.scfg[0].noticeR;
  const bad = [['packHunter', { noticeR: 500 }, 'Notice distance'], ['packHunter', { nearR: 99 }, 'Near distance'], ['packHunter', { walk: 11, run: 3 }, 'Walk speed'],
    ['packHunter', { aggro: 'sleepy' }, 'Aggression'], ['packHunter', { bogus: 1 }, 'not an archetype field'], ['nope', { noticeR: 5 }, 'does not exist'], ['packHunter', null, 'must be an object']];
  for (const [id, f, msg] of bad) { const r = sim.patchArchetype(id, f); ok(`refused: ${msg}`, !r.ok && r.errors.some((e) => e.includes(msg)), JSON.stringify(r)); }
  ok('queue empty after refusals', sim.ap.n === 0);
  run(sim, world, 10, 11);
  ok('slot config unchanged after refusals', sim.scfg[0].noticeR === n0 && sim.ap.tab.packHunter.noticeR === ARCHETYPES.packHunter.noticeR);
  // two queued patches validate against each other: second would break nearR <= noticeR
  ok('first of a pair ok', sim.patchArchetype('packHunter', { noticeR: 8 }).ok);
  const r2 = sim.patchArchetype('packHunter', { nearR: 12 });
  ok('second validated against the pending first', !r2.ok && r2.errors[0].includes('Near distance'), JSON.stringify(r2));
  h0;
}
// 3. determinism: same patch at the same step = same hash; a different step differs
{
  const go = (patchAt) => { const { world, sim } = mk(KS, 7); for (let t = 0; t < 900; t++) { if (t === patchAt) sim.patchArchetype('packHunter', { noticeR: 40, run: 8, leashR: 60 }); const px = HX + 10 * Math.sin(t / 90), py = HY - 12 + 5 * Math.cos(t / 50); sim.step(px, py, world.terrain.heightAt(px, py)); } return hashOf(sim); };
  const a = go(300), b = go(300), c = go(-1);
  ok('same patch, same step -> same hash', a === b);
  ok('patch changes the run (hash differs from unpatched)', a !== c);
}
// 4. no alloc per step when no patch is pending: a sim that had patches applied costs the same as one that never had any (the check is one int compare)
{
  const measure = (patched) => { const { world, sim } = mk(KS); if (patched) sim.patchArchetype('packHunter', { noticeR: 20 }); run(sim, world, 0, 30);
    const z = world.terrain.heightAt(HX, HY - 80); let k = 0;
    return allocProbe((n) => { for (let t = 0; t < n; t++, k++) sim.step(HX, HY - 80, z); }, { n: 3000 }); };
  const A = measure(true), B = measure(false);
  if (A.skipped) console.log('SKIP alloc (no --expose-gc)');
  else { console.log(`  [alloc] after patch ${A.perCall.toFixed(1)} B/step, never patched ${B.perCall.toFixed(1)} B/step`); ok('patch machinery adds < 8 B/step when idle', A.perCall - B.perCall < 8, (A.perCall - B.perCall).toFixed(1)); }
}
console.warn = orig;
console.log(`archPatch: ${pass} pass, ${fail} fail`); for (const f of failures) console.log('  FAIL ' + f);
if (fail) process.exit(1);
