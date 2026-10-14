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
import { ensureInventory, addItem, removeItem, countOf } from './inventory.js';
import { readFileSync } from 'node:fs';
import { resetPickups, spawnItemDrop, stepPickups } from './pickups.js';
import { BAND_TABLE } from './band.js';
import { registerGenDefs } from './itemInst.js';
import { createLoot, setLootApi, rollGear, gearIdFor } from './loot.js';
import { LOOT_TABLE, LOOT_PROMPT, LOOT_SEED_SALT, LOOT_TIERS, LOOT_SLOTS } from './lootConfig.js';
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
function fresh({ seed = 1, state = {}, boars = [['boar1', BX, BY]], band = null } = {}) {
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
    inventoryOf: () => player.components.inventory, band,
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
// 1. Config agrees with content/items/loot.json (EQ-11), and the prompt text.
// ---------------------------------------------------------------------------------------------------------------
{
  const j = JSON.parse(readFileSync(new URL('../../../../content/items/loot.json', import.meta.url), 'utf8'));
  ok('lootConfig boar rolls + fixed == loot.json sources.boar', JSON.stringify(TABLE.rolls) === JSON.stringify(j.sources.boar.rolls) && JSON.stringify(TABLE.fixed) === JSON.stringify(j.sources.boar.fixed.map((f) => ({ item: f.item, n: f.n }))));
  ok('lootConfig tiers + slots == loot.json', JSON.stringify(LOOT_TIERS) === JSON.stringify(j.tiers) && LOOT_SLOTS.join() === j.slots.join());
  ok('materials are not dropped (no hide / tusk / scrap in the boar table)', !JSON.stringify(TABLE).match(/hide|tusk|scrap/));
  ok('prompt is "[E] Loot boar"', LOOT_PROMPT.boar === '[E] Loot boar');
  ok('gearIdFor: every (tier, slot) maps to a gear def of that tier + slot', ['worn', 'sturdy', 'fine'].every((t) => LOOT_SLOTS.every((sl) => { const d = defs[gearIdFor(defs, sl, t)]; return d && d.equip.slot === sl && d.equip.tier === t; })));
  ok('rollGear: tier cuts 0.69 worn / 0.71 sturdy / 0.96 fine', ['0.69', '0.71', '0.96'].map((b) => defs[rollGear(defs, +b, 0)].equip.tier).join() === 'worn,sturdy,fine');
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
// 3. Seeded table (EQ-10): 0..4 entries; meat 100 %, arrows ~20 % x3-5, gear ~4 % as a world pickup (10k kills).
// ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh({ seed: 1 });
  const N = 10000;
  let gear = 0, arrows = 0, meat = 0, maxEntries = 0, arrowMin = 99, arrowMax = 0;
  const seq = [], tiers = { worn: 0, sturdy: 0, fine: 0 };
  const gearIds = () => { const g = env.loot.gearOf('boar1'); return g ? [g] : []; }; // OB-064: gear is held by the corpse until E
  for (let d = 0; d < N; d++) {
    kill(env);
    const g = gearIds();
    gear += g.length;
    const m = env.loot.countOf('boar1', 0), a = env.loot.countOf('boar1', 1);
    meat += m; if (a > 0) { arrows++; arrowMin = Math.min(arrowMin, a); arrowMax = Math.max(arrowMax, a); }
    let entries = 0; for (let k = 0; k < 4; k++) if (env.loot.countOf('boar1', k) > 0) entries++;
    maxEntries = Math.max(maxEntries, entries + g.length);
    if (d < 6) seq.push(m + ':' + a + ':' + (g[0] || '-'));
    env.world.forEachEntity((e, id) => { if (e.components && e.components.pickup) env.world.remove(id); });
    resetPickups(env.world);
    env.beasts.resetAll();
  }
  ok('meat 100 %', meat === N, meat);
  ok('arrows ~20 % (+-1.5)', Math.abs(arrows / N - 0.2) < 0.015, arrows / N);
  ok('arrows n in 3..5', arrowMin >= 3 && arrowMax <= 5, arrowMin + '..' + arrowMax);
  ok('gear ~5 % (ITEM-06, +-0.7)', Math.abs(gear / N - 0.05) < 0.007, gear / N);
  ok('at most 4 entries per kill', maxEntries <= 4, maxEntries);
  // Determinism: a mirror stream (3 draws per roll row, then 2 orb draws) reproduces the first rolls exactly.
  const m = createRng((1 ^ LOOT_SEED_SALT) >>> 0);
  const mirror = [];
  for (let d = 0; d < 6; d++) {
    const g1 = (m.nextFloat(), false), gb = m.nextFloat(), gc = m.nextFloat();
    const a1 = m.nextFloat() < 0.2, ab = m.nextFloat(); m.nextFloat();
    m.nextFloat(); m.int(2);
    mirror.push('1:' + (a1 ? 3 + Math.min(2, Math.floor(ab * 3)) : 0) + ':' + '-');
  }
  const strip = (x) => x.split(' ').map((q) => q.split(':').slice(0, 2).join(':')).join(' ');
  ok('first 6 rolls for seed 1 match the mirror stream (corpse columns)', strip(mirror.join(' ')) === strip(seq.join(' ')), seq.join(' ') + ' / ' + mirror.join(' '));
}

// EQ-21 AC1/AC3: 35 gear ids, def strictly monotonic per base, old 21 unchanged; warden piece equips + save round trip.
{
  const bases = ['head.hood', 'body.jerkin', 'cloak.cloak', 'hands.gloves', 'belt.belt', 'legs.pants', 'feet.boots'];
  const tiers = ['worn', 'sturdy', 'fine', 'tempered', 'warden'];
  let all = true, mono = true, golden = true;
  for (const b of bases) {
    const mul = b.startsWith('body') ? 2 : 1;
    tiers.forEach((t, i) => {
      const d = defs['gear.' + b + '.' + t];
      if (!d || d.equip.tier !== t || d.equip.def !== (i + 1) * mul) all = false;
      if (i < 3 && d && (d.equip.def !== (i + 1) * mul || !/^(Worn|Sturdy|Fine) /.test(d.name))) golden = false;
      if (i > 0 && d && defs['gear.' + b + '.' + tiers[i - 1]].equip.def >= d.equip.def) mono = false;
    });
  }
  ok('35 gear ids valid (tier + def pattern)', all);
  ok('def strictly monotonic worn < sturdy < fine < tempered < warden', mono);
  ok('old 21 ids keep def + names', golden);
  ok('validate(palette) has no errors', globalThis.ASSETS.items.validate(globalThis.ASSETS.palette || null).length === 0);
  registerGenDefs(defs); // ITEM-06: gen.<type> defs (after the legacy validate)
  const { World: W, AssetRegistry: AR } = await import('../../../../engine/index.js');
  const { ensureEquipment, equip } = await import('./equipment.js');
  const { collectSave, applySave, stringifyGameSave, parseGameSave } = await import('../save/saveState.js');
  const reg = new AR({ palette: {} });
  const w = W.load({ name: 'eq21', terrain: null, structures: [], entities: [] }, reg, {});
  const h = w.spawn('unit', { x: 1, y: 2, z: 0, yawDeg: 0, pitchDeg: 0 }, { health: { hp: 5, max: 10, invuln: 0 } }, 'player');
  ensureInventory(h.data, { pack: [{ id: 'gear.body.jerkin.warden', n: 1 }] });
  const eq = ensureEquipment(h.data);
  ok('warden jerkin equips', equip(h.data.components.inventory, eq, defs, 'gear.body.jerkin.warden') && eq.body === 'gear.body.jerkin.warden');
  const text = stringifyGameSave(collectSave(w, {}));
  const back = applySave(parseGameSave(text), reg, {});
  ok('warden piece save round trip', back.world.get('player').data.components.equipment.body === 'gear.body.jerkin.warden' && stringifyGameSave(collectSave(back.world, {})) === text);
}

// ---------------------------------------------------------------------------------------------------------------
// 4. E at the body (real updateInteraction): items into the pack, a toast event per kind, then sink.
// ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  kill(env);
  const want = [0, 1, 2, 3].map((k) => env.loot.countOf('boar1', k));
  const wantIds = [0, 1, 2, 3].map((k) => env.loot.itemOf('boar1', k));
  const heldGear = env.loot.gearOf('boar1');
  const heldOrb = env.loot.orbOf('boar1'); // OB-113: the potion item is logged last
  updateInteraction(env.world, {}, eyeAtBody(env), true);
  const inv = env.player.components.inventory;
  ok('E moves meat (+ arrows) into the pack',
    countOf(inv, 'boar.meat') === want[0] && countOf(inv, 'arrow') === want[1], want.join());
  const expectLog = want.map((n, k) => (n > 0 ? `+${n} ${wantIds[k]}` : null)).filter(Boolean);
  if (heldGear) expectLog.push('+1 ' + heldGear); // OB-064: gear same E, before the potion
  if (heldOrb) expectLog.push('+1 ' + (heldOrb === 'mp' ? 'potion.mp' : 'potion.hp'));
  ok('one inventory:added per kind that moved, in order', env.events.log.join('|') === expectLog.join('|'), env.events.log.join('|'));
  ok('flag cleared after an emptied corpse', !env.world.state['loot.boar1']);
  ok('corpse counts zeroed', want.every((_, k) => env.loot.countOf('boar1', k) === 0));
  ok('corpse has no gear / material columns', wantIds.every((id) => id === null || id === 'boar.meat' || id === 'arrow'));
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
  const extra = env.loot.countOf('boar1', 1) + env.loot.countOf('boar1', 2) + env.loot.countOf('boar1', 3);
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

// ---------------------------------------------------------------------------------------------------------------
// 9. Gear drop = world pickup -> pack + 'gear:got' (the item-get card); pack full leaves it lying.
// ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  const got = [];
  env.events.on('gear:got', (p) => got.push(p.id + ':' + p.n));
  const t = env.player.transform;
  const gid = 'gear.body.jerkin.sturdy';
  const id = spawnItemDrop(env.world, gid, t.x + 5, t.y, t.z);
  stepPickups(env.world, env.player);
  ok('far gear pickup is not collected', env.world.entity(id) && countOf(env.player.components.inventory, gid) === 0);
  const id2 = spawnItemDrop(env.world, gid, t.x, t.y, t.z);
  stepPickups(env.world, env.player);
  ok('near gear pickup -> pack, entity removed, gear:got once', countOf(env.player.components.inventory, gid) === 1 && !env.world.entity(id2) && got.join() === gid + ':1', got.join());
  ok('inventory:added logged for the gear', env.events.log.includes('+1 ' + gid), env.events.log.join('|'));
  const inv = env.player.components.inventory;
  for (let i = 0; i < inv.slots.length; i++) { inv.slots[i].id = 'sword'; inv.slots[i].n = 1; }
  const id3 = spawnItemDrop(env.world, gid, t.x, t.y, t.z);
  stepPickups(env.world, env.player);
  ok('pack full: the gear drop stays on the ground', !!env.world.entity(id3) && got.length === 1);
  env.loot.dispose();
  stepPickups(env.world, env.player);
  ok('dispose uninstalls the item sink', !!env.world.entity(id3));
}

