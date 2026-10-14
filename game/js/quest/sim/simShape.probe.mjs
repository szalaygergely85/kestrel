// BITE-ALLOC guard probe (run via simShape.test.js with --allow-natives-syntax): builds 12 sims and checks V8 keeps each one in
// fast-properties mode. V8 flips a big object literal to dictionary mode around ~160 own keys, which boxes every double store.
import { World, NavGrid, createRng, createAStar } from '../../../../engine/index.js';
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
import { buildBeastNav } from './beastNav.js';
import { createBeastSim } from './beastSim.js';

paletteMod; detailPassMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; boarMod; m3PropsMod; NavGrid;
const { assets } = await loadTestAssets();
const MAX_KEYS = 145;
const hasFast = new Function('o', 'return %HasFastProperties(o)');

const ents = [];
for (let k = 0; k < 8; k++) ents.push({ id: `b${k}`, type: 'beast', x: 1455 + k, y: 1028, z: 'ground', components: { voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' }, brain: { kind: 'beast', home: [1455 + k, 1028] }, targetable: { radius: 0.45, height: 0.7 } } });
const warn = console.warn; console.warn = () => {};
const world = World.load({ name: 'simShape', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], entities: ents, state: {} }, assets, { physics: 'grid' });
console.warn = warn;
const nav = buildBeastNav(world, { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] });

let bad = 0;
const sims = [];
for (let n = 0; n < 12; n++) {
  const sim = createBeastSim(world, { nav: { grid: nav.grid, astar: createAStar(nav.grid) }, rng: createRng(n + 1), events: { emit() {}, on() { return () => {}; } } });
  sims.push(sim);
}
sims.forEach((sim, n) => {
  const keys = Object.keys(sim).length;
  const fast = hasFast(sim);
  if (!fast || keys > MAX_KEYS) { bad++; console.log(`FAIL sim#${n}: fast=${fast} keys=${keys} (max ${MAX_KEYS})`); }
});
console.log(`sims=${sims.length} keys=${Object.keys(sims[0]).length} bad=${bad}`);
process.exit(bad ? 1 : 0);
