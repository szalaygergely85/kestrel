// game/js/quest/sim/loot.test.js (US-091a2, architecture.md 37.16.3). Headless Node ESM, no framework.
// Run: node game/js/quest/sim/loot.test.js   (add --expose-gc for the zero-allocation heap check)
//
// Drives the REAL chain: a World on overworld_far + the tower (beastSim.test.js's fixture), the real beastSim (a
// `combat:hit` kill -> deferred `beast:died` -> CORPSE -> SINK), the real `findInteractTarget`/`updateInteraction`
// E path into the registered `beast.loot` behaviour, and the real designer item defs (stack sizes, names).
import { World, createRng, createHasher, findInteractTarget, updateInteraction } from '../../../../engine/index.js';
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
import itemsMod from '../../../../design/items.js'; // classic script: side effect on globalThis.ASSETS (ASSETS.items)
import { buildBeastNav } from './beastNav.js';
import { createBeastSim, STATE_CORPSE, STATE_SINK, STATE_GONE } from './beastSim.js';
import { ensureInventory, addItem, countOf } from './inventory.js';
import { resetPickups } from './pickups.js';
import { createLoot, setLootApi } from './loot.js';
import { LOOT_TABLE, LOOT_PROMPT, LOOT_SEED_SALT } from './lootConfig.js';
import '../index.js'; // registers `beast.loot`

const { assets } = await loadTestAssets();
itemsMod;

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const defs = globalThis.ASSETS.items.defs;
const TABLE = LOOT_TABLE.boar;
const TOWER_ORIGIN = { x: 1480, y: 1018, z: 0 };
const NAV_CFG = { area: { x0: 1400, y0: 928, w: 192, h: 192 }, cell: 1, maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] };
const BX = 1500, BY = 1050; // boar spawn (beastSim.test.js uses the same open ground)
const FAR = { x: 1560, y: 1100 }; // the player while not looting: far outside notice range

function beastEntity(id, x, y) {
  return {
    id, type: 'beast', x, y, z: 'ground',
    components: {
      voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' },
      brain: { kind: 'beast', home: [x, y] },
      targetable: { radius: 0.45, height: 0.7 },
    },
  };
}

function makeEvents() {
  const log = [];
  const listeners = new Map();
  return {
    log,
    on(name, fn) {
      let s = listeners.get(name);
      if (!s) { s = new Set(); listeners.set(name, s); }
      s.add(fn);
      return () => s.delete(fn);
    },
    emit(name, p) {
      if (name === 'inventory:added') log.push(`+${p.n} ${p.id}`);
      if (name === 'inventory:full') log.push('full');
      const s = listeners.get(name);
      if (s) for (const fn of Array.from(s)) fn(p);
    },
  };
}

/** World + beast sim + loot, the player standing far away with an empty pack. */
function fresh({ seed = 1, state = {}, boars = [['boar1', BX, BY]] } = {}) {
  const orig = console.warn; console.warn = () => {};
  const world = World.load({
    name: 'lootTest', terrain: 'overworld_far',
    structures: [{ id: 'tower', level: 'tower', origin: TOWER_ORIGIN, yawSteps: 0 }],
    entities: [
      { id: 'player', type: 'player', x: FAR.x, y: FAR.y, z: 'ground', components: {} },
      ...boars.map(([id, x, y]) => beastEntity(id, x, y)),
    ],
    state: { ...state },
  }, assets, { physics: 'grid' });
  console.warn = orig;
  resetPickups(world);
  const player = world.get('player').data;
  ensureInventory(player, { pack: [], left: null, right: null });
  const events = makeEvents();
  const beasts = createBeastSim(world, { nav: buildBeastNav(world, NAV_CFG), rng: createRng(seed), events });
  const loot = createLoot(world, events, {
    items: defs, beasts, table: TABLE, rng: createRng((seed ^ LOOT_SEED_SALT) >>> 0),
    inventoryOf: () => player.components.inventory,
  });
  setLootApi(loot);
  const step = (n = 1) => { const t = player.transform; for (let i = 0; i < n; i++) beasts.step(t.x, t.y, t.z); };
  return { world, player, events, beasts, loot, step };
}

