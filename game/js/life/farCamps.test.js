// WMP-02: far goblin camps. Run: node game/js/life/farCamps.test.js
// placement (region + bounds, walkable, relay/beast clearances), determinism, slot order, dormancy + restore, kill-all save/load, MAX_BEASTS.
import { World, createRng } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import geoMod from '../../../design/levels/world_geo.js';
import '../../../design/models/lantern.js'; import '../../../design/models/lever.js'; import '../../../design/models/boulder.js';
import '../../../design/models/rubble.js'; import '../../../design/models/wreckage.js'; import '../../../design/models/relay.js';
import '../../../design/models/sword.js'; import '../../../design/models/m3_props.js'; import '../../../design/models/far_tower.js';
import '../../../design/models/ferrum_lights.js'; import '../../../design/models/voxel_beast.js'; import '../../../design/models/voxel_bear.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { readFileSync } from 'node:fs';
import { buildBeastNav } from '../quest/sim/beastNav.js';
import { createBand } from '../quest/sim/band.js';
import { createBeastSim, MAX_BEASTS } from '../quest/sim/beastSim.js';
import { spawnRegionalBeasts, makeWalkable, inPolygon } from '../quest/sim/regionalBeasts.js';
import { generateFarCamps, relaySites, RELAY_GAP, BEAST_GAP, LEASH_R } from './farCamps.js';
import { createGoblinWire } from './goblinWire.js';
import { clearedKey, downKey, activeCamps } from './goblinCamps.js';

paletteMod; detailPassMod; terrainMod;
const G = globalThis.ASSETS.levels.world_geo; geoMod;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const def = assets.world('world_m1');
const json = JSON.parse(readFileSync(new URL('../../../content/life/goblinCamps.json', import.meta.url), 'utf8'));
const quiet = (f) => { const w = console.warn; console.warn = () => {}; try { return f(); } finally { console.warn = w; } };
const homesOf = (w) => { const h = []; w.forEachEntity((e) => { const b = e.components?.brain; if (b?.kind === 'beast' && b.home) h.push([b.home[0], b.home[1]]); }); return h; };
const band = createBand(G.regions);
const mkEvents = () => { const h = {}; return { on: (n, f) => { (h[n] ||= []).push(f); return () => {}; }, emit: (n, p) => (h[n] || []).forEach((f) => f(p)) }; };
const nAuth = activeCamps(json).length;

// boot like main.js: authored goblins -> regional beasts -> far camps -> sim
function boot(state = {}) {
  const w = World.load(def, assets, { physics: 'grid' });
  w.state = state; const ev = mkEvents();
  const gw = createGoblinWire({ world: w, events: ev, state, json, terrain: w.terrain, groundAt: (x, y) => w.terrain.groundAt(x, y) });
  quiet(() => spawnRegionalBeasts(w, G, 12));
  const homes = homesOf(w);
  const far = generateFarCamps({ geo: G, terrain: w.terrain, seed: 12, avoid: homes });
  gw.addFarCamps(far);
  const sim = quiet(() => createBeastSim(w, { nav: buildBeastNav(w, def.nav), rng: createRng(1), events: ev, band, tileNav: true, spawn: { x: 1480, y: 1030 } }));
  gw.attach(sim);
  return { w, ev, gw, sim, far, state, homes };
}

const t0 = boot();
const far = t0.far;
ok('>= 3 camps in 3 distinct far regions', far.length >= 3 && new Set(far.map((c) => c.region)).size >= 3, far.map((c) => c.id).join(','));
ok('no Ch1-3 regions', far.every((c) => !['tower', 'roadWest', 'ford', 'outwall'].includes(c.region)));
ok('deterministic: same seed -> same camps', JSON.stringify(boot().far) === JSON.stringify(far));