// ---------------------------------------------------------------------------------------------------------------
// 10. OB-064: kill != loot. Player standing ON the corpse: the pack stays unchanged until E; gear shows only at E.
// ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh({ seed: 7 });
  const inv = env.player.components.inventory;
  const total = () => inv.slots.reduce((a, s) => a + (s.id ? s.n : 0), 0);
  let gearKills = 0, leaked = 0, gearInPackAfterLoot = 0;
  for (let d = 0; d < 400; d++) {
    const t0 = env.player.transform; t0.x = BX; t0.y = BY; t0.z = env.world.get('boar1').data.transform.z;
    const before = total();
    kill(env);
    for (let k = 0; k < 3; k++) stepPickups(env.world, env.player);
    if (total() !== before) leaked++;
    const g = env.loot.gearOf('boar1');
    env.loot.lootBoar('boar1');
    stepPickups(env.world, env.player);
    if (g) { gearKills++; if (countOf(inv, g) === 1) gearInPackAfterLoot++; }
    inv.slots.forEach((s) => { s.id = null; s.n = 0; });
    env.world.forEachEntity((e, id) => { if (e.components && e.components.pickup) env.world.remove(id); });
    resetPickups(env.world);
    env.beasts.resetAll();
  }
  ok('OB-064: pack unchanged by a kill with the player on the corpse (400 kills)', leaked === 0, leaked);
  ok('OB-064: some gear rolled; gear reaches the pack only after E', gearKills > 3 && gearInPackAfterLoot === gearKills, gearKills + '/' + gearInPackAfterLoot);
}