/** One lethal hit (hp 4) + one step, so the deferred `beast:died` (and the roll) has fired. */
function kill(env, id = 'boar1') {
  env.events.emit('combat:hit', { source: 'player', target: id, damage: 99, heavy: false, dirX: 1, dirY: 0, cause: 'sword', knock: 0 });
  env.step(1);
}

function pickupCount(world) {
  let n = 0;
  world.forEachEntity((e) => { if (e.components && e.components.pickup) n++; });
  return n;
}

/** Eye 1.2 m east of the body, looking at the interactable point. */
function eyeAtBody(env, id = 'boar1') {
  const rec = env.world.interactables.find((r) => r.key === 'loot.' + id);
  const t = env.world.get(id).data.transform;
  const eye = { x: t.x + 1.2, y: t.y, z: t.z + 1.0, yawDeg: 270, pitchDeg: 0 };
  eye.pitchDeg = Math.atan2(rec.z - eye.z, 1.2) * 180 / Math.PI;
  return eye;
}

const OUT = () => ({ targetKey: null, prompt: '', dist: 0, angleDeg: 0 });

// ---------------------------------------------------------------------------------------------------------------
// 1. Config agrees with the designer's table (items.js loot.boar), and the prompt text.
// ---------------------------------------------------------------------------------------------------------------
{
  const d = globalThis.ASSETS.items.loot.boar;
  ok('lootConfig entries match design/items.js loot.boar (item, chance, n)',
    TABLE.entries.every((e, k) => e.item === d.entries[k].item && e.chance === d.entries[k].chance && e.n === d.entries[k].n));
  ok('orb chance + kinds match the designer groundDrop', TABLE.orb.chance === d.groundDrop.chance && TABLE.orb.kinds.join() === d.groundDrop.kinds.join());
  ok('prompt is "[E] Loot boar"', LOOT_PROMPT.boar === '[E] Loot boar');
}

