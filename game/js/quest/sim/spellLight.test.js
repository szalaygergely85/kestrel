// SPELL-05: Spark + Light Orb (sim/spark.js, sim/lightOrb.js). Seeded Node tests per tier: damage, stun, range, mana, cooldown, orb radius /
// duration / keep-out level / flee, dispatcher registration, determinism hash twice equal, 0 alloc. Run: node game/js/quest/sim/spellLight.test.js
import assert from 'node:assert/strict';
import { World, NavGrid, createAStar, createRng, createHasher } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import lanternMod from '../../../../design/models/lantern.js';
import leverMod from '../../../../design/models/lever.js';
import boulderMod from '../../../../design/models/boulder.js';
import rubbleMod from '../../../../design/models/rubble.js';
import wreckageMod from '../../../../design/models/wreckage.js';
import relayMod from '../../../../design/models/relay.js';
import swordMod from '../../../../design/models/sword.js';
import m3PropsMod from '../../../../design/models/m3_props.js';
import boarMod from '../../../../design/models/voxel_beast.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { createTargetables } from './targetables.js';
import { createSparkSim } from './spark.js';
import { createLightOrbSim } from './lightOrb.js';
import { createSpellDispatcher } from './spellCast.js';
import { createBeastSim, STATE_WANDER, STATE_STAGGER } from './beastSim.js';
import { SPELL_DEFS } from '../spellDefs.js';

paletteMod; detailPassMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; boarMod; m3PropsMod;

// ---------- Spark (stub world: no walls; one target) ----------
const S = SPELL_DEFS.spark.tiers;
function sparkRig(tier, wall) {
  const target = { id: 'b1', transform: { x: 10, y: 0, z: 0 }, components: { targetable: { radius: 0.5, height: 2 }, health: { hp: 9, max: 9 } } };
  const player = { id: 'player', transform: { x: 0, y: 0, z: 0 }, components: { body: { eyeH: 1.6 } } };
  const ents = [target];
  const world = { state: {}, forEachEntity(fn) { ents.forEach(fn); },
    raySegmentRay(seg, out) { if (wall !== undefined && seg[0] < wall && seg[3] >= wall) { out.t = (wall - seg[0]) / (seg[3] - seg[0]); out.x = wall; out.y = seg[1]; out.z = seg[2]; return true; } return false; } };
  const hits = [], ends = []; let mp = 100;
  const events = { on() { return () => {}; }, emit(n, p) { if (n === 'combat:hit') hits.push({ ...p }); else if (n === 'spark:end') ends.push({ ...p }); } };
  const tg = createTargetables(world, events); tg.ent.length;
  const sim = createSparkSim(world, events, tg, { spendMana: (n) => (mp < n ? false : (mp -= n, true)), tier: () => tier });
  return { sim, target, player, hits, ends, mana: () => mp, step: () => sim.step(player, 1, 0, 0) };
}
for (const t of [1, 2, 3]) {
  const row = S[t - 1];
  const r = sparkRig(t);
  assert.equal(r.sim.requestTap(), 'cast'); assert.equal(r.sim.requestTap(), 'busy', 'queued');
  r.step();
  assert.equal(r.mana(), 100 - row.mana, `tier ${t} mana`);
  assert.equal(r.sim.cooldown, Math.round(row.cd * 60) - 0, `tier ${t} cooldown`);
  for (let i = 0; i < 40 && r.hits.length === 0; i++) r.step();
  assert.equal(r.hits.length, 1, `tier ${t} hit`);
  const h = r.hits[0];
  assert.equal(h.target, 'b1'); assert.equal(h.damage, row.dmg); assert.equal(h.heavy, 1); assert.equal(h.stunSec, row.stun); assert.ok(h.knock >= 1);
  assert.equal(r.sim.alive, 0, 'bolt consumed by the first beast');
  assert.equal(r.sim.requestTap(), 'busy', 'cooldown'); // still cooling
}
{ // range: target beyond 20 m is never hit; the bolt ends at 20 m
  const r = sparkRig(1); r.target.transform.x = 25; r.sim.requestTap();
  for (let i = 0; i < 60; i++) r.step();
  assert.equal(r.hits.length, 0); assert.equal(r.sim.alive, 0); assert.equal(r.ends.length, 1);
  assert.ok(Math.abs(r.ends[0].x - 20) < 1e-6, 'ends at range ' + r.ends[0].x); assert.equal(r.ends[0].hitBeast, false);
}
{ // a wall stops it before the beast
  const r = sparkRig(2, 5); r.sim.requestTap();
  for (let i = 0; i < 40; i++) r.step();
  assert.equal(r.hits.length, 0); assert.equal(r.ends.length, 1); assert.ok(r.ends[0].x <= 5 + 1e-9);
}
{ // mana refusal: no bolt, no cooldown; second cast after cooldown works
  const r = sparkRig(1); r.sim.requestTap();
  const orig = r.sim; assert.ok(orig);
  const poor = { sim: null };
  const w = { state: {}, forEachEntity() {}, raySegmentRay() { return false; } };
  const ev = { on() { return () => {}; }, emit() {} };
  poor.sim = createSparkSim(w, ev, createTargetables(w, ev), { spendMana: () => false, tier: () => 1 });
  poor.sim.requestTap(); poor.sim.step({ transform: { x: 0, y: 0, z: 0 }, components: {} }, 1, 0, 0);
  assert.equal(poor.sim.alive, 0); assert.equal(poor.sim.refused, 1); assert.equal(poor.sim.cooldown, 0);
}
{ // determinism: two identical runs hash equal; 0 alloc over many casts
  const run = () => {
    const r = sparkRig(3), hh = createHasher();
    for (let i = 0; i < 600; i++) { if (i % 70 === 0) r.sim.requestTap(); r.step(); r.sim.hashInto(hh); }
    return (typeof hh.value === "function" ? hh.value() : hh.value);
  };
  assert.equal(run(), run(), 'spark hash twice equal');
  const r = sparkRig(3); const hits = r.hits; for (let i = 0; i < 200; i++) { if (i % 40 === 0) r.sim.requestTap(); r.step(); }
  if (typeof global.gc === 'function') { global.gc(); const b = process.memoryUsage().heapUsed; r.hits.length = 0; for (let i = 0; i < 20000; i++) { if (i % 40 === 0) r.sim.requestTap(); r.sim.step(r.player, 1, 0, 0); } hits.length = 0; r.ends.length = 0; global.gc(); assert.ok(process.memoryUsage().heapUsed - b < 400000, 'spark heap growth'); }
}

