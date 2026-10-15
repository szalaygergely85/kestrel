// game/js/quest/sim/shieldWire.test.js (SHIELD-WIRE-CHECK-01). Real beastSim + real vitals + real shield sim (the main.js wiring:
// createVitals(..., { block: shieldSim }); beastSim emits combat:hit). Boar charge, wolf leap, goblin charge: frontal hit = 0 dmg,
// knockback, attacker staggers 0.4 s; side/back = normal damage. Run: node game/js/quest/sim/shieldWire.test.js
import { World, createRng } from '../../../../engine/index.js';
import '../../../../design/palette.js'; import '../../../../design/detail-pass.js'; import '../../../../design/levels/overworld_far.js'; import '../../../../design/models/voxel_beast.js';
import '../../../../design/models/lantern.js';
import '../../../../design/models/lever.js';
import '../../../../design/models/boulder.js';
import '../../../../design/models/rubble.js';
import '../../../../design/models/wreckage.js';
import '../../../../design/models/relay.js';
import '../../../../design/models/sword.js';
import '../../../../design/models/m3_props.js';
import '../../../../design/levels/overworld_far.js';
import '../../../../design/models/voxel_beast.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { buildBeastNav } from './beastNav.js';
import { createAStar } from '../../../../engine/index.js';
import { createVitals } from './vitals.js';
import { VITALS_DEFAULTS } from './vitalsConfig.js';
import { createShieldSim } from './shield.js';
import { createBeastSim, STATE_WINDUP, STATE_STAGGER, STATE_RECOVER } from './beastSim.js';

const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const PX = 1461, PY = 1031;

function makeEvents() {
  const l = new Map();
  return {
    on(n, fn) { let s = l.get(n); if (!s) { s = new Set(); l.set(n, s); } s.add(fn); return () => s.delete(fn); },
    emit(n, p) { const s = l.get(n); if (s) for (const fn of Array.from(s)) fn(p); },
  };
}
const SPECIES = { boar: undefined, wolf: 'wolf', goblin: 'goblin' };
/** Player at (PX,PY); beast `deg` degrees around the look axis (look = -y, i.e. toward the beast at 0 deg), 3 m away. */
function rig(species, deg) {
  const a = deg * Math.PI / 180;
  const bx = PX + Math.sin(a) * 3, by = PY - Math.cos(a) * 3;
  const brain = { kind: 'beast', home: [bx, by] }; if (SPECIES[species]) brain.species = SPECIES[species];
  const orig = console.warn; console.warn = () => {};
  const world = World.load({ name: 'sw', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }], state: {}, entities: [
    { id: 'player', type: 'player', x: PX, y: PY, z: 'ground', components: { body: { vx: 0, vy: 0, vz: 0, grounded: true, landed: false, fallDistance: 0, eyeH: 1.6 } } },
    { id: 'b1', type: 'beast', x: bx, y: by, z: 'ground', components: { voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' }, brain, targetable: { radius: 0.45, height: 0.7 } } },
  ] }, assets, { physics: 'grid' });
  console.warn = orig;
  const grid = buildBeastNav(world, NAV_CFG).grid;
  const events = makeEvents();
  const sim = createBeastSim(world, { nav: { grid, astar: createAStar(grid) }, rng: createRng(3), events });
  const shield = createShieldSim();
  const vitals = createVitals(world, events, VITALS_DEFAULTS, { block: shield });
  const player = world.get('player').data;
  vitals.step(player, false);
  for (let i = 0; i < 20; i++) shield.step(true, true, 0, -1); // raised, looking -y
  return { world, sim, shield, vitals, player, bx, by, events };
}
function attack(r) {
  const s = r.sim;
  s.steer.x[0] = r.bx; s.steer.y[0] = r.by;
  const dx = PX - r.bx, dy = PY - r.by, d = Math.hypot(dx, dy);
  s.cdx[0] = dx / d; s.cdy[0] = dy / d;
  s.state[0] = STATE_WINDUP; s.timer[0] = 1; // last windup step -> real enterCharge -> contact
  let hitStep = -1; r.hit = false; r.events.on('combat:hit', (p) => { if (p.target === 'player') r.hit = true; });
  for (let i = 0; i < 90 && hitStep < 0; i++) {
    s.step(PX, PY, 0);
    r.vitals.step(r.player, false);
    if (r.hit) hitStep = i;
  }
  return hitStep;
}

for (const sp of ['boar', 'wolf', 'goblin']) {
  for (const deg of [0, 45, 59]) {
    const r = rig(sp, deg); const step = attack(r);
    const body = r.player.components.body;
    ok(`${sp} ${deg} deg: hit landed`, step >= 0);
    ok(`${sp} ${deg} deg: blocked, 0 damage`, r.vitals.hp === VITALS_DEFAULTS.maxHp, `hp=${r.vitals.hp}`);
    ok(`${sp} ${deg} deg: attacker staggered ${r.sim.cfgSteps.blockStagger} steps (0.4 s)`, r.sim.state[0] === STATE_STAGGER && r.sim.cfgSteps.blockStagger === 24, `state=${r.sim.state[0]} bs=${r.sim.cfgSteps.blockStagger}`);
    ok(`${sp} ${deg} deg: player shoved away from the beast`, (-body.vx * Math.sin(deg * Math.PI / 180) + body.vy * Math.cos(deg * Math.PI / 180)) > 1, `v=${body.vx.toFixed(2)},${body.vy.toFixed(2)}`);
  }
  for (const deg of [90, 180]) {
    const r = rig(sp, deg); attack(r);
    ok(`${sp} ${deg} deg: side/back hit damages`, r.vitals.hp < VITALS_DEFAULTS.maxHp && r.sim.state[0] !== STATE_STAGGER, `hp=${r.vitals.hp} state=${r.sim.state[0]}`);
  }
}
{ // lowered shield never blocks
  const r = rig('boar', 0); for (let i = 0; i < 20; i++) r.shield.step(false, true, 0, -1); attack(r);
  ok('lowered shield: frontal hit damages', r.vitals.hp < VITALS_DEFAULTS.maxHp);
}
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log(`ALL PASS (${pass})`);
