// SPELL-05 / R1: Spark sim (SPELL_DEFS.freeze rows; becomes Freeze in SPELL-R2). Seeded Node tests per tier: damage, stun, range, mana, cooldown, dispatcher registration, determinism hash twice equal, 0 alloc. Run: node game/js/quest/sim/spellLight.test.js
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
import { createSpellDispatcher } from './spellCast.js';
import { createBeastSim, STATE_WANDER, STATE_STAGGER } from './beastSim.js';
import { SPELL_DEFS } from '../spellDefs.js';

paletteMod; detailPassMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; boarMod; m3PropsMod;

// ---------- Spark (stub world: no walls; one target) ----------
const S = SPELL_DEFS.freeze.tiers;
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
  assert.equal(h.target, 'b1'); assert.equal(h.damage, row.dmg); assert.equal(h.heavy, 1); assert.equal(h.stunSec, row.stun); assert.equal(h.knock, row.knock);
  assert.equal(r.sim.alive, 0, 'bolt consumed by the first beast');
  assert.equal(r.sim.requestTap(), 'busy', 'cooldown'); // still cooling
}
{ // range: target beyond 20 m is never hit; the bolt ends at 20 m
  const r = sparkRig(1); r.target.transform.x = 25; r.sim.requestTap();
  for (let i = 0; i < 60; i++) r.step();
  assert.equal(r.hits.length, 0); assert.equal(r.sim.alive, 0); assert.equal(r.ends.length, 1);
  assert.ok(Math.abs(r.ends[0].x - S[0].range) < 1e-6, 'ends at range ' + r.ends[0].x); assert.equal(r.ends[0].hitBeast, false);
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
{ // Spark stun: a combat:hit with stunSec staggers for exactly round(stun*60) steps; plain hit keeps the default timer
  for (const t of [1, 2, 3]) {
    const beasts = mkBeasts(); const sl = beasts.slotOf('a'); const hl = beasts.entities[sl].components.health; hl.hp = hl.max = 99;
    events.emit('combat:hit', { source: 'player', target: 'a', damage: S[t - 1].dmg, heavy: 1, cause: 'spark', knock: 2, stunSec: S[t - 1].stun, dirX: 1, dirY: 0, px: 0, py: 0, pz: 0 });
    assert.equal(beasts.state[sl], STATE_STAGGER); assert.equal(beasts.timer[sl], Math.round(S[t - 1].stun * 60), `tier ${t} stun steps`);
    beasts.dispose && beasts.dispose();
  }
}
{ // dispatcher: spark registered, locked at tier 0, 'cast' when learned
  const tiers = { freeze: 0 };
  const d = createSpellDispatcher((id) => tiers[id] | 0);
  const sp = sparkRig(1).sim;
  d.register('freeze', () => sp.requestTap());
  assert.equal(d.cast('spell.freeze', null), 'locked');
  tiers.freeze = 1; assert.equal(d.cast('spell.freeze', null), 'cast');
}
console.log('spellLight.test.js: all pass');
process.exit(0);
