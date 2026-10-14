import { allocProbe } from '../../../../tools/allocProbe.mjs';
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

import { dropPack, clearTest, stateLabels, runScenario, STATE_LABELS } from './aiTest.js';

lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; paletteMod; detailPassMod; terrainMod; boarMod; NavGrid; createHasher; readFileSync;
// ED-AI-06 sim part. Run: node --expose-gc game/js/quest/sim/aiTest.test.js
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const HX = 1461, HY = 1031;
const orig = console.warn; console.warn = () => {};
function mk() { // 1 live boar + 6 reserve grey wolves (down until dropped)
  const ent = (id, x, y, brain) => ({ id, type: 'beast', x, y, z: 'ground', components: { voxel: { anim: 'idle', loop: true, model: 'goblin' }, brain: { kind: 'beast', home: [x, y], ...brain }, targetable: { radius: 0.45, height: 0.7 } } });
  const entities = [ent('boar', HX + 30, HY, { beastKind: 'boar' })];
  for (let n = 0; n < 6; n++) entities.push(ent('w' + n, HX, HY, { beastKind: 'grey_wolf', group: 'res', reserve: true }));
  const world = World.load({ name: 't', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities, state: {} }, assets, { physics: 'grid' });
  const nav = buildBeastNav(world, NAV_CFG);
  return { world, sim: createBeastSim(world, { nav, rng: createRng(7), seed: 7, events: { emit() {}, on() {} } }) };
}
console.warn = orig;

{
  const { sim } = mk();
  const out = [];
  ok('reserve wolves start down; labels list only the boar', stateLabels(sim, out) === 1 && out[0].label === 'Wandering');
  const slots = dropPack(sim, { kind: 'grey_wolf', count: 3, x: HX, y: HY, seed: 5 });
  ok('dropPack wakes 3 wolves', slots.length === 3 && slots.every((s) => !sim.down[s]));
  const g = sim.grid;
  ok('all on walkable cells within 20 m', slots.every((s) => g.cost[g.index(g.cellX(sim.steer.x[s]), g.cellY(sim.steer.y[s]))] !== 0 && Math.hypot(sim.steer.x[s] - HX, sim.steer.y[s] - HY) < 20));
  const again = mk().sim; const s2 = dropPack(again, { kind: 'grey_wolf', count: 3, x: HX, y: HY, seed: 5 });
  ok('same seed same placement', slots.every((s, i) => s === s2[i] && sim.steer.x[s] === again.steer.x[s] && sim.steer.y[s] === again.steer.y[s]));
  ok('tagged test.* and labels now 4', sim.grp[slots[0]].startsWith('test.') && stateLabels(sim, out) === 4);
  ok('default count = kind group min', dropPack(sim, { kind: 'grey_wolf', x: HX, y: HY, seed: 1 }).length === 3);
  ok('clearTest parks them', clearTest(sim) === 6 && stateLabels(sim, out) === 1);
  ok('every state id 0..23 is named', STATE_LABELS.length === 24 && STATE_LABELS.every((s) => typeof s === 'string' && s.length > 0));
}
{
  const script = { ticks: 400, path: [[HX + 6, HY], [HX + 2, HY]], drops: [{ tick: 5, kind: 'grey_wolf', count: 3, x: HX, y: HY, seed: 3 }] };
  const a = runScenario(mk, script).hash, b = runScenario(mk, script).hash, c = runScenario(mk, script).hash;
  ok('scenario hash stable over 3 runs', a === b && b === c, `${a} ${b} ${c}`);
  ok('different script (seed) changes hash', runScenario(mk, { ...script, drops: [{ ...script.drops[0], seed: 4 }] }).hash !== a);
  const p = { ...script, patches: [{ tick: 100, id: 'packHunter', fields: { run: 9.5 } }] };
  const ph = runScenario(mk, p).hash;
  ok('patch changes hash, twice identical', ph !== a && ph === runScenario(mk, p).hash);
}
{
  const { sim } = mk(); const out = [];
  dropPack(sim, { kind: 'grey_wolf', count: 3, x: HX, y: HY, seed: 5 }); stateLabels(sim, out);
  const r = allocProbe((n) => { for (let i = 0; i < n; i++) stateLabels(sim, out); }, { n: 20000 });
  ok('stateLabels 0 alloc (< 1 B/call, probe noise)', r.skipped || r.perCall < 1, `perCall=${r.perCall}`);
}
console.log(`aiTest: ${pass} passed, ${fail} failed`); for (const f of failures) console.log('  FAIL', f);
process.exit(fail ? 1 : 0);