// ---------------------------------------------------------------------------------------------------------------
// 2. One interactable per boar, gated: no prompt on a living boar, `[E] Loot boar` on the dead body.
// ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  const recs = env.world.interactables.filter((r) => r.name === 'beast.loot');
  ok('one beast.loot interactable per boar', recs.length === 1 && recs[0].key === 'loot.boar1' && recs[0].radius === 1.8);
  const out = OUT();
  findInteractTarget(env.world, eyeAtBody(env), {}, out);
  ok('no prompt on a living boar', out.targetKey === null, out.targetKey);
  kill(env);
  ok('loot.boar1 flag set on beast:died', env.world.state['loot.boar1'] === true);
  const rec = env.world.interactables.find((r) => r.key === 'loot.boar1');
  const t = env.world.get('boar1').data.transform;
  ok('interactable moved onto the body (z + 0.35)', rec.x === t.x && rec.y === t.y && Math.abs(rec.z - (env.beasts.deathZ[0] + 0.35)) < 1e-9);
  findInteractTarget(env.world, eyeAtBody(env), {}, out);
  ok('dead body shows "[E] Loot boar"', out.targetKey === 'loot.boar1' && out.prompt === '[E] Loot boar', `${out.targetKey} ${out.prompt}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Seeded table: the exact sequence for seed 1, and ~100/60/25/50 % over 1000 deaths.
// ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh({ seed: 1 });
  const N = 1000;
  const hits = [0, 0, 0, 0];
  const seq = [];
  for (let d = 0; d < N; d++) {
    const before = pickupCount(env.world);
    kill(env);
    const orb = pickupCount(env.world) > before ? 1 : 0;
    const row = [env.loot.countOf('boar1', 0), env.loot.countOf('boar1', 1), env.loot.countOf('boar1', 2), orb];
    for (let k = 0; k < 4; k++) hits[k] += row[k];
    if (d < 8) seq.push(row.join(''));
    env.world.forEachEntity((e, id) => { if (e.components && e.components.pickup) env.world.remove(id); });
    resetPickups(env.world);
    env.beasts.resetAll();
  }
  const pct = hits.map((h) => h / N);
  ok('meat 100 %', pct[0] === 1, pct[0]);
  ok('hide ~60 %', Math.abs(pct[1] - 0.60) < 0.05, pct[1]);
  ok('tusk ~25 %', Math.abs(pct[2] - 0.25) < 0.05, pct[2]);
  ok('orb ~50 %', Math.abs(pct[3] - 0.50) < 0.05, pct[3]);
  // meat hide tusk orb, the first 8 deaths for seed 1 (regression snapshot of the 5-draw stream).
  const SEED1 = ['1101', '1111', '1100', '1100', '1101', '1000', '1100', '1000'];
  ok('exact roll sequence for seed 1', seq.join(' ') === SEED1.join(' '), seq.join(' '));

  // Always 5 draws (37.16.3): a mirror stream doing exactly 5 draws per death reproduces all 1000 rolls.
  const m = createRng((1 ^ LOOT_SEED_SALT) >>> 0);
  let mirrorOk = true;
  for (let d = 0; d < N && mirrorOk; d++) {
    const row = [m.nextFloat() < 1 ? 1 : 0, m.nextFloat() < 0.6 ? 1 : 0, m.nextFloat() < 0.25 ? 1 : 0, m.nextFloat() < 0.5 ? 1 : 0];
    m.int(2);
    if (d < 8 && row.join('') !== seq[d]) mirrorOk = false;
  }
  ok('5-draw mirror stream matches the first rolls', mirrorOk);
  ok('mirror totals match 1000 rolls', (() => {
    const r = createRng((1 ^ LOOT_SEED_SALT) >>> 0); const t = [0, 0, 0, 0];
    for (let d = 0; d < N; d++) { t[0] += r.nextFloat() < 1; t[1] += r.nextFloat() < 0.6; t[2] += r.nextFloat() < 0.25; t[3] += r.nextFloat() < 0.5; r.int(2); }
    return t.join() === hits.join();
  })(), hits.join());
}

// ---------------------------------------------------------------------------------------------------------------
// 4. E at the body (real updateInteraction): items into the pack, a toast event per kind, then sink.
// ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  kill(env);
  const want = [0, 1, 2].map((k) => env.loot.countOf('boar1', k));
  updateInteraction(env.world, {}, eyeAtBody(env), true);
  const inv = env.player.components.inventory;
  ok('E moves meat/hide/tusk into the pack',
    countOf(inv, 'boar.meat') === want[0] && countOf(inv, 'boar.hide') === want[1] && countOf(inv, 'boar.tusk') === want[2], want.join());
  const expectLog = TABLE.entries.filter((e, k) => want[k] > 0).map((e, k) => `+1 ${e.item}`);
  ok('one inventory:added per kind that moved, in order', env.events.log.join('|') === expectLog.join('|'), env.events.log.join('|'));
  ok('flag cleared after an emptied corpse', !env.world.state['loot.boar1']);
  ok('corpse counts zeroed', want.every((_, k) => env.loot.countOf('boar1', k) === 0));
  env.step(24);
  ok('emptied corpse sinks at CORPSE entry (despawnCorpse)', env.beasts.state[0] === STATE_SINK, env.beasts.state[0]);
  env.step(31);
  ok('then GONE', env.beasts.state[0] === STATE_GONE);
  const out = OUT();
  findInteractTarget(env.world, eyeAtBody(env), {}, out);
  ok('no prompt after looting', out.targetKey === null);
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Pack full: leftovers stay in the corpse, "Pack full", the corpse stays lootable; then loot the rest.
// ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  const inv = env.player.components.inventory;
  for (let i = 0; i < inv.slots.length; i++) { inv.slots[i].id = 'sword'; inv.slots[i].n = 1; }
  kill(env);
  env.events.log.length = 0;
  env.loot.lootBoar('boar1');
  ok('full pack: nothing added, "Pack full"', env.events.log.join('|') === 'full', env.events.log.join('|'));
  ok('full pack: corpse keeps its meat', env.loot.countOf('boar1', 0) === 1);
  ok('full pack: flag stays (still lootable)', env.world.state['loot.boar1'] === true);
  env.step(30);
  ok('full pack: corpse does not sink', env.beasts.state[0] === STATE_CORPSE);
  // free exactly one slot: meat fits, the rest (if any) still does not
  inv.slots[0].id = null; inv.slots[0].n = 0;
  const extra = env.loot.countOf('boar1', 1) + env.loot.countOf('boar1', 2);
  env.events.log.length = 0;
  const emptied = env.loot.lootBoar('boar1');
  ok('one free slot: meat goes in', countOf(inv, 'boar.meat') === 1);
  ok('one free slot: leftovers -> full + still lootable, or emptied', extra > 0
    ? (!emptied && env.events.log.at(-1) === 'full' && env.world.state['loot.boar1'] === true)
    : (emptied && !env.world.state['loot.boar1']), `${extra} ${env.events.log.join('|')}`);
  // stacking: a second boar's meat stacks onto the first (no new slot)
  const env2 = fresh({ boars: [['b1', BX, BY], ['b2', BX + 6, BY]] });
  const inv2 = env2.player.components.inventory;
  kill(env2, 'b1'); kill(env2, 'b2');
  env2.loot.lootBoar('b1'); env2.loot.lootBoar('b2');
  ok('meat stacks (2 in one slot)', countOf(inv2, 'boar.meat') === 2 && inv2.slots.filter((s) => s.id === 'boar.meat').length === 1);
  void addItem;
}

// ---------------------------------------------------------------------------------------------------------------
// 6. 60 s timeout -> sink clears the flag + counts; resetAll clears; stale `loot.*` flags dropped at create.
// ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  kill(env);
  env.step(23 + 3600);
  ok('timeout: corpse sinks', env.beasts.state[0] === STATE_SINK, env.beasts.state[0]);
  ok('timeout: flag cleared', !env.world.state['loot.boar1']);
  ok('timeout: counts cleared', env.loot.countOf('boar1', 0) === 0);

  const env2 = fresh();
  kill(env2);
  env2.beasts.resetAll();
  ok('beasts:reset clears flag + counts', !env2.world.state['loot.boar1'] && env2.loot.countOf('boar1', 0) === 0);

  const env3 = fresh({ state: { 'loot.boar1': true, 'loot.ghost': true, 'tower.sword.taken': true } });
  ok('stale loot.* flags deleted at create, other state kept',
    !('loot.boar1' in env3.world.state) && !('loot.ghost' in env3.world.state) && env3.world.state['tower.sword.taken'] === true);

  env3.loot.dispose();
  ok('dispose removes the interactables', !env3.world.interactables.some((r) => r.name === 'beast.loot'));
}

// ---------------------------------------------------------------------------------------------------------------
// 7. 600-step replay with a kill at 100 + loot at 200: identical hash (beasts + loot + pack) on two runs.
// ---------------------------------------------------------------------------------------------------------------
{
  function run() {
    const env = fresh({ seed: 7 });
    const h = createHasher();
    for (let s = 0; s < 600; s++) {
      if (s === 100) env.events.emit('combat:hit', { source: 'player', target: 'boar1', damage: 99, heavy: false, dirX: 1, dirY: 0, cause: 'sword', knock: 0 });
      if (s === 200) env.loot.lootBoar('boar1');
      env.step(1);
    }
    h.reset();
    env.beasts.hashInto(h);
    env.loot.hashInto(h);
    const inv = env.player.components.inventory;
    for (const sl of inv.slots) h.u32(sl.n);
    return h.value();
  }
  const a = run(), b = run();
  ok('600-step replay hash stable', a === b, `${a} vs ${b}`);
}

// ---------------------------------------------------------------------------------------------------------------
// 8. Zero allocation per step with loot attached (corpse lying, flag set).
// ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  kill(env);
  env.step(24);
  if (global.gc) {
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 3000; i++) env.step(1);
    global.gc();
    const after = process.memoryUsage().heapUsed;
    ok('zero allocation per step with loot attached (--expose-gc heap check)', after <= before + 2e5, `before=${before} after=${after}`);
  } else {
    console.log('(skip) zero-allocation heap check needs --expose-gc');
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