// OB-074/OB-113: the hp/mp potion (orb) stays in the corpse until E, then goes INTO THE PACK (no instant heal).
{
  const env = fresh({ seed: 7 });
  let orbs = 0, onGround = 0, given = 0, healed = 0;
  const hp = env.player.components.health, inv = env.player.components.inventory;
  for (let d = 0; d < 300; d++) {
    if (hp) hp.hp = 1;
    kill(env);
    let ground = 0; env.world.forEachEntity((e) => { if (e.components && e.components.pickup && e.components.pickup.kind !== 'item') ground++; });
    onGround += ground;
    const o = env.loot.orbOf('boar1');
    const pid = o === 'mp' ? 'potion.mp' : 'potion.hp';
    const before = o ? countOf(inv, pid) : 0;
    env.loot.lootBoar('boar1');
    if (o) { orbs++; if (countOf(inv, pid) === before + 1) given++; if (hp && hp.hp !== 1) healed++; }
    // empty the pack each round so a full stack never skews the count
    for (const id of ['potion.hp', 'potion.mp', 'boar.meat', 'arrow', 'boar.hide', 'boar.tusk']) { const n = countOf(inv, id); if (n > 0) removeItem(inv, id, n); }
    env.world.forEachEntity((e, id) => { if (e.components && e.components.pickup) env.world.remove(id); });
    resetPickups(env.world);
    env.beasts.resetAll();
  }
  ok('OB-074: no hp/mp orb pickup on the ground after a kill (300 kills)', onGround === 0, onGround);
  ok('OB-113: orbs rolled and given as potion.hp/mp x1 in the pack on E', orbs > 50 && given === orbs, orbs + '/' + given);
  ok('OB-113: no instant heal on E', healed === 0, healed);
}
// OB-064 (reopened): gear goes into the pack on the SAME E (tier kept, no world pickup); pack full -> stays in the corpse.
{
  const env = fresh({ seed: 7 });
  const inv = env.player.components.inventory;
  const gid = 'gen.armour.body';
  const mk = () => ({ id: gid, n: 1, it: { iL: 3, r: 2, a: [['life', 5], ['armour', 2]] } });
  const hold = () => { const si = env.beasts.slotOf('boar1'); env.loot.gearHeld[si] = gid; env.loot.instHeld[si] = mk(); };
  const pickups = () => { let n = 0; env.world.forEachEntity((e) => { if (e.components && e.components.pickup && e.components.pickup.kind === 'item') n++; }); return n; };
  kill(env);
  hold();
  env.loot.lootBoar('boar1');
  ok('OB-064: gear in the pack on the first E, no world pickup, corpse emptied', countOf(inv, gid) === 1 && pickups() === 0 && env.loot.gearOf('boar1') === null);
  env.beasts.resetAll(); kill(env);
  for (let n = 0; n < 200; n++) addItem(inv, defs, 'gear.body.jerkin.worn', 1);
  hold();
  const done = env.loot.lootBoar('boar1');
  ok('OB-064: pack full -> gear stays in the corpse (lootable), nothing on the ground', !done && env.loot.gearOf('boar1') === gid && pickups() === 0 && countOf(inv, gid) === 1); // the 1 is from the first half
}
// OB-113: pack full of other items -> the potion stays in the corpse, nothing lost or duplicated.
{
  const env = fresh({ seed: 7 });
  const inv = env.player.components.inventory;
  kill(env);
  env.loot.orbHeld[env.beasts.slotOf('boar1')] = 'hp'; // force the hit
  for (let n = 0; n < 200; n++) addItem(inv, defs, 'gear.body.jerkin.worn', 1);
  const before = countOf(inv, 'potion.hp');
  const r = env.loot.lootBoar('boar1');
  ok('OB-113: full pack -> potion stays in corpse, loot returns false', env.loot.orbOf('boar1') === 'hp' && countOf(inv, 'potion.hp') === before && r === false);
}