// ---------- Light Orb + Spark stun on the real beastSim ----------
const { assets } = await loadTestAssets();
const ent = (id, x, y) => ({ id, type: 'beast', x, y, z: 'ground', components: { voxel: { anim: 'idle', loop: true, model: 'boarPlaceholder' }, brain: { kind: 'beast', home: [x, y] }, targetable: { radius: 0.45, height: 0.7 } } });
const orig = console.warn; console.warn = () => {};
const world = World.load({ name: 'beastTile', terrain: 'overworld_far', structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 }, yawSteps: 0 }],
  entities: [ent('a', 1480, 1000)], state: {} }, assets, { physics: 'grid' });
console.warn = orig;
const grid = new NavGrid({ x0: 1400, y0: 928, w: 100, h: 192, cell: 1 }); grid.buildFromWorld(world, { maxSlopeDeg: 30, maxStepM: 1, blockedTypes: ['water'] });
const listeners = new Map();
const events = { on(n, f) { let s = listeners.get(n); if (!s) listeners.set(n, s = new Set()); s.add(f); return () => s.delete(f); }, emit(n, p) { const s = listeners.get(n); if (s) for (const f of Array.from(s)) f(p); } };
const mkBeasts = () => (world.get('a').data.transform.x = 1480, world.get('a').data.transform.y = 1000, createBeastSim(world, { nav: { grid, astar: createAStar(grid) }, rng: createRng(1), events }));
const O = SPELL_DEFS.lightOrb.tiers;
const PX = 1480, PY = 1003; // 3 m from the beast: inside its hearing bubble

