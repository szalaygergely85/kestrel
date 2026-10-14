// BH-A1: resetAll() with a dormant slot below a dead / down slot must not throw and keeps every slot index.
// Run: node game/js/quest/sim/beastResetAll.test.js
import {
  World, NavGrid, createAStar, createRng, createHasher, SIM_STEP, hasLineOfSight, integrate, PHYSICS, NOISE_SPRINT, NOISE_SWING,
} from '../../../../engine/index.js';
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
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { buildBeastNav } from './beastNav.js';
import { canSee } from './sight.js';
import { createBeastSim, STATE_CHASE } from './beastSim.js';

paletteMod; detailPassMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; boarMod; m3PropsMod; canSee; buildBeastNav; hasLineOfSight; integrate; PHYSICS; NOISE_SPRINT; NOISE_SWING; createHasher; SIM_STEP;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const ent = (id, x, y) => ({ id, type: 'beast', x, y, z: 'ground', components: { voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' }, brain: { kind: 'beast', home: [x, y] }, targetable: { radius: 0.45, height: 0.7 } } });
const orig = console.warn; console.warn = () => {};
const world = World.load({ name: 'beastTile', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }],
  entities: [ent('a', 1480, 1000), ent('b', 1485, 1000), ent('c', 1490, 1000)], state: {} }, assets, { physics: 'grid' });
console.warn = orig;
const mk = (x0) => { const g = new NavGrid({ x0, y0: 928, w: 100, h: 192, cell: 1 }); g.buildFromWorld(world, { maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] }); return g; };
const A = mk(1400), B = mk(1450); // B: shifted 50 m east -> 'west' (x 1420) is outside B, 'east' (1560) is outside A
const listeners = new Map();
const events = { on(n, f) { let s = listeners.get(n); if (!s) listeners.set(n, s = new Set()); s.add(f); return () => s.delete(f); }, emit(n, p) { const s = listeners.get(n); if (s) for (const f of Array.from(s)) f(p); } };
const sim = createBeastSim(world, { nav: { grid: A, astar: createAStar(A) }, rng: createRng(1), events });
const slot = (id) => sim.slotOf(id);


const [S0, S1, S2] = [slot('a'), slot('b'), slot('c')];
// variant 1: dormant 0 + dead 1 (agent removed like a corpse)
sim.setDormant(S0, true);
sim.steer.removeAgent(S1); sim.state[S1] = 12;
let threw = null; try { sim.resetAll(); } catch (e) { threw = e; }
ok('resetAll with dormant slot 0 below dead slot 1 does not throw', !threw, threw && threw.message);
ok('dormant slot stays parked, dead slot re-added at its own index', sim.steer.active[S0] === 0 && sim.steer.active[S1] === 1 && sim.steer.active[S2] === 1);
// variant 2: dormant 0 + down (parked) 2
sim.setDormant(S0, true); sim.setDown(S2, true);
threw = null; try { sim.resetAll(); } catch (e) { threw = e; }
ok('resetAll with dormant slot 0 below a down slot 2 does not throw', !threw, threw && threw.message);
ok('down slot re-added at index 2, slot 0 still parked', sim.steer.active[S2] === 1 && sim.steer.active[S0] === 0);
// steer unit
const st = sim.steer;
ok('activateAgent on an active slot returns -1', st.activateAgent(S1, 0, 0, 0.4, 0, 1) === -1);
console.log(failures.join(String.fromCharCode(10)) || ''); console.log(`beastResetAll: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