// OB-120: magic locked -> every potion is hp (same draws); unlocked -> hp/mp mix unchanged.
{
  let lockedMp = 0, lockedHp = 0, unMp = 0, unHp = 0, same = true;
  for (let seed = 1; seed <= 24; seed++) {
    const a = fresh({ seed }), b = fresh({ seed, state: { 'magic.fireball': true } });
    kill(a); kill(b);
    const oa = a.loot.orbOf('boar1'), ob = b.loot.orbOf('boar1');
    if (oa === 'mp') lockedMp++; if (oa === 'hp') lockedHp++;
    if (ob === 'mp') unMp++; if (ob === 'hp') unHp++;
    if ((oa === null) !== (ob === null) || (ob === 'hp' && oa !== 'hp') || (ob === 'mp' && oa !== 'hp')) same = false;
    // stream shape: next draw after the roll is identical
    if (a.loot.corpseItem && b.loot.corpseItem && Array.from(a.loot.corpseItem).join() !== Array.from(b.loot.corpseItem).join()) same = false;
  }
  ok('OB-120: locked -> 0 potion.mp, some hp', lockedMp === 0 && lockedHp > 0, `${lockedMp}/${lockedHp}`);
  ok('OB-120: unlocked -> mix kept (both kinds appear)', unMp > 0 && unHp > 0, `${unMp}/${unHp}`);
  ok('OB-120: same corpses/orb hits locked vs unlocked, mp mapped to hp', same);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