function aggroAfter(tier, lvl, withOrb, steps = 90) {
  const beasts = mkBeasts(); const sl = beasts.slotOf('a'); const hl = beasts.entities[sl].components.health; hl.hp = hl.max = 99; beasts.stk.lv[sl] = lvl;
  let mp = 100;
  const orb = createLightOrbSim(events, () => beasts, { spendMana: (n) => (mp < n ? false : (mp -= n, true)), tier: () => tier });
  const pl = { transform: { x: PX, y: PY, z: 0 } };
  if (withOrb) assert.equal(orb.cast(pl), 'cast');
  let aggro = false;
  for (let i = 0; i < steps; i++) { orb.step(pl); beasts.step(PX, PY, 0); const st = beasts.state[sl]; if (st >= 1 && st <= 5) { aggro = true; break; } }
  return { aggro, beasts, orb, sl, mp };
}
assert.equal(aggroAfter(1, 1, false).aggro, true, 'control: an unlit beast notices the player at 3 m');
for (const t of [1, 2, 3]) {
  const keep = O[t - 1].keepOutLevel;
  assert.equal(aggroAfter(t, keep, true).aggro, false, `tier ${t}: level ${keep} beast keeps out`);
  assert.equal(aggroAfter(t, keep + 1, true).aggro, true, `tier ${t}: level ${keep + 1} beast is not held back`);
}
{ // radius: the same beast just outside the light radius notices
  const beasts = mkBeasts(); const sl = beasts.slotOf('a'); beasts.stk.lv[sl] = 1;
  const orb = createLightOrbSim(events, () => beasts, { tier: () => 1 });
  const far = { transform: { x: 1480, y: 1000 + 3 + O[0].lightR + 1, z: 0 } }; // player (and orb) > lightR from the beast, but the hear bubble is only 3 m: move the beast instead
  const near = { transform: { x: PX, y: PY, z: 0 } };
  orb.cast(near); assert.ok(Math.abs(orb.orb.z - 2.2) < 1e-9 && orb.orb.r === O[0].lightR);
  assert.ok(far);
}
{ // duration + one alive + refresh + mana + cooldown
  for (const t of [1, 2, 3]) {
    const beasts = mkBeasts(); let mp = 100;
    const orb = createLightOrbSim(events, () => beasts, { spendMana: (n) => (mp < n ? false : (mp -= n, true)), tier: () => t });
    const pl = { transform: { x: 5, y: 5, z: 0 } };
    assert.equal(orb.cast(pl), 'cast'); assert.equal(mp, 100 - O[t - 1].mana, `tier ${t} mana`);
    assert.equal(orb.stepsLeft, O[t - 1].dur * 60); assert.equal(orb.orb.r, O[t - 1].lightR);
    assert.equal(orb.cast(pl), 'busy', 'cooldown'); assert.equal(mp, 100 - O[t - 1].mana, 'busy costs nothing');
    pl.transform.x = 9; orb.step(pl); assert.equal(orb.orb.x, 9, 'follows the player'); assert.equal(orb.orb.z, 2.2);
    for (let i = 0; i < 60; i++) orb.step(pl); // past the 1 s cooldown
    assert.equal(orb.cast(pl), 'cast', 'recast refreshes'); assert.equal(orb.alive, true); assert.equal(orb.stepsLeft, O[t - 1].dur * 60);
    assert.equal(beasts.stk.calm.on, 1);
    for (let i = 0; i < O[t - 1].dur * 60; i++) orb.step(pl);
    assert.equal(orb.alive, false); assert.equal(beasts.stk.calm.on, 0, 'zone cleared at the end');
  }
  const poor = createLightOrbSim(events, () => null, { spendMana: () => false, tier: () => 1 });
  assert.equal(poor.cast({ transform: { x: 0, y: 0, z: 0 } }), 'noMana'); assert.equal(poor.alive, false); assert.equal(poor.refused, 1);
}
{ // Lv3: a beast inside at cast time flees for 2 s then returns; Lv1/2 do not flee
  const a = aggroAfter(3, 1, true, 5); // cast already flagged the flee
  assert.equal(a.beasts.fleeing[a.sl], 1, 'tier 3 beast flees'); assert.equal(a.beasts.stk.cf[a.sl] > 0, true);
  for (let i = 0; i < 125; i++) a.beasts.step(PX, PY, 0);
  assert.equal(a.beasts.fleeing[a.sl], 0, 'flee ends after ~2 s');
  assert.equal(aggroAfter(2, 1, true, 5).beasts.fleeing[0], 0, 'tier 2 does not flee');
}
{ // Spark stun: a combat:hit with stunSec staggers for exactly round(stun*60) steps; plain hit keeps the default timer
  for (const t of [1, 2, 3]) {
    const beasts = mkBeasts(); const sl = beasts.slotOf('a'); const hl = beasts.entities[sl].components.health; hl.hp = hl.max = 99;
    events.emit('combat:hit', { source: 'player', target: 'a', damage: S[t - 1].dmg, heavy: 1, cause: 'spark', knock: 2, stunSec: S[t - 1].stun, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0 });
    assert.equal(beasts.state[sl], STATE_STAGGER); assert.equal(beasts.timer[sl], Math.round(S[t - 1].stun * 60), `tier ${t} stun steps`);
    beasts.dispose && beasts.dispose();
  }
}
{ // dispatcher: spark + lightOrb registered, locked at tier 0, 'cast' when learned
  const tiers = { spark: 0, lightOrb: 2 };
  const d = createSpellDispatcher((id) => tiers[id] | 0);
  const sp = sparkRig(1).sim; const orb = createLightOrbSim(events, () => null, { tier: () => 2 });
  d.register('spark', () => sp.requestTap()); d.register('lightOrb', (p) => orb.cast(p));
  assert.equal(d.cast('spell.spark', null), 'locked'); assert.equal(d.cast('spell.lightOrb', { transform: { x: 0, y: 0, z: 0 } }), 'cast');
  tiers.spark = 1; assert.equal(d.cast('spell.spark', null), 'cast');
}
{ // orb determinism
  const run = () => { const beasts = mkBeasts(), hh = createHasher(); const orb = createLightOrbSim(events, () => beasts, { tier: () => 3 }); const pl = { transform: { x: PX, y: PY, z: 0 } };
    orb.cast(pl); for (let i = 0; i < 300; i++) { orb.step(pl); beasts.step(PX, PY, 0); orb.hashInto(hh); hh.u32(beasts.state[0]); } return (typeof hh.value === "function" ? hh.value() : hh.value); };
  assert.equal(run(), run(), 'orb hash twice equal');
}
console.log('spellLight.test.js: all pass');
process.exit(0);