const walk = makeWalkable(t0.w.terrain, G.bounds), relays = relaySites(G);
for (const c of far) {
  const r = G.regions.find((g) => g.id === c.region).r;
  const pts = [c.at, ...c.members.map((m) => [c.at[0] + m.at[0], c.at[1] + m.at[1]])];
  ok(c.id + ' camp + members inside region rect + bounds, walkable, not water', pts.every((p) => p[0] > r[0] && p[0] < r[2] && p[1] > r[1] && p[1] < r[3] && inPolygon(G.bounds.pts, p[0], p[1]) && walk(p[0], p[1]) && t0.w.terrain.typeAt(p[0], p[1]) !== 2));
  ok(c.id + ' >= 60 m from relays', relays.every((p) => Math.hypot(p[0] - c.at[0], p[1] - c.at[1]) >= RELAY_GAP));
  // t0.homes was read before the far members were added, so it is authored + goblins + regional only
  ok(c.id + ' >= 40 m from every beast home', t0.homes.every((h) => Math.hypot(h[0] - c.at[0], h[1] - c.at[1]) >= BEAST_GAP));
  ok(c.id + ' members within leash, 4-6, has a thrower', c.members.every((m) => Math.hypot(m.at[0], m.at[1]) <= LEASH_R) && c.members.length >= 4 && c.members.length <= 6 && c.members.some((m) => m.role === 'thrower'));
  ok(c.id + ' tier/loot by band at the camp', band.bandAt(c.at[0], c.at[1]) >= 1 && band.beastTierAt(c.at[0], c.at[1]) >= 1, band.bandAt(c.at[0], c.at[1]));
}
const authIds = activeCamps(json).flatMap((c) => c.members.map((m) => m.id)), farIds = far.flatMap((c) => c.members.map((m) => m.id));
ok('goblin ids unique', new Set([...authIds, ...farIds]).size === authIds.length + farIds.length);

// slot order: authored beasts + authored camps < regional < far camps (rule order)
const slotsOf = (t, c) => c.members.map((m) => t.sim.slotOf(m.id));
const regSlot = t0.sim.slotOf('boar.downs.1'), authGob = t0.sim.slotOf(authIds[0]);
ok('slot order: authored goblins < regional < far camps in rule order', authGob >= 0 && regSlot > authGob && far.every((c) => slotsOf(t0, c).every((s) => s > regSlot)) && far.every((c, i) => i === 0 || Math.min(...slotsOf(t0, c)) > Math.max(...slotsOf(t0, far[i - 1]))), JSON.stringify([authGob, regSlot, far.map((c) => slotsOf(t0, c))]));
ok('MAX_BEASTS not exceeded, every far member has a slot', t0.sim.count <= MAX_BEASTS && far.every((c) => slotsOf(t0, c).every((s) => s >= 0)), t0.sim.count + '/' + MAX_BEASTS);

// dormancy: player at the tower -> far camps dormant; at the camp -> restored; leave -> dormant again
const c0 = far[0], s0 = slotsOf(t0, c0)[0];
t0.gw.step(1, 1480, 1030);
ok('player far: camp dormant (beast slots parked)', t0.gw.camps.isDormant(nAuth) && t0.sim.isDormant(s0) && t0.sim.dormCamp[s0] === 1);
t0.gw.step(1, c0.at[0] + 20, c0.at[1]);
// the camp reason (dormCamp) clears here; the separate WM-04 tile reason (dormTile) is cleared by the sim's own tile logic when the live tile swaps
ok('player near: camp reason restored (tile reason is separate)', !t0.gw.camps.isDormant(nAuth) && t0.sim.dormCamp[s0] === 0);
t0.gw.step(1, 1480, 1030);
ok('player leaves: dormant again', t0.sim.isDormant(s0) && t0.sim.dormCamp[s0] === 1);

// kill-all persists across save/load
for (const m of c0.members) t0.ev.emit('beast:died', { id: m.id });
const saved = JSON.parse(JSON.stringify(t0.state));
ok('kill-all: cleared + down saved, other far camp untouched', saved[clearedKey(c0.id)] === true && saved[downKey(c0.id)] === true && !saved[downKey(far[1].id)]);
const t1 = boot(saved);
ok('after load the far camp is still down, the next one is not', t1.gw.camps.isDown(nAuth) && !t1.gw.camps.isDown(nAuth + 1));

console.log(`farCamps: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
