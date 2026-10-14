// WM-04 (arch 38.59): beastSim across nav-tile swaps - chase keeps a path, out-of-tile / far beasts dormant + restored, save/load round trip, camp vs tile dormancy independent.
// Run: node game/js/quest/sim/beastTile.test.js
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
  entities: [ent('hunter', 1480, 1000), ent('west', 1420, 1000), ent('east', 1560, 1000)], state: {} }, assets, { physics: 'grid' });
console.warn = orig;
const mk = (x0) => { const g = new NavGrid({ x0, y0: 928, w: 100, h: 192, cell: 1 }); g.buildFromWorld(world, { maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] }); return g; };
const A = mk(1400), B = mk(1450); // B: shifted 50 m east -> 'west' (x 1420) is outside B, 'east' (1560) is outside A
const listeners = new Map();
const events = { on(n, f) { let s = listeners.get(n); if (!s) listeners.set(n, s = new Set()); s.add(f); return () => s.delete(f); }, emit(n, p) { const s = listeners.get(n); if (s) for (const f of Array.from(s)) f(p); } };
const sim = createBeastSim(world, { nav: { grid: A, astar: createAStar(A) }, rng: createRng(1), events });
const slot = (id) => sim.slotOf(id);
const H = slot('hunter'), W = slot('west'), E = slot('east');

// --- chase across a swap keeps a path
let px = 1490, py = 1000;
sim.state[H] = STATE_CHASE; for (let i = 0; i < 40; i++) sim.step(px, py, 0); // same forced-state pattern as beastSim.test.js
ok('hunter chases before the swap', sim.state[H] === STATE_CHASE, sim.state[H]);
const steerAt = (s) => [sim.steer.x[s], sim.steer.y[s]];
sim.rebindNav(B, px, py);
ok('grid + astar + steer bounds rebound', sim.grid === B && sim.astar.grid === B && sim.steer.bounds.x0 === B.x0);
ok('tile dormancy: west (home outside B) dormant, hunter awake', sim.isDormant(W) && !sim.isDormant(H));
ok('swap clears the path and requests a fresh one for the chaser', sim.pathLen[H] === 0 && sim.pathReq[H] === 1);
px = 1500; py = 1005; let sawPath = false;
for (let i = 0; i < 120; i++) { sim.step(px, py, 0); if (sim.pathLen[H] > 0) sawPath = true; }
ok('chaser re-planned on the new tile (path > 0) and is still hunting', sawPath && (sim.state[H] === STATE_CHASE || sim.hunt[H]), `state ${sim.state[H]}`);
const [hx, hy] = steerAt(H);
ok('chaser stays on walkable cells of B', B.inBounds(B.cellX(hx), B.cellY(hy)) && B.cost[B.index(B.cellX(hx), B.cellY(hy))] !== 0);

// --- out-of-tile beasts keep state, restored on return
const wState = sim.state[W], wx = sim.steer.x[W], wy = sim.steer.y[W];
for (let i = 0; i < 60; i++) sim.step(px, py, 0);
ok('dormant beast frozen (state + position kept)', sim.state[W] === wState && sim.steer.x[W] === wx && sim.steer.y[W] === wy);
sim.rebindNav(A, px, py);
ok('back on A: west woken, east (home outside A) dormant', !sim.isDormant(W) && sim.isDormant(E) && sim.state[W] === wState);
for (let i = 0; i < 30; i++) sim.step(px, py, 0);
ok('restored beast runs again (agent active)', sim.steer.active[W] === 1);

// --- 200 m rule + camp reason independence
sim.updateTileDormancy(px + 400, py);
ok('player > 200 m away: all homes dormant', sim.isDormant(H) && sim.isDormant(W));
sim.updateTileDormancy(px, py);
ok('player back: awake again', !sim.isDormant(H) && !sim.isDormant(W));
sim.setDormant(H, true); sim.updateTileDormancy(px, py);
ok('camp dormancy survives a tile re-evaluation', sim.isDormant(H));
sim.setDormant(H, false);
sim.updateTileDormancy(px + 400, py); sim.setDormant(H, false);
ok('camp wake does not wake a tile-dormant beast', sim.isDormant(H));
sim.updateTileDormancy(px, py);

// --- save/load round trip (state kept; dormancy is derived and re-evaluated)
const saved = JSON.parse(JSON.stringify(sim.save()));
for (let i = 0; i < 90; i++) sim.step(px, py, 0); // diverge, then load into a fresh sim on the same tile
sim.load(saved); sim.updateTileDormancy(px, py);
ok('save/load round trip: hunter state + west state identical', sim.state[W] === wState && JSON.stringify(sim.save()) === JSON.stringify(saved));

// --- arch fix: tileNav -> dormancy applied at creation, before any rebindNav/swap
{
  const s2 = createBeastSim(world, { nav: { grid: A, astar: createAStar(A) }, rng: createRng(1), events, tileNav: true, spawn: { x: 1480, y: 1000 } });
  const h2 = s2.slotOf('hunter'), w2 = s2.slotOf('west'), e2 = s2.slotOf('east');
  ok('tileNav: tileMode on at creation, no swap yet', s2.tileMode === true);
  ok('tileNav: east (outside tile A) dormant before any swap, hunter + west awake', s2.dormTile[e2] === 1 && s2.dormant[e2] === 1 && s2.dormTile[h2] === 0 && s2.dormTile[w2] === 0);
  ok('default (no tileNav) stays out of tile mode', createBeastSim(world, { nav: { grid: A, astar: createAStar(A) }, rng: createRng(1), events }).tileMode === false);
}
// --- one A* rebound per same-size tile (no per-tile allocation)
{
  const s3 = createBeastSim(world, { nav: { grid: A, astar: createAStar(A) }, rng: createRng(1), events, tileNav: true, spawn: { x: 1480, y: 1000 } });
  const a0 = s3.astar, B2 = { ...A, x0: A.x0 + 100 };
  s3.rebindNav(B2, 1480, 1000);
  ok('same-size tile swap reuses the A* object and rebinds its grid', s3.astar === a0 && s3.astar.grid === B2);
}
// --- fixed-area sim never in tile mode
ok('tileMode only after rebindNav', sim.tileMode === true);
console.log(failures.join('\n') || ''); console.log(`beastTile: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
